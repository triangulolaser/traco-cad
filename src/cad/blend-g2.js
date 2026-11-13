// Concordância Universal Rolling-Ball G¹, Chanfro Geodésico Universal, Curvas de Transição
// (Blend Curve / Fillet G² com Bézier Quíntica de Curvatura Contínua) e Extensão Analítica
// para Retas, Arcos, Elipses, Polilinhas e Splines NURBS.

import {
    add,
    sub,
    scale,
    dot,
    cross,
    distance,
    midpoint,
    polar,
    angleOf,
    normalizeAngle,
    sweepCCW,
    normalize,
    entityCurves,
    intersectCurves,
    closestPointOnCurve,
    splitEntityAt,
    curveLength,
    polylineCurves,
} from './geometry.js';
import { sweepToBulgeRational } from './predicates.js';
import {
    evalBezierJet,
    evaluateSplineJet,
    bezierPointAtDistance,
    closestPointOnBezier,
} from './nurbs-exact.js';
import {
    evalEllipseJet,
    closestPointOnEllipse,
    ellipsePointAtDistance,
} from './curve-intersect.js';
import { interpolateSpline } from './splines.js';

const TWO_PI = Math.PI * 2;
const ellipseIsFull = (e) => Math.abs((e.end ?? TWO_PI) - (e.start ?? 0)) >= TWO_PI - 1e-6;
function ensureSplineGeometry(entity) {
    if (entity.controlPoints?.length >= 2) {
        const n = entity.controlPoints.length;
        const p = Math.min(entity.degree ?? 3, n - 1);
        if (entity.knots?.length >= n + p + 1) return entity.degree === p ? entity : { ...entity, degree: p };
        const spans = n - p;
        const knots = [
            ...new Array(p + 1).fill(0),
            ...Array.from({ length: Math.max(0, spans - 1) }, (_, i) => (i + 1) / spans),
            ...new Array(p + 1).fill(1),
        ];
        return { ...entity, degree: p, knots };
    }
    const fit = entity.fitPoints?.length >= 2 ? entity.fitPoints : (entity.points?.length >= 2 ? entity.points : null);
    if (fit) {
        const sp = interpolateSpline(fit, { closed: Boolean(entity.closed) });
        if (sp) return { ...entity, ...sp };
    }
    return entity;
}

function unitVec(v) {
    const len = Math.hypot(v.x, v.y);
    return len > 1e-15 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
}

// ---------------------------------------------------------------------------
// 1. Bézier Quíntica G² (Continuidade de Posição, Tangente e Curvatura κ)
// ---------------------------------------------------------------------------

// Constrói uma curva de Bézier quíntica (grau 5, 6 pontos de controle P0..P5) como entidade SPLINE
// que interpola exatamente:
// - Posição inicial P0, vetor tangente unitário de partida T1 e curvatura assinada κ1 em u = 0
// - Posição final P5, vetor tangente unitário de chegada T2 e curvatura assinada κ2 em u = 1
// Os comprimentos de velocidade (α1, α2) e acelerações tangenciais (β1, β2) minimizam a variação de jerk.
export function createQuinticBlendG2(arg1, arg2, arg3, arg4, arg5, arg6, arg7 = {}) {
    const isJetForm = Boolean(arg1?.point && arg2?.point);
    const p0 = isJetForm ? arg1.point : arg1;
    const t1 = isJetForm ? (arg1.tangent ?? arg1.d1) : arg2;
    const k1 = isJetForm ? (arg1.curvature ?? 0) : arg3;
    const p5 = isJetForm ? arg2.point : arg4;
    const t2 = isJetForm ? (arg2.tangent ?? arg2.d1) : arg5;
    const k2 = isJetForm ? (arg2.curvature ?? 0) : arg6;
    const options = (isJetForm ? arg3 : arg7) ?? {};
    const chord = distance(p0, p5);
    if (chord < 1e-12) return null;

    const u1 = unitVec(t1);
    const u2 = unitVec(t2);
    const n1 = { x: -u1.y, y: u1.x };
    const n2 = { x: -u2.y, y: u2.x };

    const chordDir = scale(sub(p5, p0), 1 / chord);
    const cos1 = Math.max(0.25, dot(u1, chordDir));
    const cos2 = Math.max(0.25, dot(u2, chordDir));
    const tension = options.tension ?? 1.0;

    // Velocidades terminais ótimas baseadas no ângulo de deflexão de Hermite-Schaback
    const alpha1 = tension * (chord / (0.65 + 0.35 * cos1));
    const alpha2 = tension * (chord / (0.65 + 0.35 * cos2));

    const P0 = { x: p0.x, y: p0.y };
    const P5 = { x: p5.x, y: p5.y };
    const P1 = add(P0, scale(u1, alpha1 / 5));
    const P4 = sub(P5, scale(u2, alpha2 / 5));

    // P2(β1) = P2_0 + (β1/20)*u1 e P3(β2) = P3_0 + (β2/20)*u2
    // onde P2_0 e P3_0 fixam exatamente κ(0) = k1 e κ(1) = k2!
    const P2Base = add(sub(scale(P1, 2), P0), scale(n1, (k1 * alpha1 * alpha1) / 20));
    const P3Base = add(sub(scale(P4, 2), P5), scale(n2, (k2 * alpha2 * alpha2) / 20));

    // Minimização analítica de ∫ ||B'''(u)||^2 du em relação a (b1 = β1/20, b2 = β2/20):
    // B'''(u) depende da diferença central P3 - P2 = (P3Base - P2Base) + b2*u2 - b1*u1.
    // Projeta uma fração suave do salto residual sobre u1 e u2 mantendo κ(0)=k1 e κ(1)=k2 intactos!
    const gap = sub(P3Base, P2Base);
    const b1 = 0.25 * dot(gap, u1);
    const b2 = -0.25 * dot(gap, u2);

    const P2 = add(P2Base, scale(u1, b1));
    const P3 = add(P3Base, scale(u2, b2));

    const controlPoints = [P0, P1, P2, P3, P4, P5];
    const knots = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];

    return {
        type: 'spline',
        degree: 5,
        knots,
        controlPoints,
        closed: false,
        layer: options.layer ?? '0',
        ...(options.color ? { color: options.color } : {}),
    };
}

