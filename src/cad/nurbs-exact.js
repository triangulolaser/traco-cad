// Kernel analítico exato para curvas B-Spline Racionais (NURBS) e curvas de Bézier racionais:
// - Avaliação de jato diferencial (C(t), C'(t), C''(t) e curvatura κ)
// - Inserção exata de nós de Boehm (Algorithm A5.1, The NURBS Book)
// - Extração exata de segmentos de Bézier racionais e subdivisão de de Casteljau
// - Subdivisão exata de splines (splitSplineExact)
// - Projeção ortogonal (NEA), pés de perpendicular (PER), tangentes (TAN),
//   extremos/quadrantes (QUA), bounding box exato e quadratura de Gauss-Legendre.

import { solveBernsteinRoots, solveQuadraticStable } from './predicates.js';

// Pesos e abscissas de Gauss-Legendre de 8 pontos em [0, 1]
const GL8_U = [
    0.019855071751231884,
    0.10166676129318663,
    0.2372337950418355,
    0.4082826787521751,
    0.5917173212478249,
    0.7627662049581645,
    0.8983332387068134,
    0.9801449282487681,
];
const GL8_W = [
    0.05061426814518813,
    0.11119051722668723,
    0.15685332293894364,
    0.181341891689181,
    0.181341891689181,
    0.15685332293894364,
    0.11119051722668723,
    0.05061426814518813,
];

function binomial(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    let res = 1;
    const m = Math.min(k, n - k);
    for (let i = 1; i <= m; i += 1) {
        res = (res * (n - m + i)) / i;
    }
    return res;
}

// ---------------------------------------------------------------------------
// 1. Avaliação de Bézier Racional e Jato Diferencial (0ª, 1ª e 2ª derivadas)

function toHomogeneousBezier(curve) {
    const pts = curve.points ?? curve.controlPoints ?? [];
    const n = pts.length - 1;
    const weights = curve.weights;
    const hasW = Boolean(weights && weights.length === pts.length);
    const hw = new Array(n + 1);
    for (let i = 0; i <= n; i += 1) {
        const w = hasW ? (weights[i] ?? 1) : 1;
        hw[i] = { wx: pts[i].x * w, wy: pts[i].y * w, w };
    }
    return { hw, hasW, degree: n };
}

// Avalia ponto, 1ª e 2ª derivadas (em relação a u ∈ [0,1]) e curvatura κ de um segmento Bézier racional.
export function evalBezierJet(curve, u) {
    const { hw, degree: n } = toHomogeneousBezier(curve);
    if (n <= 0) {
        const p = curve.points[0] ?? { x: 0, y: 0 };
        return { point: { x: p.x, y: p.y }, d1: { x: 0, y: 0 }, d2: { x: 0, y: 0 }, curvature: 0 };
    }

    const uu = Math.min(1, Math.max(0, u));
    const oneMinusU = 1 - uu;

    // Passo de de Casteljau até nível n-2 para extrair diferenças de 1ª e 2ª ordem exatas
    let curr = hw.map((p) => ({ ...p }));
    let level2 = null;
    let level1 = null;

    if (n === 1) {
        level1 = curr.map((p) => ({ ...p }));
    }

    for (let r = 1; r <= n; r += 1) {
        if (r === n - 1) level2 = curr.slice(0, 3).map((p) => ({ ...p }));
        if (r === n) level1 = curr.slice(0, 2).map((p) => ({ ...p }));
        for (let i = 0; i <= n - r; i += 1) {
            curr[i] = {
                wx: oneMinusU * curr[i].wx + uu * curr[i + 1].wx,
                wy: oneMinusU * curr[i].wy + uu * curr[i + 1].wy,
                w: oneMinusU * curr[i].w + uu * curr[i + 1].w,
            };
        }
    }

    const A = curr[0];
    const W = Math.abs(A.w) > 1e-15 ? A.w : 1;
    const x = A.wx / W;
    const y = A.wy / W;

    // 1ª derivada homogênea A'(u) = n * (level1[1] - level1[0])
    const dAx = n * (level1[1].wx - level1[0].wx);
    const dAy = n * (level1[1].wy - level1[0].wy);
    const dW = n * (level1[1].w - level1[0].w);

    const dx = (dAx - dW * x) / W;
    const dy = (dAy - dW * y) / W;

    // 2ª derivada homogênea A''(u) = n*(n-1)*(level2[2] - 2*level2[1] + level2[0])
    let d2x = 0;
    let d2y = 0;
    if (n >= 2 && level2) {
        const k2 = n * (n - 1);
        const d2Ax = k2 * (level2[2].wx - 2 * level2[1].wx + level2[0].wx);
        const d2Ay = k2 * (level2[2].wy - 2 * level2[1].wy + level2[0].wy);
        const d2W = k2 * (level2[2].w - 2 * level2[1].w + level2[0].w);
        d2x = (d2Ax - 2 * dW * dx - d2W * x) / W;
        d2y = (d2Ay - 2 * dW * dy - d2W * y) / W;
    }

    const speed2 = dx * dx + dy * dy;
    const denom = Math.pow(speed2, 1.5);
    const curvature = denom > 1e-18 ? (dx * d2y - dy * d2x) / denom : 0;

    return {
        point: { x, y },
        d1: { x: dx, y: dy },
        d2: { x: d2x, y: d2y },
        curvature,
    };
}

