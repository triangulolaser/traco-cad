import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectionMeasure } from '../src/cad/selection-measure.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('pontas mais próximas quando o mínimo é de ponta a ponta (caso do Miguel)', () => {
    const inclinada = { type: 'line', start: { x: 0, y: 100 }, end: { x: -20.49, y: 36.89 } };
    const horizontal = { type: 'line', start: { x: 0, y: 0 }, end: { x: 300, y: 0 } };
    const m = selectionMeasure(inclinada, horizontal);
    assert.ok(close(m.dx, 20.49));
    assert.ok(close(m.dy, 36.89));
    assert.ok(close(m.distance, 42.2, 0.005));
});

test('ponta contra o meio de outra linha usa a perpendicular', () => {
    const vertical = { type: 'line', start: { x: 50, y: 10 }, end: { x: 50, y: 80 } };
    const horizontal = { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const m = selectionMeasure(vertical, horizontal);
    assert.ok(close(m.distance, 10) && close(m.dx, 0) && close(m.dy, 10));
});

test('linhas paralelas medem a folga entre elas', () => {
    const a = { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const b = { type: 'line', start: { x: 20, y: 7 }, end: { x: 60, y: 7 } };
    assert.ok(close(selectionMeasure(a, b).distance, 7));
});

test('círculo mede da borda, pela reta do centro', () => {
    const linha = { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const circulo = { type: 'circle', center: { x: 40, y: 30 }, radius: 10 };
    const m = selectionMeasure(linha, circulo);
    assert.ok(close(m.distance, 20) && close(m.dx, 0));
    const outro = { type: 'circle', center: { x: 40, y: 80 }, radius: 5 };
    assert.ok(close(selectionMeasure(circulo, outro).distance, 35));
});

test('arco considera só o trecho desenhado', () => {
    const arco = { type: 'arc', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 };
    const linha = { type: 'line', start: { x: -50, y: -20 }, end: { x: 50, y: -20 } };
    const m = selectionMeasure(arco, linha);
    assert.ok(close(m.distance, 20) && close(m.a.x, 10));
});

test('entidades que se cruzam dão distância zero', () => {
    const a = { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };
    const b = { type: 'line', start: { x: 0, y: 10 }, end: { x: 10, y: 0 } };
    assert.ok(close(selectionMeasure(a, b).distance, 0));
});

test('entidade ausente não mede', () => {
    assert.equal(selectionMeasure(null, { type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }), null);
});
