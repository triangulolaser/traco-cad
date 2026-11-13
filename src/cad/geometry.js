// Kernel geométrico 2D do Traço.
// Tudo em coordenadas de mundo (unidades de desenho, eixo Y para cima).
// Funções puras, sem dependência de DOM, para permitir teste em Node.

import { fontEm, LINE_SPACING, measuredLineWidth } from './fonts.js';
import {
    twoDiff,
    twoProduct,
    compensatedCross,
    compensatedDot,
    solveQuadraticStable,
    bulgeToArcRational,
    evalBulgeArcRational,
    closestPointOnBulgeArcRational,
    intersectLineBulgeArcRational,
    sweepToBulgeRational,
} from './predicates.js';
import {
    evalBezierPoint,
    closestPointOnBezier,
    bezierPerpendicularFeet,
    bezierTangentPoints,
    bezierQuadrants,
    bezierBoxExact,
    bezierLength,
    splitSplineExact,
} from './nurbs-exact.js';
import {
    evalEllipsePoint,
    isFullEllipseCurve,
    ellipseParamInRange,
    closestPointOnEllipse,
    ellipsePerpendicularFeet,
    ellipseTangentPoints,
    ellipseQuadrants,
    ellipseBoxExact,
    ellipseLength,
    intersectLineEllipse,
    intersectConics,
    intersectLineBezier,
    intersectBezierConic,
    intersectBezierBezier,
} from './curve-intersect.js';
import {
    offsetEntityPlanar,
    offsetEntityMultiple,
    offsetPolylinePlanar,
} from './offset-planar.js';

export const EPS = 1e-9;
export const TWO_PI = Math.PI * 2;

export const vec = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const length = (a) => Math.hypot(a.x, a.y);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const angleOf = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const polar = (origin, angle, dist) => ({ x: origin.x + Math.cos(angle) * dist, y: origin.y + Math.sin(angle) * dist });
export const normalize = (a) => { const l = length(a); return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; };
export const perpendicular = (a) => ({ x: -a.y, y: a.x });
export const nearlyEqual = (a, b, tol = 1e-7) => Math.abs(a - b) <= tol;
export const samePoint = (a, b, tol = 1e-7) => nearlyEqual(a.x, b.x, tol) && nearlyEqual(a.y, b.y, tol);

export const degToRad = (d) => (d * Math.PI) / 180;
export const radToDeg = (r) => (r * 180) / Math.PI;

export function normalizeAngle(a) {
    let r = a % TWO_PI;
    if (r < 0) r += TWO_PI;
    return r;
}

// Ângulo varrido de start até end no sentido anti-horário (0..2π).
export function sweepCCW(start, end) {
    let s = normalizeAngle(end - start);
    if (s < EPS) s = 0;
    return s;
}

export function angleInArc(angle, start, end) {
    const sweep = sweepCCW(start, end);
    const rel = normalizeAngle(angle - start);
    return rel <= sweep + 1e-9;
}

export function rotatePoint(p, center, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

export function mirrorPoint(p, a, b) {
    const d = normalize(sub(b, a));
    if (length(d) < EPS) return { ...p };
    const v = sub(p, a);
    const proj = dot(v, d);
    const foot = add(a, scale(d, proj));
    return sub(scale(foot, 2), p);
}

export function scalePoint(p, base, factor) {
    return { x: base.x + (p.x - base.x) * factor, y: base.y + (p.y - base.y) * factor };
}

// Projeção de p sobre a reta ab (sem limitar ao segmento).
export function projectOnLine(p, a, b) {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    if (l2 < EPS) return { point: { ...a }, t: 0 };
    const t = dot(sub(p, a), ab) / l2;
    return { point: add(a, scale(ab, t)), t };
}

export function closestPointOnSegment(p, a, b) {
    const { point, t } = projectOnLine(p, a, b);
    if (t <= 0) return { point: { ...a }, t: 0 };
    if (t >= 1) return { point: { ...b }, t: 1 };
    return { point, t };
}

export function closestPointOnCircle(p, center, radius) {
    const d = sub(p, center);
    if (length(d) < EPS) return { x: center.x + radius, y: center.y };
    return add(center, scale(normalize(d), radius));
}

export function closestPointOnArc(p, center, radius, start, end) {
    const candidate = closestPointOnCircle(p, center, radius);
    const angle = angleOf(center, candidate);
    if (angleInArc(angle, start, end)) return candidate;
    const s = polar(center, start, radius);
    const e = polar(center, end, radius);
    return distance(p, s) <= distance(p, e) ? s : e;
}

export function distancePointSegment(p, a, b) {
    return distance(p, closestPointOnSegment(p, a, b).point);
}

// Interseção de duas retas infinitas. Retorna null se paralelas.
export function intersectLines(a1, a2, b1, b2) {
    const [rxHi, rxLo] = twoDiff(a2.x, a1.x);
    const [ryHi, ryLo] = twoDiff(a2.y, a1.y);
    const [sxHi, sxLo] = twoDiff(b2.x, b1.x);
    const [syHi, syLo] = twoDiff(b2.y, b1.y);
    const rx = rxHi + rxLo;
    const ry = ryHi + ryLo;
    const sx = sxHi + sxLo;
    const sy = syHi + syLo;
    const denom = compensatedCross(rx, ry, sx, sy);
    if (Math.abs(denom) < EPS) return null;
    const [qpxHi, qpxLo] = twoDiff(b1.x, a1.x);
    const [qpyHi, qpyLo] = twoDiff(b1.y, a1.y);
    const qpx = qpxHi + qpxLo;
    const qpy = qpyHi + qpyLo;
    const t = compensatedCross(qpx, qpy, sx, sy) / denom;
    const u = compensatedCross(qpx, qpy, rx, ry) / denom;
    return { point: { x: a1.x + rx * t, y: a1.y + ry * t }, t, u };
}

// Interseção de dois segmentos (t e u dentro de [0,1] com tolerância).
export function intersectSegments(a1, a2, b1, b2, tol = 1e-9) {
    const hit = intersectLines(a1, a2, b1, b2);
    if (!hit) return null;
    if (hit.t < -tol || hit.t > 1 + tol || hit.u < -tol || hit.u > 1 + tol) return null;
    return hit.point;
}

// Interseção de reta infinita com círculo. Retorna lista de pontos (0, 1 ou 2) com parâmetro t na reta.
export function intersectLineCircle(a, b, center, radius) {
    const [dxHi, dxLo] = twoDiff(b.x, a.x);
    const [dyHi, dyLo] = twoDiff(b.y, a.y);
    const [fxHi, fxLo] = twoDiff(a.x, center.x);
    const [fyHi, fyLo] = twoDiff(a.y, center.y);
    const dx = dxHi + dxLo;
    const dy = dyHi + dyLo;
    const fx = fxHi + fxLo;
    const fy = fyHi + fyLo;

    const A = compensatedDot(dx, dy, dx, dy);
    if (A < EPS) return [];
    const len = Math.sqrt(A);
    const ux = dx / len;
    const uy = dy / len;

    // Projeção ortogonal do centro sobre a reta para eliminar cancelamento em tangências rasantes e UTM 10^7:
    const sProj = -compensatedDot(fx, fy, ux, uy);
    const perpX = fx + sProj * ux;
    const perpY = fy + sProj * uy;
    const dPerp2 = compensatedDot(perpX, perpY, perpX, perpY);
    const [r2, er2] = twoProduct(radius, radius);
    let h2 = (r2 - dPerp2) + er2;

    if (h2 < -1e-7 * (r2 + 1)) return [];
    if (h2 <= 1e-14 * (r2 + 1)) {
        const t = sProj / len;
        return [{ point: { x: center.x + perpX, y: center.y + perpY }, t }];
    }
    const h = Math.sqrt(h2);
    const t1 = (sProj - h) / len;
    const t2 = (sProj + h) / len;
    return [
        { point: { x: center.x + perpX - h * ux, y: center.y + perpY - h * uy }, t: t1 },
        { point: { x: center.x + perpX + h * ux, y: center.y + perpY + h * uy }, t: t2 },
    ];
}

export function intersectCircles(c1, r1, c2, r2) {
    const [dxHi, dxLo] = twoDiff(c2.x, c1.x);
    const [dyHi, dyLo] = twoDiff(c2.y, c1.y);
    const dx = dxHi + dxLo;
    const dy = dyHi + dyLo;
    const d2 = compensatedDot(dx, dy, dx, dy);
    const d = Math.sqrt(d2);
    if (d < EPS) return [];
    if (d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];

    // (r1^2 - r2^2) calculado como (r1 - r2)*(r1 + r2) para evitar perda em raios grandes
    const [diffR2, ediffR2] = twoProduct(r1 - r2, r1 + r2);
    const a = ((diffR2 + d2) + ediffR2) / (2 * d);
    const [r1Sq, er1Sq] = twoProduct(r1, r1);
    const [aSq, eaSq] = twoProduct(a, a);
    let h2 = (r1Sq - aSq) + (er1Sq - eaSq);
    if (h2 < 0) h2 = 0;
    const h = Math.sqrt(h2);
    const ux = dx / d;
    const uy = dy / d;
    const px = c1.x + ux * a;
    const py = c1.y + uy * a;
    if (h <= 1e-12 * Math.max(1, r1, r2)) return [{ x: px, y: py }];
    const nx = -uy;
    const ny = ux;
    return [
        { x: px + nx * h, y: py + ny * h },
        { x: px - nx * h, y: py - ny * h },
    ];
}

// ---------------------------------------------------------------------------
// Curvas primitivas: representação uniforme para hit-test, snaps e trim.
// Uma "curva" é { kind: 'segment', a, b }, { kind: 'arc', center, radius, start, end } (CCW),
// { kind: 'circle', center, radius }, { kind: 'ellipse', center, major, ratio, start, end, full }
// ou { kind: 'bezier', degree, points, weights, t0, t1, closed, isFirst, isLast }.

export function bulgeToArc(a, b, bulge) {
    // Conversão racional invariante à trigonometria de bulge DXF (b = tan(θ/4)) em arco.
    return bulgeToArcRational(a, b, bulge);
}

export function arcToBulge(center, radius, start, end, from, to) {
    // Bulge para o trecho de `from` a `to` percorrido no sentido CCW de start→end.
    const sweep = sweepCCW(start, end);
    const bulge = sweepToBulgeRational(sweep);
    // Se o vértice `from` corresponde ao fim do arco, o sentido no polígono é horário.
    const fromAngle = angleOf(center, from);
    const clockwise = !nearlyEqual(normalizeAngle(fromAngle - start), 0, 1e-6);
    return clockwise ? -bulge : bulge;
}

export function polylineCurves(vertices, closed) {
    const out = [];
    const n = vertices.length;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i += 1) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        const arc = a.bulge ? bulgeToArc(a, b, a.bulge) : null;
        out.push(arc ? { ...arc, index: i } : { kind: 'segment', a, b, index: i });
    }
    return out;
}

