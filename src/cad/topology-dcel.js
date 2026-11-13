// Arranjo Planar Topológico (Doubly Connected Edge List — DCEL) para HATCH e BOUNDARY:
// - Subdivisão mútua de segmentos, arcos circulares, elipses e Béziers/NURBS
// - Cura controlada de micro-frestas (HPGAPTOL / gapTolerance)
// - Poda iterativa de pontas abertas (arestas penduradas de grau 1 / bridges)
// - Ordenação angular em junções de grau ≥ 3 ("T", "X") com desempate pela curvatura assinada κ
// - Extração determinística de faces mínimas, cálculo de área exata de Green (com arcos)
// - Ray-casting analítico em laços curvos e Árvore de Contenção de Jordan (ilhas aninhadas até nível ≥ 6)

import {
    distance,
    polar,
    angleOf,
    normalizeAngle,
    sweepCCW,
    polylineCurves,
    entityCurves,
    intersectCurves,
    curveBox,
    closestPointOnCurve,
    splitEntityAt,
} from './geometry.js';
import { sweepToBulgeRational, solveQuadraticStable } from './predicates.js';

const TWO_PI = Math.PI * 2;
const ellipseIsFull = (e) => Math.abs((e.end ?? TWO_PI) - (e.start ?? 0)) >= TWO_PI - 1e-6;

function canonicalAngle(a) {
    let r = a % TWO_PI;
    if (r < 0) r += TWO_PI;
    if (r < 1e-8 || TWO_PI - r < 1e-8) return 0;
    return r;
}

// Converte uma curva elementar (segment, arc, ellipse, bezier) em sequência de curvas { kind: 'segment'|'arc' }
// para representação em laços de polilinha DXF ({ x, y, bulge }).
function curveToSegmentOrArcList(curve) {
    if (!curve) return [];
    if (curve.kind === 'segment') {
        if (distance(curve.a, curve.b) < 1e-12) return [];
        return [{ kind: 'segment', a: { x: curve.a.x, y: curve.a.y }, b: { x: curve.b.x, y: curve.b.y } }];
    }
    if (curve.kind === 'arc') {
        const sweep = sweepCCW(curve.start, curve.end);
        if (sweep * curve.radius < 1e-12) return [];
        if (sweep > Math.PI + 1e-6) {
            const mid = normalizeAngle(curve.start + 0.5 * sweep);
            return [
                { kind: 'arc', center: curve.center, radius: curve.radius, start: curve.start, end: mid },
                { kind: 'arc', center: curve.center, radius: curve.radius, start: mid, end: curve.end },
            ];
        }
        return [{ kind: 'arc', center: curve.center, radius: curve.radius, start: curve.start, end: curve.end }];
    }
    if (curve.kind === 'circle') {
        return [
            { kind: 'arc', center: curve.center, radius: curve.radius, start: 0, end: Math.PI },
            { kind: 'arc', center: curve.center, radius: curve.radius, start: Math.PI, end: TWO_PI },
        ];
    }
    if (curve.kind === 'ellipse') {
        const s0 = curve.full ? 0 : (curve.start ?? 0);
        const e0 = curve.full ? TWO_PI : (curve.end ?? TWO_PI);
        const sweep = curve.full ? TWO_PI : sweepCCW(s0, e0);
        const steps = Math.max(8, Math.ceil((sweep / TWO_PI) * 64));
        const ax = curve.major.x;
        const ay = curve.major.y;
        const bx = -ay * curve.ratio;
        const by = ax * curve.ratio;
        const pts = [];
        for (let i = 0; i <= steps; i += 1) {
            const t = s0 + (sweep * i) / steps;
            const c = Math.cos(t);
            const s = Math.sin(t);
            pts.push({
                x: curve.center.x + ax * c + bx * s,
                y: curve.center.y + ay * c + by * s,
            });
        }
        const out = [];
        for (let i = 0; i < pts.length - 1; i += 1) {
            if (distance(pts[i], pts[i + 1]) > 1e-10) {
                out.push({ kind: 'segment', a: pts[i], b: pts[i + 1] });
            }
        }
        return out;
    }
    if (curve.kind === 'bezier') {
        const pts = curve.points ?? [];
        if (pts.length < 2) return [];
        const steps = 12;
        const sampled = [];
        for (let i = 0; i <= steps; i += 1) {
            const u = i / steps;
            let work = pts.map((p, idx) => {
                const w = curve.weights?.[idx] ?? 1;
                return { wx: p.x * w, wy: p.y * w, w };
            });
            for (let r = 1; r < pts.length; r += 1) {
                for (let j = 0; j < pts.length - r; j += 1) {
                    work[j] = {
                        wx: (1 - u) * work[j].wx + u * work[j + 1].wx,
                        wy: (1 - u) * work[j].wy + u * work[j + 1].wy,
                        w: (1 - u) * work[j].w + u * work[j + 1].w,
                    };
                }
            }
            const w = Math.abs(work[0].w) > 1e-15 ? work[0].w : 1;
            sampled.push({ x: work[0].wx / w, y: work[0].wy / w });
        }
        const out = [];
        for (let i = 0; i < sampled.length - 1; i += 1) {
            if (distance(sampled[i], sampled[i + 1]) > 1e-10) {
                out.push({ kind: 'segment', a: sampled[i], b: sampled[i + 1] });
            }
        }
        return out;
    }
    return [];
}

