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
test('TRIM at point only splits at the bounds of the removed piece', () => {
    const long = { type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } };
    const cuts = [10, 20, 30, 40].map(x => ({ kind: 'segment', a: { x, y: -20 }, b: { x, y: 20 } }));
    const kept = trimAtPoint(long, cuts, { x: 5, y: 0 });
    assert.equal(kept.length, 1);
    assert.deepEqual([kept[0].start.x, kept[0].end.x].sort((a, b) => a - b), [10, 50]);
    const mid = trimAtPoint(long, cuts, { x: 25, y: 0 });
    assert.equal(mid.length, 2);
    assert.deepEqual(mid.map(p => [p.start.x, p.end.x].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]), [[0, 20], [30, 50]]);
});
test('TRIM window only splits at the bounds of the removed pieces', () => {
    const long = { type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } };
    const cuts = [10, 20, 30, 40].map(x => ({ kind: 'segment', a: { x, y: -20 }, b: { x, y: 20 } }));
    const kept = trimInsideBox(long, cuts, { minX: 1, minY: -1, maxX: 4, maxY: 1 });
    assert.equal(kept.length, 1);
});
