// Destaque da prévia do Deslocamento (OFFSET): faixa entre a origem e a cópia, setas de tamanho fixo
// na tela apontando o lado e o lado por extenso (FORA/DENTRO, ESQUERDA/DIREITA) junto à distância.
// Em círculo grande com deslocamento pequeno a cópia fica colada na origem; as setas não dependem da distância.
// Só existe enquanto o comando pede o ponto: não entra no documento nem no DXF.
import { entityCurves, closestPointOnCurve, distance, bulgeToArc } from './geometry.js';
import { ellipseSamples, ellipseIsFull, ensureSplineGeometry } from './extra-entities.js';
import { sampleSpline } from './splines.js';

const TAU = Math.PI * 2;

function ccwSweep(start, end) {
    let s = end - start;
    while (s <= 1e-12) s += TAU;
    while (s > TAU + 1e-12) s -= TAU;
    return s;
}

// Pontos ao longo do arco de `from` com varredura assinada `sweep`; o passo segue o tamanho em pixels.
function arcPoints(center, radius, from, sweep, scale, out) {
    const n = Math.max(4, Math.min(4096, Math.ceil((Math.abs(sweep) * radius * scale) / 4)));
    for (let i = 0; i <= n; i += 1) {
        const a = from + (sweep * i) / n;
        out.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
    }
}

function polylineIsClosed(entity) {
    const vs = entity.vertices ?? [];
    if (entity.closed) return true;
    return vs.length > 3 && distance(vs[0], vs[vs.length - 1]) <= Math.max(1e-4, 1e-6 * Math.hypot(vs[0].x, vs[0].y));
}

export function isClosedOutline(entity) {
    if (!entity) return false;
    if (entity.type === 'circle') return true;
    if (entity.type === 'polyline' || entity.type === 'lwpolyline') return polylineIsClosed(entity);
    if (entity.type === 'ellipse') return ellipseIsFull(entity);
    if (entity.type === 'spline') return Boolean(entity.closed);
    return false;
}

// Contorno da entidade como lista de pontos no sentido do traçado. `scale` = pixels por unidade.
export function outlinePoints(entity, scale = 1) {
    const out = [];
    if (!entity) return out;
    switch (entity.type) {
        case 'line':
            return [entity.start, entity.end];
        case 'circle':
            arcPoints(entity.center, entity.radius, 0, TAU, scale, out);
            return out;
        case 'arc':
            arcPoints(entity.center, entity.radius, entity.start, ccwSweep(entity.start, entity.end), scale, out);
            return out;
        case 'polyline':
        case 'lwpolyline': {
            const vs = entity.vertices ?? [];
            const count = entity.closed ? vs.length : vs.length - 1;
            for (let i = 0; i < count; i += 1) {
                const a = vs[i];
                const b = vs[(i + 1) % vs.length];
                if (i === 0) out.push({ x: a.x, y: a.y });
                const arc = a.bulge ? bulgeToArc(a, b, a.bulge) : null;
                if (arc) {
                    const sweep = ccwSweep(arc.start, arc.end);
                    const seg = [];
                    if (a.bulge > 0) arcPoints(arc.center, arc.radius, arc.start, sweep, scale, seg);
                    else arcPoints(arc.center, arc.radius, arc.end, -sweep, scale, seg);
                    out.push(...seg.slice(1, -1));
                }
                out.push({ x: b.x, y: b.y });
            }
            return out;
        }
        case 'ellipse': {
            const r = Math.hypot(entity.major?.x ?? 0, entity.major?.y ?? 0);
            return ellipseSamples(entity, Math.max(96, Math.min(4096, Math.ceil((TAU * r * scale) / 4))));
        }
        case 'spline': {
            const pts = sampleSpline(ensureSplineGeometry(entity), 16) ?? [];
            return pts.map((p) => ({ x: p.x, y: p.y }));
        }
        default: {
            // Reserva: extremos dos segmentos das curvas conhecidas.
            for (const c of entityCurves(entity)) {
                if (c.kind === 'segment') out.push(c.a, c.b);
            }
            return out;
        }
    }
}

function ringArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

export function nearestOnEntity(p, entity) {
    let best = null;
    let bestD = Infinity;
    for (const curve of entityCurves(entity)) {
        const q = closestPointOnCurve(p, curve);
        const d = distance(p, q);
        if (d < bestD) {
            bestD = d;
            best = q;
        }
    }
    return best;
}