// Provedores registrados para tipos de entidade definidos fora deste módulo (ex.: cotas).
const providers = {};
export function registerEntityProvider(type, provider) {
    providers[type] = provider;
}

export function entityProvider(type) {
    return providers[type] ?? null;
}

// Contexto usado pelos provedores (estilo de cota do documento atual).
let entityContext = {};
export function setEntityContext(context) {
    entityContext = context ?? {};
}

export function entityCurves(entity) {
    if (providers[entity.type]) return providers[entity.type].curves(entity, entityContext);
    switch (entity.type) {
        case 'line':
        case 'xline':
        case 'ray':
            return [{ kind: 'segment', a: entity.start, b: entity.end }];
        case 'circle':
            return [{ kind: 'circle', center: entity.center, radius: entity.radius }];
        case 'arc':
            return [{ kind: 'arc', center: entity.center, radius: entity.radius, start: entity.start, end: entity.end }];
        case 'polyline':
        case 'lwpolyline':
            return polylineCurves(entity.vertices, entity.closed);
        case 'text': {
            const box = textBox(entity);
            return [
                { kind: 'segment', a: box[0], b: box[1] },
                { kind: 'segment', a: box[1], b: box[2] },
                { kind: 'segment', a: box[2], b: box[3] },
                { kind: 'segment', a: box[3], b: box[0] },
            ];
        }
        default:
            return [];
    }
}

// Encadeia linhas, arcos e polilinhas soltas em uma única polilinha (com bulge nos arcos).
// Devolve null quando as curvas não formam uma cadeia contínua.
export function joinCurves(entities, tol = 1e-6) {
    // Converte tudo em lista de curvas orientáveis e encadeia.
    const pool = entities.flatMap((e) => (e.type === 'polyline' ? polylineCurves(e.vertices, e.closed) : entityCurves(e))).map((c) => ({ ...c }));
    const endpoints = (c) => (c.kind === 'segment' ? [c.a, c.b] : [polar(c.center, c.start, c.radius), polar(c.center, c.end, c.radius)]);
    const reverse = (c) => (c.kind === 'segment' ? { ...c, a: c.b, b: c.a, reversed: !c.reversed } : { ...c, reversed: !c.reversed });
    const chain = [pool.shift()];
    let guard = 0;
    while (pool.length && guard < 10000) {
        guard += 1;
        const tail = chain[chain.length - 1];
        const tailEnd = tail.reversed && tail.kind !== 'segment' ? endpoints(tail)[0] : endpoints(tail)[1];
        const head = chain[0];
        const headStart = head.reversed && head.kind !== 'segment' ? endpoints(head)[1] : endpoints(head)[0];
        let found = false;
        for (let i = 0; i < pool.length; i += 1) {
            const c = pool[i];
            const [s, e] = endpoints(c);
            if (distance(s, tailEnd) < tol) { chain.push(c); pool.splice(i, 1); found = true; break; }
            if (distance(e, tailEnd) < tol) { chain.push(reverse(c)); pool.splice(i, 1); found = true; break; }
            if (distance(e, headStart) < tol) { chain.unshift(c); pool.splice(i, 1); found = true; break; }
            if (distance(s, headStart) < tol) { chain.unshift(reverse(c)); pool.splice(i, 1); found = true; break; }
        }
        if (!found) return null;
    }
    const vertices = [];
    chain.forEach((c) => {
        if (c.kind === 'segment') vertices.push({ x: c.a.x, y: c.a.y, bulge: 0 });
        else {
            const sweep = sweepCCW(c.start, c.end);
            const bulge = Math.tan(sweep / 4) * (c.reversed ? -1 : 1);
            const startPoint = c.reversed ? polar(c.center, c.end, c.radius) : polar(c.center, c.start, c.radius);
            vertices.push({ x: startPoint.x, y: startPoint.y, bulge });
        }
    });
    const last = chain[chain.length - 1];
    const lastEnd = last.kind === 'segment' ? last.b : (last.reversed ? polar(last.center, last.start, last.radius) : polar(last.center, last.end, last.radius));
    const first = vertices[0];
    const closed = distance(lastEnd, first) < tol;
    if (!closed) vertices.push({ x: lastEnd.x, y: lastEnd.y, bulge: 0 });
    return { type: 'polyline', vertices, closed };
}

