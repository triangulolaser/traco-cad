// Predicados geométricos robustos em IEEE-754 Float64 (Transformações Livres de Erro de
// Dekker/Veltkamp/Knuth/Shewchuk), solucionadores algébricos condicionados (Citardauq,
// Cardano-Viète, Bernstein-Descartes) e arcos racionais por bulge sem trigonometria.

const SPLITTER = 134217729.0; // 2^27 + 1 (Veltkamp)
const EPS_F64 = Number.EPSILON; // 2^-52 ≈ 2.220446049250313e-16

// ---------------------------------------------------------------------------
// 1. Error-Free Transformations (EFT)

export function fastTwoSum(a, b) {
    const s = a + b;
    const z = s - a;
    const e = b - z;
    return [s, e];
}

export function twoSum(a, b) {
    const s = a + b;
    const v = s - a;
    const e = (a - (s - v)) + (b - v);
    return [s, e];
}

export function twoDiff(a, b) {
    const s = a - b;
    const v = s - a;
    const e = (a - (s - v)) - (b + v);
    return [s, e];
}

export function split(a) {
    const c = SPLITTER * a;
    const abig = c - a;
    const ahi = c - abig;
    const alo = a - ahi;
    return [ahi, alo];
}

export function twoProduct(a, b) {
    const p = a * b;
    const [ahi, alo] = split(a);
    const [bhi, blo] = split(b);
    const err1 = p - ahi * bhi;
    const err2 = err1 - alo * bhi;
    const err3 = err2 - ahi * blo;
    const e = alo * blo - err3;
    return [p, e];
}

// Expansão de precisão arbitrária (Shewchuk): soma um escalar `b` à expansão `e`.
export function growExpansion(e, b) {
    const out = [];
    let q = b;
    for (let i = 0; i < e.length; i += 1) {
        const [ nextQ, h ] = twoSum(q, e[i]);
        if (h !== 0) out.push(h);
        q = nextQ;
    }
    if (q !== 0 || out.length === 0) out.push(q);
    return out;
}

export function expansionSum(e, f) {
    let out = e.slice();
    for (let i = 0; i < f.length; i += 1) {
        out = growExpansion(out, f[i]);
    }
    return out;
}

export function scaleExpansion(e, b) {
    if (e.length === 0) return [0];
    const out = [];
    let [q, hh] = twoProduct(e[0], b);
    if (hh !== 0) out.push(hh);
    for (let i = 1; i < e.length; i += 1) {
        const [ti, tlo] = twoProduct(e[i], b);
        const [sum1, h1] = twoSum(q, tlo);
        if (h1 !== 0) out.push(h1);
        const [sum2, h2] = fastTwoSum(ti, sum1);
        if (h2 !== 0) out.push(h2);
        q = sum2;
    }
    if (q !== 0 || out.length === 0) out.push(q);
    return out;
}

export function estimateExpansion(e) {
    let s = 0;
    for (let i = 0; i < e.length; i += 1) s += e[i];
    return s;
}

export const scaleExpansionZeroElim = scaleExpansion;
export const fastExpansionSumZeroElim = expansionSum;
export const estimate = estimateExpansion;

// Produto escalar e produto vetorial 2D compensados (Ogita-Rump-Oishi Dot2).
export function compensatedDot(ax, ay, bx, by) {
    const [p1, s1] = twoProduct(ax, bx);
    const [p2, s2] = twoProduct(ay, by);
    const [p, s] = twoSum(p1, p2);
    return p + (s1 + s2 + s);
}

export function compensatedCross(ax, ay, bx, by) {
    const [p1, s1] = twoProduct(ax, by);
    const [p2, s2] = twoProduct(ay, bx);
    const [p, s] = twoDiff(p1, p2);
    return p + (s1 - s2 + s);
}

export function compensatedSubProduct(a, b, c, d) {
    // Calcula a*b - c*d com compensação EFT completa -> [hi, lo]
    const [p1, e1] = twoProduct(a, b);
    const [p2, e2] = twoProduct(c, d);
    const [diff, ed] = twoDiff(p1, p2);
    const err = (e1 - e2) + ed;
    return fastTwoSum(diff, err);
}

// ---------------------------------------------------------------------------
// 2. Predicados Geométricos Exatos (orient2d e incircle)

const ORIENT2D_ERRBOUND = (3 + 16 * EPS_F64) * EPS_F64;
const INCIRCLE_ERRBOUND = (10 + 96 * EPS_F64) * EPS_F64;

