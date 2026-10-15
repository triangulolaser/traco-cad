// Medida rápida entre duas entidades selecionadas: o par de pontos mais próximo entre as duas geometrias
// (pode cair no meio de uma linha ou arco), com distância direta e componentes em X e Y.
// Só exibição, não cria cota no desenho.

import { entityCurves, curveEndpoints, closestPointOnCurve, intersectCurves } from './geometry.js';

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Candidatos ao mínimo entre duas curvas (segmento, arco, círculo). O mínimo entre curvas que não se cruzam
// sempre tem uma ponta de uma delas ou fica na reta que passa pelo centro de um arco/círculo.
function curvePairCandidates(c1, c2) {
    const out = [];
    for (const p of curveEndpoints(c1)) out.push([p, closestPointOnCurve(p, c2)]);
    for (const p of curveEndpoints(c2)) out.push([closestPointOnCurve(p, c1), p]);
    if (c2.kind !== 'segment') {
        const q = closestPointOnCurve(c2.center, c1);
        out.push([q, closestPointOnCurve(q, c2)]);
    }
    if (c1.kind !== 'segment') {
        const q = closestPointOnCurve(c1.center, c2);
        out.push([closestPointOnCurve(q, c1), q]);
    }
    for (const p of intersectCurves(c1, c2)) out.push([p, p]);
    return out;
}

export function selectionMeasure(entityA, entityB) {
    if (!entityA || !entityB) return null;
    const ca = entityCurves(entityA);
    const cb = entityCurves(entityB);
    let best = null;
    for (const c1 of ca) {
        for (const c2 of cb) {
            for (const [a, b] of curvePairCandidates(c1, c2)) {
                if (!a || !b || !Number.isFinite(a.x + a.y + b.x + b.y)) continue;
                const d = dist(a, b);
                if (!best || d < best.distance) best = { a, b, distance: d };
            }
        }
    }
    if (!best) return null;
    return { ...best, dx: Math.abs(best.b.x - best.a.x), dy: Math.abs(best.b.y - best.a.y) };
}