export function evalBezierPoint(curve, u) {
    return evalBezierJet(curve, u).point;
}

export function bezierCurvature(curve, u) {
    return evalBezierJet(curve, u).curvature;
}

// Subdivide um segmento de Bézier racional em u ∈ (0, 1) via de Casteljau homogêneo.
export function subdivideBezier(curve, u = 0.5) {
    const { hw, hasW, degree: n } = toHomogeneousBezier(curve);
    const oneMinusU = 1 - u;
    const leftH = new Array(n + 1);
    const rightH = new Array(n + 1);
    const work = hw.map((p) => ({ ...p }));

    leftH[0] = { ...work[0] };
    rightH[n] = { ...work[n] };

    for (let r = 1; r <= n; r += 1) {
        for (let i = 0; i <= n - r; i += 1) {
            work[i] = {
                wx: oneMinusU * work[i].wx + u * work[i + 1].wx,
                wy: oneMinusU * work[i].wy + u * work[i + 1].wy,
                w: oneMinusU * work[i].w + u * work[i + 1].w,
            };
        }
        leftH[r] = { ...work[0] };
        rightH[n - r] = { ...work[n - r] };
    }

    const fromH = (arr) => {
        const points = arr.map((p) => {
            const w = Math.abs(p.w) > 1e-15 ? p.w : 1;
            return { x: p.wx / w, y: p.wy / w };
        });
        const weights = hasW ? arr.map((p) => p.w) : null;
        return { points, weights };
    };

    const L = fromH(leftH);
    const R = fromH(rightH);
    const t0 = curve.t0 ?? 0;
    const t1 = curve.t1 ?? 1;
    const tm = t0 + (t1 - t0) * u;

    return [
        {
            ...curve,
            kind: 'bezier',
            degree: n,
            points: L.points,
            weights: L.weights,
            t0,
            t1: tm,
            isFirst: Boolean(curve.isFirst),
            isLast: false,
        },
        {
            ...curve,
            kind: 'bezier',
            degree: n,
            points: R.points,
            weights: R.weights,
            t0: tm,
            t1,
            isFirst: false,
            isLast: Boolean(curve.isLast),
        },
    ];
}

// Extrai o sub-ramo [u0, u1] ⊆ [0, 1] de um segmento Bézier racional.
export function clipBezierInterval(curve, u0, u1) {
    const a = Math.max(0, Math.min(1, u0));
    const b = Math.max(0, Math.min(1, u1));
    if (a <= 1e-15 && b >= 1 - 1e-15) return curve;
    let sub = curve;
    if (a > 1e-15) {
        sub = subdivideBezier(sub, a)[1];
    }
    if (b < 1 - 1e-15) {
        const localB = (b - a) / Math.max(1e-15, 1 - a);
        sub = subdivideBezier(sub, Math.min(1, Math.max(0, localB)))[0];
    }
    return sub;
}

// ---------------------------------------------------------------------------
// 2. Inserção de Nós de Boehm e Extração Exata de Bézier para B-Splines / NURBS

function findSpan(n, degree, u, knots) {
    if (u >= knots[n + 1] - 1e-14) return n;
    if (u <= knots[degree] + 1e-14) return degree;
    let low = degree;
    let high = n + 1;
    let mid = Math.floor((low + high) / 2);
    while (u < knots[mid] || u >= knots[mid + 1]) {
        if (u < knots[mid]) high = mid;
        else low = mid;
        mid = Math.floor((low + high) / 2);
    }
    return mid;
}

function knotMultiplicity(knots, u, tol = 1e-12) {
    let s = 0;
    for (let i = 0; i < knots.length; i += 1) {
        if (Math.abs(knots[i] - u) <= tol) s += 1;
    }
    return s;
}

