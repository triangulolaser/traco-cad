// Motor Topológico de Offset Planar com Resolução de Autocolisão Global, Podagem de Cúspides
// (Swallowtails), Estrangulamento de Gargalo (Neck Pinch-Off em Múltiplas Ilhas) e Offset de
// Elipses e Splines NURBS por Hodógrafo/Jato Diferencial.

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
    perpendicular,
    polylineCurves,
    entityCurves,
    intersectCurves,
    closestPointOnCurve,
    distanceToCurve,
    splitEntityAt,
} from './geometry.js';
import { sweepToBulgeRational } from './predicates.js';
import { evaluateSplineJet } from './nurbs-exact.js';
import { evalEllipseJet, closestPointOnEllipse } from './curve-intersect.js';
import { interpolateSpline } from './splines.js';
import { buildPlanarArrangement, pointInLoopExact, loopSignedArea } from './topology-dcel.js';

const EPS = 1e-9;
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
    if (entity.fitPoints?.length >= 2) {
        const sp = interpolateSpline(entity.fitPoints, entity.degree ?? 3);
        return { ...entity, ...sp };
    }
    return entity;
}

function closeCoincidentEnds(entity) {
    const vs = entity.vertices;
    if (entity.closed || vs.length < 4) return entity;
    const first = vs[0];
    const last = vs[vs.length - 1];
    const tol = Math.max(1e-4, 1e-6 * Math.hypot(first.x, first.y));
    if (distance(first, last) > tol) return entity;
    return { ...entity, closed: true, vertices: vs.slice(0, -1) };
}

function startOfCurve(curve) {
    return curve.kind === 'segment' ? curve.a : polar(curve.center, curve.start, curve.radius);
}

function endOfCurve(curve) {
    return curve.kind === 'segment' ? curve.b : polar(curve.center, curve.end, curve.radius);
}

function curveMid(curve) {
    if (curve.kind === 'segment') return midpoint(curve.a, curve.b);
    const sweep = sweepCCW(curve.start, curve.end);
    return polar(curve.center, normalizeAngle(curve.start + 0.5 * sweep), curve.radius);
}

function minDistanceToCurves(pt, curves) {
    let best = Infinity;
    for (const c of curves) {
        const d = distanceToCurve(pt, c);
        if (d < best) best = d;
    }
    return best;
}

// Mescla segmentos colineares consecutivos em um laço de polilinha para manter a topologia enxuta.
function simplifyCollinearLoopVertices(vertices, tol = 1e-6) {
    if (!vertices || vertices.length < 3) return vertices;
    const out = [];
    const n = vertices.length;
    for (let i = 0; i < n; i += 1) {
        const prev = out.length > 0 ? out[out.length - 1] : vertices[(i - 1 + n) % n];
        const cur = vertices[i];
        const next = vertices[(i + 1) % n];
        if (Math.abs(prev.bulge ?? 0) < 1e-9 && Math.abs(cur.bulge ?? 0) < 1e-9) {
            const v1 = sub(cur, prev);
            const v2 = sub(next, cur);
            const l1 = Math.hypot(v1.x, v1.y);
            const l2 = Math.hypot(v2.x, v2.y);
            if (l1 > tol && l2 > tol) {
                const cr = Math.abs(cross(v1, v2)) / (l1 * l2);
                const dt = dot(v1, v2);
                if (cr < 1e-6 && dt > 0) {
                    continue;
                }
            }
        }
        out.push(cur);
    }
    return out.length >= 2 ? out : vertices;
}