function twoTwoDiff(a1, a0, b1, b0) {
    const [j, r0] = twoDiff(a0, b0);
    const [w0, r1] = twoSum(a1, j);
    const [u1, r2] = twoDiff(w0, b1);
    const [u2, u0] = fastTwoSum(u1, r1);
    return [r0, r2, u0, u2].filter((x, idx, arr) => x !== 0 || idx === arr.length - 1);
}

// Determinante de orientação 2D: > 0 se (pa, pb, pc) é anti-horário (CCW),
// < 0 se horário (CW), 0 se colineares. Invariante a grandes coordenadas (ex. UTM 10^7).
export function orient2d(pa, pb, pc) {
    const acx = pa.x - pc.x;
    const bcx = pb.x - pc.x;
    const acy = pa.y - pc.y;
    const bcy = pb.y - pc.y;

    const detleft = acx * bcy;
    const detright = acy * bcx;
    const det = detleft - detright;

    const detsum = Math.abs(detleft) + Math.abs(detright);
    if (Math.abs(det) >= ORIENT2D_ERRBOUND * detsum) {
        return det;
    }

    // Subtração exata das coordenadas antes do produto (elimina erro em UTM 10^7)
    const [acxHi, acxLo] = twoDiff(pa.x, pc.x);
    const [bcxHi, bcxLo] = twoDiff(pb.x, pc.x);
    const [acyHi, acyLo] = twoDiff(pa.y, pc.y);
    const [bcyHi, bcyLo] = twoDiff(pb.y, pc.y);

    const [p1, e1] = twoProduct(acxHi, bcyHi);
    const [p2, e2] = twoProduct(acyHi, bcxHi);
    let B = twoTwoDiff(p1, e1, p2, e2);

    if (acxLo !== 0 || acyLo !== 0 || bcxLo !== 0 || bcyLo !== 0) {
        const terms = [
            twoProduct(acxLo, bcyHi),
            twoProduct(acxHi, bcyLo),
            twoProduct(acxLo, bcyLo),
            twoProduct(-acyLo, bcxHi),
            twoProduct(-acyHi, bcxLo),
            twoProduct(-acyLo, bcxLo),
        ];
        for (const [hi, lo] of terms) {
            if (lo !== 0) B = growExpansion(B, lo);
            if (hi !== 0) B = growExpansion(B, hi);
        }
    }

    return B[B.length - 1] ?? 0;
}

export function orient2dSign(pa, pb, pc, tol = 0) {
    const d = orient2d(pa, pb, pc);
    if (Math.abs(d) <= tol) return 0;
    return d > 0 ? 1 : -1;
}

export const orient2dFast = orient2dSign;

// Predicado incircle(pa, pb, pc, pd): > 0 se pd está dentro do círculo orientado (pa, pb, pc).
export function incircle(pa, pb, pc, pd) {
    const adx = pa.x - pd.x;
    const bdx = pb.x - pd.x;
    const cdx = pc.x - pd.x;
    const ady = pa.y - pd.y;
    const bdy = pb.y - pd.y;
    const cdy = pc.y - pd.y;

    const bdxcdy = bdx * cdy;
    const cdxbdy = cdx * bdy;
    const alift = adx * adx + ady * ady;

    const cdxady = cdx * ady;
    const adxcdy = adx * cdy;
    const blift = bdx * bdx + bdy * bdy;

    const adxbdy = adx * bdy;
    const bdxady = bdx * ady;
    const clift = cdx * cdx + cdy * cdy;

    const det = alift * (bdxcdy - cdxbdy)
        + blift * (cdxady - adxcdy)
        + clift * (adxbdy - bdxady);

    const permanent = (Math.abs(bdxcdy) + Math.abs(cdxbdy)) * alift
        + (Math.abs(cdxady) + Math.abs(adxcdy)) * blift
        + (Math.abs(adxbdy) + Math.abs(bdxady)) * clift;

    if (Math.abs(det) >= INCIRCLE_ERRBOUND * permanent) {
        return det;
    }

    // Cálculo em expansão EFT para configurações quase cocirculares
    const sub2 = (x1, y1, x2, y2) => {
        const [p1, e1] = twoProduct(x1, y2);
        const [p2, e2] = twoProduct(x2, y1);
        return twoTwoDiff(p1, e1, p2, e2);
    };
    const sqDist = (dx, dy) => {
        const [px, ex] = twoProduct(dx, dx);
        const [py, ey] = twoProduct(dy, dy);
        return expansionSum([ex, px], [ey, py]);
    };
    const mulExp = (e, f) => {
        let acc = [0];
        for (const v of f) {
            if (v !== 0) acc = expansionSum(acc, scaleExpansion(e, v));
        }
        return acc;
    };

    const bc = sub2(bdx, bdy, cdx, cdy);
    const ca = sub2(cdx, cdy, adx, ady);
    const ab = sub2(adx, ady, bdx, bdy);

    const aa = sqDist(adx, ady);
    const bb = sqDist(bdx, bdy);
    const cc = sqDist(cdx, cdy);

    const fin = expansionSum(
        expansionSum(mulExp(bc, aa), mulExp(ca, bb)),
        mulExp(ab, cc),
    );
    return fin[fin.length - 1] ?? 0;
}