// Algoritmo A2.3 (The NURBS Book): funções base e derivadas até ordem `nder`.
export function dersBasisFuns(span, u, degree, nDer, knots) {
    const ndu = Array.from({ length: degree + 1 }, () => new Array(degree + 1).fill(0));
    const left = new Array(degree + 1).fill(0);
    const right = new Array(degree + 1).fill(0);
    ndu[0][0] = 1.0;

    for (let j = 1; j <= degree; j += 1) {
        left[j] = u - knots[span + 1 - j];
        right[j] = knots[span + j] - u;
        let saved = 0.0;
        for (let r = 0; r < j; r += 1) {
            ndu[j][r] = right[r + 1] + left[j - r];
            const temp = Math.abs(ndu[j][r]) > 1e-18 ? ndu[r][j - 1] / ndu[j][r] : 0;
            ndu[r][j] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        ndu[j][j] = saved;
    }

    const ders = Array.from({ length: nDer + 1 }, () => new Array(degree + 1).fill(0));
    for (let j = 0; j <= degree; j += 1) {
        ders[0][j] = ndu[j][degree];
    }

    const a = [new Array(degree + 1).fill(0), new Array(degree + 1).fill(0)];
    for (let r = 0; r <= degree; r += 1) {
        let s1 = 0;
        let s2 = 1;
        a[0][0] = 1.0;
        for (let k = 1; k <= nDer; k += 1) {
            let d = 0.0;
            const rk = r - k;
            const pk = degree - k;
            if (r >= k) {
                const denom = ndu[pk + 1][rk];
                a[s2][0] = Math.abs(denom) > 1e-18 ? a[s1][0] / denom : 0;
                d = a[s2][0] * ndu[rk][pk];
            }
            const j1 = rk >= -1 ? 1 : -rk;
            const j2 = r - 1 <= pk ? k - 1 : degree - r;
            for (let j = j1; j <= j2; j += 1) {
                const denom = ndu[pk + 1][rk + j];
                a[s2][j] = Math.abs(denom) > 1e-18 ? (a[s1][j] - a[s1][j - 1]) / denom : 0;
                d += a[s2][j] * ndu[rk + j][pk];
            }
            if (r <= pk) {
                const denom = ndu[pk + 1][r];
                a[s2][k] = Math.abs(denom) > 1e-18 ? -a[s1][k - 1] / denom : 0;
                d += a[s2][k] * ndu[r][pk];
            }
            ders[k][r] = d;
            [s1, s2] = [s2, s1];
        }
    }

    let fac = degree;
    for (let k = 1; k <= nDer; k += 1) {
        for (let j = 0; j <= degree; j += 1) {
            ders[k][j] *= fac;
        }
        fac *= degree - k;
    }

    return ders;
}

function ensureSplineKnots(spline) {
    if (!spline || !spline.controlPoints || spline.controlPoints.length < 2) return spline;
    const n = spline.controlPoints.length;
    const p = Math.min(spline.degree ?? 3, n - 1);
    if (Array.isArray(spline.knots) && spline.knots.length >= n + p + 1) {
        return spline.degree === p ? spline : { ...spline, degree: p };
    }
    const spans = n - p;
    const knots = [
        ...new Array(p + 1).fill(0),
        ...Array.from({ length: Math.max(0, spans - 1) }, (_, i) => (i + 1) / spans),
        ...new Array(p + 1).fill(1),
    ];
    return { ...spline, degree: p, knots };
}

// Avaliação analítica direta na spline (ponto, 1ª e 2ª derivadas e curvatura κ).
export function evaluateSplineJet(rawSpline, t) {
    const spline = ensureSplineKnots(rawSpline);
    const { degree, knots, controlPoints, weights } = spline;
    const n = controlPoints.length - 1;
    const tMin = knots[degree];
    const tMax = knots[n + 1];
    const u = Math.min(Math.max(t, tMin), tMax);
    const span = findSpan(n, degree, u, knots);
    const maxDer = Math.min(2, degree);
    const ders = dersBasisFuns(span, u, degree, maxDer, knots);
    const hasW = Boolean(weights && weights.length === controlPoints.length);

    let Ax = 0; let Ay = 0; let W = 0;
    let dAx = 0; let dAy = 0; let dW = 0;
    let d2Ax = 0; let d2Ay = 0; let d2W = 0;

    for (let j = 0; j <= degree; j += 1) {
        const idx = span - degree + j;
        const p = controlPoints[idx];
        const w = hasW ? (weights[idx] ?? 1) : 1;
        const n0 = ders[0][j] * w;
        Ax += n0 * p.x;
        Ay += n0 * p.y;
        W += n0;

        if (maxDer >= 1) {
            const n1 = ders[1][j] * w;
            dAx += n1 * p.x;
            dAy += n1 * p.y;
            dW += n1;
        }
        if (maxDer >= 2) {
            const n2 = ders[2][j] * w;
            d2Ax += n2 * p.x;
            d2Ay += n2 * p.y;
            d2W += n2;
        }
    }

    const wSafe = Math.abs(W) > 1e-15 ? W : 1;
    const x = Ax / wSafe;
    const y = Ay / wSafe;
    const dx = (dAx - dW * x) / wSafe;
    const dy = (dAy - dW * y) / wSafe;
    const d2x = (d2Ax - 2 * dW * dx - d2W * x) / wSafe;
    const d2y = (d2Ay - 2 * dW * dy - d2W * y) / wSafe;

    const speed2 = dx * dx + dy * dy;
    const denom = Math.pow(speed2, 1.5);
    const curvature = denom > 1e-18 ? (dx * d2y - dy * d2x) / denom : 0;

    return {
        point: { x, y },
        d1: { x: dx, y: dy },
        d2: { x: d2x, y: d2y },
        curvature,
    };
}

// Inserção de nó de Boehm (The NURBS Book, Algorithm A5.1).
// Insere o nó `u` `times` vezes sem alterar a forma geométrica da NURBS.
export function insertKnotBoehm(rawSpline, u, times = 1) {
    const spline = ensureSplineKnots(rawSpline);
    if (times <= 0) return spline;
    const { degree: p, knots: U, controlPoints: P, weights } = spline;
    const np = P.length - 1;
    const mp = U.length - 1;
    const hasW = Boolean(weights && weights.length === P.length);

    const Pw = P.map((pt, i) => {
        const w = hasW ? (weights[i] ?? 1) : 1;
        return { wx: pt.x * w, wy: pt.y * w, w };
    });

    // Localiza span k tal que U[k] <= u < U[k+1]
    let k = p;
    for (let i = 0; i < mp; i += 1) {
        if (u >= U[i] - 1e-12 && u < U[i + 1] - 1e-12) {
            k = i;
            break;
        }
        if (Math.abs(u - U[i]) <= 1e-12 && i >= p) {
            k = i;
        }
    }
    const s = knotMultiplicity(U, u, 1e-12);
    const r = Math.min(times, Math.max(0, p - s));
    if (r <= 0) return spline;

    const nq = np + r;
    const UQ = new Array(mp + r + 1);
    const Qw = new Array(nq + 1);
    const Rw = new Array(p + 1);

    for (let i = 0; i <= k; i += 1) UQ[i] = U[i];
    for (let i = 1; i <= r; i += 1) UQ[k + i] = u;
    for (let i = k + 1; i <= mp; i += 1) UQ[i + r] = U[i];

    for (let i = 0; i <= k - p; i += 1) Qw[i] = { ...Pw[i] };
    for (let i = k - s; i <= np; i += 1) Qw[i + r] = { ...Pw[i] };
    for (let i = 0; i <= p - s; i += 1) Rw[i] = { ...Pw[k - p + i] };

    let L = k - p;
    for (let j = 1; j <= r; j += 1) {
        L = k - p + j;
        for (let i = 0; i <= p - j - s; i += 1) {
            const denom = U[i + k + 1] - U[L + i];
            const alpha = Math.abs(denom) > 1e-15 ? (u - U[L + i]) / denom : 0;
            Rw[i] = {
                wx: alpha * Rw[i + 1].wx + (1 - alpha) * Rw[i].wx,
                wy: alpha * Rw[i + 1].wy + (1 - alpha) * Rw[i].wy,
                w: alpha * Rw[i + 1].w + (1 - alpha) * Rw[i].w,
            };
        }
        Qw[L] = { ...Rw[0] };
        Qw[k + r - j - s] = { ...Rw[p - j - s] };
    }

    for (let i = L + 1; i < k - s; i += 1) {
        Qw[i] = { ...Rw[i - L] };
    }

    const newPoints = Qw.map((q) => {
        const w = Math.abs(q.w) > 1e-15 ? q.w : 1;
        return { x: q.wx / w, y: q.wy / w };
    });
    const newWeights = hasW ? Qw.map((q) => q.w) : undefined;

    return {
        ...spline,
        knots: UQ,
        controlPoints: newPoints,
        ...(hasW ? { weights: newWeights } : {}),
    };
}

// Garante que uma spline aberta ou periódica tenha nós das extremidades do domínio [U[p], U[n+1]]
// com multiplicidade p+1 (clamped) via inserção de Boehm.
export function clampSplineDomain(rawSpline) {
    if (!rawSpline || !rawSpline.controlPoints || rawSpline.controlPoints.length < 2) return rawSpline;
    const spline = ensureSplineKnots(rawSpline);
    const p = spline.degree;
    const n = spline.controlPoints.length - 1;
    const tMin = spline.knots[p];
    const tMax = spline.knots[n + 1];

    let cur = spline;
    const multMin = knotMultiplicity(cur.knots, tMin, 1e-12);
    if (multMin < p) {
        cur = insertKnotBoehm(cur, tMin, p - multMin);
    }
    const multMax = knotMultiplicity(cur.knots, tMax, 1e-12);
    if (multMax < p) {
        cur = insertKnotBoehm(cur, tMax, p - multMax);
    }

    const finalMultMin = knotMultiplicity(cur.knots, tMin, 1e-12);
    const finalMultMax = knotMultiplicity(cur.knots, tMax, 1e-12);
    if (finalMultMin >= p + 1 && finalMultMax >= p + 1 && cur.knots[0] >= tMin - 1e-12 && cur.knots[cur.knots.length - 1] <= tMax + 1e-12) {
        return cur;
    }

    const firstMin = cur.knots.findIndex((u) => Math.abs(u - tMin) <= 1e-12);
    const firstMax = cur.knots.findIndex((u) => Math.abs(u - tMax) <= 1e-12);
    const cpStart = finalMultMin >= p + 1 ? firstMin : firstMin - 1;
    const cpEndInclusive = firstMax - 1;
    const midKnots = cur.knots.filter((k) => k > tMin + 1e-12 && k < tMax - 1e-12);
    const knots = [
        ...new Array(p + 1).fill(tMin),
        ...midKnots,
        ...new Array(p + 1).fill(tMax),
    ];
    const controlPoints = cur.controlPoints.slice(cpStart, cpEndInclusive + 1);
    const weights = cur.weights ? cur.weights.slice(cpStart, cpEndInclusive + 1) : undefined;
    return {
        ...cur,
        knots,
        controlPoints,
        ...(weights ? { weights } : {}),
    };
}

// Decompõe uma spline NURBS em segmentos de Bézier racionais matematicamente exatos
// via inserção de nós de Boehm até multiplicidade `p` nos nós internos.
export function splineToBeziers(spline, { minSegments = 12 } = {}) {
    if (!spline || !spline.controlPoints || spline.controlPoints.length < 2) return [];
    const clamped = clampSplineDomain(spline);
    const p = clamped.degree;
    const n0 = clamped.controlPoints.length - 1;
    const tMin = clamped.knots[p];
    const tMax = clamped.knots[n0 + 1];

    // Coleta nós internos distintos em (tMin, tMax)
    const interiorKnots = [];
    for (let i = p + 1; i <= n0; i += 1) {
        const u = clamped.knots[i];
        if (u > tMin + 1e-12 && u < tMax - 1e-12) {
            if (interiorKnots.length === 0 || Math.abs(u - interiorKnots[interiorKnots.length - 1]) > 1e-12) {
                interiorKnots.push(u);
            }
        }
    }

    let decomposed = clamped;
    for (const u of interiorKnots) {
        const mult = knotMultiplicity(decomposed.knots, u, 1e-12);
        if (mult < p) {
            decomposed = insertKnotBoehm(decomposed, u, p - mult);
        }
    }

    const spanBounds = [tMin, ...interiorKnots, tMax];
    const numSpans = spanBounds.length - 1;
    const hasW = Boolean(decomposed.weights && decomposed.weights.length === decomposed.controlPoints.length);

    const rawBeziers = [];
    for (let s = 0; s < numSpans; s += 1) {
        const idx = s * p;
        const points = decomposed.controlPoints.slice(idx, idx + p + 1).map((pt) => ({ x: pt.x, y: pt.y }));
        const weights = hasW ? decomposed.weights.slice(idx, idx + p + 1) : null;
        if (points.length === p + 1) {
            rawBeziers.push({
                kind: 'bezier',
                degree: p,
                points,
                weights,
                t0: spanBounds[s],
                t1: spanBounds[s + 1],
                closed: Boolean(spline.closed),
            });
        }
    }

    if (rawBeziers.length === 0) return [];

    // Se minSegments > rawBeziers.length, subdivide via de Casteljau exato para obter AABBs justas
    // e manter compatibilidade com consumidores que esperam múltiplos sub-trechos por spline.
    const subPerSpan = Math.max(1, Math.ceil(minSegments / rawBeziers.length));
    let out = [];
    for (const bz of rawBeziers) {
        if (subPerSpan <= 1) {
            out.push(bz);
        } else {
            let pieces = [bz];
            let rem = subPerSpan;
            let cur = bz;
            const spanList = [];
            for (let k = 1; k < subPerSpan; k += 1) {
                const uSplit = 1 / rem;
                const [left, right] = subdivideBezier(cur, uSplit);
                spanList.push(left);
                cur = right;
                rem -= 1;
            }
            spanList.push(cur);
            void pieces;
            out.push(...spanList);
        }
    }

    for (let i = 0; i < out.length; i += 1) {
        out[i].isFirst = i === 0;
        out[i].isLast = i === out.length - 1;
        out[i].segmentIndex = i;
    }

    return out;
}

// Subdivide exatamente uma entidade SPLINE nos parâmetros `params` (em unidades de nó da spline)
// usando inserção de nós de Boehm até multiplicidade p+1.
export function splitSplineExact(spline, params) {
    if (!spline || !spline.controlPoints || spline.controlPoints.length < 2) return [spline];
    const clamped = clampSplineDomain(spline);
    const p = clamped.degree;
    const n0 = clamped.controlPoints.length - 1;
    const tMin = clamped.knots[p];
    const tMax = clamped.knots[n0 + 1];
    const spanLen = tMax - tMin;
    if (spanLen <= 1e-12) return [spline];

    const paramList = typeof params === 'number' ? [params] : [...(params ?? [])];
    const sorted = paramList
        .filter((u) => u > tMin + 1e-9 * spanLen && u < tMax - 1e-9 * spanLen)
        .sort((a, b) => a - b);

    const unique = [];
    for (const u of sorted) {
        if (unique.length === 0 || Math.abs(u - unique[unique.length - 1]) > 1e-9 * spanLen) {
            unique.push(u);
        }
    }
    if (unique.length === 0) return [spline];

    let cur = clamped;
    for (const u of unique) {
        const mult = knotMultiplicity(cur.knots, u, 1e-12);
        if (mult < p) {
            cur = insertKnotBoehm(cur, u, p - mult);
        }
    }

    const cuts = [tMin, ...unique, tMax];
    const pieces = [];
    for (let s = 0; s < cuts.length - 1; s += 1) {
        const uA = cuts[s];
        const uB = cuts[s + 1];
        const cpA = s === 0 ? 0 : cur.knots.findIndex((k) => Math.abs(k - uA) <= 1e-12) - 1;
        const cpB = cur.knots.findIndex((k) => Math.abs(k - uB) <= 1e-12) - 1;
        const midKnots = cur.knots.filter((k) => k > uA + 1e-12 && k < uB - 1e-12);
        const subKnots = [
            ...new Array(p + 1).fill(uA),
            ...midKnots,
            ...new Array(p + 1).fill(uB),
        ];
        const subCP = cur.controlPoints.slice(cpA, cpB + 1).map((pt) => ({ x: pt.x, y: pt.y }));
        const subW = cur.weights ? cur.weights.slice(cpA, cpB + 1) : undefined;

        const piece = {
            ...spline,
            id: undefined,
            degree: p,
            knots: subKnots,
            controlPoints: subCP,
            closed: false,
        };
        delete piece.fitPoints;
        delete piece._sampledPts;
        delete piece._bbox;
        delete piece._beziers;
        if (subW) piece.weights = subW;
        pieces.push(piece);
    }

    return pieces;
}

// ---------------------------------------------------------------------------
// 3. Projeção Ortogonal Exata (NEA), Perpendicular (PER), Tangentes (TAN) e Extremos (QUA)

// Projeta um ponto P sobre um segmento de Bézier racional com precisão < 10^-14 via
// amostragem + refinamento de Newton-Raphson sobre f(u) = (C(u) - P)·C'(u) = 0.
export function closestPointOnBezier(arg1, arg2) {
    const [p, curve] = arg1 && arg1.points ? [arg2, arg1] : [arg1, arg2];
    const n = curve.points.length - 1;
    if (n <= 0) {
        const pt = curve.points[0] ?? { x: 0, y: 0 };
        const distSq = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
        return { x: pt.x, y: pt.y, point: pt, u: 0, t: 0, dist: Math.sqrt(distSq), distSq };
    }
    if (n === 1) {
        const a = curve.points[0];
        const b = curve.points[1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const l2 = abx * abx + aby * aby;
        const u = l2 > 1e-18 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2)) : 0;
        const pt = { x: a.x + abx * u, y: a.y + aby * u };
        const distSq = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
        return { x: pt.x, y: pt.y, point: pt, u, t: u, dist: Math.sqrt(distSq), distSq };
    }

    const samples = 16;
    const seeds = new Set([0, 1]);
    let bestU = 0;
    let bestPt = curve.points[0];
    let bestDistSq = (p.x - bestPt.x) ** 2 + (p.y - bestPt.y) ** 2;

    let prevF = null;
    let prevU = 0;

    for (let i = 0; i <= samples; i += 1) {
        const u = i / samples;
        const jet = evalBezierJet(curve, u);
        const dx = jet.point.x - p.x;
        const dy = jet.point.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestU = u;
            bestPt = jet.point;
        }
        const f = dx * jet.d1.x + dy * jet.d1.y;
        if (prevF !== null && prevF * f <= 0) {
            const denom = Math.abs(prevF) + Math.abs(f);
            const uZero = denom > 0 ? prevU + ((u - prevU) * Math.abs(prevF)) / denom : 0.5 * (prevU + u);
            seeds.add(uZero);
        }
        prevF = f;
        prevU = u;
    }
    seeds.add(bestU);

    for (const u0 of seeds) {
        let u = u0;
        for (let it = 0; it < 12; it += 1) {
            const jet = evalBezierJet(curve, u);
            const rx = jet.point.x - p.x;
            const ry = jet.point.y - p.y;
            const d2 = rx * rx + ry * ry;
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                bestU = u;
                bestPt = jet.point;
            }
            const f = rx * jet.d1.x + ry * jet.d1.y;
            const df = (jet.d1.x * jet.d1.x + jet.d1.y * jet.d1.y) + (rx * jet.d2.x + ry * jet.d2.y);
            if (Math.abs(f) <= 1e-15 * (Math.hypot(rx, ry) * Math.hypot(jet.d1.x, jet.d1.y) + 1)) break;
            if (Math.abs(df) <= 1e-16) break;
            const step = f / df;
            const nextU = Math.min(1, Math.max(0, u - step));
            if (Math.abs(nextU - u) <= 1e-15) {
                u = nextU;
                const finalJet = evalBezierJet(curve, u);
                const fd2 = (finalJet.point.x - p.x) ** 2 + (finalJet.point.y - p.y) ** 2;
                if (fd2 < bestDistSq) {
                    bestDistSq = fd2;
                    bestU = u;
                    bestPt = finalJet.point;
                }
                break;
            }
            u = nextU;
        }
    }

    return {
        x: bestPt.x,
        y: bestPt.y,
        point: bestPt,
        u: bestU,
        t: bestU,
        dist: Math.sqrt(bestDistSq),
        distSq: bestDistSq,
    };
}

