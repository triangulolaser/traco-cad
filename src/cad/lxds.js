// Importação de arquivos .lxds (CypCut / Friendess), o formato nativo do laser.
//
// Formato, obtido por engenharia reversa sobre arquivos reais da pasta do laser:
//
//   O .lxds é um ZIP. As peças que interessam são:
//     info.xml                 aplicação e versão que gravou (CypCut 6.3)
//     Model2D/content.xml      nome do modelo e extensão (ExtMin/ExtMax), usada para conferência
//     Layers/content.xml       nome e cor dos layers
//     Shapes2D/content.xml     uma entrada por forma, com LayerName e GeoAddr
//     Geometry2D/data.bin      geometria binária, endereçada por GeoAddr
//
//   `Geometry2D/data.bin` começa com o magic `BCMP` e um cabeçalho de 4096 bytes.
//   Cada forma é um registro delimitado por sentinelas:
//     D1 D1 D1 D1  início do objeto, seguido de reservado(4) e comprimento(8)
//     campo string: tag(2) + comprimento(2) + bytes, próximo campo alinhado em 4
//     C1 C1 C1 C1  início do sub-objeto (mesmo cabeçalho), cuja string é a classe real
//     C0 C0 C0 C0 / D0 D0 D0 D0  fim do sub-objeto e do objeto
//
//   Depois do nome da classe o conteúdo é posicional:
//     Line        ponto(tag 10 00 02 00 + x,y) duas vezes
//     Circle      ponto(tag + x,y), raio(double), reservado(4), ângulo inicial(double)
//     Arc         ponto(tag + x,y) do centro, raio(double), sentido(u32: 0 anti-horário,
//                 1 horário), ângulo inicial e varredura (doubles, radianos)
//     LwPolyline  reservado(8), flags(4), contagem(4), vértices de 32 bytes
//                 (índice(4), x(8), y(8), bulge(8), reservado(4))
//
//   `flags & 1` indica polilinha fechada, e o bulge segue a convenção do DXF
//   (tan(θ/4), positivo no sentido anti-horário). Ambos conferidos contra arquivos de
//   produção: a caixa reconstruída bate com ExtMin/ExtMax e o desenho renderizado mostra
//   cantos arredondados e rasgos oblongos coerentes.

import { createLayer, DEFAULT_LAYER } from './document.js';

const MAGIC = 0x504d4342; // 'BCMP' em little-endian
const BEGIN_OBJECT = 0xd1d1d1d1;
const BEGIN_SUB = 0xc1c1c1c1;
const POINT_TAG = 0x00020010;
const VERTEX_SIZE = 32;

export const LXDS_LAYER = 'LXDS';
// Deslocamento entre furos do bloco de flycut: o laser passa desligado. Vai para um layer
// próprio, desligado, para não virar corte se o desenho for reexportado.
export const LXDS_TRAVEL_LAYER = 'PERCURSO_FLYCUT';
// Entradas e saídas do CypCut desenhadas a partir do registro de processo. Layer desligado: é
// referência de CAM, não contorno de corte.
export const LXDS_LEAD_LAYER = 'CAM_ENTRADA_SAIDA';

// ---------------------------------------------------------------------------
// Leitor de ZIP mínimo: só o necessário para o .lxds, sem dependência nova.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
        throw new Error('Este navegador não descomprime deflate; abra o arquivo em um navegador atual.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 66000; i -= 1) {
        if (view.getUint32(i, true) === EOCD_SIGNATURE) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo não é um ZIP válido.');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i += 1) {
        if (view.getUint32(p, true) !== CENTRAL_SIGNATURE) break;
        const method = view.getUint16(p + 10, true);
        const compressed = view.getUint32(p + 20, true);
        const nameLength = view.getUint16(p + 28, true);
        const extraLength = view.getUint16(p + 30, true);
        const commentLength = view.getUint16(p + 32, true);
        const localOffset = view.getUint32(p + 42, true);
        const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLength));
        // O cabeçalho local repete nome e extra com tamanhos próprios; os dados vêm depois dele.
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        entries.set(name, { method, start, compressed });
        p += 46 + nameLength + extraLength + commentLength;
    }
    return {
        names: () => [...entries.keys()],
        async read(name) {
            const entry = entries.get(name);
            if (!entry) return null;
            const raw = bytes.subarray(entry.start, entry.start + entry.compressed);
            if (entry.method === 0) return raw;
            if (entry.method === 8) return inflateRaw(raw);
            throw new Error(`Compressão ZIP não suportada (${entry.method}) em ${name}.`);
        },
    };
}

// ---------------------------------------------------------------------------
// Geometria

function alignUp(value) {
    return value + ((4 - (value % 4)) % 4);
}

function readTaggedString(view, p) {
    const length = view.getUint16(p + 2, true);
    const bytes = new Uint8Array(view.buffer, view.byteOffset + p + 4, length);
    return { text: new TextDecoder('ascii').decode(bytes), next: alignUp(p + 4 + length) };
}

