import test from 'node:test';
import assert from 'node:assert/strict';
import { trimInsideBox, trimAtPoint } from '../src/cad/commands.js';
const line = { type: 'line', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } };
const cutters = [10,20].map(x => ({ kind: 'segment', a: { x, y: -20 }, b: { x, y: 20 } }));
const fullBox = { minX: -40, minY: -40, maxX: 40, maxY: 40 };
test('TRIM window enclosing all line pieces preserves original entity', () => {
    assert.equal(trimInsideBox(line, cutters, fullBox), undefined);
});
test('TRIM window enclosing all circle or arc pieces preserves original entity', () => {
    const cut = [{ kind: 'segment', a: { x: 0, y: -20 }, b: { x: 0, y: 20 } }];
    for (const entity of [
        { type: 'circle', center: { x: 0, y: 0 }, radius: 10 },
        { type: 'arc', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI },
    ]) assert.equal(trimInsideBox(entity, cut, fullBox), undefined);
});
test('TRIM window cannot delete an entire polyline', () => {
    const entity = { type: 'polyline', closed: false, vertices: [{ x: 0, y: 0 }, { x: 30, y: 0 }] };
    assert.equal(trimInsideBox(entity, cutters, fullBox), undefined);
});
test('partial window and point trims still leave geometry', () => {
    const box = { minX: 12, minY: -1, maxX: 18, maxY: 1 };
    assert.equal(trimInsideBox(line, cutters, box).length, 2);
    assert.equal(trimAtPoint(line, cutters, { x: 15, y: 0 }).length, 2);
    assert.equal(trimAtPoint(line, [], { x: 15, y: 0 }), undefined);
});