// Encontra todos os pés de perpendicular de P sobre um segmento de Bézier racional:
// soluções internas (ou nas pontas) de (C(u) - P)·C'(u) = 0.
export function bezierPerpendicularFeet(arg1, arg2) {
    const [p, curve] = arg1 && arg1.points ? [arg2, arg1] : [arg1, arg2];
    const n = curve.points.length - 1;
    if (n <= 0) return [];
    const samples = 24;
    const candidates = [];
    let prevF = null;
    let prevU = 0;

    for (let i = 0; i <= samples; i += 1) {
        const u = i / samples;
        const jet = evalBezierJet(curve, u);
        const f = (jet.point.x - p.x) * jet.d1.x + (jet.point.y - p.y) * jet.d1.y;
        if (Math.abs(f) <= 1e-12) candidates.push(u);
        else if (prevF !== null && prevF * f < 0) {
            candidates.push(prevU + ((u - prevU) * Math.abs(prevF)) / (Math.abs(prevF) + Math.abs(f)));
        }
        prevF = f;
        prevU = u;
    }

    const out = [];
    for (const u0 of candidates) {
        let u = u0;
        let ok = false;
        for (let it = 0; it < 14; it += 1) {
            const jet = evalBezierJet(curve, u);
            const rx = jet.point.x - p.x;
            const ry = jet.point.y - p.y;
            const f = rx * jet.d1.x + ry * jet.d1.y;
            const scale = Math.hypot(rx, ry) * Math.hypot(jet.d1.x, jet.d1.y) + 1;
            if (Math.abs(f) <= 1e-13 * scale) {
                ok = true;
                break;
            }
            const df = (jet.d1.x * jet.d1.x + jet.d1.y * jet.d1.y) + (rx * jet.d2.x + ry * jet.d2.y);
            if (Math.abs(df) <= 1e-16) break;
            const nextU = u - f / df;
            if (nextU < -1e-7 || nextU > 1 + 1e-7) break;
            if (Math.abs(nextU - u) <= 1e-15) {
                u = Math.min(1, Math.max(0, nextU));
                ok = true;
                break;
            }
            u = Math.min(1, Math.max(0, nextU));
        }
        if (ok && u >= -1e-7 && u <= 1 + 1e-7) {
            const clampedU = Math.min(1, Math.max(0, u));
            const pt = evalBezierPoint(curve, clampedU);
            if (!out.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < 1e-9)) {
                out.push({ x: pt.x, y: pt.y, point: pt, u: clampedU, t: clampedU });
            }
        }
    }
    return out;
}