// Devolve { className, bodyStart, recordEnd } para a forma em `address`.
function openShapeRecord(view, address) {
    if (view.getUint32(address, true) !== BEGIN_OBJECT) return null;
    const length = view.getUint32(address + 8, true);
    const recordEnd = Math.min(view.byteLength, address + 16 + length);
    let p = address + 16;
    for (; p < recordEnd - 4; p += 4) {
        if (view.getUint32(p, true) === BEGIN_SUB) break;
    }
    if (p >= recordEnd - 4) return null;
    const { text, next } = readTaggedString(view, p + 16);
    return { className: text, bodyStart: next, recordEnd };
}

// Subdivisão de De Casteljau até os pontos de controle ficarem a menos de `tolerance` (mm) da
// corda. Seis segmentos fixos facetavam o laço de retorno do flycut; aqui a curva fica lisa e
// o trecho quase reto continua com poucos vértices.
export const BEZIER_TOLERANCE_MM = 0.01;

export function flattenCubicBezier(p0, p1, p2, p3, tolerance = BEZIER_TOLERANCE_MM) {
    const out = [{ x: p0.x, y: p0.y }];
    const distanceToChord = (p, a, b) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
        return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    };
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const walk = (a, b, c, d, depth) => {
        if (depth >= 16 || Math.max(distanceToChord(b, a, d), distanceToChord(c, a, d)) <= tolerance) {
            out.push({ x: d.x, y: d.y });
            return;
        }
        const ab = mid(a, b);
        const bc = mid(b, c);
        const cd = mid(c, d);
        const abc = mid(ab, bc);
        const bcd = mid(bc, cd);
        const m = mid(abc, bcd);
        walk(a, ab, abc, m, depth + 1);
        walk(m, bcd, cd, d, depth + 1);
    };
    walk(p0, p1, p2, p3, 0);
    return out;
}

// Transformação afim { a, b, c, d, e, f }: x' = a·x + c·y + e, y' = b·x + d·y + f.
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function composeTransform(p, q) {
    return {
        a: p.a * q.a + p.c * q.b,
        b: p.b * q.a + p.d * q.b,
        c: p.a * q.c + p.c * q.d,
        d: p.b * q.c + p.d * q.d,
        e: p.a * q.e + p.c * q.f + p.e,
        f: p.b * q.e + p.d * q.f + p.f,
    };
}

// Insert do CypCut: escala, depois rotação (radianos) e por fim o ponto de inserção.
export function insertTransform({ x = 0, y = 0, rotation = 0, xScale = 1, yScale = 1 } = {}) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return { a: cos * xScale, b: sin * xScale, c: -sin * yScale, d: cos * yScale, e: x, f: y };
}

function applyTransform(pt, t) {
    if (!t) return { x: pt.x, y: pt.y };
    return { x: t.a * pt.x + t.c * pt.y + t.e, y: t.b * pt.x + t.d * pt.y + t.f };
}

const determinant = (t) => (t ? t.a * t.d - t.b * t.c : 1);
const scaleOf = (t) => (t ? Math.sqrt(Math.abs(determinant(t))) : 1);
const rotationOf = (t) => (t ? Math.atan2(t.b, t.a) : 0);

function findPointTag(view, from, to) {
    for (let p = from; p + 20 <= to; p += 4) {
        if (view.getUint32(p, true) === POINT_TAG) return p;
    }
    return -1;
}