// ---------------------------------------------------------------------------
// 3. Solucionadores Algébricos Estáveis (Citardauq, Cúbica, Quártica, Bernstein)

// Resolve A*t^2 + B*t + C = 0 pela fórmula de Citardauq com discriminante compensado EFT.
export function solveQuadraticStable(A, B, C, tol = 1e-14) {
    const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C));
    if (scale === 0 || !Number.isFinite(scale)) return [];
    const a = A / scale;
    const b = B / scale;
    const c = C / scale;

    if (Math.abs(a) <= 1e-15) {
        if (Math.abs(b) <= 1e-15) return [];
        return [-c / b];
    }

    // Discriminante b^2 - 4ac com EFT para evitar cancelamento em tangências rasantes
    const [b2, eb2] = twoProduct(b, b);
    const [ac4, eac4] = twoProduct(4 * a, c);
    const [discHi, discLo] = twoDiff(b2, ac4);
    let disc = discHi + (eb2 - eac4 + discLo);

    const relTol = tol * (b2 + Math.abs(ac4) + 1);
    if (disc < -relTol) return [];
    if (disc <= relTol) {
        return [-b / (2 * a)];
    }

    const sq = Math.sqrt(disc);
    const signB = b >= 0 ? 1 : -1;
    const q = -0.5 * (b + signB * sq);
    if (q === 0) return [0];
    const t1 = q / a;
    const t2 = c / q;
    if (Math.abs(t1 - t2) <= tol * Math.max(1, Math.abs(t1), Math.abs(t2))) {
        return [0.5 * (t1 + t2)];
    }
    return t1 < t2 ? [t1, t2] : [t2, t1];
}

// Resolve A*x^3 + B*x^2 + C*x + D = 0 analiticamente (Viète/Cardano + polimento Halley/Newton).
export function solveCubicReal(A, B, C, D, tol = 1e-14) {
    const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C), Math.abs(D));
    if (scale === 0 || !Number.isFinite(scale)) return [];
    if (Math.abs(A) <= 1e-14 * scale) {
        return solveQuadraticStable(B, C, D, tol);
    }

    const a = B / A;
    const b = C / A;
    const c = D / A;

    const a3 = a / 3;
    const [a2, ea2] = twoProduct(a, a);
    const [b3, eb3] = twoProduct(3, b);
    const p = ((b3 - a2) + (eb3 - ea2)) / 3;
    const q = (2 * a * a * a - 9 * a * b + 27 * c) / 27;

    const p3 = p / 3;
    const q2 = q / 2;
    const disc = q2 * q2 + p3 * p3 * p3;

    let rawRoots = [];
    if (Math.abs(p) <= 1e-15 && Math.abs(q) <= 1e-15) {
        rawRoots = [-a3];
    } else if (disc > 1e-15 * (q2 * q2 + Math.abs(p3 * p3 * p3) + 1e-30)) {
        const sq = Math.sqrt(disc);
        const u = Math.cbrt(-q2 + sq);
        const v = Math.cbrt(-q2 - sq);
        rawRoots = [u + v - a3];
    } else if (disc >= -1e-14 * (q2 * q2 + Math.abs(p3 * p3 * p3) + 1e-30) && p >= -1e-15) {
        const u = Math.cbrt(-q2);
        rawRoots = [2 * u - a3, -u - a3];
    } else {
        const r = Math.sqrt(Math.max(0, -p3));
        const r3 = r * r * r;
        const cosArg = r3 > 0 ? Math.min(1, Math.max(-1, -q2 / r3)) : 0;
        const phi = Math.acos(cosArg) / 3;
        const twoR = 2 * r;
        rawRoots = [
            twoR * Math.cos(phi) - a3,
            twoR * Math.cos(phi - (2 * Math.PI) / 3) - a3,
            twoR * Math.cos(phi - (4 * Math.PI) / 3) - a3,
        ];
    }

    // Polimento por Halley/Newton sobre o polinômio normalizado x^3 + a*x^2 + b*x + c
    const polished = rawRoots.map((x0) => {
        let x = x0;
        for (let it = 0; it < 6; it += 1) {
            const f = ((x + a) * x + b) * x + c;
            const df = (3 * x + 2 * a) * x + b;
            const d2f = 6 * x + 2 * a;
            if (Math.abs(f) <= 1e-15 * (Math.abs(x) ** 3 + 1)) break;
            const denom = 2 * df * df - f * d2f;
            if (Math.abs(denom) > 1e-20) {
                const dx = (2 * f * df) / denom;
                if (Math.abs(dx) <= 1e-15 * Math.max(1, Math.abs(x))) {
                    x -= dx;
                    break;
                }
                x -= dx;
            } else if (Math.abs(df) > 1e-15) {
                x -= f / df;
            } else {
                break;
            }
        }
        return x;
    });

    polished.sort((x, y) => x - y);
    const unique = [];
    for (const r of polished) {
        if (!Number.isFinite(r)) continue;
        if (unique.length === 0 || Math.abs(r - unique[unique.length - 1]) > tol * Math.max(1, Math.abs(r))) {
            unique.push(r);
        }
    }
    return unique;
}