// Lado do deslocamento: 'out'/'in' em contorno fechado ou arco; 'left'/'right' no sentido do traçado em aberto.
export function offsetSide(source, results, cursor) {
    const list = (Array.isArray(results) ? results : [results]).filter(Boolean);
    if (!source || list.length === 0) return null;
    if (source.type === 'arc' || source.type === 'circle') {
        const r = list[0].radius;
        if (Number.isFinite(r) && Math.abs(r - source.radius) > 1e-12) return r > source.radius ? 'out' : 'in';
    }
    if (isClosedOutline(source)) {
        const base = ringArea(outlinePoints(source, 1));
        const area = list.reduce((sum, item) => sum + ringArea(outlinePoints(item, 1)), 0);
        if (Math.abs(area - base) <= 1e-12 * Math.max(1, base)) return null;
        return area > base ? 'out' : 'in';
    }
    if (!cursor) return null;
    const pts = outlinePoints(source, 1);
    if (pts.length < 2) return null;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i + 1 < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / len2)) : 0;
        const d = Math.hypot(cursor.x - (a.x + dx * t), cursor.y - (a.y + dy * t));
        if (d < bd) {
            bd = d;
            bi = i;
        }
    }
    const a = pts[bi];
    const b = pts[bi + 1];
    const cross = (b.x - a.x) * (cursor.y - a.y) - (b.y - a.y) * (cursor.x - a.x);
    if (Math.abs(cross) < 1e-15) return null;
    return cross > 0 ? 'left' : 'right';
}

export const OFFSET_SIDE_LABEL = { out: 'FORA', in: 'DENTRO', left: 'ESQUERDA', right: 'DIREITA' };
export const OFFSET_SIDE_GLYPH = { out: '▲', in: '▼', left: '◀', right: '▶' };

// Setas junto ao cursor, a ±`spacingPx` ao longo da origem, cada uma na direção origem → cópia.
export function offsetArrows(source, results, cursor, pxToWorld, spacingPx = 150) {
    const list = (Array.isArray(results) ? results : [results]).filter(Boolean);
    if (!source || !cursor || list.length === 0) return [];
    const toResult = (q) => {
        let best = null;
        for (const item of list) {
            const r = nearestOnEntity(q, item);
            if (r && (!best || distance(q, r) < distance(q, best))) best = r;
        }
        return best;
    };
    const p1 = nearestOnEntity(cursor, source);
    if (!p1) return [];
    const p2 = toResult(p1);
    if (!p2 || distance(p1, p2) <= 1e-12) return [];
    const nx = (p2.x - p1.x) / distance(p1, p2);
    const ny = (p2.y - p1.y) / distance(p1, p2);
    const step = pxToWorld(spacingPx);
    const minGap = pxToWorld(spacingPx * 0.4);
    const arrows = [];
    for (const sign of [-1, 1]) {
        const q = nearestOnEntity({ x: p1.x - ny * step * sign, y: p1.y + nx * step * sign }, source);
        if (!q) continue;
        if (arrows.some((a) => distance(a.at, q) < minGap)) continue;
        const r = toResult(q);
        if (!r) continue;
        const d = distance(q, r);
        if (d <= 1e-12) continue;
        arrows.push({ at: q, dir: { x: (r.x - q.x) / d, y: (r.y - q.y) / d } });
    }
    return arrows;
}

// Faixa entre a origem e a cópia (mundo). Fechados: anéis para preencher com evenodd. Abertos: um polígono.
export function offsetBand(source, results, scale = 1) {
    const list = (Array.isArray(results) ? results : [results]).filter(Boolean);
    if (!source || list.length === 0) return null;
    const src = outlinePoints(source, scale);
    if (src.length < 2) return null;
    if (isClosedOutline(source)) {
        const rings = [src, ...list.map((item) => outlinePoints(item, scale))].filter((r) => r.length > 2);
        return rings.length > 1 ? { rings, evenOdd: true } : null;
    }
    if (list.length !== 1) return null;
    let res = outlinePoints(list[0], scale);
    if (res.length < 2) return null;
    if (distance(src[0], res[0]) > distance(src[0], res[res.length - 1])) res = res.slice().reverse();
    return { rings: [[...src, ...res.slice().reverse()]], evenOdd: false };
}

// Tudo o que o renderer precisa para o destaque. `viewport` dá a escala e a conversão pixel → mundo.
export function offsetHint(source, results, cursor, viewport) {
    const list = (Array.isArray(results) ? results : [results]).filter(Boolean);
    if (!source || list.length === 0) return null;
    const scale = viewport?.scale ?? 1;
    const pxToWorld = (px) => (viewport?.pixelsToWorld ? viewport.pixelsToWorld(px) : px / scale);
    return {
        band: offsetBand(source, list, scale),
        arrows: offsetArrows(source, list, cursor, pxToWorld),
        side: offsetSide(source, list, cursor),
    };
}
