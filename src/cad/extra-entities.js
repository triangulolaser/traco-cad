// Entidades adicionais registradas no kernel: elipse, spline e imagem.
// Cada provedor entrega curvas (para hit-test/snap/bbox), pontos de snap próprios e transformação.

import { registerEntityProvider, add, sub, scale, distance, angleOf, rotatePoint, normalizeAngle, degToRad, radToDeg, perpendicular, normalize } from './geometry.js';
import { sampleSpline, interpolateSpline } from './splines.js';

// ---------------------------------------------------------------------------
// Elipse: { center, major: {x,y} (vetor do centro ao fim do eixo maior), ratio (menor/maior), start, end (parâmetros, rad) }

export function ellipsePoint(entity, t) {
    const minor = scale(perpendicular(entity.major), entity.ratio);
    return add(entity.center, add(scale(entity.major, Math.cos(t)), scale(minor, Math.sin(t))));
}

export function ellipseIsFull(entity) {
    const s = entity.start ?? 0;
    const e = entity.end ?? Math.PI * 2;
    return Math.abs((e - s) - Math.PI * 2) < 1e-9 || (s === 0 && e === 0);
}

export function ellipseSamples(entity, segments = 96) {
    const s = entity.start ?? 0;
    let e = entity.end ?? Math.PI * 2;
    if (e <= s) e += Math.PI * 2;
    const count = Math.max(8, Math.ceil((segments * (e - s)) / (Math.PI * 2)));
    const out = [];
    for (let i = 0; i <= count; i += 1) out.push(ellipsePoint(entity, s + ((e - s) * i) / count));
    return out;
}

// Segmentos de aproximação levam `approx: true`: servem para hit-test, NEA, PER e INT, mas não geram END/MID.
function polylineFromSamples(points, closed, approx = true) {
    const curves = [];
    for (let i = 0; i + 1 < points.length; i += 1) curves.push({ kind: 'segment', a: points[i], b: points[i + 1], approx });
    if (closed && points.length > 2 && distance(points[0], points[points.length - 1]) > 1e-9) curves.push({ kind: 'segment', a: points[points.length - 1], b: points[0], approx });
    return curves;
}

function ellipseTransform(entity, fn, mirror) {
    const center = fn(entity.center);
    const majorEnd = fn(add(entity.center, entity.major));
    const minorEnd = fn(add(entity.center, scale(perpendicular(entity.major), entity.ratio)));
    const major = sub(majorEnd, center);
    const majorLen = Math.hypot(major.x, major.y);
    const minorLen = distance(minorEnd, center);
    const e = { ...entity, center, major, ratio: majorLen > 0 ? minorLen / majorLen : entity.ratio };
    if (mirror && !ellipseIsFull(entity)) {
        // Espelhar inverte o sentido paramétrico.
        e.start = Math.PI * 2 - (entity.end ?? Math.PI * 2);
        e.end = Math.PI * 2 - (entity.start ?? 0);
    }
    return e;
}

