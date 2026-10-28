// Object snaps: calcula o melhor ponto de snap próximo do cursor.

import {
    distance,
    entityCurves,
    curveEndpoints,
    curveMidpoint,
    curveCenter,
    curveQuadrants,
    intersectCurves,
    perpendicularFoot,
    tangentPoints,
    commonTangents,
    closestPointOnCurve,
    distanceToCurve,
    curveBox,
    boxesIntersect,
    entityProvider,
} from './geometry.js';

export const SNAP_ICONS = {
    end: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="0.5" /></svg>',
    mid: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><polygon points="8,2.2 14.5,13.8 1.5,13.8" /></svg>',
    cen: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /></svg>',
    int: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="2.8" y1="2.8" x2="13.2" y2="13.2" /><line x1="13.2" y1="2.8" x2="2.8" y2="13.2" /></svg>',
    qua: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><polygon points="8,1.8 14.2,8 8,14.2 1.8,8" /></svg>',
    per: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M 2.5,2.5 L 2.5,13.5 L 13.5,13.5 M 2.5,8 L 8,8 L 8,13.5" /></svg>',
    tan: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="2.2" y1="2.8" x2="13.8" y2="2.8" /><circle cx="8" cy="8.6" r="5.2" /></svg>',
    nea: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M 2.5,2.5 L 13.5,2.5 L 2.5,13.5 L 13.5,13.5 Z" /></svg>',
    gcen: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /><line x1="8" y1="4.6" x2="8" y2="11.4" /><line x1="4.6" y1="8" x2="11.4" y2="8" /></svg>',
    nod: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6" /><line x1="4.2" y1="4.2" x2="11.8" y2="11.8" /><line x1="11.8" y1="4.2" x2="4.2" y2="11.8" /></svg>',
};

export function snapIconSvg(key) {
    return SNAP_ICONS[key] || '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" /></svg>';
}

export const SNAP_MODES = [
    { key: 'end', label: 'Ponto final', short: 'END', priority: 1, svg: SNAP_ICONS.end },
    { key: 'mid', label: 'Ponto médio', short: 'MID', priority: 2, svg: SNAP_ICONS.mid },
    { key: 'cen', label: 'Centro', short: 'CEN', priority: 3, svg: SNAP_ICONS.cen },
    { key: 'gcen', label: 'Centro geométrico', short: 'GCEN', priority: 3, svg: SNAP_ICONS.gcen },
    { key: 'int', label: 'Interseção', short: 'INT', priority: 1, svg: SNAP_ICONS.int },
    { key: 'qua', label: 'Quadrante', short: 'QUA', priority: 3, svg: SNAP_ICONS.qua },
    { key: 'per', label: 'Perpendicular', short: 'PER', priority: 4, svg: SNAP_ICONS.per },
    { key: 'tan', label: 'Tangente', short: 'TAN', priority: 4, svg: SNAP_ICONS.tan },
    { key: 'nea', label: 'Mais próximo', short: 'NEA', priority: 6, svg: SNAP_ICONS.nea },
];

export function defaultSnapSettings() {
    // NEA, TAN e QUA ligados junto com os demais.
    return { end: true, mid: true, cen: true, gcen: true, int: true, qua: true, per: true, tan: true, nea: true };
}

function within(p, cursor, tol) {
    return distance(p, cursor) <= tol;
}

