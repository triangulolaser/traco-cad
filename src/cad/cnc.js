// Importação de programas CNC (G-code de corte laser/plasma, ex.: G-Weike/CypCut) como entidades do CAD.
// Saída: percursos de corte, deslocamentos rápidos, perfurações numeradas e setas de sentido, em layers próprios.

import { distance, angleOf, normalizeAngle, polar, sub, normalize, add, scale, perpendicular, sweepCCW } from './geometry.js';
import { createLayer } from './document.js';

export const CNC_LAYERS = {
    cut: { name: 'CNC_CORTE', color: 4, lineType: 'CONTINUOUS', lineWeight: 35 },
    mark: { name: 'CNC_MARCACAO', color: 6, lineType: 'CONTINUOUS', lineWeight: 0 },
    rapid: { name: 'CNC_DESLOCAMENTO', color: 8, lineType: 'DASHED', lineWeight: 0 },
    pierce: { name: 'CNC_PERFURACAO', color: 2, lineType: 'CONTINUOUS', lineWeight: 25 },
    order: { name: 'CNC_ORDEM', color: 2, lineType: 'CONTINUOUS', lineWeight: 0 },
    direction: { name: 'CNC_SENTIDO', color: 3, lineType: 'CONTINUOUS', lineWeight: 0 },
};

const MARK_WORDS = /DOBRA|MARC|GRAV|RISC|ENGRAV|SCRIBE|LINHA DE DOBRA/i;