// Como o JOIN do AutoCAD/BricsCAD: separa a seleção em cadeias conectadas pelas pontas
// e une cada uma. Devolve [{ entities, result }] só das cadeias com 2+ objetos que fecharam
// a união; o que sobra (solto ou ramificado) fica intacto.
export function joinCurveGroups(entities, tol = 1e-6) {
    const ends = (e) => {
        if (e.type === 'line') return [e.start, e.end];
        if (e.type === 'arc') return [polar(e.center, e.start, e.radius), polar(e.center, e.end, e.radius)];
        if ((e.type === 'polyline' || e.type === 'lwpolyline') && !e.closed && e.vertices?.length) {
            return [e.vertices[0], e.vertices[e.vertices.length - 1]];
        }
        return [];
    };
    const parent = entities.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const points = entities.map(ends);
    for (let i = 0; i < entities.length; i += 1) {
        for (let j = i + 1; j < entities.length; j += 1) {
            if (points[i].some((p) => points[j].some((q) => distance(p, q) < tol))) parent[find(i)] = find(j);
        }
    }
    const groups = new Map();
    entities.forEach((e, i) => {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(e);
    });
    const out = [];
    groups.forEach((group) => {
        if (group.length < 2) return;
        const result = joinCurves(group, tol);
        if (result) out.push({ entities: group, result });
    });
    return out;
}

export function textBox(entity) {
    const rawLines = String(entity.text ?? '').split('\n');
    let lines = rawLines;
    const approxCharW = fontEm(entity.height) * (entity.boxWidth > 0 ? 0.52 : 0.6);
    if (entity.boxWidth && entity.boxWidth > 0) {
        lines = [];
        for (const rawLine of rawLines) {
            const words = rawLine.split(' ');
            let currentLine = '';
            for (let i = 0; i < words.length; i++) {
                const word = words[i];
                if (!currentLine) {
                    currentLine = word;
                } else {
                    const testLine = currentLine + ' ' + word;
                    if ((measuredLineWidth(entity, testLine) ?? testLine.length * approxCharW) <= entity.boxWidth) {
                        currentLine = testLine;
                    } else {
                        lines.push(currentLine);
                        currentLine = word;
                    }
                }
            }
            // Linha vazia (\P\P do MTEXT) também ocupa altura; sem isso o texto encolhe e invade o que está abaixo.
            if (currentLine || !rawLine.trim()) lines.push(currentLine);
        }
    }
    const maxLen = Math.max(...lines.map((l) => l.length), 1);
    // Mesma largura que o renderer desenha; a estimativa por caractere fica para quando não há canvas.
    const measured = lines.map((l) => measuredLineWidth(entity, l));
    const width = measured.every((w) => w !== null)
        ? Math.max(...measured)
        : entity.boxWidth && entity.boxWidth > 0
            ? Math.min(entity.boxWidth, Math.max(maxLen * approxCharW, entity.boxWidth * 0.6))
            : maxLen * fontEm(entity.height) * 0.556;
    const lineSpacing = entity.height * LINE_SPACING;
    const height = entity.height + (lines.length - 1) * lineSpacing;
    const halign = entity.halign ?? 'left';
    const valign = entity.valign ?? (entity.attachmentPoint ? 'top' : 'baseline');

    let anchorX = 0;
    if (entity.boxWidth && entity.boxWidth > 0) {
        const w = entity.boxWidth;
        const attach = entity.attachmentPoint || 1;
        const attachCol = (attach - 1) % 3; // 0: left, 1: center, 2: right
        const boxLeft = attachCol === 0 ? 0 : (attachCol === 1 ? -w / 2 : -w);
        if (halign === 'center') anchorX = boxLeft + w / 2;
        else if (halign === 'right') anchorX = boxLeft + w;
        else anchorX = boxLeft;
    }

    let ox = anchorX;
    if (halign === 'center') ox = anchorX - width / 2;
    else if (halign === 'right') ox = anchorX - width;

    let oy = 0;
    // No mundo CAD (Y cresce para CIMA):
    if (valign === 'top') oy = -height;
    else if (valign === 'middle') oy = -height / 2;
    else if (valign === 'bottom') oy = 0;
    else oy = -(lines.length - 1) * lineSpacing; // baseline: a primeira linha assenta na posição e as demais descem

    const rot = degToRad(entity.rotation ?? 0);
    const corners = [
        { x: ox, y: oy },
        { x: ox + width, y: oy },
        { x: ox + width, y: oy + height },
        { x: ox, y: oy + height },
    ];
    const mirror = entity.mirrored ? -1 : 1; // o renderer espelha em torno da posição
    return corners.map((c) => rotatePoint(add(entity.position, { x: c.x * mirror, y: c.y }), entity.position, rot));
}

// Dentro do retângulo orientado do texto: a caixa alinhada aos eixos de um texto girado cobre área vazia.
export function pointInTextBox(p, entity) {
    const box = textBox(entity);
    let sign = 0;
    for (let i = 0; i < box.length; i += 1) {
        const a = box[i];
        const b = box[(i + 1) % box.length];
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (cross === 0) continue;
        if (sign !== 0 && Math.sign(cross) !== sign) return false;
        sign = Math.sign(cross);
    }
    return true;
}

export function closestPointOnCurve(p, curve) {
    if (curve.kind === 'segment') return closestPointOnSegment(p, curve.a, curve.b).point;
    if (curve.kind === 'circle') return closestPointOnCircle(p, curve.center, curve.radius);
    if (curve.kind === 'ellipse') return closestPointOnEllipse(p, curve);
    if (curve.kind === 'bezier') return closestPointOnBezier(p, curve).point;
    if (curve.chordA && curve.chordB && curve.bulge && Math.abs(curve.bulge) < 1e-2) {
        return closestPointOnBulgeArcRational(p, curve);
    }
    return closestPointOnArc(p, curve.center, curve.radius, curve.start, curve.end);
}

export function distanceToCurve(p, curve) {
    return distance(p, closestPointOnCurve(p, curve));
}

export function curveEndpoints(curve) {
    if (curve.kind === 'segment') return [curve.a, curve.b];
    if (curve.kind === 'arc') {
        if (curve.p0 && curve.p1) return [curve.p0, curve.p1];
        return [polar(curve.center, curve.start, curve.radius), polar(curve.center, curve.end, curve.radius)];
    }
    if (curve.kind === 'ellipse') {
        if (isFullEllipseCurve(curve)) return [];
        return [evalEllipsePoint(curve, curve.start ?? 0), evalEllipsePoint(curve, curve.end ?? TWO_PI)];
    }
    if (curve.kind === 'bezier') {
        if (curve.closed) return [];
        const pts = curve.points;
        if (!pts || pts.length === 0) return [];
        const out = [];
        if (curve.isFirst || curve.isFirst === undefined) out.push(pts[0]);
        if (curve.isLast || curve.isLast === undefined) out.push(pts[pts.length - 1]);
        return out;
    }
    return [];
}

export function curveMidpoint(curve) {
    if (curve.kind === 'segment') return midpoint(curve.a, curve.b);
    if (curve.kind === 'arc') {
        if (curve.chordA && curve.chordB && curve.bulge) {
            return evalBulgeArcRational(curve.chordA, curve.chordB, curve.bulge, 0);
        }
        return polar(curve.center, curve.start + sweepCCW(curve.start, curve.end) / 2, curve.radius);
    }
    if (curve.kind === 'ellipse') {
        if (isFullEllipseCurve(curve)) return null;
        const s = curve.start ?? 0;
        const e = curve.end ?? TWO_PI;
        return evalEllipsePoint(curve, s + sweepCCW(s, e) / 2);
    }
    if (curve.kind === 'bezier') {
        if (curve.closed) return null;
        if (curve.isFirst && curve.isLast) return evalBezierPoint(curve, 0.5);
        return null;
    }
    return null;
}

export function curveCenter(curve) {
    if (curve.kind === 'segment' || curve.kind === 'bezier') return null;
    return curve.center;
}

export function curveQuadrants(curve) {
    if (curve.kind === 'segment') return [];
    if (curve.kind === 'ellipse') return ellipseQuadrants(curve);
    if (curve.kind === 'bezier') return bezierQuadrants(curve);
    const out = [];
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        if (curve.kind === 'circle' || angleInArc(angle, curve.start, curve.end)) out.push(polar(curve.center, angle, curve.radius));
    }
    return out;
}