// Resolve equação de 4º grau A*x^4 + B*x^3 + C*x^2 + D*x + E = 0 (Ferrari + polimento Newton).
export function solveQuarticReal(A, B, C, D, E, tol = 1e-12) {
    const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C), Math.abs(D), Math.abs(E));
    if (scale === 0 || !Number.isFinite(scale)) return [];
    if (Math.abs(A) <= 1e-13 * scale) {
        return solveCubicReal(B, C, D, E, tol);
    }

    const a = B / A;
    const b = C / A;
    const c = D / A;
    const d = E / A;

    const a4 = a / 4;
    const a2 = a * a;
    const p = b - (3 * a2) / 8;
    const q = (a2 * a) / 8 - (a * b) / 2 + c;
    const r = -(3 * a2 * a2) / 256 + (a2 * b) / 16 - (a * c) / 4 + d;

    let raw = [];
    if (Math.abs(q) <= 1e-14) {
        // Biquadrática y^4 + p*y^2 + r = 0
        const uRoots = solveQuadraticStable(1, p, r, 1e-14);
        for (const u of uRoots) {
            if (u >= -1e-14) {
                const s = Math.sqrt(Math.max(0, u));
                raw.push(s - a4, -s - a4);
            }
        }
    } else {
        // Resolvente cúbica: m^3 + (p/2)*m^2 + ((p^2 - 4r)/16)*m - q^2/64 = 0
        const mRoots = solveCubicReal(1, p / 2, (p * p - 4 * r) / 16, -(q * q) / 64, 1e-14);
        let m = Math.max(...mRoots);
        if (!(m > 0)) {
            m = mRoots.find((v) => v >= -1e-12) ?? 0;
        }
        const alpha = 2 * Math.sqrt(Math.max(0, m));
        if (alpha > 1e-12) {
            const beta1 = (p + 2 * m - q / alpha) / 2;
            const beta2 = (p + 2 * m + q / alpha) / 2;
            for (const y of solveQuadraticStable(1, alpha, beta1, 1e-14)) raw.push(y - a4);
            for (const y of solveQuadraticStable(1, -alpha, beta2, 1e-14)) raw.push(y - a4);
        } else {
            const uRoots = solveQuadraticStable(1, p, r, 1e-14);
            for (const u of uRoots) {
                if (u >= -1e-12) {
                    const s = Math.sqrt(Math.max(0, u));
                    raw.push(s - a4, -s - a4);
                }
            }
        }
    }

    const polished = [];
    for (const x0 of raw) {
        let x = x0;
        for (let it = 0; it < 8; it += 1) {
            const f = (((x + a) * x + b) * x + c) * x + d;
            const df = ((4 * x + 3 * a) * x + 2 * b) * x + c;
            if (Math.abs(f) <= 1e-15 * (Math.abs(x) ** 4 + 1)) break;
            if (Math.abs(df) <= 1e-15) break;
            const dx = f / df;
            x -= dx;
            if (Math.abs(dx) <= 1e-15 * Math.max(1, Math.abs(x))) break;
        }
        const fFinal = (((x + a) * x + b) * x + c) * x + d;
        if (Math.abs(fFinal) <= 1e-7 * (Math.abs(x) ** 4 + 1)) {
            polished.push(x);
        }
    }

    polished.sort((x, y) => x - y);
    const unique = [];
    for (const x of polished) {
        if (unique.length === 0 || Math.abs(x - unique[unique.length - 1]) > tol * Math.max(1, Math.abs(x))) {
            unique.push(x);
        }
    }
    return unique;
}

