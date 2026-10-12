// Splines B-spline (NURBS sem pesos): interpolação global de pontos de ajuste, avaliação por de Boor e amostragem.

import { distance } from './geometry.js';

// Parâmetros por comprimento de corda (NURBS Book 9.1).
function chordParams(points) {
    const n = points.length;
    const d = [];
    let total = 0;
    for (let i = 1; i < n; i += 1) {
        const l = distance(points[i - 1], points[i]);
        d.push(l);
        total += l;
    }
    const u = [0];
    let acc = 0;
    for (let i = 0; i < d.length; i += 1) {
        acc += d[i];
        u.push(total > 0 ? acc / total : (i + 1) / d.length);
    }
    u[u.length - 1] = 1;
    return u;
}

// Vetor de nós por média (NURBS Book 9.69) para grau p e n pontos.
function averagedKnots(u, degree) {
    const n = u.length;
    const m = n + degree + 1;
    const knots = new Array(m).fill(0);
    for (let i = m - degree - 1; i < m; i += 1) knots[i] = 1;
    for (let j = 1; j <= n - degree - 1; j += 1) {
        let sum = 0;
        for (let i = j; i <= j + degree - 1; i += 1) sum += u[i];
        knots[j + degree] = sum / degree;
    }
    return knots;
}

function findSpan(n, degree, t, knots) {
    // n = número de pontos de controle - 1
    if (t >= knots[n + 1]) return n;
    if (t <= knots[degree]) return degree;
    let low = degree;
    let high = n + 1;
    let mid = Math.floor((low + high) / 2);
    while (t < knots[mid] || t >= knots[mid + 1]) {
        if (t < knots[mid]) high = mid;
        else low = mid;
        mid = Math.floor((low + high) / 2);
    }
    return mid;
}

function basisFunctions(span, t, degree, knots) {
    const N = new Array(degree + 1).fill(0);
    const left = new Array(degree + 1).fill(0);
    const right = new Array(degree + 1).fill(0);
    N[0] = 1;
    for (let j = 1; j <= degree; j += 1) {
        left[j] = t - knots[span + 1 - j];
        right[j] = knots[span + j] - t;
        let saved = 0;
        for (let r = 0; r < j; r += 1) {
            const denom = right[r + 1] + left[j - r];
            const temp = denom === 0 ? 0 : N[r] / denom;
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
    return N;
}

// Resolve um sistema linear denso por eliminação de Gauss com pivotamento parcial.
function solve(matrix, rhsX, rhsY) {
    const n = matrix.length;
    const a = matrix.map((row, i) => [...row, rhsX[i], rhsY[i]]);
    for (let col = 0; col < n; col += 1) {
        let pivot = col;
        for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
        if (Math.abs(a[pivot][col]) < 1e-12) return null;
        [a[col], a[pivot]] = [a[pivot], a[col]];
        for (let r = col + 1; r < n; r += 1) {
            const f = a[r][col] / a[col][col];
            for (let c = col; c <= n + 1; c += 1) a[r][c] -= f * a[col][c];
        }
    }
    const x = new Array(n);
    const y = new Array(n);
    for (let r = n - 1; r >= 0; r -= 1) {
        let sx = a[r][n];
        let sy = a[r][n + 1];
        for (let c = r + 1; c < n; c += 1) {
            sx -= a[r][c] * x[c];
            sy -= a[r][c] * y[c];
        }
        x[r] = sx / a[r][r];
        y[r] = sy / a[r][r];
    }
    return { x, y };
}

// Interpola pontos de ajuste com B-spline cúbica (ou grau menor quando há poucos pontos).
export function interpolateSpline(fitPoints, { closed = false } = {}) {
    const points = fitPoints.filter((p, i) => i === 0 || distance(p, fitPoints[i - 1]) > 1e-9);
    if (closed && points.length > 2 && distance(points[0], points[points.length - 1]) > 1e-9) points.push({ ...points[0] });
    const n = points.length;
    if (n < 2) return null;
    const degree = Math.min(3, n - 1);
    const u = chordParams(points);
    const knots = averagedKnots(u, degree);
    const matrix = [];
    for (let i = 0; i < n; i += 1) {
        const row = new Array(n).fill(0);
        const span = findSpan(n - 1, degree, u[i], knots);
        const N = basisFunctions(span, u[i], degree, knots);
        for (let j = 0; j <= degree; j += 1) row[span - degree + j] = N[j];
        matrix.push(row);
    }
    const sol = solve(matrix, points.map((p) => p.x), points.map((p) => p.y));
    if (!sol) return null;
    const controlPoints = sol.x.map((x, i) => ({ x, y: sol.y[i] }));
    return { degree, knots, controlPoints, fitPoints: points.map((p) => ({ x: p.x, y: p.y })), closed };
}

// Avaliação por de Boor (com suporte a B-splines racionais / NURBS com pesos).
export function evaluateSpline(spline, t) {
    const { degree, knots, controlPoints, weights } = spline;
    const n = controlPoints.length - 1;
    const tMin = knots[degree];
    const tMax = knots[n + 1];
    const tt = Math.min(Math.max(t, tMin), tMax);
    const span = findSpan(n, degree, tt, knots);
    const N = basisFunctions(span, tt, degree, knots);
    let x = 0;
    let y = 0;
    let wSum = 0;
    const hasWeights = Boolean(weights && weights.length === controlPoints.length);
    for (let j = 0; j <= degree; j += 1) {
        const p = controlPoints[span - degree + j];
        const w = hasWeights ? (weights[span - degree + j] ?? 1) : 1;
        const nw = N[j] * w;
        x += nw * p.x;
        y += nw * p.y;
        wSum += nw;
    }
    if (hasWeights && Math.abs(wSum) > 1e-12) {
        x /= wSum;
        y /= wSum;
    }
    return { x, y };
}

export function splineDomain(spline) {
    const { degree, knots, controlPoints } = spline;
    return { min: knots[degree], max: knots[controlPoints.length] };
}

// Amostra a spline em pontos suficientes (por span) para render, snap e hit-test.
export function sampleSpline(spline, perSpan = 12) {
    if (!spline || !spline.controlPoints || spline.controlPoints.length < 2) return [];
    const { degree, knots, controlPoints } = spline;
    const { min, max } = splineDomain(spline);
    const spans = Math.max(1, controlPoints.length - degree);
    const total = spans * perSpan;
    const out = [];
    for (let i = 0; i <= total; i += 1) {
        const t = min + ((max - min) * i) / total;
        out.push(evaluateSpline(spline, t));
    }
    void knots;
    return out;
}

export function splineLength(spline) {
    const pts = sampleSpline(spline, 24);
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) len += distance(pts[i - 1], pts[i]);
    return len;
}