// entities: lista visível; cursor: ponto de mundo; tolerance: em unidades de mundo.
// reference: ponto de origem do segmento em construção (para PER/TAN).
export function findSnap(entities, cursor, tolerance, settings, { reference = null, exclude = new Set() } = {}) {
    const candidates = [];
    const searchBox = { minX: cursor.x - tolerance, minY: cursor.y - tolerance, maxX: cursor.x + tolerance, maxY: cursor.y + tolerance };
    const nearCurves = [];

    entities.forEach((entity) => {
        if (exclude.has(entity.id)) return;
        const provider = entityProvider(entity.type);
        if (provider?.snapPoints) {
            // Elipse, spline e imagem entregam os próprios pontos notáveis (centro, quadrantes, extremos, nós).
            provider.snapPoints(entity).forEach(({ mode, point }) => {
                const key = mode === 'nod' ? 'end' : mode;
                if (!settings[key]) return;
                const tol = mode === 'cen' ? tolerance * 1.5 : tolerance;
                if (within(point, cursor, tol)) candidates.push({ mode: key, point, entity });
            });
        }
        if (entity.type === 'point') {
            const p = entity.position ?? entity.point;
            if (p && (settings.nod || settings.end) && within(p, cursor, tolerance)) {
                candidates.push({ mode: 'nod', point: p, entity });
            }
        }
        if (settings.gcen) {
            // GCEN (BricsCAD): centroide da área de polilinha fechada; vale com o cursor perto dele.
            const g = geometricCenter(entity);
            if (g && within(g, cursor, tolerance * 1.5)) candidates.push({ mode: 'gcen', point: g, entity });
        }
        entityCurves(entity).forEach((curve) => {
            const box = curveBox(curve);
            const expanded = { minX: box.minX - tolerance, minY: box.minY - tolerance, maxX: box.maxX + tolerance, maxY: box.maxY + tolerance };
            if (!boxesIntersect(expanded, searchBox)) return;
            // Só considera curvas realmente próximas do cursor para END/MID/QUA; centro pode ficar longe da borda.
            const near = distanceToCurve(cursor, curve) <= tolerance * 2;
            if (near) nearCurves.push({ curve, entity });

            if (settings.end && near && !curve.approx) curveEndpoints(curve).forEach((p) => within(p, cursor, tolerance) && candidates.push({ mode: 'end', point: p, entity }));
            if (settings.mid && near && !curve.approx) {
                const m = curveMidpoint(curve);
                if (m && within(m, cursor, tolerance)) candidates.push({ mode: 'mid', point: m, entity });
            }
            if (settings.cen) {
                // Centro só quando o cursor está perto do próprio centro (área um pouco maior que a de snap).
                // Passar sobre a circunferência não puxa mais para o centro quando NEA está ligado.
                const c = curveCenter(curve);
                if (c) {
                    if (within(c, cursor, tolerance * 1.5)) candidates.push({ mode: 'cen', point: c, entity });
                    else if (!settings.nea && near && curve.kind === 'circle') candidates.push({ mode: 'cen', point: c, entity, weak: true });
                }
            }
            if (settings.qua && near) curveQuadrants(curve).forEach((p) => within(p, cursor, tolerance) && candidates.push({ mode: 'qua', point: p, entity }));
            if (settings.per && reference && near) {
                const foot = perpendicularFoot(reference, curve);
                if (foot && within(foot, cursor, tolerance)) candidates.push({ mode: 'per', point: foot, entity });
            }
            if (settings.tan && reference && near) {
                tangentPoints(reference, curve).forEach((p) => within(p, cursor, tolerance) && candidates.push({ mode: 'tan', point: p, entity }));
            }
        });
    });

    if (settings.int) {
        for (let i = 0; i < nearCurves.length; i += 1) {
            for (let j = i + 1; j < nearCurves.length; j += 1) {
                // Segmentos de aproximação vizinhos da mesma elipse/spline "se cruzam" no vértice comum: não é interseção.
                if (nearCurves[i].curve.approx && nearCurves[j].curve.approx && nearCurves[i].entity === nearCurves[j].entity) continue;
                intersectCurves(nearCurves[i].curve, nearCurves[j].curve).forEach((p) => {
                    if (within(p, cursor, tolerance)) candidates.push({ mode: 'int', point: p, entity: nearCurves[i].entity });
                });
            }
        }
    }

    if (settings.nea && candidates.every((c) => c.weak) && nearCurves.length > 0) {
        let best = null;
        nearCurves.forEach(({ curve, entity }) => {
            const p = closestPointOnCurve(cursor, curve);
            const d = distance(p, cursor);
            if (d <= tolerance && (!best || d < best.d)) best = { mode: 'nea', point: p, entity, d };
        });
        if (best) candidates.push(best);
    }

    if (candidates.length === 0) return null;
    const priority = Object.fromEntries(SNAP_MODES.map((m) => [m.key, m.priority]));
    candidates.sort((a, b) => {
        const pa = priority[a.mode] + (a.weak ? 10 : 0);
        const pb = priority[b.mode] + (b.weak ? 10 : 0);
        if (pa !== pb) return pa - pb;
        return distance(a.point, cursor) - distance(b.point, cursor);
    });
    return candidates[0];
}

