import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersectCurves, splitEntityAt, isDegenerateEntity, entityCurves } from '../src/cad/geometry.js';
import { writeDxf } from '../src/cad/dxf.js';
import { createDocument, addEntities } from '../src/cad/document.js';

// Oblongo de AI_CIRCTAN: círculo tangente às duas laterais, com resíduo de ponto flutuante na tangência.
const circle = { type: 'circle', center: { x: 107.300954, y: -36.91024 }, radius: 3.175 };
const side = (x) => ({ type: 'line', start: { x, y: -60 }, end: { x, y: 0 } });
const left = side(107.300954 - 3.175 + 1e-13);
const right = side(107.300954 + 3.175 - 1e-13);

test('TRIM no círculo tangente não deixa lascas de arco', () => {
    const cuts = [left, right].flatMap((l) => intersectCurves(entityCurves(circle)[0], entityCurves(l)[0]));
    assert.ok(cuts.length >= 2, 'tangência precisa gerar ponto de corte');
    const pieces = splitEntityAt(circle, cuts);
    assert.equal(pieces.length, 2);
    assert.ok(pieces.every((p) => !isDegenerateEntity(p)));
});

test('TRIM na lateral tangente não deixa linha de comprimento zero', () => {
    const cuts = intersectCurves(entityCurves(left)[0], entityCurves(circle)[0]);
    const pieces = splitEntityAt(left, cuts);
    assert.equal(pieces.length, 2);
    assert.ok(pieces.every((p) => !isDegenerateEntity(p)));
});

test('DXF descarta lascas de arco e linhas de comprimento zero já existentes', () => {
    const doc = addEntities(createDocument(), [
        { type: 'arc', center: { x: 107.300954, y: -36.91024 }, radius: 3.175, start: Math.PI - 3e-8, end: Math.PI + 3e-8 },
        { type: 'arc', center: { x: 107.300954, y: -36.91024 }, radius: 3.175, start: Math.PI, end: 2 * Math.PI },
        { type: 'line', start: { x: 107.300954, y: -40.08524 }, end: { x: 107.300954, y: -40.08524 } },
        { type: 'line', start: { x: 104.125954, y: -36.91024 }, end: { x: 104.125954, y: -17.86024 } },
    ]);
    const dxf = writeDxf(doc);
    assert.equal((dxf.match(/\n0\nARC\n/g) ?? []).length, 1);
    assert.equal((dxf.match(/\n0\nLINE\n/g) ?? []).length, 1);
});