// Avalia o jato diferencial (ponto, tangente unitária e curvatura assinada κ) de uma entidade
// na extremidade mais próxima de `pickPoint` (ou em um ponto arbitrário sobre a entidade).
export function entityDifferentialJetAt(entity, targetPoint, { orientLeaving = false } = {}) {
    if (entity.type === 'line') {
        const dir = unitVec(sub(entity.end, entity.start));
        const nearEnd = distance(targetPoint, entity.end) <= distance(targetPoint, entity.start);
        const pt = closestPointOnCurve(targetPoint, { kind: 'segment', a: entity.start, b: entity.end });
        // Se orientLeaving=true, na ponta `end` a tangente que sai da linha segue +dir; na ponta `start` segue -dir.
        const sign = orientLeaving ? (nearEnd ? 1 : -1) : 1;
        return {
            point: pt,
            tangent: scale(dir, sign),
            curvature: 0,
            nearEnd,
        };
    }
    if (entity.type === 'arc' || entity.type === 'circle') {
        const pStart = polar(entity.center, entity.start ?? 0, entity.radius);
        const pEnd = polar(entity.center, entity.end ?? TWO_PI, entity.radius);
        const nearEnd = distance(targetPoint, pEnd) <= distance(targetPoint, pStart);
        const ang = angleOf(entity.center, targetPoint);
        const pt = polar(entity.center, ang, entity.radius);
        const tCCW = { x: -Math.sin(ang), y: Math.cos(ang) };
        const sign = orientLeaving ? (nearEnd ? 1 : -1) : 1;
        return {
            point: pt,
            tangent: scale(tCCW, sign),
            curvature: sign / entity.radius,
            nearEnd,
        };
    }
    if (entity.type === 'ellipse') {
        const curve = {
            kind: 'ellipse',
            center: entity.center,
            major: entity.major,
            ratio: entity.ratio,
            start: entity.start ?? 0,
            end: entity.end ?? TWO_PI,
            full: ellipseIsFull(entity),
        };
        const cp = closestPointOnEllipse(curve, targetPoint);
        const jet = evalEllipseJet(curve, cp.t);
        const pStart = evalEllipseJet(curve, curve.start).point;
        const pEnd = evalEllipseJet(curve, curve.end).point;
        const nearEnd = distance(targetPoint, pEnd) <= distance(targetPoint, pStart);
        const sign = orientLeaving ? (nearEnd ? 1 : -1) : 1;
        return {
            point: jet.point,
            tangent: scale(unitVec(jet.d1), sign),
            curvature: sign * jet.curvature,
            nearEnd,
        };
    }
    if (entity.type === 'spline') {
        const sp = ensureSplineGeometry(entity);
        const beziers = entityCurves(sp).filter((c) => c.kind === 'bezier');
        let best = null;
        for (const bz of beziers) {
            const hit = closestPointOnBezier(bz, targetPoint);
            if (!best || hit.dist < best.dist) {
                const t0 = bz.t0 ?? 0;
                const t1 = bz.t1 ?? 1;
                best = { dist: hit.dist, u: t0 + hit.t * (t1 - t0) };
            }
        }
        const tMin = sp.knots[sp.degree];
        const tMax = sp.knots[sp.controlPoints.length];
        const u = best ? best.u : tMax;
        const jet = evaluateSplineJet(sp, u);
        const pStart = evaluateSplineJet(sp, tMin).point;
        const pEnd = evaluateSplineJet(sp, tMax).point;
        const nearEnd = distance(targetPoint, pEnd) <= distance(targetPoint, pStart);
        const sign = orientLeaving ? (nearEnd ? 1 : -1) : 1;
        return {
            point: jet.point,
            tangent: scale(unitVec(jet.d1), sign),
            curvature: sign * jet.curvature,
            nearEnd,
        };
    }
    if (entity.type === 'polyline') {
        const curves = polylineCurves(entity.vertices, entity.closed);
        const pStart = entity.vertices[0];
        const pEnd = entity.vertices[entity.vertices.length - 1];
        const nearEnd = distance(targetPoint, pEnd) <= distance(targetPoint, pStart);
        const c = nearEnd ? curves[curves.length - 1] : curves[0];
        const subEnt = c.kind === 'segment'
            ? { type: 'line', start: c.a, end: c.b }
            : { type: 'arc', center: c.center, radius: c.radius, start: c.start, end: c.end };
        return entityDifferentialJetAt(subEnt, nearEnd ? pEnd : pStart, { orientLeaving });
    }
    return null;
}