// Constrói as curvas brutas deslocadas e unidas nos cantos adjacentes (sem descartar inversões globais).
function buildRawOffsetPrimitives(entity, curves, dist, leftSign) {
    const isCCW = (curve) => (entity.vertices[curve.index]?.bulge ?? 0) > 0;

    const offsetCurves = curves
        .map((curve) => {
            if (curve.kind === 'segment') {
                const dir = normalize(sub(curve.b, curve.a));
                const delta = scale(perpendicular(dir), dist * leftSign);
                return {
                    kind: 'segment',
                    a: add(curve.a, delta),
                    b: add(curve.b, delta),
                    index: curve.index,
                    ccw: true,
                    sweep0: 0,
                };
            }
            const leftIsInside = isCCW(curve);
            const radius = leftIsInside ? curve.radius - dist * leftSign : curve.radius + dist * leftSign;
            if (radius <= EPS) return null;
            return {
                ...curve,
                radius,
                ccw: leftIsInside,
                sweep0: sweepCCW(curve.start, curve.end),
            };
        })
        .filter(Boolean);

    if (offsetCurves.length < (entity.closed ? 2 : 1)) return [];

    const jointPoint = (prev, next) => {
        const hits = intersectCurves(prev, next, { extend1: true, extend2: true });
        if (hits.length === 0) return endOfCurve(prev);
        const target = midpoint(endOfCurve(prev), startOfCurve(next));
        hits.sort((p, q) => distance(p, target) - distance(q, target));
        return hits[0];
    };

    const m = offsetCurves.length;
    const joints = [];
    for (let i = 0; i < m; i += 1) {
        const curve = offsetCurves[i];
        const prev = offsetCurves[(i - 1 + m) % m];
        joints.push(i === 0 && !entity.closed ? startOfCurve(curve) : jointPoint(prev, curve));
    }
    if (!entity.closed) joints.push(endOfCurve(offsetCurves[m - 1]));

    const rawPrimitives = [];
    for (let i = 0; i < m; i += 1) {
        const curve = offsetCurves[i];
        const pStart = joints[i];
        const pEnd = entity.closed ? joints[(i + 1) % m] : joints[i + 1];
        if (distance(pStart, pEnd) <= 1e-8) continue;
        if (curve.kind === 'segment') {
            rawPrimitives.push({ kind: 'segment', a: pStart, b: pEnd });
        } else {
            const a0 = normalizeAngle(angleOf(curve.center, pStart));
            const a1 = normalizeAngle(angleOf(curve.center, pEnd));
            const start = curve.ccw ? a0 : a1;
            const end = curve.ccw ? a1 : a0;
            rawPrimitives.push({
                kind: 'arc',
                center: curve.center,
                radius: curve.radius,
                start,
                end,
            });
        }
    }
    return rawPrimitives;
}

// Subdivide segmentos colineares sobrepostos (ex.: paredes de degrau opostas que colapsam na mesma reta de gargalo)
// e corta todas as primitivas nas interseções mútuas.
function subdivideRawOffsetArrangement(rawPrimitives, tol = 1e-6) {
    const cutPointsPerCurve = Array.from({ length: rawPrimitives.length }, () => []);

    // Coleta todas as extremidades e interseções mútuas
    const allEndpoints = [];
    for (let i = 0; i < rawPrimitives.length; i += 1) {
        const [a, b] = [startOfCurve(rawPrimitives[i]), endOfCurve(rawPrimitives[i])];
        allEndpoints.push(a, b);
    }

    for (let i = 0; i < rawPrimitives.length; i += 1) {
        const ci = rawPrimitives[i];
        // Se uma extremidade de outra primitiva cai sobre o interior de ci (sobreposição colinear), corta ci nela
        for (const ep of allEndpoints) {
            if (distanceToCurve(ep, ci) <= tol) {
                cutPointsPerCurve[i].push(ep);
            }
        }
        for (let j = i + 1; j < rawPrimitives.length; j += 1) {
            const cj = rawPrimitives[j];
            const hits = intersectCurves(ci, cj);
            for (const h of hits) {
                const pt = h.point ?? h;
                cutPointsPerCurve[i].push(pt);
                cutPointsPerCurve[j].push(pt);
            }
        }
    }

    const pieces = [];
    for (let i = 0; i < rawPrimitives.length; i += 1) {
        const c = rawPrimitives[i];
        const cuts = cutPointsPerCurve[i];
        if (cuts.length === 0) {
            pieces.push(c);
            continue;
        }
        if (c.kind === 'segment') {
            const subLines = splitEntityAt({ type: 'line', start: c.a, end: c.b }, cuts);
            for (const sl of subLines) {
                if (distance(sl.start, sl.end) > tol) {
                    pieces.push({ kind: 'segment', a: sl.start, b: sl.end });
                }
            }
        } else if (c.kind === 'arc') {
            const subArcs = splitEntityAt(
                { type: 'arc', center: c.center, radius: c.radius, start: c.start, end: c.end },
                cuts,
            );
            for (const sa of subArcs) {
                if (sweepCCW(sa.start, sa.end) * sa.radius > tol) {
                    pieces.push({ kind: 'arc', center: sa.center, radius: sa.radius, start: sa.start, end: sa.end });
                }
            }
        }
    }
    return pieces;
}

