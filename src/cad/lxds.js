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

function sampleCubicBezier(p0, p1, p2, p3, steps = 6) {
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const mt = 1 - t;
        const c0 = mt * mt * mt;
        const c1 = 3 * mt * mt * t;
        const c2 = 3 * mt * t * t;
        const c3 = t * t * t;
        pts.push({
            x: c0 * p0.x + c1 * p1.x + c2 * p2.x + c3 * p3.x,
            y: c0 * p0.y + c1 * p1.y + c2 * p2.y + c3 * p3.y,
        });
    }
    return pts;
}

function applyTransform(pt, transform) {
    if (!transform) return { x: pt.x, y: pt.y };
    const { tx = 0, ty = 0, sx = 1, sy = 1, angle = 0 } = transform;
    let px = pt.x * sx;
    let py = pt.y * sy;
    if (angle !== 0) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rx = px * cos - py * sin;
        const ry = px * sin + py * cos;
        px = rx;
        py = ry;
    }
    return { x: px + tx, y: py + ty };
}

function findPointTag(view, from, to) {
    for (let p = from; p + 20 <= to; p += 4) {
        if (view.getUint32(p, true) === POINT_TAG) return p;
    }
    return -1;
}

export function parseGeometry(geometryBytes, shapes) {
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

        if (shape.address == null) return;
        const record = openShapeRecord(view, shape.address);
        if (!record) return;
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
            const sx = Math.abs(transform?.sx ?? 1);
            out.push({
                type: 'circle',
                layer,
                center: applyTransform(center, transform),
                radius: radius * sx,
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
            const flipBulge = ((transform?.sx ?? 1) * (transform?.sy ?? 1)) < 0;
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
                    const sampled = sampleCubicBezier(p0, p1, p2, p3, 6);
                    for (let s = (c === 0 ? 0 : 1); s < sampled.length; s += 1) {
                        const pt = applyTransform(sampled[s], transform);
                        polyVertices.push({ x: pt.x, y: pt.y, bulge: 0 });
                    }
                }
                if (polyVertices.length >= 2) {
                    out.push({ type: 'polyline', layer, closed: false, vertices: polyVertices });
                }
            }
        }
    };
    shapes.forEach((shape) => {
        const before = out.length;
        parseShape(shape);
        if (shape.cam) for (let i = before; i < out.length; i += 1) out[i].cam = shape.cam;
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
    return {
        process: view.getUint32(shape + 12, true),
        leadFraction: Number.isFinite(leadFraction) && leadFraction >= 0 && leadFraction <= 1 ? leadFraction : null,
    };
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

export async function lxdsToEntities(buffer, { name = 'desenho.lxds', withCam = false } = {}) {
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
        } else if (c.attrs.GeoAddr) {
            shapesMap.set(h, {
                tag: c.tag,
                handle: h,
                layer: c.attrs.LayerName || '',
                address: Number(c.attrs.GeoAddr),
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
            blocksMap.set(bname, sGroup ? sGroup.children : []);
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
    // Inserts podem aninhar: peça agrupada (bloco "Part") contendo o bloco do flycut. Composição só de
    // translação e escala, como as inserções que o CypCut grava.
    const emit = (nodes, parent, depth) => {
        nodes.forEach((s) => {
            if (s.attrs.Class === 'Insert') {
                if (depth > 8) return;
                const ip = s.children.find((c) => c.tag === 'InsertPoint')?.attrs;
                const bname = s.children.find((c) => c.tag === 'BlockName')?.text;
                const xs = Number(s.children.find((c) => c.tag === 'XScale')?.text || 1);
                const ys = Number(s.children.find((c) => c.tag === 'YScale')?.text || 1);
                const p = parent?.transform || { tx: 0, ty: 0, sx: 1, sy: 1 };
                const transform = {
                    tx: p.tx + p.sx * Number(ip?.X || 0),
                    ty: p.ty + p.sy * Number(ip?.Y || 0),
                    sx: p.sx * xs,
                    sy: p.sy * ys,
                };
                const channelPort = Number(s.attrs.ChannelPort) || parent?.channelPort || null;
                emit(blocksMap.get(bname) || [], { transform, channelPort }, depth + 1);
            } else if (s.attrs.Handle) {
                const desc = shapesMap.get(s.attrs.Handle);
                if (desc) instances.push(parent ? { ...desc, transform: parent.transform, inBlock: true, channelPort: parent.channelPort } : { ...desc, transform: null });
            }
        });
    };
    if (modelShapes && modelShapes.children.length > 0) {
        emit(modelShapes.children, null, 0);
    } else {
        shapesMap.forEach((desc) => instances.push({ ...desc, transform: null }));
    }

    if (withCam) {
        // Processo e ordem de corte para a miniatura: o CypCut corta na ordem do Model2D. No bloco
        // de flycut só os círculos cortam; linhas e polilinhas sem layer são o caminho entre eles.
        const shapesData = await zip.read('Shapes2D/data.bin');
        instances.forEach((it) => {
            const rec = it.dataAddress != null ? readShapeProcess(shapesData, it.dataAddress) : null;
            it.cam = {
                process: rec?.process || it.channelPort || 1,
                leadFraction: rec?.leadFraction ?? null,
                link: Boolean(it.inBlock) && !it.layer && (it.tag === 'Line' || it.tag === 'LwPolyline'),
            };
        });
    }

    const entities = parseGeometry(geometryBytes, instances);

    const layersXml = await zip.read('Layers/content.xml');
    const layersTree = layersXml ? parseXml(textOf(layersXml)) : null;
    const declaredLayers = layersTree ? layersTree.children.filter((c) => c.tag === 'Layer') : [];

    const used = new Set(entities.map((e) => e.layer));
    const layers = [createLayer(DEFAULT_LAYER, { color: 7 })];
    used.forEach((layerName) => {
        if (!layerName || layerName === DEFAULT_LAYER) return;
        const info = declaredLayers.find((l) => l.attrs.Name === layerName);
        layers.push(createLayer(layerName, { color: info ? lxdsColorToAci(Number(info.attrs.Color)) : 7 }));
    });
    entities.forEach((e) => { if (!e.layer) e.layer = DEFAULT_LAYER; });

    const infoXml = await zip.read('info.xml');
    const infoTree = infoXml ? parseXml(textOf(infoXml)) : null;
    const app = infoTree ? infoTree.children.find((c) => c.tag === 'Application') : null;

    const stats = {
        lines: entities.filter((e) => e.type === 'line').length,
        circles: entities.filter((e) => e.type === 'circle').length,
        polylines: entities.filter((e) => e.type === 'polyline').length,
        arcs: entities.reduce((n, e) => n + (e.type === 'polyline' ? e.vertices.filter((v) => Math.abs(v.bulge) > 1e-12).length : 0), 0),
    };

    return {
        entities,
        layers,
        extents,
        stats,
        application: app ? `${app.attrs.AppName ?? 'CypCut'} ${app.attrs.AppVer ?? ''}`.trim() : null,
        name: name.replace(/\.lxds$/i, '') + '.dxf',
        sourceFormat: 'lxds',
    };
}

// Cor do CypCut é 0xRRGGBB; o CAD trabalha em ACI, então aproxima pelas cores básicas.
function lxdsColorToAci(rgb) {
    if (!Number.isFinite(rgb)) return 7;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
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
