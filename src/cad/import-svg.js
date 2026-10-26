import { parseSvgDom, parseLengthMm } from './svg.js';

// SVG do CorelDRAW → DXF (LINE/ARC) para os importadores de corte.
// O Corel quebra curvas em retas ao exportar DXF; no SVG a Bézier sai exata.
// Cada Bézier vira arcos tangentes encadeados (biarcos) dentro da tolerância,
// porque o corte só usa linhas e arcos.

const SKIP = new Set(['defs', 'clippath', 'mask', 'pattern', 'symbol', 'metadata', 'style', 'title', 'desc', 'text', 'image', 'lineargradient', 'radialgradient', 'marker']);
const EPS = 1e-9;

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = a => Math.hypot(a.x, a.y);
const norm = a => { const l = len(a); return l < EPS ? null : { x: a.x / l, y: a.y / l }; };

// ---------- transformações ----------
const IDENTITY = [1, 0, 0, 1, 0, 0];
const compose = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

function parseTransform(text) {
    let m = IDENTITY;
    if (!text) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
    let g;
    while ((g = re.exec(text))) {
        const v = (g[2].match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
        const kind = g[1].toLowerCase();
        let t = IDENTITY;
        if (kind === 'matrix' && v.length >= 6) t = v.slice(0, 6);
        else if (kind === 'translate') t = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
        else if (kind === 'scale') t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        else if (kind === 'rotate') {
            const a = (v[0] || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
            t = [c, s, -s, c, 0, 0];
            if (v.length >= 3) t = compose(compose([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]]);
        } else if (kind === 'skewx') t = [1, 0, Math.tan((v[0] || 0) * Math.PI / 180), 1, 0, 0];
        else if (kind === 'skewy') t = [1, Math.tan((v[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
        m = compose(m, t);
    }
    return m;
}

// ---------- path → segmentos (linhas e cúbicas, em coordenadas do usuário) ----------
function arcToCubics(p0, rx, ry, phiDeg, largeArc, sweep, p1) {
    if (Math.abs(p0.x - p1.x) < EPS && Math.abs(p0.y - p1.y) < EPS) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx < EPS || ry < EPS) return [{ kind: 'line', a: p0, b: p1 }];
    const phi = phiDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
    const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
    const lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cx1 = coef * rx * y1 / ry, cy1 = -coef * ry * x1 / rx;
    const cx = cp * cx1 - sp * cy1 + (p0.x + p1.x) / 2, cy = sp * cx1 + cp * cy1 + (p0.y + p1.y) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.ceil(Math.abs(dt) / (Math.PI / 2));
    const step = dt / n, k = 4 / 3 * Math.tan(step / 4);
    const pt = t => ({ x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp });
    const der = t => ({ x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp });
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = t1 + i * step, b = a + step;
        const pa = i === 0 ? p0 : pt(a), pb = i === n - 1 ? p1 : pt(b);
        out.push({ kind: 'cubic', p: [pa, add(pa, mul(der(a), k)), sub(pb, mul(der(b), k)), pb] });
    }
    return out;
}

export function parsePathSegments(d) {
    const tokens = String(d || '').match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
    const subpaths = [];
    let i = 0, cmd = null, cur = { x: 0, y: 0 }, start = cur, lastCtrl = null, lastCmd = '', sp = null;
    const num = () => Number(tokens[i++]);
    const isNum = () => i < tokens.length && !/^[a-z]$/i.test(tokens[i]);
    const flag = () => {
        // flags de arco podem vir colados ("11" ou "1 0"); consome um dígito
        const t = tokens[i];
        if (t.length > 1 && /^[01]/.test(t)) { tokens[i] = t.slice(1); return Number(t[0]); }
        i++; return Number(t);
    };
    const push = seg => { if (!sp) { sp = { segs: [], closed: false }; subpaths.push(sp); } sp.segs.push(seg); };
    while (i < tokens.length) {
        if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
        else if (!cmd) { i++; continue; }
        const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
        const P = (x, y) => rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
        if (C === 'Z') {
            if (sp) {
                if (len(sub(cur, start)) > 1e-7) push({ kind: 'line', a: cur, b: start });
                sp.closed = true;
            }
            cur = start; sp = null; lastCtrl = null; lastCmd = 'Z';
            continue;
        }
        if (!isNum()) continue;
        if (C === 'M') {
            cur = P(num(), num()); start = cur; sp = null;
            cmd = rel ? 'l' : 'L'; lastCtrl = null; lastCmd = 'M';
            continue;
        }
        let next;
        if (C === 'L') { next = P(num(), num()); push({ kind: 'line', a: cur, b: next }); lastCtrl = null; }
        else if (C === 'H') { const x = num(); next = { x: rel ? cur.x + x : x, y: cur.y }; push({ kind: 'line', a: cur, b: next }); lastCtrl = null; }
        else if (C === 'V') { const y = num(); next = { x: cur.x, y: rel ? cur.y + y : y }; push({ kind: 'line', a: cur, b: next }); lastCtrl = null; }
        else if (C === 'C' || C === 'S') {
            const c1 = C === 'C' ? P(num(), num()) : (['C', 'S'].includes(lastCmd) && lastCtrl ? sub(mul(cur, 2), lastCtrl) : cur);
            const c2 = P(num(), num()); next = P(num(), num());
            push({ kind: 'cubic', p: [cur, c1, c2, next] }); lastCtrl = c2;
        } else if (C === 'Q' || C === 'T') {
            const q = C === 'Q' ? P(num(), num()) : (['Q', 'T'].includes(lastCmd) && lastCtrl ? sub(mul(cur, 2), lastCtrl) : cur);
            next = P(num(), num());
            push({ kind: 'cubic', p: [cur, add(cur, mul(sub(q, cur), 2 / 3)), add(next, mul(sub(q, next), 2 / 3)), next] }); lastCtrl = q;
        } else if (C === 'A') {
            const rx = num(), ry = num(), rot = num(), large = flag(), sw = flag();
            next = P(num(), num());
            for (const s of arcToCubics(cur, rx, ry, rot, large, sw, next)) push(s);
            lastCtrl = null;
        } else { i++; continue; }
        lastCmd = C; cur = next;
    }
    return subpaths.filter(s => s.segs.length);
}

function shapeSegments(node) {
    const a = node.attrs, n = k => parseFloat(a[k]) || 0;
    switch (node.tag) {
        case 'path': return parsePathSegments(a.d);
        case 'rect': {
            const x = n('x'), y = n('y'), w = n('width'), h = n('height');
            if (w <= 0 || h <= 0) return [];
            let rx = a.rx !== undefined ? n('rx') : n('ry'), ry = a.ry !== undefined ? n('ry') : rx;
            rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
            if (rx <= 0 || ry <= 0) return parsePathSegments(`M${x},${y}H${x + w}V${y + h}H${x}Z`);
            return parsePathSegments(`M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`);
        }
        case 'circle': case 'ellipse': {
            const cx = n('cx'), cy = n('cy'), rx = node.tag === 'circle' ? n('r') : n('rx'), ry = node.tag === 'circle' ? n('r') : n('ry');
            if (rx <= 0 || ry <= 0) return [];
            return parsePathSegments(`M${cx + rx},${cy}A${rx},${ry} 0 0 1 ${cx - rx},${cy}A${rx},${ry} 0 0 1 ${cx + rx},${cy}Z`);
        }
        case 'line': return parsePathSegments(`M${n('x1')},${n('y1')}L${n('x2')},${n('y2')}`);
        case 'polyline': case 'polygon': {
            const pts = (a.points || '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
            if (pts.length < 4) return [];
            return parsePathSegments(`M${pts.slice(0, 2).join(',')}L${pts.slice(2).join(' ')}${node.tag === 'polygon' ? 'Z' : ''}`);
        }
        default: return [];
    }
}

// ---------- Bézier → biarcos ----------
const bez = (p, t) => { const m = 1 - t; return { x: m * m * m * p[0].x + 3 * m * m * t * p[1].x + 3 * m * t * t * p[2].x + t * t * t * p[3].x, y: m * m * m * p[0].y + 3 * m * m * t * p[1].y + 3 * m * t * t * p[2].y + t * t * t * p[3].y }; };
function splitBez(p, t) {
    const l = (a, b) => add(a, mul(sub(b, a), t));
    const a = l(p[0], p[1]), b = l(p[1], p[2]), c = l(p[2], p[3]), d = l(a, b), e = l(b, c), f = l(d, e);
    return [[p[0], a, d, f], [f, e, c, p[3]]];
}
function tangents(p) {
    const t0 = norm(sub(p[1], p[0])) || norm(sub(p[2], p[0])) || norm(sub(p[3], p[0]));
    const t1 = norm(sub(p[3], p[2])) || norm(sub(p[3], p[1])) || norm(sub(p[3], p[0]));
    return [t0, t1];
}
// Arco que parte de a com tangente t e termina em b. null = reta.
function arcFrom(a, t, b) {
    const chord = sub(b, a), nrm = { x: -t.y, y: t.x };
    const h = dot(chord, nrm);
    if (Math.abs(h) < 1e-9 * Math.max(1, dot(chord, chord))) return null;
    const r = dot(chord, chord) / (2 * h);
    return { a, b, center: add(a, mul(nrm, r)), radius: Math.abs(r), ccw: r > 0 };
}
const TAU = 2 * Math.PI;
const angOf = (c, q) => Math.atan2(q.y - c.y, q.x - c.x);
function arcSweep(arc) {
    let s = angOf(arc.center, arc.b) - angOf(arc.center, arc.a);
    if (arc.ccw) { while (s < 0) s += TAU; } else { while (s > 0) s -= TAU; }
    return s;
}
function arcSegDist(arc, q) {
    const sw = arcSweep(arc);
    let d = angOf(arc.center, q) - angOf(arc.center, arc.a);
    if (sw >= 0) { while (d < 0) d += TAU; while (d >= TAU) d -= TAU; if (d <= sw) return Math.abs(len(sub(q, arc.center)) - arc.radius); }
    else { while (d > 0) d -= TAU; while (d <= -TAU) d += TAU; if (d >= sw) return Math.abs(len(sub(q, arc.center)) - arc.radius); }
    return Math.min(len(sub(q, arc.a)), len(sub(q, arc.b)));
}
function polylineDist(pts, q) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], d = sub(pts[i], a), l2 = dot(d, d);
        const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(q, a), d) / l2));
        best = Math.min(best, len(sub(q, add(a, mul(d, t)))));
    }
    return best;
}
function arcPoints(arc, n) {
    const a0 = angOf(arc.center, arc.a), sw = arcSweep(arc);
    return Array.from({ length: n - 1 }, (_, i) => { const t = a0 + sw * (i + 1) / n; return { x: arc.center.x + arc.radius * Math.cos(t), y: arc.center.y + arc.radius * Math.sin(t) }; });
}
function lineDeviation(a, b, pts) {
    const d = sub(b, a), l = len(d);
    let max = 0;
    for (const q of pts) max = Math.max(max, l < EPS ? len(sub(q, a)) : Math.abs(cross(d, sub(q, a))) / l);
    return max;
}
// Pontos de inflexão (troca de curvatura) quebram o biarco: dividir antes.
function inflections(p) {
    const a = sub(p[1], p[0]), b = sub(sub(p[2], p[1]), a), c = sub(add(sub(p[3], mul(p[2], 3)), mul(p[1], 3)), p[0]);
    // B'(t) ∝ a + 2bt + ct²; cross(B', B'') = 0 → quadrática em t
    const A = cross(b, c), B = cross(a, c), Cc = cross(a, b);
    const roots = [];
    if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) roots.push(-Cc / B); }
    else { const disc = B * B - 4 * A * Cc; if (disc >= 0) { const s = Math.sqrt(disc); roots.push((-B + s) / (2 * A), (-B - s) / (2 * A)); } }
    return roots.filter(t => t > 1e-4 && t < 1 - 1e-4).sort((x, y) => x - y);
}