// Comando BLEND (Conectar Curvas com Continuidade G²):
// Conecta as extremidades de `e1` (próxima a `p1`) e `e2` (próxima a `p2`) com uma Bézier quíntica G².
export function blendEntitiesG2(e1, p1, e2, p2) {
    const j1 = entityDifferentialJetAt(e1, p1, { orientLeaving: true });
    const j2 = entityDifferentialJetAt(e2, p2, { orientLeaving: true });
    if (!j1 || !j2) return null;

    // Em j1 a curva blend parte de j1.point na direção j1.tangent (curvatura j1.curvature).
    // Em j2 a curva blend chega em j2.point na direção OPOSTA à tangente que sai de e2 (-j2.tangent),
    // invertendo também o sinal da curvatura assinada (-j2.curvature).
    const tArrive2 = scale(j2.tangent, -1);
    const kArrive2 = -j2.curvature;

    return createQuinticBlendG2(
        j1.point,
        j1.tangent,
        j1.curvature,
        j2.point,
        tArrive2,
        kArrive2,
        { layer: e1.layer, color: e1.color },
    );
}

// ---------------------------------------------------------------------------
// 2. Rolling-Ball Fillet Universal G¹ & Fillet G² sobre Curvas Arbitrárias
// ---------------------------------------------------------------------------

// Avalia uma curva primitiva parametrizada em s ∈ [0, 1] com jato de 1ª e 2ª ordem em relação a s.
function evalCurveJetNormalized(curve, s) {
    if (curve.kind === 'segment') {
        const dx = curve.b.x - curve.a.x;
        const dy = curve.b.y - curve.a.y;
        return {
            point: { x: curve.a.x + s * dx, y: curve.a.y + s * dy },
            d1: { x: dx, y: dy },
            d2: { x: 0, y: 0 },
            curvature: 0,
        };
    }
    if (curve.kind === 'arc' || curve.kind === 'circle') {
        const start = curve.kind === 'circle' ? 0 : curve.start;
        const sweep = curve.kind === 'circle' ? TWO_PI : sweepCCW(curve.start, curve.end);
        const theta = start + s * sweep;
        const c = Math.cos(theta);
        const sn = Math.sin(theta);
        const r = curve.radius;
        return {
            point: { x: curve.center.x + r * c, y: curve.center.y + r * sn },
            d1: { x: -r * sweep * sn, y: r * sweep * c },
            d2: { x: -r * sweep * sweep * c, y: -r * sweep * sweep * sn },
            curvature: 1 / r,
        };
    }
    if (curve.kind === 'ellipse') {
        const start = curve.full ? 0 : (curve.start ?? 0);
        const sweep = curve.full ? TWO_PI : sweepCCW(start, curve.end ?? TWO_PI);
        const theta = start + s * sweep;
        const jet = evalEllipseJet(curve, theta);
        return {
            point: jet.point,
            d1: { x: jet.d1.x * sweep, y: jet.d1.y * sweep },
            d2: { x: jet.d2.x * sweep * sweep, y: jet.d2.y * sweep * sweep },
            curvature: jet.curvature,
        };
    }
    if (curve.kind === 'bezier') {
        return evalBezierJet(curve, s);
    }
    if (curve.kind === 'spline') {
        const sp = curve.spline;
        const tMin = sp.knots[sp.degree];
        const tMax = sp.knots[sp.controlPoints.length];
        const span = tMax - tMin;
        const u = tMin + Math.max(0, Math.min(1, s)) * span;
        const jet = evaluateSplineJet(sp, u);
        return {
            point: jet.point,
            d1: { x: jet.d1.x * span, y: jet.d1.y * span },
            d2: { x: jet.d2.x * span * span, y: jet.d2.y * span * span },
            curvature: jet.curvature,
        };
    }
    return null;
}