function pointOnCurve(p, curve, tol = 1e-7) {
    if (curve.kind === 'segment') {
        const { t } = projectOnLine(p, curve.a, curve.b);
        return t >= -tol && t <= 1 + tol;
    }
    if (curve.kind === 'circle') return true;
    if (curve.kind === 'ellipse') {
        if (isFullEllipseCurve(curve)) return true;
        return ellipseParamInRange(
            Math.atan2(
                ((p.x - curve.center.x) * -curve.major.y + (p.y - curve.center.y) * curve.major.x) / (curve.ratio || 1),
                (p.x - curve.center.x) * curve.major.x + (p.y - curve.center.y) * curve.major.y,
            ),
            curve,
            tol,
        );
    }
    if (curve.kind === 'bezier') {
        const { u, distSq } = closestPointOnBezier(p, curve);
        const scale = Math.max(1, Math.hypot(p.x, p.y));
        return u >= -tol && u <= 1 + tol && distSq <= (1e-5 * scale) ** 2;
    }
    if (curve.chordA && curve.chordB && curve.bulge && Math.abs(curve.bulge) < 1e-2) {
        const { t } = projectOnLine(p, curve.chordA, curve.chordB);
        return t >= -tol && t <= 1 + tol;
    }
    // Ponto na ponta inicial do arco pode cair um ulp antes de start e virar ~2π: aceitar dos dois lados.
    if (angleInArc(angleOf(curve.center, p), curve.start, curve.end)) return true;
    return normalizeAngle(angleOf(curve.center, p) - curve.start) >= 2 * Math.PI - 1e-9;
}

// Interseções entre duas curvas, limitadas à extensão de cada uma.
export function intersectCurves(c1, c2, { extend1 = false, extend2 = false } = {}) {
    // 1. Bézier × qualquer curva
    if (c1.kind === 'bezier' && c2.kind === 'bezier') {
        return intersectBezierBezier(c1, c2).map((h) => h.point);
    }
    if (c1.kind === 'bezier' && c2.kind === 'segment') {
        return intersectLineBezier(c2.a, c2.b, c1)
            .filter((h) => (extend1 || (h.u >= -1e-7 && h.u <= 1 + 1e-7)) && (extend2 || (h.t >= -1e-7 && h.t <= 1 + 1e-7)))
            .map((h) => h.point);
    }
    if (c1.kind === 'segment' && c2.kind === 'bezier') {
        return intersectLineBezier(c1.a, c1.b, c2)
            .filter((h) => (extend1 || (h.t >= -1e-7 && h.t <= 1 + 1e-7)) && (extend2 || (h.u >= -1e-7 && h.u <= 1 + 1e-7)))
            .map((h) => h.point);
    }
    if (c1.kind === 'bezier') {
        return intersectBezierConic(c1, c2)
            .filter((h) => extend2 || pointOnCurve(h.point, c2))
            .map((h) => h.point);
    }
    if (c2.kind === 'bezier') {
        return intersectBezierConic(c2, c1)
            .filter((h) => extend1 || pointOnCurve(h.point, c1))
            .map((h) => h.point);
    }

    // 2. Elipse × qualquer curva
    if (c1.kind === 'segment' && c2.kind === 'ellipse') {
        return intersectLineEllipse(c1.a, c1.b, c2)
            .filter((h) => (extend1 || (h.t >= -1e-7 && h.t <= 1 + 1e-7)) && (extend2 || ellipseParamInRange(h.theta, c2)))
            .map((h) => h.point);
    }
    if (c1.kind === 'ellipse' && c2.kind === 'segment') {
        return intersectLineEllipse(c2.a, c2.b, c1)
            .filter((h) => (extend1 || ellipseParamInRange(h.theta, c1)) && (extend2 || (h.t >= -1e-7 && h.t <= 1 + 1e-7)))
            .map((h) => h.point);
    }
    if (c1.kind === 'ellipse' || c2.kind === 'ellipse') {
        return intersectConics(c1, c2)
            .filter((h) => (extend1 || pointOnCurve(h.point, c1)) && (extend2 || pointOnCurve(h.point, c2)))
            .map((h) => h.point);
    }

    // 3. Primitivas clássicas (segment, circle, arc)
    let raw = [];
    if (c1.kind === 'segment' && c2.kind === 'segment') {
        const hit = intersectLines(c1.a, c1.b, c2.a, c2.b);
        raw = hit ? [hit.point] : [];
    } else if (c1.kind === 'segment') {
        if (c2.kind === 'arc' && c2.chordA && c2.chordB && c2.bulge && Math.abs(c2.bulge) < 1e-2) {
            return intersectLineBulgeArcRational(c1.a, c1.b, c2, extend2)
                .filter((h) => extend1 || (h.t >= -1e-7 && h.t <= 1 + 1e-7))
                .map((h) => h.point);
        }
        raw = intersectLineCircle(c1.a, c1.b, c2.center, c2.radius).map((h) => h.point);
    } else if (c2.kind === 'segment') {
        if (c1.kind === 'arc' && c1.chordA && c1.chordB && c1.bulge && Math.abs(c1.bulge) < 1e-2) {
            return intersectLineBulgeArcRational(c2.a, c2.b, c1, extend1)
                .filter((h) => extend2 || (h.t >= -1e-7 && h.t <= 1 + 1e-7))
                .map((h) => h.point);
        }
        raw = intersectLineCircle(c2.a, c2.b, c1.center, c1.radius).map((h) => h.point);
    } else {
        raw = intersectCircles(c1.center, c1.radius, c2.center, c2.radius);
    }
    return raw.filter((p) => (extend1 || pointOnCurve(p, c1)) && (extend2 || pointOnCurve(p, c2)));
}

// Todos os pés de perpendicular a partir de p sobre a curva (para OSNAP PER).
export function perpendicularFeet(p, curve) {
    if (curve.kind === 'segment') {
        const { point, t } = projectOnLine(p, curve.a, curve.b);
        return t >= -1e-9 && t <= 1 + 1e-9 ? [point] : [];
    }
    if (curve.kind === 'ellipse') return ellipsePerpendicularFeet(p, curve);
    if (curve.kind === 'bezier') return bezierPerpendicularFeet(p, curve);
    const near = closestPointOnCircle(p, curve.center, curve.radius);
    const far = sub(scale(curve.center, 2), near);
    if (curve.kind === 'circle') return [near, far];
    return [near, far].filter((q) => angleInArc(angleOf(curve.center, q), curve.start, curve.end));
}

// Foot da perpendicular a partir de p sobre a curva (para OSNAP PER).
export function perpendicularFoot(p, curve, cursor = null) {
    const feet = perpendicularFeet(p, curve);
    if (feet.length === 0) return null;
    if (cursor && feet.length > 1) {
        feet.sort((a, b) => distance(a, cursor) - distance(b, cursor));
    }
    return feet[0];
}

// Pontos de tangência de p a um círculo, arco, elipse ou Bézier/spline.
export function tangentPoints(p, curve) {
    if (curve.kind === 'segment') return [];
    if (curve.kind === 'ellipse') return ellipseTangentPoints(p, curve);
    if (curve.kind === 'bezier') return bezierTangentPoints(p, curve);
    const d = distance(p, curve.center);
    if (d <= curve.radius + EPS) return [];
    const base = angleOf(curve.center, p);
    const offset = Math.acos(curve.radius / d);
    const pts = [polar(curve.center, base + offset, curve.radius), polar(curve.center, base - offset, curve.radius)];
    return curve.kind === 'circle' ? pts : pts.filter((q) => angleInArc(angleOf(curve.center, q), curve.start, curve.end));
}