registerEntityProvider('ellipse', {
    curves: (entity) => polylineFromSamples(ellipseSamples(entity), ellipseIsFull(entity)),
    extraPoints: () => [],
    transform: ellipseTransform,
    snapPoints: (entity) => {
        const pts = [{ mode: 'cen', point: entity.center }];
        const full = ellipseIsFull(entity);
        [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((t) => {
            if (full || paramInRange(t, entity)) pts.push({ mode: 'qua', point: ellipsePoint(entity, t) });
        });
        if (!full) {
            pts.push({ mode: 'end', point: ellipsePoint(entity, entity.start ?? 0) });
            pts.push({ mode: 'end', point: ellipsePoint(entity, entity.end ?? 0) });
        }
        return pts;
    },
});

function paramInRange(t, entity) {
    const s = entity.start ?? 0;
    let e = entity.end ?? Math.PI * 2;
    if (e <= s) e += Math.PI * 2;
    let tt = t;
    while (tt < s) tt += Math.PI * 2;
    return tt <= e + 1e-9;
}

// ---------------------------------------------------------------------------
// Spline: { degree, knots, controlPoints, fitPoints?, closed }

export function ensureSplineGeometry(entity) {
    if (entity.controlPoints && entity.controlPoints.length >= 2 && entity.knots && entity.knots.length) return entity;
    if (entity.fitPoints && entity.fitPoints.length >= 2) {
        const built = interpolateSpline(entity.fitPoints, { closed: Boolean(entity.closed) });
        if (built) return { ...entity, ...built, fitPoints: entity.fitPoints };
    }
    return entity;
}

function splineTransform(entity, fn) {
    const e = { ...entity };
    delete e._sampledPts;
    delete e._bbox;
    if (entity.controlPoints) e.controlPoints = entity.controlPoints.map(fn);
    if (entity.fitPoints) e.fitPoints = entity.fitPoints.map(fn);
    return e;
}

registerEntityProvider('spline', {
    curves: (entity) => {
        if (!entity._sampledPts) {
            entity._sampledPts = sampleSpline(ensureSplineGeometry(entity), 16);
        }
        return polylineFromSamples(entity._sampledPts, Boolean(entity.closed));
    },
    extraPoints: (entity) => entity.controlPoints ?? [],
    transform: splineTransform,
    snapPoints: (entity) => {
        const pts = entity._sampledPts || sampleSpline(ensureSplineGeometry(entity), 1);
        if (pts.length === 0) return [];
        const out = [{ mode: 'end', point: pts[0] }, { mode: 'end', point: pts[pts.length - 1] }];
        (entity.fitPoints ?? []).forEach((p) => out.push({ mode: 'nod', point: p }));
        return out;
    },
});

// ---------------------------------------------------------------------------
// Imagem: { position (canto inferior esquerdo), width, height, rotation (graus), src (dataURL), opacity }

export function imageCorners(entity) {
    const rot = degToRad(entity.rotation ?? 0);
    const corners = [
        { x: 0, y: 0 },
        { x: entity.width, y: 0 },
        { x: entity.width, y: entity.height },
        { x: 0, y: entity.height },
    ];
    return corners.map((c) => rotatePoint(add(entity.position, c), entity.position, rot));
}

function imageTransform(entity, fn, mirror) {
    const corners = imageCorners(entity).map(fn);
    const position = corners[0];
    const width = distance(corners[0], corners[1]);
    const height = distance(corners[0], corners[3]);
    const rotation = radToDeg(angleOf(corners[0], corners[1]));
    return { ...entity, position, width, height, rotation, mirrored: mirror ? !entity.mirrored : entity.mirrored };
}

registerEntityProvider('image', {
    curves: (entity) => polylineFromSamples(imageCorners(entity), true, false),
    extraPoints: () => [],
    transform: imageTransform,
    snapPoints: (entity) => {
        const c = imageCorners(entity);
        return [...c.map((p) => ({ mode: 'end', point: p })), { mode: 'cen', point: { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 } }];
    },
});

// ---------------------------------------------------------------------------
// Terminal elétrico QElectroTech (.elmt)
// { type: 'terminal', position: {x,y}, orientation: 'n'|'s'|'e'|'w', name, uuid, terminalType }

function terminalTransform(entity, fn, mirror) {
    const p = fn(entity.position);
    let orientation = entity.orientation;
    if (mirror) {
        if (orientation === 'e') orientation = 'w';
        else if (orientation === 'w') orientation = 'e';
    }
    return { ...entity, position: p, orientation };
}

registerEntityProvider('terminal', {
    curves: (entity) => {
        const p = entity.position;
        const r = entity.radius || 3.5;
        return [{ kind: 'circle', center: p, radius: r }];
    },
    extraPoints: (entity) => [entity.position],
    transform: terminalTransform,
    snapPoints: (entity) => [
        { mode: 'nod', point: entity.position },
        { mode: 'cen', point: entity.position },
    ],
});

export { normalize, normalizeAngle };