// Avalia um polinômio escalar em base de Bernstein c[0..n] e sua derivada em u ∈ [0,1].
export function evalBernsteinScalar(coeffs, u) {
    const n = coeffs.length - 1;
    if (n === 0) return { val: coeffs[0], deriv: 0 };
    const work = coeffs.slice();
    const oneMinusU = 1 - u;
    for (let r = 1; r < n; r += 1) {
        for (let i = 0; i <= n - r; i += 1) {
            work[i] = oneMinusU * work[i] + u * work[i + 1];
        }
    }
    const deriv = n * (work[1] - work[0]);
    const val = oneMinusU * work[0] + u * work[1];
    return { val, deriv };
}

function splitBernsteinScalar(coeffs, u = 0.5) {
    const n = coeffs.length - 1;
    const left = new Array(n + 1);
    const right = new Array(n + 1);
    const work = coeffs.slice();
    const oneMinusU = 1 - u;
    left[0] = work[0];
    right[n] = work[n];
    for (let r = 1; r <= n; r += 1) {
        for (let i = 0; i <= n - r; i += 1) {
            work[i] = oneMinusU * work[i] + u * work[i + 1];
        }
        left[r] = work[0];
        right[n - r] = work[n - r];
    }
    return [left, right];
}

function signVariations(coeffs, eps) {
    let count = 0;
    let prevSign = 0;
    for (let i = 0; i < coeffs.length; i += 1) {
        const v = coeffs[i];
        const s = Math.abs(v) <= eps ? 0 : (v > 0 ? 1 : -1);
        if (s !== 0) {
            if (prevSign !== 0 && s !== prevSign) count += 1;
            prevSign = s;
        }
    }
    return count;
}

// Encontra todas as raízes reais em [0, 1] de um polinômio em base de Bernstein.
// Combina isolamento por variação de sinal de Descartes + subdivisão de de Casteljau + Newton.
export function solveBernsteinRoots(coeffs, tol = 1e-14) {
    const n = coeffs.length - 1;
    if (n <= 0) return [];
    const maxAbs = Math.max(...coeffs.map(Math.abs));
    if (maxAbs === 0 || !Number.isFinite(maxAbs)) return [];
    const norm = coeffs.map((c) => c / maxAbs);
    const eps = 1e-14;

    const roots = [];
    const stack = [[norm, 0, 1, 0]];

    while (stack.length > 0) {
        const [c, t0, t1, depth] = stack.pop();
        let minC = Infinity;
        let maxC = -Infinity;
        for (let i = 0; i <= n; i += 1) {
            if (c[i] < minC) minC = c[i];
            if (c[i] > maxC) maxC = c[i];
        }
        if (minC > eps || maxC < -eps) continue;

        const dt = t1 - t0;
        if (dt <= tol || depth >= 48) {
            roots.push(0.5 * (t0 + t1));
            continue;
        }

        if (Math.abs(c[0]) <= eps) roots.push(t0);
        if (Math.abs(c[n]) <= eps) roots.push(t1);

        const vars = signVariations(c, eps);
        if (vars === 0) {
            // Verifica mínimo rasante (raiz dupla/tangente)
            if (Math.min(Math.abs(minC), Math.abs(maxC)) <= 1e-9) {
                const [left, right] = splitBernsteinScalar(c, 0.5);
                const tm = 0.5 * (t0 + t1);
                stack.push([right, tm, t1, depth + 1], [left, t0, tm, depth + 1]);
            }
            continue;
        }

        if (vars === 1 && Math.abs(c[0]) > 1e-7 && Math.abs(c[n]) > 1e-7 && c[0] * c[n] < 0) {
            // Tenta convergir por Newton-Raphson + secante dentro de [t0, t1]
            let u = 0.5 * (t0 + t1);
            const f0 = c[0];
            const f1 = c[n];
            if (f0 * f1 < 0) {
                u = t0 + (dt * Math.abs(f0)) / (Math.abs(f0) + Math.abs(f1));
            }
            let converged = false;
            for (let it = 0; it < 10; it += 1) {
                const { val, deriv } = evalBernsteinScalar(norm, u);
                if (Math.abs(val) <= 1e-15) {
                    converged = true;
                    break;
                }
                if (Math.abs(deriv) <= 1e-12) break;
                const nextU = u - val / deriv;
                if (nextU < t0 - 1e-12 || nextU > t1 + 1e-12) break;
                if (Math.abs(nextU - u) <= tol) {
                    u = Math.min(t1, Math.max(t0, nextU));
                    converged = true;
                    break;
                }
                u = nextU;
            }
            if (converged) {
                roots.push(Math.min(1, Math.max(0, u)));
                continue;
            }
        }

        const [left, right] = splitBernsteinScalar(c, 0.5);
        const tm = 0.5 * (t0 + t1);
        stack.push([right, tm, t1, depth + 1], [left, t0, tm, depth + 1]);
    }

    // Polimento final (inclusive para raízes duplas onde f'(u) = 0, logo raiz de f'(u))
    const polished = roots.map((u0) => {
        let u = u0;
        for (let it = 0; it < 8; it += 1) {
            const { val, deriv } = evalBernsteinScalar(norm, u);
            if (Math.abs(val) <= 1e-15) break;
            if (Math.abs(deriv) > 1e-11) {
                const du = val / deriv;
                u = Math.min(1, Math.max(0, u - du));
                if (Math.abs(du) <= 1e-15) break;
            } else {
                break;
            }
        }
        return u;
    });

    polished.sort((a, b) => a - b);
    const unique = [];
    for (const r of polished) {
        const { val } = evalBernsteinScalar(norm, r);
        if (Math.abs(val) > 1e-6) continue;
        if (unique.length === 0 || Math.abs(r - unique[unique.length - 1]) > 1e-9) {
            unique.push(r);
        }
    }
    return unique;
}

