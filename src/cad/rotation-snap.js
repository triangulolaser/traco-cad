import { angleOf, distance, entityCurves, polar, rotatePoint } from './geometry.js';
import { expandInsert } from './blocks.js';

// Cache the real straight edges once per ROTATE, never tessellated curves/text boxes.
export function rotationEdges(entities) {
    return entities.flatMap(entity => {
        if (entity.type === 'insert') {
            try { return rotationEdges(expandInsert(entity)); } catch { return []; }
        }
        if (!['line', 'polyline', 'lwpolyline'].includes(entity.type)) return [];
        return entityCurves(entity).filter(c => c.kind === 'segment' && distance(c.a, c.b) > 1e-9);
    });
}

export function findRotationSnap(edges, base, cursor, tolerance, referenceAngle = 0) {
    const radius = distance(base, cursor);
    if (radius < 1e-9 || !(tolerance > 0)) return null;
    const angle = angleOf(base, cursor) - referenceAngle;
    let best = null;
    for (const edge of edges) {
        const heading = angleOf(edge.a, edge.b) + angle;
        const correction = Math.round(heading / (Math.PI / 2)) * (Math.PI / 2) - heading;
        const error = Math.abs(correction);
        // Both limits matter: a distant pointer must not jump tens of pixels.
        if (error > Math.PI / 60 || 2 * radius * Math.sin(error / 2) > tolerance) continue;
        if (best && error >= best.error) continue;
        const snapped = angle + correction;
        best = { error, angle: snapped,
            point: polar(base, snapped + referenceAngle, radius),
            guide: { type: 'line', start: rotatePoint(edge.a, base, snapped),
                end: rotatePoint(edge.b, base, snapped), rotationGuide: true } };
    }
    return best;
}
