import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolateSpline, evaluateSpline, sampleSpline, splineDomain } from '../src/cad/splines.js';
import { ellipsePoint, ellipseSamples } from '../src/cad/extra-entities.js';
import { entityCurves, entityBox, rotateEntity, mirrorEntity, translateEntity, distance } from '../src/cad/geometry.js';
import { findSnap, defaultSnapSettings } from '../src/cad/snaps.js';
import { createDocument, addEntities, renameLayer, deleteLayer, createLayer, setCurrentLayer } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { polygonFromEdge, alignTransform } from '../src/cad/commands.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const closePoint = (p, q, tol = 1e-6) => close(p.x, q.x, tol) && close(p.y, q.y, tol);

test('spline interpolada passa pelos pontos de ajuste e é suave', () => {
    const fit = [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 25, y: -3 }, { x: 40, y: 10 }, { x: 55, y: 0 }];
    const sp = interpolateSpline(fit);
    assert.equal(sp.degree, 3);
    assert.equal(sp.controlPoints.length, 5);
    assert.equal(sp.knots.length, 9);
    const { min, max } = splineDomain(sp);
    assert.ok(closePoint(evaluateSpline(sp, min), fit[0]) && closePoint(evaluateSpline(sp, max), fit[fit.length - 1]));
    // Cada ponto de ajuste está sobre a curva (distância mínima da amostra densa ≈ 0).
    const samples = sampleSpline(sp, 256);
    fit.forEach((p) => {
        const d = Math.min(...samples.map((s) => distance(s, p)));
        assert.ok(d < 0.1, `ponto de ajuste ${JSON.stringify(p)} a ${d} da curva`);
    });
    const closed = interpolateSpline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], { closed: true });
    const cs = sampleSpline(closed, 8);
    assert.ok(closePoint(cs[0], cs[cs.length - 1], 1e-6), 'spline fechada volta ao início');
    assert.equal(interpolateSpline([{ x: 0, y: 0 }]), null);
    const two = interpolateSpline([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    assert.equal(two.degree, 1);
});

test('spline como entidade: curvas, bbox, transformação e DXF', () => {
    const sp = { type: 'spline', layer: '0', ...interpolateSpline([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]) };
    assert.ok(entityCurves(sp).length > 10);
    const box = entityBox(sp);
    assert.ok(box.minX <= 0 && box.maxX >= 20 && box.maxY >= 9);
    const moved = translateEntity(sp, { x: 5, y: 0 });
    assert.ok(closePoint(moved.fitPoints[0], { x: 5, y: 0 }) && closePoint(moved.controlPoints[0], { x: 5, y: 0 }));
    let doc = addEntities(createDocument(), [sp]);
    const parsed = parseDxf(writeDxf(doc));
    assert.equal(parsed.entities[0].type, 'spline');
    assert.equal(parsed.entities[0].controlPoints.length, 3);
    assert.equal(parsed.entities[0].fitPoints.length, 3);
    assert.ok(closePoint(evaluateSpline(parsed.entities[0], 0.5), evaluateSpline(sp, 0.5)));
    // Spline só com pontos de ajuste (de outro CAD) é reconstruída.
    const fitOnly = parseDxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '74', '3', '11', '0', '21', '0', '11', '5', '21', '5', '11', '10', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n'));
    assert.equal(fitOnly.entities[0].fitPoints.length, 3);
    assert.ok(entityCurves(fitOnly.entities[0]).length > 5);
});