// Algoritmo clássico de offset local (com eliminação iterativa de arestas adjacentes invertidas),
// usado como caminho rápido quando não há autocolisão global nem estrangulamento de gargalo.
function offsetPolylineLocal(entity, curves, dist, leftSign) {
    const isCCW = (curve) => (entity.vertices[curve.index]?.bulge ?? 0) > 0;
    let offsetCurves = curves
        .map((curve) => {
            if (curve.kind === 'segment') {
                const dir = normalize(sub(curve.b, curve.a));
                const delta = scale(perpendicular(dir), dist * leftSign);
                return { kind: 'segment', a: add(curve.a, delta), b: add(curve.b, delta), index: curve.index, sweep0: 0 };
            }
            const leftIsInside = isCCW(curve);
            const radius = leftIsInside ? curve.radius - dist * leftSign : curve.radius + dist * leftSign;
            if (radius <= EPS) return null;
            return { ...curve, radius, sweep0: sweepCCW(curve.start, curve.end) };
        })
        .filter(Boolean);

    const jointPoint = (prev, next) => {
        const hits = intersectCurves(prev, next, { extend1: true, extend2: true });
        if (hits.length === 0) return endOfCurve(prev);
        const target = midpoint(endOfCurve(prev), startOfCurve(next));
        hits.sort((p, q) => distance(p, target) - distance(q, target));
        return hits[0];
    };

    const computeJoints = () => {
        const n2 = offsetCurves.length;
        const out = [];
        for (let i = 0; i < n2; i += 1) {
            const curve = offsetCurves[i];
            const prev = offsetCurves[(i - 1 + n2) % n2];
            out.push(i === 0 && !entity.closed ? startOfCurve(curve) : jointPoint(prev, curve));
        }
        if (!entity.closed) out.push(endOfCurve(offsetCurves[n2 - 1]));
        return out;
    };

    const inverted = (curve, a, b) => {
        if (curve.kind === 'segment') return dot(sub(b, a), sub(curve.b, curve.a)) < 0;
        const ccw = isCCW(curve);
        const a0 = angleOf(curve.center, a);
        const a1 = angleOf(curve.center, b);
        const sweep = ccw ? sweepCCW(a0, a1) : sweepCCW(a1, a0);
        return Math.abs(sweep - curve.sweep0) > Math.PI;
    };

    let joints;
    for (;;) {
        if (offsetCurves.length < (entity.closed ? 2 : 1)) return null;
        joints = computeJoints();
        const m = offsetCurves.length;
        const bad = offsetCurves.findIndex((curve, i) => inverted(curve, joints[i], entity.closed ? joints[(i + 1) % m] : joints[i + 1]));
        if (bad < 0 || m <= 2) break;
        offsetCurves = offsetCurves.filter((_, i) => i !== bad);
    }

    const n = offsetCurves.length;
    const vertices = [];
    for (let i = 0; i < n; i += 1) {
        const curve = offsetCurves[i];
        const startPoint = joints[i];
        const endPoint = entity.closed ? joints[(i + 1) % n] : joints[i + 1];
        let bulge = 0;
        if (curve.kind === 'arc') {
            const ccw = isCCW(curve);
            const a0 = angleOf(curve.center, startPoint);
            const a1 = angleOf(curve.center, endPoint);
            const sweep = ccw ? sweepCCW(a0, a1) : sweepCCW(a1, a0);
            bulge = (ccw ? 1 : -1) * sweepToBulgeRational(sweep);
        }
        vertices.push({ x: startPoint.x, y: startPoint.y, bulge });
    }
    if (!entity.closed) vertices.push({ x: joints[n].x, y: joints[n].y, bulge: 0 });
    return { ...entity, vertices };
}

