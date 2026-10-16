// Motor de alças (Grips) para edição direta no canvas.
// Permite selecionar entidades e puxar alças para esticar linhas, redimensionar
// círculos e arcos, mover vértices de polilinhas e reposicionar cotas.

import { distance, sub, add, midpoint, polar, angleOf, normalizeAngle, sweepCCW, scale, perpendicular } from './geometry.js';
import { ensureSplineGeometry } from './extra-entities.js';

/**
 * Retorna lista de alças (grips) disponíveis para a entidade.
 * @param {object} entity
 * @returns {Array<{ id: string, entityId: string, type: string, index?: number|string, point: {x: number, y: number} }>}
 */
// Acima disso as alças somem e a seleção fica só no tracejado (GRIPOBJLIMIT do
// AutoCAD/BricsCAD, padrão 100): desenhar milhares de quadradinhos travava a tela.
export const GRIP_OBJECT_LIMIT = 100;

export function gripsVisible(selectionSize) {
    return selectionSize > 0 && selectionSize <= GRIP_OBJECT_LIMIT;
}

export function getEntityGrips(entity) {
    if (!entity || !entity.id) return [];
    const grips = [];

    switch (entity.type) {
        case 'line':
            grips.push({ id: `${entity.id}:start`, entityId: entity.id, type: 'start', point: entity.start });
            grips.push({ id: `${entity.id}:mid`, entityId: entity.id, type: 'mid', point: midpoint(entity.start, entity.end) });
            grips.push({ id: `${entity.id}:end`, entityId: entity.id, type: 'end', point: entity.end });
            break;

        case 'circle':
            grips.push({ id: `${entity.id}:center`, entityId: entity.id, type: 'center', point: entity.center });
            grips.push({ id: `${entity.id}:q0`, entityId: entity.id, type: 'quadrant', index: 0, point: { x: entity.center.x + entity.radius, y: entity.center.y } });
            grips.push({ id: `${entity.id}:q1`, entityId: entity.id, type: 'quadrant', index: 1, point: { x: entity.center.x, y: entity.center.y + entity.radius } });
            grips.push({ id: `${entity.id}:q2`, entityId: entity.id, type: 'quadrant', index: 2, point: { x: entity.center.x - entity.radius, y: entity.center.y } });
            grips.push({ id: `${entity.id}:q3`, entityId: entity.id, type: 'quadrant', index: 3, point: { x: entity.center.x, y: entity.center.y - entity.radius } });
            break;

        case 'arc':
            grips.push({ id: `${entity.id}:center`, entityId: entity.id, type: 'center', point: entity.center });
            grips.push({ id: `${entity.id}:start`, entityId: entity.id, type: 'start', point: polar(entity.center, entity.start, entity.radius) });
            grips.push({ id: `${entity.id}:end`, entityId: entity.id, type: 'end', point: polar(entity.center, entity.end, entity.radius) });
            {
                const sweep = sweepCCW(entity.start, entity.end);
                const midAngle = normalizeAngle(entity.start + sweep / 2);
                grips.push({ id: `${entity.id}:mid`, entityId: entity.id, type: 'mid', point: polar(entity.center, midAngle, entity.radius) });
            }
            break;

        case 'polyline':
            (entity.vertices ?? []).forEach((v, i) => {
                grips.push({ id: `${entity.id}:v${i}`, entityId: entity.id, type: 'vertex', index: i, point: { x: v.x, y: v.y } });
            });
            break;

        case 'dimension':
            if (entity.linePoint) {
                grips.push({ id: `${entity.id}:linePoint`, entityId: entity.id, type: 'linePoint', point: entity.linePoint });
            }
            if (entity.p1) {
                grips.push({ id: `${entity.id}:p1`, entityId: entity.id, type: 'p1', point: entity.p1 });
            }
            if (entity.p2) {
                grips.push({ id: `${entity.id}:p2`, entityId: entity.id, type: 'p2', point: entity.p2 });
            }
            if (entity.vertex) {
                grips.push({ id: `${entity.id}:vertex`, entityId: entity.id, type: 'vertex', point: entity.vertex });
            }
            if (entity.center) {
                grips.push({ id: `${entity.id}:center`, entityId: entity.id, type: 'center', point: entity.center });
            }
            break;

        case 'text':
            grips.push({ id: `${entity.id}:position`, entityId: entity.id, type: 'position', point: entity.position });
            break;

        case 'terminal':
            grips.push({ id: `${entity.id}:position`, entityId: entity.id, type: 'position', point: entity.position });
            break;

        case 'point': {
            const pt = entity.position ?? entity.point;
            if (pt) {
                grips.push({ id: `${entity.id}:point`, entityId: entity.id, type: 'point', point: pt });
            }
            break;
        }

        case 'ellipse':
            grips.push({ id: `${entity.id}:center`, entityId: entity.id, type: 'center', point: entity.center });
            if (entity.major) {
                grips.push({ id: `${entity.id}:major`, entityId: entity.id, type: 'major', point: add(entity.center, entity.major) });
                const minorVec = scale(perpendicular(entity.major), entity.ratio ?? 0.5);
                grips.push({ id: `${entity.id}:minor`, entityId: entity.id, type: 'minor', point: add(entity.center, minorVec) });
            }
            break;

        case 'spline':
            if (entity.fitPoints && entity.fitPoints.length > 0) {
                entity.fitPoints.forEach((p, i) => {
                    grips.push({ id: `${entity.id}:fit${i}`, entityId: entity.id, type: 'fitPoint', index: i, point: { x: p.x, y: p.y } });
                });
            } else if (entity.controlPoints && entity.controlPoints.length > 0) {
                entity.controlPoints.forEach((p, i) => {
                    grips.push({ id: `${entity.id}:cp${i}`, entityId: entity.id, type: 'controlPoint', index: i, point: { x: p.x, y: p.y } });
                });
            }
            break;

        default:
            break;
    }

    return grips;
}

