// Tracejado recortado à área visível, em coordenadas de tela.
//
// O canvas calcula os traços do subcaminho inteiro, inclusive o que está fora da
// tela. Com zoom alto, uma linha de poucos milímetros vira milhões de traços e um
// quadro chega a levar 1 s. Aqui só o trecho visível vai para o canvas, e o desenho
// continua igual: o canvas recomeça o padrão a cada subcaminho, então linhas e arcos
// partem de um múltiplo do período, fora da tela; onde há vários trechos encadeados
// (spline, elipse), a fase vai em lineDashOffset.

const TAU = Math.PI * 2;
const BASE_MARGIN = 16;
// Acima disso, ctx.arc perde precisão de ponto flutuante no raster: usa cordas.
const NATIVE_ARC_MAX_RADIUS = 65536;
const CHORD_TOLERANCE = 0.1;
const MAX_CHORDS = 2048;
const LENGTH_PANELS = 256;

// O canvas duplica padrões de tamanho ímpar.
export function dashPeriod(dash) {
    if (!dash?.length) return 0;
    const sum = dash.reduce((total, value) => total + value, 0);
    return dash.length % 2 ? sum * 2 : sum;
}

export function dashClipFor(dash, viewport, lineWidth = 1) {
    const period = dashPeriod(dash);
    if (!(period > 0) || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null;
    const margin = Math.max(BASE_MARGIN, lineWidth);
    return {
        period,
        minX: -margin,
        minY: -margin,
        maxX: viewport.width + margin,
        maxY: viewport.height + margin,
    };
}

function clipSegment(ax, ay, bx, by, clip) {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const edges = [
        [-dx, ax - clip.minX],
        [dx, clip.maxX - ax],
        [-dy, ay - clip.minY],
        [dy, clip.maxY - ay],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null;
        } else {
            const t = q / p;
            if (p < 0) {
                if (t > t1) return null;
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return null;
                if (t < t1) t1 = t;
            }
        }
    }
    return [t0, t1];
}

export function pathDashedSegment(ctx, ax, ay, bx, by, clip) {
    const range = clipSegment(ax, ay, bx, by, clip);
    if (!range) return;
    const length = Math.hypot(bx - ax, by - ay);
    const [t0, t1] = range;
    const start = length > 0 ? (Math.floor((t0 * length) / clip.period) * clip.period) / length : 0;
    ctx.moveTo(ax + (bx - ax) * start, ay + (by - ay) * start);
    ctx.lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
}

// Curva cônica: ponto(phi) = centro + eixoX * cos(phi) + eixoY * sin(phi), com
// phi = phi0 + dir * u e u de 0 a sweep. Devolve os intervalos de u dentro do recorte.
function conicPoint(c, u) {
    const phi = c.phi0 + c.dir * u;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    return { x: c.cx + c.x1 * cos + c.x2 * sin, y: c.cy + c.y1 * cos + c.y2 * sin };
}

function visibleRanges(c, clip) {
    const cuts = [0, c.sweep];
    const addCuts = (a, b, center, edge) => {
        const amplitude = Math.hypot(a, b);
        const d = edge - center;
        if (amplitude === 0 || Math.abs(d) > amplitude) return;
        const delta = Math.atan2(b, a);
        const offset = Math.atan2(Math.sqrt(Math.max(0, amplitude * amplitude - d * d)), d);
        for (const phi of [delta + offset, delta - offset]) {
            const u = (((phi - c.phi0) * c.dir) % TAU + TAU) % TAU;
            if (u > 0 && u < c.sweep) cuts.push(u);
        }
    };
    addCuts(c.x1, c.x2, c.cx, clip.minX);
    addCuts(c.x1, c.x2, c.cx, clip.maxX);
    addCuts(c.y1, c.y2, c.cy, clip.minY);
    addCuts(c.y1, c.y2, c.cy, clip.maxY);
    cuts.sort((a, b) => a - b);
    const ranges = [];
    for (let i = 0; i + 1 < cuts.length; i += 1) {
        const from = cuts[i];
        const to = cuts[i + 1];
        if (to <= from) continue;
        const mid = conicPoint(c, (from + to) / 2);
        if (mid.x < clip.minX || mid.x > clip.maxX || mid.y < clip.minY || mid.y > clip.maxY) continue;
        const last = ranges[ranges.length - 1];
        if (last && last[1] === from) last[1] = to;
        else ranges.push([from, to]);
    }
    return ranges;
}