function fitCubic(p, tol, out, depth = 0) {
    const samples = Array.from({ length: 15 }, (_, i) => bez(p, (i + 1) / 16));
    if (lineDeviation(p[0], p[3], samples) <= tol && dot(sub(p[1], p[0]), sub(p[3], p[0])) >= 0 && dot(sub(p[3], p[2]), sub(p[3], p[0])) >= 0) {
        if (len(sub(p[3], p[0])) > EPS) out.push({ kind: 'line', a: p[0], b: p[3] });
        return;
    }
    const [t1, t2] = tangents(p);
    // Arco único: o Corel grava círculos como 4 Béziers; um arco por quarto preserva o raio.
    if (t1 && t2) {
        const one = arcFrom(p[0], t1, p[3]);
        if (one) {
            const endTan = norm(one.ccw ? { x: -(p[3].y - one.center.y), y: p[3].x - one.center.x } : { x: p[3].y - one.center.y, y: -(p[3].x - one.center.x) });
            let err = 0;
            for (const q of samples) err = Math.max(err, arcSegDist(one, q));
            if (endTan && dot(endTan, t2) > Math.cos(0.5 * Math.PI / 180) && err <= tol) { out.push({ kind: 'arc', ...one }); return; }
        }
    }
    if (depth < 12 && t1 && t2) {
        const v = sub(p[3], p[0]), t = add(t1, t2), vt = dot(v, t), den = 2 * (1 - dot(t1, t2));
        let d = null;
        if (Math.abs(den) < 1e-9) { const vt2 = dot(v, t2); if (Math.abs(vt2) > 1e-9) d = dot(v, v) / (4 * vt2); }
        else d = (-vt + Math.sqrt(vt * vt + den * dot(v, v))) / den;
        if (d !== null && d > 0) {
            const pm = mul(add(add(p[0], p[3]), mul(sub(t1, t2), d)), 0.5);
            const tm = norm(sub(sub(p[3], mul(t2, d)), add(p[0], mul(t1, d))));
            const a1 = arcFrom(p[0], t1, pm), a2 = tm ? arcFrom(pm, tm, p[3]) : null;
            if (a1 && a2) {
                let err = 0;
                for (const q of samples) err = Math.max(err, Math.min(arcSegDist(a1, q), arcSegDist(a2, q)));
                // e o caminho inverso: o biarco não pode se afastar da curva
                const curve = Array.from({ length: 129 }, (_, i) => bez(p, i / 128));
                for (const arc of [a1, a2]) for (const q of arcPoints(arc, 6)) err = Math.max(err, polylineDist(curve, q));
                if (err <= tol) {
                    out.push({ kind: 'arc', ...a1 }, { kind: 'arc', ...a2 });
                    return;
                }
            }
        }
    }
    if (depth >= 12) {
        if (len(sub(p[3], p[0])) > EPS) out.push({ kind: 'line', a: p[0], b: p[3] });
        return;
    }
    const [l, r] = splitBez(p, 0.5);
    fitCubic(l, tol, out, depth + 1);
    fitCubic(r, tol, out, depth + 1);
}