function curveStartEnd(c) {
    if (c.kind === 'segment') return [c.a, c.b];
    return [polar(c.center, c.start, c.radius), polar(c.center, c.end, c.radius)];
}

function curveMidpointExact(c) {
    if (c.kind === 'segment') {
        return { x: 0.5 * (c.a.x + c.b.x), y: 0.5 * (c.a.y + c.b.y) };
    }
    const sweep = sweepCCW(c.start, c.end);
    return polar(c.center, normalizeAngle(c.start + 0.5 * sweep), c.radius);
}

// Divide uma curva { kind: 'segment'|'arc' } nos pontos dados.
function splitPrimitiveCurveAtPoints(curve, cutPoints, tol = 1e-7) {
    if (!cutPoints || cutPoints.length === 0) return [curve];
    if (curve.kind === 'segment') {
        const entity = { type: 'line', start: curve.a, end: curve.b };
        const pieces = splitEntityAt(entity, cutPoints);
        return pieces
            .filter((p) => distance(p.start, p.end) > tol)
            .map((p) => ({ kind: 'segment', a: p.start, b: p.end }));
    }
    if (curve.kind === 'arc') {
        const entity = { type: 'arc', center: curve.center, radius: curve.radius, start: curve.start, end: curve.end };
        const pieces = splitEntityAt(entity, cutPoints);
        return pieces.flatMap((p) => curveToSegmentOrArcList({
            kind: 'arc',
            center: p.center,
            radius: p.radius,
            start: p.start,
            end: p.end,
        }));
    }
    return [curve];
}

