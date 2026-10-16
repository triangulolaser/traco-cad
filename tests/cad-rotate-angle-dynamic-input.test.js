import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDynamicInput } from '../src/cad/commands.js';

const base = { x: 10, y: 10 };

test('ROTATE mostra o ângulo do cursor a partir da horizontal', () => {
    const r = angleDynamicInput(base, { x: 10, y: 30 }, {}, 2);
    assert.ok(Math.abs(r.values.v - 90) < 1e-9);
    assert.equal(r.guides.length, 3);
    assert.ok(r.guides.every((g) => g.dimGuide));
    const arc = r.guides.find((g) => g.type === 'arc');
    assert.ok(Math.abs(arc.start) < 1e-9 && Math.abs(arc.end - Math.PI / 2) < 1e-9);
});

test('ângulo abaixo da horizontal sai entre 0 e 360', () => {
    const r = angleDynamicInput(base, { x: 10, y: -10 }, {}, 2);
    assert.ok(Math.abs(r.values.v - 270) < 1e-9);
});

test('ângulo digitado trava a direção, inclusive negativo', () => {
    const r = angleDynamicInput(base, { x: 50, y: 10 }, { v: -45 }, 2);
    assert.equal(r.values.v, -45);
    assert.ok(Math.abs(Math.atan2(r.end.y - base.y, r.end.x - base.x) + Math.PI / 4) < 1e-9);
    const arc = r.guides.find((g) => g.type === 'arc');
    assert.ok(Math.abs(arc.start + Math.PI / 4) < 1e-9 && Math.abs(arc.end) < 1e-9);
});

test('referência desloca o zero', () => {
    const r = angleDynamicInput(base, { x: 10, y: 30 }, {}, 2, Math.PI / 2);
    assert.ok(Math.abs(r.values.v) < 1e-9);
    assert.equal(r.guides.filter((g) => g.type === 'arc').length, 0);
});