export function cubicToArcs(p, tol = 0.02) {
    const out = [];
    let rest = p, last = 0;
    for (const t of inflections(p)) {
        const [l, r] = splitBez(rest, (t - last) / (1 - last));
        fitCubic(l, tol, out);
        rest = r; last = t;
    }
    fitCubic(rest, tol, out);
    return out;
}

// ---------- polilinha miúda → retas e arcos ----------
// Facas e desenhos vetorizados chegam como milhares de retas de décimos de mm;
// o corte precisa de poucas entidades longas dentro da mesma tolerância.
function fitsLine(pts, i, j, tol) {
    const a = pts[i], d = sub(pts[j], a), l = len(d);
    if (l < EPS) return false;
    for (let k = i + 1; k < j; k++) {
        const v = sub(pts[k], a);
        if (Math.abs(cross(d, v)) / l > tol) return false;
        const t = dot(v, d) / (l * l);
        if (t < -1e-6 || t > 1 + 1e-6) return false;
    }
    return true;
}
function circleThrough(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-12) return null;
    const a2 = dot(a, a), b2 = dot(b, b), c2 = dot(c, c);
    const center = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
    return { center, radius: len(sub(a, center)) };
}
function fitsArc(pts, i, j, tol) {
    if (j - i < 3) return null;
    const m = (i + j) >> 1, circ = circleThrough(pts[i], pts[m], pts[j]);
    if (!circ || circ.radius > 1e5) return null;
    const ccw = cross(sub(pts[m], pts[i]), sub(pts[j], pts[m])) > 0;
    let total = 0;
    for (let k = i + 1; k <= j; k++) {
        if (Math.abs(len(sub(pts[k], circ.center)) - circ.radius) > tol) return null;
        const step = cross(sub(pts[k - 1], circ.center), sub(pts[k], circ.center));
        if ((step > 0) !== ccw && Math.abs(step) > 1e-9) return null;
        total += Math.abs(Math.atan2(step, dot(sub(pts[k - 1], circ.center), sub(pts[k], circ.center))));
    }
    // meio da corda de cada trecho também precisa ficar no arco
    for (let k = i + 1; k <= j; k++) if (Math.abs(len(sub(mul(add(pts[k - 1], pts[k]), 0.5), circ.center)) - circ.radius) > tol) return null;
    if (total >= 2 * Math.PI - 1e-6) return null;
    return { kind: 'arc', a: pts[i], b: pts[j], center: circ.center, radius: circ.radius, ccw };
}
function longest(test, i, n) {
    // dobra o alcance enquanto couber e refina por busca binária
    let good = i + 1, step = 1;
    while (good + step <= n - 1 && test(good + step)) { good += step; step *= 2; }
    let lo = good, hi = Math.min(n - 1, good + step);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (test(mid)) lo = mid; else hi = mid; }
    return lo;
}
export function fitPolyline(pts, tol) {
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
        const jl = longest(j => fitsLine(pts, i, j, tol), i, pts.length);
        let arc = null, ja = i;
        if (pts.length - i > 3) {
            ja = longest(j => j - i < 3 || !!fitsArc(pts, i, j, tol), i, pts.length);
            if (ja - i >= 3) arc = fitsArc(pts, i, ja, tol);
        }
        if (arc && ja > jl) { out.push(arc); i = ja; }
        else { out.push({ kind: 'line', a: pts[i], b: pts[jl] }); i = jl; }
    }
    return out;
}
export function simplifyChain(segs, tol) {
    const out = [];
    let run = [];
    const flush = () => {
        if (run.length > 2) out.push(...fitPolyline([run[0].a, ...run.map(r => r.b)], tol));
        else out.push(...run);
        run = [];
    };
    for (const s of segs) {
        if (s.kind === 'line' && (!run.length || len(sub(run.at(-1).b, s.a)) < 1e-9)) run.push(s);
        else { flush(); if (s.kind === 'line') run.push(s); else out.push(s); }
    }
    flush();
    return out;
}

