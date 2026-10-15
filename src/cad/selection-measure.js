// Medida rápida entre duas entidades selecionadas: as duas pontas mais próximas,
// com distância direta e componentes em X e Y. Só exibição, não cria cota no desenho.

import { entityCurves, curveEndpoints } from './geometry.js';

// Pontas de uma entidade: extremidades de linhas/arcos/polilinhas; círculos usam o centro.
export function measurePoints(entity) {
    const points = [];
    for (const curve of entityCurves(entity)) {
        if (curve.kind === 'circle') points.push(curve.center);
        else points.push(...curveEndpoints(curve));
    }
    return points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function selectionMeasure(entityA, entityB) {
    if (!entityA || !entityB) return null;
    const pa = measurePoints(entityA);
    const pb = measurePoints(entityB);
    let best = null;
    for (const a of pa) {
        for (const b of pb) {
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (!best || d < best.distance) best = { a, b, distance: d };
        }
    }
    if (!best) return null;
    return { ...best, dx: Math.abs(best.b.x - best.a.x), dy: Math.abs(best.b.y - best.a.y) };
}
