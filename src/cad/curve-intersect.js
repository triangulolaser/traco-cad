// Solucionador analítico de interseções Curva × Curva e geometria diferencial exata de Elipses:
// - Elipse × Reta (redução afim + Citardauq EFT + polimento Newton 2D)
// - Elipse × Círculo/Arco/Elipse (Feixe Matricial de Cônicas 3×3 det(Q1 + λQ2) = 0 +
//   resolvente de Weierstrass + polimento de Newton-Raphson 2D / tangência rasante)
// - Bézier/NURBS × Reta (polinômio de distância em base de Bernstein + Descartes + Newton)
// - Bézier/NURBS × Círculo/Arco/Elipse (convolução de Bernstein de grau 2p + Descartes + Newton)
// - Bézier/NURBS × Bézier/NURBS (Sederberg-Nishita Bézier Clipping com fat-line em base de
//   Bernstein e convergência cúbica + polimento de Newton-Raphson 2D < 10^-13 mm).

import {
    solveQuadraticStable,
    solveCubicReal,
    solveQuarticReal,
    solveBernsteinRoots,
} from './predicates.js';
import {
    binomial,
    evalBezierJet,
    evalBezierPoint,
    clipBezierInterval,
    subdivideBezier,
    bezierBoxExact,
    closestPointOnBezier,
} from './nurbs-exact.js';

const TWO_PI = Math.PI * 2;

// 8-point Gauss-Legendre on [0, 1]
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

function normAngle(a) {
    let r = a % TWO_PI;
    if (r < 0) r += TWO_PI;
    return r;
}

// ---------------------------------------------------------------------------
// 1. Geometria Analítica Exata de Elipses

export function ellipseFrame(ellipse) {
    const mx = ellipse.major.x;
    const my = ellipse.major.y;
    const a = Math.hypot(mx, my);
    const ratio = ellipse.ratio ?? 1;
    const b = a * ratio;
    const ux = a > 1e-15 ? mx / a : 1;
    const uy = a > 1e-15 ? my / a : 0;
    const vx = -uy;
    const vy = ux;
    return {
        cx: ellipse.center.x,
        cy: ellipse.center.y,
        a,
        b,
        ux,
        uy,
        vx,
        vy,
    };
}