// Cura micro-frestas (HPGAPTOL): conecta ou cola extremidades abertas que estão a <= gapTolerance
// uma da outra ou projeta uma ponta aberta que para a <= gapTolerance do interior de outra curva.
function healMicroGaps(primitives, gapTolerance, baseTol) {
    if (!(gapTolerance > baseTol) || primitives.length === 0) return primitives;

    const endpoints = [];
    primitives.forEach((c, idx) => {
        const [a, b] = curveStartEnd(c);
        endpoints.push({ pt: a, curveIdx: idx, which: 'a' });
        endpoints.push({ pt: b, curveIdx: idx, which: 'b' });
    });

    // Conta quantas pontas já coincidem em baseTol
    const isOpenEndpoint = (ep) => {
        let count = 0;
        for (const other of endpoints) {
            if (distance(ep.pt, other.pt) <= baseTol * 2) count += 1;
        }
        return count === 1;
    };

    const openEnds = endpoints.filter(isOpenEndpoint);
    const bridges = [];
    const paired = new Set();

    // 1. Pontas abertas frente a frente a <= gapTolerance
    for (let i = 0; i < openEnds.length; i += 1) {
        if (paired.has(i)) continue;
        let bestJ = -1;
        let bestDist = gapTolerance;
        for (let j = i + 1; j < openEnds.length; j += 1) {
            if (paired.has(j) || openEnds[i].curveIdx === openEnds[j].curveIdx) continue;
            const d = distance(openEnds[i].pt, openEnds[j].pt);
            if (d > baseTol && d <= bestDist) {
                bestDist = d;
                bestJ = j;
            }
        }
        if (bestJ >= 0) {
            paired.add(i);
            paired.add(bestJ);
            bridges.push({
                kind: 'segment',
                a: { x: openEnds[i].pt.x, y: openEnds[i].pt.y },
                b: { x: openEnds[bestJ].pt.x, y: openEnds[bestJ].pt.y },
            });
        }
    }

    // 2. Ponta aberta próxima ao interior de outra curva (junção "T" com micro-fresta <= gapTolerance)
    for (let i = 0; i < openEnds.length; i += 1) {
        if (paired.has(i)) continue;
        const ep = openEnds[i];
        let bestProj = null;
        let bestDist = gapTolerance;
        for (let cIdx = 0; cIdx < primitives.length; cIdx += 1) {
            if (cIdx === ep.curveIdx) continue;
            const c = primitives[cIdx];
            const proj = closestPointOnCurve(ep.pt, c);
            const d = distance(ep.pt, proj);
            if (d > baseTol && d <= bestDist) {
                bestDist = d;
                bestProj = proj;
            }
        }
        if (bestProj) {
            paired.add(i);
            bridges.push({
                kind: 'segment',
                a: { x: ep.pt.x, y: ep.pt.y },
                b: { x: bestProj.x, y: bestProj.y },
            });
        }
    }

    return [...primitives, ...bridges];
}

// Calcula ângulo tangente de partida θ0 ∈ [0, 2π) e curvatura assinada κ de uma semi-aresta.
function halfEdgeDifferentialJet(curve, forward) {
    if (curve.kind === 'segment') {
        const p0 = forward ? curve.a : curve.b;
        const p1 = forward ? curve.b : curve.a;
        return {
            theta: canonicalAngle(Math.atan2(p1.y - p0.y, p1.x - p0.x)),
            curvature: 0,
        };
    }
    // Arco circular CCW de start a end
    if (forward) {
        const theta = canonicalAngle(curve.start + Math.PI / 2);
        return { theta, curvature: 1 / curve.radius };
    }
    const theta = canonicalAngle(curve.end - Math.PI / 2);
    return { theta, curvature: -1 / curve.radius };
}

// Área assinada exata (Teorema de Green) de um laço { vertices: [{ x, y, bulge }] }:
// A > 0 para orientação anti-horária (CCW), A < 0 para horária (CW).
export function loopSignedArea(loop) {
    const vs = Array.isArray(loop) ? loop : (loop?.vertices ?? []);
    const n = vs.length;
    if (n < 2) return 0;
    let area = 0;
    for (let i = 0; i < n; i += 1) {
        const a = vs[i];
        const b = vs[(i + 1) % n];
        area += 0.5 * (a.x * b.y - b.x * a.y);
        const bulge = a.bulge ?? 0;
        if (Math.abs(bulge) > 1e-12) {
            const chord = Math.hypot(b.x - a.x, b.y - a.y);
            if (chord > 1e-12) {
                const b2 = bulge * bulge;
                const r = (chord * (1 + b2)) / (4 * Math.abs(bulge));
                const theta = 4 * Math.atan(Math.abs(bulge));
                const segArea = 0.5 * r * r * (theta - Math.sin(theta));
                area += bulge > 0 ? segArea : -segArea;
            }
        }
    }
    return area;
}

export function loopAreaExact(loop) {
    return Math.abs(loopSignedArea(loop));
}

