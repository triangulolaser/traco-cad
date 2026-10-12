import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAngleLock } from '../src/cad/snaps.js';

const o = { x: 10, y: 10 };
test('Shift trava na horizontal, vertical e 45°', () => {
    assert.deepEqual(applyAngleLock(o, { x: 110, y: 18 }), { x: 110, y: 10 });
    assert.deepEqual(applyAngleLock(o, { x: 14, y: -90 }), { x: 10, y: -90 });
    const d = applyAngleLock(o, { x: 60, y: 55 });
    assert.ok(Math.abs((d.x - o.x) - (d.y - o.y)) < 1e-9);
    const e = applyAngleLock(o, { x: -40, y: 62 });
    assert.ok(Math.abs((e.x - o.x) + (e.y - o.y)) < 1e-9);
});
