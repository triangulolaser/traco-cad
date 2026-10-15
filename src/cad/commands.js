import { usage } from '../usage-telemetry.js';
import {openPrintDialog} from './print.js';
import { openWblockDialog, confirmOverwrite } from './wblock-dialog.js';
import {BLOCK_COMMANDS} from './block-commands.js';
import {expandInsert} from './blocks.js';
import { EDIT_COMMANDS } from './edit-commands.js';
import { PT_ALIASES, normalizeCommandName } from './pt-aliases.js';
// Comandos do CAD. Cada comando é uma função assíncrona que conversa com o editor
// por meio de prompts (getPoint, getSelection, getNumber...). Cancelamento com Esc
// lança CancelError e é tratado pelo editor.

import {
    distance,
    angleOf,
    polar,
    sub,
    add,
    normalize,
    perpendicular,
    scale,
    cross,
    dot,
    radToDeg,
    degToRad,
    arcFromThreePoints,
    circleFromThreePoints,
    arcFromStartCenterEnd,
    arcFromStartCenterAngle,
    arcFromStartCenterChord,
    arcFromStartEndAngle,
    arcFromStartEndDirection,
    arcFromStartEndRadius,
    circleFromTangentsAndRadius,
    midpoint,
    translateEntity,
    transformEntity,
    rotatePoint,
    rotateEntity,
    mirrorEntity,
    scaleEntity,
    offsetEntity,
    entityCurves,
    intersectCurves,
    splitEntityAt,
    closestPointOnCurve,
    entityBox,
    boxAddPoint,
    emptyBox,
    boxIsEmpty,
    projectOnLine,
    intersectLines,
    normalizeAngle,
    sweepCCW,
    formatNumber,
    entityLength,
    polylineCurves,
    bulgeToArc,
    curveMidpoint,
    pointInBox,
    curveIntersectsBox,
    joinCurves,
    joinCurveGroups,
} from './geometry.js';
import { addEntities, removeEntities, replaceEntities, updateEntities, editableEntities, setCurrentLayer, updateLayer, layerOf, createDocument, documentStats, hexToAci, aciToHex, BYLAYER } from './document.js';
import { parseDxf, writeDxf } from './dxf.js';
import { chooseLinearKind, autoDimensionFor, dimensionGeometry, DIMENSION_LAYER, ensureDimensionSetup, computeAutoDimScale, getDrawingContentBox } from './dimensions.js';
import { interpolateSpline, sampleSpline } from './splines.js';
import { ellipsePoint, imageLocalPoint, ensureSplineGeometry } from './extra-entities.js';
import { autoDimensionPart } from './autodim.js';
import { loopsFromEntities, HATCH_PATTERNS } from './hatch.js';
import { DRAWING_ACCEPT, DRAWING_KINDS, IMAGE_ACCEPT, kindOf } from './file-types.js';
import { createRectangleEntity, polylineFillet, createRevcloudFromEntity, distanceToEntity, polygonAreaAndPerimeter, polylineArea, getEntityAreaAndPerimeter, pointInPolygon } from './edit-tools.js';

export class CancelError extends Error {
    constructor() {
        super('cancelado');
        this.name = 'CancelError';
    }
}

const fmt = (n) => formatNumber(n, 4);
const fmtPoint = (p) => `${fmt(p.x)},${fmt(p.y)}`;

function boxOf(entities) {
    const box = emptyBox();
    entities.forEach((e) => {
        const b = entityBox(e);
        if (!boxIsEmpty(b)) {
            boxAddPoint(box, { x: b.minX, y: b.minY });
            boxAddPoint(box, { x: b.maxX, y: b.maxY });
        }
    });
    return box;
}

// ---------------------------------------------------------------------------
// Desenho

async function pointCommand(editor) {
    let count = 0;
    for (;;) {
        const res = await editor.getPoint(count === 0 ? 'Ponto:' : 'Próximo ponto:', {
            allowEnter: true,
            preview: (cursor) => [{ type: 'point', position: cursor, layer: editor.doc.currentLayer }],
        });
        if (!res || res.enter || !res.point) break;
        editor.commit('Ponto', addEntities(editor.doc, [{ type: 'point', position: res.point, layer: editor.doc.currentLayer }]));
        count += 1;
    }
    if (count > 0) editor.log(`${count} ponto(s) criado(s).`);
}

async function donut(editor) {
    editor.memory = editor.memory ?? {};
    const insideDefault = editor.memory.donutInside ?? 10.0;
    const insideRes = await editor.getNumber('Especifique o diâmetro interno do anel', {
        defaultValue: insideDefault,
        min: 0,
    });
    if (insideRes === undefined || insideRes === null) return;
    const insideDiam = Math.max(0, insideRes);
    editor.memory.donutInside = insideDiam;

    let outsideDefault = editor.memory.donutOutside ?? 20.0;
    if (outsideDefault <= insideDiam) {
        outsideDefault = insideDiam > 0 ? insideDiam * 2 : 10.0;
    }
    const outsideRes = await editor.getNumber('Especifique o diâmetro externo do anel', {
        defaultValue: outsideDefault,
        min: insideDiam + 1e-4,
    });
    if (outsideRes === undefined || outsideRes === null) return;
    const outsideDiam = outsideRes;
    if (outsideDiam <= insideDiam) {
        return editor.log('O diâmetro externo deve ser maior que o diâmetro interno.', 'error');
    }
    editor.memory.donutOutside = outsideDiam;

    const rMean = (insideDiam + outsideDiam) / 4;
    const width = (outsideDiam - insideDiam) / 2;

    const makeDonut = (center) => ({
        type: 'polyline',
        vertices: [
            { x: center.x - rMean, y: center.y, bulge: 1 },
            { x: center.x + rMean, y: center.y, bulge: 1 },
        ],
        closed: true,
        constantWidth: width,
        layer: editor.doc.currentLayer,
    });

    let count = 0;
    for (;;) {
        const res = await editor.getPoint(count === 0 ? 'Centro do anel:' : 'Próximo centro do anel:', {
            allowEnter: true,
            preview: (cursor) => [makeDonut(cursor)],
        });
        if (!res || res.enter || !res.point) break;
        editor.commit('Anel', addEntities(editor.doc, [makeDonut(res.point)]));
        count += 1;
    }
    if (count > 0) editor.log(`${count} anel(éis) criado(s).`);
}