// Verifica se uma polilinha resultante possui autointerseções entre arestas não-adjacentes
// ou viola a distância mínima geodésica `dist` ao contorno gerador `origCurves`.
export function hasPolylineSelfIntersectionOrInvasion(polyEntity, origCurvesOrEntity = null, dist = 0) {
    if (!polyEntity || !polyEntity.vertices || polyEntity.vertices.length < 2) return true;
    const origCurves = origCurvesOrEntity && !Array.isArray(origCurvesOrEntity)
        ? (origCurvesOrEntity.vertices ? polylineCurves(origCurvesOrEntity.vertices, origCurvesOrEntity.closed) : entityCurves(origCurvesOrEntity))
        : origCurvesOrEntity;
    const curves = polylineCurves(polyEntity.vertices, polyEntity.closed);
    if (curves.length === 0) return true;
    const tol = 1e-5;

    for (let i = 0; i < curves.length; i += 1) {
        const ci = curves[i];
        if (origCurves && dist > 0) {
            const mid = curveMid(ci);
            if (minDistanceToCurves(mid, origCurves) < dist - 1e-3 * Math.max(1, dist)) {
                return true;
            }
        }
        for (let j = i + 1; j < curves.length; j += 1) {
            const isAdjacent = (j === i + 1) || (polyEntity.closed && i === 0 && j === curves.length - 1);
            const hits = intersectCurves(ci, curves[j]);
            for (const h of hits) {
                const pt = h.point ?? h;
                if (isAdjacent) {
                    const shared = endOfCurve(ci);
                    const shared0 = startOfCurve(ci);
                    if (distance(pt, shared) <= tol || distance(pt, shared0) <= tol) continue;
                }
                return true;
            }
        }
    }
    return false;
}

// Resolve o offset planar de uma polilinha fechada ou aberta, retornando todas as ilhas válidas
// livres de autointerseção (ex.: 2 ilhas quando um gargalo sofre pinch-off).
export function offsetPolylinePlanar(rawEntity, dist, side) {
    const entity = closeCoincidentEnds(rawEntity);
    const curves = polylineCurves(entity.vertices, entity.closed);
    if (curves.length === 0) return [];

    const isCCW = (curve) => (entity.vertices[curve.index]?.bulge ?? 0) > 0;
    let nearest = null;
    curves.forEach((c) => {
        const d = distanceToCurve(side, c);
        if (!nearest || d < nearest.d) nearest = { c, d };
    });
    const c = nearest.c;
    let leftSign;
    if (c.kind === 'segment') {
        leftSign = cross(sub(c.b, c.a), sub(side, c.a)) >= 0 ? 1 : -1;
    } else {
        const inside = distance(side, c.center) < c.radius;
        leftSign = inside === isCCW(c) ? 1 : -1;
    }

    // 1. Tenta o offset local rápido se não houver autocolisão global nem invasão de distância
    const localResult = offsetPolylineLocal(entity, curves, dist, leftSign);
    if (localResult && !hasPolylineSelfIntersectionOrInvasion(localResult, curves, dist)) {
        return [localResult];
    }

    // 2. Polilinha aberta com autointerseção global: poda o laço auto-intersectante nos pontos de cruzamento
    if (!entity.closed) {
        if (!localResult) return [];
        const localCurves = polylineCurves(localResult.vertices, false);
        const subPieces = subdivideRawOffsetArrangement(localCurves, 1e-6);
        const tolDist = dist - 1e-3 * Math.max(1, dist);
        const validPieces = subPieces.filter((p) => minDistanceToCurves(curveMid(p), curves) >= tolDist);
        if (validPieces.length === 0) return [];
        const outVertices = [{ x: startOfCurve(validPieces[0]).x, y: startOfCurve(validPieces[0]).y, bulge: 0 }];
        for (const vp of validPieces) {
            const pEnd = endOfCurve(vp);
            let bulge = 0;
            if (vp.kind === 'arc') {
                bulge = sweepToBulgeRational(sweepCCW(vp.start, vp.end));
            }
            outVertices[outVertices.length - 1].bulge = bulge;
            outVertices.push({ x: pEnd.x, y: pEnd.y, bulge: 0 });
        }
        return [{ ...entity, vertices: outVertices }];
    }

    // 3. Polilinha fechada com autocolisão global / gargalo (Neck Pinch-Off):
    // Gera o arranjo bruto completo (sem descartar arestas de gargalo antes da subdivisão),
    // subdivide nas interseções de Voronoi e filtra pelo critério dist(m, Γ0) >= d - ε e lado alvo.
    const origLoop = { vertices: entity.vertices };
    const origArea = loopSignedArea(origLoop);
    // Para um laço CCW (origArea > 0), leftSign > 0 significa offset interno (dentro de Γ0).
    // Para um laço CW (origArea < 0), leftSign < 0 significa offset interno.
    const targetInside = (origArea >= 0 && leftSign > 0) || (origArea < 0 && leftSign < 0);

    const rawPrimitives = buildRawOffsetPrimitives(entity, curves, dist, leftSign);
    if (rawPrimitives.length === 0) return [];

    const subdivided = subdivideRawOffsetArrangement(rawPrimitives, 1e-5);
    const distTol = dist - 1e-3 * Math.max(1, dist);

    const validEdges = subdivided.filter((piece) => {
        const mid = curveMid(piece);
        if (pointInLoopExact(mid, origLoop) !== targetInside) return false;
        const dMin = minDistanceToCurves(mid, curves);
        return dMin >= distTol;
    });

    if (validEdges.length < 2) return [];

    const dcel = buildPlanarArrangement(validEdges, { tolerance: 1e-5 });
    const islands = [];
    for (const face of dcel.boundedFaces) {
        if (face.area <= 1e-6) continue;
        const simplified = simplifyCollinearLoopVertices(face.loop.vertices, 1e-5);
        if (simplified.length < 2) continue;
        // Verifica um ponto da borda e o sentido da ilha
        const mid0 = curveMid(polylineCurves(simplified, true)[0]);
        if (minDistanceToCurves(mid0, curves) < distTol) continue;
        islands.push({
            ...entity,
            id: undefined,
            closed: true,
            vertices: simplified,
        });
    }

    // Ordena ilhas pela proximidade ao ponto `side` clicado (a primeira é a ilha principal)
    islands.sort((a, b) => {
        const da = minDistanceToCurves(side, polylineCurves(a.vertices, true));
        const db = minDistanceToCurves(side, polylineCurves(b.vertices, true));
        return da - db;
    });

    return islands;
}

