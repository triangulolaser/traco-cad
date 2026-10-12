import test from 'node:test';
import assert from 'node:assert/strict';
import { rectDynamicInput } from '../src/cad/commands.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('RECTANG: sem valor digitado, o canto oposto segue o cursor', () => {
    const r = rectDynamicInput({ x: 0, y: 0 }, { x: 30, y: 20 }, 0, {}, 5);
    assert.deepEqual(r.corner, { x: 30, y: 20 });
    assert.deepEqual(r.values, { w: 30, h: 20 });
    assert.equal(r.guides.length, 6);
});

test('RECTANG: largura e altura travadas mantêm o quadrante do cursor', () => {
    const r = rectDynamicInput({ x: 10, y: 10 }, { x: -5, y: 50 }, 0, { w: 100, h: 82.03 }, 5);
    assert.ok(close(r.corner.x, -90) && close(r.corner.y, 92.03));
    const only = rectDynamicInput({ x: 0, y: 0 }, { x: 40, y: -7 }, 0, { w: 100 }, 5);
    assert.ok(close(only.corner.x, 100) && close(only.corner.y, -7));
    // Cota da largura fica fora do retângulo, do lado oposto à altura.
    assert.ok(only.anchors.w.y > 0);
});

test('RECTANG: entrada dinâmica respeita a rotação', () => {
    const r = rectDynamicInput({ x: 0, y: 0 }, { x: 0, y: 10 }, 90, { w: 100, h: 50 }, 5);
    assert.ok(close(r.corner.x, -50) && close(r.corner.y, 100), JSON.stringify(r.corner));
});