// ---------- SVG → DXF ----------
const decodeLayer = id => String(id).replace(/^_(?=\d)/, '').replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/[\r\n]/g, ' ').trim() || '0';
const f = n => (Math.abs(n) < 1e-12 ? 0 : n).toFixed(6);

// DXF mínimo (mm) com LINE/ARC, compartilhado pelos leitores vetoriais (SVG, EPS).
export function createDxfWriter() {
    const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
    let count = 0;
    const emit = (layer, seg) => {
        count++;
        if (seg.kind === 'line') out.push('0', 'LINE', '8', layer, '10', f(seg.a.x), '20', f(seg.a.y), '11', f(seg.b.x), '21', f(seg.b.y));
        else {
            const ang = q => Math.atan2(q.y - seg.center.y, q.x - seg.center.x) * 180 / Math.PI;
            const [s, e] = seg.ccw ? [ang(seg.a), ang(seg.b)] : [ang(seg.b), ang(seg.a)];
            out.push('0', 'ARC', '8', layer, '10', f(seg.center.x), '20', f(seg.center.y), '40', f(seg.radius), '50', f(s), '51', f(e));
        }
    };
    return { emit, count: () => count, text: () => [...out, '0', 'ENDSEC', '0', 'EOF'].join('\n') };
}

export function svgToDxfText(svgText, { toleranceMm = 0.02 } = {}) {
    if (typeof svgText !== 'string' || !/<svg[\s>]/i.test(svgText)) throw new Error('Arquivo SVG inválido.');
    const root = parseSvgDom(svgText);
    const svg = (function find(node) { if (node.tag === 'svg') return node; for (const c of node.children) { const r = find(c); if (r) return r; } return null; })(root);
    if (!svg) throw new Error('Arquivo SVG sem elemento <svg>.');
    const vb = (svg.attrs.viewbox || '').split(/[\s,]+/).map(Number);
    const wMm = parseLengthMm(svg.attrs.width), hMm = parseLengthMm(svg.attrs.height);
    const hasUnits = /(mm|cm|in|pt|pc|px)\s*$/i.test(svg.attrs.width || '');
    let base;
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        const sx = hasUnits && wMm > 0 ? wMm / vb[2] : 25.4 / 96;
        const sy = hasUnits && hMm > 0 ? hMm / vb[3] : sx;
        base = [sx, 0, 0, -sy, -vb[0] * sx, (vb[1] + vb[3]) * sy];
    } else {
        const s = 25.4 / 96, h = hMm > 0 ? hMm / s : 0;
        base = [s, 0, 0, -s, 0, h * s];
    }
    const dxf = createDxfWriter(), emit = dxf.emit;
    (function walk(node, m, layer, depth) {
        for (const c of node.children) {
            if (SKIP.has(c.tag)) continue;
            if (/display\s*:\s*none/i.test(c.attrs.style || '') || c.attrs.display === 'none') continue;
            const mm = compose(m, parseTransform(c.attrs.transform));
            const lay = c.tag === 'g' && depth === 0 && c.attrs.id ? decodeLayer(c.attrs.id) : layer;
            if (c.tag === 'g' || c.tag === 'a' || c.tag === 'switch') { walk(c, mm, lay, depth + 1); continue; }
            for (const sp of shapeSegments(c)) {
                const fitted = [];
                for (const seg of sp.segs) {
                    if (seg.kind === 'line') fitted.push({ kind: 'line', a: apply(mm, seg.a), b: apply(mm, seg.b) });
                    else fitted.push(...cubicToArcs(seg.p.map(q => apply(mm, q)), toleranceMm));
                }
                for (const s of simplifyChain(fitted, toleranceMm)) emit(lay, s);
            }
        }
    })(svg, base, '0', 0);
    if (!dxf.count()) throw new Error('SVG sem contornos (path, rect, circle, ellipse, polygon, polyline ou line).');
    return dxf.text();
}