function parseWords(line) {
    // Remove comentários entre parênteses e após ';', devolvendo palavras (letra + número) e o comentário.
    const comments = [];
    let text = line.replace(/\(([^)]*)\)/g, (_, c) => { comments.push(c.trim()); return ' '; });
    const semi = text.indexOf(';');
    if (semi >= 0) {
        comments.push(text.slice(semi + 1).trim());
        text = text.slice(0, semi);
    }
    const words = [];
    const re = /([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
    let m;
    while ((m = re.exec(text))) words.push({ letter: m[1].toUpperCase(), value: Number(m[2]) });
    return { words, comments };
}

export function looksLikeGcode(text) {
    const head = String(text ?? '').slice(0, 4000);
    return /(^|\n)\s*(N\d+\s*)?(G0?[0-3]|M0?3|M30|G21|G90)\b/im.test(head) || /^%/.test(head.trim());
}

// Interpreta o programa e devolve segmentos de movimento com metadados.
export function parseGcode(text, { unitsHint = 'mm' } = {}) {
    const lines = String(text ?? '').split(/\r\n|\r|\n/);
    const moves = []; // { kind: 'rapid'|'cut'|'arc', from, to, center?, ccw?, seq, pierce, group }
    const state = { x: 0, y: 0, motion: 'G00', absolute: true, cutting: false, units: unitsHint, arcAbsolute: false };
    let group = null; // { label, index, isMark }
    let pierceIndex = 0;
    let pierce = null;
    const groups = [];
    let positioned = false;

    lines.forEach((raw, lineIndex) => {
        const { words, comments } = parseWords(raw);
        comments.forEach((c) => {
            if (!c) return;
            const seq = /Seq\s*(\d+)/i.exec(c);
            if (seq || /CORTE|DOBRA|MARC|GRAV|CUT/i.test(c)) {
                group = { label: c, index: groups.length + 1, isMark: MARK_WORDS.test(c), seq: seq ? Number(seq[1]) : groups.length + 1 };
                groups.push(group);
            }
        });
        if (words.length === 0) return;
        let g = null;
        let x = null;
        let y = null;
        let i = 0;
        let j = 0;
        let hasIJ = false;
        let r = null;
        words.forEach(({ letter, value }) => {
            switch (letter) {
                case 'G': {
                    const code = Math.round(value);
                    if (code === 0 || code === 1 || code === 2 || code === 3) g = `G0${code}`;
                    else if (code === 20) state.units = 'in';
                    else if (code === 21) state.units = 'mm';
                    else if (code === 90) state.absolute = true;
                    else if (code === 91) state.absolute = false;
                    else if (code === 90.1) state.arcAbsolute = true;
                    else if (code === 91.1) state.arcAbsolute = false;
                    break;
                }
                case 'M': {
                    const code = Math.round(value);
                    if (code === 3 || code === 4 || code === 7 || code === 8) {
                        state.cutting = true;
                        pierceIndex += 1;
                        pierce = { index: pierceIndex, point: { x: state.x, y: state.y }, group, line: lineIndex + 1 };
                        moves.push({ kind: 'pierce', at: pierce.point, index: pierceIndex, group, line: lineIndex + 1 });
                    } else if (code === 5 || code === 9) {
                        state.cutting = false;
                        pierce = null;
                    }
                    break;
                }
                case 'X': x = value; break;
                case 'Y': y = value; break;
                case 'I': i = value; hasIJ = true; break;
                case 'J': j = value; hasIJ = true; break;
                case 'R': r = value; break;
                default: break;
            }
        });
        if (g) state.motion = g;
        if (x === null && y === null) return;
        const from = { x: state.x, y: state.y };
        const to = {
            x: x === null ? state.x : state.absolute ? x : state.x + x,
            y: y === null ? state.y : state.absolute ? y : state.y + y,
        };
        const motion = state.motion;
        if (!positioned) {
            positioned = true;
            state.x = to.x;
            state.y = to.y;
            if (motion === 'G00' || !state.cutting) return;
        }
        if (motion === 'G00') {
            if (distance(from, to) > 1e-9) moves.push({ kind: 'rapid', from, to, line: lineIndex + 1 });
        } else if (motion === 'G01') {
            moves.push({ kind: state.cutting ? 'cut' : 'rapid', from, to, group, pierce: pierce?.index ?? null, line: lineIndex + 1, cutting: state.cutting });
        } else if (motion === 'G02' || motion === 'G03') {
            const ccw = motion === 'G03';
            let center;
            if (hasIJ) center = state.arcAbsolute ? { x: i, y: j } : { x: from.x + i, y: from.y + j };
            else if (r !== null) center = arcCenterFromRadius(from, to, r, ccw);
            if (!center) moves.push({ kind: state.cutting ? 'cut' : 'rapid', from, to, group, pierce: pierce?.index ?? null, line: lineIndex + 1, cutting: state.cutting });
            else moves.push({ kind: 'arc', from, to, center, ccw, group, pierce: pierce?.index ?? null, line: lineIndex + 1, cutting: state.cutting });
        }
        state.x = to.x;
        state.y = to.y;
    });
    return { moves, groups, units: state.units };
}

function arcCenterFromRadius(from, to, r, ccw) {
    const chord = distance(from, to);
    if (chord < 1e-9 || Math.abs(r) * 2 < chord - 1e-9) return null;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
    const dir = normalize(sub(to, from));
    const n = perpendicular(dir);
    // R positivo = arco menor; sentido decide o lado do centro.
    const side = (ccw ? 1 : -1) * (r >= 0 ? 1 : -1);
    return add(mid, scale(n, side * h));
}

function arcEntity(move, layer) {
    const radius = distance(move.center, move.from);
    const full = distance(move.from, move.to) < 1e-6;
    if (full) return { type: 'circle', layer, center: move.center, radius, cnc: { pierce: move.pierce, line: move.line } };
    const a1 = normalizeAngle(angleOf(move.center, move.from));
    const a2 = normalizeAngle(angleOf(move.center, move.to));
    return {
        type: 'arc',
        layer,
        center: move.center,
        radius,
        start: move.ccw ? a1 : a2,
        end: move.ccw ? a2 : a1,
        cnc: { pierce: move.pierce, line: move.line, ccw: move.ccw },
    };
}

// Seta de sentido: triângulo preenchido (polilinha fechada) no meio do movimento.
function directionArrow(point, direction, size, layer) {
    const dir = normalize(direction);
    const tip = add(point, scale(dir, size / 2));
    const back = sub(tip, scale(dir, size));
    const n = perpendicular(dir);
    return {
        type: 'polyline',
        layer,
        closed: true,
        vertices: [{ ...tip, bulge: 0 }, { ...add(back, scale(n, size / 3)), bulge: 0 }, { ...sub(back, scale(n, size / 3)), bulge: 0 }],
        cnc: { arrow: true },
    };
}

// Posição do rótulo de ordem de perfuração, evitando sobreposição com os já colocados.
// Programas reais perfuram várias vezes no mesmo ponto ou em furos muito próximos; com offset
// fixo os números caem um em cima do outro e viram um borrão ilegível. Tenta os quatro cantos
// do furo e vai empilhando na vertical, em passos de uma linha de texto, até achar espaço.
export function orderLabelPosition(at, label, { textHeight, markerSize, taken }) {
    const width = Math.max(1, String(label).length) * textHeight * 0.7;
    const height = textHeight;
    const padding = textHeight * 0.15;
    const gapX = markerSize * 1.8;
    const gapY = markerSize * 0.6;
    const step = height * 1.15;
    const overlaps = (a, b) => a.minX < b.maxX + padding && a.maxX + padding > b.minX
        && a.minY < b.maxY + padding && a.maxY + padding > b.minY;

    for (let ring = 0; ring < 12; ring += 1) {
        const candidates = [
            { x: gapX, y: gapY + step * ring },
            { x: -gapX - width, y: gapY + step * ring },
            { x: gapX, y: -gapY - height - step * ring },
            { x: -gapX - width, y: -gapY - height - step * ring },
        ];
        for (const offset of candidates) {
            const position = { x: at.x + offset.x, y: at.y + offset.y };
            const box = { minX: position.x, minY: position.y, maxX: position.x + width, maxY: position.y + height };
            if (!taken.some((other) => overlaps(other, box))) {
                taken.push(box);
                return position;
            }
        }
    }
    // Desistiu de achar espaço: devolve a posição padrão em vez de deixar o rótulo de fora.
    const fallback = { x: at.x + gapX, y: at.y + gapY };
    taken.push({ minX: fallback.x, minY: fallback.y, maxX: fallback.x + width, maxY: fallback.y + height });
    return fallback;
}

export function gcodeToEntities(text, options = {}) {
    const parsed = parseGcode(text, options);
    const { moves } = parsed;
    const factor = parsed.units === 'in' ? 25.4 : 1;
    const conv = (p) => ({ x: p.x * factor, y: p.y * factor });
    // Extensão para dimensionar marcadores.
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    moves.forEach((m) => {
        [m.from, m.to, m.at].filter(Boolean).forEach((p) => {
            const q = conv(p);
            minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y);
        });
    });
    const diag = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 100;
    const markerSize = Math.max(1, diag * 0.004);
    const arrowSize = Math.max(1.5, diag * 0.006);
    const textHeight = Math.max(2, diag * 0.008);

    const entities = [];
    const stats = { cut: 0, mark: 0, rapid: 0, pierces: 0, cutLength: 0, rapidLength: 0 };
    let lastArrowAt = null;
    const takenLabels = [];
    moves.forEach((m) => {
        if (m.kind === 'pierce') {
            const at = conv(m.at);
            stats.pierces += 1;
            entities.push({ type: 'circle', layer: CNC_LAYERS.pierce.name, center: at, radius: markerSize, cnc: { pierce: m.index } });
            entities.push({ type: 'line', layer: CNC_LAYERS.pierce.name, start: { x: at.x - markerSize * 1.6, y: at.y }, end: { x: at.x + markerSize * 1.6, y: at.y }, cnc: { pierce: m.index } });
            entities.push({ type: 'line', layer: CNC_LAYERS.pierce.name, start: { x: at.x, y: at.y - markerSize * 1.6 }, end: { x: at.x, y: at.y + markerSize * 1.6 }, cnc: { pierce: m.index } });
            const label = String(m.index);
            const position = orderLabelPosition(at, label, { textHeight, markerSize, taken: takenLabels });
            entities.push({ type: 'text', layer: CNC_LAYERS.order.name, position, height: textHeight, rotation: 0, text: label, cnc: { pierce: m.index, order: true } });
            lastArrowAt = null;
            return;
        }
        const from = conv(m.from);
        const to = conv(m.to);
        if (m.kind === 'rapid') {
            stats.rapid += 1;
            stats.rapidLength += distance(from, to);
            entities.push({ type: 'line', layer: CNC_LAYERS.rapid.name, start: from, end: to, cnc: { rapid: true, line: m.line } });
            return;
        }
        const isMark = m.group?.isMark;
        const layer = m.cutting === false ? CNC_LAYERS.rapid.name : isMark ? CNC_LAYERS.mark.name : CNC_LAYERS.cut.name;
        if (m.kind === 'cut') {
            if (distance(from, to) < 1e-9) return;
            const e = { type: 'line', layer, start: from, end: to, cnc: { pierce: m.pierce, line: m.line, group: m.group?.seq ?? null } };
            entities.push(e);
            if (layer !== CNC_LAYERS.rapid.name) {
                stats[isMark ? 'mark' : 'cut'] += 1;
                stats.cutLength += distance(from, to);
                const len = distance(from, to);
                if (len >= arrowSize * 3 && (!lastArrowAt || distance(lastArrowAt, from) >= arrowSize * 4)) {
                    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
                    entities.push(directionArrow(mid, sub(to, from), arrowSize, CNC_LAYERS.direction.name));
                    lastArrowAt = mid;
                }
            }
            return;
        }
        if (m.kind === 'arc') {
            const arc = arcEntity({ ...m, from, to, center: conv(m.center) }, layer);
            entities.push(arc);
            if (layer !== CNC_LAYERS.rapid.name) {
                stats[isMark ? 'mark' : 'cut'] += 1;
                const radius = arc.radius;
                const sweep = arc.type === 'circle' ? Math.PI * 2 : sweepCCW(arc.start, arc.end);
                const len = sweep * radius;
                stats.cutLength += len;
                if (len >= arrowSize * 3) {
                    const midAngle = arc.type === 'circle' ? angleOf(arc.center, from) + Math.PI : arc.start + sweep / 2;
                    const midPoint = polar(arc.center, midAngle, radius);
                    const tangent = m.ccw ? { x: -Math.sin(midAngle), y: Math.cos(midAngle) } : { x: Math.sin(midAngle), y: -Math.cos(midAngle) };
                    entities.push(directionArrow(midPoint, tangent, arrowSize, CNC_LAYERS.direction.name));
                    lastArrowAt = midPoint;
                }
            }
        }
    });
    const layers = Object.values(CNC_LAYERS).map((l) => createLayer(l.name, { color: l.color, lineType: l.lineType, lineWeight: l.lineWeight }));
    return { entities, layers, stats, groups: parsed.groups, units: parsed.units };
}