// Interseções analíticas de uma reta parametrizada P(t) = p0 + t*dir com as curvas de um laço.
// Também aceita a forma curta `rayLoopIntersections(loop, yProbe)` para reta horizontal y = yProbe.
// Retorna os parâmetros t (ou coordenadas X na forma curta) ordenados onde a reta cruza a fronteira do laço.
export function rayLoopIntersections(arg1, arg2, arg3) {
    const isShortForm = arg3 === undefined && arg1?.vertices && typeof arg2 === 'number';
    const loop = isShortForm ? arg1 : arg3;
    const p0 = isShortForm ? { x: 0, y: arg2 } : arg1;
    const dir = isShortForm ? { x: 1, y: 0 } : arg2;
    if (!loop?.vertices) return [];
    const curves = polylineCurves(loop.vertices, true);
    const ts = [];
    const nx = -dir.y;
    const ny = dir.x;

    // Pequeno deslocamento determinístico na normal para evitar tocar exatamente vértices degenerados
    const epsShift = isShortForm ? 0 : 1.37e-9;
    const q0 = { x: p0.x + nx * epsShift, y: p0.y + ny * epsShift };

    for (const c of curves) {
        if (c.kind === 'segment') {
            const sx = c.b.x - c.a.x;
            const sy = c.b.y - c.a.y;
            const denom = dir.x * sy - dir.y * sx;
            if (Math.abs(denom) < 1e-14) continue;
            const qpx = c.a.x - q0.x;
            const qpy = c.a.y - q0.y;
            const t = (qpx * sy - qpy * sx) / denom;
            const u = (qpx * dir.y - qpy * dir.x) / denom;
            if (u >= 0 && u < 1) {
                ts.push(t);
            }
        } else if (c.kind === 'arc') {
            const fx = q0.x - c.center.x;
            const fy = q0.y - c.center.y;
            const A = dir.x * dir.x + dir.y * dir.y;
            const B = 2 * (fx * dir.x + fy * dir.y);
            const C = fx * fx + fy * fy - c.radius * c.radius;
            const roots = solveQuadraticStable(A, B, C, 1e-14);
            if (roots.length < 2) continue; // tangência não altera paridade
            const sweep = sweepCCW(c.start, c.end);
            for (const t of roots) {
                const px = q0.x + dir.x * t;
                const py = q0.y + dir.y * t;
                const ang = normalizeAngle(Math.atan2(py - c.center.y, px - c.center.x));
                const rel = sweepCCW(c.start, ang);
                if (rel >= 0 && rel < sweep) {
                    ts.push(t);
                }
            }
        }
    }

    ts.sort((a, b) => a - b);
    return ts;
}

// Teste analítico exato de ponto no interior de um laço { vertices: [{x, y, bulge}] } (sem poligonalizar arcos).
export function pointInLoopExact(point, loop) {
    if (!point || !loop?.vertices || loop.vertices.length < 2) return false;
    const ts = rayLoopIntersections(point, { x: 1, y: 0 }, loop);
    let crossingsRight = 0;
    for (const t of ts) {
        if (t > 0) crossingsRight += 1;
    }
    return (crossingsRight & 1) === 1;
}

// Encontra um ponto estritamente no interior de um laço fechado (para consultas na Árvore de Jordan).
export function sampleInteriorPointOfLoop(loop) {
    const curves = polylineCurves(loop.vertices, true);
    if (curves.length === 0) return loop.vertices[0] ?? { x: 0, y: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of curves) {
        const b = curveBox(c);
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
    }
    const midY = 0.5 * (minY + maxY);
    const ts = rayLoopIntersections({ x: minX - 10, y: midY }, { x: 1, y: 0 }, loop);
    if (ts.length >= 2) {
        const tMid = 0.5 * (ts[0] + ts[1]);
        const cand = { x: minX - 10 + tMid, y: midY };
        if (pointInLoopExact(cand, loop)) return cand;
    }
    // Fallback: desloca levemente a partir do ponto médio da primeira aresta para a esquerda (CCW)
    const c0 = curves[0];
    const m = curveMidpointExact(c0);
    const [a, b] = curveStartEnd(c0);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const step = 1e-3 * Math.max(1e-3, Math.min(maxX - minX, maxY - minY));
    const cand1 = { x: m.x - (dy / len) * step, y: m.y + (dx / len) * step };
    if (pointInLoopExact(cand1, loop)) return cand1;
    const cand2 = { x: m.x + (dy / len) * step, y: m.y - (dx / len) * step };
    if (pointInLoopExact(cand2, loop)) return cand2;
    return { x: 0.5 * (minX + maxX), y: 0.5 * (minY + maxY) };
}

