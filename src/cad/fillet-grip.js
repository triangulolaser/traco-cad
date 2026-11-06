// Alça de concordância: com duas linhas/arcos selecionados que se encontram num canto,
// mostra uma alça na bissetriz do canto. Arrastar a alça para dentro cria o arco de
// concordância (fillet) e o raio cresce conforme o arrasto.

import { distance, sub, add, scale, polar, sweepCCW, normalizeAngle, entityLength } from './geometry.js';
import { filletCurves } from './commands.js';

const FILLET_TYPES = new Set(['line', 'arc']);
const MIN_TURN = 1e-3; // rad: abaixo disso as curvas são colineares/tangentes e não há canto.

function unit(v) {
    const len = Math.hypot(v.x, v.y);
    return len > 1e-12 ? { x: v.x / len, y: v.y / len } : null;
}

// Extremidades da entidade com a direção que entra na curva a partir de cada uma.
function endsWithDirection(entity) {
    if (entity.type === 'line') {
        const dir = unit(sub(entity.end, entity.start));
        if (!dir) return [];
        return [
            { end: 'start', point: entity.start, dir },
            { end: 'end', point: entity.end, dir: scale(dir, -1) },
        ];
    }
    if (entity.type === 'arc') {
        if (!(entity.radius > 1e-9)) return [];
        const s = entity.start;
        const e = entity.end;
        return [
            { end: 'start', point: polar(entity.center, s, entity.radius), dir: { x: -Math.sin(s), y: Math.cos(s) } },
            { end: 'end', point: polar(entity.center, e, entity.radius), dir: { x: Math.sin(e), y: -Math.cos(e) } },
        ];
    }
    return [];
}

function endPoint(entity, which) {
    if (entity.type === 'line') return entity[which];
    return polar(entity.center, entity[which], entity.radius);
}

// Ponto da curva a `along` do canto, além da tangência esperada: indica ao fillet o lado a
// manter e faz ele preferir o centro dentro deste canto.
function pickAlong(entity, cornerEnd, along) {
    const length = entityLength(entity);
    const f = length > 1e-12 ? Math.min(0.95, Math.max(0.05, along / length)) : 0.5;
    const t = cornerEnd === 'start' ? f : 1 - f;
    if (entity.type === 'line') return { x: entity.start.x + (entity.end.x - entity.start.x) * t, y: entity.start.y + (entity.end.y - entity.start.y) * t };
    const sweep = sweepCCW(entity.start, entity.end);
    return polar(entity.center, normalizeAngle(entity.start + sweep * t), entity.radius);
}

const otherEnd = (which) => (which === 'start' ? 'end' : 'start');

/**
 * Cantos em que as duas entidades se encontram pelas extremidades.
 * @returns {Array<{ index: number, corner: {x,y}, bisector: {x,y}, halfSin: number }>}
 */
export function findFilletCorners(e1, e2, tolerance = 1e-6) {
    if (!e1 || !e2 || e1.id === e2.id) return [];
    if (!FILLET_TYPES.has(e1.type) || !FILLET_TYPES.has(e2.type)) return [];
    const corners = [];
    endsWithDirection(e1).forEach((a) => {
        endsWithDirection(e2).forEach((b) => {
            if (distance(a.point, b.point) > tolerance) return;
            const cos = Math.max(-1, Math.min(1, a.dir.x * b.dir.x + a.dir.y * b.dir.y));
            const theta = Math.acos(cos); // ângulo interno entre as duas direções
            if (theta < MIN_TURN || Math.PI - theta < MIN_TURN) return;
            const bisector = unit(add(a.dir, b.dir));
            if (!bisector) return;
            corners.push({ index: corners.length, end1: a.end, end2: b.end, corner: { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 }, bisector, halfSin: Math.sin(theta / 2) });
        });
    });
    // Duas curvas fechando uma figura (lente) têm dois cantos e o lado a manter fica ambíguo.
    return corners.length === 1 ? corners : [];
}

/**
 * Raio cujo arco passa pela projeção do cursor na bissetriz.
 * O ponto médio do arco fica a r·(1 − sen(θ/2))/sen(θ/2) do canto.
 */
export function filletRadiusFromCursor(cornerInfo, cursor) {
    const d = (cursor.x - cornerInfo.corner.x) * cornerInfo.bisector.x + (cursor.y - cornerInfo.corner.y) * cornerInfo.bisector.y;
    if (!(d > 0)) return 0;
    const s = cornerInfo.halfSin;
    return (d * s) / (1 - s);
}

