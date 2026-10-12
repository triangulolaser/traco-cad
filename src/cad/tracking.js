// Object snap tracking (projeções): linhas de alinhamento a partir de pontos adquiridos,
// extensão de linhas/arcos e interseções entre projeções e objetos.

import {
    distance,
    sub,
    add,
    scale,
    dot,
    cross,
    normalize,
    degToRad,
    polar,
    angleOf,
    entityCurves,
    intersectCurves,
    closestPointOnCircle,
    curveBox,
    boxesIntersect,
    distanceToCurve,
} from './geometry.js';

export const TRACK_LIMIT = 4;

// Prioridades compartilhadas com os object snaps (menor vence).
export const SNAP_PRIORITY = { end: 1, int: 1, mid: 2, cen: 3, qua: 3, trkint: 3.5, per: 4, tan: 4, ext: 5, trk: 5, nea: 6 };

function orthoAngles(polarOn, increment) {
    const set = new Set([0, 90, 180, 270]);
    if (polarOn && increment > 0) {
        for (let a = 0; a < 360; a += increment) set.add(Math.round(a * 1000) / 1000);
    }
    return [...set].map(degToRad);
}

// Cria um ponto de rastreio a partir de um snap adquirido. Para END de linha/arco, guarda
// também a extensão (direção para fora da linha ou o círculo do arco).
export function trackingPointFromSnap(snap) {
    if (!snap || !['end', 'mid', 'cen', 'qua', 'int'].includes(snap.mode)) return null;
    const tp = { point: snap.point, mode: snap.mode, ext: null };
    const entity = snap.entity;
    if (snap.mode === 'end' && entity) {
        if (entity.type === 'line') {
            const nearStart = distance(snap.point, entity.start) < distance(snap.point, entity.end);
            const dir = normalize(nearStart ? sub(entity.start, entity.end) : sub(entity.end, entity.start));
            tp.ext = { kind: 'ray', angle: Math.atan2(dir.y, dir.x) };
        } else if (entity.type === 'arc') {
            tp.ext = { kind: 'circle', center: entity.center, radius: entity.radius };
        } else if (entity.type === 'polyline') {
            entityCurves(entity).forEach((curve) => {
                if (curve.kind === 'segment') {
                    const atA = distance(snap.point, curve.a) < 1e-7;
                    const atB = distance(snap.point, curve.b) < 1e-7;
                    if (atA || atB) {
                        const dir = normalize(atA ? sub(curve.a, curve.b) : sub(curve.b, curve.a));
                        tp.ext = { kind: 'ray', angle: Math.atan2(dir.y, dir.x) };
                    }
                } else if (curve.kind === 'arc') {
                    const ends = [polar(curve.center, curve.start, curve.radius), polar(curve.center, curve.end, curve.radius)];
                    if (ends.some((p) => distance(p, snap.point) < 1e-7)) tp.ext = { kind: 'circle', center: curve.center, radius: curve.radius };
                }
            });
        }
    }
    return tp;
}

export function addTrackingPoint(list, tp, tolerance) {
    if (!tp) return list;
    if (list.some((t) => distance(t.point, tp.point) <= tolerance)) return list;
    const next = [...list, tp];
    while (next.length > TRACK_LIMIT) next.shift();
    return next;
}

function buildLines({ tracking, reference, polarOn, polarIncrement }) {
    const angles = orthoAngles(polarOn, polarIncrement);
    const lines = [];
    tracking.forEach((tp) => {
        angles.forEach((angle) => {
            // Linha completa: representa ambos os sentidos com o ângulo em [0, π).
            const a = ((angle % Math.PI) + Math.PI) % Math.PI;
            if (!lines.some((l) => l.origin === tp.point && l.kind === 'line' && Math.abs(l.angle - a) < 1e-9)) {
                lines.push({ kind: 'line', origin: tp.point, angle: a, source: 'track' });
            }
        });
        if (tp.ext?.kind === 'ray') lines.push({ kind: 'ray', origin: tp.point, angle: tp.ext.angle, source: 'ext' });
        if (tp.ext?.kind === 'circle') lines.push({ kind: 'circle', center: tp.ext.center, radius: tp.ext.radius, source: 'ext' });
    });
    if (reference) {
        angles.forEach((angle) => {
            const a = ((angle % Math.PI) + Math.PI) % Math.PI;
            if (!lines.some((l) => l.origin === reference && Math.abs(l.angle - a) < 1e-9)) {
                lines.push({ kind: 'line', origin: reference, angle: a, source: 'reference' });
            }
        });
    }
    return lines;
}