// Snap digitado no prompt de ponto (TAN, END, PER...), como no AutoCAD/BricsCAD: vale só para o
// próximo ponto, ignora os snaps ligados e funciona mesmo com OSNAP desligado.
export const SNAP_OVERRIDE_PROMPTS = {
    end: 'Snap para ponto final de:',
    mid: 'Snap para ponto médio de:',
    cen: 'Snap para centro de:',
    gcen: 'Snap para centro geométrico de:',
    int: 'Snap para interseção de:',
    qua: 'Snap para quadrante de:',
    per: 'Snap para perpendicular de:',
    tan: 'Snap para tangente de:',
    nea: 'Snap para mais próximo de:',
    nod: 'Snap para nó de:',
};

export function parseSnapOverride(text) {
    const key = String(text ?? '').trim().toLowerCase().replace(/^_/, '');
    return Object.hasOwn(SNAP_OVERRIDE_PROMPTS, key) ? key : null;
}

function roundCurvesNear(entities, cursor, tolerance, exclude) {
    const out = [];
    entities.forEach((entity) => {
        if (exclude.has(entity.id)) return;
        entityCurves(entity).forEach((curve) => {
            if (curve.kind === 'segment' || curve.approx) return;
            const d = distanceToCurve(cursor, curve);
            if (d <= tolerance) out.push({ curve, entity, d });
        });
    });
    return out.sort((x, y) => x.d - y.d);
}

// Ponto do override. TAN sem ponto anterior devolve `deferred` ("tangente ajustada"): o ponto real
// só se define quando o próximo ponto chega. Com `deferred` vindo do ponto anterior, TAN em outro
// círculo dá a reta tangente aos dois (`tangentFrom` é o ponto sobre o primeiro).
export function findOverrideSnap(entities, cursor, tolerance, mode, { reference = null, deferred = null, exclude = new Set() } = {}) {
    if (mode !== 'tan') {
        const settings = mode === 'nod' ? { nod: true, end: false } : { [mode]: true };
        return findSnap(entities, cursor, tolerance, settings, { reference, exclude });
    }
    const near = roundCurvesNear(entities, cursor, tolerance, exclude);
    if (deferred) {
        let best = null;
        near.forEach(({ curve, entity }) => {
            commonTangents(deferred.curve, curve).forEach(({ a, b }) => {
                const score = distance(a, deferred.pick) + distance(b, cursor);
                if (!best || score < best.score) best = { mode: 'tan', point: b, entity, tangentFrom: a, score };
            });
        });
        if (best) return best;
        // Cursor sobre o próprio círculo ajustado ou fora de qualquer círculo: sem tangente comum.
        return null;
    }
    if (reference) {
        let best = null;
        near.forEach(({ curve, entity }) => {
            tangentPoints(reference, curve).forEach((p) => {
                const d = distance(p, cursor);
                if (!best || d < best.d) best = { mode: 'tan', point: p, entity, d };
            });
        });
        return best;
    }
    if (near.length === 0) return null;
    const { curve, entity } = near[0];
    const point = closestPointOnCurve(cursor, curve);
    return { mode: 'tan', point, entity, deferred: { curve, entity, pick: point } };
}

// Ponto de tangência sobre o círculo ajustado visto de p: o do lado escolhido no clique.
export function resolveDeferredTangent(deferred, p) {
    let best = null;
    tangentPoints(p, deferred.curve).forEach((q) => {
        const d = distance(q, deferred.pick);
        if (!best || d < best.d) best = { point: q, d };
    });
    return best?.point ?? null;
}

// Centros de arcos/círculos/elipses sob o cursor: a borda não puxa o snap, mas o centro
// passa a aparecer como referência para o usuário levar o cursor até ele.
export function findCenterHints(entities, cursor, tolerance, settings, { exclude = new Set() } = {}) {
    if (!settings?.cen && !settings?.gcen) return [];
    const hints = [];
    entities.forEach((entity) => {
        if (exclude.has(entity.id)) return;
        const curves = entityCurves(entity);
        if (!curves.some((curve) => distanceToCurve(cursor, curve) <= tolerance)) return;
        if (settings.gcen) {
            // Passar pela borda da polilinha fechada revela o centro geométrico, como no BricsCAD.
            const g = geometricCenter(entity);
            if (g) hints.push({ point: g, entity, mode: 'gcen' });
        }
        if (!settings.cen) return;
        const provider = entityProvider(entity.type);
        if (provider?.snapPoints) {
            provider.snapPoints(entity).forEach(({ mode, point }) => mode === 'cen' && hints.push({ point, entity }));
            return;
        }
        curves.forEach((curve) => {
            const c = curveCenter(curve);
            if (c && !curve.approx && !hints.some((h) => distance(h.point, c) < 1e-9)) hints.push({ point: c, entity });
        });
    });
    return hints;
}