// Encontra todos os pontos de tangência traçados a partir de P sobre um segmento de Bézier racional:
// soluções de g(u) = (C(u) - P) × C'(u) = 0.
export function bezierTangentPoints(arg1, arg2) {
    const [p, curve] = arg1 && arg1.points ? [arg2, arg1] : [arg1, arg2];
    const n = curve.points.length - 1;
    if (n <= 1) return [];
    const samples = 24;
    const candidates = [];
    let prevG = null;
    let prevU = 0;

    for (let i = 0; i <= samples; i += 1) {
        const u = i / samples;
        const jet = evalBezierJet(curve, u);
        const rx = jet.point.x - p.x;
        const ry = jet.point.y - p.y;
        const g = rx * jet.d1.y - ry * jet.d1.x;
        if (Math.abs(g) <= 1e-12) candidates.push(u);
        else if (prevG !== null && prevG * g < 0) {
            candidates.push(prevU + ((u - prevU) * Math.abs(prevG)) / (Math.abs(prevG) + Math.abs(g)));
        }
        prevG = g;
        prevU = u;
    }

    const out = [];
    for (const u0 of candidates) {
        let u = u0;
        let ok = false;
        for (let it = 0; it < 14; it += 1) {
            const jet = evalBezierJet(curve, u);
            const rx = jet.point.x - p.x;
            const ry = jet.point.y - p.y;
            const g = rx * jet.d1.y - ry * jet.d1.x;
            const scale = Math.hypot(rx, ry) * Math.hypot(jet.d1.x, jet.d1.y) + 1;
            if (Math.abs(g) <= 1e-13 * scale) {
                ok = true;
                break;
            }
            // g'(u) = (C' × C') + (C - P) × C'' = (C - P) × C''
            const dg = rx * jet.d2.y - ry * jet.d2.x;
            if (Math.abs(dg) <= 1e-16) break;
            const nextU = u - g / dg;
            if (nextU < -1e-7 || nextU > 1 + 1e-7) break;
            if (Math.abs(nextU - u) <= 1e-15) {
                u = Math.min(1, Math.max(0, nextU));
                ok = true;
                break;
            }
            u = Math.min(1, Math.max(0, nextU));
        }
        if (ok && u >= -1e-7 && u <= 1 + 1e-7) {
            const clampedU = Math.min(1, Math.max(0, u));
            const pt = evalBezierPoint(curve, clampedU);
            if (Math.hypot(pt.x - p.x, pt.y - p.y) > 1e-7 && !out.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < 1e-9)) {
                out.push({ x: pt.x, y: pt.y, point: pt, u: clampedU, t: clampedU });
            }
        }
    }
    return out;
}