/**
 * Aplica o estiramento / deslocamento da alça sobre a entidade e retorna uma nova entidade modificada.
 * @param {object} entity
 * @param {object} grip
 * @param {{x: number, y: number}} targetPoint
 * @returns {object}
 */
export function applyGripMove(entity, grip, targetPoint) {
    if (!entity || !grip) return entity;
    const p = targetPoint;

    switch (entity.type) {
        case 'line':
            if (grip.type === 'start') {
                return { ...entity, start: { x: p.x, y: p.y } };
            }
            if (grip.type === 'end') {
                return { ...entity, end: { x: p.x, y: p.y } };
            }
            if (grip.type === 'mid') {
                const delta = sub(p, grip.point);
                return {
                    ...entity,
                    start: add(entity.start, delta),
                    end: add(entity.end, delta),
                };
            }
            break;

        case 'circle':
            if (grip.type === 'center') {
                return { ...entity, center: { x: p.x, y: p.y } };
            }
            if (grip.type === 'quadrant') {
                const newRadius = Math.max(distance(entity.center, p), 1e-4);
                return { ...entity, radius: newRadius };
            }
            break;

        case 'arc':
            if (grip.type === 'center') {
                return { ...entity, center: { x: p.x, y: p.y } };
            }
            if (grip.type === 'start') {
                const newStart = normalizeAngle(angleOf(entity.center, p));
                return { ...entity, start: newStart };
            }
            if (grip.type === 'end') {
                const newEnd = normalizeAngle(angleOf(entity.center, p));
                return { ...entity, end: newEnd };
            }
            if (grip.type === 'mid') {
                const newRadius = Math.max(distance(entity.center, p), 1e-4);
                return { ...entity, radius: newRadius };
            }
            break;

        case 'polyline':
            if (grip.type === 'vertex' && typeof grip.index === 'number') {
                const newVertices = entity.vertices.map((v, i) =>
                    i === grip.index ? { ...v, x: p.x, y: p.y } : { ...v }
                );
                return { ...entity, vertices: newVertices };
            }
            break;

        case 'dimension':
            if (grip.type === 'linePoint') {
                return { ...entity, linePoint: { x: p.x, y: p.y } };
            }
            if (grip.type === 'p1') {
                return { ...entity, p1: { x: p.x, y: p.y } };
            }
            if (grip.type === 'p2') {
                return { ...entity, p2: { x: p.x, y: p.y } };
            }
            if (grip.type === 'vertex') {
                return { ...entity, vertex: { x: p.x, y: p.y } };
            }
            if (grip.type === 'center') {
                return { ...entity, center: { x: p.x, y: p.y } };
            }
            break;

        case 'text':
            if (grip.type === 'position') {
                return { ...entity, position: { x: p.x, y: p.y } };
            }
            break;

        case 'terminal':
            if (grip.type === 'position') {
                return { ...entity, position: { x: p.x, y: p.y } };
            }
            break;

        case 'point':
            if (grip.type === 'point') {
                return {
                    ...entity,
                    ...(entity.position ? { position: { x: p.x, y: p.y } } : {}),
                    ...(entity.point ? { point: { x: p.x, y: p.y } } : {}),
                    ...(!entity.position && !entity.point ? { position: { x: p.x, y: p.y } } : {}),
                };
            }
            break;

        case 'ellipse':
            if (grip.type === 'center') {
                return { ...entity, center: { x: p.x, y: p.y } };
            }
            if (grip.type === 'major') {
                const newMajor = sub(p, entity.center);
                return { ...entity, major: newMajor };
            }
            if (grip.type === 'minor') {
                const majorLen = Math.hypot(entity.major.x, entity.major.y);
                const d = distance(entity.center, p);
                return { ...entity, ratio: majorLen > 0 ? d / majorLen : entity.ratio };
            }
            break;

        case 'spline':
            if (grip.type === 'fitPoint' && typeof grip.index === 'number') {
                const newFit = entity.fitPoints.map((v, i) => (i === grip.index ? { x: p.x, y: p.y } : { ...v }));
                return ensureSplineGeometry({ ...entity, fitPoints: newFit });
            }
            if (grip.type === 'controlPoint' && typeof grip.index === 'number') {
                const newCp = entity.controlPoints.map((v, i) => (i === grip.index ? { x: p.x, y: p.y } : { ...v }));
                return { ...entity, controlPoints: newCp };
            }
            break;

        default:
            break;
    }

    return entity;
}

/**
 * Encontra a alça mais próxima dentro da tolerância em pixels de tela.
 * @param {Array<object>} grips
 * @param {{x: number, y: number}} screenPos
 * @param {function({x: number, y: number}): {x: number, y: number}} worldToScreen
 * @param {number} tolerance
 * @returns {object|null}
 */
export function findGripAt(grips, screenPos, worldToScreen, tolerance = 8) {
    let closest = null;
    let bestDist = tolerance;
    for (const grip of grips) {
        const s = worldToScreen(grip.point);
        const d = Math.hypot(screenPos.x - s.x, screenPos.y - s.y);
        if (d <= bestDist) {
            bestDist = d;
            closest = grip;
        }
    }
    return closest;
}