// `skipped`, quando informado, recebe a contagem por classe das formas que não viram entidade.
export function parseGeometry(geometryBytes, shapes, skipped = null) {
    const view = new DataView(geometryBytes.buffer, geometryBytes.byteOffset, geometryBytes.byteLength);
    if (view.byteLength < 16 || view.getUint32(0, true) !== MAGIC) {
        throw new Error('Geometry2D/data.bin sem o magic BCMP: arquivo .lxds fora do formato conhecido.');
    }
    const out = [];
    const parseShape = (shape) => {
        const layer = shape.layer || LXDS_LAYER;
        const transform = shape.transform || null;

        if (shape.tag === 'ScanLines' || shape.lines) {
            const lines = shape.lines || [];
            lines.forEach((l) => {
                out.push({
                    type: 'line',
                    layer,
                    start: applyTransform({ x: l.x0, y: l.y0 }, transform),
                    end: applyTransform({ x: l.x1, y: l.y1 }, transform),
                });
            });
            return;
        }

        const skip = (name) => { if (skipped) skipped[name] = (skipped[name] || 0) + 1; };
        if (shape.address == null) { skip(shape.tag || 'desconhecida'); return; }
        const record = openShapeRecord(view, shape.address);
        if (!record) { skip(shape.tag || 'desconhecida'); return; }
        const { className, bodyStart, recordEnd } = record;

        if (className === 'Line') {
            const first = findPointTag(view, bodyStart, recordEnd);
            if (first < 0) return;
            const second = findPointTag(view, first + 20, recordEnd);
            if (second < 0) return;
            const p1 = { x: view.getFloat64(first + 4, true), y: view.getFloat64(first + 12, true) };
            const p2 = { x: view.getFloat64(second + 4, true), y: view.getFloat64(second + 12, true) };
            out.push({
                type: 'line',
                layer,
                start: applyTransform(p1, transform),
                end: applyTransform(p2, transform),
            });
            return;
        }

        if (className === 'Circle') {
            const at = findPointTag(view, bodyStart, recordEnd);
            if (at < 0 || at + 28 > recordEnd) return;
            const radius = view.getFloat64(at + 20, true);
            if (!(radius > 0)) return;
            const center = { x: view.getFloat64(at + 4, true), y: view.getFloat64(at + 12, true) };
            out.push({
                type: 'circle',
                layer,
                center: applyTransform(center, transform),
                radius: radius * scaleOf(transform),
            });
            return;
        }

        if (className === 'Arc') {
            const at = findPointTag(view, bodyStart, recordEnd);
            if (at < 0 || at + 48 > recordEnd) { skip('Arc'); return; }
            const radius = view.getFloat64(at + 20, true);
            const clockwise = view.getUint32(at + 28, true) === 1;
            const start = view.getFloat64(at + 32, true);
            const sweep = view.getFloat64(at + 40, true) * (clockwise ? -1 : 1);
            if (!(radius > 0) || !Number.isFinite(start) || !Number.isFinite(sweep)) { skip('Arc'); return; }
            const center = { x: view.getFloat64(at + 4, true), y: view.getFloat64(at + 12, true) };
            if (Math.abs(sweep) >= Math.PI * 2 - 1e-9) {
                out.push({ type: 'circle', layer, center: applyTransform(center, transform), radius: radius * scaleOf(transform) });
                return;
            }
            // Varredura negativa (horária) ou espelhamento invertem o sentido; a entidade do CAD
            // é sempre anti-horária de `start` a `end`.
            let a0 = sweep >= 0 ? start : start + sweep;
            let a1 = sweep >= 0 ? start + sweep : start;
            if (transform) {
                const p0 = applyTransform({ x: center.x + Math.cos(a0), y: center.y + Math.sin(a0) }, transform);
                const p1 = applyTransform({ x: center.x + Math.cos(a1), y: center.y + Math.sin(a1) }, transform);
                const c = applyTransform(center, transform);
                a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
                a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
                if (determinant(transform) < 0) [a0, a1] = [a1, a0];
            }
            const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            out.push({
                type: 'arc',
                layer,
                center: applyTransform(center, transform),
                radius: radius * scaleOf(transform),
                start: norm(a0),
                end: norm(a1),
            });
            return;
        }

        if (className === 'LwPolyline') {
            if (bodyStart + 16 > recordEnd) return;
            const flags = view.getUint32(bodyStart + 8, true);
            const count = view.getUint32(bodyStart + 12, true);
            const start = bodyStart + 16;
            if (count <= 0 || start + count * VERTEX_SIZE > recordEnd) return;
            const vertices = [];
            const flipBulge = determinant(transform) < 0;
            for (let i = 0; i < count; i += 1) {
                const p = start + i * VERTEX_SIZE;
                const rawPt = { x: view.getFloat64(p + 4, true), y: view.getFloat64(p + 12, true) };
                const bulge = view.getFloat64(p + 20, true);
                const pt = applyTransform(rawPt, transform);
                vertices.push({
                    x: pt.x,
                    y: pt.y,
                    bulge: flipBulge ? -bulge : bulge,
                });
            }
            if (vertices.length < 2) return;
            out.push({ type: 'polyline', layer, closed: (flags & 1) !== 0, vertices });
            return;
        }

        if (className === 'PolyBezier') {
            const rawPts = [];
            let cur = bodyStart;
            while (cur + 20 <= recordEnd) {
                if (view.getUint32(cur, true) === POINT_TAG) {
                    rawPts.push({
                        x: view.getFloat64(cur + 4, true),
                        y: view.getFloat64(cur + 12, true),
                    });
                    cur += 20;
                } else {
                    cur += 4;
                }
            }
            if (rawPts.length >= 4 && rawPts.length % 4 === 0) {
                const polyVertices = [];
                const numCurves = rawPts.length / 4;
                for (let c = 0; c < numCurves; c += 1) {
                    const p0 = rawPts[c * 4];
                    const p1 = rawPts[c * 4 + 1];
                    const p2 = rawPts[c * 4 + 2];
                    const p3 = rawPts[c * 4 + 3];
                    const sampled = flattenCubicBezier(p0, p1, p2, p3);
                    for (let s = (c === 0 ? 0 : 1); s < sampled.length; s += 1) {
                        const pt = applyTransform(sampled[s], transform);
                        polyVertices.push({ x: pt.x, y: pt.y, bulge: 0 });
                    }
                }
                if (polyVertices.length >= 2) {
                    out.push({ type: 'polyline', layer, closed: false, vertices: polyVertices });
                }
            } else {
                skip('PolyBezier');
            }
            return;
        }

        skip(className || shape.tag || 'desconhecida');
    };
    shapes.forEach((shape) => {
        const before = out.length;
        parseShape(shape);
        for (let i = before; i < out.length; i += 1) {
            if (shape.cam) out[i].cam = shape.cam;
            if (shape.source) out[i].source = shape.source;
        }
    });
    return out;
}