test('elipse: pontos, snaps de centro/quadrante, transformações e DXF', () => {
    const el = { id: 'e', type: 'ellipse', layer: '0', center: { x: 10, y: 5 }, major: { x: 20, y: 0 }, ratio: 0.5, start: 0, end: Math.PI * 2 };
    assert.ok(closePoint(ellipsePoint(el, 0), { x: 30, y: 5 }));
    assert.ok(closePoint(ellipsePoint(el, Math.PI / 2), { x: 10, y: 15 }));
    assert.ok(ellipseSamples(el).length > 50);
    const settings = defaultSnapSettings();
    assert.equal(findSnap([el], { x: 10.2, y: 5.1 }, 0.5, settings).mode, 'cen');
    assert.equal(findSnap([el], { x: 30.2, y: 5.1 }, 0.5, settings).mode, 'qua');
    assert.equal(findSnap([el], { x: 10, y: 15.2 }, 0.5, settings).mode, 'qua');
    const rotated = rotateEntity(el, { x: 10, y: 5 }, Math.PI / 2);
    assert.ok(closePoint(rotated.major, { x: 0, y: 20 }) && close(rotated.ratio, 0.5));
    const mirrored = mirrorEntity({ ...el, start: 0, end: Math.PI / 2 }, { x: 10, y: 0 }, { x: 10, y: 1 });
    assert.ok(close(mirrored.start, 1.5 * Math.PI) && close(mirrored.end, 2 * Math.PI));
    const parsed = parseDxf(writeDxf(addEntities(createDocument(), [el])));
    assert.equal(parsed.entities[0].type, 'ellipse');
    assert.ok(closePoint(parsed.entities[0].major, { x: 20, y: 0 }) && close(parsed.entities[0].ratio, 0.5));
});

test('polígono por aresta fecha com o número de lados e comprimento constante', () => {
    const hex = polygonFromEdge(6, { x: 0, y: 0 }, { x: 10, y: 0 });
    assert.equal(hex.vertices.length, 6);
    assert.equal(hex.closed, true);
    for (let i = 0; i < 6; i += 1) assert.ok(close(distance(hex.vertices[i], hex.vertices[(i + 1) % 6]), 10));
    assert.ok(hex.vertices[2].y > 0, 'polígono construído para a esquerda da aresta (anti-horário)');
});

test('align: um par translada, dois pares rotacionam e opcionalmente escalam', () => {
    const move = alignTransform([{ src: { x: 0, y: 0 }, dst: { x: 5, y: 5 } }], false);
    assert.deepEqual(move({ x: 1, y: 1 }), { x: 6, y: 6 });
    const rot = alignTransform([{ src: { x: 0, y: 0 }, dst: { x: 0, y: 0 } }, { src: { x: 10, y: 0 }, dst: { x: 0, y: 10 } }], false);
    assert.ok(closePoint(rot({ x: 10, y: 0 }), { x: 0, y: 10 }));
    assert.ok(closePoint(rot({ x: 5, y: 0 }), { x: 0, y: 5 }), 'sem escala mantém distâncias');
    const scaled = alignTransform([{ src: { x: 0, y: 0 }, dst: { x: 0, y: 0 } }, { src: { x: 10, y: 0 }, dst: { x: 20, y: 0 } }], true);
    assert.ok(closePoint(scaled({ x: 5, y: 0 }), { x: 10, y: 0 }));
    assert.equal(alignTransform([{ src: { x: 0, y: 0 }, dst: { x: 0, y: 0 } }, { src: { x: 0, y: 0 }, dst: { x: 1, y: 1 } }], false), null);
});

test('layers: renomear move entidades, excluir devolve ao 0, atributos sobrevivem ao DXF', () => {
    let doc = setCurrentLayer(createDocument(), 'CORTE');
    doc = { ...doc, layers: doc.layers.map((l) => (l.name === 'CORTE' ? { ...l, color: '#ff8800', lineType: 'DASHED', lineWeight: 50 } : l)) };
    doc = addEntities(doc, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }]);
    doc = renameLayer(doc, 'CORTE', 'LASER');
    assert.ok(doc.layers.some((l) => l.name === 'LASER') && doc.entities[0].layer === 'LASER' && doc.currentLayer === 'LASER');
    assert.equal(renameLayer(doc, 'LASER', '0'), doc, 'não sobrescreve layer existente');
    const parsed = parseDxf(writeDxf(doc));
    const laser = parsed.layers.find((l) => l.name === 'LASER');
    assert.equal(laser.color, '#ff8800');
    assert.equal(laser.lineType, 'DASHED');
    assert.equal(laser.lineWeight, 50);
    assert.match(writeDxf(doc), /\n2\nDASHED\n/);
    doc = deleteLayer(doc, 'LASER');
    assert.equal(doc.entities[0].layer, '0');
    assert.equal(doc.layers.length, 1);
    assert.equal(deleteLayer(doc, '0'), doc);
    assert.equal(createLayer('X', { lineWeight: 25 }).lineWeight, 25);
});