// Encontra os extremos locais (dx/du = 0 ou dy/du = 0) de um segmento de Bézier racional
// para cálculo exato de Bounding Box e OSNAP QUA.
export function bezierExtremaParams(curve) {
    const pts = curve.points;
    const n = pts.length - 1;
    if (n <= 1) return [];
    const hasW = Boolean(curve.weights && curve.weights.length === pts.length && curve.weights.some((w) => Math.abs(w - 1) > 1e-12));

    const params = [];
    if (!hasW && n === 3) {
        // Polinômio derivado quadrático exato para Bézier cúbica polinomial
        for (const axis of ['x', 'y']) {
            const p0 = pts[0][axis];
            const p1 = pts[1][axis];
            const p2 = pts[2][axis];
            const p3 = pts[3][axis];
            const d0 = p1 - p0;
            const d1 = p2 - p1;
            const d2 = p3 - p2;
            const A = d0 - 2 * d1 + d2;
            const B = 2 * (d1 - d0);
            const C = d0;
            for (const u of solveQuadraticStable(A, B, C, 1e-14)) {
                if (u > 1e-9 && u < 1 - 1e-9) params.push(u);
            }
        }
        return params;
    }

    if (!hasW) {
        // Derivada em base de Bernstein de grau n-1
        for (const axis of ['x', 'y']) {
            const dCoeffs = new Array(n);
            for (let i = 0; i < n; i += 1) {
                dCoeffs[i] = n * (pts[i + 1][axis] - pts[i][axis]);
            }
            for (const u of solveBernsteinRoots(dCoeffs, 1e-14)) {
                if (u > 1e-9 && u < 1 - 1e-9) params.push(u);
            }
        }
        return params;
    }

    // Caso racional geral: varredura + polimento de Newton em x'(u) = 0 e y'(u) = 0
    const samples = 16;
    for (const axis of ['x', 'y']) {
        let prevD = null;
        let prevU = 0;
        for (let i = 0; i <= samples; i += 1) {
            const u = i / samples;
            const jet = evalBezierJet(curve, u);
            const d = jet.d1[axis];
            if (prevD !== null && prevD * d <= 0) {
                let uRoot = prevU + ((u - prevU) * Math.abs(prevD)) / (Math.abs(prevD) + Math.abs(d) + 1e-30);
                for (let it = 0; it < 10; it += 1) {
                    const j2 = evalBezierJet(curve, uRoot);
                    if (Math.abs(j2.d1[axis]) <= 1e-14 || Math.abs(j2.d2[axis]) <= 1e-15) break;
                    uRoot = Math.min(1, Math.max(0, uRoot - j2.d1[axis] / j2.d2[axis]));
                }
                if (uRoot > 1e-9 && uRoot < 1 - 1e-9) params.push(uRoot);
            }
            prevD = d;
            prevU = u;
        }
    }
    return params;
}