// Registro de processo da forma em Shapes2D/data.bin, endereçado por DataAddr (ver docs/lxds.md):
// `Shape` +12 = canal de processo do CypCut; `LeadParam` +32 = posição da entrada (fração do
// contorno; no círculo, fração da volta a partir de 45°). Sem registro, devolve null.
function findAscii(bytes, text, from, to) {
    const codes = [...text].map((c) => c.charCodeAt(0));
    for (let i = from; i + codes.length <= to; i += 1) {
        let hit = true;
        for (let k = 0; k < codes.length; k += 1) if (bytes[i + k] !== codes[k]) { hit = false; break; }
        if (hit) return i;
    }
    return -1;
}

export function readShapeProcess(dataBytes, address) {
    if (!dataBytes || !Number.isFinite(address) || address + 16 > dataBytes.byteLength) return null;
    const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);
    if (view.getUint32(address, true) !== BEGIN_OBJECT) return null;
    const end = Math.min(dataBytes.byteLength, address + 16 + Number(view.getBigUint64(address + 8, true)));
    const shape = findAscii(dataBytes, 'Shape\0', address, end);
    if (shape < 0 || shape + 16 > end) return null;
    const lead = findAscii(dataBytes, 'LeadParam', address, end);
    const leadFraction = lead >= 0 && lead + 40 <= end ? view.getFloat64(lead + 32, true) : null;
    const f64 = (at) => (at + 8 <= end ? view.getFloat64(at, true) : NaN);
    const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

    // TGksLeadParam::SaveToPack: tipo (L+16), posição, ângulo, comprimento, raio do arco e raio do furo.
    let leadIn = null;
    let leadOut = null;
    let afterLead = shape;
    if (lead >= 0 && lead + 72 <= end) {
        leadIn = {
            type: view.getUint32(lead + 16, true),
            angle: finite(f64(lead + 40)),
            length: finite(f64(lead + 48)),
            arcRadius: finite(f64(lead + 56)),
        };
        // Depois da seção da entrada: u32 de presença e, se 1, a seção da saída, com 4 bytes a
        // menos (doubles a partir de L+28: selo, ângulo, comprimento, raio).
        const close = findAscii(dataBytes, '\xc0\xc0\xc0\xc0', lead, end);
        afterLead = close >= 0 ? close + 4 : lead;
        if (close >= 0 && close + 8 <= end && view.getUint32(close + 4, true) === 1) {
            const out = findAscii(dataBytes, 'LeadParam', close, end);
            if (out >= 0 && out + 68 <= end) {
                leadOut = {
                    type: view.getUint32(out + 16, true),
                    seal: finite(f64(out + 28)),
                    angle: finite(f64(out + 36)),
                    length: finite(f64(out + 44)),
                    arcRadius: finite(f64(out + 52)),
                };
                afterLead = out;
            }
        }
    }

    // Subobjeto Curve: externo (C+12) e compensação de kerf ligada (C+24) com o valor (C+28).
    // Com saída gravada, o CypCut omite o u32 reservado após o nome e tudo recua 4 bytes.
    let outer = null;
    let kerfOffset = null;
    const curve = findAscii(dataBytes, 'Curve\0', afterLead, end);
    if (curve >= 12 && curve + 36 <= end) {
        const compact = view.getUint32(curve - 12, true) === 0x44 ? -4 : 0;
        outer = view.getUint32(curve + 12 + compact, true) === 1;
        const on = view.getUint32(curve + 24 + compact, true) === 1;
        const value = f64(curve + 28 + compact);
        kerfOffset = on && Number.isFinite(value) && value > 0 && value < 10 ? value : 0;
    }

    return {
        process: view.getUint32(shape + 12, true),
        leadFraction: Number.isFinite(leadFraction) && leadFraction >= 0 && leadFraction <= 1 ? leadFraction : null,
        leadIn,
        leadOut,
        outer,
        kerfOffset,
    };
}

// ---------------------------------------------------------------------------
// Entradas e saídas

const TAU = Math.PI * 2;
// Trecho de partida abaixo disso é chanfro de limpeza, não direção do corte.
const TINY_START_SEGMENT_MM = 0.5;

// Ponto e tangente (sentido do desenho) na fração `fraction` do comprimento do contorno.
function polylineFrame(vertices, closed, fraction) {
    const n = vertices.length;
    const count = closed ? n : n - 1;
    const pieces = [];
    let total = 0;
    for (let i = 0; i < count; i += 1) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        if (chord < 1e-12) continue;
        const theta = 4 * Math.atan(a.bulge || 0);
        const length = Math.abs(theta) > 1e-9 ? Math.abs((chord / (2 * Math.sin(theta / 2))) * theta) : chord;
        pieces.push({ a, b, chord, theta, length });
        total += length;
    }
    if (!pieces.length) return null;
    let target = Math.min(Math.max(fraction, 0), 1) * total;
    for (const piece of pieces) {
        if (target > piece.length && piece !== pieces[pieces.length - 1]) { target -= piece.length; continue; }
        const t = Math.min(1, target / piece.length);
        const { a, b, chord, theta } = piece;
        const ux = (b.x - a.x) / chord;
        const uy = (b.y - a.y) / chord;
        if (Math.abs(theta) <= 1e-9) return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tangent: { x: ux, y: uy } };
        // Arco do bulge: a tangente no início gira θ/2 em relação à corda e avança θ ao longo do trecho.
        const radius = chord / (2 * Math.sin(theta / 2));
        const heading = Math.atan2(uy, ux) - theta / 2 + theta * t;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const h = radius * Math.cos(theta / 2);
        const cx = mx - uy * h;
        const cy = my + ux * h;
        const start = Math.atan2(a.y - cy, a.x - cx);
        const angle = start + theta * t;
        const r = Math.abs(radius);
        return { point: { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }, tangent: { x: Math.cos(heading), y: Math.sin(heading) } };
    }
    return null;
}