// Passo "redondo" (1, 2, 5 × 10ⁿ) pelo tamanho de um pixel, para o raio não ficar quebrado.
export function niceRadiusStep(worldPerPixel) {
    if (!(worldPerPixel > 0)) return 0;
    const exp = Math.floor(Math.log10(worldPerPixel));
    const base = 10 ** exp;
    for (const m of [1, 2, 5, 10]) {
        if (m * base >= worldPerPixel) return m * base;
    }
    return 10 * base;
}

function validFillet(e1, e2, result, cornerInfo) {
    if (!result || !result.arc) return false;
    // A ponta longe do canto não pode mudar: o corte tem de acontecer do lado do canto.
    const keep1 = otherEnd(cornerInfo.end1);
    const keep2 = otherEnd(cornerInfo.end2);
    if (distance(endPoint(result.first, keep1), endPoint(e1, keep1)) > 1e-6) return false;
    if (distance(endPoint(result.second, keep2), endPoint(e2, keep2)) > 1e-6) return false;
    const l1 = entityLength(e1);
    const l2 = entityLength(e2);
    const n1 = entityLength(result.first);
    const n2 = entityLength(result.second);
    // Só vale se as duas curvas forem encurtadas (tangência dentro de cada uma), nunca estendidas.
    return n1 > 1e-9 && n2 > 1e-9 && n1 < l1 - 1e-9 && n2 < l2 - 1e-9;
}

function tryFillet(e1, e2, radius, cornerInfo) {
    // Distância do canto à tangência para duas retas: r / tan(θ/2). Arcos ficam perto disso.
    const s = cornerInfo.halfSin;
    const tangentDist = (radius * Math.sqrt(Math.max(0, 1 - s * s))) / Math.max(1e-12, s);
    const along = tangentDist * 2 + 1e-6;
    const result = filletCurves(e1, pickAlong(e1, cornerInfo.end1, along), e2, pickAlong(e2, cornerInfo.end2, along), radius);
    return validFillet(e1, e2, result, cornerInfo) ? result : null;
}

/**
 * Concordância no canto com o raio pedido. Se o raio não couber nas curvas, usa o maior que cabe.
 * @returns {{ first, second, arc, radius } | null}
 */
export function filletAtCorner(e1, e2, radius, { step = 0, corner = null } = {}) {
    let r = Number(radius);
    if (!(r > 0)) return null;
    const cornerInfo = corner ?? findFilletCorners(e1, e2)[0];
    if (!cornerInfo) return null;
    if (step > 0) r = Math.max(step, Math.round(r / step) * step);
    let result = tryFillet(e1, e2, r, cornerInfo);
    if (result) return { ...result, radius: r };
    // Busca binária pelo maior raio que ainda cabe.
    let lo = 0;
    let hi = r;
    let best = null;
    for (let i = 0; i < 40; i += 1) {
        const mid = (lo + hi) / 2;
        const attempt = tryFillet(e1, e2, mid, cornerInfo);
        if (attempt) {
            lo = mid;
            best = { ...attempt, radius: mid };
        } else {
            hi = mid;
        }
    }
    if (!best) return null;
    if (step > 0) {
        const floored = Math.floor(best.radius / step) * step;
        if (floored > 0) {
            const attempt = tryFillet(e1, e2, floored, cornerInfo);
            if (attempt) return { ...attempt, radius: floored };
        }
    }
    return best;
}

/**
 * Alças de concordância para a seleção atual (exatamente duas linhas/arcos com canto comum).
 * @param {Array<object>} entities entidades selecionadas e editáveis
 * @param {number} worldPerPixel tamanho de 1 px em unidades do desenho
 */
export function getFilletGrips(entities, worldPerPixel, { offsetPixels = 18 } = {}) {
    if (!Array.isArray(entities) || entities.length !== 2) return [];
    const [e1, e2] = entities;
    const tol = Math.max(1e-6, (worldPerPixel || 0) * 0.5);
    return findFilletCorners(e1, e2, tol).map((info) => ({
        id: `fillet:${e1.id}:${e2.id}:${info.index}`,
        entityId: null,
        entityIds: [e1.id, e2.id],
        type: 'fillet',
        index: info.index,
        corner: info,
        point: add(info.corner, scale(info.bisector, offsetPixels * (worldPerPixel || 0))),
    }));
}