// ---------------------------------------------------------------------------
// 4. Arcos com Bulge Racional (Zero Trigonometria no Centro e no Raio)

const TWO_PI = Math.PI * 2;

function normalizeAngleRad(a) {
    let r = a % TWO_PI;
    if (r < 0) r += TWO_PI;
    return r;
}

// Dado b = tan(θ/4) e corda c = p2 - p1 (L = ||c||_2):
// sin(θ/2) = 2b / (1 + b^2), cos(θ/2) = (1 - b^2) / (1 + b^2), cot(θ/2) = (1 - b^2) / (2b)
// R = L*(1 + b^2) / (4*|b|), C = m + ((1 - b^2) / (4*b)) * c^⊥
export function bulgeToArcRational(a, b, bulge) {
    const [cx, ex] = twoDiff(b.x, a.x);
    const [cy, ey] = twoDiff(b.y, a.y);
    const dx = cx + ex;
    const dy = cy + ey;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-9 || Math.abs(bulge) < 1e-9) return null;

    const b2 = bulge * bulge;
    const onePlusB2 = 1 + b2;
    const [oneMinusB2Hi, oneMinusB2Lo] = twoDiff(1, b2);
    const oneMinusB2 = oneMinusB2Hi + oneMinusB2Lo;

    const radius = (chord * onePlusB2) / (4 * Math.abs(bulge));
    const factor = oneMinusB2 / (4 * bulge);

    // Coordenadas baricêntricas locais em torno de m = a + 0.5 * (b - a)
    const mx = a.x + 0.5 * dx;
    const my = a.y + 0.5 * dy;
    const nx = -dy;
    const ny = dx;

    const center = {
        x: mx + factor * nx,
        y: my + factor * ny,
    };

    // Ângulos calculados a partir dos vetores deslocados do centro:
    // a - center = -0.5*c - factor*c^⊥ (evita subtrair center de a quando R >> chord em UTM!)
    const vaX = -0.5 * dx - factor * nx;
    const vaY = -0.5 * dy - factor * ny;
    const vbX = 0.5 * dx - factor * nx;
    const vbY = 0.5 * dy - factor * ny;

    let start = Math.atan2(vaY, vaX);
    let end = Math.atan2(vbY, vbX);
    const startPt = bulge < 0 ? { x: b.x, y: b.y } : { x: a.x, y: a.y };
    const endPt = bulge < 0 ? { x: a.x, y: a.y } : { x: b.x, y: b.y };
    if (bulge < 0) [start, end] = [end, start];

    return {
        kind: 'arc',
        center,
        radius,
        start: normalizeAngleRad(start),
        end: normalizeAngleRad(end),
        bulge,
        chordA: { x: a.x, y: a.y },
        chordB: { x: b.x, y: b.y },
        p0: startPt,
        p1: endPt,
    };
}