function signedArea(vertices) {
    let area = 0;
    for (let i = 0; i < vertices.length; i += 1) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
}

// Ponto de partida, tangente de corte e normal para o lado da sobra (fora da peça no externo,
// dentro do furo no interno). A normal é geométrica, então independe do sentido gravado.
function contourFrame(e, fraction, outer) {
    if (e.type === 'circle') {
        // No CypCut a posição no círculo é a fração da volta a partir de 45°.
        const angle = Math.PI / 4 + (fraction ?? 0) * TAU;
        const radial = { x: Math.cos(angle), y: Math.sin(angle) };
        return {
            point: { x: e.center.x + e.radius * radial.x, y: e.center.y + e.radius * radial.y },
            tangent: { x: -radial.y, y: radial.x },
            normal: outer ? radial : { x: -radial.x, y: -radial.y },
        };
    }
    if (e.type !== 'polyline' || e.vertices.length < 2) return null;
    const first = e.vertices[0];
    const last = e.vertices[e.vertices.length - 1];
    const closed = e.closed || Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
    if (!closed) return null;
    const vertices = e.closed ? e.vertices : e.vertices.slice(0, -1);
    const frame = polylineFrame(vertices, true, fraction ?? 0);
    if (!frame) return null;
    // Chanfro minúsculo no ponto de partida (canto limpo do DXF): o CypCut mede o ângulo da
    // entrada pelo trecho seguinte, não pela direção do chanfro. Conferido no CypCut
    // em 15/10/2026 (OP #45869): a perfuração fica dentro do furo.
    if (!fraction) {
        for (let k = 0; k < vertices.length; k += 1) {
            const a = vertices[k];
            const b = vertices[(k + 1) % vertices.length];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 1e-12) continue;
            // Só um chanfro isolado: em curva facetada os trechos curtos seguidos são a própria curva.
            if (k > 1) break;
            if (len >= TINY_START_SEGMENT_MM) {
                if (k > 0) {
                    // Trecho em arco: a tangente no início gira θ/2 em relação à corda.
                    const heading = Math.atan2(b.y - a.y, b.x - a.x) - 2 * Math.atan(a.bulge || 0);
                    frame.tangent = { x: Math.cos(heading), y: Math.sin(heading) };
                }
                break;
            }
        }
    }
    
    const left = { x: -frame.tangent.y, y: frame.tangent.x };
    const ccw = signedArea(vertices) > 0;
    // Num contorno anti-horário a esquerda é dentro: o externo sobra à direita, o furo à esquerda.
    const sign = (ccw ? 1 : -1) * (outer ? -1 : 1);
    return { ...frame, normal: { x: left.x * sign, y: left.y * sign } };
}

function arcPoints(center, radius, from, sweep, segments = 12) {
    return Array.from({ length: segments + 1 }, (_, i) => {
        const a = from + (sweep * i) / segments;
        return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a), bulge: 0 };
    });
}

// Arco de 90° tangente ao contorno em `p`, do lado da sobra. `arriving` = termina em p no sentido
// do corte (entrada); senão começa em p (saída).
function tangentArc(p, tangent, normal, radius, arriving) {
    const center = { x: p.x + normal.x * radius, y: p.y + normal.y * radius };
    const toP = Math.atan2(p.y - center.y, p.x - center.x);
    // Sentido do giro que, em p, anda ao longo da tangente.
    const turn = Math.sign(tangent.x * -(p.y - center.y) + tangent.y * (p.x - center.x)) || 1;
    return arriving
        ? arcPoints(center, radius, toP - turn * Math.PI / 2, turn * Math.PI / 2)
        : arcPoints(center, radius, toP, turn * Math.PI / 2);
}