// Centroide da área de uma polilinha fechada (com bulges). Null para aberta ou área nula.
export function geometricCenter(entity) {
    if (!entity || !['polyline', 'lwpolyline'].includes(entity.type) || !entity.closed) return null;
    const v = entity.vertices || [];
    if (v.length < 2) return null;
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < v.length; i += 1) {
        const a = v[i];
        const b = v[(i + 1) % v.length];
        const cross = a.x * b.y - b.x * a.y;
        area += cross / 2;
        cx += ((a.x + b.x) * cross) / 6;
        cy += ((a.y + b.y) * cross) / 6;
        const bulge = a.bulge ?? 0;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const chord = Math.hypot(dx, dy);
        if (!bulge || chord < 1e-12) continue;
        // Segmento circular entre a corda e o arco; bulge > 0 (anti-horário) fica à direita de a→b.
        const theta = 4 * Math.atan(Math.abs(bulge));
        const r = chord / (2 * Math.sin(theta / 2));
        const segArea = (r * r * (theta - Math.sin(theta))) / 2;
        const side = Math.sign(bulge);
        const ux = (dy / chord) * side;
        const uy = (-dx / chord) * side;
        const sagitta = (Math.abs(bulge) * chord) / 2;
        const center = { x: (a.x + b.x) / 2 + ux * (sagitta - r), y: (a.y + b.y) / 2 + uy * (sagitta - r) };
        const d = (4 * r * Math.sin(theta / 2) ** 3) / (3 * (theta - Math.sin(theta)));
        const signed = segArea * side;
        area += signed;
        cx += (center.x + ux * d) * signed;
        cy += (center.y + uy * d) * signed;
    }
    if (Math.abs(area) < 1e-12) return null;
    return { x: cx / area, y: cy / area };
}

// Orto: projeta o cursor no eixo dominante a partir do ponto de referência.
export function applyOrtho(reference, cursor) {
    if (!reference) return cursor;
    const dx = cursor.x - reference.x;
    const dy = cursor.y - reference.y;
    return Math.abs(dx) >= Math.abs(dy) ? { x: cursor.x, y: reference.y } : { x: reference.x, y: cursor.y };
}

// Polar tracking: alinha a incrementos de ângulo quando o cursor está perto de um deles.
export function applyPolar(reference, cursor, incrementDeg, toleranceDeg = 3) {
    if (!reference) return cursor;
    const dx = cursor.x - reference.x;
    const dy = cursor.y - reference.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return cursor;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const step = incrementDeg;
    const nearest = Math.round(angle / step) * step;
    if (Math.abs(angle - nearest) > toleranceDeg) return cursor;
    const rad = (nearest * Math.PI) / 180;
    return { x: reference.x + Math.cos(rad) * dist, y: reference.y + Math.sin(rad) * dist };
}

// Shift: trava a linha na direção de 45° mais próxima (horizontal, vertical ou diagonal), projetando o cursor no eixo.
export function applyAngleLock(reference, cursor, incrementDeg = 45) {
    if (!reference || !cursor) return cursor;
    const dx = cursor.x - reference.x;
    const dy = cursor.y - reference.y;
    if (dx === 0 && dy === 0) return cursor;
    const step = (incrementDeg * Math.PI) / 180;
    const rad = Math.round(Math.atan2(dy, dx) / step) * step;
    const ux = Math.round(Math.cos(rad) * 1e12) / 1e12;
    const uy = Math.round(Math.sin(rad) * 1e12) / 1e12;
    const t = dx * ux + dy * uy;
    return { x: reference.x + ux * t, y: reference.y + uy * t };
}

export function findSoftAxis(reference, cursor, tolerance, angleTolerance = 5) {
    if (!reference || !cursor || !(tolerance > 0)) return null;
    const dx=cursor.x-reference.x,dy=cursor.y-reference.y;
    const major=Math.max(Math.abs(dx),Math.abs(dy)),minor=Math.min(Math.abs(dx),Math.abs(dy));
    if(major<1e-9 || minor>tolerance || Math.atan2(minor,major)*180/Math.PI>angleTolerance)return null;
    const horizontal=Math.abs(dx)>=Math.abs(dy);
    return {point:horizontal?{x:cursor.x,y:reference.y}:{x:reference.x,y:cursor.y},axis:horizontal?'horizontal':'vertical',angle:horizontal?0:Math.PI/2};
}
