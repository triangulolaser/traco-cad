import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectionMeasure, measurePoints } from '../src/cad/selection-measure.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('duas linhas usam as pontas mais próximas (caso do Miguel)', () => {
    const inclinada = { type: 'line', start: { x: 0, y: 100 }, end: { x: -20.49, y: 36.89 } };
    const horizontal = { type: 'line', start: { x: 0, y: 0 }, end: { x: 300, y: 0 } };
    const m = selectionMeasure(inclinada, horizontal);
    assert.deepEqual(m.a, { x: -20.49, y: 36.89 });
    assert.deepEqual(m.b, { x: 0, y: 0 });
    assert.ok(close(m.dx, 20.49));
    assert.ok(close(m.dy, 36.89));
    assert.ok(close(m.distance, 42.2, 0.005));
});

test('arco usa extremidades e círculo usa o centro', () => {
    const arco = { type: 'arc', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 };
    const circulo = { type: 'circle', center: { x: 30, y: 4 }, radius: 5 };
    assert.equal(measurePoints(circulo).length, 1);
    const m = selectionMeasure(arco, circulo);
    assert.ok(close(m.a.x, 10) && close(m.a.y, 0));
    assert.ok(close(m.dx, 20) && close(m.dy, 4));
});

test('polilinha considera todos os vértices', () => {
    const poly = { type: 'polyline', closed: false, vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] };
    const linha = { type: 'line', start: { x: 60, y: 55 }, end: { x: 200, y: 55 } };
    const m = selectionMeasure(poly, linha);
    assert.ok(close(m.dx, 10) && close(m.dy, 5));
});

test('entidade ausente não mede', () => {
    assert.equal(selectionMeasure(null, { type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }), null);
});