// Tipos do CypCut: 0 nenhuma, 1 reta, 2 arco, 3 reta + arco. Ângulo π/2 = perpendicular, 0 = tangente.
export function leadEntities(e, rec) {
    if (!rec) return [];
    const frame = contourFrame(e, rec.leadFraction, Boolean(rec.outer));
    if (!frame) return [];
    const { point: p, tangent: t, normal: n } = frame;
    const out = [];
    const line = (a, b) => ({ type: 'polyline', layer: LXDS_LEAD_LAYER, closed: false, vertices: [{ ...a, bulge: 0 }, { ...b, bulge: 0 }] });
    const lin = rec.leadIn;
    if (lin && lin.type >= 1 && lin.type <= 3) {
        if (lin.type === 1 && lin.length > 1e-6) {
            const dir = { x: -t.x * Math.cos(lin.angle) + n.x * Math.sin(lin.angle), y: -t.y * Math.cos(lin.angle) + n.y * Math.sin(lin.angle) };
            out.push({ ...line({ x: p.x + dir.x * lin.length, y: p.y + dir.y * lin.length }, p), lead: 'in' });
        } else if (lin.type >= 2 && lin.arcRadius > 1e-6) {
            const arc = tangentArc(p, t, n, lin.arcRadius, true);
            if (lin.type === 3 && lin.length > 1e-6) {
                const s = arc[0];
                const back = { x: arc[1].x - s.x, y: arc[1].y - s.y };
                const len = Math.hypot(back.x, back.y) || 1;
                arc.unshift({ x: s.x - (back.x / len) * lin.length, y: s.y - (back.y / len) * lin.length, bulge: 0 });
            }
            out.push({ type: 'polyline', layer: LXDS_LEAD_LAYER, closed: false, vertices: arc, lead: 'in' });
        }
    }
    const lout = rec.leadOut;
    if (lout && lout.type === 1 && lout.length > 1e-6) {
        const dir = { x: t.x * Math.cos(lout.angle) + n.x * Math.sin(lout.angle), y: t.y * Math.cos(lout.angle) + n.y * Math.sin(lout.angle) };
        out.push({ ...line(p, { x: p.x + dir.x * lout.length, y: p.y + dir.y * lout.length }), lead: 'out' });
    } else if (lout && lout.type >= 2 && lout.arcRadius > 1e-6) {
        out.push({ type: 'polyline', layer: LXDS_LEAD_LAYER, closed: false, vertices: tangentArc(p, t, n, lout.arcRadius, false), lead: 'out' });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Documento

function textOf(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
}

// Parser de XML leve para compatibilidade uniforme entre Browser e Node.js
export function parseXml(xml) {
    const root = { tag: '!root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const tagRe = /<(\/?[A-Za-z0-9_]+)([^>]*)>|([^<]+)/g;
    let match;
    while ((match = tagRe.exec(xml))) {
        const [, tag, attrStr, text] = match;
        if (text) {
            const t = text.trim();
            if (t) stack[stack.length - 1].text += t;
            continue;
        }
        if (!tag || tag.startsWith('?')) continue;
        if (tag.startsWith('/')) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        const attrs = {};
        const attrRe = /([A-Za-z0-9_]+)="([^"]*)"/g;
        let am;
        while ((am = attrRe.exec(attrStr))) {
            attrs[am[1]] = am[2];
        }
        const isSelfClosing = attrStr.endsWith('/');
        const node = { tag, attrs, children: [], text: '' };
        stack[stack.length - 1].children.push(node);
        if (!isSelfClosing) {
            stack.push(node);
        }
    }
    return root.children[0] || root;
}

// `blocks`: cada Insert de peça no Model2D (bloco sem a flag de flycut, sem espelho e com escala
// uniforme) vira um Insert do CAD com a definição do bloco, em vez de formas soltas. A miniatura
// e as conferências usam a geometria explodida (padrão). `leads`: desenha entradas e saídas no
// layer CAM_ENTRADA_SAIDA (o CAD liga; miniatura e conferências não).
export async function lxdsToEntities(buffer, { name = 'desenho.lxds', withCam = false, blocks: asBlocks = false, leads = false } = {}) {
    const zip = await readZip(buffer);
    const geometryBytes = await zip.read('Geometry2D/data.bin');
    const shapesXml = await zip.read('Shapes2D/content.xml');
    if (!geometryBytes || !shapesXml) {
        throw new Error('Arquivo .lxds sem Geometry2D/data.bin ou Shapes2D/content.xml.');
    }

    const shapesTree = parseXml(textOf(shapesXml));
    const shapesMap = new Map();
    shapesTree.children.forEach((c) => {
        const h = c.attrs.Handle;
        if (!h) return;
        if (c.tag === 'ScanLines') {
            const lines = [];
            c.children.forEach((lc) => {
                if (lc.tag === 'Line') {
                    lines.push({
                        x0: Number(lc.attrs.X0),
                        y0: Number(lc.attrs.Y0),
                        x1: Number(lc.attrs.X1),
                        y1: Number(lc.attrs.Y1),
                    });
                }
            });
            shapesMap.set(h, { tag: 'ScanLines', handle: h, layer: c.attrs.LayerName || '', lines });
        } else {
            // Sem GeoAddr a forma não tem geometria legível; segue adiante para entrar na contagem
            // de descartadas em vez de sumir calada.
            shapesMap.set(h, {
                tag: c.tag,
                handle: h,
                layer: c.attrs.LayerName || '',
                address: c.attrs.GeoAddr ? Number(c.attrs.GeoAddr) : null,
                dataAddress: c.attrs.DataAddr ? Number(c.attrs.DataAddr) : null,
            });
        }
    });

    const blocksBytes = await zip.read('Blocks/content.xml');
    const blocksMap = new Map();
    if (blocksBytes) {
        const blocksTree = parseXml(textOf(blocksBytes));
        blocksTree.children.forEach((b) => {
            if (b.tag !== 'Block') return;
            const bname = b.attrs.Name;
            const sGroup = b.children.find((c) => c.tag === 'Shapes');
            blocksMap.set(bname, { shapes: sGroup ? sGroup.children : [], flycut: (Number(b.attrs.Flags) & 256) !== 0 });
        });
    }

    const modelXml = await zip.read('Model2D/content.xml');
    let extents = null;
    let modelShapes = null;
    if (modelXml) {
        const modelTree = parseXml(textOf(modelXml));
        const min = modelTree.children.find((c) => c.tag === 'ExtMin');
        const max = modelTree.children.find((c) => c.tag === 'ExtMax');
        if (min && max) {
            extents = {
                minX: Number(min.attrs.X), minY: Number(min.attrs.Y),
                maxX: Number(max.attrs.X), maxY: Number(max.attrs.Y),
            };
        }
        modelShapes = modelTree.children.find((c) => c.tag === 'Shapes');
    }

    const instances = [];
    const parts = [];
    // Inserts podem aninhar: peça agrupada (bloco "Part") contendo o bloco do flycut. Cada nível
    // compõe escala, rotação e translação.
    const emit = (nodes, parent, depth) => {
        nodes.forEach((s) => {
            if (s.attrs.Class === 'Insert') {
                if (depth > 8) return;
                const ip = s.children.find((c) => c.tag === 'InsertPoint')?.attrs;
                const bname = s.children.find((c) => c.tag === 'BlockName')?.text;
                const field = (tag, fallback) => {
                    const value = Number(s.children.find((c) => c.tag === tag)?.text);
                    return Number.isFinite(value) ? value : fallback;
                };
                const local = insertTransform({
                    x: Number(ip?.X || 0),
                    y: Number(ip?.Y || 0),
                    rotation: field('Rotation', 0),
                    xScale: field('XScale', 1),
                    yScale: field('YScale', 1),
                });
                const channelPort = Number(s.attrs.ChannelPort) || parent?.channelPort || null;
                const block = blocksMap.get(bname);
                const flycut = Boolean(block?.flycut);
                const scale = Math.hypot(local.a, local.b);
                const rigid = Math.abs(Math.hypot(local.c, local.d) - scale) < 1e-9 && determinant(local) > 0;
                if (asBlocks && !parent && block && !flycut && rigid) {
                    // Peça: as formas ficam no referencial do bloco; o Insert carrega a posição.
                    const part = { key: s.attrs.Handle || String(parts.length), name: bname, local };
                    parts.push(part);
                    emit(block.shapes, { transform: IDENTITY, channelPort, flycut, part }, depth + 1);
                    return;
                }
                const transform = composeTransform(parent?.transform || IDENTITY, local);
                emit(block?.shapes || [], { transform, channelPort, flycut, part: parent?.part }, depth + 1);
            } else if (s.attrs.Handle) {
                const desc = shapesMap.get(s.attrs.Handle);
                if (desc) instances.push(parent ? { ...desc, transform: parent.transform, inFlycut: parent.flycut, channelPort: parent.channelPort, part: parent.part } : { ...desc, transform: null });
            }
        });
    };
    if (modelShapes && modelShapes.children.length > 0) {
        emit(modelShapes.children, null, 0);
    } else {
        shapesMap.forEach((desc) => instances.push({ ...desc, transform: null }));
    }

    // Processo e ordem de corte: o CypCut corta na ordem do Model2D. No bloco de flycut (Flags 256;
    // o bloco "Part" de peça agrupada não tem a flag e seus contornos sem layer cortam) só os
    // círculos cortam; linhas e polilinhas sem layer são o caminho entre eles. Forma sem layer do
    // CAD fica no layer do canal de processo do CypCut (PROCESSO_<n>), que é o que separa corte,
    // marcação e flycut na máquina.
    const shapesData = await zip.read('Shapes2D/data.bin');
    instances.forEach((it) => {
        const rec = it.dataAddress != null ? readShapeProcess(shapesData, it.dataAddress) : null;
        const process = rec?.process || it.channelPort || 1;
        const link = Boolean(it.inFlycut) && !it.layer && (it.tag === 'Line' || it.tag === 'LwPolyline');
        if (withCam) it.cam = { process, leadFraction: rec?.leadFraction ?? null, link };
        if (link) it.layer = LXDS_TRAVEL_LAYER;
        else if (!it.layer) it.layer = `PROCESSO_${process}`;
        it.source = { rec: link ? null : rec, part: it.part || null };
    });

    const skipped = {};
    const parsed = parseGeometry(geometryBytes, instances, skipped);

    // Entradas, saídas e compensação de kerf de cada contorno, a partir do registro de processo.
    const kerf = {};
    let leadsIn = 0;
    let leadsOut = 0;
    const withLeads = [];
    parsed.forEach((e) => {
        const { rec, part } = e.source || {};
        delete e.source;
        if (rec?.kerfOffset >= 0.0005 && e.type !== 'line') {
            e.kerfOffset = rec.kerfOffset;
            const key = rec.kerfOffset.toFixed(3);
            kerf[key] = (kerf[key] || 0) + 1;
        }
        if (part) e.part = part;
        withLeads.push(e);
        if (leads) leadEntities(e, rec).forEach((lead) => {
            if (lead.lead === 'in') leadsIn += 1; else leadsOut += 1;
            delete lead.lead;
            if (part) lead.part = part;
            withLeads.push(lead);
        });
    });

    // Peças como bloco: uma definição por nome, um Insert por ocorrência no Model2D.
    const definitions = {};
    const entities = [];
    const insertsByPart = new Map();
    withLeads.forEach((e) => {
        const part = e.part;
        if (!part) { entities.push(e); return; }
        delete e.part;
        if (!insertsByPart.has(part)) {
            const scale = Math.hypot(part.local.a, part.local.b);
            const insert = {
                type: 'insert',
                name: part.name,
                definition: null,
                position: { x: part.local.e, y: part.local.f },
                scaleX: scale,
                scaleY: scale,
                rotation: (Math.atan2(part.local.b, part.local.a) * 180) / Math.PI,
                layer: DEFAULT_LAYER,
                color: 'bylayer',
                entities: [],
            };
            insertsByPart.set(part, insert);
            entities.push(insert);
        }
        insertsByPart.get(part).entities.push(e);
    });
    insertsByPart.forEach((insert) => {
        // O mesmo bloco aparece várias vezes no nest; a primeira ocorrência define o conteúdo.
        if (!definitions[insert.name]) definitions[insert.name] = { basePoint: { x: 0, y: 0 }, entities: insert.entities };
        insert.definition = definitions[insert.name];
        delete insert.entities;
    });
    const flat = asBlocks ? entities.flatMap((e) => (e.type === 'insert' ? e.definition.entities : [e])) : entities;

    const layersXml = await zip.read('Layers/content.xml');
    const layersTree = layersXml ? parseXml(textOf(layersXml)) : null;
    const declaredLayers = layersTree ? layersTree.children.filter((c) => c.tag === 'Layer') : [];

    const used = new Set(flat.map((e) => e.layer));
    const layers = [createLayer(DEFAULT_LAYER, { color: 7 })];
    used.forEach((layerName) => {
        if (!layerName || layerName === DEFAULT_LAYER) return;
        if (layerName === LXDS_TRAVEL_LAYER) {
            layers.push(createLayer(layerName, { color: 8, visible: false, lineType: 'DASHED' }));
            return;
        }
        if (layerName === LXDS_LEAD_LAYER) {
            layers.push(createLayer(layerName, { color: 1, visible: false }));
            return;
        }
        const info = declaredLayers.find((l) => l.attrs.Name === layerName);
        layers.push(createLayer(layerName, { color: info ? lxdsColorToAci(Number(info.attrs.Color)) : 7 }));
    });
    flat.forEach((e) => { if (!e.layer) e.layer = DEFAULT_LAYER; });

    const infoXml = await zip.read('info.xml');
    const infoTree = infoXml ? parseXml(textOf(infoXml)) : null;
    const app = infoTree ? infoTree.children.find((c) => c.tag === 'Application') : null;

    const geometry = flat.filter((e) => e.layer !== LXDS_LEAD_LAYER);
    const stats = {
        lines: geometry.filter((e) => e.type === 'line').length,
        circles: geometry.filter((e) => e.type === 'circle').length,
        polylines: geometry.filter((e) => e.type === 'polyline').length,
        arcs: geometry.filter((e) => e.type === 'arc').length
            + geometry.reduce((n, e) => n + (e.type === 'polyline' ? e.vertices.filter((v) => Math.abs(v.bulge) > 1e-12).length : 0), 0),
        travel: geometry.filter((e) => e.layer === LXDS_TRAVEL_LAYER).length,
        leadsIn,
        leadsOut,
        kerf,
        parts: insertsByPart.size,
        skipped,
    };

    return {
        entities,
        blocks: definitions,
        layers,
        extents,
        stats,
        application: app ? `${app.attrs.AppName ?? 'CypCut'} ${app.attrs.AppVer ?? ''}`.trim() : null,
        name: name.replace(/\.lxds$/i, '') + '.dxf',
        sourceFormat: 'lxds',
    };
}

// Cor do CypCut é TColor do Delphi, 0x00BBGGRR (FUROS = 65535 = amarelo); o CAD trabalha em ACI, então aproxima pelas cores básicas.
function lxdsColorToAci(bgr) {
    if (!Number.isFinite(bgr)) return 7;
    const r = bgr & 0xff;
    const g = (bgr >> 8) & 0xff;
    const b = (bgr >> 16) & 0xff;
    const basic = [[7, 255, 255, 255], [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255]];
    let best = 7;
    let bestDistance = Infinity;
    basic.forEach(([aci, br, bg, bb]) => {
        const d = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2;
        if (d < bestDistance) { bestDistance = d; best = aci; }
    });
    return best;
}

export function looksLikeLxds(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06);
}