function conicInside(c, clip) {
    const halfX = Math.hypot(c.x1, c.x2);
    const halfY = Math.hypot(c.y1, c.y2);
    return c.cx - halfX >= clip.minX && c.cx + halfX <= clip.maxX && c.cy - halfY >= clip.minY && c.cy + halfY <= clip.maxY;
}

// Arco de raio em pixels; o sentido segue o sinal de dir, como em ctx.arc.
export function pathDashedArc(ctx, cx, cy, radius, phi0, dir, sweep, clip) {
    const conic = { cx, cy, x1: radius, x2: 0, y1: 0, y2: radius, phi0, dir, sweep };
    const ranges = conicInside(conic, clip) ? [[0, sweep]] : visibleRanges(conic, clip);
    for (const [from, to] of ranges) {
        const start = radius > 0 ? (Math.floor((from * radius) / clip.period) * clip.period) / radius : 0;
        const p = conicPoint(conic, start);
        ctx.moveTo(p.x, p.y);
        if (radius <= NATIVE_ARC_MAX_RADIUS) {
            ctx.arc(cx, cy, radius, phi0 + dir * start, phi0 + dir * to, dir < 0);
            continue;
        }
        const step = Math.max(Math.sqrt((8 * CHORD_TOLERANCE) / radius), (to - start) / MAX_CHORDS);
        const count = Math.ceil((to - start) / step);
        for (let i = 1; i <= count; i += 1) {
            const q = conicPoint(conic, start + ((to - start) * i) / count);
            ctx.lineTo(q.x, q.y);
        }
    }
}

// Elipse com o mesmo significado de ctx.ellipse. Traça e já aplica stroke, porque cada
// trecho visível tem a sua fase.
export function strokeDashedEllipse(ctx, cx, cy, major, minor, rotation, phi0, dir, sweep, clip) {
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const conic = { cx, cy, x1: major * cosR, x2: -minor * sinR, y1: major * sinR, y2: minor * cosR, phi0, dir, sweep };
    const speed = (u) => {
        const phi = phi0 + dir * u;
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);
        return Math.hypot(-conic.x1 * sin + conic.x2 * cos, -conic.y1 * sin + conic.y2 * cos);
    };
    // Simpson acumulado: o comprimento até o início do trecho define a fase.
    const lengthUpTo = (u) => {
        const h = u / LENGTH_PANELS;
        let sum = speed(0) + speed(u);
        for (let i = 1; i < LENGTH_PANELS; i += 1) sum += speed(i * h) * (i % 2 ? 4 : 2);
        return (sum * h) / 3;
    };
    const ranges = conicInside(conic, clip) ? [[0, sweep]] : visibleRanges(conic, clip);
    const step = Math.sqrt((8 * CHORD_TOLERANCE) / Math.max(major, minor, 1));
    for (const [from, to] of ranges) {
        const count = Math.max(1, Math.min(MAX_CHORDS, Math.ceil((to - from) / step)));
        ctx.beginPath();
        ctx.lineDashOffset = from > 0 ? lengthUpTo(from) % clip.period : 0;
        const first = conicPoint(conic, from);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i <= count; i += 1) {
            const q = conicPoint(conic, from + ((to - from) * i) / count);
            ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
    }
    ctx.lineDashOffset = 0;
}

// Polilinha contínua (a fase corre de um vértice ao outro), como o traçado de uma spline.
export function strokeDashedPolyline(ctx, points, clip) {
    let traveled = 0;
    let open = false;
    const finish = () => {
        if (open) ctx.stroke();
        open = false;
    };
    for (let i = 0; i + 1 < points.length; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const range = clipSegment(a.x, a.y, b.x, b.y, clip);
        if (!range) {
            finish();
        } else {
            const [t0, t1] = range;
            if (!open || t0 > 0) {
                finish();
                ctx.beginPath();
                ctx.lineDashOffset = (traveled + t0 * length) % clip.period;
                ctx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
                open = true;
            }
            ctx.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
            if (t1 < 1) finish();
        }
        traveled += length;
    }
    finish();
    ctx.lineDashOffset = 0;
}