// Parametrização estereográfica racional exata do arco com bulge no referencial da corda (u ∈ [-1, 1]):
// ξ(u) = (L/2) * (1 + b^2)*u / (1 + b^2*u^2),  η(u) = -(L/2) * b*(1 - u^2) / (1 + b^2*u^2)
// Elimina 100% do cancelamento catastrófico para |b| ≈ 10^-7 e coordenadas UTM 10^7.
export function evalBulgeArcRational(a, b, bulge, u) {
    const [cx, ex] = twoDiff(b.x, a.x);
    const [cy, ey] = twoDiff(b.y, a.y);
    const dx = cx + ex;
    const dy = cy + ey;
    const b2 = bulge * bulge;
    const denom = 1 + b2 * u * u;
    const alpha = (0.5 * (1 + b2) * u) / denom;
    const beta = (-0.5 * bulge * (1 - u * u)) / denom;
    return {
        x: a.x + ((0.5 + alpha) * dx - beta * dy),
        y: a.y + ((0.5 + alpha) * dy + beta * dx),
    };
}

export function closestPointOnBulgeArcRational(arg1, arg2, arg3, arg4) {
    let p;
    let a;
    let b;
    let bulge;
    if (arg3 !== undefined && arg4 !== undefined) {
        a = arg1;
        b = arg2;
        bulge = arg3;
        p = arg4;
    } else if (arg1 && arg1.chordA) {
        a = arg1.chordA;
        b = arg1.chordB;
        bulge = arg1.bulge;
        p = arg2;
    } else {
        p = arg1;
        a = arg2.chordA;
        b = arg2.chordB;
        bulge = arg2.bulge;
    }
    const [cx, ex] = twoDiff(b.x, a.x);
    const [cy, ey] = twoDiff(b.y, a.y);
    const dx = cx + ex;
    const dy = cy + ey;
    const L = Math.hypot(dx, dy);
    if (L < 1e-12) return { x: a.x, y: a.y, point: { x: a.x, y: a.y } };

    const ux = dx / L;
    const uy = dy / L;
    const vx = -uy;
    const vy = ux;

    const [pxHi, pxLo] = twoDiff(p.x, a.x);
    const [pyHi, pyLo] = twoDiff(p.y, a.y);
    const px = (pxHi + pxLo) - 0.5 * dx;
    const py = (pyHi + pyLo) - 0.5 * dy;

    const xiP = px * ux + py * uy;
    const etaP = px * vx + py * vy;
    const halfL = 0.5 * L;
    const b2 = bulge * bulge;

    let u = Math.min(1, Math.max(-1, xiP / halfL));
    for (let it = 0; it < 10; it += 1) {
        const u2 = u * u;
        const D = 1 + b2 * u2;
        const D2 = D * D;
        const xi = (halfL * (1 + b2) * u) / D;
        const eta = (-halfL * bulge * (1 - u2)) / D;
        const dxi = (halfL * (1 + b2) * (1 - b2 * u2)) / D2;
        const deta = (halfL * bulge * 2 * u * (1 + b2)) / D2;
        const ddxi = (-halfL * (1 + b2) * 2 * b2 * u * (3 - b2 * u2)) / (D2 * D);
        const ddeta = (halfL * bulge * 2 * (1 + b2) * (1 - 3 * b2 * u2)) / (D2 * D);

        const rx = xi - xiP;
        const ry = eta - etaP;
        const f = rx * dxi + ry * deta;
        const df = dxi * dxi + deta * deta + rx * ddxi + ry * ddeta;
        if (Math.abs(f) <= 1e-15 * L * L || Math.abs(df) <= 1e-18) break;
        const nextU = Math.min(1, Math.max(-1, u - f / df));
        if (Math.abs(nextU - u) <= 1e-15) {
            u = nextU;
            break;
        }
        u = nextU;
    }

    const cand = evalBulgeArcRational(a, b, bulge, u);
    const dCand = Math.hypot(cand.x - p.x, cand.y - p.y);
    const ulpBound = 2 * EPS_F64 * Math.max(1, Math.hypot(p.x, p.y));
    if (dCand <= ulpBound) {
        return { x: p.x, y: p.y, point: { x: p.x, y: p.y } };
    }
    const dA = Math.hypot(a.x - p.x, a.y - p.y);
    const dB = Math.hypot(b.x - p.x, b.y - p.y);
    if (dA < dCand && dA <= dB) return { x: a.x, y: a.y, point: { x: a.x, y: a.y } };
    if (dB < dCand && dB < dA) return { x: b.x, y: b.y, point: { x: b.x, y: b.y } };
    return { x: cand.x, y: cand.y, point: cand };
}