// Ponto final da linha com comprimento e/ou ângulo (graus) travados pela entrada dinâmica.
export function lineDynamicInput(from, cursor, locked = {}, offset = 8) {
    const free = distance(from, cursor);
    const cursorAngle = free > 1e-12 ? Math.atan2(cursor.y - from.y, cursor.x - from.x) : 0;
    const length = Number.isFinite(locked.len) && locked.len > 0 ? locked.len : free;
    const angle = Number.isFinite(locked.ang) ? degToRad(locked.ang) : cursorAngle;
    const end = { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
    const n = { x: -Math.sin(angle), y: Math.cos(angle) };
    const mid = { x: (from.x + end.x) / 2 + n.x * offset, y: (from.y + end.y) / 2 + n.y * offset };
    let deg = (radToDeg(angle) % 360 + 360) % 360;
    if (deg > 359.995) deg = 0;
    const ext = (p) => ({ type: 'line', start: p, end: { x: p.x + n.x * offset * 1.25, y: p.y + n.y * offset * 1.25 } });
    const guides = length > 0 ? [
        { type: 'line', start: { x: from.x + n.x * offset, y: from.y + n.y * offset }, end: { x: end.x + n.x * offset, y: end.y + n.y * offset } },
        ext(from),
        ext(end),
        { type: 'line', start: from, end: { x: from.x + offset * 2, y: from.y } },
    ] : [];
    const angAnchor = { x: from.x + Math.cos(angle / 2) * offset * 2.6, y: from.y + Math.sin(angle / 2) * offset * 2.6 };
    return { end, values: { len: length, ang: deg }, anchors: { len: mid, ang: angAnchor }, guides: guides.map(asDimGuide) };
}

// Ponto na circunferência com raio (ou diâmetro, scale=0.5) travado; a direção segue o cursor.
export function circleDynamicInput(center, cursor, locked = {}, key = 'r', scale = 1) {
    const free = distance(center, cursor);
    const angle = free > 1e-12 ? Math.atan2(cursor.y - center.y, cursor.x - center.x) : 0;
    const typed = locked[key];
    const radius = Number.isFinite(typed) && typed > 0 ? typed * scale : free;
    const edge = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    // Cota do raio (centro → borda) ou do diâmetro (borda → borda oposta).
    const from = scale < 1 ? { x: 2 * center.x - edge.x, y: 2 * center.y - edge.y } : center;
    const guides = radius > 0 ? [asDimGuide({ type: 'line', start: from, end: edge })] : [];
    return { edge, radius, values: { [key]: radius / scale }, anchors: { [key]: { x: (center.x + edge.x) / 2, y: (center.y + edge.y) / 2 } }, guides };
}

// Linhas da cota provisória da entrada dinâmica: o renderer pinta com theme.dimGuide
// (vermelho apagado), separadas do traço que está sendo desenhado.
function asDimGuide(entity) {
    return { ...entity, dimGuide: true };
}

// Cota automática dos comandos de desenho (COMMANDS[x].dimInput) para prompts de ponto com
// referência que não trazem dynInput próprio. Prompt numérico vira um campo com a distância
// até a referência e devolve { number }, preservando o significado do número em cada comando
// (raio, diâmetro, corda); prompt de ponto vira comprimento + ângulo, como no LINE.
// Prompts de ângulo ficam só com o terminal: o número ali não é distância.
export function autoDimSpec(editor, pending) {
    const ref = pending?.reference;
    if (!ref || pending.mode !== 'point' || pending.dynInput === false) return null;
    if (!pending.allowNumber) return lineDynSpec(editor, ref);
    if (/[aâ]ngulo/i.test(pending.prompt)) return null;
    const label = /di[aâ]metro/i.test(pending.prompt) ? 'Diâmetro' : /raio|ap[oó]tema/i.test(pending.prompt) ? 'Raio' : 'Distância';
    const spec = {
        fields: [{ key: 'v', label }],
        locked: {},
        commitNumber: true,
        calc: (cursor) => circleDynamicInput(ref, cursor, spec.locked, 'v', 1),
        values: (cursor) => spec.calc(cursor).values,
        anchors: (cursor) => spec.calc(cursor).anchors,
        resolve: (cursor) => spec.calc(cursor).edge,
        guides: (cursor) => spec.calc(cursor).guides,
    };
    return spec;
}

function lineDynSpec(editor, from) {
    const spec = {
        fields: [{ key: 'len', label: 'Comprimento' }, { key: 'ang', label: 'Ângulo' }],
        locked: {},
        calc: (cursor) => lineDynamicInput(from, cursor, spec.locked, editor.viewport.pixelsToWorld(22)),
        values: (cursor) => spec.calc(cursor).values,
        anchors: (cursor) => spec.calc(cursor).anchors,
        resolve: (cursor) => spec.calc(cursor).end,
        guides: (cursor) => spec.calc(cursor).guides,
    };
    // Ângulo travado não pode ser só "> 0": 0° é válido.
    spec.accepts = (key, n) => (key === 'ang' ? Number.isFinite(n) : n > 0);
    return spec;
}

function circleDynSpec(center, key, label, scale) {
    const spec = {
        fields: [{ key, label }],
        locked: {},
        calc: (cursor) => circleDynamicInput(center, cursor, spec.locked, key, scale),
        values: (cursor) => spec.calc(cursor).values,
        anchors: (cursor) => spec.calc(cursor).anchors,
        resolve: (cursor) => spec.calc(cursor).edge,
        guides: (cursor) => spec.calc(cursor).guides,
    };
    return spec;
}

async function line(editor) {
    let first = await editor.getPoint('Primeiro ponto da linha:');
    if (!first.point) return;
    let last = first.point;
    let count = 0;
    let start = first.point;
    for (;;) {
        const options = count >= 2 ? [{ key: 'c', label: 'Fechar' }, { key: 'u', label: 'Desfazer' }] : count >= 1 ? [{ key: 'u', label: 'Desfazer' }] : [];
        const dynInput = lineDynSpec(editor, last);
        const res = await editor.getPoint('Próximo ponto', {
            options,
            reference: last,
            allowEnter: true,
            dynInput,
            preview: (cursor) => {
                const dyn = dynInput.calc(cursor);
                return [{ type: 'line', start: last, end: dyn.end }];
            },
        });
        if (res.enter) break;
        if (res.keyword === 'c') {
            editor.commit('Linha', addEntities(editor.doc, [{ type: 'line', start: last, end: start }]));
            break;
        }
        if (res.keyword === 'u') {
            if (count === 0) continue;
            const removed = editor.doc.entities[editor.doc.entities.length - 1];
            editor.commit('Desfazer segmento', removeEntities(editor.doc, [removed.id]));
            last = removed.start;
            count -= 1;
            continue;
        }
        if (!res.point) continue;
        editor.commit('Linha', addEntities(editor.doc, [{ type: 'line', start: last, end: res.point }]));
        last = res.point;
        count += 1;
    }
}

async function circle(editor, args = []) {
    const rawMode = Array.isArray(args) ? args[0] : args;
    const mode = String(rawMode || '').toLowerCase();

    // 1. 3 Pontos (3P)
    if (mode === '3p') {
        const p1 = await editor.getPoint('Primeiro ponto do círculo:');
        if (!p1 || !p1.point) return;
        const p2 = await editor.getPoint('Segundo ponto do círculo:', { reference: p1.point });
        if (!p2 || !p2.point) return;
        const p3 = await editor.getPoint('Terceiro ponto do círculo:', {
            reference: p2.point,
            preview: (cursor) => {
                const c = circleFromThreePoints(p1.point, p2.point, cursor);
                return c ? [{ type: 'circle', ...c }] : [];
            },
        });
        if (!p3 || !p3.point) return;
        const c = circleFromThreePoints(p1.point, p2.point, p3.point);
        if (!c) return editor.log('Pontos colineares; círculo não definido.', 'error');
        return editor.commit('Círculo', addEntities(editor.doc, [{ type: 'circle', ...c }]));
    }

    // 2. 2 Pontos (2P)
    if (mode === '2p') {
        const p1 = await editor.getPoint('Primeira extremidade do diâmetro:');
        if (!p1 || !p1.point) return;
        const p2 = await editor.getPoint('Segunda extremidade do diâmetro:', {
            reference: p1.point,
            preview: (cursor) => [{ type: 'circle', center: midpoint(p1.point, cursor), radius: distance(p1.point, cursor) / 2 }],
        });
        if (!p2 || !p2.point) return;
        const radius = distance(p1.point, p2.point) / 2;
        if (radius <= 0) return editor.log('Raio nulo.', 'error');
        return editor.commit('Círculo', addEntities(editor.doc, [{ type: 'circle', center: midpoint(p1.point, p2.point), radius }]));
    }

    // 3. Tangente, Tangente, Raio (TTR)
    if (mode === 'ttr') {
        const first = await editor.getEntity('Selecione o primeiro objeto para a tangente:', { filter: (e) => e.type === 'line' });
        if (!first) return;
        const second = await editor.getEntity('Selecione o segundo objeto para a tangente:', { filter: (e) => e.type === 'line' && e.id !== first.entity.id });
        if (!second) return;

        const rRes = await editor.getPoint('Especifique o raio do círculo:', {
            allowNumber: true,
            defaultValue: editor.memory.radius,
            preview: (cursor) => {
                const r = distance(second.point, cursor);
                const c = circleFromTangentsAndRadius(first.entity, first.point, second.entity, second.point, r);
                return c ? [{ type: 'circle', ...c }] : [];
            },
        });
        if (!rRes) return;
        const radius = rRes.number !== undefined ? rRes.number : distance(second.point, rRes.point);
        if (!(radius > 0)) return editor.log('Raio inválido.', 'error');

        const c = circleFromTangentsAndRadius(first.entity, first.point, second.entity, second.point, radius);
        if (!c) return editor.log('Círculo não existe com este raio e tangentes.', 'error');
        editor.memory.radius = radius;
        return editor.commit('Círculo', addEntities(editor.doc, [{ type: 'circle', ...c }]));
    }

    // 4. Centro, Diâmetro (CD)
    if (mode === 'cd') {
        const centerRes = await editor.getPoint('Centro do círculo:');
        if (!centerRes || !centerRes.point) return;
        const center = centerRes.point;
        const dRes = await editor.getPoint('Diâmetro do círculo:', {
            reference: center,
            allowNumber: true,
            preview: (cursor) => [{ type: 'circle', center, radius: distance(center, cursor) / 2 }],
        });
        if (!dRes || (!dRes.point && dRes.number === undefined)) return;
        const diam = dRes.number !== undefined ? dRes.number : distance(center, dRes.point);
        const radius = diam / 2;
        if (!(radius > 0)) return editor.log('Diâmetro inválido.', 'error');
        editor.memory.radius = radius;
        return editor.commit('Círculo', addEntities(editor.doc, [{ type: 'circle', center, radius }]));
    }

    // 5. Centro, Raio (CR) ou Padrão Interativo
    if (mode === 'cr') {
        const centerRes = await editor.getPoint('Centro do círculo:');
        if (!centerRes || !centerRes.point) return;
        const center = centerRes.point;
        const rRes = await editor.getPoint('Raio do círculo:', {
            reference: center,
            allowNumber: true,
            defaultValue: editor.memory.radius,
            preview: (cursor) => [{ type: 'circle', center, radius: distance(center, cursor) }],
        });
        if (!rRes || (!rRes.point && rRes.number === undefined)) return;
        const radius = rRes.number !== undefined ? rRes.number : distance(center, rRes.point);
        if (!(radius > 0)) return editor.log('Raio inválido.', 'error');
        editor.memory.radius = radius;
        return editor.commit('Círculo', addEntities(editor.doc, [{ type: 'circle', center, radius }]));
    }

    // Modo interativo aberto (prompt com opções 3P / 2P / Ttr)
    const centerRes = await editor.getPoint('Centro do círculo', {
        options: [
            { key: '3p', label: '3P' },
            { key: '2p', label: '2P' },
            { key: 'ttr', label: 'Ttr' },
        ],
    });
    if (!centerRes) return;
    if (centerRes.keyword === '3p') return circle(editor, '3p');
    if (centerRes.keyword === '2p') return circle(editor, '2p');
    if (centerRes.keyword === 'ttr') return circle(editor, 'ttr');
    if (!centerRes.point) return;

    const center = centerRes.point;
    const radiusDyn = circleDynSpec(center, 'r', 'Raio', 1);
    const res = await editor.getPoint('Raio do círculo', {
        options: [{ key: 'd', label: 'Diâmetro' }],
        reference: center,
        allowNumber: true,
        defaultValue: editor.memory.radius,
        dynInput: radiusDyn,
        preview: (cursor) => {
            const dyn = radiusDyn.calc(cursor);
            return [{ type: 'circle', center, radius: dyn.radius }];
        },
    });
    if (!res || (!res.point && res.number === undefined && !res.keyword)) return;
    let radius;
    if (res.keyword === 'd') {
        const diamDyn = circleDynSpec(center, 'd', 'Diâmetro', 0.5);
        const d = await editor.getPoint('Diâmetro do círculo', {
            reference: center,
            allowNumber: true,
            dynInput: diamDyn,
            preview: (cursor) => {
                const dyn = diamDyn.calc(cursor);
                return [{ type: 'circle', center, radius: dyn.radius }];
            },
        });
        if (!d || (!d.point && d.number === undefined)) return;
        radius = d.number !== undefined ? d.number / 2 : distance(center, d.point);
    } else {
        radius = res.number !== undefined ? res.number : distance(center, res.point);
    }
    if (!(radius > 0)) return editor.log('Raio inválido.', 'error');
    editor.memory.radius = radius;
    return editor.commit('Círculo', addEntities(editor.doc, [{ type: 'circle', center, radius }]));
}

async function arc(editor, args = []) {
    const rawMode = Array.isArray(args) ? args[0] : args;
    const mode = String(rawMode || '').toLowerCase();

    // 1. Iniciar, Centro, Fim (SCE)
    if (mode === 'sce') {
        const startRes = await editor.getPoint('Ponto inicial do arco:');
        if (!startRes || !startRes.point) return;
        const centerRes = await editor.getPoint('Centro do arco:', {
            reference: startRes.point,
            preview: (cursor) => [{ type: 'line', start: startRes.point, end: cursor }],
        });
        if (!centerRes || !centerRes.point) return;
        const endRes = await editor.getPoint('Ponto final do arco:', {
            reference: centerRes.point,
            preview: (cursor) => {
                const a = arcFromStartCenterEnd(startRes.point, centerRes.point, cursor);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!endRes || !endRes.point) return;
        const a = arcFromStartCenterEnd(startRes.point, centerRes.point, endRes.point);
        if (!a) return editor.log('Arco inválido.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 2. Início, Centro, Ângulo (SCA)
    if (mode === 'sca') {
        const startRes = await editor.getPoint('Ponto inicial do arco:');
        if (!startRes || !startRes.point) return;
        const centerRes = await editor.getPoint('Centro do arco:', {
            reference: startRes.point,
            preview: (cursor) => [{ type: 'line', start: startRes.point, end: cursor }],
        });
        if (!centerRes || !centerRes.point) return;
        const startAngle = angleOf(centerRes.point, startRes.point);
        const angRes = await editor.getPoint('Ângulo incluído (graus ou clique):', {
            reference: centerRes.point,
            allowNumber: true,
            preview: (cursor) => {
                const curAng = angleOf(centerRes.point, cursor);
                let diff = curAng - startAngle;
                while (diff < 0) diff += 2 * Math.PI;
                const a = arcFromStartCenterAngle(startRes.point, centerRes.point, diff);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!angRes || (!angRes.point && angRes.number === undefined)) return;
        const angleRad = angRes.number !== undefined ? degToRad(angRes.number) : normalizeAngle(angleOf(centerRes.point, angRes.point) - startAngle);
        const a = arcFromStartCenterAngle(startRes.point, centerRes.point, angleRad);
        if (!a) return editor.log('Arco inválido.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 3. Início, Centro, Comprimento (SCL)
    if (mode === 'scl') {
        const startRes = await editor.getPoint('Ponto inicial do arco:');
        if (!startRes || !startRes.point) return;
        const centerRes = await editor.getPoint('Centro do arco:', {
            reference: startRes.point,
            preview: (cursor) => [{ type: 'line', start: startRes.point, end: cursor }],
        });
        if (!centerRes || !centerRes.point) return;
        const chordRes = await editor.getPoint('Comprimento da corda:', {
            reference: startRes.point,
            allowNumber: true,
            preview: (cursor) => {
                const chord = distance(startRes.point, cursor);
                const a = arcFromStartCenterChord(startRes.point, centerRes.point, chord);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!chordRes || (!chordRes.point && chordRes.number === undefined)) return;
        const chord = chordRes.number !== undefined ? chordRes.number : distance(startRes.point, chordRes.point);
        const a = arcFromStartCenterChord(startRes.point, centerRes.point, chord);
        if (!a) return editor.log('Comprimento da corda maior que o diâmetro do arco.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 4. Início, Fim, Ângulo (SEA)
    if (mode === 'sea') {
        const startRes = await editor.getPoint('Ponto inicial do arco:');
        if (!startRes || !startRes.point) return;
        const endRes = await editor.getPoint('Ponto final do arco:', {
            reference: startRes.point,
            preview: (cursor) => [{ type: 'line', start: startRes.point, end: cursor }],
        });
        if (!endRes || !endRes.point) return;
        const angRes = await editor.getPoint('Ângulo incluído (graus):', {
            allowNumber: true,
            preview: (cursor) => {
                const a = arcFromStartEndAngle(startRes.point, endRes.point, Math.PI / 2);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!angRes || (!angRes.point && angRes.number === undefined)) return;
        const angleRad = angRes.number !== undefined ? degToRad(angRes.number) : Math.PI / 2;
        const a = arcFromStartEndAngle(startRes.point, endRes.point, angleRad);
        if (!a) return editor.log('Ângulo inválido para arco.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 5. Início, Fim, Direção (SED)
    if (mode === 'sed') {
        const startRes = await editor.getPoint('Ponto inicial do arco:');
        if (!startRes || !startRes.point) return;
        const endRes = await editor.getPoint('Ponto final do arco:', {
            reference: startRes.point,
            preview: (cursor) => [{ type: 'line', start: startRes.point, end: cursor }],
        });
        if (!endRes || !endRes.point) return;
        const dirRes = await editor.getPoint('Direção da tangente inicial:', {
            reference: startRes.point,
            preview: (cursor) => {
                const a = arcFromStartEndDirection(startRes.point, endRes.point, cursor);
                return a ? [{ type: 'arc', ...a }, { type: 'line', start: startRes.point, end: cursor }] : [];
            },
        });
        if (!dirRes || !dirRes.point) return;
        const a = arcFromStartEndDirection(startRes.point, endRes.point, dirRes.point);
        if (!a) return editor.log('Direção paralela à corda ou inválida.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 6. Início, Fim, Raio (SER)
    if (mode === 'ser') {
        const startRes = await editor.getPoint('Ponto inicial do arco:');
        if (!startRes || !startRes.point) return;
        const endRes = await editor.getPoint('Ponto final do arco:', {
            reference: startRes.point,
            preview: (cursor) => [{ type: 'line', start: startRes.point, end: cursor }],
        });
        if (!endRes || !endRes.point) return;
        const chord = distance(startRes.point, endRes.point);
        const rRes = await editor.getPoint('Raio do arco:', {
            reference: endRes.point,
            allowNumber: true,
            defaultValue: chord / 2,
            preview: (cursor) => {
                const r = distance(endRes.point, cursor);
                const a = arcFromStartEndRadius(startRes.point, endRes.point, r);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!rRes || (!rRes.point && rRes.number === undefined)) return;
        const radius = rRes.number !== undefined ? rRes.number : distance(endRes.point, rRes.point);
        const a = arcFromStartEndRadius(startRes.point, endRes.point, radius);
        if (!a) return editor.log('Raio menor que a meia-corda do arco.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 7. Centro, Início, Fim (CSE)
    if (mode === 'cse') {
        const centerRes = await editor.getPoint('Centro do arco:');
        if (!centerRes || !centerRes.point) return;
        const startRes = await editor.getPoint('Ponto inicial do arco:', {
            reference: centerRes.point,
            preview: (cursor) => [{ type: 'line', start: centerRes.point, end: cursor }],
        });
        if (!startRes || !startRes.point) return;
        const endRes = await editor.getPoint('Ponto final do arco:', {
            reference: centerRes.point,
            preview: (cursor) => {
                const a = arcFromStartCenterEnd(startRes.point, centerRes.point, cursor);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!endRes || !endRes.point) return;
        const a = arcFromStartCenterEnd(startRes.point, centerRes.point, endRes.point);
        if (!a) return editor.log('Arco inválido.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 8. Centro, Início, Ângulo (CSA)
    if (mode === 'csa') {
        const centerRes = await editor.getPoint('Centro do arco:');
        if (!centerRes || !centerRes.point) return;
        const startRes = await editor.getPoint('Ponto inicial do arco:', {
            reference: centerRes.point,
            preview: (cursor) => [{ type: 'line', start: centerRes.point, end: cursor }],
        });
        if (!startRes || !startRes.point) return;
        const startAngle = angleOf(centerRes.point, startRes.point);
        const angRes = await editor.getPoint('Ângulo incluído (graus ou clique):', {
            reference: centerRes.point,
            allowNumber: true,
            preview: (cursor) => {
                const curAng = angleOf(centerRes.point, cursor);
                let diff = curAng - startAngle;
                while (diff < 0) diff += 2 * Math.PI;
                const a = arcFromStartCenterAngle(startRes.point, centerRes.point, diff);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!angRes || (!angRes.point && angRes.number === undefined)) return;
        const angleRad = angRes.number !== undefined ? degToRad(angRes.number) : normalizeAngle(angleOf(centerRes.point, angRes.point) - startAngle);
        const a = arcFromStartCenterAngle(startRes.point, centerRes.point, angleRad);
        if (!a) return editor.log('Arco inválido.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 9. Centro, Início, Comprimento (CSL)
    if (mode === 'csl') {
        const centerRes = await editor.getPoint('Centro do arco:');
        if (!centerRes || !centerRes.point) return;
        const startRes = await editor.getPoint('Ponto inicial do arco:', {
            reference: centerRes.point,
            preview: (cursor) => [{ type: 'line', start: centerRes.point, end: cursor }],
        });
        if (!startRes || !startRes.point) return;
        const chordRes = await editor.getPoint('Comprimento da corda:', {
            reference: startRes.point,
            allowNumber: true,
            preview: (cursor) => {
                const chord = distance(startRes.point, cursor);
                const a = arcFromStartCenterChord(startRes.point, centerRes.point, chord);
                return a ? [{ type: 'arc', ...a }] : [];
            },
        });
        if (!chordRes || (!chordRes.point && chordRes.number === undefined)) return;
        const chord = chordRes.number !== undefined ? chordRes.number : distance(startRes.point, chordRes.point);
        const a = arcFromStartCenterChord(startRes.point, centerRes.point, chord);
        if (!a) return editor.log('Comprimento da corda maior que o diâmetro do arco.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // 10. 3 Pontos (Início, Fim, Passagem)
    if (mode === '3p') {
        const p1 = await editor.getPoint('Ponto inicial do arco:');
        if (!p1 || !p1.point) return;
        const p2 = await editor.getPoint('Ponto final do arco:', {
            reference: p1.point,
            preview: (cursor) => [{ type: 'line', start: p1.point, end: cursor }],
        });
        if (!p2 || !p2.point) return;
        const p3 = await editor.getPoint('Ponto onde o arco vai passar:', {
            reference: p2.point,
            preview: (cursor) => {
                const a = arcFromThreePoints(p1.point, cursor, p2.point);
                return a ? [{ type: 'arc', ...a }] : [{ type: 'line', start: p1.point, end: p2.point }, { type: 'line', start: p2.point, end: cursor }];
            },
        });
        if (!p3 || !p3.point) return;
        const a = arcFromThreePoints(p1.point, p3.point, p2.point);
        if (!a) return editor.log('Pontos colineares; arco não definido.', 'error');
        return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
    }

    // Modo padrão interativo (1 - Ponto inicial, 2 - Ponto final, 3 - Ponto onde o arco vai passar)
    const first = await editor.getPoint('Ponto inicial do arco:', { options: [{ key: 'c', label: 'Centro' }] });
    if (!first) return;
    if (first.keyword === 'c') {
        return arc(editor, 'cse');
    }
    if (!first.point) return null;
    const second = await editor.getPoint('Ponto final do arco:', {
        reference: first.point,
        preview: (cursor) => [{ type: 'line', start: first.point, end: cursor }],
    });
    if (!second || !second.point) return;
    const third = await editor.getPoint('Ponto onde o arco vai passar:', {
        reference: second.point,
        preview: (cursor) => {
            const a = arcFromThreePoints(first.point, cursor, second.point);
            return a ? [{ type: 'arc', ...a }] : [{ type: 'line', start: first.point, end: second.point }, { type: 'line', start: second.point, end: cursor }];
        },
    });
    if (!third || !third.point) return;
    const a = arcFromThreePoints(first.point, third.point, second.point);
    if (!a) return editor.log('Pontos colineares; arco não definido.', 'error');
    return editor.commit('Arco', addEntities(editor.doc, [{ type: 'arc', ...a }]));
}

async function polyline(editor) {
    const first = await editor.getPoint('Ponto inicial da polilinha:');
    if (!first.point) return;
    const vertices = [{ ...first.point, bulge: 0 }];
    let arcMode = false;
    let committedId = null;
    const commitPoly = (closed = false) => {
        const entity = { type: 'polyline', vertices: vertices.map((v) => ({ ...v })), closed };
        if (committedId) {
            editor.commit('Polilinha', replaceEntities(editor.doc, new Map([[committedId, { ...entity, id: committedId }]])));
        } else {
            const next = addEntities(editor.doc, [entity]);
            committedId = next.entities[next.entities.length - 1].id;
            editor.commit('Polilinha', next);
        }
    };
    for (;;) {
        const last = vertices[vertices.length - 1];
        const options = [
            arcMode ? { key: 'l', label: 'Linha' } : { key: 'a', label: 'Arco' },
            ...(vertices.length >= 3 ? [{ key: 'c', label: 'Fechar' }] : []),
            ...(vertices.length >= 2 ? [{ key: 'u', label: 'Desfazer' }] : []),
        ];
        const res = await editor.getPoint(arcMode ? 'Ponto final do arco' : 'Próximo ponto', {
            options,
            reference: last,
            allowEnter: true,
            preview: (cursor) => {
                if (!arcMode) return [{ type: 'line', start: last, end: cursor }];
                const bulge = tangentBulge(vertices, cursor);
                return [{ type: 'polyline', vertices: [{ ...last, bulge }, { ...cursor, bulge: 0 }], closed: false }];
            },
        });
        if (res.enter) break;
        if (res.keyword === 'a') { arcMode = true; continue; }
        if (res.keyword === 'l') { arcMode = false; continue; }
        if (res.keyword === 'c') {
            commitPoly(true);
            return;
        }
        if (res.keyword === 'u') {
            vertices.pop();
            if (vertices.length >= 2) commitPoly(false);
            else if (committedId) {
                editor.commit('Polilinha', removeEntities(editor.doc, [committedId]));
                committedId = null;
            }
            continue;
        }
        if (!res.point) continue;
        if (arcMode) last.bulge = tangentBulge(vertices, res.point);
        vertices.push({ ...res.point, bulge: 0 });
        commitPoly(false);
    }
}

// Bulge para um arco tangente ao segmento anterior (comportamento padrão de PLINE Arc).
function tangentBulge(vertices, target) {
    const last = vertices[vertices.length - 1];
    const prev = vertices[vertices.length - 2];
    const chord = sub(target, last);
    if (distance(target, last) < 1e-9) return 0;
    let tangentDir;
    if (!prev) tangentDir = normalize(chord);
    else if (prev.bulge) {
        const arcPrev = bulgeToArc(prev, last, prev.bulge);
        const radial = normalize(sub(last, arcPrev.center));
        tangentDir = prev.bulge > 0 ? { x: -radial.y, y: radial.x } : { x: radial.y, y: -radial.x };
    } else tangentDir = normalize(sub(last, prev));
    const chordDir = normalize(chord);
    const angle = Math.atan2(cross(tangentDir, chordDir), dot(tangentDir, chordDir));
    // Ângulo entre tangente e corda = metade do ângulo central; bulge = tan(θ/4) = tan(angle/2).
    const bulge = Math.tan(angle / 2);
    return Math.abs(bulge) < 1e-9 ? 0 : bulge;
}

// Canto oposto do retângulo com largura/altura travadas pela entrada dinâmica; o lado
// (quadrante) segue o cursor. Devolve também as linhas de cota do preview e a posição
// em mundo de cada campo (meio da linha de cota), no referencial girado do retângulo.
export function rectDynamicInput(a, cursor, rotationDeg = 0, locked = {}, offset = 8) {
    const rot = degToRad(rotationDeg);
    const local = rotatePoint(cursor, a, -rot);
    const sx = local.x >= a.x ? 1 : -1;
    const sy = local.y >= a.y ? 1 : -1;
    const w = Number.isFinite(locked.w) && locked.w > 0 ? locked.w : Math.abs(local.x - a.x);
    const h = Number.isFinite(locked.h) && locked.h > 0 ? locked.h : Math.abs(local.y - a.y);
    const toWorld = (x, y) => rotatePoint({ x: a.x + x, y: a.y + y }, a, rot);
    const x2 = sx * w;
    const y2 = sy * h;
    const guides = [];
    const dimLine = (p, q, normal) => {
        const shift = (pt) => ({ x: pt.x + normal.x * offset, y: pt.y + normal.y * offset });
        const ext = (pt) => ({ x: pt.x + normal.x * offset * 1.25, y: pt.y + normal.y * offset * 1.25 });
        guides.push({ type: 'line', start: toWorld(p.x, p.y), end: toWorld(ext(p).x, ext(p).y) });
        guides.push({ type: 'line', start: toWorld(q.x, q.y), end: toWorld(ext(q).x, ext(q).y) });
        guides.push({ type: 'line', start: toWorld(shift(p).x, shift(p).y), end: toWorld(shift(q).x, shift(q).y) });
        const mid = shift({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        return toWorld(mid.x, mid.y);
    };
    // Largura na base (lado do primeiro canto, para fora); altura no lado do cursor.
    const wAnchor = dimLine({ x: 0, y: 0 }, { x: x2, y: 0 }, { x: 0, y: -sy });
    const hAnchor = dimLine({ x: x2, y: 0 }, { x: x2, y: y2 }, { x: sx, y: 0 });
    return {
        corner: toWorld(x2, y2),
        values: { w, h },
        anchors: { w: wAnchor, h: hAnchor },
        guides: w > 0 && h > 0 ? guides.map(asDimGuide) : [],
    };
}

async function rectangle(editor) {
    editor.memory = editor.memory ?? {};
    let filletRadius = editor.memory.rectFillet ?? 0;
    let chamferD1 = editor.memory.rectChamfer1 ?? 0;
    let chamferD2 = editor.memory.rectChamfer2 ?? 0;
    let polyWidth = editor.memory.rectWidth ?? 0;
    let rotationDeg = editor.memory.rectRotation ?? 0;

    let firstPoint = null;

    // Prompt 1: Primeiro canto ou opções [Filete/Chanfro/Largura/Rotação]
    for (;;) {
        const options = [
            { key: 'f', label: 'Filete' },
            { key: 'c', label: 'Chanfro' },
            { key: 'w', label: 'Largura' },
            { key: 'r', label: 'Rotação' },
        ];
        const res = await editor.getPoint('Primeiro canto do retângulo', {
            options,
            allowEnter: false,
        });
        if (!res) return;
        if (res.keyword === 'f') {
            const r = await editor.getNumber('Raio do filete para retângulos', { defaultValue: filletRadius, min: 0 });
            if (r !== undefined && r !== null) {
                filletRadius = Math.max(0, r);
                editor.memory.rectFillet = filletRadius;
                if (filletRadius > 0) { chamferD1 = 0; chamferD2 = 0; }
            }
            continue;
        }
        if (res.keyword === 'c') {
            const d1 = await editor.getNumber('Primeira distância do chanfro', { defaultValue: chamferD1 || 5, min: 0 });
            const d2 = await editor.getNumber('Segunda distância do chanfro', { defaultValue: chamferD2 || d1 || 5, min: 0 });
            if (d1 !== undefined && d2 !== undefined) {
                chamferD1 = Math.max(0, d1);
                chamferD2 = Math.max(0, d2);
                editor.memory.rectChamfer1 = chamferD1;
                editor.memory.rectChamfer2 = chamferD2;
                if (chamferD1 > 0 || chamferD2 > 0) filletRadius = 0;
            }
            continue;
        }
        if (res.keyword === 'w') {
            const w = await editor.getNumber('Espessura de linha da polilinha para retângulos', { defaultValue: polyWidth, min: 0 });
            if (w !== undefined) {
                polyWidth = Math.max(0, w);
                editor.memory.rectWidth = polyWidth;
            }
            continue;
        }
        if (res.keyword === 'r') {
            const rot = await editor.getNumber('Ângulo de rotação para retângulos', { defaultValue: rotationDeg });
            if (rot !== undefined) {
                rotationDeg = rot;
                editor.memory.rectRotation = rotationDeg;
            }
            continue;
        }
        if (res.point) {
            firstPoint = res.point;
            break;
        }
    }

    if (!firstPoint) return;
    const a = firstPoint;

    const buildRect = (pOpposite, rot = rotationDeg) => {
        return createRectangleEntity(a, pOpposite, {
            fillet: filletRadius,
            chamfer1: chamferD1,
            chamfer2: chamferD2,
            width: polyWidth,
            rotation: rot,
            layer: editor.doc.currentLayer,
        });
    };

    // Prompt 2: Canto oposto ou [Área/Dimensões/Rotação]
    for (;;) {
        const options2 = [
            { key: 'd', label: 'Dimensões' },
            { key: 'a', label: 'Área' },
            { key: 'r', label: 'Rotação' },
        ];
        // Entrada dinâmica: largura e altura digitadas junto ao cursor; Tab alterna o campo.
        const dynInput = {
            fields: [{ key: 'w', label: 'Largura' }, { key: 'h', label: 'Altura' }],
            locked: {},
            offset: () => editor.viewport.pixelsToWorld(32),
            values: (cursor) => rectDynamicInput(a, cursor, rotationDeg, dynInput.locked, dynInput.offset()).values,
            anchors: (cursor) => rectDynamicInput(a, cursor, rotationDeg, dynInput.locked, dynInput.offset()).anchors,
            resolve: (cursor) => rectDynamicInput(a, cursor, rotationDeg, dynInput.locked, dynInput.offset()).corner,
            guides: (cursor) => rectDynamicInput(a, cursor, rotationDeg, dynInput.locked, dynInput.offset()).guides,
        };
        const res2 = await editor.getPoint('Canto oposto', {
            reference: a,
            options: options2,
            allowEnter: false,
            dynInput,
            preview: (cursor) => {
                const dyn = rectDynamicInput(a, cursor, rotationDeg, dynInput.locked, dynInput.offset());
                return [buildRect(dyn.corner)];
            },
        });
        if (!res2) return;

        if (res2.keyword === 'r') {
            const rot = await editor.getNumber('Ângulo de rotação', { defaultValue: rotationDeg });
            if (rot !== undefined) {
                rotationDeg = rot;
                editor.memory.rectRotation = rotationDeg;
            }
            continue;
        }

        if (res2.keyword === 'd') {
            const length = await editor.getNumber('Comprimento do retângulo (dimensão ao longo da base)', {
                defaultValue: editor.memory.rectLength ?? 100,
                min: 1e-4,
            });
            if (!length) return;
            editor.memory.rectLength = length;

            const width = await editor.getNumber('Largura do retângulo (dimensão ortogonal à base)', {
                defaultValue: editor.memory.rectWidthDim ?? 50,
                min: 1e-4,
            });
            if (!width) return;
            editor.memory.rectWidthDim = width;

            const quadRes = await editor.getPoint('Especifique o outro canto [clique no quadrante]:', {
                reference: a,
                allowEnter: false,
                preview: (cursor) => {
                    const localCursor = rotatePoint(cursor, a, -degToRad(rotationDeg));
                    const sx = localCursor.x >= a.x ? 1 : -1;
                    const sy = localCursor.y >= a.y ? 1 : -1;
                    const localB = { x: a.x + sx * length, y: a.y + sy * width };
                    const worldB = rotatePoint(localB, a, degToRad(rotationDeg));
                    return [buildRect(worldB)];
                },
            });
            if (!quadRes?.point) return;
            const localCursor = rotatePoint(quadRes.point, a, -degToRad(rotationDeg));
            const sx = localCursor.x >= a.x ? 1 : -1;
            const sy = localCursor.y >= a.y ? 1 : -1;
            const localB = { x: a.x + sx * length, y: a.y + sy * width };
            const worldB = rotatePoint(localB, a, degToRad(rotationDeg));
            editor.commit('Retângulo', addEntities(editor.doc, [buildRect(worldB)]));
            return;
        }

        if (res2.keyword === 'a') {
            const area = await editor.getNumber('Área do retângulo', {
                defaultValue: editor.memory.rectArea ?? 1000,
                min: 1e-4,
            });
            if (!area) return;
            editor.memory.rectArea = area;

            const baseMode = await editor.getKeyword('Calcular dimensões do retângulo a partir do', [
                { key: 'c', label: 'Comprimento' },
                { key: 'l', label: 'Largura' },
            ], 'c');

            let length, width;
            if (baseMode.key === 'c') {
                length = await editor.getNumber('Informe o comprimento do retângulo', { min: 1e-4 });
                if (!length) return;
                width = area / length;
            } else {
                width = await editor.getNumber('Informe a largura do retângulo', { min: 1e-4 });
                if (!width) return;
                length = area / width;
            }

            const quadRes = await editor.getPoint('Especifique o outro canto [clique no quadrante]:', {
                reference: a,
                allowEnter: false,
                preview: (cursor) => {
                    const localCursor = rotatePoint(cursor, a, -degToRad(rotationDeg));
                    const sx = localCursor.x >= a.x ? 1 : -1;
                    const sy = localCursor.y >= a.y ? 1 : -1;
                    const localB = { x: a.x + sx * length, y: a.y + sy * width };
                    const worldB = rotatePoint(localB, a, degToRad(rotationDeg));
                    return [buildRect(worldB)];
                },
            });
            if (!quadRes?.point) return;
            const localCursor = rotatePoint(quadRes.point, a, -degToRad(rotationDeg));
            const sx = localCursor.x >= a.x ? 1 : -1;
            const sy = localCursor.y >= a.y ? 1 : -1;
            const localB = { x: a.x + sx * length, y: a.y + sy * width };
            const worldB = rotatePoint(localB, a, degToRad(rotationDeg));
            editor.commit('Retângulo', addEntities(editor.doc, [buildRect(worldB)]));
            return;
        }

        if (res2.point) {
            editor.commit('Retângulo', addEntities(editor.doc, [buildRect(res2.point)]));
            return;
        }
    }
}

function rectEntity(a, b) {
    return createRectangleEntity(a, b);
}

async function text(editor) {
    const position = (await editor.getPoint('Ponto de inserção do texto:')).point;
    const height = await editor.getNumber('Altura', { defaultValue: editor.memory.textHeight ?? 2.5, reference: position });
    const rotation = await editor.getNumber('Ângulo de rotação', { defaultValue: 0, reference: position, angle: true });
    const value = await editor.getString('Texto:');
    if (!value) return;
    editor.memory.textHeight = height;
    editor.commit('Texto', addEntities(editor.doc, [{ type: 'text', position, height, rotation, text: value }]));
}

// ---------------------------------------------------------------------------
// Edição

async function erase(editor) {
    const ids = await editor.getSelection('Selecione objetos para apagar:');
    if (ids.length === 0) return;
    editor.commit('Apagar', removeEntities(editor.doc, ids));
    editor.clearSelection();
    editor.log(`${ids.length} objeto(s) apagado(s).`);
}

async function move(editor) {
    const ids = await editor.getSelection('Selecione objetos para mover:');
    if (ids.length === 0) return;
    const entities = editor.entitiesById(ids);
    const base = (await editor.getPoint('Ponto base:')).point;
    const target = await editor.getPoint('Segundo ponto', {
        reference: base,
        preview: (cursor) => entities.map((e) => translateEntity(e, sub(cursor, base))),
        hide: ids,
    });
    if (!target.point) return;
    const delta = sub(target.point, base);
    editor.commit('Mover', updateEntities(editor.doc, ids, (e) => translateEntity(e, delta)));
}

async function copy(editor) {
    const ids = await editor.getSelection('Selecione objetos para copiar:');
    if (ids.length === 0) return;
    const entities = editor.entitiesById(ids);

    let multiple = true;
    let baseRes = await editor.getPoint('Ponto base ou [mÚltiplo]', {
        options: [{ key: 'm', label: 'mÚltiplo' }],
    });
    if (!baseRes) return;
    if (baseRes.keyword === 'm') {
        multiple = true;
        baseRes = await editor.getPoint('Ponto base:');
        if (!baseRes || !baseRes.point) return;
    }
    if (!baseRes.point) return;
    const base = baseRes.point;

    for (;;) {
        const target = await editor.getPoint('Segundo ponto ou [Array]', {
            reference: base,
            allowEnter: true,
            options: [{ key: 'a', label: 'Array' }],
            preview: (cursor) => entities.map((e) => translateEntity(e, sub(cursor, base))),
        });
        if (!target || target.enter) break;

        if (target.keyword === 'a') {
            const countNum = await editor.getNumber('Número de itens para o array', {
                defaultValue: 2,
            });
            if (!countNum || countNum < 2) {
                editor.log('O número de itens deve ser maior ou igual a 2.', 'error');
                continue;
            }
            const count = Math.round(countNum);

            const arrayTarget = await editor.getPoint('Segundo ponto ou [Ajustar]', {
                reference: base,
                allowEnter: true,
                options: [{ key: 'f', label: 'Ajustar' }],
                preview: (cursor) => {
                    const delta = sub(cursor, base);
                    const list = [];
                    for (let i = 1; i < count; i += 1) {
                        list.push(...entities.map((e) => translateEntity(e, scale(delta, i))));
                    }
                    return list;
                },
            });
            if (!arrayTarget || arrayTarget.enter) break;

            if (arrayTarget.keyword === 'f') {
                const fitTarget = await editor.getPoint('Segundo ponto (Ajustar)', {
                    reference: base,
                    allowEnter: true,
                    preview: (cursor) => {
                        const totalDelta = sub(cursor, base);
                        const step = scale(totalDelta, 1 / (count - 1));
                        const list = [];
                        for (let i = 1; i < count; i += 1) {
                            list.push(...entities.map((e) => translateEntity(e, scale(step, i))));
                        }
                        return list;
                    },
                });
                if (!fitTarget || fitTarget.enter || !fitTarget.point) break;
                const totalDelta = sub(fitTarget.point, base);
                const step = scale(totalDelta, 1 / (count - 1));
                const copies = [];
                for (let i = 1; i < count; i += 1) {
                    copies.push(...entities.map((e) => ({ ...translateEntity(e, scale(step, i)), id: undefined })));
                }
                editor.commit('Copiar', addEntities(editor.doc, copies));
            } else if (arrayTarget.point) {
                const delta = sub(arrayTarget.point, base);
                const copies = [];
                for (let i = 1; i < count; i += 1) {
                    copies.push(...entities.map((e) => ({ ...translateEntity(e, scale(delta, i)), id: undefined })));
                }
                editor.commit('Copiar', addEntities(editor.doc, copies));
            }

            if (!multiple) break;
            continue;
        }

        if (target.point) {
            const delta = sub(target.point, base);
            editor.commit('Copiar', addEntities(editor.doc, entities.map((e) => ({ ...translateEntity(e, delta), id: undefined }))));
            if (!multiple) break;
        }
    }
}

// Clipboard privado da instância do editor: compartilhado entre suas abas, sem ler clipboard do SO.
async function copyClip(editor, cut = false) {
    const ids = await editor.getSelection(cut ? 'Selecione objetos para recortar:' : 'Selecione objetos para copiar:');
    const entities = editor.entitiesById(ids).filter(e => !layerOf(editor.doc, e.layer)?.locked);
    if (!entities.length) return;
    const box = boxOf(entities);
    if (boxIsEmpty(box)) return;
    const names = new Set(entities.map(e => e.layer));
    editor.entityClipboard = structuredClone({ entities, layers: editor.doc.layers.filter(l => names.has(l.name)), base: { x: box.minX, y: box.minY }, units: editor.doc.units });
    editor.entityClipboard.systemSeq = await systemClipboardSeq();
    if (cut) {
        editor.commit('Recortar', removeEntities(editor.doc, entities.map(e => e.id)));
        editor.selection.clear();
    }
    editor.log(`${entities.length} objeto(s) ${cut ? 'recortado(s)' : 'copiado(s)'}; use Ctrl+V para inserir.`);
}

async function systemClipboardSeq() {
    try { return (await globalThis.window?.desktopBridge?.clipboardSequence?.()) ?? null; } catch { return null; }
}

// Ctrl+V vindo do SolidWorks ("Copiar para formato DWG"), BricsCAD ou AutoCAD: no Windows eles deixam o
// DWG inteiro no formato "AutoCAD.rNN". Só vale se a cópia do sistema for posterior à cópia interna.
export async function systemCadClip(editor, bridge = globalThis.window?.desktopBridge) {
    if (typeof bridge?.readCadClipboard !== 'function') return null;
    let res;
    try { res = await bridge.readCadClipboard(); } catch { return null; }
    if (!res?.bytes?.length) return null;
    if (editor.entityClipboard && editor.entityClipboard.systemSeq === res.seq) return null;
    const { dwgToDocument } = await import('./dwg.js');
    const doc = await dwgToDocument(new Uint8Array(res.bytes), { name: 'area-de-transferencia.dwg' });
    const entities = doc.entities;
    if (!entities.length) return null;
    const box = boxOf(entities);
    if (boxIsEmpty(box)) return null;
    const names = new Set(entities.map(e => e.layer));
    return { entities, layers: doc.layers.filter(l => names.has(l.name)), blocks: doc.blocks ?? {}, base: { x: box.minX, y: box.minY }, units: doc.units, source: res.format };
}

async function pasteClip(editor) {
    let clip = editor.entityClipboard;
    try {
        const external = await systemCadClip(editor);
        if (external) { clip = external; editor.log(`Colando ${external.entities.length} objeto(s) da área de transferência (${external.source}).`); }
    } catch (err) {
        editor.log(`Não foi possível ler o DWG da área de transferência: ${err.message}`, 'warn');
    }
    if (!clip?.entities.length) { editor.log('Clipboard do desenho vazio.', 'warn'); return; }
    if (clip.units !== editor.doc.units) { editor.log('As unidades dos desenhos diferem. Ajuste as unidades antes de colar.', 'warn'); return; }
    const original = editor.doc;
    const target = await editor.getPoint('Ponto de inserção', {
        reference: clip.base,
        preview: cursor => clip.entities.map(e => translateEntity(e, sub(cursor, clip.base))),
    });
    if (!target.point || editor.doc !== original) return;
    const delta = sub(target.point, clip.base);
    const layers = [...editor.doc.layers];
    for (const layer of clip.layers) if (!layers.some(l => l.name === layer.name)) layers.push(structuredClone(layer));
    if (clip.entities.some(e => layers.find(l => l.name === e.layer)?.locked)) {
        editor.log('O layer de destino está bloqueado. Desbloqueie-o antes de colar.', 'warn'); return;
    }
    const occupied = new Set(editor.doc.entities.map(e => e.id));
    const entities = clip.entities.map(e => {
        let id; do { id = `clip-${globalThis.crypto.randomUUID()}`; } while (occupied.has(id));
        occupied.add(id);
        return { ...translateEntity(structuredClone(e), delta), id };
    });
    const blocks = { ...(editor.doc.blocks ?? {}) };
    for (const [name, def] of Object.entries(clip.blocks ?? {})) if (!blocks[name]) blocks[name] = structuredClone(def);
    editor.commit('Colar', addEntities({ ...editor.doc, layers, blocks }, entities));
    editor.selection = new Set(entities.map(e => e.id));
}

async function rotate(editor) {
    const ids = await editor.getSelection('Selecione objetos para rotacionar:');
    if (ids.length === 0) return;
    const entities = editor.entitiesById(ids);
    const baseRes = await editor.getPoint('Ponto base:');
    if (!baseRes || !baseRes.point) return;
    const base = baseRes.point;

    let copyMode = false;
    let res = await editor.getPoint('Ângulo de rotação ou [Copiar/Referência]', {
        reference: base,
        allowNumber: true,
        angle: true,
        options: [
            { key: 'c', label: 'Copiar' },
            { key: 'r', label: 'Referência' },
        ],
        preview: (cursor) => entities.map((e) => rotateEntity(e, base, angleOf(base, cursor))),
        hide: ids,
    });
    if (!res) return;

    if (res.keyword === 'c') {
        copyMode = true;
        res = await editor.getPoint('Ângulo de rotação ou [Referência]', {
            reference: base,
            allowNumber: true,
            angle: true,
            options: [{ key: 'r', label: 'Referência' }],
            preview: (cursor) => entities.map((e) => rotateEntity(e, base, angleOf(base, cursor))),
        });
        if (!res) return;
    }

    let angle;
    if (res.keyword === 'r') {
        let refAngle = 0;
        const refRes = await editor.getPoint('Ângulo de referência', {
            reference: base,
            allowNumber: true,
            angle: true,
            defaultValue: 0,
        });
        if (!refRes) return;
        if (refRes.number !== undefined) {
            refAngle = degToRad(refRes.number);
        } else if (refRes.point) {
            const p2Res = await editor.getPoint('Segundo ponto do ângulo de referência:', {
                reference: refRes.point,
                preview: (cursor) => [{ type: 'line', start: refRes.point, end: cursor }],
            });
            if (!p2Res || !p2Res.point) return;
            refAngle = angleOf(refRes.point, p2Res.point);
        }

        const newRes = await editor.getPoint('Novo ângulo ou [Pontos]', {
            reference: base,
            allowNumber: true,
            angle: true,
            options: [{ key: 'p', label: 'Pontos' }],
            preview: (cursor) => entities.map((e) => rotateEntity(e, base, angleOf(base, cursor) - refAngle)),
            hide: copyMode ? [] : ids,
        });
        if (!newRes) return;
        let newAngle;
        if (newRes.keyword === 'p') {
            const p1Res = await editor.getPoint('Primeiro ponto do novo ângulo:');
            if (!p1Res || !p1Res.point) return;
            const p2Res = await editor.getPoint('Segundo ponto do novo ângulo:', {
                reference: p1Res.point,
                preview: (cursor) => [{ type: 'line', start: p1Res.point, end: cursor }],
            });
            if (!p2Res || !p2Res.point) return;
            newAngle = angleOf(p1Res.point, p2Res.point);
        } else if (newRes.number !== undefined) {
            newAngle = degToRad(newRes.number);
        } else if (newRes.point) {
            newAngle = angleOf(base, newRes.point);
        } else {
            return;
        }
        angle = newAngle - refAngle;
    } else {
        angle = res.number !== undefined ? degToRad(res.number) : angleOf(base, res.point);
    }

    if (copyMode) {
        const copies = entities.map((e) => ({ ...rotateEntity(e, base, angle), id: undefined }));
        editor.commit('Rotacionar', addEntities(editor.doc, copies));
    } else {
        editor.commit('Rotacionar', updateEntities(editor.doc, ids, (e) => rotateEntity(e, base, angle)));
    }
}

async function mirror(editor) {
    const ids = await editor.getSelection('Selecione objetos para espelhar:');
    if (ids.length === 0) return;
    const entities = editor.entitiesById(ids);
    const a = (await editor.getPoint('Primeiro ponto da linha de espelho:')).point;
    const b = await editor.getPoint('Segundo ponto da linha de espelho:', {
        reference: a,
        preview: (cursor) => (distance(a, cursor) > 1e-9 ? entities.map((e) => mirrorEntity(e, a, cursor)) : []),
    });
    if (!b.point || distance(a, b.point) < 1e-9) return;
    const keep = await editor.getKeyword('Apagar objetos de origem?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 'n');
    const mirrored = entities.map((e) => ({ ...mirrorEntity(e, a, b.point), id: undefined }));
    let doc = addEntities(editor.doc, mirrored);
    if (keep.key === 's') doc = removeEntities(doc, ids);
    editor.commit('Espelhar', doc);
}

async function scaleCommand(editor) {
    const ids = await editor.getSelection('Selecione objetos para escalar:');
    if (ids.length === 0) return;
    const entities = editor.entitiesById(ids);
    const baseRes = await editor.getPoint('Ponto base:');
    if (!baseRes || !baseRes.point) return;
    const base = baseRes.point;

    let copyMode = false;
    let res = await editor.getPoint('Fator de escala ou [Copiar/Referência]', {
        reference: base,
        allowNumber: true,
        options: [
            { key: 'c', label: 'Copiar' },
            { key: 'r', label: 'Referência' },
        ],
        preview: (cursor) => {
            const f = distance(base, cursor);
            return f > 1e-9 ? entities.map((e) => scaleEntity(e, base, f)) : [];
        },
        hide: ids,
    });
    if (!res) return;

    if (res.keyword === 'c') {
        copyMode = true;
        res = await editor.getPoint('Fator de escala ou [Referência]', {
            reference: base,
            allowNumber: true,
            options: [{ key: 'r', label: 'Referência' }],
            preview: (cursor) => {
                const f = distance(base, cursor);
                return f > 1e-9 ? entities.map((e) => scaleEntity(e, base, f)) : [];
            },
        });
        if (!res) return;
    }

    let factor;
    if (res.keyword === 'r') {
        let refLength = 1;
        const refRes = await editor.getPoint('Comprimento de referência', {
            reference: base,
            allowNumber: true,
            defaultValue: 1,
        });
        if (!refRes) return;
        if (refRes.number !== undefined) {
            refLength = refRes.number;
        } else if (refRes.point) {
            const p2Res = await editor.getPoint('Segundo ponto do comprimento de referência:', {
                reference: refRes.point,
                preview: (cursor) => [{ type: 'line', start: refRes.point, end: cursor }],
            });
            if (!p2Res || !p2Res.point) return;
            refLength = distance(refRes.point, p2Res.point);
        }
        if (!(refLength > 1e-9)) return editor.log('Comprimento de referência deve ser maior que zero.', 'error');

        const newRes = await editor.getPoint('Novo comprimento ou [Pontos]', {
            reference: base,
            allowNumber: true,
            options: [{ key: 'p', label: 'Pontos' }],
            preview: (cursor) => {
                const d = distance(base, cursor);
                const f = d / refLength;
                return f > 1e-9 ? entities.map((e) => scaleEntity(e, base, f)) : [];
            },
            hide: copyMode ? [] : ids,
        });
        if (!newRes) return;
        let newLength;
        if (newRes.keyword === 'p') {
            const p1Res = await editor.getPoint('Primeiro ponto do novo comprimento:');
            if (!p1Res || !p1Res.point) return;
            const p2Res = await editor.getPoint('Segundo ponto do novo comprimento:', {
                reference: p1Res.point,
                preview: (cursor) => [{ type: 'line', start: p1Res.point, end: cursor }],
            });
            if (!p2Res || !p2Res.point) return;
            newLength = distance(p1Res.point, p2Res.point);
        } else if (newRes.number !== undefined) {
            newLength = newRes.number;
        } else if (newRes.point) {
            newLength = distance(base, newRes.point);
        } else {
            return;
        }
        factor = newLength / refLength;
    } else {
        factor = res.number !== undefined ? res.number : distance(base, res.point);
    }

    if (!(factor > 1e-9)) return editor.log('Fator inválido.', 'error');

    if (copyMode) {
        const copies = entities.map((e) => ({ ...scaleEntity(e, base, factor), id: undefined }));
        editor.commit('Escalar', addEntities(editor.doc, copies));
    } else {
        editor.commit('Escalar', updateEntities(editor.doc, ids, (e) => scaleEntity(e, base, factor)));
    }
}

async function offset(editor) {
    let dist = editor.memory.offset ?? 1;
    let mode = 'distance'; // 'distance' | 'through'
    let erase = editor.memory.offsetErase ?? false;
    let layerTarget = editor.memory.offsetLayerMode ?? 'source'; // 'source' | 'current'

    for (;;) {
        const promptText = `Especifique a distância de deslocamento ou [Através/Apagar/Camada] <${fmt(dist)}>:`;
        const options = [
            { key: 't', label: 'Através' },
            { key: 'e', label: 'Apagar' },
            { key: 'l', label: 'Camada' },
        ];
        const res = await editor.getPoint(promptText, {
            options,
            allowNumber: true,
            allowEnter: true,
        });

        if (!res) return;

        if (res.enter) {
            mode = 'distance';
            break;
        }

        if (res.number !== undefined) {
            if (res.number <= 0) {
                editor.log('Distância deve ser maior que zero.', 'error');
                continue;
            }
            dist = res.number;
            editor.memory.offset = dist;
            mode = 'distance';
            break;
        }

        if (res.point) {
            const p2Res = await editor.getPoint('Segundo ponto:', {
                reference: res.point,
                preview: (cursor) => [{ type: 'line', start: res.point, end: cursor }],
            });
            if (p2Res?.point) {
                const d = distance(res.point, p2Res.point);
                if (d > 1e-6) {
                    dist = d;
                    editor.memory.offset = dist;
                    mode = 'distance';
                    break;
                }
            }
            continue;
        }

        if (res.keyword === 't') {
            mode = 'through';
            break;
        }

        if (res.keyword === 'e') {
            const defErase = erase ? 's' : 'n';
            const eraseKw = await editor.getKeyword(
                `Apagar objeto de origem após deslocar? [Sim/Não] <${defErase.toUpperCase()}>:`,
                [
                    { key: 's', label: 'Sim' },
                    { key: 'n', label: 'Não' },
                ],
                defErase
            );
            if (eraseKw) {
                erase = eraseKw.key === 's';
                editor.memory.offsetErase = erase;
            }
            continue;
        }

        if (res.keyword === 'l') {
            const defLayer = layerTarget === 'current' ? 'c' : 's';
            const layerKw = await editor.getKeyword(
                `Definir camada para o objeto de deslocamento [Atual/Origem] <${layerTarget === 'current' ? 'Atual' : 'Origem'}>:`,
                [
                    { key: 'c', label: 'Atual' },
                    { key: 's', label: 'Origem' },
                ],
                defLayer
            );
            if (layerKw) {
                layerTarget = layerKw.key === 'c' ? 'current' : 'source';
                editor.memory.offsetLayerMode = layerTarget;
            }
            continue;
        }
    }

    const trimmable = (e) => ['line', 'circle', 'arc', 'polyline'].includes(e.type);

    for (;;) {
        const pick = await editor.getEntity('Selecione objeto para deslocar ou <Enter> para sair:', {
            allowEnter: true,
            filter: trimmable,
        });
        if (!pick) break;
        const sourceEntity = pick.entity;

        if (mode === 'through') {
            const throughRes = await editor.getPoint('Especifique o ponto através do qual passar:', {
                allowEnter: true,
                preview: (cursor) => {
                    const d = distanceToEntity(cursor, sourceEntity);
                    if (d <= 1e-6) return [];
                    const r = offsetEntity(sourceEntity, d, cursor);
                    if (!r) return [];
                    const targetLayer = layerTarget === 'current' ? editor.doc.currentLayer : sourceEntity.layer;
                    return [{ ...r, id: undefined, layer: targetLayer }];
                },
            });
            if (throughRes?.enter || !throughRes?.point) continue;

            const d = distanceToEntity(throughRes.point, sourceEntity);
            if (d <= 1e-6) {
                editor.log('Ponto sobre a entidade.', 'warn');
                continue;
            }
            const result = offsetEntity(sourceEntity, d, throughRes.point);
            if (!result) {
                editor.log('Offset impossível para esse objeto.', 'error');
                continue;
            }
            const targetLayer = layerTarget === 'current' ? editor.doc.currentLayer : sourceEntity.layer;
            const newEntity = { ...result, id: undefined, layer: targetLayer };

            if (erase) {
                editor.commit('Offset (Através, Apagar)', replaceEntities(editor.doc, new Map([[sourceEntity.id, newEntity]])));
            } else {
                editor.commit('Offset (Através)', addEntities(editor.doc, [newEntity]));
            }
            continue;
        }

        // Modo dist normal com suporte a Múltiplo
        let isMultiple = false;
        for (;;) {
            const sideOptions = isMultiple
                ? [{ key: 'u', label: 'Desfazer' }]
                : [
                    { key: 'm', label: 'Múltiplo' },
                    { key: 'u', label: 'Desfazer' },
                ];
            const sidePrompt = isMultiple
                ? 'Especifique ponto no lado do deslocamento ou [Desfazer/Enter para sair]:'
                : 'Especifique ponto no lado do deslocamento ou [Sair/Múltiplo/Desfazer] <Sair>:';

            const side = await editor.getPoint(sidePrompt, {
                allowEnter: true,
                options: sideOptions,
                preview: (cursor) => {
                    const r = offsetEntity(sourceEntity, dist, cursor);
                    if (!r) return [];
                    const targetLayer = layerTarget === 'current' ? editor.doc.currentLayer : sourceEntity.layer;
                    return [{ ...r, id: undefined, layer: targetLayer }];
                },
            });

            if (!side || side.enter) break;

            if (side.keyword === 'm') {
                isMultiple = true;
                continue;
            }

            if (side.keyword === 'u') {
                editor.undo();
                continue;
            }

            if (side.point) {
                const result = offsetEntity(sourceEntity, dist, side.point);
                if (!result) {
                    editor.log('Offset impossível para esse objeto/distância.', 'error');
                    if (!isMultiple) break;
                    continue;
                }
                const targetLayer = layerTarget === 'current' ? editor.doc.currentLayer : sourceEntity.layer;
                const newEntity = { ...result, id: undefined, layer: targetLayer };

                if (erase) {
                    editor.commit('Offset', replaceEntities(editor.doc, new Map([[sourceEntity.id, newEntity]])));
                    break;
                } else {
                    editor.commit('Offset', addEntities(editor.doc, [newEntity]));
                    if (!isMultiple) break;
                }
            }
        }
    }
}

function curvesOf(entities) {
    return entities.flatMap((e) => entityCurves(e));
}

// Como no BricsCAD: dentro do TRIM, segurar Shift ao clicar estende; dentro do EXTEND, apara.
// As arestas escolhidas servem de corte e de limite.
const TRIM_EXTEND_MODES = {
    trim: { prompt: 'Selecione objeto para aparar ou abra uma janela (Shift estende)', shiftPrompt: 'Selecione objeto para estender ou abra uma janela (solte Shift para aparar)' },
    extend: { prompt: 'Selecione objeto para estender ou abra uma janela (Shift apara)', shiftPrompt: 'Selecione objeto para aparar ou abra uma janela (solte Shift para estender)' },
};
const isTrimmable = (e) => ['line', 'circle', 'arc', 'polyline'].includes(e.type);
const isExtendable = (e) => ['line', 'arc'].includes(e.type);

async function trimOrExtend(editor, primary) {
    const edgeIds = await editor.getSelection(primary === 'trim'
        ? 'Selecione arestas de corte ou <Enter> para todas:'
        : 'Selecione arestas de limite ou <Enter> para todas:', { allowEmpty: true });
    const secondary = primary === 'trim' ? 'extend' : 'trim';
    const filters = { trim: isTrimmable, extend: isExtendable };
    for (;;) {
        const { prompt, shiftPrompt } = TRIM_EXTEND_MODES[primary];
        const pick = await editor.getEntityOrWindow(prompt, {
            allowEnter: true,
            filter: (e) => isTrimmable(e) || isExtendable(e),
            shiftPrompt,
        });
        if (!pick) break;
        const mode = pick.shift ? secondary : primary;
        const edges = edgeIds.length ? editor.entitiesById(edgeIds) : editor.doc.entities;
        if (pick.entities) pick.entities = pick.entities.filter(filters[mode]);
        else if (!filters[mode](pick.entity)) {
            editor.log(mode === 'extend' ? 'Só linhas e arcos podem ser estendidos.' : 'Esse objeto não pode ser aparado.', 'warn');
            continue;
        }
        if (mode === 'trim') trimPick(editor, pick, edges);
        else extendPick(editor, pick, edges);
    }
}

function trim(editor) {
    return trimOrExtend(editor, 'trim');
}

function extend(editor) {
    return trimOrExtend(editor, 'extend');
}

function trimPick(editor, pick, edges) {
    if (pick.entities) {
        // Janela: remove de cada objeto os trechos que cruzam o retângulo.
        const replacements = new Map();
        pick.entities.forEach((entity) => {
            const cutters = curvesOf(edges.filter((e) => e.id !== entity.id));
            const result = trimInsideBox(entity, cutters, pick.box);
            if (result) replacements.set(entity.id, result);
        });
        if (replacements.size === 0) { editor.log('Nenhum trecho com interseção dentro da janela.', 'warn'); return; }
        editor.commit('Aparar', replaceEntities(editor.doc, replacements));
        return;
    }
    const cutters = curvesOf(edges.filter((e) => e.id !== pick.entity.id));
    if (pick.entity.type === 'polyline') {
        const result = trimPolyline(pick.entity, cutters, pick.point);
        if (!result) { editor.log('Nenhuma interseção encontrada para aparar.', 'warn'); return; }
        editor.commit('Aparar', replaceEntities(editor.doc, new Map([[pick.entity.id, result]])));
        return;
    }
    const kept = trimAtPoint(pick.entity, cutters, pick.point);
    if (kept === undefined) { editor.log('Nenhuma interseção encontrada para aparar.', 'warn'); return; }
    editor.commit('Aparar', replaceEntities(editor.doc, new Map([[pick.entity.id, kept]])));
}

// TRIM preserva a entidade se o recorte não deixar geometria; exclusão integral pertence ao ERASE.
// Apara a peça mais próxima do clique. Retorna undefined se não houver recorte válido.
function trimAtPoint(entity, cutters, pickPoint) {
    const own = entityCurves(entity)[0];
    const cuts = cutters.flatMap((c) => intersectCurves(own, c));
    if (cuts.length === 0) return undefined;
    const pieces = splitEntityAt(entity, cuts);
    if (pieces.length <= 1) return undefined;
    let nearest = null;
    pieces.forEach((piece) => {
        const d = distance(pickPoint, closestPointOnCurve(pickPoint, entityCurves(piece)[0]));
        if (!nearest || d < nearest.d) nearest = { piece, d };
    });
    const kept = pieces.filter((p) => p !== nearest.piece);
    return kept.length ? kept : undefined;
}

// Apara os trechos de uma entidade que cruzam a janela. Polilinhas são explodidas nos segmentos afetados.
function trimInsideBox(entity, cutters, box) {
    const pieceInsideBox = (piece) => {
        const curve = entityCurves(piece)[0];
        const mid = curveMidpoint(curve) ?? curve.center;
        return pointInBox(mid, box) || curveIntersectsBox(curve, box);
    };
    if (entity.type === 'polyline') {
        const curves = polylineCurves(entity.vertices, entity.closed);
        const out = [];
        let changed = false;
        curves.forEach((c) => {
            const seg = curveToEntity(c, entity);
            if (!curveIntersectsBox(c, box)) { out.push(seg); return; }
            const cuts = cutters.flatMap((cut) => intersectCurves(c, cut));
            const pieces = cuts.length ? splitEntityAt(seg, cuts) : [seg];
            if (pieces.length <= 1) { out.push(seg); return; }
            const kept = pieces.filter((p) => !pieceInsideBox(p));
            if (kept.length !== pieces.length) changed = true;
            out.push(...kept);
        });
        return changed && out.length ? out : undefined;
    }
    const own = entityCurves(entity)[0];
    if (!curveIntersectsBox(own, box)) return undefined;
    const cuts = cutters.flatMap((c) => intersectCurves(own, c));
    if (cuts.length === 0) return undefined;
    const pieces = splitEntityAt(entity, cuts);
    if (pieces.length <= 1) return undefined;
    const kept = pieces.filter((p) => !pieceInsideBox(p));
    if (kept.length === pieces.length) return undefined;
    return kept.length ? kept : undefined;
}

function trimPolyline(entity, cutters, pickPoint) {
    // Explode em curvas, apara o segmento clicado e devolve as partes (como linhas/arcos).
    const curves = polylineCurves(entity.vertices, entity.closed);
    let nearest = null;
    curves.forEach((c) => {
        const d = distance(pickPoint, closestPointOnCurve(pickPoint, c));
        if (!nearest || d < nearest.d) nearest = { c, d };
    });
    if (!nearest) return null;
    const target = curveToEntity(nearest.c, entity);
    const cuts = cutters.flatMap((c) => intersectCurves(nearest.c, c));
    if (cuts.length === 0) return null;
    const pieces = splitEntityAt(target, cuts);
    if (pieces.length <= 1) return null;
    let closest = null;
    pieces.forEach((piece) => {
        const d = distance(pickPoint, closestPointOnCurve(pickPoint, entityCurves(piece)[0]));
        if (!closest || d < closest.d) closest = { piece, d };
    });
    const others = curves.filter((c) => c !== nearest.c).map((c) => curveToEntity(c, entity));
    return [...others, ...pieces.filter((p) => p !== closest.piece)];
}

function curveToEntity(curve, source) {
    const base = { layer: source.layer, color: source.color };
    if (curve.kind === 'segment') return { ...base, type: 'line', start: { x: curve.a.x, y: curve.a.y }, end: { x: curve.b.x, y: curve.b.y } };
    if (curve.kind === 'circle') return { ...base, type: 'circle', center: curve.center, radius: curve.radius };
    return { ...base, type: 'arc', center: curve.center, radius: curve.radius, start: curve.start, end: curve.end };
}

function extendPick(editor, pick, boundaries) {
    if (pick.entities) {
        // Janela: estende as pontas que estão dentro do retângulo.
        const replacements = new Map();
        pick.entities.forEach((entity) => {
            const limits = curvesOf(boundaries.filter((e) => e.id !== entity.id));
            let current = entity;
            const ends = entity.type === 'line'
                ? [entity.start, entity.end]
                : [polar(entity.center, entity.start, entity.radius), polar(entity.center, entity.end, entity.radius)];
            ends.forEach((end) => {
                if (!pointInBox(end, pick.box)) return;
                const result = extendEntity(current, limits, end);
                if (result) current = result;
            });
            if (current !== entity) replacements.set(entity.id, current);
        });
        if (replacements.size === 0) { editor.log('Nenhuma ponta dentro da janela pôde ser estendida.', 'warn'); return; }
        editor.commit('Estender', replaceEntities(editor.doc, replacements));
        return;
    }
    const limits = curvesOf(boundaries.filter((e) => e.id !== pick.entity.id));
    const result = extendEntity(pick.entity, limits, pick.point);
    if (!result) { editor.log('Nenhum limite encontrado nessa direção.', 'warn'); return; }
    editor.commit('Estender', replaceEntities(editor.doc, new Map([[pick.entity.id, result]])));
}

function extendEntity(entity, limits, pickPoint) {
    const own = entityCurves(entity)[0];
    if (entity.type === 'line') {
        const nearStart = distance(pickPoint, entity.start) < distance(pickPoint, entity.end);
        const endPoint = nearStart ? entity.start : entity.end;
        const other = nearStart ? entity.end : entity.start;
        const dir = normalize(sub(endPoint, other));
        let best = null;
        limits.forEach((limit) => {
            intersectCurves(own, limit, { extend1: true }).forEach((p) => {
                const t = dot(sub(p, endPoint), dir);
                if (t > 1e-9 && (!best || t < best.t)) best = { p, t };
            });
        });
        if (!best) return null;
        return nearStart ? { ...entity, start: best.p } : { ...entity, end: best.p };
    }
    if (entity.type === 'arc') {
        const startPoint = polar(entity.center, entity.start, entity.radius);
        const endPoint = polar(entity.center, entity.end, entity.radius);
        const nearStart = distance(pickPoint, startPoint) < distance(pickPoint, endPoint);
        const full = { kind: 'circle', center: entity.center, radius: entity.radius };
        let best = null;
        limits.forEach((limit) => {
            intersectCurves(full, limit).forEach((p) => {
                const angle = angleOf(entity.center, p);
                const delta = nearStart ? sweepCCW(angle, entity.start) : sweepCCW(entity.end, angle);
                if (delta > 1e-9 && delta < Math.PI * 2 - sweepCCW(entity.start, entity.end) - 1e-9 && (!best || delta < best.delta)) best = { angle, delta };
            });
        });
        if (!best) return null;
        return nearStart ? { ...entity, start: normalizeAngle(best.angle) } : { ...entity, end: normalizeAngle(best.angle) };
    }
    return null;
}

async function fillet(editor) {
    let radius = editor.memory.fillet ?? 0;
    let multiple = false;
    const filter = (e) => ['line', 'arc', 'circle', 'polyline'].includes(e.type);
    for (;;) {
        const options = [
            { key: 'r', label: 'Raio' },
            { key: 'p', label: 'PoliLinha' },
            { key: 'm', label: 'Múltiplo' },
            { key: 'u', label: 'Desfazer' },
        ];
        const first = await editor.getEntity(`Selecione o primeiro objeto (raio=${fmt(radius)}) ou [Raio/PoliLinha/Múltiplo/Desfazer]:`, {
            options,
            filter,
        });
        if (!first) return;
        if (first.keyword === 'r') {
            radius = await editor.getNumber('Raio do fillet', { defaultValue: radius, min: 0 });
            editor.memory.fillet = radius;
            continue;
        }
        if (first.keyword === 'm') {
            multiple = true;
            editor.log('Modo múltiplo ativado.');
            continue;
        }
        if (first.keyword === 'u') {
            editor.runCommand('UNDO');
            continue;
        }
        if (first.keyword === 'p') {
            const pickPline = await editor.getEntity('Selecione a polilinha 2D:', {
                filter: (e) => e.type === 'polyline',
            });
            if (!pickPline) continue;
            const modified = polylineFillet(pickPline.entity, radius);
            editor.commit('Fillet na polilinha', replaceEntities(editor.doc, new Map([[pickPline.entity.id, modified]])));
            if (!multiple) return;
            continue;
        }
        if (first.entity?.type === 'polyline') {
            const modified = polylineFillet(first.entity, radius);
            editor.commit('Fillet na polilinha', replaceEntities(editor.doc, new Map([[first.entity.id, modified]])));
            if (!multiple) return;
            continue;
        }
        const second = await editor.getEntity('Selecione o segundo objeto', { filter: (e) => filter(e) && e.id !== first.entity.id });
        if (!second) {
            if (multiple) continue;
            return;
        }
        const result = filletCurves(first.entity, first.point, second.entity, second.point, radius);
        if (!result) {
            editor.log('Sem concordância possível: objetos paralelos/concêntricos ou raio incompatível.', 'error');
            if (multiple) continue;
            return;
        }
        const replacements = new Map([[first.entity.id, result.first], [second.entity.id, result.second]]);
        let doc = replaceEntities(editor.doc, replacements);
        if (result.arc) doc = addEntities(doc, [result.arc]);
        editor.commit('Fillet', doc);
        if (!multiple) return;
    }
}

// Curva "infinita" de apoio: linha vira reta, arco vira círculo.
function supportCurve(entity) {
    if (entity.type === 'line') return { kind: 'segment', a: entity.start, b: entity.end };
    return { kind: 'circle', center: entity.center, radius: entity.radius };
}

function offsetSupport(curve, dist) {
    if (curve.kind === 'segment') {
        const dir = normalize(sub(curve.b, curve.a));
        const n = { x: -dir.y, y: dir.x };
        return [
            { kind: 'segment', a: add(curve.a, scale(n, dist)), b: add(curve.b, scale(n, dist)) },
            { kind: 'segment', a: sub(curve.a, scale(n, dist)), b: sub(curve.b, scale(n, dist)) },
        ];
    }
    const out = [{ kind: 'circle', center: curve.center, radius: curve.radius + dist }];
    if (curve.radius - dist > 1e-9) out.push({ kind: 'circle', center: curve.center, radius: curve.radius - dist });
    return out;
}

// Apara a entidade no ponto de tangência mantendo o lado do clique. Círculos ficam inteiros.
// Entre duas linhas, o lado é decidido pelo canto (interseção), não pelo ponto de tangência:
// clique entre o canto e a tangência ainda indica o trecho longo, como no AutoCAD.
function trimToTangent(entity, tangent, pick, corner = null) {
    if (entity.type === 'line' && corner) {
        const u = sub(pick, corner);
        const ds = dot(sub(entity.start, corner), u);
        const de = dot(sub(entity.end, corner), u);
        // Tangência além das duas pontas (raio maior que a linha): cai no critério antigo, que estende.
        if (dot(sub(tangent, corner), u) < Math.max(ds, de)) {
            return ds >= de ? { ...entity, end: tangent } : { ...entity, start: tangent };
        }
    }
    if (entity.type === 'line') {
        const keepStart = dot(sub(entity.start, tangent), sub(pick, tangent)) >= dot(sub(entity.end, tangent), sub(pick, tangent));
        return keepStart ? { ...entity, end: tangent } : { ...entity, start: tangent };
    }
    if (entity.type === 'arc') {
        const aT = normalizeAngle(angleOf(entity.center, tangent));
        const aP = normalizeAngle(angleOf(entity.center, pick));
        // Se o clique está no trecho de aT até o fim (anti-horário), mantém esse trecho; senão, do início até aT.
        const sweepToEnd = sweepCCW(aT, entity.end);
        const pickAhead = sweepCCW(aT, aP) <= sweepToEnd + 1e-9;
        return pickAhead ? { ...entity, start: aT } : { ...entity, end: aT };
    }
    return entity;
}

function filletCurves(e1, p1, e2, p2, radius) {
    const c1 = supportCurve(e1);
    const c2 = supportCurve(e2);
    const pickMid = midpoint(p1, p2);
    // Candidatos a centro: interseções dos offsets de cada curva pelo raio (ou das próprias curvas se raio 0).
    const offs1 = radius > 1e-9 ? offsetSupport(c1, radius) : [c1];
    const offs2 = radius > 1e-9 ? offsetSupport(c2, radius) : [c2];
    const candidates = [];
    offs1.forEach((o1) => offs2.forEach((o2) => {
        intersectCurves(o1, o2, { extend1: true, extend2: true }).forEach((p) => candidates.push(p));
    }));
    if (candidates.length === 0) return null;
    const scoreOf = (center) => {
        const t1 = closestPointOnCurve(center, c1.kind === 'segment' ? { kind: 'segment', a: sub(c1.a, scale(sub(c1.b, c1.a), 1e6)), b: add(c1.b, scale(sub(c1.b, c1.a), 1e6)) } : c1);
        const t2 = closestPointOnCurve(center, c2.kind === 'segment' ? { kind: 'segment', a: sub(c2.a, scale(sub(c2.b, c2.a), 1e6)), b: add(c2.b, scale(sub(c2.b, c2.a), 1e6)) } : c2);
        // Pontos de tangência devem ficar do lado dos cliques; penaliza fortemente o contrário.
        const side1 = distance(t1, p1);
        const side2 = distance(t2, p2);
        return { score: distance(center, pickMid) + side1 + side2, t1, t2 };
    };
    // Duas linhas: só vale o centro no setor dos cliques (tangências do lado de cada clique em relação ao canto).
    let corner = null;
    let pool = candidates;
    if (e1.type === 'line' && e2.type === 'line') {
        corner = intersectCurves(c1, c2, { extend1: true, extend2: true })[0] ?? null;
        if (corner) {
            const u1 = sub(p1, corner);
            const u2 = sub(p2, corner);
            const inSector = pool.filter((center) => {
                const r = scoreOf(center);
                return dot(sub(r.t1, corner), u1) > 0 && dot(sub(r.t2, corner), u2) > 0;
            });
            if (inSector.length) pool = inSector;
        }
    }
    let best = null;
    pool.forEach((center) => {
        const r = scoreOf(center);
        if (!best || r.score < best.score) best = { center, ...r };
    });
    const { center, t1, t2 } = best;
    if (radius <= 1e-9) {
        // Canto vivo: as duas curvas encontram-se no ponto escolhido.
        return { first: trimToTangent(e1, center, p1, corner), second: trimToTangent(e2, center, p2, corner), arc: null };
    }
    // Arco de concordância: o trecho curto entre t1 e t2.
    let a1 = angleOf(center, t1);
    let a2 = angleOf(center, t2);
    if (sweepCCW(a1, a2) > Math.PI) [a1, a2] = [a2, a1];
    const first = trimToTangent(e1, t1, p1, corner);
    const second = trimToTangent(e2, t2, p2, corner);
    // Sanidade: tangentes precisam estar sobre as curvas de apoio (linha estendida ou círculo).
    if (c1.kind === 'circle' && Math.abs(distance(t1, c1.center) - c1.radius) > 1e-6) return null;
    if (c2.kind === 'circle' && Math.abs(distance(t2, c2.center) - c2.radius) > 1e-6) return null;
    return {
        first,
        second,
        arc: { type: 'arc', layer: e1.layer, color: e1.color, center, radius, start: normalizeAngle(a1), end: normalizeAngle(a2) },
    };
}

// Compatibilidade com testes e chamadas antigas.
function filletLines(l1, p1, l2, p2, radius) {
    return filletCurves(l1, p1, l2, p2, radius);
}

async function revcloud(editor) {
    editor.memory = editor.memory ?? {};
    let arcLength = editor.memory.revcloudArcLength ?? 15;

    for (;;) {
        const options = [
            { key: 'a', label: 'Comprimento do arco' },
            { key: 'o', label: 'Objeto' },
            { key: 'r', label: 'Retangular' },
        ];
        const res = await editor.getPoint(`Especifique o ponto inicial ou [Comprimento do arco/Objeto/Retangular] (comprimento=${fmt(arcLength)}):`, {
            options,
            allowEnter: true,
        });
        if (!res || res.enter) return;

        if (res.keyword === 'a') {
            const len = await editor.getNumber('Comprimento mínimo do arco', {
                defaultValue: arcLength,
                min: 0.5,
            });
            if (len) {
                arcLength = len;
                editor.memory.revcloudArcLength = arcLength;
            }
            continue;
        }

        if (res.keyword === 'o') {
            const pick = await editor.getEntity('Selecione o objeto a converter em nuvem de revisão:', {
                filter: (e) => ['circle', 'polyline'].includes(e.type),
            });
            if (!pick) continue;
            const revAns = await editor.getKeyword('Inverter direção dos arcos?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 'n');
            const isReverse = revAns.key === 's';
            const cloud = createRevcloudFromEntity(pick.entity, arcLength, isReverse);
            if (!cloud) {
                editor.log('Não foi possível converter este objeto em nuvem de revisão.', 'warn');
                continue;
            }
            editor.commit('Nuvem de revisão', replaceEntities(editor.doc, new Map([[pick.entity.id, cloud]])));
            editor.log('Objeto convertido em nuvem de revisão.');
            return;
        }

        const p1 = res.point;
        if (!p1) return;

        const p2Res = await editor.getPoint('Especifique o canto oposto:', {
            reference: p1,
            allowEnter: false,
        });
        if (!p2Res?.point) return;
        const p2 = p2Res.point;

        const baseRect = createRectangleEntity(p1, p2, { layer: editor.doc.currentLayer });
        const cloud = createRevcloudFromEntity(baseRect, arcLength, false);
        if (cloud) {
            editor.commit('Nuvem de revisão', addEntities(editor.doc, [cloud]));
            editor.log('Nuvem de revisão criada.');
        }
        return;
    }
}

async function explode(editor) {
    const ids = await editor.getSelection('Selecione objetos para explodir:');
    const replacements = new Map();
    let count = 0;
    editor.entitiesById(ids).forEach((entity) => {
        if(entity.type==='insert'){replacements.set(entity.id,expandInsert(entity).map(e=>({...e,id:undefined})));count+=1;return;}
        if (entity.type === 'spline') {
            // A spline vira arcos que seguem a curva; trechos retos viram linhas.
            const lines = splineToLines(entity);
            if (lines.length) { replacements.set(entity.id, lines); count += 1; }
            return;
        }
        if (entity.type !== 'polyline') return;
        replacements.set(entity.id, polylineCurves(entity.vertices, entity.closed).map((c) => curveToEntity(c, entity)));
        count += 1;
    });
    if (count === 0) return editor.log('Nada para explodir (apenas polilinhas, splines e blocos são explodidos).', 'warn');
    editor.commit('Explodir', replaceEntities(editor.doc, replacements));
    editor.clearSelection();
}

// Ajusta a spline com o menor número de arcos (e linhas onde ela é reta) dentro da tolerância.
const SPLINE_FIT_TOL = 0.01;

function splineFitPiece(pts, i, j) {
    const a = pts[i];
    const b = pts[j];
    const len = distance(a, b);
    if (len < 1e-9) return null;
    let lineOk = true;
    for (let k = i + 1; k < j && lineOk; k += 1) {
        const p = pts[k];
        const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
        if (d > SPLINE_FIT_TOL) lineOk = false;
    }
    if (lineOk) return { kind: 'segment', a, b };
    if (j - i < 2) return null;
    const arc = arcFromThreePoints(a, pts[Math.floor((i + j) / 2)], b);
    if (!arc) return null;
    for (let k = i + 1; k < j; k += 1) {
        if (Math.abs(distance(arc.center, pts[k]) - arc.radius) > SPLINE_FIT_TOL) return null;
    }
    return { kind: 'arc', ...arc };
}

export function splineToCurves(entity) {
    const pts = sampleSpline(ensureSplineGeometry(entity), 64).filter((p, k, all) => k === 0 || distance(p, all[k - 1]) > 1e-9);
    const curves = [];
    let i = 0;
    while (i < pts.length - 1) {
        let best = { j: i + 1, piece: { kind: 'segment', a: pts[i], b: pts[i + 1] } };
        for (let j = i + 2; j < pts.length; j += 1) {
            const piece = splineFitPiece(pts, i, j);
            if (!piece) break;
            best = { j, piece };
        }
        curves.push(best.piece);
        i = best.j;
    }
    return curves;
}

function splineToLines(entity) {
    return splineToCurves(entity).map((c) => curveToEntity(c, entity));
}

async function burst(editor) {
    const ids = await editor.getSelection('Selecione blocos para desagrupar preservando atributos (BURST):');
    const replacements = new Map();
    let count = 0;
    editor.entitiesById(ids).forEach((entity) => {
        if (entity.type !== 'insert') return;
        const expanded = expandInsert(entity).map(e => ({ ...e, id: undefined }));
        if (entity.attributes && typeof entity.attributes === 'object') {
            Object.entries(entity.attributes).forEach(([tag, val]) => {
                if (val && typeof val === 'object' && val.position) {
                    expanded.push({
                        type: 'text',
                        text: String(val.value ?? val.text ?? ''),
                        position: val.position,
                        height: val.height ?? 2.5,
                        rotation: val.rotation ?? 0,
                        layer: val.layer ?? entity.layer,
                        color: val.color ?? entity.color,
                    });
                }
            });
        }
        replacements.set(entity.id, expanded);
        count += 1;
    });
    if (count === 0) return editor.log('Nenhum bloco selecionado para desagrupar.', 'warn');
    editor.commit('Desagrupar blocos (BURST)', replaceEntities(editor.doc, replacements));
    editor.clearSelection();
    editor.log(`${count} bloco(s) desagrupado(s) com atributos preservados.`);
}

async function join(editor) {
    const ids = await editor.getSelection('Selecione linhas e arcos para unir em polilinha:');
    const entities = editor.entitiesById(ids).filter((e) => ['line', 'arc', 'polyline'].includes(e.type));
    if (entities.length < 2) return editor.log('Selecione ao menos dois objetos conectados.', 'warn');
    const groups = joinCurveGroups(entities);
    if (!groups.length) return editor.log('Os objetos não formam uma cadeia contínua.', 'error');
    const joined = groups.flatMap((g) => g.entities);
    let doc = removeEntities(editor.doc, joined.map((e) => e.id));
    doc = addEntities(doc, groups.map((g) => ({ ...g.result, layer: g.entities[0].layer, color: g.entities[0].color })));
    editor.commit('Unir', doc);
    editor.clearSelection();
    const skipped = entities.length - joined.length;
    editor.log(`${joined.length} objeto(s) unido(s) em ${groups.length} polilinha(s)${skipped ? `; ${skipped} ficaram de fora` : ''}.`);
}




// ---------------------------------------------------------------------------
// Polígono, elipse, spline

async function polygon(editor) {
    const sides = await editor.getNumber('Número de lados', { defaultValue: editor.memory.polygonSides ?? 6 });
    if (!Number.isInteger(sides) || sides < 3 || sides > 1024) return editor.log('Informe um inteiro entre 3 e 1024.', 'error');
    editor.memory.polygonSides = sides;
    const centerRes = await editor.getPoint('Centro do polígono', { options: [{ key: 'a', label: 'Aresta' }] });
    if (centerRes.keyword === 'a') {
        const a = (await editor.getPoint('Primeiro ponto da aresta:')).point;
        const b = await editor.getPoint('Segundo ponto da aresta', { reference: a, preview: (cursor) => [polygonFromEdge(sides, a, cursor)] });
        if (!b.point) return null;
        return editor.commit('Polígono', addEntities(editor.doc, [polygonFromEdge(sides, a, b.point)]));
    }
    const center = centerRes.point;
    const mode = await editor.getKeyword('Inscrito no círculo ou Circunscrito ao círculo?', [{ key: 'i', label: 'Inscrito' }, { key: 'c', label: 'Circunscrito' }], editor.memory.polygonMode ?? 'i');
    editor.memory.polygonMode = mode.key;
    const build = (radius, angle) => {
        const r = mode.key === 'c' ? radius / Math.cos(Math.PI / sides) : radius;
        const startAngle = mode.key === 'c' ? angle + Math.PI / sides : angle;
        const vertices = [];
        for (let i = 0; i < sides; i += 1) vertices.push({ ...polar(center, startAngle + (i * 2 * Math.PI) / sides, r), bulge: 0 });
        return { type: 'polyline', closed: true, vertices };
    };
    const res = await editor.getPoint(mode.key === 'c' ? 'Raio do círculo inscrito (apótema)' : 'Raio do círculo circunscrito', {
        options: [{ key: 'd', label: 'Diâmetro' }],
        reference: center,
        allowNumber: true,
        preview: (cursor) => [build(distance(center, cursor), angleOf(center, cursor))],
    });
    let radius;
    let angle = 0;
    if (res.keyword === 'd') {
        const d = await editor.getPoint('Diâmetro', { reference: center, allowNumber: true, preview: (cursor) => [build(distance(center, cursor) / 2, angleOf(center, cursor))] });
        radius = d.number !== undefined ? d.number / 2 : distance(center, d.point);
        if (d.point) angle = angleOf(center, d.point);
    } else if (res.number !== undefined) radius = res.number;
    else {
        radius = distance(center, res.point);
        angle = angleOf(center, res.point);
    }
    if (!(radius > 0)) return editor.log('Raio inválido.', 'error');
    return editor.commit('Polígono', addEntities(editor.doc, [build(radius, angle)]));
}

function polygonFromEdge(sides, a, b) {
    const edge = distance(a, b);
    const interior = ((sides - 2) * Math.PI) / sides;
    const vertices = [{ ...a, bulge: 0 }, { ...b, bulge: 0 }];
    let current = b;
    let dir = angleOf(a, b);
    for (let i = 2; i < sides; i += 1) {
        dir += Math.PI - interior;
        current = polar(current, dir, edge);
        vertices.push({ ...current, bulge: 0 });
    }
    return { type: 'polyline', closed: true, vertices };
}

async function ellipse(editor) {
    const first = await editor.getPoint('Primeiro ponto do eixo ou [Centro]', { options: [{ key: 'c', label: 'Centro' }] });
    let center;
    let major;
    if (first.keyword === 'c') {
        center = (await editor.getPoint('Centro da elipse:')).point;
        const end = await editor.getPoint('Extremidade do eixo', { reference: center, preview: (cursor) => [{ type: 'line', start: center, end: cursor }] });
        if (!end.point) return null;
        major = sub(end.point, center);
    } else {
        if (!first.point) return null;
        const second = await editor.getPoint('Outra extremidade do eixo', { reference: first.point, preview: (cursor) => [{ type: 'line', start: first.point, end: cursor }] });
        if (!second.point) return null;
        center = midpoint(first.point, second.point);
        major = sub(second.point, center);
    }
    const majorLen = Math.hypot(major.x, major.y);
    if (majorLen < 1e-9) return editor.log('Eixo nulo.', 'error');
    const build = (halfMinor) => {
        let ratio = halfMinor / majorLen;
        let m = major;
        if (ratio > 1) {
            // O eixo maior é sempre o maior: troca.
            m = scale({ x: -major.y, y: major.x }, ratio);
            ratio = 1 / ratio;
        }
        return { type: 'ellipse', center, major: m, ratio: Math.max(ratio, 1e-6), start: 0, end: Math.PI * 2 };
    };
    const res = await editor.getPoint('Distância até o outro eixo', {
        reference: center,
        allowNumber: true,
        preview: (cursor) => [build(distancePointLine(cursor, center, major))],
    });
    const halfMinor = res.number !== undefined ? res.number : distancePointLine(res.point, center, major);
    if (!(halfMinor > 0)) return editor.log('Valor inválido.', 'error');
    return editor.commit('Elipse', addEntities(editor.doc, [build(halfMinor)]));
}

function distancePointLine(p, origin, dir) {
    const n = normalize(dir);
    return Math.abs(cross(n, sub(p, origin)));
}

async function spline(editor) {
    const fit = [];
    for (;;) {
        const options = [
            ...(fit.length >= 3 ? [{ key: 'c', label: 'Fechar' }] : []),
            ...(fit.length >= 1 ? [{ key: 'u', label: 'Desfazer' }] : []),
        ];
        const res = await editor.getPoint(fit.length === 0 ? 'Primeiro ponto da spline' : 'Próximo ponto', {
            options,
            reference: fit[fit.length - 1] ?? null,
            allowEnter: fit.length >= 2,
            preview: (cursor) => {
                const built = interpolateSpline([...fit, cursor]);
                return built ? [{ type: 'spline', ...built }] : [];
            },
        });
        if (res.enter) break;
        if (res.keyword === 'u') { fit.pop(); continue; }
        if (res.keyword === 'c') {
            const built = interpolateSpline(fit, { closed: true });
            if (built) editor.commit('Spline', addEntities(editor.doc, [{ type: 'spline', ...built }]));
            return null;
        }
        if (res.point) fit.push(res.point);
    }
    if (fit.length < 2) return null;
    const built = interpolateSpline(fit);
    if (!built) return editor.log('Não foi possível interpolar a spline.', 'error');
    return editor.commit('Spline', addEntities(editor.doc, [{ type: 'spline', ...built }]));
}

// ---------------------------------------------------------------------------
// Padrões (array), alinhar, wblock

async function arrayCommand(editor, args = []) {
    const ids = await editor.getSelection('Selecione objetos para o padrão:');
    if (ids.length === 0) return null;
    const entities = editor.entitiesById(ids);
    // O menu da ribbon já escolhe o tipo; pela linha de comando ele ainda é perguntado.
    const preset = String((Array.isArray(args) ? args[0] : args) || '').toLowerCase();
    const mode = ['r', 'p', 'l'].includes(preset)
        ? { key: preset }
        : await editor.getKeyword('Tipo de padrão', [{ key: 'r', label: 'Retangular' }, { key: 'p', label: 'Polar' }, { key: 'l', label: 'Linear' }], editor.memory.arrayMode ?? 'r');
    editor.memory.arrayMode = mode.key;
    const copies = [];
    const clone = (fn) => entities.map((e) => ({ ...fn(e), id: undefined }));
    if (mode.key === 'r') {
        const rows = await editor.getNumber('Número de linhas', { defaultValue: editor.memory.arrayRows ?? 2 });
        const cols = await editor.getNumber('Número de colunas', { defaultValue: editor.memory.arrayCols ?? 2 });
        const rowSpacing = await editor.getNumber('Distância entre linhas (Y)', { defaultValue: editor.memory.arrayRowSpacing ?? 50 });
        const colSpacing = await editor.getNumber('Distância entre colunas (X)', { defaultValue: editor.memory.arrayColSpacing ?? 50 });
        Object.assign(editor.memory, { arrayRows: rows, arrayCols: cols, arrayRowSpacing: rowSpacing, arrayColSpacing: colSpacing });
        if (!(rows >= 1 && cols >= 1)) return editor.log('Linhas e colunas devem ser ≥ 1.', 'error');
        for (let r = 0; r < rows; r += 1) {
            for (let c = 0; c < cols; c += 1) {
                if (r === 0 && c === 0) continue;
                copies.push(...clone((e) => translateEntity(e, { x: c * colSpacing, y: r * rowSpacing })));
            }
        }
    } else if (mode.key === 'p') {
        const center = (await editor.getPoint('Centro do padrão polar:')).point;
        const count = await editor.getNumber('Número de itens', { defaultValue: editor.memory.arrayCount ?? 6 });
        const fill = await editor.getNumber('Ângulo a preencher (+ anti-horário)', { defaultValue: editor.memory.arrayFill ?? 360 });
        const rotate = await editor.getKeyword('Rotacionar os itens ao copiar?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 's');
        Object.assign(editor.memory, { arrayCount: count, arrayFill: fill });
        if (!(count >= 2)) return editor.log('Informe ao menos 2 itens.', 'error');
        const full = Math.abs(Math.abs(fill) - 360) < 1e-9;
        const step = degToRad(fill) / (full ? count : count - 1);
        for (let i = 1; i < count; i += 1) {
            const angle = step * i;
            copies.push(...clone((e) => (rotate.key === 's' ? rotateEntity(e, center, angle) : translateEntity(e, sub(rotatePoint(entityAnchor(e), center, angle), entityAnchor(e))))));
        }
    } else {
        const count = await editor.getNumber('Número de itens', { defaultValue: editor.memory.arrayCount ?? 4 });
        const a = (await editor.getPoint('Ponto base do deslocamento:')).point;
        const b = await editor.getPoint('Segundo ponto (distância e direção entre itens)', { reference: a, preview: (cursor) => [{ type: 'line', start: a, end: cursor }] });
        if (!b.point || !(count >= 2)) return editor.log('Informe ao menos 2 itens e um deslocamento.', 'error');
        editor.memory.arrayCount = count;
        const delta = sub(b.point, a);
        for (let i = 1; i < count; i += 1) copies.push(...clone((e) => translateEntity(e, scale(delta, i))));
    }
    if (copies.length === 0) return null;
    editor.commit('Padrão', addEntities(editor.doc, copies));
    editor.log(`${copies.length} cópia(s) criada(s).`);
    editor.clearSelection();
    return null;
}

function entityAnchor(e) {
    if (e.center) return e.center;
    if (e.start && e.start.x !== undefined) return e.start;
    if (e.position) return e.position;
    if (e.vertices) return e.vertices[0];
    if (e.p1) return e.p1;
    return { x: 0, y: 0 };
}

async function align(editor) {
    const ids = await editor.getSelection('Selecione objetos para alinhar:');
    if (ids.length === 0) return null;
    const entities = editor.entitiesById(ids);
    const pairs = [];
    for (let i = 1; i <= 3; i += 1) {
        const src = await editor.getPoint(`${['Primeiro', 'Segundo', 'Terceiro'][i - 1]} ponto de origem`, { allowEnter: i > 1 });
        if (src.enter || !src.point) break;
        const dst = await editor.getPoint(`${['Primeiro', 'Segundo', 'Terceiro'][i - 1]} ponto de destino`, {
            reference: src.point,
            preview: (cursor) => {
                const fn = alignTransform([...pairs, { src: src.point, dst: cursor }], false);
                return fn ? entities.map((e) => transformEntity(e, fn)) : [];
            },
        });
        if (!dst.point) break;
        pairs.push({ src: src.point, dst: dst.point });
    }
    if (pairs.length === 0) return null;
    let scaleIt = false;
    if (pairs.length >= 2) {
        const res = await editor.getKeyword('Escalar objetos pelos pontos de alinhamento?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 'n');
        scaleIt = res.key === 's';
    }
    if (pairs.length === 3) editor.log('Alinhamento 2D usa os dois primeiros pares; o terceiro é ignorado.', 'info');
    const fn = alignTransform(pairs, scaleIt);
    if (!fn) return editor.log('Pontos de alinhamento coincidentes.', 'error');
    editor.commit('Alinhar', updateEntities(editor.doc, ids, (e) => transformEntity(e, fn)));
    return null;
}

// Transformação 2D: translação (1 par) ou translação + rotação (+ escala opcional) com 2 pares.
function alignTransform(pairs, scaleIt) {
    if (pairs.length === 0) return null;
    const [p, q] = pairs;
    const delta = sub(p.dst, p.src);
    if (pairs.length === 1) return (pt) => add(pt, delta);
    const srcLen = distance(p.src, q.src);
    const dstLen = distance(p.dst, q.dst);
    if (srcLen < 1e-9 || dstLen < 1e-9) return null;
    const angle = angleOf(p.dst, q.dst) - angleOf(p.src, q.src);
    const factor = scaleIt ? dstLen / srcLen : 1;
    return (pt) => {
        const rel = sub(pt, p.src);
        const rotated = rotatePoint(rel, { x: 0, y: 0 }, angle);
        return add(p.dst, scale(rotated, factor));
    };
}

async function wblock(editor) {
    const ids = await editor.getSelection('Selecione objetos para exportar como bloco:');
    if (ids.length === 0) return null;
    const entities = editor.entitiesById(ids);
    const used = new Set(entities.map((e) => e.layer));
    const bridge = typeof window !== 'undefined' ? window.desktopBridge : null;
    const desktop = !!(bridge && typeof bridge.saveFile === 'function');
    const ui = editor.wblockUi ?? { openWblockDialog, confirmOverwrite };
    const browse = desktop && typeof bridge.showSaveDialog === 'function'
        ? (current) => bridge.showSaveDialog({
            defaultPath: current || 'bloco.dxf',
            filters: [
                { name: 'Desenho DXF (*.dxf)', extensions: ['dxf'] },
                { name: 'Todos os arquivos', extensions: ['*'] },
            ],
        })
        : null;
    // Como no BricsCAD: último caminho já preenchido e ponto base 0,0,0; W, Enter grava.
    // O último caminho fica gravado no navegador/desktop e vale para outras abas e após reiniciar.
    if (editor.memory.wblockPath == null && editor.memory.wblockName == null) Object.assign(editor.memory, loadWblockPrefs(editor.storage));
    let state = {
        path: (desktop ? editor.memory.wblockPath : null) ?? editor.memory.wblockName ?? 'bloco.dxf',
        base: editor.memory.wblockBase ?? { x: 0, y: 0, z: 0 },
    };
    let path;
    for (;;) {
        const answer = await ui.openWblockDialog({ ...state, count: entities.length, browse });
        if (!answer || answer.action === 'cancel') {
            editor.log('Salvamento cancelado.', 'info');
            return null;
        }
        state = { path: answer.path, base: answer.base };
        if (answer.action === 'pick') {
            const picked = (await editor.getPoint('Ponto base de inserção:')).point;
            state.base = { x: picked.x, y: picked.y, z: 0 };
            continue;
        }
        path = state.path;
        if (!/\.dxf$/i.test(path)) path = `${path}.dxf`;
        if (desktop && await fileExists(bridge, path) && !(await ui.confirmOverwrite(path))) {
            state.path = path;
            continue;
        }
        break;
    }
    const base = { x: state.base.x, y: state.base.y };
    const name = path.split(/[\/\\]/).pop() || path;
    if (desktop) editor.memory.wblockPath = path;
    editor.memory.wblockName = name;
    editor.memory.wblockBase = state.base;
    saveWblockPrefs(editor.storage, editor.memory);
    const view = editor.viewport?.getView ? editor.viewport.getView() : editor.doc.view;
    const doc = { ...createDocument(), name, units: editor.doc.units, dimStyle: editor.doc.dimStyle, insBase: base, view };
    doc.layers = editor.doc.layers.filter((l) => used.has(l.name) || l.name === '0');
    doc.entities = entities.map((e) => ({ ...e }));
    const content = writeDxf(doc, { view });
    if (desktop) await bridge.saveFile(path, content);
    else editor.downloadText(content, name);
    editor.log(`Bloco exportado: ${desktop ? path : name} (${entities.length} entidades, base ${fmtPoint(base)}).`);
    return null;
}

const WBLOCK_PREFS_KEY = 'traco.wblock';

function loadWblockPrefs(storage) {
    try {
        const saved = JSON.parse(storage?.getItem(WBLOCK_PREFS_KEY) ?? 'null');
        if (!saved || typeof saved !== 'object') return {};
        const prefs = {};
        if (typeof saved.path === 'string' && saved.path) prefs.wblockPath = saved.path;
        if (typeof saved.name === 'string' && saved.name) prefs.wblockName = saved.name;
        return prefs;
    } catch {
        return {};
    }
}

function saveWblockPrefs(storage, memory) {
    try {
        storage?.setItem(WBLOCK_PREFS_KEY, JSON.stringify({ path: memory.wblockPath ?? null, name: memory.wblockName ?? null }));
    } catch {
        // armazenamento cheio ou bloqueado: vale só para esta aba
    }
}

async function fileExists(bridge, path) {
    try {
        if (typeof bridge.fileExists === 'function') return !!(await bridge.fileExists(path));
        if (typeof bridge.readFileBinary !== 'function') return false;
        await bridge.readFileBinary(path);
        return true;
    } catch {
        return false;
    }
}


// ---------------------------------------------------------------------------
// Hachura

async function hatch(editor) {
    const ids = await editor.getSelection('Selecione contornos fechados (polilinha, círculo, elipse, spline) ou uma cadeia de linhas e arcos:');
    if (ids.length === 0) return null;
    const entities = editor.entitiesById(ids);
    const loops = loopsFromEntities(entities);
    if (loops.length === 0) return editor.log('Nenhum contorno fechado na seleção.', 'error');
    const patternKeys = Object.keys(HATCH_PATTERNS);
    const options = patternKeys.map((k) => ({ key: k === 'SOLID' ? 's' : k === 'ANSI31' ? 'l' : k === 'ANSI37' ? 'c' : 'p', label: HATCH_PATTERNS[k].label, pattern: k }));
    const chosen = await editor.getKeyword('Padrão', options, editor.memory.hatchKey ?? 'l');
    editor.memory.hatchKey = chosen.key;
    const pattern = chosen.pattern;
    let angle = 45;
    let spacing = editor.memory.hatchSpacing ?? 3;
    if (pattern !== 'SOLID') {
        angle = await editor.getNumber('Ângulo', { defaultValue: editor.memory.hatchAngle ?? 45 });
        spacing = await editor.getNumber('Espaçamento', { defaultValue: spacing });
        if (!(spacing > 0)) return editor.log('Espaçamento inválido.', 'error');
        editor.memory.hatchAngle = angle;
        editor.memory.hatchSpacing = spacing;
    }
    const entity = { type: 'hatch', loops, pattern, angle, spacing, opacity: 0.35, sourceIds: ids };
    editor.commit('Hachura', addEntities(editor.doc, [entity]));
    editor.clearSelection();
    editor.log(`Hachura ${HATCH_PATTERNS[pattern].label} com ${loops.length} laço(s).`);
    return null;
}

async function boundary(editor) {
    const options = [
        { key: 'p', label: 'Ponto interno' },
        { key: 's', label: 'Seleção' },
    ];
    const res = await editor.getPoint('Especifique ponto interno ou [Seleção] <Ponto interno>:', {
        options,
        allowEnter: false,
    });
    if (!res) return null;

    let targetLoops = [];
    if (res.keyword === 's') {
        const ids = await editor.getSelection('Selecione objetos que formam o contorno fechado:');
        if (!ids.length) return null;
        const entities = editor.entitiesById(ids);
        targetLoops = loopsFromEntities(entities);
    } else if (res.point) {
        const pt = res.point;
        const candidates = editableEntities(editor.doc);
        const allLoops = loopsFromEntities(candidates);
        targetLoops = allLoops.filter((loop) => pointInPolygon(pt, loop.vertices));
        if (targetLoops.length === 0) {
            candidates.filter((e) => e.type === 'circle').forEach((c) => {
                if (distance(pt, c.center) < c.radius) {
                    targetLoops.push({
                        vertices: [
                            { x: c.center.x - c.radius, y: c.center.y, bulge: 1 },
                            { x: c.center.x + c.radius, y: c.center.y, bulge: 1 },
                        ],
                    });
                }
            });
        }
    }

    if (targetLoops.length === 0) {
        editor.log('Nenhum contorno fechado válido encontrado.', 'warn');
        return null;
    }

    const polylines = targetLoops.map((loop) => ({
        type: 'polyline',
        closed: true,
        vertices: loop.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge ?? 0 })),
        layer: editor.doc.currentLayer,
    }));

    editor.commit('Contorno (Boundary)', addEntities(editor.doc, polylines));
    editor.clearSelection();
    editor.log(`${polylines.length} polilinha(s) de contorno criada(s) no layer "${editor.doc.currentLayer}".`);
    return null;
}

async function dimPart(editor) {
    let ids = [...editor.selection];
    if (ids.length === 0) ids = editor.doc.entities.filter((e) => !['dimension', 'hatch', 'image', 'text'].includes(e.type)).map((e) => e.id);
    const entities = editor.entitiesById(ids);
    if (entities.length === 0) return editor.log('Nada para cotar.', 'warn');
    ensureDimensionSetup(editor);
    const layerName = DIMENSION_LAYER;
    let doc = editor.doc;
    const dims = autoDimensionPart(entities, { dimStyle: doc.dimStyle, layer: layerName });
    if (dims.length === 0) return editor.log('Não foi possível gerar cotas para essa seleção.', 'warn');
    editor.commit('Cotar peça', addEntities(doc, dims));
    editor.clearSelection();
    editor.log(`${dims.length} cota(s) geradas no layer ${layerName}: gerais, posições de furos, diâmetros e raios.`);
    return null;
}

// ---------------------------------------------------------------------------
// Cotas

function dimPreview(editor, base) {
    return (cursor) => {
        const entity = { ...base, layer: base.layer ?? DIMENSION_LAYER, linePoint: cursor };
        if (base.kind === 'auto') entity.kind = chooseLinearKind(base.p1, base.p2, cursor);
        return [{ ...entity, type: 'dimension' }];
    };
}

async function placeDimension(editor, base, prompt = 'Posição da linha de cota') {
    ensureDimensionSetup(editor, [base.p1, base.p2].filter(Boolean));
    const res = await editor.getPoint(prompt, { preview: dimPreview(editor, base) });
    if (!res.point) return null;
    const entity = { ...base, type: 'dimension', layer: base.layer ?? DIMENSION_LAYER, linePoint: res.point };
    if (base.kind === 'auto') entity.kind = chooseLinearKind(base.p1, base.p2, res.point);
    const doc = addEntities(editor.doc, [entity]);
    editor.commit('Cota', doc);
    const created = doc.entities[doc.entities.length - 1];
    editor.memory = editor.memory ?? {};
    editor.memory.lastDimensionId = created?.id ?? entity.id;
    const g = dimensionGeometry(created ?? entity, editor.doc.dimStyle);
    editor.log(`Cota ${entity.kind}: ${g.text}`);
    return created ?? entity;
}

async function dimAuto(editor) {
    ensureDimensionSetup(editor);
    for (;;) {
        const first = await editor.getPointOrEntity('Primeiro ponto da cota [ou selecione círculo/arco, Enter para sair]:', { allowEnter: true });
        if (first.enter) return;

        // Se o clique atingiu diretamente um círculo ou arco: cota raio ou diâmetro diretamente
        if (first.entity && (first.entity.type === 'circle' || first.entity.type === 'arc')) {
            const base = autoDimensionFor(first.entity, first.pickPoint ?? first.point);
            if (base) {
                await placeDimension(editor, base, base.kind === 'radius' ? 'Posição do texto do raio' : 'Posição do texto do diâmetro');
                continue;
            }
        }

        const p1 = first.point;
        if (!p1) continue;

        const second = await editor.getPoint('Segundo ponto da cota [ou Enter para cotar objeto selecionado]:', {
            reference: p1,
            allowEnter: true,
            preview: (cursor) => [{ type: 'line', start: p1, end: cursor }],
        });

        // Se o usuário deu Enter no segundo ponto e clicou sobre um objeto no primeiro, cota o objeto linear
        if (second.enter && first.entity) {
            const base = autoDimensionFor(first.entity, first.pickPoint ?? p1);
            if (base) {
                if (base.auto === 'linear') base.kind = 'auto';
                await placeDimension(editor, base, 'Posição da linha de cota');
                continue;
            }
        }

        if (!second.point) continue;
        await placeDimension(editor, { kind: 'auto', p1, p2: second.point });
    }
}

async function dimLinear(editor) {
    ensureDimensionSetup(editor);
    const first = await editor.getPoint('Primeiro ponto da cota linear [ou Enter/O para selecionar objeto]:', {
        allowEnter: true,
        options: [{ key: 'o', label: 'Objeto' }],
    });
    if (!first) return null;

    let p1;
    let p2;
    if (first.enter || first.keyword === 'o') {
        const pick = await editor.getEntity('Selecione linha ou objeto para cotar:');
        if (!pick) return null;
        const base = autoDimensionFor(pick.entity, pick.point);
        if (!base || base.auto !== 'linear') return editor.log('Selecione uma linha ou objeto linear.', 'warn');
        p1 = base.p1;
        p2 = base.p2;
    } else if (first.point) {
        p1 = first.point;
        const second = await editor.getPoint('Segundo ponto da cota linear:', {
            reference: p1,
            preview: (cursor) => [{ type: 'line', start: p1, end: cursor }],
        });
        if (!second?.point) return null;
        p2 = second.point;
    } else {
        return null;
    }

    const res = await editor.getPoint('Posição da linha de cota', {
        options: [{ key: 'h', label: 'Horizontal' }, { key: 'v', label: 'Vertical' }, { key: 'a', label: 'Alinhada' }],
        preview: dimPreview(editor, { kind: 'auto', p1, p2 }),
    });
    if (!res?.point && !res?.keyword) return null;
    let kind;
    if (res.keyword) {
        kind = { h: 'horizontal', v: 'vertical', a: 'aligned' }[res.keyword];
        return placeDimension(editor, { kind, p1, p2 });
    }
    kind = chooseLinearKind(p1, p2, res.point);
    if (kind === 'aligned') kind = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? 'horizontal' : 'vertical';
    const entity = { type: 'dimension', kind, p1, p2, layer: DIMENSION_LAYER, linePoint: res.point };
    const doc = addEntities(editor.doc, [entity]);
    editor.commit('Cota', doc);
    const created = doc.entities[doc.entities.length - 1];
    editor.memory = editor.memory ?? {};
    editor.memory.lastDimensionId = created?.id ?? entity.id;
    editor.log(`Cota ${kind}: ${dimensionGeometry(created ?? entity, editor.doc.dimStyle).text}`);
    return created ?? entity;
}

async function dimAligned(editor) {
    ensureDimensionSetup(editor);
    const first = await editor.getPoint('Primeiro ponto da cota alinhada [ou Enter/O para selecionar objeto]:', {
        allowEnter: true,
        options: [{ key: 'o', label: 'Objeto' }],
    });
    if (!first) return null;

    let p1;
    let p2;
    if (first.enter || first.keyword === 'o') {
        const pick = await editor.getEntity('Selecione linha ou objeto para cotar:');
        if (!pick) return null;
        const base = autoDimensionFor(pick.entity, pick.point);
        if (!base || base.auto !== 'linear') return editor.log('Selecione uma linha ou objeto linear.', 'warn');
        p1 = base.p1;
        p2 = base.p2;
    } else if (first.point) {
        p1 = first.point;
        const second = await editor.getPoint('Segundo ponto da cota alinhada:', {
            reference: p1,
            preview: (cursor) => [{ type: 'line', start: p1, end: cursor }],
        });
        if (!second?.point) return null;
        p2 = second.point;
    } else {
        return null;
    }

    return placeDimension(editor, { kind: 'aligned', p1, p2 });
}

async function dimHorizontal(editor) {
    ensureDimensionSetup(editor);
    const first = await editor.getPoint('Primeiro ponto da cota horizontal [ou Enter/O para selecionar objeto]:', {
        allowEnter: true,
        options: [{ key: 'o', label: 'Objeto' }],
    });
    if (!first) return null;
    let p1;
    let p2;
    if (first.enter || first.keyword === 'o') {
        const pick = await editor.getEntity('Selecione linha ou objeto para cotar horizontalmente:');
        if (!pick) return null;
        const base = autoDimensionFor(pick.entity, pick.point);
        if (!base || base.auto !== 'linear') return editor.log('Selecione uma linha ou objeto linear.', 'warn');
        p1 = base.p1;
        p2 = base.p2;
    } else if (first.point) {
        p1 = first.point;
        const second = await editor.getPoint('Segundo ponto da cota horizontal:', {
            reference: p1,
            preview: (cursor) => [{ type: 'line', start: p1, end: cursor }],
        });
        if (!second?.point) return null;
        p2 = second.point;
    } else {
        return null;
    }
    return placeDimension(editor, { kind: 'horizontal', p1, p2 });
}

async function dimVertical(editor) {
    ensureDimensionSetup(editor);
    const first = await editor.getPoint('Primeiro ponto da cota vertical [ou Enter/O para selecionar objeto]:', {
        allowEnter: true,
        options: [{ key: 'o', label: 'Objeto' }],
    });
    if (!first) return null;
    let p1;
    let p2;
    if (first.enter || first.keyword === 'o') {
        const pick = await editor.getEntity('Selecione linha ou objeto para cotar verticalmente:');
        if (!pick) return null;
        const base = autoDimensionFor(pick.entity, pick.point);
        if (!base || base.auto !== 'linear') return editor.log('Selecione uma linha ou objeto linear.', 'warn');
        p1 = base.p1;
        p2 = base.p2;
    } else if (first.point) {
        p1 = first.point;
        const second = await editor.getPoint('Segundo ponto da cota vertical:', {
            reference: p1,
            preview: (cursor) => [{ type: 'line', start: p1, end: cursor }],
        });
        if (!second?.point) return null;
        p2 = second.point;
    } else {
        return null;
    }
    return placeDimension(editor, { kind: 'vertical', p1, p2 });
}

function isLinearOrAligned(entity) {
    return entity?.type === 'dimension' && ['horizontal', 'vertical', 'aligned', 'rotated'].includes(entity.kind);
}

function findBaseDimension(editor) {
    if (editor.memory?.lastDimensionId) {
        const found = editor.doc.entities.find((e) => e.id === editor.memory.lastDimensionId);
        if (found && isLinearOrAligned(found)) return found;
    }
    for (let i = editor.doc.entities.length - 1; i >= 0; i -= 1) {
        const e = editor.doc.entities[i];
        if (isLinearOrAligned(e)) return e;
    }
    return null;
}

function getDimensionNormal(entity) {
    let dir;
    if (entity.kind === 'horizontal') {
        dir = { x: 1, y: 0 };
    } else if (entity.kind === 'vertical') {
        dir = { x: 0, y: 1 };
    } else if (entity.kind === 'rotated') {
        const angle = ((entity.rotation ?? 0) * Math.PI) / 180;
        dir = { x: Math.cos(angle), y: Math.sin(angle) };
    } else {
        dir = normalize(sub(entity.p2, entity.p1));
        if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };
    }
    return perpendicular(dir);
}

async function dimContinue(editor) {
    ensureDimensionSetup(editor);
    let base = findBaseDimension(editor);

    if (!base) {
        const pick = await editor.getEntity('Selecione cota linear ou alinhada para continuar:');
        if (!pick || !isLinearOrAligned(pick.entity)) {
            return editor.log('Nenhuma cota linear ou alinhada selecionada.', 'warn');
        }
        base = pick.entity;
        if (pick.point && distance(pick.point, base.p1) < distance(pick.point, base.p2)) {
            base = { ...base, p1: base.p2, p2: base.p1 };
        }
    }

    let currentBase = base;
    let startPoint = currentBase.p2;

    for (;;) {
        const res = await editor.getPoint('Segundo ponto da cota contínua [ou Enter/S para selecionar cota]:', {
            reference: startPoint,
            allowEnter: true,
            options: [{ key: 's', label: 'Selecionar' }],
            preview: (cursor) => [
                {
                    type: 'dimension',
                    kind: currentBase.kind,
                    p1: startPoint,
                    p2: cursor,
                    linePoint: currentBase.linePoint,
                    layer: currentBase.layer ?? DIMENSION_LAYER,
                    rotation: currentBase.rotation,
                },
            ],
        });

        if (!res || res.enter || res.keyword === 's') {
            if (res?.keyword === 's' || !res?.enter) {
                const pick = await editor.getEntity('Selecione cota linear ou alinhada para continuar:');
                if (pick && isLinearOrAligned(pick.entity)) {
                    currentBase = pick.entity;
                    if (pick.point && distance(pick.point, currentBase.p1) < distance(pick.point, currentBase.p2)) {
                        currentBase = { ...currentBase, p1: currentBase.p2, p2: currentBase.p1 };
                    }
                    startPoint = currentBase.p2;
                    continue;
                }
            }
            break;
        }

        if (!res.point) break;
        const newP2 = res.point;
        const newEntity = {
            type: 'dimension',
            kind: currentBase.kind,
            p1: startPoint,
            p2: newP2,
            linePoint: currentBase.linePoint,
            layer: currentBase.layer ?? DIMENSION_LAYER,
            rotation: currentBase.rotation,
        };
        const doc = addEntities(editor.doc, [newEntity]);
        editor.commit('Cota contínua', doc);
        const created = doc.entities[doc.entities.length - 1];
        editor.memory = editor.memory ?? {};
        editor.memory.lastDimensionId = created?.id ?? newEntity.id;
        const g = dimensionGeometry(created ?? newEntity, editor.doc.dimStyle);
        editor.log(`Cota contínua ${newEntity.kind}: ${g.text}`);
        currentBase = created ?? newEntity;
        startPoint = newP2;
    }
}

async function dimBaseline(editor) {
    ensureDimensionSetup(editor);
    let base = findBaseDimension(editor);

    if (!base) {
        const pick = await editor.getEntity('Selecione cota linear ou alinhada para linha base:');
        if (!pick || !isLinearOrAligned(pick.entity)) {
            return editor.log('Nenhuma cota linear ou alinhada selecionada.', 'warn');
        }
        base = pick.entity;
        if (pick.point && distance(pick.point, base.p2) < distance(pick.point, base.p1)) {
            base = { ...base, p1: base.p2, p2: base.p1 };
        }
    }

    let currentBase = base;
    let baseOrigin = currentBase.p1;
    let currentLinePoint = currentBase.linePoint;

    for (;;) {
        const n = getDimensionNormal(currentBase);
        const offset = dot(sub(currentLinePoint, currentBase.p1), n);
        const sign = offset < 0 ? -1 : 1;
        const spacing = (editor.doc.dimStyle?.dimDli ?? (editor.doc.dimStyle?.textHeight ?? 2.5) * 3.75) * (editor.doc.dimStyle?.scale ?? 1);
        const step = scale(n, sign * spacing);
        const nextLinePoint = add(currentLinePoint, step);

        const res = await editor.getPoint('Segundo ponto da cota por linha base [ou Enter/S para selecionar cota]:', {
            reference: baseOrigin,
            allowEnter: true,
            options: [{ key: 's', label: 'Selecionar' }],
            preview: (cursor) => [
                {
                    type: 'dimension',
                    kind: currentBase.kind,
                    p1: baseOrigin,
                    p2: cursor,
                    linePoint: nextLinePoint,
                    layer: currentBase.layer ?? DIMENSION_LAYER,
                    rotation: currentBase.rotation,
                },
            ],
        });

        if (!res || res.enter || res.keyword === 's') {
            if (res?.keyword === 's' || !res?.enter) {
                const pick = await editor.getEntity('Selecione cota linear ou alinhada para linha base:');
                if (pick && isLinearOrAligned(pick.entity)) {
                    currentBase = pick.entity;
                    if (pick.point && distance(pick.point, currentBase.p2) < distance(pick.point, currentBase.p1)) {
                        currentBase = { ...currentBase, p1: currentBase.p2, p2: currentBase.p1 };
                    }
                    baseOrigin = currentBase.p1;
                    currentLinePoint = currentBase.linePoint;
                    continue;
                }
            }
            break;
        }

        if (!res.point) break;
        const newP2 = res.point;
        currentLinePoint = nextLinePoint;
        const newEntity = {
            type: 'dimension',
            kind: currentBase.kind,
            p1: baseOrigin,
            p2: newP2,
            linePoint: currentLinePoint,
            layer: currentBase.layer ?? DIMENSION_LAYER,
            rotation: currentBase.rotation,
        };
        const doc = addEntities(editor.doc, [newEntity]);
        editor.commit('Cota por linha base', doc);
        const created = doc.entities[doc.entities.length - 1];
        editor.memory = editor.memory ?? {};
        editor.memory.lastDimensionId = created?.id ?? newEntity.id;
        const g = dimensionGeometry(created ?? newEntity, editor.doc.dimStyle);
        editor.log(`Cota por linha base ${newEntity.kind}: ${g.text}`);
    }
}

async function dimCenter(editor) {
    ensureDimensionSetup(editor);
    let count = 0;
    for (;;) {
        const pick = await editor.getEntity('Selecione arco ou círculo:', {
            allowEnter: true,
            filter: (e) => ['circle', 'arc'].includes(e.type),
        });
        if (!pick || pick.enter || !pick.entity) break;
        const target = pick.entity;
        if (!['circle', 'arc'].includes(target.type)) {
            editor.log('O objeto selecionado não é um arco ou círculo.', 'warn');
            continue;
        }

        const center = target.center;
        const dimStyle = editor.doc.dimStyle ?? {};
        const scaleFactor = dimStyle.scale ?? dimStyle.dimScale ?? 1.0;
        const rawCen = dimStyle.dimCen ?? 2.5;
        const size = Math.abs(rawCen) * scaleFactor;

        const dimLayer = editor.doc.layers?.some((l) => l.name === DIMENSION_LAYER) ? DIMENSION_LAYER : editor.doc.currentLayer;

        const hLine = {
            type: 'line',
            start: { x: center.x - size, y: center.y },
            end: { x: center.x + size, y: center.y },
            layer: dimLayer,
        };
        const vLine = {
            type: 'line',
            start: { x: center.x, y: center.y - size },
            end: { x: center.x, y: center.y + size },
            layer: dimLayer,
        };

        const linesToAdd = [hLine, vLine];

        if (rawCen < 0) {
            const r = target.radius;
            const ext = size;
            const gap = size;
            if (r > gap + ext) {
                linesToAdd.push(
                    { type: 'line', start: { x: center.x + gap, y: center.y }, end: { x: center.x + r + ext, y: center.y }, layer: dimLayer },
                    { type: 'line', start: { x: center.x - gap, y: center.y }, end: { x: center.x - (r + ext), y: center.y }, layer: dimLayer },
                    { type: 'line', start: { x: center.x, y: center.y + gap }, end: { x: center.x, y: center.y + r + ext }, layer: dimLayer },
                    { type: 'line', start: { x: center.x, y: center.y - gap }, end: { x: center.x, y: center.y - (r + ext) }, layer: dimLayer }
                );
            }
        }

        editor.commit('Marca de centro', addEntities(editor.doc, linesToAdd));
        editor.log(`Marca de centro inserida em (${formatNumber(center.x, 2)}, ${formatNumber(center.y, 2)}).`);
        count += 1;
    }
    if (count > 0) editor.log(`${count} marca(s) de centro criada(s).`);
}

async function dimRadial(editor, kind) {
    ensureDimensionSetup(editor);
    const pick = await editor.getEntity(kind === 'radius' ? 'Selecione arco ou círculo' : 'Selecione círculo ou arco', { filter: (e) => ['circle', 'arc', 'polyline'].includes(e.type) });
    if (!pick) return null;
    const base = autoDimensionFor(pick.entity, pick.point);
    if (!base || base.center === undefined) return editor.log('Selecione um arco ou círculo.', 'warn');
    return placeDimension(editor, { kind, center: base.center, radius: base.radius }, kind === 'radius' ? 'Posição do texto do raio' : 'Posição do texto do diâmetro');
}

async function dimAngular(editor) {
    ensureDimensionSetup(editor);
    const first = await editor.getPointOrEntity('Selecione primeiro objeto (linha ou arco) ou [Enter para 3 pontos]:', { allowEnter: true });
    if (first.enter) {
        const v = (await editor.getPoint('Vértice do ângulo:')).point;
        if (!v) return null;
        const p1 = (await editor.getPoint('Primeiro extremo do ângulo:', { reference: v, preview: (cursor) => [{ type: 'line', start: v, end: cursor }] })).point;
        if (!p1) return null;
        const p2 = (await editor.getPoint('Segundo extremo do ângulo:', { reference: v, preview: (cursor) => [{ type: 'line', start: v, end: cursor }] })).point;
        if (!p2) return null;
        return placeDimension(editor, { kind: 'angular', vertex: v, p1, p2 }, 'Posição do arco de cota');
    }

    if (first.entity?.type === 'arc') {
        const arc = first.entity;
        const p1 = polar(arc.center, arc.start, arc.radius);
        const p2 = polar(arc.center, arc.end, arc.radius);
        return placeDimension(editor, { kind: 'angular', vertex: arc.center, p1, p2 }, 'Posição do arco de cota');
    }

    let line1 = null;
    let pick1 = first.point;
    if (first.entity?.type === 'line') {
        line1 = first.entity;
    } else if (first.point) {
        const hit = editor.hitTest(first.point, { filter: (e) => e.type === 'line' });
        if (hit) line1 = hit;
    }

    if (!line1) {
        return editor.log('Selecione uma linha ou arco.', 'warn');
    }
    pick1 = pick1 ?? midpoint(line1.start, line1.end);

    const second = await editor.getEntity('Selecione a segunda linha:', { filter: (e) => e.type === 'line' && e.id !== line1.id });
    if (!second?.entity) return null;
    const line2 = second.entity;
    const pick2 = second.point ?? midpoint(line2.start, line2.end);

    const inter = intersectLines(line1.start, line1.end, line2.start, line2.end);
    if (!inter) {
        return editor.log('Linhas são paralelas.', 'warn');
    }
    const vertex = inter.point;

    let d1 = sub(pick1, vertex);
    if (Math.hypot(d1.x, d1.y) < 1e-4) d1 = sub(line1.end, line1.start);
    const p1 = add(vertex, normalize(d1));

    let d2 = sub(pick2, vertex);
    if (Math.hypot(d2.x, d2.y) < 1e-4) d2 = sub(line2.end, line2.start);
    const p2 = add(vertex, normalize(d2));

    return placeDimension(editor, { kind: 'angular', vertex, p1, p2 }, 'Posição do arco de cota');
}

async function dimScale(editor, args) {
    const current = editor.doc.dimStyle?.scale ?? 1;
    let raw;
    if (args[0] === 'auto') {
        const box = getDrawingContentBox(editor.doc);
        const maxDim = !boxIsEmpty(box) ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : 0;
        raw = computeAutoDimScale(maxDim);
        editor.log(`Escala calculada automaticamente: ${raw}x (conteúdo: ${Math.round(maxDim)} mm).`);
    } else {
        raw = args[0] !== undefined ? Number(args[0]) : await editor.getNumber('Escala das cotas (texto e setas) ou [auto]', { defaultValue: current });
    }
    if (!(raw > 0)) return editor.log('Escala inválida.', 'error');
    editor.commit('Escala de cotas', { ...editor.doc, dimStyle: { ...editor.doc.dimStyle, scale: raw } });
    editor.log(`Escala das cotas: ${raw}`);
    return null;
}

async function dimPrecision(editor, args) {
    const current = editor.doc.dimStyle?.precision ?? 2;
    const raw = args[0] !== undefined ? Number(args[0]) : await editor.getNumber('Casas decimais das cotas', { defaultValue: current });
    if (!Number.isInteger(raw) || raw < 0 || raw > 6) return editor.log('Informe um inteiro entre 0 e 6.', 'error');
    editor.commit('Precisão de cotas', { ...editor.doc, dimStyle: { ...editor.doc.dimStyle, precision: raw } });
    return null;
}

// ---------------------------------------------------------------------------
// Consulta

async function dist(editor) {
    const a = (await editor.getPoint('Primeiro ponto:')).point;
    const b = (await editor.getPoint('Segundo ponto:', { reference: a, preview: (cursor) => [{ type: 'line', start: a, end: cursor }] })).point;
    const d = distance(a, b);
    editor.log(`Distância = ${fmt(d)}, ângulo = ${fmt(radToDeg(angleOf(a, b)))}°, ΔX = ${fmt(b.x - a.x)}, ΔY = ${fmt(b.y - a.y)}`);
}

async function id(editor) {
    const p = (await editor.getPoint('Ponto:')).point;
    if (!p) return;
    editor.log(`X = ${fmt(p.x)}  Y = ${fmt(p.y)}  Z = 0.000`);
}

async function list(editor) {
    const ids = await editor.getSelection('Selecione objetos para listar:');
    editor.entitiesById(ids).forEach((e) => {
        const base = `${e.type.toUpperCase()}  layer "${e.layer}"  cor ${e.color === BYLAYER ? 'ByLayer' : e.color}`;
        switch (e.type) {
            case 'line':
                editor.log(`${base}\n  de ${fmtPoint(e.start)} até ${fmtPoint(e.end)}  comprimento ${fmt(distance(e.start, e.end))}  ângulo ${fmt(radToDeg(angleOf(e.start, e.end)))}°`);
                break;
            case 'circle':
                editor.log(`${base}\n  centro ${fmtPoint(e.center)}  raio ${fmt(e.radius)}  diâmetro ${fmt(e.radius * 2)}  perímetro ${fmt(entityLength(e))}`);
                break;
            case 'arc':
                editor.log(`${base}\n  centro ${fmtPoint(e.center)}  raio ${fmt(e.radius)}  início ${fmt(radToDeg(e.start))}°  fim ${fmt(radToDeg(e.end))}°  comprimento ${fmt(entityLength(e))}`);
                break;
            case 'polyline':
                editor.log(`${base}\n  ${e.vertices.length} vértices  ${e.closed ? 'fechada' : 'aberta'}  comprimento ${fmt(entityLength(e))}`);
                break;
            case 'text':
                editor.log(`${base}\n  "${e.text}" em ${fmtPoint(e.position)}  altura ${fmt(e.height)}  rotação ${fmt(e.rotation)}°`);
                break;
            case 'dimension': {
                const g = dimensionGeometry(e, editor.doc.dimStyle);
                editor.log(`${base}\n  cota ${e.kind}  valor ${g.text}  medida ${fmt(g.measurement)}`);
                break;
            }
            case 'ellipse':
                editor.log(`${base}\n  centro ${fmtPoint(e.center)}  semieixo maior ${fmt(Math.hypot(e.major.x, e.major.y))}  razão ${fmt(e.ratio)}  perímetro ≈ ${fmt(entityLength(e))}`);
                break;
            case 'spline':
                editor.log(`${base}\n  grau ${e.degree}  ${e.controlPoints?.length ?? 0} pontos de controle  ${e.fitPoints?.length ?? 0} pontos de ajuste  comprimento ≈ ${fmt(entityLength(e))}`);
                break;
            case 'hatch':
                editor.log(`${base}\n  hachura ${e.pattern}  ângulo ${fmt(e.angle ?? 45)}°  espaçamento ${fmt(e.spacing ?? 3)}  ${e.loops.length} laço(s)`);
                break;
            case 'image':
                editor.log(`${base}\n  imagem em ${fmtPoint(e.position)}  ${fmt(e.width)} × ${fmt(e.height)}  rotação ${fmt(e.rotation ?? 0)}°`);
                break;
            default:
                editor.log(base);
        }
    });
}

async function area(editor) {
    let mode = 'single'; // 'single' | 'add' | 'subtract'
    let totalArea = 0;
    let hasAccumulated = false;

    for (;;) {
        const prompt = mode !== 'single'
            ? `Especifique o primeiro ponto do canto ou [Objeto/Adicionar área/Subtrair área/Enter para sair]:`
            : `Especifique o primeiro ponto do canto ou [Objeto/Adicionar área/Subtrair área]:`;

        const options = [
            { key: 'o', label: 'Objeto' },
            { key: 'a', label: 'Adicionar área' },
            { key: 's', label: 'Subtrair área' },
        ];

        const res = await editor.getPoint(prompt, {
            options,
            allowEnter: mode !== 'single',
        });

        if (!res || res.enter) break;

        if (res.keyword === 'a') {
            mode = 'add';
            editor.log('Modo: Adicionar área');
            continue;
        }

        if (res.keyword === 's') {
            mode = 'subtract';
            editor.log('Modo: Subtrair área');
            continue;
        }

        if (res.keyword === 'o') {
            const pick = await editor.getEntity('Selecione círculo, elipse ou polilinha fechada:');
            if (!pick) continue;
            const geom = getEntityAreaAndPerimeter(pick.entity);
            if (!geom) {
                editor.log('Objeto selecionado não possui área fechada mensurável.', 'warn');
                continue;
            }
            if (mode === 'single') {
                editor.log(`Área = ${fmt(geom.area)}, Perímetro = ${fmt(geom.perimeter)}`);
                return;
            }
            if (mode === 'add') {
                totalArea += geom.area;
            } else {
                totalArea -= geom.area;
            }
            hasAccumulated = true;
            editor.log(`Área = ${fmt(geom.area)}, Perímetro = ${fmt(geom.perimeter)}, Área total = ${fmt(totalArea)}`);
            continue;
        }

        if (res.point) {
            const pts = [res.point];

            for (;;) {
                const nextRes = await editor.getPoint('Especifique o próximo ponto ou <Enter> para finalizar contorno:', {
                    reference: pts[pts.length - 1],
                    allowEnter: true,
                    options: [{ key: 'u', label: 'Desfazer' }],
                    preview: (cursor) => {
                        const previewLines = [{ type: 'line', start: pts[pts.length - 1], end: cursor }];
                        if (pts.length >= 2) {
                            previewLines.push({ type: 'line', start: cursor, end: pts[0] });
                        }
                        return previewLines;
                    },
                });

                if (!nextRes || nextRes.enter) break;

                if (nextRes.keyword === 'u') {
                    if (pts.length > 1) pts.pop();
                    continue;
                }

                if (nextRes.point) {
                    pts.push(nextRes.point);
                }
            }

            if (pts.length >= 3) {
                const polyGeom = polygonAreaAndPerimeter(pts);
                if (mode === 'single') {
                    editor.log(`Área = ${fmt(polyGeom.area)}, Perímetro = ${fmt(polyGeom.perimeter)}`);
                    return;
                }
                if (mode === 'add') {
                    totalArea += polyGeom.area;
                } else {
                    totalArea -= polyGeom.area;
                }
                hasAccumulated = true;
                editor.log(`Área = ${fmt(polyGeom.area)}, Perímetro = ${fmt(polyGeom.perimeter)}, Área total = ${fmt(totalArea)}`);
            } else {
                editor.log('Mínimo de 3 pontos para calcular área.', 'warn');
                if (mode === 'single') return;
            }

            if (mode === 'single') break;
        }
    }
}

async function measureGeom(editor) {
    const options = [
        { key: 'd', label: 'Distância' },
        { key: 'r', label: 'Raio' },
        { key: 'a', label: 'Ângulo' },
        { key: 'ar', label: 'Área' },
        { key: 'q', label: 'Rápido' },
    ];

    const kw = await editor.getKeyword('Selecione opção de medição [Distância/Raio/Ângulo/Área/Rápido] <Distância>:', options, 'd');
    if (!kw) return;

    if (kw.key === 'd') {
        return dist(editor);
    }
    if (kw.key === 'r') {
        const pick = await editor.getEntity('Selecione arco ou círculo:', {
            filter: (e) => ['circle', 'arc'].includes(e.type),
        });
        if (!pick) return;
        const e = pick.entity;
        editor.log(`Raio = ${fmt(e.radius)}, Diâmetro = ${fmt(e.radius * 2)}`);
        return;
    }
    if (kw.key === 'a') {
        const pick1 = await editor.getEntity('Selecione a primeira linha ou arco:');
        if (!pick1) return;
        const e1 = pick1.entity;
        if (e1.type === 'arc') {
            const sweep = radToDeg(sweepCCW(e1.start, e1.end));
            editor.log(`Ângulo do arco = ${fmt(sweep)}°`);
            return;
        }
        if (e1.type !== 'line') {
            editor.log('Entidade deve ser linha ou arco.', 'warn');
            return;
        }
        const pick2 = await editor.getEntity('Selecione a segunda linha:');
        if (!pick2) return;
        const e2 = pick2.entity;
        if (e2.type !== 'line') {
            editor.log('Segunda entidade deve ser linha.', 'warn');
            return;
        }
        const dir1 = normalize(sub(e1.end, e1.start));
        const dir2 = normalize(sub(e2.end, e2.start));
        let cos = Math.min(1, Math.max(-1, dot(dir1, dir2)));
        let angDeg = radToDeg(Math.acos(cos));
        editor.log(`Ângulo entre linhas = ${fmt(angDeg)}° (ou ${fmt(180 - angDeg)}°)`);
        return;
    }
    if (kw.key === 'ar') {
        return area(editor);
    }
    if (kw.key === 'q') {
        return list(editor);
    }
}

// ---------------------------------------------------------------------------
// Visualização e arquivo

async function zoom(editor, args) {
    const options = [{ key: 'e', label: 'Extensão' }, { key: 'w', label: 'Janela' }, { key: 'a', label: 'Tudo' }, { key: 'o', label: 'Objeto' }, { key: 'p', label: 'Anterior' }];
    let res;
    if (args[0]) {
        const direct = options.find((o) => o.key === args[0].toLowerCase()) ?? null;
        const factor = Number(args[0].replace('x', ''));
        if (direct) res = { keyword: direct.key };
        else if (Number.isFinite(factor) && factor > 0) res = { number: factor };
    }
    if (!res) res = await editor.getPoint('Canto da janela de zoom ou fator', { options, allowNumber: true, allowEnter: true });
    if (res.enter) return editor.zoomExtents();
    if (res.number !== undefined) return editor.zoomBy(res.number);
    if (res.keyword === 'e' || res.keyword === 'a') return editor.zoomExtents();
    if (res.keyword === 'p') return editor.zoomPrevious();
    if (res.keyword === 'o') {
        const ids = await editor.getSelection('Selecione objetos:');
        return editor.zoomToBox(boxOf(editor.entitiesById(ids)));
    }
    const a = res.keyword === 'w' ? (await editor.getPoint('Primeiro canto:')).point : res.point;
    const b = (await editor.getPoint('Canto oposto:', { reference: a, window: a })).point;
    const box = emptyBox();
    boxAddPoint(box, a);
    boxAddPoint(box, b);
    editor.zoomToBox(box);
}

async function pan(editor) {
    editor.log('Arraste com o botão do meio ou use a roda para navegar. Esc encerra.', 'info');
    await editor.panMode();
}

async function undo(editor) {
    const label = editor.undo();
    editor.log(label ? `Desfeito: ${label}` : 'Nada para desfazer.');
}

async function redo(editor) {
    const label = editor.redo();
    editor.log(label ? `Refeito: ${label}` : 'Nada para refazer.');
}

async function layer(editor, args) {
    if (args.length === 0 && editor.openLayerManager) {
        editor.openLayerManager();
        return;
    }
    const name = args[0] ?? (await editor.getString('Nome do layer atual', { defaultValue: editor.doc.currentLayer }));
    if (!name) return;
    editor.commit('Layer', setCurrentLayer(editor.doc, name));
    editor.log(`Layer atual: ${name}`);
}

async function layerNew(editor, args) {
    const name = args[0] ?? (await editor.getString('Nome do novo layer'));
    if (!name) return;
    editor.commit('Layer', setCurrentLayer(editor.doc, name));
    editor.log(`Layer criado e atual: ${name}`);
}

async function layerOff(editor, args) {
    const name = args[0] ?? (await editor.getString('Layer para desligar'));
    if (!layerOf(editor.doc, name)) return editor.log('Layer inexistente.', 'error');
    editor.commit('Desligar layer', updateLayer(editor.doc, name, { visible: false }));
}

async function layerOn(editor, args) {
    const name = args[0] ?? (await editor.getString('Layer para ligar'));
    if (!layerOf(editor.doc, name)) return editor.log('Layer inexistente.', 'error');
    editor.commit('Ligar layer', updateLayer(editor.doc, name, { visible: true }));
}

async function color(editor, args) {
    const ids = await editor.getSelection('Selecione objetos para alterar cor:');
    const raw = args[0] ?? (await editor.getString('Cor (índice ACI 1-255, #hex ou BYLAYER)', { defaultValue: 'BYLAYER' }));
    let value;
    if (/^bylayer$/i.test(raw)) value = BYLAYER;
    else if (/^#?[0-9a-f]{6}$/i.test(raw)) value = raw.startsWith('#') ? raw : `#${raw}`;
    else if (Number.isFinite(Number(raw))) value = Number(raw);
    else return editor.log('Cor inválida.', 'error');
    editor.commit('Cor', updateEntities(editor.doc, ids, (e) => ({ ...e, color: value })));
}

async function chprop(editor) {
    const ids = await editor.getSelection('Selecione objetos para mudar de layer:');
    const name = await editor.getString('Novo layer', { defaultValue: editor.doc.currentLayer });
    if (!name) return;
    let doc = setCurrentLayer(editor.doc, name);
    doc = { ...doc, currentLayer: editor.doc.currentLayer };
    editor.commit('Mudar layer', updateEntities(doc, ids, (e) => ({ ...e, layer: name })));
}

async function newDrawing(editor) {
    if (editor.tabs) {
        editor.tabs.add();
        return;
    }
    if (editor.doc.entities.length > 0) {
        const res = await editor.getKeyword('Descartar o desenho atual?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 'n');
        if (res.key !== 's') return;
    }
    editor.loadDocument(createDocument());
    editor.zoomExtents();
}

const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp' };

function extensionOfName(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ''));
    return m ? m[1].toLowerCase() : '';
}

async function open(editor) {
    const bridge = typeof window !== 'undefined' ? window.desktopBridge : null;
    let files = [];

    if (bridge && typeof bridge.showOpenDialog === 'function') {
        const selected = await bridge.showOpenDialog({
            multiple: true,
            filters: [
                { name: 'Desenhos, projetos CAD e imagens', extensions: ['dxf', 'dwg', 'lxds', 'svg', 'cdr', 'elmt', 'qet', 'jpg', 'jpeg', 'png', 'bmp'] },
                { name: 'Imagens (JPG, PNG, BMP)', extensions: ['jpg', 'jpeg', 'png', 'bmp'] },
                { name: 'Todos os arquivos', extensions: ['*'] },
            ],
        });
        const paths = (Array.isArray(selected) ? selected : [selected]).filter(Boolean);
        for (const filePath of paths) {
            const name = filePath.split(/[\/\\]/).pop() || 'desenho.dxf';
            let bytes;
            if (typeof bridge.readFileBinary === 'function') {
                bytes = await bridge.readFileBinary(filePath);
            } else {
                const text = await bridge.readFileText(filePath);
                bytes = new TextEncoder().encode(text);
            }
            const mime = name.toLowerCase().endsWith('.dwg') ? 'image/vnd.dwg' : (IMAGE_MIME[extensionOfName(name)] ?? 'application/octet-stream');
            const file = new File([new Uint8Array(bytes)], name, { type: mime });
            file.filePath = filePath;
            files.push(file);
        }
    } else if (typeof editor.pickFiles === 'function') {
        files = await editor.pickFiles(`${DRAWING_ACCEPT},${IMAGE_ACCEPT}`);
    } else {
        const file = await editor.pickFile(`${DRAWING_ACCEPT},${IMAGE_ACCEPT}`);
        if (file) files = [file];
    }
    if (!files.length) return null;

    const supported = files.filter((f) => DRAWING_KINDS.includes(kindOf(f.name)) || kindOf(f.name) === 'image');
    for (const f of files) {
        if (!supported.includes(f)) editor.log(`Formato não suportado pelo CAD: ${f.name}`, 'warn');
    }
    if (!supported.length) return null;

    if (typeof editor.openFiles === 'function') {
        return editor.openFiles(supported);
    }
    for (const file of supported) await openSingle(editor, file, file.filePath || file.path || null);
    return null;
}

async function openSingle(editor, file, filePath) {
    const kind = kindOf(file.name);
    if (typeof editor.openFile === 'function') {
        return editor.openFile(file, { filePath });
    }

    if (editor.tabs && typeof editor.tabs.findExistingTab === 'function') {
        const existing = editor.tabs.findExistingTab({ name: file.name, filePath });
        if (existing) {
            editor.tabs.activate(existing.id);
            editor.log(`O arquivo "${file.name}" já está aberto em uma aba. Alternando para a aba existente.`, 'info');
            return;
        }
    }
    if (kind === 'dwg') return editor.importDwgFile(file);
    if (editor.tabs && editor.doc?.entities?.length > 0) editor.tabs.add();
    if (kind === 'lxds') {
        await editor.importLxdsBuffer(await file.arrayBuffer(), file.name);
        return;
    }
    if (kind === 'cdr') {
        await editor.importCdrBuffer(await file.arrayBuffer(), file.name);
        return;
    }
    const text = await file.text();
    if (kind === 'elmt') {
        await editor.importElmtText(text, file.name);
        return;
    }
    if (kind === 'qet') {
        await editor.importQetText(text, file.name);
        return;
    }
    if (kind === 'svg') await editor.importSvgText(text, file.name);
    else await editor.importDxfText(text, file.name, { filePath });
}

async function openLxds(editor) {
    const file = await editor.pickFile('.lxds');
    if (!file) return;
    if (editor.tabs && editor.doc.entities.length > 0) editor.tabs.add();
    await editor.importLxdsBuffer(await file.arrayBuffer(), file.name);
}

async function openSvg(editor) {
    const file = await editor.pickFile('.svg');
    if (!file) return;
    if (editor.tabs && editor.doc.entities.length > 0) editor.tabs.add();
    await editor.importSvgText(await file.text(), file.name);
}

async function openCdr(editor) {
    const file = await editor.pickFile('.cdr');
    if (!file) return;
    if (editor.tabs && editor.doc.entities.length > 0) editor.tabs.add();
    await editor.importCdrBuffer(await file.arrayBuffer(), file.name);
}

async function openElmt(editor) {
    const file = await editor.pickFile('.elmt');
    if (!file) return;
    if (editor.tabs && editor.doc.entities.length > 0) editor.tabs.add();
    await editor.importElmtText(await file.text(), file.name);
}

async function openQet(editor) {
    const file = await editor.pickFile('.qet');
    if (!file) return;
    if (editor.tabs && editor.doc.entities.length > 0) editor.tabs.add();
    await editor.importQetText(await file.text(), file.name);
}

async function exportElmt(editor) {
    const { documentToElmt } = await import('./elmt.js');
    const xml = documentToElmt(editor.doc);
    const baseName = (editor.doc.name || 'elemento').replace(/\.(dxf|dwg|elmt|qet|svg|cdr)$/i, '');
    const filename = `${baseName}.elmt`;
    editor.downloadText(xml, filename);
    editor.log(`Exportado elemento QElectroTech ${filename} (${editor.doc.entities.length} entidades).`);
}

async function exportQet(editor) {
    const { documentToQet } = await import('./qet.js');
    const xml = documentToQet(editor.doc);
    const baseName = (editor.doc.name || 'projeto').replace(/\.(dxf|dwg|elmt|qet|svg|cdr)$/i, '');
    const filename = `${baseName}.qet`;
    editor.downloadText(xml, filename);
    editor.log(`Exportado projeto QElectroTech ${filename} (${editor.doc.entities.length} entidades).`);
}

async function terminalCommand(editor) {
    const ptRes = await editor.getPoint('Posição do terminal elétrico:');
    if (!ptRes?.point) return null;
    const pt = ptRes.point;

    const oriRes = await editor.getString('Orientação do terminal (N=Cima, S=Baixo, E=Direita, W=Esquerda)', {
        defaultValue: editor.memory.terminalOri || 'n',
    });
    let ori = (oriRes || 'n').trim().toLowerCase();
    if (!['n', 's', 'e', 'w'].includes(ori)) ori = 'n';
    editor.memory.terminalOri = ori;

    const nameRes = await editor.getString('Identificação do pino/terminal (ex: 01, A1, GND):', {
        defaultValue: '',
    });
    const name = (nameRes || '').trim();

    const { generateUuid } = await import('./elmt.js');
    const terminal = {
        type: 'terminal',
        layer: 'TERMINAIS',
        position: pt,
        orientation: ori,
        name: name,
        uuid: generateUuid(),
        terminalType: 'Generic',
    };

    let doc = editor.doc;
    const layers = doc.layers || [];
    if (!layers.some((l) => l.name === 'TERMINAIS')) {
        doc = {
            ...doc,
            layers: [...layers, { name: 'TERMINAIS', color: '#ef4444', lineType: 'CONTINUOUS', lineWeight: 35, visible: true, locked: false }],
        };
    }

    editor.commit('Terminal Elétrico', addEntities(doc, [terminal]));
    editor.log(`Terminal ${name ? `"${name}" ` : ''}(${ori.toUpperCase()}) inserido em (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}).`);
    return null;
}

async function getExportPayload(editor) {
    if (editor.doc.sourceFormat === 'elmt' || /\.elmt$/i.test(editor.doc.name || '')) {
        const { documentToElmt } = await import('./elmt.js');
        const content = documentToElmt(editor.doc);
        const baseName = (editor.doc.name || 'elemento').replace(/\.(dxf|dwg|elmt|qet|svg|cdr)$/i, '');
        return {
            content,
            name: `${baseName}.elmt`,
            ext: 'elmt',
            filterName: 'Elemento QElectroTech (*.elmt)',
        };
    }
    if (editor.doc.sourceFormat === 'qet' || /\.qet$/i.test(editor.doc.name || '')) {
        const { documentToQet } = await import('./qet.js');
        const content = documentToQet(editor.doc);
        const baseName = (editor.doc.name || 'projeto').replace(/\.(dxf|dwg|elmt|qet|svg|cdr)$/i, '');
        return {
            content,
            name: `${baseName}.qet`,
            ext: 'qet',
            filterName: 'Projeto QElectroTech (*.qet)',
        };
    }
    if (editor.doc.sourceFormat === 'dwg' || /\.dwg$/i.test(editor.doc.name || '')) {
        const { documentToDwg } = await import('./dwg.js');
        const view = editor.viewport?.getView ? editor.viewport.getView() : editor.doc.view;
        if (view) editor.doc.view = view;
        const content = await documentToDwg(editor.doc, { view });
        const baseName = (editor.doc.name || 'desenho').replace(/\.(dxf|dwg|elmt|qet|svg|cdr)$/i, '');
        return {
            content,
            name: `${baseName}.dwg`,
            ext: 'dwg',
            filterName: 'Desenho AutoCAD DWG (*.dwg)',
            isBinary: true,
        };
    }
    const name = editor.doc.name?.toLowerCase().endsWith('.dxf')
        ? editor.doc.name
        : `${editor.doc.name ? editor.doc.name.replace(/\.(dwg|svg|cdr)$/i, '') : 'desenho'}.dxf`;
    const view = editor.viewport?.getView ? editor.viewport.getView() : editor.doc.view;
    if (view) editor.doc.view = view;
    return {
        content: writeDxf(editor.doc, { view }),
        name,
        ext: 'dxf',
        filterName: 'Desenho DXF (*.dxf)',
    };
}

async function save(editor) {
    const payload = await getExportPayload(editor);

    // Para DXF: sempre forçar Salvar Como (SAVEAS), replicando a salvaguarda
    // canônica do AutoCAD e BricsCAD para arquivos de intercâmbio, impedindo
    // a sobrescrita silenciosa/acidental em disco e solicitando confirmação de destino/nome.
    if (payload.ext === 'dxf') {
        return saveAs(editor);
    }

    const bridge = typeof window !== 'undefined' ? window.desktopBridge : null;

    if (bridge && typeof bridge.saveFile === 'function') {
        if (editor.doc.filePath) {
            try {
                await bridge.saveFile(editor.doc.filePath, payload.content);
                editor.history?.markClean?.();
                editor.tabs?.render?.();
                editor.tabs?.save?.();
                editor.onDocumentSaved?.(payload.content?.length);
                usage('export_success');
                editor.log(`Salvo em ${editor.doc.filePath} (${editor.doc.entities.length} entidades).`, 'info');
                return null;
            } catch (error) {
                editor.log(`Falha ao salvar em ${editor.doc.filePath}: ${error.message}. Tentando Salvar Como...`, 'warn');
            }
        }
        return saveAs(editor);
    }

    if (payload.isBinary || payload.content instanceof Uint8Array) {
        editor.downloadFile(payload.content, payload.name, 'image/vnd.dwg');
    } else {
        editor.downloadText(payload.content, payload.name);
    }
    editor.history?.markClean?.();
    editor.tabs?.render?.();
    editor.tabs?.save?.();
    editor.log(`Exportado ${payload.name} (${editor.doc.entities.length} entidades).`);
    return null;
}

async function saveAs(editor) {
    const payload = await getExportPayload(editor);
    const bridge = typeof window !== 'undefined' ? window.desktopBridge : null;

    if (bridge && typeof bridge.showSaveDialog === 'function' && typeof bridge.saveFile === 'function') {
        const defaultPath = editor.doc.filePath || payload.name;
        const selected = await bridge.showSaveDialog({
            defaultPath,
            filters: [
                { name: payload.filterName, extensions: [payload.ext] },
                { name: 'Todos os arquivos', extensions: ['*'] },
            ],
        });
        if (!selected) {
            editor.log('Salvamento cancelado.', 'info');
            return null;
        }
        await bridge.saveFile(selected, payload.content);
        const fileName = selected.split(/[\/\\]/).pop() || selected;
        editor.setDocumentName(fileName, selected);
        editor.history?.markClean?.();
        editor.tabs?.render?.();
        editor.tabs?.save?.();
        editor.onDocumentSaved?.(payload.content?.length);
        usage('export_success');
        editor.log(`Salvo em ${selected} (${editor.doc.entities.length} entidades).`, 'info');
        return null;
    }

    const name = await editor.getString('Nome do arquivo', { defaultValue: editor.doc.name || payload.name });
    if (!name) return null;
    const finalName = name.toLowerCase().endsWith(`.${payload.ext}`) ? name : `${name}.${payload.ext}`;
    editor.setDocumentName(finalName);
    if (payload.isBinary || payload.content instanceof Uint8Array) {
        editor.downloadFile(payload.content, finalName, 'image/vnd.dwg');
    } else {
        editor.downloadText(payload.content, finalName);
    }
    editor.history?.markClean?.();
    editor.tabs?.render?.();
    editor.tabs?.save?.();
    usage('export_success');
    editor.log(`Exportado ${finalName} (${editor.doc.entities.length} entidades).`);
    return null;
}

async function exportDwg(editor) {
    const { documentToDwg } = await import('./dwg.js');
    const view = editor.viewport?.getView ? editor.viewport.getView() : editor.doc.view;
    if (view) editor.doc.view = view;
    const content = await documentToDwg(editor.doc, { view });
    const baseName = (editor.doc.name || 'desenho').replace(/\.(dxf|dwg|elmt|qet|svg|cdr)$/i, '');
    const defaultName = `${baseName}.dwg`;
    const bridge = typeof window !== 'undefined' ? window.desktopBridge : null;

    if (bridge && typeof bridge.showSaveDialog === 'function' && typeof bridge.saveFile === 'function') {
        const defaultPath = (editor.doc.filePath && editor.doc.filePath.endsWith('.dwg')) ? editor.doc.filePath : defaultName;
        const selected = await bridge.showSaveDialog({
            defaultPath,
            filters: [
                { name: 'AutoCAD DWG Drawing (*.dwg)', extensions: ['dwg'] },
                { name: 'Todos os arquivos', extensions: ['*'] },
            ],
        });
        if (!selected) {
            editor.log('Salvamento DWG cancelado.', 'info');
            return null;
        }
        await bridge.saveFile(selected, content);
        const fileName = selected.split(/[\/\\]/).pop() || selected;
        editor.setDocumentName(fileName, selected);
        editor.history?.markClean?.();
        editor.tabs?.render?.();
        editor.tabs?.save?.();
        editor.onDocumentSaved?.(content?.length);
        usage('export_success');
        editor.log(`Salvo DWG em ${selected} (${editor.doc.entities.length} entidades).`, 'info');
        return null;
    }

    const name = await editor.getString('Nome do arquivo DWG', { defaultValue: defaultName });
    if (!name) return null;
    const finalName = name.toLowerCase().endsWith('.dwg') ? name : `${name}.dwg`;
    editor.setDocumentName(finalName);
    editor.downloadFile(content, finalName, 'image/vnd.dwg');
    editor.history?.markClean?.();
    editor.tabs?.render?.();
    editor.tabs?.save?.();
    usage('export_success');
    editor.log(`Exportado DWG ${finalName} (${editor.doc.entities.length} entidades).`);
    return null;
}

const PAPER_SIZES_MM = [[210, 297], [297, 420], [148, 210], [420, 594], [216, 279]];

// Largura padrão em mm: folha escaneada (A4, A3, A5, A2, Carta) entra no tamanho real do papel,
// como o BricsCAD faz pela resolução gravada; senão usa o DPI do arquivo (96 se não houver).
export function imageDefaultWidthMm(pxWidth, pxHeight, dpi = null) {
    const ratio = Math.max(pxWidth, pxHeight) / Math.min(pxWidth, pxHeight);
    const portrait = pxHeight >= pxWidth;
    if (dpi > 0) {
        const mmW = (pxWidth / dpi) * 25.4;
        const mmH = (pxHeight / dpi) * 25.4;
        const paper = PAPER_SIZES_MM.find(([a, b]) => Math.abs(Math.min(mmW, mmH) - a) / a < 0.03 && Math.abs(Math.max(mmW, mmH) - b) / b < 0.03);
        if (paper) return portrait ? paper[0] : paper[1];
        if (dpi !== 72 && dpi !== 96) return mmW;
    }
    const paper = PAPER_SIZES_MM.find(([a, b]) => Math.abs(ratio - b / a) < 0.015);
    if (paper && (paper[0] === 210 || !dpi)) return portrait ? 210 : 297;
    return (pxWidth / (dpi > 0 ? dpi : 96)) * 25.4;
}

// DPI gravado no JPG (JFIF) ou PNG (pHYs); null se não houver.
export async function imageDpi(file) {
    try {
        const b = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
        if (b[0] === 0xff && b[1] === 0xd8 && b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46) {
            const unit = b[13];
            const x = (b[14] << 8) | b[15];
            if (x > 1 && unit === 1) return x;
            if (x > 1 && unit === 2) return x * 2.54;
        }
        if (b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
            for (let i = 8; i + 21 < b.length; i += 1) {
                if (b[i] === 0x70 && b[i + 1] === 0x48 && b[i + 2] === 0x59 && b[i + 3] === 0x73 && b[i + 12] === 1) {
                    const ppm = ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]) >>> 0;
                    if (ppm > 0) return ppm * 0.0254;
                }
            }
        }
    } catch {}
    return null;
}

async function imageAttach(editor) {
    const file = await editor.pickFile(`${IMAGE_ACCEPT},image/*`);
    if (!file) return null;
    let src;
    let natural;
    try {
        src = await fileToDataUrl(file);
        natural = await imageSize(src);
    } catch {
        return editor.log(`Não consegui ler a imagem ${file.name}.`, 'error');
    }
    const insert = await editor.getPoint('Ponto de inserção (canto inferior esquerdo):');
    if (!insert?.point) return null;
    const position = insert.point;
    const defaultWidth = imageDefaultWidthMm(natural.width, natural.height, await imageDpi(file));
    const width = await editor.getNumber('Largura em mm', { defaultValue: Number(defaultWidth.toFixed(2)) });
    if (!(width > 0)) return editor.log('Largura inválida.', 'error');
    const height = width * (natural.height / natural.width);
    const rotation = await editor.getNumber('Rotação em graus', { defaultValue: 0 });
    const entity = { type: 'image', position, width, height, rotation: Number.isFinite(rotation) ? rotation : 0, src, opacity: 1, name: file.name };
    editor.commit('Imagem', addEntities(editor.doc, [entity]));
    editor.log(`Imagem ${file.name} inserida (${width.toFixed(1)} × ${height.toFixed(1)} mm). É só referência: não vai para o corte nem para o DXF. Transparência: IMAGEADJUST; recorte: IMAGECLIP.`);
    return null;
}

async function imageAdjust(editor) {
    const ids = await editor.getSelection('Selecione as imagens:');
    const images = editor.entitiesById(ids).filter((e) => e.type === 'image');
    if (images.length === 0) return editor.log('Nenhuma imagem selecionada.', 'warn');
    const current = Math.round((images[0].opacity ?? 1) * 100);
    const percent = await editor.getNumber('Opacidade em % (10 a 100)', { defaultValue: current });
    if (!Number.isFinite(percent)) return null;
    const opacity = Math.min(100, Math.max(10, percent)) / 100;
    editor.commit('Opacidade da imagem', updateEntities(editor.doc, images.map((e) => e.id), (e) => ({ ...e, opacity })));
    editor.log(`Opacidade ${Math.round(opacity * 100)}% em ${images.length} imagem(ns).`);
    return null;
}

// Recorte retangular em frações do quadro da imagem (0 a 1), no sistema local dela:
// continua certo depois de mover, girar ou escalar.
export function imageClipFromCorners(entity, a, b) {
    const p = imageLocalPoint(entity, a);
    const q = imageLocalPoint(entity, b);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const clip = { u0: clamp(Math.min(p.u, q.u)), v0: clamp(Math.min(p.v, q.v)), u1: clamp(Math.max(p.u, q.u)), v1: clamp(Math.max(p.v, q.v)) };
    if (clip.u1 - clip.u0 < 1e-6 || clip.v1 - clip.v0 < 1e-6) return null;
    return clip;
}

async function imageClip(editor) {
    const pick = await editor.getEntity('Selecione a imagem para recortar:', { filter: (e) => e.type === 'image' });
    const image = pick?.entity;
    if (!image || image.type !== 'image') return editor.log('Selecione uma imagem.', 'warn');
    const option = await editor.getKeyword('Recorte', [{ key: 'n', label: 'Novo' }, { key: 'r', label: 'Remover' }], 'n');
    if (option?.key === 'r') {
        const { clip, ...rest } = image;
        editor.commit('Remover recorte', updateEntities(editor.doc, [image.id], () => rest));
        return editor.log('Recorte removido.');
    }
    const first = await editor.getPoint('Primeiro canto do recorte:');
    if (!first?.point) return null;
    const second = await editor.getPoint('Canto oposto:', { reference: first.point, window: first.point });
    if (!second?.point) return null;
    const clip = imageClipFromCorners(image, first.point, second.point);
    if (!clip) return editor.log('O retângulo não cobre a imagem.', 'error');
    editor.commit('Recortar imagem', updateEntities(editor.doc, [image.id], (e) => ({ ...e, clip })));
    editor.log('Imagem recortada. IMAGECLIP › Remover volta a imagem inteira.');
    return null;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function imageSize(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
        img.onerror = () => reject(new Error('imagem inválida'));
        img.src = src;
    });
}

async function pdfImport(editor) {
    const file = await editor.pickFile('.pdf,application/pdf');
    if (!file) return null;
    try {
        editor.log('Carregando PDF...', 'info');
        const { openPdf, pdfPageToImage, pdfPageToEntities } = await import('./pdfimport.js');
        let opened;
        try {
            opened = await openPdf(new Uint8Array(await file.arrayBuffer()));
        } catch (error) {
            usage('import_failure');
            return editor.log(`Falha ao abrir PDF: ${error.message}`, 'error');
        }
        const { doc, pdfjs } = opened;
        const pageNumber = doc.numPages > 1 ? await editor.getNumber(`Página (1-${doc.numPages})`, { defaultValue: 1 }) : 1;
        if (!(pageNumber >= 1 && pageNumber <= doc.numPages)) { usage('import_failure'); return editor.log('Página inválida.', 'error'); }
        const mode = await editor.getKeyword('Importar como', [{ key: 'v', label: 'Vetor' }, { key: 'i', label: 'Imagem' }], editor.memory.pdfMode ?? 'v');
        editor.memory.pdfMode = mode.key;
        const position = (await editor.getPoint('Ponto de inserção (canto inferior esquerdo):')).point;
        if (mode.key === 'i') {
            const img = await pdfPageToImage(doc, pageNumber);
            editor.commit('PDF', addEntities(editor.doc, [{ type: 'image', position, width: img.widthMm, height: img.heightMm, rotation: 0, src: img.src, opacity: 1, name: `${file.name}#${pageNumber}` }]));
            usage('import_success');
            editor.log(`PDF ${file.name} página ${pageNumber} inserida como imagem (${img.widthMm.toFixed(1)} × ${img.heightMm.toFixed(1)} mm).`);
            return null;
        }
        const layerName = 'PDF';
        const raw = await pdfPageToEntities(doc, pageNumber, pdfjs, { layer: layerName });
        if (raw.length === 0) { usage('import_failure'); return editor.log('Nenhum caminho vetorial encontrado nessa página (PDF só com imagem/texto).', 'warn'); }
        const moved = raw.map((e) => translateEntity(e, position));
        let next = editor.doc;
        if (!layerOf(next, layerName)) next = { ...next, layers: [...next.layers, { name: layerName, color: 9, visible: true, locked: false, lineType: 'CONTINUOUS', lineWeight: 0 }] };
        editor.commit('PDF vetorial', addEntities(next, moved));
        usage('import_success');
        editor.log(`PDF ${file.name} página ${pageNumber}: ${moved.length} entidades vetoriais no layer ${layerName} (béziers achatadas, texto e imagens ignorados).`);
        return null;
    } catch (error) { if (!(error instanceof CancelError)) usage('import_failure'); throw error; }
}

async function importDxf(editor) {
    const file = await editor.pickFile('.dxf');
    if (!file) return;
    try {
        const parsed = parseDxf(await file.text(),{preserveBlocks:true,preserveDimensions:true});
        let doc = editor.doc;
        parsed.layers.forEach((l) => {
            if (!layerOf(doc, l.name)) doc = { ...doc, layers: [...doc.layers, l] };
        });
        doc = addEntities(doc, parsed.entities);
        for(const name of Object.keys(parsed.blocks??{}))if(doc.blocks?.[name])throw new Error(`Bloco ${name} já existe; abra em outra aba para evitar conflito.`);
        doc={...doc,blocks:{...doc.blocks,...parsed.blocks}};
        editor.commit('Importar DXF', doc);
        editor.log(`Importadas ${parsed.entities.length} entidades de ${file.name}.`);
        usage('import_success');
    } catch (error) { usage('import_failure'); throw error; }
}

async function selectAll(editor) {
    editor.selectAll();
}

async function drawOrder(editor) {
    const ids = await editor.getSelection('Selecione objetos para alterar a ordem de desenho:');
    if (!ids || ids.length === 0) return;

    const options = [
        { key: 'f', label: 'Frente' },
        { key: 't', label: 'Trás' },
        { key: 'a', label: 'Acima' },
        { key: 'u', label: 'Abaixo' },
    ];
    const kw = await editor.getKeyword('Definir ordem de desenho [Frente/Trás/Acima/Abaixo] <Frente>:', options, 'f');
    if (!kw) return;

    const selectedSet = new Set(ids);
    const selected = editor.doc.entities.filter((e) => selectedSet.has(e.id));
    const remaining = editor.doc.entities.filter((e) => !selectedSet.has(e.id));

    let newEntities = [];
    if (kw.key === 'f') {
        newEntities = [...remaining, ...selected];
    } else if (kw.key === 't') {
        newEntities = [...selected, ...remaining];
    } else if (kw.key === 'a') {
        const refPick = await editor.getEntity('Selecione objeto de referência (para colocar acima dele):');
        if (!refPick) return;
        const refId = refPick.entity.id;
        const refIndex = remaining.findIndex((e) => e.id === refId);
        if (refIndex === -1) {
            newEntities = [...remaining, ...selected];
        } else {
            newEntities = [
                ...remaining.slice(0, refIndex + 1),
                ...selected,
                ...remaining.slice(refIndex + 1),
            ];
        }
    } else if (kw.key === 'u') {
        const refPick = await editor.getEntity('Selecione objeto de referência (para colocar abaixo dele):');
        if (!refPick) return;
        const refId = refPick.entity.id;
        const refIndex = remaining.findIndex((e) => e.id === refId);
        if (refIndex === -1) {
            newEntities = [...selected, ...remaining];
        } else {
            newEntities = [
                ...remaining.slice(0, refIndex),
                ...selected,
                ...remaining.slice(refIndex),
            ];
        }
    }

    editor.commit('Ordem de desenho', { ...editor.doc, entities: newEntities });
    editor.log(`${selected.length} objeto(s) reordenado(s).`);
}

async function selectSimilar(editor) {
    let refEntity = null;
    if (editor.selection.size > 0) {
        refEntity = editor.entitiesById([...editor.selection])[0];
    }
    if (!refEntity) {
        const pick = await editor.getEntity('Selecione objeto de referência para seleção similar:');
        if (!pick) return;
        refEntity = pick.entity;
    }

    const matching = editableEntities(editor.doc).filter(
        (e) => e.type === refEntity.type && e.layer === refEntity.layer
    );
    editor.selection = new Set(matching.map((e) => e.id));
    editor.invalidate();
    editor.onChange(editor);
    editor.log(`${matching.length} objeto(s) similar(es) selecionado(s) (tipo: ${refEntity.type}, layer: ${refEntity.layer}).`);
}

async function toggle(editor, key) {
    editor.toggle(key);
}

async function stats(editor) {
    const s = documentStats(editor.doc);
    editor.log(`${s.total} entidades, ${s.layers} layers: ${Object.entries(s.byType).map(([k, v]) => `${k}=${v}`).join(', ') || 'vazio'}`);
}

async function help(editor) {
    const lines = Object.entries(COMMANDS).map(([name, c]) => `${name}${c.aliases.length ? ` (${c.aliases.join(', ')})` : ''} — ${c.description}`);
    editor.log(lines.join('\n'));
}

export const COMMANDS = {
    ...EDIT_COMMANDS,
    ...BLOCK_COMMANDS,
    PRINT:{aliases:['PLOT','IMPRIMIR','PDFOUT'],description:'Impressão/PDF técnico em escala com carimbo',run:openPrintDialog},
    COPYCLIP: { aliases: [], run: editor => copyClip(editor), description: 'Copiar seleção para clipboard do desenho' },
    CUTCLIP: { aliases: [], run: editor => copyClip(editor, true), description: 'Recortar seleção para clipboard do desenho' },
    PASTECLIP: { aliases: [], run: pasteClip, description: 'Colar objetos pelo ponto de inserção' },
    POINT: { aliases: ['PO', 'PONTO'], run: pointCommand, description: 'Desenhar entidade ponto' },
    DONUT: { aliases: ['DO', 'DOUGHNUT', 'ANEL'], run: donut, description: 'Desenhar anel ou disco preenchido com diâmetro interno e externo' },
    LINE: { dimInput: true, aliases: ['L'], run: line, description: 'Linha por pontos' },
    CIRCLE: { dimInput: true, aliases: ['C', 'CIRCULO'], run: circle, description: 'Círculo por centro/raio, diâmetro, 2P, 3P ou TTR' },
    ARC: { dimInput: true, aliases: ['A', 'ARCO'], run: arc, description: 'Arco por 3 pontos, centro, início, fim, raio, ângulo ou direção' },
    PLINE: { dimInput: true, aliases: ['PL', 'POLYLINE'], run: polyline, description: 'Polilinha com segmentos de linha e arco' },
    RECTANG: { dimInput: true, aliases: ['REC', 'RECT', 'RECTANGLE'], run: rectangle, description: 'Retângulo por dois cantos' },
    REVCLOUD: { dimInput: true, aliases: ['REV', 'NUVEMREV'], run: revcloud, description: 'Criar nuvem de revisão em forma de arcos sequenciais' },
    TEXT: { aliases: ['T', 'DT', 'DTEXT'], run: text, description: 'Texto de linha única' },
    POLYGON: { dimInput: true, aliases: ['POL', 'POLIGONO'], run: polygon, description: 'Polígono regular por lados, inscrito/circunscrito ou por aresta' },
    ELLIPSE: { dimInput: true, aliases: ['EL', 'ELIPSE'], run: ellipse, description: 'Elipse por eixo e distância ou centro' },
    SPLINE: { dimInput: true, aliases: ['SPL'], run: spline, description: 'Spline por pontos de ajuste (B-spline cúbica)' },
    ARRAY: { aliases: ['AR', 'PADRAO'], run: arrayCommand, description: 'Padrão retangular, polar ou linear' },
    ALIGN: { aliases: ['AL', 'ALINHAR'], run: align, description: 'Alinhar por pares de pontos (mover, rotacionar, escalar opcional)' },
    WBLOCK: { aliases: ['W'], run: wblock, description: 'Gravar seleção como bloco em arquivo DXF' },
    ERASE: { aliases: ['E', 'DEL', 'DELETE'], run: erase, description: 'Apagar objetos' },
    MOVE: { aliases: ['M'], run: move, description: 'Mover objetos' },
    COPY: { aliases: ['CO', 'CP', 'COPIAR'], run: copy, description: 'Copiar objetos' },
    ROTATE: { aliases: ['RO', 'ROTACIONAR'], run: rotate, description: 'Rotacionar objetos' },
    MIRROR: { aliases: ['MI'], run: mirror, description: 'Espelhar objetos' },
    SCALE: { aliases: ['SC', 'ESCALAR'], run: scaleCommand, description: 'Escalar objetos' },
    OFFSET: { aliases: ['O', 'DESLOC'], run: offset, description: 'Offset paralelo com opções Através, Apagar, Camada e Múltiplo' },
    TRIM: { aliases: ['TR'], run: trim, description: 'Aparar objetos em arestas de corte' },
    EXTEND: { aliases: ['EX'], run: extend, description: 'Estender linhas e arcos até um limite' },
    FILLET: { aliases: ['F'], run: fillet, description: 'Concordância entre duas linhas' },
    EXPLODE: { aliases: ['X'], run: explode, description: 'Explodir polilinhas, splines e blocos' },
    BURST: { aliases: [], run: burst, description: 'Desagrupar blocos preservando atributos como textos' },
    JOIN: { aliases: ['J'], run: join, description: 'Unir linhas e arcos em polilinha' },
    BOUNDARY: { aliases: ['BPOLY', 'CONTORNO'], run: boundary, description: 'Criar polilinha de contorno fechado por ponto interno ou seleção' },
    DRAWORDER: { aliases: ['ORDEMDES', 'ORDEM'], run: drawOrder, description: 'Alterar ordem de sobreposição dos objetos (Frente, Trás, Acima, Abaixo)' },
    SELECTSIMILAR: { aliases: ['SELECSIMILAR', 'SIMILAR'], run: selectSimilar, description: 'Selecionar objetos com tipo e layer similares' },
    DIM: { aliases: ['COTA', 'DIMAUTO'], run: dimAuto, description: 'Cota automática: linear, alinhada, raio ou diâmetro conforme o alvo' },
    DIMPART: { aliases: ['COTARPECA', 'DIMPECA'], run: dimPart, description: 'Cotar a peça inteira: gerais, posições de furos, diâmetros e raios únicos' },
    HATCH: { aliases: ['H', 'HACHURA', 'BHATCH'], run: hatch, description: 'Hachura ou preenchimento de contornos fechados (sólido, linhas, cruzado, pontos)' },
    DIMLINEAR: { aliases: ['DLI', 'DIMLIN'], run: dimLinear, description: 'Cota linear horizontal/vertical' },
    DIMHORIZONTAL: { aliases: ['DHO', 'DIMHOR'], run: dimHorizontal, description: 'Cota linear horizontal' },
    DIMVERTICAL: { aliases: ['DVE', 'DIMVER'], run: dimVertical, description: 'Cota linear vertical' },
    DIMALIGNED: { aliases: ['DAL', 'DIMALI'], run: dimAligned, description: 'Cota alinhada' },
    DIMBASELINE: { aliases: ['DBA', 'DIMBASE', 'LINHABASE'], run: dimBaseline, description: 'Cota por linha base a partir da última cota ou cota selecionada' },
    DIMCONTINUE: { aliases: ['DCO', 'DIMCONT', 'CONTINUAR'], run: dimContinue, description: 'Cota contínua a partir da última cota ou cota selecionada' },
    DIMCENTER: { aliases: ['DCE', 'CENTRO', 'MARCACENTRO'], run: dimCenter, description: 'Criar marca de centro em arco ou círculo' },
    DIMANGULAR: { aliases: ['DAN', 'COTAANGULAR', 'ANG'], run: dimAngular, description: 'Cota angular entre duas linhas, 3 pontos ou arco' },
    DIMRADIUS: { aliases: ['DRA', 'DIMRAD'], run: (editor) => dimRadial(editor, 'radius'), description: 'Cota de raio' },
    DIMDIAMETER: { aliases: ['DDI', 'DIMDIA'], run: (editor) => dimRadial(editor, 'diameter'), description: 'Cota de diâmetro' },
    DIMSCALE: { aliases: [], run: dimScale, description: 'Escala de texto e setas das cotas' },
    DIMPRECISION: { aliases: ['DIMDEC'], run: dimPrecision, description: 'Casas decimais das cotas' },
    MEASUREGEOM: { aliases: ['MEDIRGEOM', 'MGEOM'], run: measureGeom, description: 'Medição unificada de distância, raio, ângulo, área e propriedades rápidas' },
    DIST: { aliases: ['DI'], run: dist, description: 'Distância entre dois pontos' },
    ID: { aliases: ['COORD'], run: id, description: 'Coordenadas de um ponto' },
    LIST: { aliases: ['LI'], run: list, description: 'Propriedades dos objetos' },
    AREA: { aliases: ['AA'], run: area, description: 'Área e perímetro de polígonos por pontos ou objetos com opções Adicionar/Subtrair' },
    ZOOM: { aliases: ['Z'], run: zoom, description: 'Zoom (Extensão, Janela, fator)' },
    ZOOMEXTENTS: { aliases: ['ZE', 'ZA', 'FIT'], run: (editor) => editor.zoomExtents(), description: 'Ajustar tudo na tela' },
    PAN: { aliases: ['P'], run: pan, description: 'Deslocar a vista' },
    UNDO: { aliases: ['U'], run: undo, description: 'Desfazer' },
    REDO: { aliases: ['RE'], run: redo, description: 'Refazer' },
    LAYER: { aliases: ['LA'], run: layer, description: 'Gerenciador de layers (LAYER nome define o atual)' },
    LAYNEW: { aliases: ['LAN'], run: layerNew, description: 'Criar layer e torná-lo atual' },
    LAYOFF: { aliases: [], run: layerOff, description: 'Desligar layer' },
    LAYON: { aliases: [], run: layerOn, description: 'Ligar layer' },
    COLOR: { aliases: ['COL', 'COLOUR'], run: color, description: 'Cor dos objetos' },
    CHPROP: { aliases: ['CH', 'LAYMCUR'], run: chprop, description: 'Mudar objetos de layer' },
    NEW: { aliases: ['QNEW'], run: newDrawing, description: 'Novo desenho' },
    OPEN: { aliases: [], run: open, description: 'Abrir desenho DWG, DXF, LXDS, SVG, CDR, ELMT ou QET' },
    ELMT: { aliases: ['OPENELMT', 'QELEMT'], run: openElmt, description: 'Abrir elemento elétrico QElectroTech (.elmt)' },
    EXPORTELMT: { aliases: ['SAVEELMT'], run: exportElmt, description: 'Exportar elemento elétrico QElectroTech (.elmt)' },
    QET: { aliases: ['OPENQET', 'PROJETO'], run: openQet, description: 'Abrir projeto elétrico e chicote QElectroTech (.qet)' },
    EXPORTQET: { aliases: ['SAVEQET'], run: exportQet, description: 'Exportar projeto elétrico QElectroTech (.qet)' },
    TERMINAL: { aliases: ['PIN', 'BORNE'], run: terminalCommand, description: 'Inserir pino/terminal elétrico QElectroTech' },
    IMPORT: { aliases: ['INSERT'], run: importDxf, description: 'Inserir DXF no desenho atual' },
    LXDS: { aliases: [], run: openLxds, description: 'Importar geometria de arquivo .lxds' },
    SVG: { aliases: ['SVGIMPORT'], run: openSvg, description: 'Importar vetor SVG para o editor' },
    CDR: { aliases: ['COREL'], run: openCdr, description: 'Abrir arquivo CorelDRAW (.cdr) para visualização e medição' },
    IMAGEATTACH: { aliases: ['IMAGE', 'IM', 'IMAGEM'], run: imageAttach, description: 'Inserir imagem (PNG/JPG) como referência' },
    IMAGEADJUST: { aliases: ['IAD', 'TRANSPARENCIA', 'OPACIDADE'], run: imageAdjust, description: 'Ajustar a opacidade de imagens' },
    IMAGECLIP: { aliases: ['ICL', 'RECORTARIMAGEM'], run: imageClip, description: 'Recortar imagem com retângulo' },
    PDFIMPORT: { aliases: ['PDF'], run: pdfImport, description: 'Importar página de PDF como vetor (linhas/polilinhas) ou imagem' },
    SAVE: { aliases: ['QSAVE', 'EXPORT', 'DXFOUT'], run: save, description: 'Baixar DXF' },
    SAVEAS: { aliases: [], run: saveAs, description: 'Baixar DXF com outro nome' },
    DWG: { aliases: ['DWGOUT', 'SAVEDWG', 'EXPORTDWG'], run: exportDwg, description: 'Salvar/Exportar desenho como AutoCAD DWG' },
    SELECTALL: { aliases: ['ALL'], run: selectAll, description: 'Selecionar tudo' },
    ORTHO: { aliases: [], run: (editor) => toggle(editor, 'ortho'), description: 'Alternar orto (F8)' },
    POLAR: { aliases: [], run: (editor) => toggle(editor, 'polar'), description: 'Alternar rastreio polar (F10)' },
    OSNAP: { aliases: ['OS'], run: (editor) => toggle(editor, 'osnap'), description: 'Alternar snaps (F3)' },
    OTRACK: { aliases: ['OT'], run: (editor) => toggle(editor, 'otrack'), description: 'Alternar rastreio por projeção (F11)' },
    GRID: { aliases: [], run: (editor) => toggle(editor, 'grid'), description: 'Alternar grade (F7)' },
    STATS: { aliases: [], run: stats, description: 'Contagem de entidades' },
    HELP: { aliases: ['?'], run: help, description: 'Lista de comandos' },
};

// Todo comando aceita o nome em inglês e em português.
for (const [name, pt] of Object.entries(PT_ALIASES)) {
    const command = COMMANDS[name];
    if (command) command.aliases = [...new Set([...(command.aliases ?? []), ...pt])];
}

// Sugestões da linha de comando: nome ou apelido que começa com o prefixo digitado.
export function suggestCommands(prefix, limit = 50) {
    const upper = normalizeCommandName(prefix);
    if (!upper || !/^[A-Z_]/.test(upper)) return [];
    const out = [];
    for (const [name, command] of Object.entries(COMMANDS)) {
        const aliases = command.aliases ?? [];
        const hit = name.startsWith(upper) ? name : aliases.find((a) => a.startsWith(upper));
        if (!hit) continue;
        out.push({ name, label: aliases.length ? `${name} (${aliases.join(', ')})` : name, description: command.description ?? '', rank: name === upper || aliases.includes(upper) ? 0 : hit === name ? 1 : 2 });
    }
    out.sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name));
    return out.slice(0, limit);
}

export function resolveCommand(name) {
    const upper = normalizeCommandName(name);
    if (COMMANDS[upper]) return { name: upper, ...COMMANDS[upper] };
    for (const [key, command] of Object.entries(COMMANDS)) {
        if (command.aliases.includes(upper)) return { name: key, ...command };
    }
    return null;
}

export { polygonFromEdge, alignTransform, filletLines, filletCurves, trimInsideBox, trimAtPoint, extendEntity, joinCurves, polylineArea, tangentBulge, trimPolyline, curveToEntity, boxOf, aciToHex, hexToAci };