// Retas tangentes comuns a dois círculos/arcos: até 4 pares {a, b} (a sobre c1, b sobre c2).
// Externas (s = 1) e internas (s = -1); em arcos, só os pontos dentro do trecho.
export function commonTangents(c1, c2) {
    if (c1.kind === 'segment' || c2.kind === 'segment') return [];
    const d = distance(c1.center, c2.center);
    if (d < EPS) return [];
    const ux = (c2.center.x - c1.center.x) / d;
    const uy = (c2.center.y - c1.center.y) / d;
    const onArc = (curve, p) => curve.kind === 'circle' || angleInArc(angleOf(curve.center, p), curve.start, curve.end);
    const out = [];
    for (const s of [1, -1]) {
        const k = (c1.radius - s * c2.radius) / d;
        if (Math.abs(k) > 1 + EPS) continue;
        const h = Math.sqrt(Math.max(0, 1 - k * k));
        for (const t of h < EPS ? [1] : [1, -1]) {
            const n = { x: k * ux - t * h * uy, y: k * uy + t * h * ux };
            const a = { x: c1.center.x + c1.radius * n.x, y: c1.center.y + c1.radius * n.y };
            const b = { x: c2.center.x + s * c2.radius * n.x, y: c2.center.y + s * c2.radius * n.y };
            if (distance(a, b) > EPS && onArc(c1, a) && onArc(c2, b)) out.push({ a, b });
        }
    }
    return out;
}

// Arco por três pontos. Retorna null se colineares.
export function arcFromThreePoints(p1, p2, p3) {
    const ax = p1.x; const ay = p1.y;
    const bx = p2.x; const by = p2.y;
    const cx = p3.x; const cy = p3.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < EPS) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const center = { x: ux, y: uy };
    const radius = distance(center, p1);
    let start = angleOf(center, p1);
    let end = angleOf(center, p3);
    const mid = angleOf(center, p2);
    // Garante que o ponto do meio esteja dentro do arco CCW start→end; senão inverte.
    if (!angleInArc(mid, start, end)) [start, end] = [end, start];
    return { center, radius, start: normalizeAngle(start), end: normalizeAngle(end) };
}

export function circleFromThreePoints(p1, p2, p3) {
    const arc = arcFromThreePoints(p1, p2, p3);
    return arc ? { center: arc.center, radius: arc.radius } : null;
}

// Arco Início, Centro, Fim (CCW)
export function arcFromStartCenterEnd(start, center, end) {
    const radius = distance(center, start);
    if (radius < EPS) return null;
    const startAngle = normalizeAngle(angleOf(center, start));
    const endAngle = normalizeAngle(angleOf(center, end));
    return { center, radius, start: startAngle, end: endAngle };
}

// Arco Início, Centro, Ângulo (positivo = CCW, negativo = CW)
export function arcFromStartCenterAngle(start, center, angleRad) {
    const radius = distance(center, start);
    if (radius < EPS || Math.abs(angleRad) < EPS) return null;
    const startAngle = normalizeAngle(angleOf(center, start));
    if (angleRad >= 0) {
        return { center, radius, start: startAngle, end: normalizeAngle(startAngle + angleRad) };
    } else {
        return { center, radius, start: normalizeAngle(startAngle + angleRad), end: startAngle };
    }
}

// Arco Início, Centro, Comprimento da Corda
export function arcFromStartCenterChord(start, center, chordLength) {
    const radius = distance(center, start);
    if (radius < EPS || chordLength <= 0 || chordLength > 2 * radius + 1e-9) return null;
    const ratio = Math.min(1, Math.max(-1, chordLength / (2 * radius)));
    const theta = 2 * Math.asin(ratio);
    const startAngle = normalizeAngle(angleOf(center, start));
    const endAngle = normalizeAngle(startAngle + theta);
    return { center, radius, start: startAngle, end: endAngle };
}

// Arco Início, Fim, Ângulo Subtendido
export function arcFromStartEndAngle(start, end, includedAngleRad) {
    const chord = distance(start, end);
    const theta = Math.abs(includedAngleRad);
    if (chord < EPS || theta < EPS || theta >= 2 * Math.PI) return null;
    const radius = chord / (2 * Math.sin(theta / 2));
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const ux = (end.x - start.x) / chord;
    const uy = (end.y - start.y) / chord;
    const h = (chord / 2) / Math.tan(theta / 2);
    const nx = -uy;
    const ny = ux;
    const center = { x: mid.x + h * nx, y: mid.y + h * ny };
    const startAngle = normalizeAngle(angleOf(center, start));
    const endAngle = normalizeAngle(angleOf(center, end));
    return { center, radius, start: startAngle, end: endAngle };
}

// Arco Início, Fim, Direção de Tangência Inicial
export function arcFromStartEndDirection(start, end, directionPoint) {
    const chord = distance(start, end);
    if (chord < EPS) return null;
    const tx = directionPoint.x - start.x;
    const ty = directionPoint.y - start.y;
    const tLen = Math.hypot(tx, ty);
    if (tLen < EPS) return null;

    const nx = -ty / tLen;
    const ny = tx / tLen;

    const vx = end.x - start.x;
    const vy = end.y - start.y;

    const nDotV = nx * vx + ny * vy;
    if (Math.abs(nDotV) < EPS) return null;

    const s = (vx * vx + vy * vy) / (2 * nDotV);
    const center = { x: start.x + s * nx, y: start.y + s * ny };
    const radius = distance(center, start);

    let startAngle = normalizeAngle(angleOf(center, start));
    let endAngle = normalizeAngle(angleOf(center, end));

    const ccwTx = -Math.sin(startAngle);
    const ccwTy = Math.cos(startAngle);
    if (ccwTx * tx + ccwTy * ty < 0) {
        [startAngle, endAngle] = [endAngle, startAngle];
    }

    return { center, radius, start: startAngle, end: endAngle };
}

// Arco Início, Fim, Raio
export function arcFromStartEndRadius(start, end, radius) {
    const chord = distance(start, end);
    if (chord < EPS || radius < chord / 2 - 1e-9) return null;
    const r = Math.max(radius, chord / 2);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
    const ux = (end.x - start.x) / chord;
    const uy = (end.y - start.y) / chord;
    const nx = -uy;
    const ny = ux;
    const center = { x: mid.x + h * nx, y: mid.y + h * ny };
    const startAngle = normalizeAngle(angleOf(center, start));
    const endAngle = normalizeAngle(angleOf(center, end));
    return { center, radius: r, start: startAngle, end: endAngle };
}