// Interseção racional direta entre reta (lineA -> lineB) e arco com bulge no referencial da corda.
export function intersectLineBulgeArcRational(lineA, lineB, arcOrA, extendOrB = false, maybeBulge = undefined, maybeExtend = false) {
    let a;
    let b;
    let bulge;
    let extendArc;
    if (typeof maybeBulge === 'number') {
        a = arcOrA;
        b = extendOrB;
        bulge = maybeBulge;
        extendArc = Boolean(maybeExtend);
    } else {
        a = arcOrA.chordA;
        b = arcOrA.chordB;
        bulge = arcOrA.bulge;
        extendArc = Boolean(extendOrB);
    }
    const [cx, ex] = twoDiff(b.x, a.x);
    const [cy, ey] = twoDiff(b.y, a.y);
    const dx = cx + ex;
    const dy = cy + ey;
    const L = Math.hypot(dx, dy);
    if (L < 1e-12) return [];

    const ux = dx / L;
    const uy = dy / L;
    const vx = -uy;
    const vy = ux;

    const [laxHi, laxLo] = twoDiff(lineA.x, a.x);
    const [layHi, layLo] = twoDiff(lineA.y, a.y);
    const [lbxHi, lbxLo] = twoDiff(lineB.x, a.x);
    const [lbyHi, lbyLo] = twoDiff(lineB.y, a.y);
    const lax = (laxHi + laxLo) - 0.5 * dx;
    const lay = (layHi + layLo) - 0.5 * dy;
    const lbx = (lbxHi + lbxLo) - 0.5 * dx;
    const lby = (lbyHi + lbyLo) - 0.5 * dy;

    const xi1 = lax * ux + lay * uy;
    const eta1 = lax * vx + lay * vy;
    const xi2 = lbx * ux + lby * uy;
    const eta2 = lbx * vx + lby * vy;

    const ldx = xi2 - xi1;
    const ldy = eta2 - eta1;
    const lLen = Math.hypot(ldx, ldy);
    if (lLen < 1e-15) return [];

    // Equação implícita normalizada da reta no referencial da corda: alpha*ξ + beta*η + gamma = 0
    const alpha = -ldy / lLen;
    const beta = ldx / lLen;
    const gamma = -(alpha * xi1 + beta * eta1);

    const halfL = 0.5 * L;
    const b2 = bulge * bulge;
    const QA = gamma * b2 + beta * halfL * bulge;
    const QB = alpha * halfL * (1 + b2);
    const QC = gamma - beta * halfL * bulge;

    const uRoots = solveQuadraticStable(QA, QB, QC, 1e-14);
    const out = [];
    for (const u of uRoots) {
        if (!extendArc && (u < -1 - 1e-7 || u > 1 + 1e-7)) continue;
        const uClamped = extendArc ? u : Math.min(1, Math.max(-1, u));
        const pt = evalBulgeArcRational(a, b, bulge, uClamped);
        const t = ((pt.x - lineA.x) * (lineB.x - lineA.x) + (pt.y - lineA.y) * (lineB.y - lineA.y))
            / ((lineB.x - lineA.x) ** 2 + (lineB.y - lineA.y) ** 2);
        out.push({ x: pt.x, y: pt.y, point: pt, t, u: uClamped });
    }
    return out;
}

// Calcula tan(θ/4) racionalmente sem atan/tan:
// Dado o vetor unitário inicial u0 = (cos start, sin start) e final u1 = (cos end, sin end),
// o vetor corda normalizado e a sagitta determinam tan(θ/4) = sin(θ/2) / (1 + cos(θ/2)).
export function sweepToBulgeRational(sweep) {
    const half = 0.5 * sweep;
    const s = Math.sin(half);
    const c = Math.cos(half);
    if (1 + c <= 1e-15) return Math.tan(sweep / 4);
    return s / (1 + c);
}