// Constrói o Arranjo Planar DCEL completo a partir de uma lista de entidades ou curvas primitivas.
export function buildPlanarArrangement(entitiesOrCurves, { tolerance = 1e-6, gapTolerance = 0 } = {}) {
    const rawCurves = [];
    for (const item of entitiesOrCurves) {
        if (!item) continue;
        if (item.kind) {
            rawCurves.push(...curveToSegmentOrArcList(item));
        } else if (item.type === 'circle') {
            rawCurves.push(...curveToSegmentOrArcList({ kind: 'circle', center: item.center, radius: item.radius }));
        } else if (item.type === 'ellipse') {
            rawCurves.push(...curveToSegmentOrArcList({
                kind: 'ellipse',
                center: item.center,
                major: item.major,
                ratio: item.ratio,
                start: item.start ?? 0,
                end: item.end ?? TWO_PI,
                full: ellipseIsFull(item),
            }));
        } else {
            for (const c of entityCurves(item)) {
                rawCurves.push(...curveToSegmentOrArcList(c));
            }
        }
    }

    if (rawCurves.length === 0) {
        return { vertices: [], halfEdges: [], boundedFaces: [], outerEnvelopes: [] };
    }

    // Passo 1: Cura de micro-frestas (HPGAPTOL)
    const healedCurves = healMicroGaps(rawCurves, gapTolerance, tolerance);

    // Passo 2: Varredura 1D (Sweep-Line por intervalo X) para encontrar todas as interseções mútuas
    const boxes = healedCurves.map((c) => curveBox(c));
    const cutLists = Array.from({ length: healedCurves.length }, () => []);
    const order = healedCurves.map((_, i) => i).sort((i, j) => boxes[i].minX - boxes[j].minX);

    for (let a = 0; a < order.length; a += 1) {
        const i = order[a];
        const bi = boxes[i];
        for (let b = a + 1; b < order.length; b += 1) {
            const j = order[b];
            const bj = boxes[j];
            if (bj.minX > bi.maxX + tolerance) break;
            if (bj.maxY < bi.minY - tolerance || bj.minY > bi.maxY + tolerance) continue;
            const hits = intersectCurves(healedCurves[i], healedCurves[j]);
            for (const h of hits) {
                const pt = h.point ?? h;
                cutLists[i].push(pt);
                cutLists[j].push(pt);
            }
        }
    }

    const splitCurves = [];
    for (let i = 0; i < healedCurves.length; i += 1) {
        splitCurves.push(...splitPrimitiveCurveAtPoints(healedCurves[i], cutLists[i], tolerance));
    }

    // Passo 3: Clusterização espacial de vértices e criação das semi-arestas gêmeas (twin half-edges)
    const cellMap = new Map();
    const vertices = [];
    const vertexFor = (p) => {
        const cx = Math.floor(p.x / tolerance);
        const cy = Math.floor(p.y / tolerance);
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                const bucket = cellMap.get(`${cx + dx}:${cy + dy}`);
                if (!bucket) continue;
                for (const v of bucket) {
                    if (distance(v.point, p) <= tolerance) return v;
                }
            }
        }
        const v = { id: vertices.length, point: { x: p.x, y: p.y }, outgoing: [], alive: true };
        vertices.push(v);
        const key = `${cx}:${cy}`;
        if (!cellMap.has(key)) cellMap.set(key, []);
        cellMap.get(key).push(v);
        return v;
    };

    const undirectedEdges = [];
    const edgeMidKeySet = new Set();

    for (const c of splitCurves) {
        const [pA, pB] = curveStartEnd(c);
        const vA = vertexFor(pA);
        const vB = vertexFor(pB);
        if (vA === vB) continue;
        const mid = curveMidpointExact(c);
        const minId = Math.min(vA.id, vB.id);
        const maxId = Math.max(vA.id, vB.id);
        const dedupKey = `${minId}:${maxId}:${Math.round(mid.x / tolerance)}:${Math.round(mid.y / tolerance)}`;
        if (edgeMidKeySet.has(dedupKey)) continue;
        edgeMidKeySet.add(dedupKey);

        const edge = { id: undirectedEdges.length, curve: c, vA, vB, alive: true };
        undirectedEdges.push(edge);
        vA.outgoing.push({ edge, from: vA, to: vB, forward: true });
        vB.outgoing.push({ edge, from: vB, to: vA, forward: false });
    }

    // Poda iterativa de pontas abertas (vértices de grau 1)
    const pruneQueue = [];
    const activeDegree = (v) => v.outgoing.reduce((acc, h) => acc + (h.edge.alive ? 1 : 0), 0);
    for (const v of vertices) {
        if (activeDegree(v) === 1) pruneQueue.push(v);
    }
    while (pruneQueue.length > 0) {
        const v = pruneQueue.pop();
        for (const h of v.outgoing) {
            if (!h.edge.alive) continue;
            h.edge.alive = false;
            const nb = h.to;
            if (activeDegree(nb) === 1) {
                pruneQueue.push(nb);
            }
        }
    }

    // Passo 4: Construção do DCEL sobre as arestas sobreviventes e ordenação angular + curvatura κ
    const halfEdges = [];
    for (const v of vertices) {
        v.outgoing = v.outgoing.filter((h) => h.edge.alive);
    }

    const edgeToHalfPair = new Map();
    for (const edge of undirectedEdges) {
        if (!edge.alive) continue;
        const jetFwd = halfEdgeDifferentialJet(edge.curve, true);
        const jetRev = halfEdgeDifferentialJet(edge.curve, false);
        const hFwd = {
            id: halfEdges.length,
            edge,
            origin: edge.vA,
            dest: edge.vB,
            forward: true,
            theta: jetFwd.theta,
            curvature: jetFwd.curvature,
            twin: null,
            next: null,
            visited: false,
        };
        halfEdges.push(hFwd);
        const hRev = {
            id: halfEdges.length,
            edge,
            origin: edge.vB,
            dest: edge.vA,
            forward: false,
            theta: jetRev.theta,
            curvature: jetRev.curvature,
            twin: hFwd,
            next: null,
            visited: false,
        };
        hFwd.twin = hRev;
        halfEdges.push(hRev);
        edgeToHalfPair.set(edge.id, [hFwd, hRev]);
    }

    for (const v of vertices) {
        v.halfEdges = [];
    }
    for (const h of halfEdges) {
        h.origin.halfEdges.push(h);
    }

    for (const v of vertices) {
        if (v.halfEdges.length === 0) continue;
        v.halfEdges.sort((a, b) => {
            const dTheta = a.theta - b.theta;
            if (Math.abs(dTheta) > 1e-7) return dTheta;
            // Desempate exato por curvatura assinada κ em tangências reta-arco ou arco-arco
            return a.curvature - b.curvature;
        });
        v.halfEdges.forEach((h, idx) => {
            h.orderInOrigin = idx;
        });
    }

    // Ligação topológica planar: next(h) = predecessor CCW de twin(h) no vértice destino
    for (const h of halfEdges) {
        const destList = h.dest.halfEdges;
        const deg = destList.length;
        if (deg === 0) continue;
        const twinIdx = h.twin.orderInOrigin;
        h.next = destList[(twinIdx - 1 + deg) % deg];
    }

    // Extração de todos os ciclos faciais fechados
    const boundedFaces = [];
    const outerEnvelopes = [];

    for (const seed of halfEdges) {
        if (seed.visited || !seed.next) continue;
        const cycle = [];
        let cur = seed;
        let guard = 0;
        while (cur && !cur.visited && guard <= halfEdges.length + 2) {
            cur.visited = true;
            cycle.push(cur);
            cur = cur.next;
            guard += 1;
            if (cur === seed) break;
        }
        if (cur !== seed || cycle.length < 2) continue;

        const loopVertices = cycle.map((h) => {
            const c = h.edge.curve;
            let bulge = 0;
            if (c.kind === 'arc') {
                const sweep = sweepCCW(c.start, c.end);
                bulge = sweepToBulgeRational(sweep) * (h.forward ? 1 : -1);
            }
            return {
                x: h.origin.point.x,
                y: h.origin.point.y,
                bulge,
            };
        });

        const loop = { vertices: loopVertices };
        const signedArea = loopSignedArea(loop);
        if (Math.abs(signedArea) <= 1e-9) continue;

        if (signedArea > 0) {
            boundedFaces.push({ loop, signedArea, area: signedArea });
        } else {
            // Ciclo horário externo (borda envolvente da componente conexa)
            const ccwVertices = [];
            for (let i = cycle.length - 1; i >= 0; i -= 1) {
                const h = cycle[i].twin;
                const c = h.edge.curve;
                let bulge = 0;
                if (c.kind === 'arc') {
                    const sweep = sweepCCW(c.start, c.end);
                    bulge = sweepToBulgeRational(sweep) * (h.forward ? 1 : -1);
                }
                ccwVertices.push({
                    x: h.origin.point.x,
                    y: h.origin.point.y,
                    bulge,
                });
            }
            outerEnvelopes.push({
                loop: { vertices: ccwVertices },
                signedArea: -signedArea,
                area: -signedArea,
            });
        }
    }

    return {
        vertices,
        halfEdges,
        boundedFaces,
        outerEnvelopes,
    };
}