export function bezierQuadrants(curve) {
    const out = [];
    for (const u of bezierExtremaParams(curve)) {
        const pt = evalBezierPoint(curve, u);
        if (!out.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < 1e-9)) {
            out.push(pt);
        }
    }
    return out;
}

export function bezierBoxExact(curve) {
    const p0 = curve.points[0];
    const pN = curve.points[curve.points.length - 1];
    let minX = Math.min(p0.x, pN.x);
    let minY = Math.min(p0.y, pN.y);
    let maxX = Math.max(p0.x, pN.x);
    let maxY = Math.max(p0.y, pN.y);

    for (const q of bezierQuadrants(curve)) {
        if (q.x < minX) minX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.x > maxX) maxX = q.x;
        if (q.y > maxY) maxY = q.y;
    }
    return { minX, minY, maxX, maxY };
}

// Quadratura de Gauss-Legendre composta de 8 pontos para comprimento de arco de um segmento Bézier
export function bezierArcLengthInterval(curve, u0 = 0, u1 = 1) {
    const du = u1 - u0;
    if (du <= 1e-15) return 0;
    const steps = 8;
    const h = du / steps;
    let total = 0;
    for (let s = 0; s < steps; s += 1) {
        const a0 = u0 + s * h;
        let sub = 0;
        for (let i = 0; i < 8; i += 1) {
            const u = a0 + h * GL8_U[i];
            const { d1 } = evalBezierJet(curve, u);
            sub += GL8_W[i] * Math.hypot(d1.x, d1.y);
        }
        total += sub * h;
    }
    return total;
}