// Círculo Tangente, Tangente, Raio (TTR) entre 2 linhas
// Círculo tangente a três objetos (AI_CIRCTAN do BricsCAD): linhas tomadas como infinitas,
// arcos como o círculo de apoio. Resolve cada combinação de lados por Newton e fica com a
// solução cujos pontos de tangência caem mais perto dos cliques.
export function circleTangentToThree(picks) {
    if (!Array.isArray(picks) || picks.length !== 3) return null;
    const objs = picks.map(({ entity, point }) => {
        if (entity?.type === 'line') {
            const d = sub(entity.end, entity.start);
            const len = Math.hypot(d.x, d.y);
            if (len < EPS) return null;
            return { kind: 'line', p0: entity.start, n: { x: -d.y / len, y: d.x / len }, pick: point };
        }
        if ((entity?.type === 'circle' || entity?.type === 'arc') && entity.radius > EPS) {
            return { kind: 'circle', c: entity.center, R: entity.radius, pick: point };
        }
        return null;
    });
    if (objs.some((o) => !o)) return null;
    // Linha: s=±1 é o lado. Círculo: 1 = por fora, -1 = dentro dele, 0 = envolvendo-o.
    const modes = (o) => (o.kind === 'line' ? [1, -1] : [1, -1, 0]);
    const residual = (o, s, x, y, r) => {
        if (o.kind === 'line') return o.n.x * (x - o.p0.x) + o.n.y * (y - o.p0.y) - s * r;
        const dist = Math.hypot(x - o.c.x, y - o.c.y);
        return s === 1 ? dist - o.R - r : s === -1 ? dist - o.R + r : dist + o.R - r;
    };
    const touch = (o, s, c, r) => {
        if (o.kind === 'line') return { x: c.x - s * r * o.n.x, y: c.y - s * r * o.n.y };
        const v = sub(c, o.c);
        const len = Math.hypot(v.x, v.y);
        if (len < EPS) return null;
        return { x: o.c.x + (v.x / len) * o.R, y: o.c.y + (v.y / len) * o.R };
    };
    const pts = objs.map((o) => o.pick);
    const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
    const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
    const spread = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), ...objs.map((o) => o.R ?? 0), 1e-3);
    const seeds = [];
    for (const k of [0.25, 1, 4]) {
        seeds.push([cx, cy, spread * k]);
        for (const p of pts) seeds.push([(p.x + cx) / 2, (p.y + cy) / 2, spread * k]);
    }
    let best = null;
    for (const s0 of modes(objs[0])) for (const s1 of modes(objs[1])) for (const s2 of modes(objs[2])) {
        const ss = [s0, s1, s2];
        for (const seed of seeds) {
            let [x, y, r] = seed;
            let ok = false;
            for (let it = 0; it < 60; it++) {
                const f = objs.map((o, i) => residual(o, ss[i], x, y, r));
                if (Math.max(...f.map(Math.abs)) < 1e-10 * Math.max(1, spread)) { ok = true; break; }
                const h = 1e-7 * Math.max(1, spread);
                const J = objs.map((o, i) => [
                    (residual(o, ss[i], x + h, y, r) - f[i]) / h,
                    (residual(o, ss[i], x, y + h, r) - f[i]) / h,
                    (residual(o, ss[i], x, y, r + h) - f[i]) / h,
                ]);
                const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
                const D = det3(J);
                if (!Number.isFinite(D) || Math.abs(D) < 1e-14) break;
                const col = (k) => J.map((row, i) => row.map((v, j) => (j === k ? -f[i] : v)));
                x += det3(col(0)) / D; y += det3(col(1)) / D; r += det3(col(2)) / D;
                if (!Number.isFinite(x + y + r)) break;
            }
            if (!ok || !(r > EPS)) continue;
            const c = { x, y };
            const touches = objs.map((o, i) => touch(o, ss[i], c, r));
            if (touches.some((t) => !t)) continue;
            const score = touches.reduce((acc, t, i) => acc + Math.hypot(t.x - pts[i].x, t.y - pts[i].y), 0);
            if (!best || score < best.score - 1e-9) best = { center: c, radius: r, touches, score };
        }
    }
    return best ? { center: best.center, radius: best.radius, tangentPoints: best.touches } : null;
}

export function circleFromTangentsAndRadius(line1, pick1, line2, pick2, radius) {
    if (!line1 || !line2 || radius <= 0) return null;
    const l1x = line1.end.x - line1.start.x;
    const l1y = line1.end.y - line1.start.y;
    const len1 = Math.hypot(l1x, l1y);
    if (len1 < EPS) return null;

    const l2x = line2.end.x - line2.start.x;
    const l2y = line2.end.y - line2.start.y;
    const len2 = Math.hypot(l2x, l2y);
    if (len2 < EPS) return null;

    const n1 = { x: -l1y / len1, y: l1x / len1 };
    const n2 = { x: -l2y / len2, y: l2x / len2 };

    const side1 = Math.sign((pick1.x - line1.start.x) * n1.x + (pick1.y - line1.start.y) * n1.y) || 1;
    const side2 = Math.sign((pick2.x - line2.start.x) * n2.x + (pick2.y - line2.start.y) * n2.y) || 1;

    const p1 = { x: line1.start.x + side1 * radius * n1.x, y: line1.start.y + side1 * radius * n1.y };
    const p2 = { x: line2.start.x + side2 * radius * n2.x, y: line2.start.y + side2 * radius * n2.y };

    const a1 = n1.x; const b1 = n1.y; const c1 = a1 * p1.x + b1 * p1.y;
    const a2 = n2.x; const b2 = n2.y; const c2 = a2 * p2.x + b2 * p2.y;

    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < EPS) return null;

    const cx = (c1 * b2 - c2 * b1) / det;
    const cy = (a1 * c2 - a2 * c1) / det;

    return { center: { x: cx, y: cy }, radius };
}

// ---------------------------------------------------------------------------
// Bounding boxes