function closestNormalizedParam(curve, p) {
    let bestS = 0.5;
    let bestD = Infinity;
    const N = 24;
    for (let i = 0; i <= N; i += 1) {
        const s = i / N;
        const jet = evalCurveJetNormalized(curve, s);
        const d = distance(p, jet.point);
        if (d < bestD) {
            bestD = d;
            bestS = s;
        }
    }
    for (let it = 0; it < 8; it += 1) {
        const jet = evalCurveJetNormalized(curve, bestS);
        const rx = jet.point.x - p.x;
        const ry = jet.point.y - p.y;
        const f = rx * jet.d1.x + ry * jet.d1.y;
        const df = (jet.d1.x * jet.d1.x + jet.d1.y * jet.d1.y) + (rx * jet.d2.x + ry * jet.d2.y);
        if (Math.abs(df) <= 1e-15) break;
        bestS = Math.min(1.5, Math.max(-0.5, bestS - f / df));
    }
    return bestS;
}

function resolvePrimitiveCurve(curveOrEntity, pickPoint) {
    if (!curveOrEntity) return null;
    if (curveOrEntity.kind) return curveOrEntity;
    if (curveOrEntity.type === 'spline') {
        const sp = ensureSplineGeometry(curveOrEntity);
        return { kind: 'spline', spline: sp, subCurves: entityCurves(sp) };
    }
    const curves = entityCurves(curveOrEntity);
    if (!curves || curves.length === 0) return null;
    let best = curves[0];
    let bestD = Infinity;
    for (const c of curves) {
        const d = distance(pickPoint, closestPointOnCurve(pickPoint, c));
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}

// Solucionador de bola rolante (Rolling-Ball Fillet) de raio `radius` entre duas curvas (ou entidades) quaisquer
// próximas aos cliques `p1` e `p2`. Retorna `{ center, t1, t2, u, v }` onde t1 e t2 são os pontos de tangência.
export function solveRollingBallFillet(rawCurve1, p1, rawCurve2, p2, radius) {
    const curve1 = resolvePrimitiveCurve(rawCurve1, p1);
    const curve2 = resolvePrimitiveCurve(rawCurve2, p2);
    if (!curve1 || !curve2) return null;

    const s1Seed = closestNormalizedParam(curve1, p1);
    const s2Seed = closestNormalizedParam(curve2, p2);
    const j1Ref = evalCurveJetNormalized(curve1, s1Seed);
    const j2Ref = evalCurveJetNormalized(curve2, s2Seed);

    const n1Ref = unitVec({ x: -j1Ref.d1.y, y: j1Ref.d1.x });
    const n2Ref = unitVec({ x: -j2Ref.d1.y, y: j2Ref.d1.x });

    // Coleta pares iniciais (u0, v0): cliques do usuário, interseções das curvas e aproximação mínima em grade
    const uvSeeds = [[s1Seed, s2Seed]];
    const prims1 = curve1.subCurves ?? [curve1];
    const prims2 = curve2.subCurves ?? [curve2];
    const corners = prims1.flatMap((a) => prims2.flatMap((b) => intersectCurves(a, b, { extend1: true, extend2: true })));
    for (const cPt of corners) {
        const pt = cPt.point ?? cPt;
        const uCorner = closestNormalizedParam(curve1, pt);
        const vCorner = closestNormalizedParam(curve2, pt);
        uvSeeds.push([uCorner, vCorner]);
        // Também deslocado levemente em direção aos cliques p1 e p2
        uvSeeds.push([0.7 * uCorner + 0.3 * s1Seed, 0.7 * vCorner + 0.3 * s2Seed]);
    }
    let bestGridPair = null;
    let bestGridDist = Infinity;
    for (let i = 0; i <= 8; i += 1) {
        const uG = i / 8;
        const pU = evalCurveJetNormalized(curve1, uG).point;
        for (let j = 0; j <= 8; j += 1) {
            const vG = j / 8;
            const pV = evalCurveJetNormalized(curve2, vG).point;
            const d = Math.abs(distance(pU, pV) - radius * 1.4);
            if (d < bestGridDist) {
                bestGridDist = d;
                bestGridPair = [uG, vG];
            }
        }
    }
    if (bestGridPair) uvSeeds.push(bestGridPair);

    // Testa os 4 sinais possíveis (sign1, sign2) ∈ {-1, +1}^2 e escolhe o centro mais próximo dos cliques
    const signPairs = [
        [dot(sub(p2, j1Ref.point), n1Ref) >= 0 ? 1 : -1, dot(sub(p1, j2Ref.point), n2Ref) >= 0 ? 1 : -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ];

    let bestSolution = null;
    const pickMid = midpoint(p1, p2);

    for (const [uStart, vStart] of uvSeeds) {
        for (const [sg1, sg2] of signPairs) {
            let u = uStart;
            let v = vStart;
            for (let it = 0; it < 20; it += 1) {
                const j1 = evalCurveJetNormalized(curve1, u);
                const j2 = evalCurveJetNormalized(curve2, v);
                const sp1 = Math.hypot(j1.d1.x, j1.d1.y);
                const sp2 = Math.hypot(j2.d1.x, j2.d1.y);
                if (sp1 <= 1e-12 || sp2 <= 1e-12) break;

                const n1 = { x: -j1.d1.y / sp1, y: j1.d1.x / sp1 };
                const n2 = { x: -j2.d1.y / sp2, y: j2.d1.x / sp2 };

                const o1 = add(j1.point, scale(n1, sg1 * radius));
                const o2 = add(j2.point, scale(n2, sg2 * radius));
                const fx = o1.x - o2.x;
                const fy = o1.y - o2.y;
                if (Math.hypot(fx, fy) <= 1e-12 * Math.max(1, radius)) break;

                // Derivada ∂O(u)/∂u = (1 - sg * R * κ) * C'(u)
                const f1 = 1 - sg1 * radius * j1.curvature;
                const f2 = 1 - sg2 * radius * j2.curvature;
                const a00 = f1 * j1.d1.x;
                const a10 = f1 * j1.d1.y;
                const a01 = -f2 * j2.d1.x;
                const a11 = -f2 * j2.d1.y;
                const det = a00 * a11 - a01 * a10;
                if (Math.abs(det) <= 1e-14) break;

                let du = (fx * a11 - fy * a01) / det;
                let dv = (a00 * fy - a10 * fx) / det;
                const stepLen = Math.hypot(du, dv);
                if (stepLen > 0.2) {
                    const scaleFactor = 0.2 / stepLen;
                    du *= scaleFactor;
                    dv *= scaleFactor;
                }
                u = Math.max(-0.5, Math.min(1.5, u - du));
                v = Math.max(-0.5, Math.min(1.5, v - dv));
                if (Math.abs(du) <= 1e-14 && Math.abs(dv) <= 1e-14) break;
            }

            const j1 = evalCurveJetNormalized(curve1, u);
            const j2 = evalCurveJetNormalized(curve2, v);
            const sp1 = Math.hypot(j1.d1.x, j1.d1.y);
            const sp2 = Math.hypot(j2.d1.x, j2.d1.y);
            if (sp1 <= 1e-12 || sp2 <= 1e-12) continue;
            const n1 = { x: -j1.d1.y / sp1, y: j1.d1.x / sp1 };
            const n2 = { x: -j2.d1.y / sp2, y: j2.d1.x / sp2 };
            const o1 = add(j1.point, scale(n1, sg1 * radius));
            const o2 = add(j2.point, scale(n2, sg2 * radius));
            const err = distance(o1, o2);

            if (err <= 1e-5 * Math.max(1, radius)) {
                const center = midpoint(o1, o2);
                const score = distance(center, pickMid) + distance(j1.point, p1) + distance(j2.point, p2);
                if (!bestSolution || score < bestSolution.score) {
                    bestSolution = {
                        center,
                        t1: j1.point,
                        t2: j2.point,
                        u,
                        v,
                        j1,
                        j2,
                        score,
                    };
                }
            }
        }
    }

    return bestSolution;
}

// Apara uma entidade qualquer (line, arc, ellipse, spline) no ponto `cutPoint`, mantendo o sub-trecho
// mais próximo de `keepPickPoint`.
export function trimEntityKeepingSide(entity, cutPoint, keepPickPoint) {
    if (entity.type === 'circle') return entity;
    const pieces = splitEntityAt(entity, [cutPoint]);
    if (!pieces || pieces.length <= 1) {
        if (entity.type === 'line') {
            const dStart = distance(keepPickPoint, entity.start);
            const dEnd = distance(keepPickPoint, entity.end);
            return dStart <= dEnd ? { ...entity, end: cutPoint } : { ...entity, start: cutPoint };
        }
        return entity;
    }
    let bestPiece = pieces[0];
    let bestD = Infinity;
    for (const p of pieces) {
        const curves = entityCurves(p);
        for (const c of curves) {
            const d = distance(keepPickPoint, closestPointOnCurve(keepPickPoint, c));
            if (d < bestD) {
                bestD = d;
                bestPiece = p;
            }
        }
    }
    return { ...bestPiece, id: entity.id };
}

// Concordância Universal (G¹ circular por Rolling-Ball ou G² contínua em curvatura por Bézier Quíntica)
// entre quaisquer entidades (line, arc, circle, ellipse, spline).
export function filletEntitiesUniversal(e1, p1, e2, p2, radius, { continuity = 'G1' } = {}) {
    const curves1 = entityCurves(e1);
    const curves2 = entityCurves(e2);
    if (curves1.length === 0 || curves2.length === 0) return null;

    let c1 = curves1[0];
    let d1Min = Infinity;
    for (const c of curves1) {
        const d = distance(p1, closestPointOnCurve(p1, c));
        if (d < d1Min) { d1Min = d; c1 = c; }
    }
    let c2 = curves2[0];
    let d2Min = Infinity;
    for (const c of curves2) {
        const d = distance(p2, closestPointOnCurve(p2, c));
        if (d < d2Min) { d2Min = d; c2 = c; }
    }

    if (radius <= 1e-9) {
        const hits = intersectCurves(c1, c2, { extend1: true, extend2: true });
        if (hits.length === 0) return null;
        const pickMid = midpoint(p1, p2);
        hits.sort((a, b) => distance(a, pickMid) - distance(b, pickMid));
        const corner = hits[0];
        return {
            first: trimEntityKeepingSide(e1, corner, p1),
            second: trimEntityKeepingSide(e2, corner, p2),
            arc: null,
            bridge: null,
        };
    }

    const sol = solveRollingBallFillet(e1, p1, e2, p2, radius);
    if (!sol) return null;

    const first = trimEntityKeepingSide(e1, sol.t1, p1);
    const second = trimEntityKeepingSide(e2, sol.t2, p2);

    if (continuity === 'G2' || continuity === 'g2') {
        const blend = blendEntitiesG2(first, sol.t1, second, sol.t2);
        if (!blend) return null;
        return {
            first,
            second,
            arc: blend,
            bridge: blend,
        };
    }

    let a1 = angleOf(sol.center, sol.t1);
    let a2 = angleOf(sol.center, sol.t2);
    if (sweepCCW(a1, a2) > Math.PI) [a1, a2] = [a2, a1];
    const arc = {
        type: 'arc',
        layer: e1.layer,
        color: e1.color,
        center: sol.center,
        radius,
        start: normalizeAngle(a1),
        end: normalizeAngle(a2),
    };
    return { first, second, arc, bridge: arc };
}

// ---------------------------------------------------------------------------
// 3. Chanfro Geodésico Universal (Retas, Arcos, Elipses e Splines)
// ---------------------------------------------------------------------------

function pointAtGeodesicOffsetFromIntersection(entity, cornerPoint, keepPickPoint, dist) {
    const trimmedAtCorner = trimEntityKeepingSide(entity, cornerPoint, keepPickPoint);
    const curves = entityCurves(trimmedAtCorner);
    if (curves.length === 0) return null;
    const totalLen = curves.reduce((acc, c) => acc + curveLength(c), 0);
    if (dist >= totalLen - 1e-9) return null;

    const startPt = curves[0].kind === 'segment'
        ? curves[0].a
        : curves[0].kind === 'arc'
            ? polar(curves[0].center, curves[0].start, curves[0].radius)
            : evalCurveJetNormalized(curves[0], 0).point;

    const cornerAtStart = distance(startPt, cornerPoint) <= 1e-4;
    const targetDist = cornerAtStart ? dist : totalLen - dist;

    // Usa curvePointAtDistance equivalente
    let rem = targetDist;
    for (let i = 0; i < curves.length; i += 1) {
        const c = curves[i];
        const len = curveLength(c);
        if (rem <= len + 1e-9 || i === curves.length - 1) {
            if (c.kind === 'segment') {
                const t = len > 1e-12 ? Math.min(1, Math.max(0, rem / len)) : 0;
                return { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t };
            }
            if (c.kind === 'arc') {
                const ang = normalizeAngle(c.start + rem / c.radius);
                return polar(c.center, ang, c.radius);
            }
            if (c.kind === 'ellipse') {
                return ellipsePointAtDistance(c, rem).point;
            }
            if (c.kind === 'bezier') {
                return bezierPointAtDistance(c, rem).point;
            }
        }
        rem -= len;
    }
    return null;
}

export function chamferEntitiesUniversal(a, b, d1, d2, p1 = null, p2 = null) {
    if (!a || !b || (a.id && a.id === b.id)) throw new Error('Selecione duas entidades distintas.');
    if (!(d1 >= 0 && d2 >= 0 && Number.isFinite(d1) && Number.isFinite(d2))) throw new Error('Distância inválida.');

    const c1 = entityCurves(a)[0];
    const c2 = entityCurves(b)[0];
    if (!c1 || !c2) throw new Error('Geometria inválida para chanfro.');

    const hits = intersectCurves(c1, c2, { extend1: true, extend2: true });
    if (hits.length === 0) throw new Error('Linhas paralelas não formam chanfro.');

    const ref1 = p1 ?? (a.start && a.end ? midpoint(a.start, a.end) : evalCurveJetNormalized(c1, 0.5).point);
    const ref2 = p2 ?? (b.start && b.end ? midpoint(b.start, b.end) : evalCurveJetNormalized(c2, 0.5).point);
    const refMid = midpoint(ref1, ref2);
    hits.sort((p, q) => distance(p, refMid) - distance(q, refMid));
    const corner = hits[0].point ?? hits[0];

    const tip1 = d1 === 0 ? corner : pointAtGeodesicOffsetFromIntersection(a, corner, ref1, d1);
    const tip2 = d2 === 0 ? corner : pointAtGeodesicOffsetFromIntersection(b, corner, ref2, d2);
    if (!tip1 || !tip2) throw new Error('Chanfro ultrapassa a linha.');

    const first = trimEntityKeepingSide(a, tip1, ref1);
    const second = trimEntityKeepingSide(b, tip2, ref2);
    const bridge = {
        type: 'line',
        start: tip1,
        end: tip2,
        layer: a.layer,
        color: a.color,
    };
    return { first, second, bridge };
}

// ---------------------------------------------------------------------------
// 4. EXTEND Analítico para Retas, Arcos, Arcos Elípticos, Splines e Polilinhas
// ---------------------------------------------------------------------------

export function extendEntityExact(entity, limits, pickPoint) {
    if (!entity || !limits || limits.length === 0) return null;

    if (entity.type === 'line') {
        const own = entityCurves(entity)[0];
        const nearStart = distance(pickPoint, entity.start) < distance(pickPoint, entity.end);
        const endPoint = nearStart ? entity.start : entity.end;
        const other = nearStart ? entity.end : entity.start;
        const dir = normalize(sub(endPoint, other));
        let best = null;
        limits.forEach((limit) => {
            intersectCurves(own, limit, { extend1: true }).forEach((p) => {
                const pt = p.point ?? p;
                const t = dot(sub(pt, endPoint), dir);
                if (t > 1e-9 && (!best || t < best.t)) best = { p: pt, t };
            });
        });
        if (!best) return null;
        return nearStart ? { ...entity, start: best.p } : { ...entity, end: best.p };
    }

    if (entity.type === 'arc') {
        const startPoint = polar(entity.center, entity.start, entity.radius);
        const endPoint = polar(entity.center, entity.end, entity.radius);
        const nearStart = distance(pickPoint, startPoint) < distance(pickPoint, endPoint);
        const full = { kind: 'circle', center: entity.center, radius: entity.radius };
        let best = null;
        limits.forEach((limit) => {
            intersectCurves(full, limit).forEach((p) => {
                const pt = p.point ?? p;
                const angle = angleOf(entity.center, pt);
                const delta = nearStart ? sweepCCW(angle, entity.start) : sweepCCW(entity.end, angle);
                if (delta > 1e-9 && delta < TWO_PI - sweepCCW(entity.start, entity.end) - 1e-9 && (!best || delta < best.delta)) {
                    best = { angle, delta };
                }
            });
        });
        if (!best) return null;
        return nearStart ? { ...entity, start: normalizeAngle(best.angle) } : { ...entity, end: normalizeAngle(best.angle) };
    }

    if (entity.type === 'ellipse' && !ellipseIsFull(entity)) {
        const s0 = normalizeAngle(entity.start ?? 0);
        const e0 = normalizeAngle(entity.end ?? TWO_PI);
        const fullCurve = {
            kind: 'ellipse',
            center: entity.center,
            major: entity.major,
            ratio: entity.ratio,
            start: 0,
            end: TWO_PI,
            full: true,
        };
        const pStart = evalEllipseJet(fullCurve, s0).point;
        const pEnd = evalEllipseJet(fullCurve, e0).point;
        const nearStart = distance(pickPoint, pStart) < distance(pickPoint, pEnd);
        const curSweep = sweepCCW(s0, e0);
        let best = null;
        for (const limit of limits) {
            const hits = intersectCurves(fullCurve, limit);
            for (const h of hits) {
                const pt = h.point ?? h;
                const cp = closestPointOnEllipse(fullCurve, pt);
                const theta = normalizeAngle(cp.t);
                const delta = nearStart ? sweepCCW(theta, s0) : sweepCCW(e0, theta);
                if (delta > 1e-7 && delta < TWO_PI - curSweep - 1e-7 && (!best || delta < best.delta)) {
                    best = { theta, delta };
                }
            }
        }
        if (!best) return null;
        return nearStart
            ? { ...entity, start: best.theta, _bbox: undefined }
            : { ...entity, end: best.theta, _bbox: undefined };
    }

    if (entity.type === 'spline' && !entity.closed) {
        const sp = ensureSplineGeometry(entity);
        const p = sp.degree;
        const tMin = sp.knots[p];
        const tMax = sp.knots[sp.controlPoints.length];
        const jStart = evaluateSplineJet(sp, tMin);
        const jEnd = evaluateSplineJet(sp, tMax);
        const nearStart = distance(pickPoint, jStart.point) < distance(pickPoint, jEnd.point);
        const endPt = nearStart ? jStart.point : jEnd.point;
        const tanDir = nearStart ? unitVec(scale(jStart.d1, -1)) : unitVec(jEnd.d1);
        const raySeg = { kind: 'segment', a: endPt, b: add(endPt, scale(tanDir, 1000)) };

        let best = null;
        for (const limit of limits) {
            const hits = intersectCurves(raySeg, limit, { extend1: true });
            for (const h of hits) {
                const pt = h.point ?? h;
                const t = dot(sub(pt, endPt), tanDir);
                if (t > 1e-7 && (!best || t < best.t)) {
                    best = { pt, t };
                }
            }
        }
        if (!best) return null;

        if (sp.fitPoints && sp.fitPoints.length >= 2) {
            const newFits = nearStart ? [best.pt, ...sp.fitPoints] : [...sp.fitPoints, best.pt];
            const interp = interpolateSpline(newFits);
            return {
                ...entity,
                degree: interp.degree,
                knots: interp.knots,
                controlPoints: interp.controlPoints,
                fitPoints: newFits,
                _sampledPts: undefined,
                _bbox: undefined,
            };
        }
        const newCP = sp.controlPoints.map((c) => ({ ...c }));
        if (nearStart) newCP[0] = best.pt;
        else newCP[newCP.length - 1] = best.pt;
        return {
            ...sp,
            controlPoints: newCP,
            _sampledPts: undefined,
            _bbox: undefined,
        };
    }

    if (entity.type === 'polyline' && !entity.closed && entity.vertices.length >= 2) {
        const vs = entity.vertices.map((v) => ({ ...v }));
        const nearStart = distance(pickPoint, vs[0]) < distance(pickPoint, vs[vs.length - 1]);
        const curves = polylineCurves(vs, false);
        const targetCurve = nearStart ? curves[0] : curves[curves.length - 1];
        if (targetCurve.kind === 'segment') {
            const lineEnt = { type: 'line', start: targetCurve.a, end: targetCurve.b };
            const ext = extendEntityExact(lineEnt, limits, nearStart ? targetCurve.a : targetCurve.b);
            if (!ext) return null;
            if (nearStart) vs[0] = { ...vs[0], x: ext.start.x, y: ext.start.y };
            else vs[vs.length - 1] = { ...vs[vs.length - 1], x: ext.end.x, y: ext.end.y };
            return { ...entity, vertices: vs };
        }
        if (targetCurve.kind === 'arc') {
            const ccw = (vs[targetCurve.index]?.bulge ?? 0) > 0;
            const arcEnt = {
                type: 'arc',
                center: targetCurve.center,
                radius: targetCurve.radius,
                start: targetCurve.start,
                end: targetCurve.end,
            };
            const pickEnd = nearStart ? vs[0] : vs[vs.length - 1];
            const ext = extendEntityExact(arcEnt, limits, pickEnd);
            if (!ext) return null;
            const newSweep = sweepCCW(ext.start, ext.end);
            const newBulge = (ccw ? 1 : -1) * sweepToBulgeRational(newSweep);
            if (nearStart) {
                const newStartPt = polar(ext.center, ccw ? ext.start : ext.end, ext.radius);
                vs[0] = { x: newStartPt.x, y: newStartPt.y, bulge: newBulge };
            } else {
                const newEndPt = polar(ext.center, ccw ? ext.end : ext.start, ext.radius);
                vs[vs.length - 2] = { ...vs[vs.length - 2], bulge: newBulge };
                vs[vs.length - 1] = { ...vs[vs.length - 1], x: newEndPt.x, y: newEndPt.y };
            }
            return { ...entity, vertices: vs };
        }
    }

    return null;
}