export function bezierLength(curve) {
    return bezierArcLengthInterval(curve, 0, 1);
}

// Encontra o ponto e o ângulo tangente a uma distância de arco `targetDist` em [0, bezierLength(curve)]
export function bezierPointAtDistance(curve, targetDist) {
    const total = bezierLength(curve);
    if (targetDist <= 0 || total <= 1e-15) {
        const jet = evalBezierJet(curve, 0);
        return { point: jet.point, angle: Math.atan2(jet.d1.y, jet.d1.x), u: 0, t: 0 };
    }
    if (targetDist >= total) {
        const jet = evalBezierJet(curve, 1);
        return { point: jet.point, angle: Math.atan2(jet.d1.y, jet.d1.x), u: 1, t: 1 };
    }

    let low = 0;
    let high = 1;
    let u = targetDist / total;
    for (let it = 0; it < 14; it += 1) {
        const s = bezierArcLengthInterval(curve, 0, u);
        const err = s - targetDist;
        if (Math.abs(err) <= 1e-13 * total) break;
        if (err < 0) low = u;
        else high = u;
        const { d1 } = evalBezierJet(curve, u);
        const speed = Math.hypot(d1.x, d1.y);
        const nextU = speed > 1e-12 ? u - err / speed : 0.5 * (low + high);
        u = nextU > low && nextU < high ? nextU : 0.5 * (low + high);
    }
    const jet = evalBezierJet(curve, u);
    return { point: jet.point, angle: Math.atan2(jet.d1.y, jet.d1.x), u, t: u };
}

export { binomial };
