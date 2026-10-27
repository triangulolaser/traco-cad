// Motor de alças (Grips) para edição direta no canvas.
// Permite selecionar entidades e puxar alças para esticar linhas, redimensionar
// círculos e arcos, mover vértices de polilinhas e reposicionar cotas.

import { distance, sub, add, midpoint, polar, angleOf, normalizeAngle, sweepCCW, scale, perpendicular, dot, arcFromThreePoints } from './geometry.js';
import { ensureSplineGeometry } from './extra-entities.js';
import { LINEAR_DIMENSION_KINDS, linearDimensionEnds, linearTextHandle, restretchLinearDimension } from './dimensions.js';

/**
 * Retorna lista de alças (grips) disponíveis para a entidade.
 * @param {object} entity
 * @returns {Array<{ id: string, entityId: string, type: string, index?: number|string, point: {x: number, y: number} }>}
 */
// Acima disso as alças somem e a seleção fica só no tracejado (GRIPOBJLIMIT do
// AutoCAD/BricsCAD, padrão 100): desenhar milhares de quadradinhos travava a tela.
export const GRIP_OBJECT_LIMIT = 100;

/**
 * Centro da cota para a alça do texto: mesmo afastamento do cursor, no meio da medida ao longo da linha.
 * Devolve null fora da tolerância ou em cota não linear.
 */
export function dimensionTextCenterSnap(entity, cursor, tolerance) {
    if (entity?.type !== 'dimension' || !entity.p1 || !entity.p2) return null;
    const normal = dimensionLineNormal(entity);
    if (!normal) return null;
    const dir = { x: normal.y, y: -normal.x };
    const mid = midpoint(entity.p1, entity.p2);
    const along = (cursor.x - mid.x) * dir.x + (cursor.y - mid.y) * dir.y;
    if (Math.abs(along) > tolerance) return null;
    return sub(cursor, scale(dir, along));
}

/** Normal unitária à direção de medição da cota linear; null para radial, diametral e angular. */
function dimensionLineNormal(entity) {
    if (entity.kind === 'horizontal') return { x: 0, y: 1 };
    if (entity.kind === 'vertical') return { x: 1, y: 0 };
    let angle;
    if (entity.kind === 'rotated') angle = ((entity.rotation ?? 0) * Math.PI) / 180;
    else if (entity.kind === 'aligned' && entity.p1 && entity.p2) angle = angleOf(entity.p1, entity.p2);
    else return null;
    return { x: -Math.sin(angle), y: Math.cos(angle) };
}

export function gripsVisible(selectionSize) {
    return selectionSize > 0 && selectionSize <= GRIP_OBJECT_LIMIT;
}

export function getEntityGrips(entity, dimStyle) {
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
            // Alças das setas vêm antes: findGripAt prefere a última em empate, então linePoint continua ganhando quando coincide.
            if (LINEAR_DIMENSION_KINDS.includes(entity.kind) && entity.p1 && entity.p2 && entity.linePoint) {
                const { d1, d2 } = linearDimensionEnds(entity);
                grips.push({ id: `${entity.id}:arrow1`, entityId: entity.id, type: 'arrow', index: 0, point: d1 });
                grips.push({ id: `${entity.id}:arrow2`, entityId: entity.id, type: 'arrow', index: 1, point: d2 });
                // Alça no meio da linha sob o número: arrasta o texto para qualquer lado, como no BricsCAD.
                const h = linearTextHandle(entity, dimStyle);
                grips.push({ id: `${entity.id}:textAlong`, entityId: entity.id, type: 'textAlong', point: h.point, normal: h.normal, lift: h.lift });
            }
            if (entity.linePoint) {
                grips.push({ id: `${entity.id}:linePoint`, entityId: entity.id, type: 'linePoint', point: entity.linePoint });
            }
            if (entity.textPosition) {
                grips.push({ id: `${entity.id}:textPosition`, entityId: entity.id, type: 'textPosition', point: entity.textPosition });
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
 * @param {object} [dimStyle] estilo de cota do documento (fator de medida ao reesticar cota com texto fixo)
 * @returns {object}
 */
export function applyGripMove(entity, grip, targetPoint, dimStyle) {
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
            if (grip.type === 'start' || grip.type === 'end') {
                // Como no AutoCAD/BricsCAD: a ponta estica o arco pela outra ponta e pelo meio,
                // então o raio cresce ou diminui com o cursor. Pontos alinhados mantêm o raio.
                const sweep = sweepCCW(entity.start, entity.end);
                const mid = polar(entity.center, normalizeAngle(entity.start + sweep / 2), entity.radius);
                const other = polar(entity.center, grip.type === 'start' ? entity.end : entity.start, entity.radius);
                const fit = grip.type === 'start' ? arcFromThreePoints(p, mid, other) : arcFromThreePoints(other, mid, p);
                if (fit && Number.isFinite(fit.radius)) return { ...entity, ...fit };
                const angle = normalizeAngle(angleOf(entity.center, p));
                return { ...entity, [grip.type]: angle };
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
                const linePoint = { x: p.x, y: p.y };
                if (!entity.textPosition || !entity.linePoint) return { ...entity, linePoint };
                // Texto com posição gravada (cota de DWG/DXF) acompanha a linha de cota, como no BricsCAD:
                // em cota linear só o afastamento da linha; nas demais, o deslocamento inteiro.
                const delta = sub(linePoint, entity.linePoint);
                const normal = dimensionLineNormal(entity);
                const shift = normal ? scale(normal, delta.x * normal.x + delta.y * normal.y) : delta;
                return { ...entity, linePoint, textPosition: add(entity.textPosition, shift) };
            }
            if (grip.type === 'textPosition') {
                // Como no BricsCAD: o texto arrasta a linha de cota e as setas junto; ao longo da linha só o texto desliza.
                const textPosition = { x: p.x, y: p.y };
                if (!entity.linePoint || !entity.textPosition) return { ...entity, textPosition };
                const delta = sub(textPosition, entity.textPosition);
                const normal = dimensionLineNormal(entity);
                const shift = normal ? scale(normal, delta.x * normal.x + delta.y * normal.y) : delta;
                return { ...entity, textPosition, linePoint: add(entity.linePoint, shift) };
            }
            if (grip.type === 'textAlong') {
                // O número acompanha a alça; afastar da linha leva a linha de cota junto.
                const textPosition = add(p, scale(grip.normal, grip.lift));
                const delta = sub(p, grip.point);
                const normal = dimensionLineNormal(entity);
                const shift = normal ? scale(normal, delta.x * normal.x + delta.y * normal.y) : { x: 0, y: 0 };
                return { ...entity, textPosition, linePoint: add(entity.linePoint, shift) };
            }
            if (grip.type === 'arrow') {
                // Puxar a seta para fora da linha de chamada põe as setas por fora; para dentro, por dentro.
                if (distance(p, grip.point) < 1e-9) return entity;
                const { d1, d2, lineDir } = linearDimensionEnds(entity);
                const len = dot(sub(d2, d1), lineDir);
                const t = dot(sub(p, d1), lineDir);
                const outside = grip.index === 0 ? t < 0 : t > len;
                return { ...entity, arrowPlacement: outside ? 'outside' : 'inside' };
            }
            if (grip.type === 'p1' || grip.type === 'p2') {
                return restretchLinearDimension(entity, { ...entity, [grip.type]: { x: p.x, y: p.y } }, dimStyle);
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