function canonicalLoopKey(loop) {
    const pts = (loop?.vertices ?? []).map((v) => `${v.x.toFixed(5)},${v.y.toFixed(5)},${Math.abs(v.bulge ?? 0).toFixed(5)}`);
    return [...pts].sort().join(';');
}

// Extrai todos os laços fechados de um conjunto de entidades (incluindo faces formadas por junções T/X).
export function extractPlanarLoops(entitiesOrCurves, { tolerance = 1e-6, gapTolerance = 0, includeOuterEnvelopes = false } = {}) {
    const dcel = buildPlanarArrangement(entitiesOrCurves, { tolerance, gapTolerance });
    const seen = new Set();
    const out = [];
    for (const f of dcel.boundedFaces) {
        const key = canonicalLoopKey(f.loop);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(f.loop);
        }
    }
    if (includeOuterEnvelopes) {
        for (const env of dcel.outerEnvelopes) {
            const key = canonicalLoopKey(env.loop);
            if (!seen.has(key)) {
                seen.add(key);
                out.push(env.loop);
            }
        }
    }
    return out;
}

// Constrói a Árvore de Contenção de Jordan sobre um conjunto de laços candidatos a partir de um ponto clicado,
// suportando aninhamento arbitrário (níveis 0, 1, 2, ..., 6+) e os modos 'nested' ('normal'), 'outer' e 'ignore'.
export function buildJordanIslandTree(point, loops, islands = 'nested') {
    const mode = islands === 'normal' ? 'nested' : islands;
    const seenKeys = new Set();
    const shapes = [];

    for (const loop of loops) {
        if (!loop?.vertices || loop.vertices.length < 2) continue;
        const area = loopAreaExact(loop);
        if (!(area > 1e-9)) continue;
        const key = canonicalLoopKey(loop);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const curves = polylineCurves(loop.vertices, true);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const c of curves) {
            const b = curveBox(c);
            if (b.minX < minX) minX = b.minX;
            if (b.minY < minY) minY = b.minY;
            if (b.maxX > maxX) maxX = b.maxX;
            if (b.maxY > maxY) maxY = b.maxY;
        }
        shapes.push({
            loop,
            area,
            box: { minX, minY, maxX, maxY },
            samplePoint: sampleInteriorPointOfLoop(loop),
            children: [],
            parent: null,
            depth: 0,
        });
    }

    const containsPoint = (shape, p) => (
        p.x >= shape.box.minX - 1e-9 &&
        p.x <= shape.box.maxX + 1e-9 &&
        p.y >= shape.box.minY - 1e-9 &&
        p.y <= shape.box.maxY + 1e-9 &&
        pointInLoopExact(p, shape.loop)
    );

    // O menor contorno que envolve o ponto clicado é a raiz F0 (profundidade 0)
    const attachMeta = (arr, outerLoop, maxDepthVal) => {
        Object.defineProperties(arr, {
            loops: { value: arr, enumerable: false, configurable: true },
            outer: { value: outerLoop, enumerable: false, configurable: true },
            maxDepth: { value: maxDepthVal, enumerable: false, configurable: true },
        });
        return arr;
    };
    const enclosing = shapes.filter((s) => containsPoint(s, point)).sort((a, b) => a.area - b.area);
    if (enclosing.length === 0) return attachMeta([], null, 0);
    const root = enclosing[0];
    if (mode === 'ignore') return attachMeta([root.loop], root.loop, 0);

    // Um contorno C está estritamente contido em H se tem área menor, caixa dentro de H,
    // seu ponto interno e seus vértices estão dentro de H (ou sobre a borda) e NÃO contém o ponto de clique.
    const isStrictlyInside = (child, host) => {
        if (child === host || child.area >= host.area * (1 - 1e-9)) return false;
        if (
            child.box.minX < host.box.minX - 1e-6 ||
            child.box.maxX > host.box.maxX + 1e-6 ||
            child.box.minY < host.box.minY - 1e-6 ||
            child.box.maxY > host.box.maxY + 1e-6
        ) {
            return false;
        }
        if (!containsPoint(host, child.samplePoint)) return false;
        // Verifica pontos médios das arestas de child para evitar que uma célula vizinha seja tomada como filha
        const childCurves = polylineCurves(child.loop.vertices, true);
        const step = Math.max(1, Math.floor(childCurves.length / 8));
        for (let i = 0; i < childCurves.length; i += step) {
            const m = curveMidpointExact(childCurves[i]);
            if (!containsPoint(host, m)) {
                // Pode tocar na borda? Se a distância à borda de host for > 1e-5, está fora.
                const hostCurves = polylineCurves(host.loop.vertices, true);
                const dBorder = Math.min(...hostCurves.map((hc) => distance(m, closestPointOnCurve(m, hc))));
                if (dBorder > 1e-5) return false;
            }
        }
        return true;
    };

    const innerShapes = shapes
        .filter((s) => s !== root && !containsPoint(s, point) && isStrictlyInside(s, root))
        .sort((a, b) => b.area - a.area); // Do maior para o menor

    const treeNodes = [root];
    for (const s of innerShapes) {
        // Pai imediato é o menor nó já inserido na árvore que contém estritamente `s`
        let bestParent = root;
        for (const cand of treeNodes) {
            if (cand !== root && cand.area < bestParent.area && isStrictlyInside(s, cand)) {
                bestParent = cand;
            }
        }
        s.parent = bestParent;
        s.depth = bestParent.depth + 1;
        bestParent.children.push(s);
        treeNodes.push(s);
    }

    const maxDepth = treeNodes.reduce((m, n) => Math.max(m, n.depth), 0);
    if (mode === 'outer') {
        return attachMeta([root.loop, ...root.children.map((c) => c.loop)], root.loop, Math.min(1, maxDepth));
    }

    // Modo 'nested' / 'normal': retorna a raiz (nível 0) e todos os níveis aninhados (1, 2, 3, ..., d)
    return attachMeta(treeNodes.map((n) => n.loop), root.loop, maxDepth);
}

// Detecta automaticamente o contorno fechado e suas ilhas em torno de `point` a partir de entidades brutas
// (com junções T/X, linhas que se cruzam e micro-gaps HPGAPTOL).
export function detectHatchBoundary(point, entities, { islands = 'nested', tolerance = 1e-6, gapTolerance = 0 } = {}) {
    const loops = extractPlanarLoops(entities, {
        tolerance,
        gapTolerance,
        includeOuterEnvelopes: true,
    });
    return buildJordanIslandTree(point, loops, islands);
}