function projectOnTrackLine(line, p) {
    if (line.kind === 'circle') {
        return { point: closestPointOnCircle(p, line.center, line.radius), ok: true };
    }
    const dir = { x: Math.cos(line.angle), y: Math.sin(line.angle) };
    const t = dot(sub(p, line.origin), dir);
    if (line.kind === 'ray' && t < 0) return { point: line.origin, ok: false };
    return { point: add(line.origin, scale(dir, t)), ok: true, t };
}

function trackLineAsCurve(line, reach) {
    if (line.kind === 'circle') return { kind: 'circle', center: line.center, radius: line.radius };
    const dir = { x: Math.cos(line.angle), y: Math.sin(line.angle) };
    const a = line.kind === 'ray' ? line.origin : sub(line.origin, scale(dir, reach));
    const b = add(line.origin, scale(dir, reach));
    return { kind: 'segment', a, b };
}

// tracking: pontos adquiridos; reference: ponto de origem do segmento em construção (opcional).
// Retorna { snap, lines } onde lines são as linhas ativas para desenhar.
export function findTrackingSnap({ tracking = [], reference = null, cursor, tolerance, entities = [], exclude = new Set(), polarOn = false, polarIncrement = 45, reach = 1e6 }) {
    if (!cursor) return null;
    const lines = buildLines({ tracking, reference, polarOn, polarIncrement });
    if (lines.length === 0) return null;
    const active = [];
    lines.forEach((line) => {
        const { point, ok } = projectOnTrackLine(line, cursor);
        if (!ok) return;
        const d = distance(point, cursor);
        if (d <= tolerance) active.push({ line, point, d });
    });
    if (active.length === 0) return null;

    const candidates = [];
    // Interseção entre linhas de rastreio ativas.
    for (let i = 0; i < active.length; i += 1) {
        for (let j = i + 1; j < active.length; j += 1) {
            const c1 = trackLineAsCurve(active[i].line, reach);
            const c2 = trackLineAsCurve(active[j].line, reach);
            intersectCurves(c1, c2).forEach((p) => {
                const d = distance(p, cursor);
                if (d <= tolerance) candidates.push({ mode: 'trkint', point: p, d, lines: [active[i].line, active[j].line] });
            });
        }
    }
    // Interseção entre linha de rastreio ativa e objetos próximos do cursor.
    const searchBox = { minX: cursor.x - tolerance * 2, minY: cursor.y - tolerance * 2, maxX: cursor.x + tolerance * 2, maxY: cursor.y + tolerance * 2 };
    const nearCurves = [];
    entities.forEach((entity) => {
        if (exclude.has(entity.id)) return;
        entityCurves(entity).forEach((curve) => {
            const box = curveBox(curve);
            const expanded = { minX: box.minX - tolerance, minY: box.minY - tolerance, maxX: box.maxX + tolerance, maxY: box.maxY + tolerance };
            if (boxesIntersect(expanded, searchBox) && distanceToCurve(cursor, curve) <= tolerance * 2) nearCurves.push(curve);
        });
    });
    active.forEach(({ line }) => {
        const trackCurve = trackLineAsCurve(line, reach);
        nearCurves.forEach((curve) => {
            intersectCurves(trackCurve, curve).forEach((p) => {
                const d = distance(p, cursor);
                if (d <= tolerance) candidates.push({ mode: 'trkint', point: p, d, lines: [line], weak: true });
            });
        });
    });
    // Projeção simples sobre a linha ativa (linhas do ponto de referência só com polar ligado).
    active.forEach(({ line, point, d }) => {
        if (line.source === 'reference' && !polarOn) return;
        candidates.push({ mode: line.source === 'ext' ? 'ext' : 'trk', point, d, lines: [line] });
    });
    if (candidates.length === 0) return { snap: null, lines: active.filter((a) => a.line.source !== 'reference' || polarOn).map((a) => a.line) };
    candidates.sort((a, b) => {
        const pa = SNAP_PRIORITY[a.mode] + (a.weak ? 0.25 : 0);
        const pb = SNAP_PRIORITY[b.mode] + (b.weak ? 0.25 : 0);
        if (pa !== pb) return pa - pb;
        return a.d - b.d;
    });
    const best = candidates[0];
    return { snap: { mode: best.mode, point: best.point, lines: best.lines }, lines: best.lines };
}

// Combina snap de objeto e snap de rastreio pela prioridade compartilhada; empate favorece o objeto.
export function mergeSnaps(objectSnap, trackingSnap) {
    if (!objectSnap) return trackingSnap ?? null;
    if (!trackingSnap) return objectSnap;
    const po = SNAP_PRIORITY[objectSnap.mode] ?? 9;
    const pt = SNAP_PRIORITY[trackingSnap.mode] ?? 9;
    return pt < po ? trackingSnap : objectSnap;
}

export { angleOf, cross };