export function emptyBox() {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function boxAddPoint(box, p) {
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
    return box;
}

export function boxIsEmpty(box) {
    return !(box.minX <= box.maxX && box.minY <= box.maxY);
}

export function curveBox(curve) {
    if (curve.kind === 'ellipse') return ellipseBoxExact(curve);
    if (curve.kind === 'bezier') return bezierBoxExact(curve);
    const box = emptyBox();
    if (curve.kind === 'segment') {
        boxAddPoint(box, curve.a);
        boxAddPoint(box, curve.b);
        return box;
    }
    if (curve.kind === 'circle') {
        boxAddPoint(box, { x: curve.center.x - curve.radius, y: curve.center.y - curve.radius });
        boxAddPoint(box, { x: curve.center.x + curve.radius, y: curve.center.y + curve.radius });
        return box;
    }
    curveEndpoints(curve).forEach((p) => boxAddPoint(box, p));
    if (curve.kind === 'arc' && curve.chordA && curve.chordB && curve.bulge != null) {
        boxAddPoint(box, evalBulgeArcRational(curve.chordA, curve.chordB, curve.bulge, 0));
    }
    curveQuadrants(curve).forEach((p) => boxAddPoint(box, p));
    return box;
}

export function entityBox(entity) {
    if (entity._bbox) return entity._bbox;
    const box = emptyBox();
    entityCurves(entity).forEach((c) => {
        const cb = curveBox(c);
        boxAddPoint(box, { x: cb.minX, y: cb.minY });
        boxAddPoint(box, { x: cb.maxX, y: cb.maxY });
    });
    if (entity.type === 'text') boxAddPoint(box, entity.position);
    if (entity.type === 'point') boxAddPoint(box, entity.position ?? entity.point);
    if (providers[entity.type]?.extraPoints) providers[entity.type].extraPoints(entity, entityContext).forEach((p) => boxAddPoint(box, p));
    entity._bbox = box;
    return box;
}

export function boxesIntersect(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boxContains(outer, inner) {
    return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

// Cruzamento de curva com retângulo (para seleção crossing).
export function curveIntersectsBox(curve, box) {
    const cb = curveBox(curve);
    if (!boxesIntersect(cb, box)) return false;
    if (boxContains(box, cb)) return true;
    const corners = [
        { x: box.minX, y: box.minY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
        { x: box.minX, y: box.maxY },
    ];
    for (let i = 0; i < 4; i += 1) {
        const edge = { kind: 'segment', a: corners[i], b: corners[(i + 1) % 4] };
        if (intersectCurves(curve, edge).length > 0) return true;
    }
    if (curve.kind === 'segment') {
        return pointInBox(curve.a, box) || pointInBox(curve.b, box);
    }
    if (curve.kind === 'bezier') {
        return pointInBox(curve.points[0], box) || pointInBox(curve.points[curve.points.length - 1], box);
    }
    if (curve.kind === 'ellipse') {
        return pointInBox(evalEllipsePoint(curve, curve.start ?? 0), box);
    }
    // Círculo/arco que contém o retângulo inteiro sem cruzar bordas não é seleção crossing.
    return curveEndpoints(curve).some((p) => pointInBox(p, box));
}

export function pointInBox(p, box) {
    return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

// ---------------------------------------------------------------------------
// Transformações de entidades

export function transformEntity(entity, fn, { mirror = false } = {}) {
    if (providers[entity.type]?.transform) return providers[entity.type].transform(entity, fn, mirror);
    const e = { ...entity };
    delete e._bbox;
    delete e._sampledPts;
    switch (entity.type) {
        case 'line':
        case 'xline':
        case 'ray':
            if (entity.start) e.start = fn(entity.start);
            if (entity.end) e.end = fn(entity.end);
            if (entity.point) e.point = fn(entity.point);
            if (entity.basePoint) e.basePoint = fn(entity.basePoint);
            if (entity.unitVector) {
                const p0 = fn({ x: 0, y: 0 });
                const p1 = fn(entity.unitVector);
                const d = sub(p1, p0);
                const len = Math.hypot(d.x, d.y) || 1;
                e.unitVector = { x: d.x / len, y: d.y / len };
            }
            break;
        case 'point':
            if (entity.position) e.position = fn(entity.position);
            if (entity.point) e.point = fn(entity.point);
            break;
        case 'circle':
            e.center = fn(entity.center);
            e.radius = distance(fn(entity.center), fn({ x: entity.center.x + entity.radius, y: entity.center.y }));
            break;
        case 'arc': {
            const s = fn(polar(entity.center, entity.start, entity.radius));
            const en = fn(polar(entity.center, entity.end, entity.radius));
            e.center = fn(entity.center);
            e.radius = distance(e.center, s);
            let start = angleOf(e.center, s);
            let end = angleOf(e.center, en);
            if (mirror) [start, end] = [end, start];
            e.start = normalizeAngle(start);
            e.end = normalizeAngle(end);
            break;
        }
        case 'polyline': {
            const scaleFactor = entity.vertices.length > 1
                ? distance(fn(entity.vertices[0]), fn(entity.vertices[1])) / Math.max(distance(entity.vertices[0], entity.vertices[1]), EPS)
                : 1;
            e.vertices = entity.vertices.map((v) => ({ ...fn(v), bulge: mirror ? -(v.bulge ?? 0) : (v.bulge ?? 0) }));
            void scaleFactor;
            break;
        }
        case 'text': {
            const p = fn(entity.position);
            const ref = fn(polar(entity.position, degToRad(entity.rotation ?? 0), entity.height));
            e.position = p;
            const newHeight = distance(p, ref);
            if (entity.height > 0 && entity.boxWidth) {
                e.boxWidth = entity.boxWidth * (newHeight / entity.height);
            }
            e.height = newHeight;
            e.rotation = radToDeg(angleOf(p, ref));
            if (mirror) {
                e.mirrored = !entity.mirrored;
                if (e.halign === 'left') e.halign = 'right';
                else if (e.halign === 'right') e.halign = 'left';
            }
            break;
        }
        default:
            break;
    }
    return e;
}

export function translateEntity(entity, delta) {
    return transformEntity(entity, (p) => add(p, delta));
}

export function rotateEntity(entity, center, angle) {
    return transformEntity(entity, (p) => rotatePoint(p, center, angle));
}

export function scaleEntity(entity, base, factor) {
    return transformEntity(entity, (p) => scalePoint(p, base, factor));
}

export function mirrorEntity(entity, a, b) {
    return transformEntity(entity, (p) => mirrorPoint(p, a, b), { mirror: true });
}

// Offset paralelo com resolução planar global (auto-interseções, swallowtails, pinch-off de gargalos em N ilhas e hodógrafo para spline/elipse).
// `side` é um ponto que define o lado.
export function offsetEntity(entity, dist, side) {
    return offsetEntityPlanar(entity, dist, side);
}

export { offsetEntityMultiple, offsetPolylinePlanar };

function closeCoincidentEnds(entity) {
    const vs = entity.vertices;
    if (entity.closed || vs.length < 4) return entity;
    const first = vs[0];
    const last = vs[vs.length - 1];
    // 0,1 µm ou a escala relativa do TRIM: muito abaixo de qualquer folga real de corte.
    const tol = Math.max(1e-4, 1e-6 * Math.hypot(first.x, first.y));
    if (distance(first, last) > tol) return entity;
    return { ...entity, closed: true, vertices: vs.slice(0, -1) };
}

function offsetPolyline(rawEntity, dist, side) {
    // Contorno "aberto" com as pontas coincidentes (comum em DXF) é tratado como fechado: senão o canto do início
    // não é unido e o offset para dentro sai com sobra ou falha.
    const entity = closeCoincidentEnds(rawEntity);
    const curves = polylineCurves(entity.vertices, entity.closed);
    if (curves.length === 0) return null;
    // Sentido de percurso de cada curva: arco com bulge positivo é anti-horário.
    const isCCW = (curve) => (entity.vertices[curve.index]?.bulge ?? 0) > 0;
    // Lado do offset (+1 = esquerda do percurso) decidido pela curva mais próxima do ponto clicado.
    let nearest = null;
    curves.forEach((c) => {
        const d = distanceToCurve(side, c);
        if (!nearest || d < nearest.d) nearest = { c, d };
    });
    const c = nearest.c;
    let leftSign;
    if (c.kind === 'segment') leftSign = cross(sub(c.b, c.a), sub(side, c.a)) >= 0 ? 1 : -1;
    else {
        // Num arco anti-horário a esquerda do percurso é o interior do círculo; no horário é o exterior.
        const inside = distance(side, c.center) < c.radius;
        leftSign = inside === isCCW(c) ? 1 : -1;
    }
    // Arco com raio menor que a distância (ex.: concordância R1 num offset de 3 para dentro) some, como no AutoCAD:
    // as curvas vizinhas passam a se unir entre si em vez de abortar o offset inteiro.
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
    const startOf = (curve) => (curve.kind === 'segment' ? curve.a : polar(curve.center, curve.start, curve.radius));
    const endOf = (curve) => (curve.kind === 'segment' ? curve.b : polar(curve.center, curve.end, curve.radius));
    // Junta curvas consecutivas pela interseção (estendendo-as) mais próxima do canto original.
    const jointPoint = (prev, next) => {
        const hits = intersectCurves(prev, next, { extend1: true, extend2: true });
        if (hits.length === 0) return endOf(prev);
        const target = midpoint(endOf(prev), startOf(next));
        hits.sort((p, q) => distance(p, target) - distance(q, target));
        return hits[0];
    };
    const computeJoints = () => {
        const n2 = offsetCurves.length;
        const out = [];
        for (let i = 0; i < n2; i += 1) {
            const curve = offsetCurves[i];
            const prev = offsetCurves[(i - 1 + n2) % n2];
            out.push(i === 0 && !entity.closed ? startOf(curve) : jointPoint(prev, curve));
        }
        if (!entity.closed) out.push(endOf(offsetCurves[n2 - 1]));
        return out;
    };
    // Curva que ficou "virada" entre as junções (segmento curto ou arco engolido pelo offset) também sai;
    // repete até estabilizar, pois remover uma muda a junção das vizinhas.
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
    // Bulge recalculado a partir dos novos pontos: o offset muda o raio e, após as junções, o ângulo varrido.
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
            bulge = (ccw ? 1 : -1) * Math.tan(sweep / 4);
        }
        vertices.push({ x: startPoint.x, y: startPoint.y, bulge });
    }
    if (!entity.closed) vertices.push({ x: joints[n].x, y: joints[n].y, bulge: 0 });
    return { ...entity, vertices };
}

// Divide a curva de uma entidade nos pontos dados e devolve as partes como entidades.
export function splitEntityAt(entity, rawPoints) {
    // Pontos de corte coincidentes (ex.: duas arestas cruzando no mesmo ponto) geram peças de comprimento zero; deduplica.
    // Linha tangente a círculo dá duas raízes a ~1e-6 uma da outra: com tolerância absoluta pequena,
    // o TRIM deixava lascas de arco e linhas de comprimento zero que o SolidWorks lê como círculo inteiro.
    const tol = splitTolerance(entity);
    const points = [];
    rawPoints.forEach((p) => {
        if (!points.some((q) => distance(p, q) < tol)) points.push(p);
    });
    if (points.length === 0) return [entity];
    if (entity.type === 'line') {
        const len = distance(entity.start, entity.end);
        const sorted = points
            .map((p) => ({ p, t: projectOnLine(p, entity.start, entity.end).t }))
            .filter((h) => h.t * len > tol && (1 - h.t) * len > tol)
            .sort((a, b) => a.t - b.t);
        const pieces = [];
        let cursor = entity.start;
        sorted.forEach((h) => {
            pieces.push({ ...entity, id: undefined, start: cursor, end: h.p });
            cursor = h.p;
        });
        pieces.push({ ...entity, id: undefined, start: cursor, end: entity.end });
        return pieces;
    }
    if (entity.type === 'circle') {
        const angles = points.map((p) => normalizeAngle(angleOf(entity.center, p))).sort((a, b) => a - b);
        // Pontos a menos de tol pela costura de 0/2π também são o mesmo corte.
        if (angles.length > 1 && (angles[0] + TWO_PI - angles[angles.length - 1]) * entity.radius < tol) angles.pop();
        if (angles.length < 2) return [entity];
        const pieces = [];
        for (let i = 0; i < angles.length; i += 1) {
            const s = angles[i];
            const e = angles[(i + 1) % angles.length];
            pieces.push({ type: 'arc', layer: entity.layer, color: entity.color, center: entity.center, radius: entity.radius, start: s, end: e });
        }
        return pieces;
    }
    if (entity.type === 'arc') {
        const sweep = sweepCCW(entity.start, entity.end);
        const rels = points
            .map((p) => normalizeAngle(angleOf(entity.center, p) - entity.start))
            .filter((r) => r * entity.radius > tol && (sweep - r) * entity.radius > tol)
            .sort((a, b) => a - b);
        const pieces = [];
        let cursor = 0;
        rels.forEach((r) => {
            pieces.push({ ...entity, id: undefined, start: normalizeAngle(entity.start + cursor), end: normalizeAngle(entity.start + r) });
            cursor = r;
        });
        pieces.push({ ...entity, id: undefined, start: normalizeAngle(entity.start + cursor), end: entity.end });
        return pieces;
    }
    if (entity.type === 'ellipse') {
        const majorLen = Math.hypot(entity.major.x, entity.major.y);
        const isFull = Math.abs((entity.end ?? TWO_PI) - (entity.start ?? 0)) >= TWO_PI - 1e-6;
        const fullCurve = { kind: 'ellipse', center: entity.center, major: entity.major, ratio: entity.ratio, start: 0, end: TWO_PI, full: true };
        if (isFull) {
            const angles = points.map((p) => normalizeAngle(closestPointOnEllipse(fullCurve, p).t)).sort((a, b) => a - b);
            if (angles.length > 1 && (angles[0] + TWO_PI - angles[angles.length - 1]) * majorLen < tol) angles.pop();
            if (angles.length < 2) return [entity];
            const pieces = [];
            for (let i = 0; i < angles.length; i += 1) {
                const s = angles[i];
                const e = angles[(i + 1) % angles.length];
                pieces.push({ ...entity, id: undefined, start: s, end: e, _bbox: undefined });
            }
            return pieces;
        }
        const s0 = normalizeAngle(entity.start ?? 0);
        const e0 = normalizeAngle(entity.end ?? TWO_PI);
        const sweep = sweepCCW(s0, e0);
        const rels = points
            .map((p) => normalizeAngle(closestPointOnEllipse(fullCurve, p).t - s0))
            .filter((r) => r * majorLen > tol && (sweep - r) * majorLen > tol)
            .sort((a, b) => a - b);
        if (rels.length === 0) return [entity];
        const pieces = [];
        let cursor = 0;
        rels.forEach((r) => {
            pieces.push({ ...entity, id: undefined, start: normalizeAngle(s0 + cursor), end: normalizeAngle(s0 + r), _bbox: undefined });
            cursor = r;
        });
        pieces.push({ ...entity, id: undefined, start: normalizeAngle(s0 + cursor), end: e0, _bbox: undefined });
        return pieces;
    }
    if (entity.type === 'spline') {
        const beziers = entityCurves(entity).filter((c) => c.kind === 'bezier');
        if (beziers.length === 0) return [entity];
        const params = [];
        for (const p of points) {
            let best = null;
            for (const c of beziers) {
                const hit = closestPointOnBezier(c, p);
                if (!best || hit.dist < best.dist) {
                    const t0 = c.t0 ?? 0;
                    const t1 = c.t1 ?? 1;
                    best = { dist: hit.dist, u: t0 + hit.t * (t1 - t0) };
                }
            }
            if (best) params.push(best.u);
        }
        return splitSplineExact(entity, params);
    }
    return [entity];
}

// Tolerância de corte relativa ao tamanho das coordenadas, a mesma escala usada no TRIM.
export function splitTolerance(entity) {
    const pts = entity.type === 'line'
        ? [entity.start, entity.end]
        : entity.center
            ? [entity.center]
            : entity.controlPoints
                ? entity.controlPoints
                : entity.fitPoints ?? [];
    const extraR = entity.radius ?? (entity.major ? Math.hypot(entity.major.x, entity.major.y) : 0);
    const reach = Math.max(1, ...pts.map((p) => Math.hypot(p.x, p.y) + extraR));
    return 1e-6 * reach;
}

// Linha ou arco abaixo da tolerância de corte: resíduo numérico, não geometria.
export function isDegenerateEntity(entity) {
    const tol = splitTolerance(entity);
    if (entity.type === 'line') return distance(entity.start, entity.end) < tol;
    if (entity.type === 'arc') return sweepCCW(entity.start, entity.end) * entity.radius < tol;
    if (entity.type === 'ellipse') {
        const isFull = Math.abs((entity.end ?? TWO_PI) - (entity.start ?? 0)) >= TWO_PI - 1e-6;
        if (isFull) return false;
        const majorLen = Math.hypot(entity.major.x, entity.major.y);
        return sweepCCW(normalizeAngle(entity.start ?? 0), normalizeAngle(entity.end ?? TWO_PI)) * majorLen < tol;
    }
    if (entity.type === 'spline') return entityLength(entity) < tol;
    return false;
}

export function curveLength(curve) {
    if (curve.kind === 'segment') return distance(curve.a, curve.b);
    if (curve.kind === 'circle') return TWO_PI * curve.radius;
    if (curve.kind === 'ellipse') return ellipseLength(curve);
    if (curve.kind === 'bezier') return bezierLength(curve);
    return sweepCCW(curve.start, curve.end) * curve.radius;
}

export function entityLength(entity) {
    return entityCurves(entity).reduce((sum, c) => sum + curveLength(c), 0);
}

// Muda o comprimento de uma linha mantendo a direção. anchor diz o que fica
// parado: 'start' (ponta inicial), 'end' (ponta final) ou 'middle' (centro).
export function setLineLength(entity, length, anchor = 'start') {
    const { start: a, end: b } = entity;
    const current = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > 0) || current < 1e-9) return entity;
    const ux = (b.x - a.x) / current;
    const uy = (b.y - a.y) / current;
    if (anchor === 'end') return { ...entity, start: { ...a, x: b.x - ux * length, y: b.y - uy * length } };
    if (anchor === 'middle') {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const h = length / 2;
        return { ...entity, start: { ...a, x: mx - ux * h, y: my - uy * h }, end: { ...b, x: mx + ux * h, y: my + uy * h } };
    }
    return { ...entity, end: { ...b, x: a.x + ux * length, y: a.y + uy * length } };
}

export function formatNumber(value, decimals = 4) {
    const fixed = Number(value).toFixed(decimals);
    return fixed.replace(/\.?0+$/, '') || '0';
}