export function evalEllipseJet(ellipse, theta) {
    const { cx, cy, a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const ac = a * c;
    const bs = b * s;
    const as = a * s;
    const bc = b * c;
    const d1x = -as * ux + bc * vx;
    const d1y = -as * uy + bc * vy;
    const d2x = -ac * ux - bs * vx;
    const d2y = -ac * uy - bs * vy;
    const speed2 = d1x * d1x + d1y * d1y;
    const denom = Math.pow(speed2, 1.5);
    const curvature = denom > 1e-18 ? (d1x * d2y - d1y * d2x) / denom : 0;
    return {
        point: {
            x: cx + ac * ux + bs * vx,
            y: cy + ac * uy + bs * vy,
        },
        d1: { x: d1x, y: d1y },
        d2: { x: d2x, y: d2y },
        curvature,
    };
}

export function evalEllipsePoint(ellipse, theta) {
    const { cx, cy, a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return {
        x: cx + a * c * ux + b * s * vx,
        y: cy + a * c * uy + b * s * vy,
    };
}

export function isFullEllipseCurve(ellipse) {
    if (ellipse.full !== undefined) return Boolean(ellipse.full);
    const s = ellipse.start ?? 0;
    const e = ellipse.end ?? TWO_PI;
    return Math.abs((e - s) - TWO_PI) < 1e-9 || (s === 0 && e === 0);
}

export function ellipseParamInRange(theta, ellipse, tol = 1e-7) {
    if (isFullEllipseCurve(ellipse)) return true;
    const s = ellipse.start ?? 0;
    let e = ellipse.end ?? TWO_PI;
    if (e <= s) e += TWO_PI;
    const sweep = e - s;
    const rel = normAngle(theta - s);
    if (rel <= sweep + tol) return true;
    if (TWO_PI - rel <= tol) return true;
    return false;
}

export function ellipseParamOfPoint(ellipse, p) {
    const { cx, cy, a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    if (a <= 1e-15 || b <= 1e-15) return 0;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const xi = (dx * ux + dy * uy) / a;
    const eta = (dx * vx + dy * vy) / b;
    return normAngle(Math.atan2(eta, xi));
}

// Resolve (a*cos θ - ξ)*(-a*sin θ) + (b*sin θ - η)*(b*cos θ) = 0 no referencial local da elipse.
// Devolve todos os parâmetros estacionários θ ∈ [0, 2π) polidos até precisão de máquina.
function stationaryParamsOnEllipse(ellipse, p) {
    const { cx, cy, a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    if (a <= 1e-15 || b <= 1e-15) return [0];
    const dx = p.x - cx;
    const dy = p.y - cy;
    const xi = dx * ux + dy * uy;
    const eta = dx * vx + dy * vy;

    const scale = Math.max(a, b, Math.hypot(xi, eta), 1);
    const A = a / scale;
    const B = b / scale;
    const X = xi / scale;
    const Y = eta / scale;
    const D = B * B - A * A;

    // Substituição de Weierstrass t = tan(θ/2) para f(θ) = D*sin θ*cos θ + A*X*sin θ - B*Y*cos θ = 0:
    // B*Y * t^4 + 2*(A*X - D)*t^3 + 2*(A*X + D)*t - B*Y = 0
    const c4 = B * Y;
    const c3 = 2 * (A * X - D);
    const c2 = 0;
    const c1 = 2 * (A * X + D);
    const c0 = -B * Y;

    const candidates = [];
    if (Math.abs(c4) <= 1e-14) {
        candidates.push(Math.PI);
        for (const t of solveCubicReal(c3, c2, c1, c0, 1e-14)) {
            candidates.push(2 * Math.atan(t));
        }
    } else {
        for (const t of solveQuarticReal(c4, c3, c2, c1, c0, 1e-13)) {
            candidates.push(2 * Math.atan(t));
        }
    }
    // Sementes angulares adicionais para robustez absoluta perto de θ = ±π
    candidates.push(Math.atan2(Y / B, X / A), 0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2);

    const polished = [];
    for (const th0 of candidates) {
        let th = th0;
        for (let it = 0; it < 10; it += 1) {
            const s = Math.sin(th);
            const c = Math.cos(th);
            const f = D * s * c + A * X * s - B * Y * c;
            const df = D * (c * c - s * s) + A * X * c + B * Y * s;
            if (Math.abs(f) <= 1e-15) break;
            if (Math.abs(df) <= 1e-15) break;
            const step = f / df;
            th -= step;
            if (Math.abs(step) <= 1e-15) break;
        }
        const s = Math.sin(th);
        const c = Math.cos(th);
        const f = D * s * c + A * X * s - B * Y * c;
        if (Math.abs(f) <= 1e-9) {
            const normTh = normAngle(th);
            if (!polished.some((q) => Math.abs(normAngle(q - normTh)) < 1e-9 || Math.abs(normAngle( normTh - q )) < 1e-9)) {
                polished.push(normTh);
            }
        }
    }
    return polished;
}

// Ponto mais próximo sobre elipse ou arco elíptico (erro < 10^-14 mm).
export function closestPointOnEllipse(arg1, arg2) {
    const [p, ellipse] = arg1 && arg1.major ? [arg2, arg1] : [arg1, arg2];
    const params = stationaryParamsOnEllipse(ellipse, p);
    let bestPt = null;
    let bestTh = ellipse.start ?? 0;
    let bestDistSq = Infinity;

    for (const th of params) {
        if (!ellipseParamInRange(th, ellipse)) continue;
        const pt = evalEllipsePoint(ellipse, th);
        const d2 = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
        if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestPt = pt;
            bestTh = th;
        }
    }

    if (!isFullEllipseCurve(ellipse)) {
        for (const endTh of [ellipse.start ?? 0, ellipse.end ?? TWO_PI]) {
            const pt = evalEllipsePoint(ellipse, endTh);
            const d2 = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                bestPt = pt;
                bestTh = normAngle(endTh);
            }
        }
    }

    const finalPt = bestPt ?? evalEllipsePoint(ellipse, bestTh);
    const finalDistSq = Number.isFinite(bestDistSq) ? bestDistSq : (finalPt.x - p.x) ** 2 + (finalPt.y - p.y) ** 2;
    return {
        x: finalPt.x,
        y: finalPt.y,
        point: finalPt,
        t: bestTh,
        theta: bestTh,
        dist: Math.sqrt(finalDistSq),
        distSq: finalDistSq,
    };
}

// Todos os pés de perpendicular de P sobre a elipse (dentro do intervalo angular se arco).
export function ellipsePerpendicularFeet(arg1, arg2) {
    const [p, ellipse] = arg1 && arg1.major ? [arg2, arg1] : [arg1, arg2];
    const params = stationaryParamsOnEllipse(ellipse, p);
    const out = [];

    for (const th of params) {
        if (!ellipseParamInRange(th, ellipse)) continue;
        const pt = evalEllipsePoint(ellipse, th);
        const d2 = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
        out.push({ x: pt.x, y: pt.y, point: pt, t: th, theta: th, d2 });
    }
    out.sort((x, y) => x.d2 - y.d2);
    return out;
}

// Pontos de tangência traçados de um ponto externo P a uma elipse/arco elíptico.
export function ellipseTangentPoints(arg1, arg2) {
    const [p, ellipse] = arg1 && arg1.major ? [arg2, arg1] : [arg1, arg2];
    const { cx, cy, a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    if (a <= 1e-15 || b <= 1e-15) return [];
    const dx = p.x - cx;
    const dy = p.y - cy;
    const xiNorm = (dx * ux + dy * uy) / a;
    const etaNorm = (dx * vx + dy * vy) / b;
    const rho2 = xiNorm * xiNorm + etaNorm * etaNorm;
    if (rho2 <= 1 + 1e-12) return [];
    const rho = Math.sqrt(rho2);
    const phi = Math.atan2(etaNorm, xiNorm);
    const alpha = Math.acos(Math.min(1, 1 / rho));
    const thetas = [normAngle(phi + alpha), normAngle(phi - alpha)];
    return thetas
        .filter((th) => ellipseParamInRange(th, ellipse))
        .map((th) => {
            const pt = evalEllipsePoint(ellipse, th);
            return { x: pt.x, y: pt.y, point: pt, t: th, theta: th };
        });
}

// Quadrantes e extremos axiais da elipse.
export function ellipseQuadrants(ellipse) {
    const { a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    const thetas = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    // Extremos nos eixos globais X e Y (quando a elipse está rotacionada)
    const tx = Math.atan2(b * vx, a * ux);
    const ty = Math.atan2(b * vy, a * uy);
    thetas.push(tx, tx + Math.PI, ty, ty + Math.PI);

    const out = [];
    for (const th of thetas) {
        const nTh = normAngle(th);
        if (!ellipseParamInRange(nTh, ellipse)) continue;
        const pt = evalEllipsePoint(ellipse, nTh);
        if (!out.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < 1e-9)) {
            out.push(pt);
        }
    }
    return out;
}

export function ellipseBoxExact(ellipse) {
    const { a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    const tx = Math.atan2(b * vx, a * ux);
    const ty = Math.atan2(b * vy, a * uy);
    const candidates = [tx, tx + Math.PI, ty, ty + Math.PI, 0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

    const pts = [];
    if (!isFullEllipseCurve(ellipse)) {
        pts.push(evalEllipsePoint(ellipse, ellipse.start ?? 0));
        pts.push(evalEllipsePoint(ellipse, ellipse.end ?? TWO_PI));
    }
    for (const th of candidates) {
        if (ellipseParamInRange(normAngle(th), ellipse)) {
            pts.push(evalEllipsePoint(ellipse, th));
        }
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

export function ellipseArcLengthInterval(ellipse, t0, t1) {
    const dt = t1 - t0;
    if (dt <= 1e-15) return 0;
    // Subdivide em até 4 sub-intervalos para precisão de máquina (< 10^-14)
    const steps = Math.max(1, Math.ceil(dt / (Math.PI / 2)));
    const h = dt / steps;
    let total = 0;
    for (let s = 0; s < steps; s += 1) {
        const a0 = t0 + s * h;
        let sub = 0;
        for (let i = 0; i < 8; i += 1) {
            const th = a0 + h * GL8_U[i];
            const { d1 } = evalEllipseJet(ellipse, th);
            sub += GL8_W[i] * Math.hypot(d1.x, d1.y);
        }
        total += sub * h;
    }
    return total;
}

export function ellipseLength(ellipse) {
    if (isFullEllipseCurve(ellipse)) {
        return ellipseArcLengthInterval(ellipse, 0, TWO_PI);
    }
    const s = ellipse.start ?? 0;
    let e = ellipse.end ?? TWO_PI;
    if (e <= s) e += TWO_PI;
    return ellipseArcLengthInterval(ellipse, s, e);
}

export function ellipsePointAtDistance(ellipse, targetDist) {
    const full = isFullEllipseCurve(ellipse);
    const s = full ? 0 : (ellipse.start ?? 0);
    let e = full ? TWO_PI : (ellipse.end ?? TWO_PI);
    if (!full && e <= s) e += TWO_PI;
    const total = ellipseArcLengthInterval(ellipse, s, e);
    if (targetDist <= 0 || total <= 1e-15) {
        const jet = evalEllipseJet(ellipse, s);
        return { point: jet.point, angle: normAngle(Math.atan2(jet.d1.y, jet.d1.x)) };
    }
    if (targetDist >= total) {
        const jet = evalEllipseJet(ellipse, e);
        return { point: jet.point, angle: normAngle(Math.atan2(jet.d1.y, jet.d1.x)) };
    }

    let low = s;
    let high = e;
    let th = s + ((e - s) * targetDist) / total;
    for (let it = 0; it < 14; it += 1) {
        const curLen = ellipseArcLengthInterval(ellipse, s, th);
        const err = curLen - targetDist;
        if (Math.abs(err) <= 1e-13 * total) break;
        if (err < 0) low = th;
        else high = th;
        const { d1 } = evalEllipseJet(ellipse, th);
        const speed = Math.hypot(d1.x, d1.y);
        const nextTh = speed > 1e-12 ? th - err / speed : 0.5 * (low + high);
        th = nextTh > low && nextTh < high ? nextTh : 0.5 * (low + high);
    }
    const jet = evalEllipseJet(ellipse, th);
    return { point: jet.point, angle: normAngle(Math.atan2(jet.d1.y, jet.d1.x)) };
}

// ---------------------------------------------------------------------------
// 2. Interseções Elipse × Reta e Feixe Matricial de Cônicas 3×3 (Elipse × Círculo/Arco/Elipse)

// Interseção analítica entre Reta (passando por a, b ou objeto { a, b }) e Elipse.
export function intersectLineEllipse(arg1, arg2, arg3) {
    let a;
    let b;
    let ellipse;
    if (arg3 === undefined) {
        if (arg1 && arg1.a && arg1.b) {
            a = arg1.a;
            b = arg1.b;
            ellipse = arg2;
        } else {
            ellipse = arg1;
            a = arg2.a;
            b = arg2.b;
        }
    } else {
        a = arg1;
        b = arg2;
        ellipse = arg3;
    }
    const { cx, cy, a: rx, b: ry, ux, uy, vx, vy } = ellipseFrame(ellipse);
    if (rx <= 1e-15 || ry <= 1e-15) return [];

    // Transforma a reta P(t) = a + t*(b - a) para o espaço normalizado da elipse (círculo unitário)
    const dax = a.x - cx;
    const day = a.y - cy;
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    const x0 = (dax * ux + day * uy) / rx;
    const y0 = (dax * vx + day * vy) / ry;
    const vxNorm = (dx * ux + dy * uy) / rx;
    const vyNorm = (dx * vx + dy * vy) / ry;

    const A = vxNorm * vxNorm + vyNorm * vyNorm;
    const B = 2 * (x0 * vxNorm + y0 * vyNorm);
    const C = x0 * x0 + y0 * y0 - 1;

    const tRoots = solveQuadraticStable(A, B, C, 1e-14);
    const out = [];

    for (const t0 of tRoots) {
        const px = a.x + dx * t0;
        const py = a.y + dy * t0;
        let th = ellipseParamOfPoint(ellipse, { x: px, y: py });
        let t = t0;

        // Polimento de Newton-Raphson 2D sobre E(th) - (a + t*d) = 0
        for (let it = 0; it < 6; it += 1) {
            const jet = evalEllipseJet(ellipse, th);
            const fx = jet.point.x - (a.x + dx * t);
            const fy = jet.point.y - (a.y + dy * t);
            if (Math.hypot(fx, fy) <= 1e-15 * Math.max(1, rx, Math.hypot(a.x, a.y))) break;
            const j00 = jet.d1.x;
            const j01 = -dx;
            const j10 = jet.d1.y;
            const j11 = -dy;
            const det = j00 * j11 - j01 * j10;
            if (Math.abs(det) <= 1e-18) break;
            const dth = (fx * j11 - fy * j01) / det;
            const dt = (j00 * fy - j10 * fx) / det;
            th -= dth;
            t -= dt;
        }
        const pt = evalEllipsePoint(ellipse, th);
        out.push({ x: pt.x, y: pt.y, point: pt, t, theta: normAngle(th) });
    }
    return out;
}

function curveAsEllipse(c) {
    if (c.kind === 'ellipse') return c;
    return {
        kind: 'ellipse',
        center: c.center,
        major: { x: c.radius, y: 0 },
        ratio: 1,
        start: c.kind === 'arc' ? c.start : 0,
        end: c.kind === 'arc' ? c.end : TWO_PI,
        full: c.kind === 'circle',
    };
}

// Matriz simétrica 3×3 Q da elipse em coordenadas deslocadas/normalizadas (x - ox)/S, (y - oy)/S:
// [x, y, 1] * Q * [x, y, 1]^T = 0
export function ellipseConicMatrix(ellipse, ox = 0, oy = 0, S = 1) {
    const { cx, cy, a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    const A0 = a / S;
    const B0 = b / S;
    const x0 = (cx - ox) / S;
    const y0 = (cy - oy) / S;

    const invA2 = 1 / (A0 * A0);
    const invB2 = 1 / (B0 * B0);

    const m00 = ux * ux * invA2 + vx * vx * invB2;
    const m01 = ux * uy * invA2 + vx * vy * invB2;
    const m11 = uy * uy * invA2 + vy * vy * invB2;

    const m02 = -(m00 * x0 + m01 * y0);
    const m12 = -(m01 * x0 + m11 * y0);
    const m22 = m00 * x0 * x0 + 2 * m01 * x0 * y0 + m11 * y0 * y0 - 1;

    return [
        [m00, m01, m02],
        [m01, m11, m12],
        [m02, m12, m22],
    ];
}

function det3x3(M) {
    return (
        M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
        - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
        + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
    );
}

// Decompõe uma cônica degenerada C (det(C) ≈ 0) em até 2 retas projetivas l = [lx, ly, lz].
function splitDegenerateConicLines(C) {
    // Matriz adjunta B = adj(C)
    const B = [
        [
            C[1][1] * C[2][2] - C[1][2] * C[2][1],
            C[0][2] * C[2][1] - C[0][1] * C[2][2],
            C[0][1] * C[1][2] - C[0][2] * C[1][1],
        ],
        [
            C[1][2] * C[2][0] - C[1][0] * C[2][2],
            C[0][0] * C[2][2] - C[0][2] * C[2][0],
            C[0][2] * C[1][0] - C[0][0] * C[1][2],
        ],
        [
            C[1][0] * C[2][1] - C[1][1] * C[2][0],
            C[0][1] * C[2][0] - C[0][0] * C[2][1],
            C[0][0] * C[1][1] - C[0][1] * C[1][0],
        ],
    ];

    // Escolhe o elemento diagonal de B de maior módulo (ou menor principal 2×2 se retas paralelas)
    let bestIdx = 0;
    let bestAbs = Math.abs(B[0][0]);
    for (let i = 1; i < 3; i += 1) {
        if (Math.abs(B[i][i]) > bestAbs) {
            bestAbs = Math.abs(B[i][i]);
            bestIdx = i;
        }
    }

    let M = C;
    if (bestAbs > 1e-14) {
        if (B[bestIdx][bestIdx] > 0) return [];
        const alpha = Math.sqrt(Math.max(0, -B[bestIdx][bestIdx]));
        const p = [B[0][bestIdx] / alpha, B[1][bestIdx] / alpha, B[2][bestIdx] / alpha];
        // A matriz antissimétrica S(p) somada a C tem posto 1: M = C + S(p)
        M = [
            [C[0][0], C[0][1] - p[2], C[0][2] + p[1]],
            [C[1][0] + p[2], C[1][1], C[1][2] - p[0]],
            [C[2][0] - p[1], C[2][1] + p[0], C[2][2]],
        ];
    }

    // A linha e a coluna do elemento de maior módulo de M são as duas retas l1 e l2!
    let rMax = 0;
    let cMax = 0;
    let maxVal = 0;
    for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
            if (Math.abs(M[r][c]) > maxVal) {
                maxVal = Math.abs(M[r][c]);
                rMax = r;
                cMax = c;
            }
        }
    }
    if (maxVal <= 1e-15) return [];
    const l1 = [M[rMax][0], M[rMax][1], M[rMax][2]];
    const l2 = [M[0][cMax], M[1][cMax], M[2][cMax]];
    return [l1, l2];
}

// Interseção analítica entre duas cônicas (Elipse × Elipse ou Elipse × Círculo/Arco):
// Combina o Feixe Matricial 3×3 det(Q1 + λQ2) = 0 + resolvente de Weierstrass de 4º grau
// + polimento de Newton-Raphson 2D / tangência rasante (erro < 10^-14 mm).
export function intersectConics(c1, c2) {
    const e1 = curveAsEllipse(c1);
    const e2 = curveAsEllipse(c2);
    const f1 = ellipseFrame(e1);
    const f2 = ellipseFrame(e2);
    if (f1.a <= 1e-15 || f1.b <= 1e-15 || f2.a <= 1e-15 || f2.b <= 1e-15) return [];

    const ox = 0.5 * (f1.cx + f2.cx);
    const oy = 0.5 * (f1.cy + f2.cy);
    const S = Math.max(f1.a, f1.b, f2.a, f2.b, Math.hypot(f1.cx - f2.cx, f1.cy - f2.cy), 1);

    const Q1 = ellipseConicMatrix(e1, ox, oy, S);
    const Q2 = ellipseConicMatrix(e2, ox, oy, S);

    // 1. Feixe Matricial de Cônicas 3×3: det(Q1 + λ*Q2) = c3*λ^3 + c2*λ^2 + c1*λ + c0 = 0
    const mix = (lam) => [
        [Q1[0][0] + lam * Q2[0][0], Q1[0][1] + lam * Q2[0][1], Q1[0][2] + lam * Q2[0][2]],
        [Q1[1][0] + lam * Q2[1][0], Q1[1][1] + lam * Q2[1][1], Q1[1][2] + lam * Q2[1][2]],
        [Q1[2][0] + lam * Q2[2][0], Q1[2][1] + lam * Q2[2][1], Q1[2][2] + lam * Q2[2][2]],
    ];
    const d0 = det3x3(Q1);
    const d3 = det3x3(Q2);
    const dp1 = det3x3(mix(1));
    const dm1 = det3x3(mix(-1));
    const dp2 = det3x3(mix(2));

    const k0 = d0;
    const k2 = 0.5 * (dp1 + dm1) - d0;
    const k3 = d3;
    const k1 = 0.5 * (dp1 - dm1) - d3;
    void dp2;

    const seedAngles1 = [];

    const lambdas = solveCubicReal(k3, k2, k1, k0, 1e-14);
    for (const lam of lambdas) {
        const Cdeg = mix(lam);
        const lines = splitDegenerateConicLines(Cdeg);
        for (const l of lines) {
            const [lx, ly, lz] = l;
            const normL = Math.hypot(lx, ly);
            if (normL <= 1e-14) continue;
            // Converte reta normalizada lx*X + ly*Y + lz = 0 para dois pontos no mundo
            const px0 = ox - S * ((lx * lz) / (normL * normL));
            const py0 = oy - S * ((ly * lz) / (normL * normL));
            const pA = { x: px0 - S * (ly / normL), y: py0 + S * (lx / normL) };
            const pB = { x: px0 + S * (ly / normL), y: py0 - S * (lx / normL) };
            for (const hit of intersectLineEllipse(pA, pB, e1)) {
                seedAngles1.push(hit.theta);
            }
        }
    }

    // 2. Resolvente trigonométrica de Weierstrass (substitui E1(θ) na forma quadrática de E2):
    // M2(θ) = K0 + K1*cos θ + K2*sin θ + K3*cos^2 θ + K4*cos θ sin θ + K5*sin^2 θ = 0
    const dx = f1.cx - f2.cx;
    const dy = f1.cy - f2.cy;
    const xi0 = (dx * f2.ux + dy * f2.uy) / f2.a;
    const eta0 = (dx * f2.vx + dy * f2.vy) / f2.b;
    const alphaX = (f1.a * (f1.ux * f2.ux + f1.uy * f2.uy)) / f2.a;
    const betaX = (f1.b * (f1.vx * f2.ux + f1.vy * f2.uy)) / f2.a;
    const alphaY = (f1.a * (f1.ux * f2.vx + f1.uy * f2.vy)) / f2.b;
    const betaY = (f1.b * (f1.vx * f2.vx + f1.vy * f2.vy)) / f2.b;

    // Em função de c = cos θ, s = sin θ:
    // (xi0 + alphaX*c + betaX*s)^2 + (eta0 + alphaY*c + betaY*s)^2 - 1 = 0
    const A20 = alphaX * alphaX + alphaY * alphaY;
    const A11 = 2 * (alphaX * betaX + alphaY * betaY);
    const A02 = betaX * betaX + betaY * betaY;
    const A10 = 2 * (xi0 * alphaX + eta0 * alphaY);
    const A01 = 2 * (xi0 * betaX + eta0 * betaY);
    const A00 = xi0 * xi0 + eta0 * eta0 - 1;

    // Com c = (1 - t^2)/(1 + t^2), s = 2t/(1 + t^2):
    const w4 = A20 - A10 + A00;
    const w3 = 2 * A01 - 2 * A11;
    const w2 = 4 * A02 - 2 * A20 + 2 * A00;
    const w1 = 2 * A01 + 2 * A11;
    const w0 = A20 + A10 + A00;

    if (Math.abs(w4) <= 1e-13) {
        seedAngles1.push(Math.PI);
        for (const t of solveCubicReal(w3, w2, w1, w0, 1e-14)) {
            seedAngles1.push(2 * Math.atan(t));
        }
    } else {
        for (const t of solveQuarticReal(w4, w3, w2, w1, w0, 1e-13)) {
            seedAngles1.push(2 * Math.atan(t));
        }
    }

    // Varredura fina de segurança para capturar raízes duplas de tangência rasante (onde M2(θ) ≥ 0 toca 0)
    const evalImpl2 = (th) => {
        const c = Math.cos(th);
        const s = Math.sin(th);
        const u = xi0 + alphaX * c + betaX * s;
        const v = eta0 + alphaY * c + betaY * s;
        const du = -alphaX * s + betaX * c;
        const dv = -alphaY * s + betaY * c;
        const d2u = -alphaX * c - betaX * s;
        const d2v = -alphaY * c - betaY * s;
        return {
            f: u * u + v * v - 1,
            df: 2 * (u * du + v * dv),
            d2f: 2 * (du * du + u * d2u + dv * dv + v * d2v),
        };
    };

    const N_SCAN = 36;
    let prevScan = evalImpl2(0);
    for (let i = 1; i <= N_SCAN; i += 1) {
        const th = (TWO_PI * i) / N_SCAN;
        const curScan = evalImpl2(th);
        const thPrev = (TWO_PI * (i - 1)) / N_SCAN;
        if (prevScan.f * curScan.f <= 0) {
            seedAngles1.push(0.5 * (thPrev + th));
        }
        // Se a derivada df trocou de sinal e |f| é pequeno, pode ser tangência rasante!
        if (prevScan.df * curScan.df <= 0 && Math.min(Math.abs(prevScan.f), Math.abs(curScan.f)) < 0.25) {
            let thMin = 0.5 * (thPrev + th);
            for (let it = 0; it < 8; it += 1) {
                const st = evalImpl2(thMin);
                if (Math.abs(st.d2f) <= 1e-14) break;
                thMin -= st.df / st.d2f;
            }
            if (Math.abs(evalImpl2(thMin).f) < 1e-5) {
                seedAngles1.push(thMin);
            }
        }
        prevScan = curScan;
    }

    // 3. Polimento de Newton-Raphson 2D sobre E1(θ1) - E2(θ2) = 0
    const results = [];
    for (const th1Seed of seedAngles1) {
        let th1 = th1Seed;
        // Primeiro refina 1D sobre a equação implícita de E2
        for (let it = 0; it < 8; it += 1) {
            const st = evalImpl2(th1);
            if (Math.abs(st.f) <= 1e-15 && Math.abs(st.df) > 1e-7) break;
            if (Math.abs(st.df) < 1e-3 && Math.abs(st.f) < 1e-3 && Math.abs(st.d2f) > 1e-10) {
                // Vizinhança de tangência rasante (raiz dupla): converge para f'(th1) = 0
                th1 -= st.df / st.d2f;
            } else if (Math.abs(st.df) > 1e-11) {
                th1 -= st.f / st.df;
            } else if (Math.abs(st.d2f) > 1e-12) {
                th1 -= st.df / st.d2f;
            } else {
                break;
            }
        }

        const p1Init = evalEllipsePoint(e1, th1);
        let th2 = ellipseParamOfPoint(e2, p1Init);

        // Newton 2D em (th1, th2)
        for (let it = 0; it < 10; it += 1) {
            const j1 = evalEllipseJet(e1, th1);
            const j2 = evalEllipseJet(e2, th2);
            const fx = j1.point.x - j2.point.x;
            const fy = j1.point.y - j2.point.y;

            const a00 = j1.d1.x;
            const a01 = -j2.d1.x;
            const a10 = j1.d1.y;
            const a11 = -j2.d1.y;
            const det = a00 * a11 - a01 * a10;

            if (Math.abs(det) > 1e-6 * S * S) {
                if (Math.hypot(fx, fy) <= 1e-15 * S) break;
                const d1 = (fx * a11 - fy * a01) / det;
                const d2 = (a00 * fy - a10 * fx) / det;
                th1 -= d1;
                th2 -= d2;
                if (Math.abs(d1) <= 1e-15 && Math.abs(d2) <= 1e-15) break;
            } else {
                // Tangência rasante: refina o extremo estacionário de f(th1) onde f'(th1) = 0
                for (let gIt = 0; gIt < 6; gIt += 1) {
                    const st = evalImpl2(th1);
                    if (Math.abs(st.d2f) <= 1e-14 || Math.abs(st.df) <= 1e-15) break;
                    th1 -= st.df / st.d2f;
                }
                th2 = ellipseParamOfPoint(e2, evalEllipsePoint(e1, th1));
                break;
            }
        }

        const p1 = evalEllipsePoint(e1, th1);
        const p2 = evalEllipsePoint(e2, th2);
        const err = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (err <= 1e-6 * S) {
            const pt = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
            const nTh1 = normAngle(th1);
            const nTh2 = normAngle(th2);
            if (!results.some((r) => Math.hypot(r.point.x - pt.x, r.point.y - pt.y) <= 1e-6 * S)) {
                results.push({ x: pt.x, y: pt.y, point: pt, theta1: nTh1, theta2: nTh2 });
            }
        }
    }

    return results;
}

// ---------------------------------------------------------------------------
// 3. Interseções Bézier/NURBS × Reta e Bézier/NURBS × Cônica (Círculo/Arco/Elipse)

// Interseção exata entre Reta (passando por a, b ou objeto { a, b }) e segmento Bézier racional.
export function intersectLineBezier(arg1, arg2, arg3) {
    let a;
    let b;
    let bezier;
    if (arg3 === undefined) {
        if (arg1 && arg1.a && arg1.b) {
            a = arg1.a;
            b = arg1.b;
            bezier = arg2;
        } else {
            bezier = arg1;
            a = arg2.a;
            b = arg2.b;
        }
    } else {
        a = arg1;
        b = arg2;
        bezier = arg3;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-15) return [];
    const nx = -dy / len;
    const ny = dx / len;

    const pts = bezier.points;
    const n = pts.length - 1;
    const weights = bezier.weights;
    const hasW = Boolean(weights && weights.length === pts.length);

    // Polinômio de distância assinada numerador em base de Bernstein:
    // d_i = w_i * ((P_i - a) · n)
    const dCoeffs = new Array(n + 1);
    for (let i = 0; i <= n; i += 1) {
        const w = hasW ? (weights[i] ?? 1) : 1;
        dCoeffs[i] = w * ((pts[i].x - a.x) * nx + (pts[i].y - a.y) * ny);
    }

    const uRoots = solveBernsteinRoots(dCoeffs, 1e-14);
    const out = [];

    for (const u0 of uRoots) {
        let u = u0;
        for (let it = 0; it < 8; it += 1) {
            const jet = evalBezierJet(bezier, u);
            const f = (jet.point.x - a.x) * nx + (jet.point.y - a.y) * ny;
            const df = jet.d1.x * nx + jet.d1.y * ny;
            if (Math.abs(f) <= 1e-15 * Math.max(1, len)) break;
            if (Math.abs(df) <= 1e-14) break;
            u = Math.min(1, Math.max(0, u - f / df));
        }
        const pt = evalBezierPoint(bezier, u);
        const fFinal = Math.abs((pt.x - a.x) * nx + (pt.y - a.y) * ny);
        if (fFinal <= 1e-7 * Math.max(1, len)) {
            const tLine = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (len * len);
            if (!out.some((h) => Math.hypot(h.point.x - pt.x, h.point.y - pt.y) < 1e-9)) {
                out.push({ x: pt.x, y: pt.y, point: pt, u, t: tLine });
            }
        }
    }
    return out;
}

// Multiplica dois polinômios em base de Bernstein A[0..m] e B[0..n] -> C[0..m+n].
function multiplyBernstein(A, B) {
    const m = A.length - 1;
    const n = B.length - 1;
    const C = new Array(m + n + 1).fill(0);
    for (let i = 0; i <= m; i += 1) {
        const biM = binomial(m, i);
        for (let j = 0; j <= n; j += 1) {
            const k = i + j;
            C[k] += (A[i] * B[j] * biM * binomial(n, j)) / binomial(m + n, k);
        }
    }
    return C;
}

// Interseção exata entre segmento Bézier racional e Cônica (Círculo, Arco ou Elipse).
export function intersectBezierConic(arg1, arg2) {
    const [bezier, conic] = arg1 && arg1.points ? [arg1, arg2] : [arg2, arg1];
    const ellipse = curveAsEllipse(conic);
    const { cx, cy, a, b, ux, uy, vx, vy } = ellipseFrame(ellipse);
    if (a <= 1e-15 || b <= 1e-15) return [];

    const pts = bezier.points;
    const n = pts.length - 1;
    const weights = bezier.weights;
    const hasW = Boolean(weights && weights.length === pts.length);

    // Coordenadas homogêneas normalizadas no referencial da elipse (onde a elipse é X^2 + Y^2 - W^2 = 0)
    const X = new Array(n + 1);
    const Y = new Array(n + 1);
    const W = new Array(n + 1);
    for (let i = 0; i <= n; i += 1) {
        const w = hasW ? (weights[i] ?? 1) : 1;
        const dx = pts[i].x - cx;
        const dy = pts[i].y - cy;
        X[i] = w * ((dx * ux + dy * uy) / a);
        Y[i] = w * ((dx * vx + dy * vy) / b);
        W[i] = w;
    }

    const XX = multiplyBernstein(X, X);
    const YY = multiplyBernstein(Y, Y);
    const WW = multiplyBernstein(W, W);
    const F = XX.map((v, i) => v + YY[i] - WW[i]);

    const uSeeds = solveBernsteinRoots(F, 1e-14);

    // Avaliador de F(u) = xi(u)^2 + eta(u)^2 - 1 e derivada para polimento de Newton
    const evalImplicit = (u) => {
        const jet = evalBezierJet(bezier, u);
        const dx = jet.point.x - cx;
        const dy = jet.point.y - cy;
        const xi = (dx * ux + dy * uy) / a;
        const eta = (dx * vx + dy * vy) / b;
        const dxi = (jet.d1.x * ux + jet.d1.y * uy) / a;
        const deta = (jet.d1.x * vx + jet.d1.y * vy) / b;
        const d2xi = (jet.d2.x * ux + jet.d2.y * uy) / a;
        const d2eta = (jet.d2.x * vx + jet.d2.y * vy) / b;
        return {
            point: jet.point,
            d1: jet.d1,
            f: xi * xi + eta * eta - 1,
            df: 2 * (xi * dxi + eta * deta),
            d2f: 2 * (dxi * dxi + xi * d2xi + deta * deta + eta * d2eta),
        };
    };

    const S = Math.max(a, b, 1);
    const out = [];
    for (const u0 of uSeeds) {
        let u = u0;
        for (let it = 0; it < 10; it += 1) {
            const st = evalImplicit(u);
            if (Math.abs(st.f) <= 1e-15) break;
            if (Math.abs(st.df) > 1e-11) {
                u = Math.min(1, Math.max(0, u - st.f / st.df));
            } else if (Math.abs(st.d2f) > 1e-12) {
                u = Math.min(1, Math.max(0, u - st.df / st.d2f));
            } else {
                break;
            }
        }

        const pInit = evalBezierPoint(bezier, u);
        let th = ellipseParamOfPoint(ellipse, pInit);

        // Polimento conjunto 2D Newton-Raphson em (u, th): B(u) - E(th) = 0
        for (let it = 0; it < 8; it += 1) {
            const jb = evalBezierJet(bezier, u);
            const je = evalEllipseJet(ellipse, th);
            const fx = jb.point.x - je.point.x;
            const fy = jb.point.y - je.point.y;
            if (Math.hypot(fx, fy) <= 1e-15 * S) break;

            const det = jb.d1.x * (-je.d1.y) - (-je.d1.x) * jb.d1.y;
            if (Math.abs(det) > 1e-12 * S * S) {
                const du = (fx * (-je.d1.y) - fy * (-je.d1.x)) / det;
                const dth = (jb.d1.x * fy - jb.d1.y * fx) / det;
                u = Math.min(1, Math.max(0, u - du));
                th -= dth;
                if (Math.abs(du) <= 1e-15 && Math.abs(dth) <= 1e-15) break;
            } else {
                break;
            }
        }

        const pb = evalBezierPoint(bezier, u);
        const pe = evalEllipsePoint(ellipse, th);
        if (Math.hypot(pb.x - pe.x, pb.y - pe.y) <= 1e-7 * S) {
            const pt = { x: 0.5 * (pb.x + pe.x), y: 0.5 * (pb.y + pe.y) };
            if (!out.some((h) => Math.hypot(h.point.x - pt.x, h.point.y - pt.y) <= 1e-7 * S)) {
                out.push({ x: pt.x, y: pt.y, point: pt, u, theta: normAngle(th) });
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 4. Bézier × Bézier: Sederberg-Nishita Bézier Clipping + Polimento Newton 2D

function controlPolygonBox(curve) {
    const pts = curve.points;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 1) {
        const p = pts[i];
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

function boxesOverlap(a, b, tol = 1e-9) {
    return a.minX <= b.maxX + tol && a.maxX >= b.minX - tol && a.minY <= b.maxY + tol && a.maxY >= b.minY - tol;
}

// Calcula o intervalo [tMin, tMax] ⊆ [0, 1] onde a envoltória convexa dos pontos
// de Bernstein (i/n, d[i]) cruza a faixa horizontal [dMin, dMax].
function clipBernsteinToFatLine(d, dMin, dMax) {
    const n = d.length - 1;
    let allAbove = true;
    let allBelow = true;
    for (let i = 0; i <= n; i += 1) {
        if (d[i] <= dMax) allAbove = false;
        if (d[i] >= dMin) allBelow = false;
    }
    if (allAbove || allBelow) return null;

    // Pontos 2D (t_i = i/n, y_i = d[i]) do polígono explícito de Bernstein
    const pts = new Array(n + 1);
    for (let i = 0; i <= n; i += 1) {
        pts[i] = { t: i / n, y: d[i] };
    }

    // Como t_i é estritamente crescente, construímos a envoltória inferior e superior em O(n)
    const cross2 = (o, a, b) => (a.t - o.t) * (b.y - o.y) - (a.y - o.y) * (b.t - o.t);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i -= 1) {
        const p = pts[i];
        while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }

    const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    let tMin = 1;
    let tMax = 0;

    for (let i = 0; i < hull.length; i += 1) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        if (a.y >= dMin && a.y <= dMax) {
            if (a.t < tMin) tMin = a.t;
            if (a.t > tMax) tMax = a.t;
        }
        const dy = b.y - a.y;
        if (Math.abs(dy) > 1e-18) {
            for (const bound of [dMin, dMax]) {
                if ((a.y - bound) * (b.y - bound) <= 0) {
                    const u = (bound - a.y) / dy;
                    if (u >= -1e-12 && u <= 1 + 1e-12) {
                        const tHit = a.t + u * (b.t - a.t);
                        if (tHit < tMin) tMin = tHit;
                        if (tHit > tMax) tMax = tHit;
                    }
                }
            }
        }
    }

    if (tMin > tMax) return null;
    return [Math.max(0, tMin - 1e-12), Math.min(1, tMax + 1e-12)];
}

function polishBezierIntersection(c1, c2, uSeed, vSeed, scale) {
    let u = uSeed;
    let v = vSeed;
    for (let it = 0; it < 12; it += 1) {
        const j1 = evalBezierJet(c1, u);
        const j2 = evalBezierJet(c2, v);
        const fx = j1.point.x - j2.point.x;
        const fy = j1.point.y - j2.point.y;
        if (Math.hypot(fx, fy) <= 1e-15 * scale) break;

        const a00 = j1.d1.x;
        const a01 = -j2.d1.x;
        const a10 = j1.d1.y;
        const a11 = -j2.d1.y;
        const det = a00 * a11 - a01 * a10;

        if (Math.abs(det) > 1e-6 * scale * scale) {
            const du = (fx * a11 - fy * a01) / det;
            const dv = (a00 * fy - a10 * fx) / det;
            u = Math.min(1, Math.max(0, u - du));
            v = Math.min(1, Math.max(0, v - dv));
            if (Math.abs(du) <= 1e-15 && Math.abs(dv) <= 1e-15) break;
        } else {
            // Tangência rasante: resolve o sistema não-singular F1 = <P(u)-Q(v), P'(u)> = 0, F2 = P'(u) x Q'(v) = 0
            const f1 = fx * j1.d1.x + fy * j1.d1.y;
            const f2 = j1.d1.x * j2.d1.y - j1.d1.y * j2.d1.x;
            const g00 = (j1.d1.x * j1.d1.x + j1.d1.y * j1.d1.y) + (fx * j1.d2.x + fy * j1.d2.y);
            const g01 = -(j2.d1.x * j1.d1.x + j2.d1.y * j1.d1.y);
            const g10 = j1.d2.x * j2.d1.y - j1.d2.y * j2.d1.x;
            const g11 = j1.d1.x * j2.d2.y - j1.d1.y * j2.d2.x;
            const gDet = g00 * g11 - g01 * g10;
            if (Math.abs(gDet) > 1e-18) {
                const du = (f1 * g11 - f2 * g01) / gDet;
                const dv = (g00 * f2 - g10 * f1) / gDet;
                u = Math.min(1, Math.max(0, u - du));
                v = Math.min(1, Math.max(0, v - dv));
                if (Math.abs(du) <= 1e-15 && Math.abs(dv) <= 1e-15) break;
            } else {
                u = closestPointOnBezier(j2.point, c1).u;
                v = closestPointOnBezier(evalBezierPoint(c1, u), c2).u;
            }
        }
    }

    const p1 = evalBezierPoint(c1, u);
    const p2 = evalBezierPoint(c2, v);
    const err = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    if (err <= 1e-7 * scale) {
        const pt = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
        return {
            x: pt.x,
            y: pt.y,
            point: pt,
            u,
            v,
            err,
        };
    }
    return null;
}

// Sederberg-Nishita Bézier Clipping para dois segmentos de Bézier (polinomiais ou racionais).
export function intersectBezierBezier(curve1, curve2) {
    const b1 = bezierBoxExact(curve1);
    const b2 = bezierBoxExact(curve2);
    const scale = Math.max(
        b1.maxX - b1.minX,
        b1.maxY - b1.minY,
        b2.maxX - b2.minX,
        b2.maxY - b2.minY,
        1,
    );
    if (!boxesOverlap(b1, b2, 1e-7 * scale)) return [];

    const candidates = [];
    const stack = [{
        P: { ...curve1, u0: 0, u1: 1 },
        Q: { ...curve2, u0: 0, u1: 1 },
        swapped: false,
        depth: 0,
    }];

    while (stack.length > 0) {
        const { P, Q, swapped, depth } = stack.pop();
        const boxP = controlPolygonBox(P);
        const boxQ = controlPolygonBox(Q);
        if (!boxesOverlap(boxP, boxQ, 1e-9 * scale)) continue;

        const spanP = P.u1 - P.u0;
        const spanQ = Q.u1 - Q.u0;
        if ((spanP <= 1e-6 && spanQ <= 1e-6) || depth >= 36) {
            const uMid = 0.5 * (P.u0 + P.u1);
            const vMid = 0.5 * (Q.u0 + Q.u1);
            candidates.push(swapped ? [vMid, uMid] : [uMid, vMid]);
            continue;
        }

        // Constrói fat-line de Q
        const qFirst = Q.points[0];
        const qLast = Q.points[Q.points.length - 1];
        let dx = qLast.x - qFirst.x;
        let dy = qLast.y - qFirst.y;
        let len = Math.hypot(dx, dy);
        if (len <= 1e-12 * scale && Q.points.length > 2) {
            dx = Q.points[1].x - qFirst.x;
            dy = Q.points[1].y - qFirst.y;
            len = Math.hypot(dx, dy);
        }

        if (len <= 1e-12 * scale) {
            const uMid = 0.5 * (P.u0 + P.u1);
            const vMid = 0.5 * (Q.u0 + Q.u1);
            candidates.push(swapped ? [vMid, uMid] : [uMid, vMid]);
            continue;
        }

        const nx = -dy / len;
        const ny = dx / len;
        let dMin = 0;
        let dMax = 0;
        for (let i = 0; i < Q.points.length; i += 1) {
            const d = (Q.points[i].x - qFirst.x) * nx + (Q.points[i].y - qFirst.y) * ny;
            if (d < dMin) dMin = d;
            if (d > dMax) dMax = d;
        }
        // Margem para pesos racionais se houver
        if (Q.weights && Q.weights.some((w) => Math.abs(w - 1) > 1e-6)) {
            const wMin = Math.min(...Q.weights);
            const wMax = Math.max(...Q.weights);
            const ratioW = wMin > 1e-9 ? wMax / wMin : 2;
            const pad = 0.5 * (ratioW - 1) * (dMax - dMin);
            dMin -= pad;
            dMax += pad;
        }
        const fatPad = 1e-11 * scale;
        dMin -= fatPad;
        dMax += fatPad;

        // Distâncias assinadas dos pontos de controle de P à reta base de Q
        const hasWP = Boolean(P.weights && P.weights.some((w) => Math.abs(w - 1) > 1e-6));
        const dP = new Array(P.points.length);
        let minWP = 1;
        let maxWP = 1;
        if (hasWP) {
            minWP = Math.min(...P.weights);
            maxWP = Math.max(...P.weights);
        }
        for (let i = 0; i < P.points.length; i += 1) {
            dP[i] = (P.points[i].x - qFirst.x) * nx + (P.points[i].y - qFirst.y) * ny;
        }
        const clipMin = hasWP && dMin < 0 ? dMin * (maxWP / Math.max(1e-9, minWP)) : dMin;
        const clipMax = hasWP && dMax > 0 ? dMax * (maxWP / Math.max(1e-9, minWP)) : dMax;

        const clipped = clipBernsteinToFatLine(dP, clipMin, clipMax);
        if (!clipped) continue;

        const [s0, s1] = clipped;
        const width = s1 - s0;

        if (width < 0.8) {
            const subP = clipBezierInterval(P, s0, s1);
            subP.u0 = P.u0 + s0 * spanP;
            subP.u1 = P.u0 + s1 * spanP;
            stack.push({
                P: Q,
                Q: subP,
                swapped: !swapped,
                depth: depth + 1,
            });
        } else {
            // Múltiplas raízes no intervalo: bissecta a curva de maior span paramétrico
            if (spanP >= spanQ) {
                const [leftP, rightP] = subdivideBezier(P, 0.5);
                const uMid = 0.5 * (P.u0 + P.u1);
                leftP.u0 = P.u0; leftP.u1 = uMid;
                rightP.u0 = uMid; rightP.u1 = P.u1;
                stack.push(
                    { P: Q, Q: rightP, swapped: !swapped, depth: depth + 1 },
                    { P: Q, Q: leftP, swapped: !swapped, depth: depth + 1 },
                );
            } else {
                const [leftQ, rightQ] = subdivideBezier(Q, 0.5);
                const vMid = 0.5 * (Q.u0 + Q.u1);
                leftQ.u0 = Q.u0; leftQ.u1 = vMid;
                rightQ.u0 = vMid; rightQ.u1 = Q.u1;
                stack.push(
                    { P, Q: rightQ, swapped, depth: depth + 1 },
                    { P, Q: leftQ, swapped, depth: depth + 1 },
                );
            }
        }
    }

    const out = [];
    for (const [u0, v0] of candidates) {
        const hit = polishBezierIntersection(curve1, curve2, u0, v0, scale);
        if (hit && !out.some((h) => Math.hypot(h.point.x - hit.point.x, h.point.y - hit.point.y) <= 1e-7 * scale)) {
            out.push(hit);
        }
    }
    return out;
}