// Offset analítico por hodógrafo/jato diferencial para SPLINE e ELLIPSE.
export function offsetSplineEntity(entity, dist, side) {
    const sp = ensureSplineGeometry(entity);
    if (!sp.controlPoints || sp.controlPoints.length < 2) return null;
    const p = sp.degree;
    const tMin = sp.knots[p];
    const tMax = sp.knots[sp.controlPoints.length];
    const origCurves = entityCurves(sp);

    // Determina o sinal (+1 = normal à esquerda de C'(t), -1 = à direita) pelo ponto mais próximo de `side`
    const N_SAMPLES = 32;
    let bestT = tMin;
    let bestD = Infinity;
    for (let i = 0; i <= N_SAMPLES; i += 1) {
        const t = tMin + ((tMax - tMin) * i) / N_SAMPLES;
        const jet = evaluateSplineJet(sp, t);
        const d = distance(side, jet.point);
        if (d < bestD) {
            bestD = d;
            bestT = t;
        }
    }
    const refJet = evaluateSplineJet(sp, bestT);
    const nRef = { x: -refJet.d1.y, y: refJet.d1.x };
    const sign = dot(sub(side, refJet.point), nRef) >= 0 ? 1 : -1;

    // Avalia C_d(t) = C(t) + sign * d * N(t) e filtra pontos de cúspide onde 1 - sign * κ(t) * d <= 0
    const fitPts = [];
    const M = 24;
    const tolDist = dist - 1e-2 * Math.max(1, dist);
    for (let i = 0; i <= M; i += 1) {
        const t = tMin + ((tMax - tMin) * i) / M;
        const jet = evaluateSplineJet(sp, t);
        const speed = Math.hypot(jet.d1.x, jet.d1.y);
        if (speed <= 1e-12) continue;
        const nx = -jet.d1.y / speed;
        const ny = jet.d1.x / speed;
        const pt = {
            x: jet.point.x + sign * dist * nx,
            y: jet.point.y + sign * dist * ny,
        };
        if (minDistanceToCurves(pt, origCurves) >= tolDist) {
            if (fitPts.length === 0 || distance(pt, fitPts[fitPts.length - 1]) > 1e-6) {
                fitPts.push(pt);
            }
        }
    }

    if (fitPts.length < 2) return null;
    const fitted = interpolateSpline(fitPts);
    return {
        ...entity,
        id: undefined,
        degree: fitted.degree,
        knots: fitted.knots,
        controlPoints: fitted.controlPoints,
        fitPoints: fitPts,
        weights: undefined,
    };
}

export function offsetEllipseEntity(entity, dist, side) {
    const full = ellipseIsFull(entity);
    const curve = {
        kind: 'ellipse',
        center: entity.center,
        major: entity.major,
        ratio: entity.ratio,
        start: entity.start ?? 0,
        end: entity.end ?? TWO_PI,
        full,
    };
    const cp = closestPointOnEllipse(curve, side);
    const jetRef = evalEllipseJet(curve, cp.t);
    const nRef = { x: -jetRef.d1.y, y: jetRef.d1.x };
    // Para elipse percorrida no sentido trigonométrico, nRef aponta para o interior (centro).
    const sign = dot(sub(side, jetRef.point), nRef) >= 0 ? 1 : -1;

    // Verifica se no semieixo menor b o offset interno (sign > 0) colapsa a elipse inteira
    const a = Math.hypot(entity.major.x, entity.major.y);
    const b = a * entity.ratio;
    if (sign > 0 && dist >= b - 1e-6) return null;

    const s0 = full ? 0 : (entity.start ?? 0);
    const sweep = full ? TWO_PI : sweepCCW(s0, entity.end ?? TWO_PI);
    const steps = 36;
    const fitPts = [];
    for (let i = 0; i <= steps; i += 1) {
        const theta = s0 + (sweep * i) / steps;
        const jet = evalEllipseJet(curve, theta);
        const speed = Math.hypot(jet.d1.x, jet.d1.y);
        if (speed <= 1e-12) continue;
        const nx = -jet.d1.y / speed;
        const ny = jet.d1.x / speed;
        const pt = {
            x: jet.point.x + sign * dist * nx,
            y: jet.point.y + sign * dist * ny,
            bulge: 0,
        };
        if (distanceToCurve(pt, curve) >= dist - 2e-2 * Math.max(1, dist)) {
            fitPts.push(pt);
        }
    }
    if (fitPts.length < (full ? 4 : 2)) return null;
    const fitted = interpolateSpline(fitPts);
    const vertices = full ? fitPts.slice(0, -1) : fitPts;
    return {
        type: 'spline',
        layer: entity.layer,
        color: entity.color,
        closed: full,
        degree: fitted.degree,
        knots: fitted.knots,
        controlPoints: fitted.controlPoints,
        fitPoints: fitPts,
        vertices,
    };
}

// Retorna todas as entidades geradas pelo offset (1 ou múltiplas ilhas em caso de neck pinch-off).
export function offsetEntityMultiple(entity, dist, side) {
    if (!entity || !(dist > 0)) return [];
    switch (entity.type) {
        case 'line': {
            const dir = normalize(sub(entity.end, entity.start));
            const n = perpendicular(dir);
            const sign = cross(dir, sub(side, entity.start)) >= 0 ? 1 : -1;
            const delta = scale(n, dist * sign);
            return [{ ...entity, start: add(entity.start, delta), end: add(entity.end, delta) }];
        }
        case 'circle':
        case 'arc': {
            const outward = distance(side, entity.center) > entity.radius;
            const radius = outward ? entity.radius + dist : entity.radius - dist;
            if (radius <= EPS) return [];
            return [{ ...entity, radius }];
        }
        case 'polyline':
        case 'lwpolyline':
            return offsetPolylinePlanar(entity, dist, side);
        case 'spline': {
            const sp = offsetSplineEntity(entity, dist, side);
            return sp ? [sp] : [];
        }
        case 'ellipse': {
            const el = offsetEllipseEntity(entity, dist, side);
            return el ? [el] : [];
        }
        default:
            return [];
    }
}

export function offsetEntityPlanar(entity, dist, side) {
    const all = offsetEntityMultiple(entity, dist, side);
    if (all.length === 0) return null;
    const primary = all[0];
    if (all.length > 1) {
        Object.defineProperty(primary, '_allIslands', {
            value: all,
            enumerable: false,
            configurable: true,
        });
    }
    return primary;
}
