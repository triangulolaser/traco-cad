import test from 'node:test';
import assert from 'node:assert/strict';
import { lineDynamicInput, circleDynamicInput } from '../src/cad/commands.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('LINE: comprimento travado segue a direção do cursor', () => {
    const r = lineDynamicInput({ x: 0, y: 0 }, { x: 0, y: 7 }, { len: 50 });
    assert.ok(close(r.end.x, 0) && close(r.end.y, 50));
    assert.ok(close(r.values.ang, 90));
});

test('LINE: ângulo travado (inclusive 0°) e comprimento livre', () => {
    const r = lineDynamicInput({ x: 10, y: 10 }, { x: 10, y: 40 }, { ang: 0 });
    assert.ok(close(r.end.x, 40) && close(r.end.y, 10));
    const both = lineDynamicInput({ x: 0, y: 0 }, { x: 1, y: 1 }, { len: 100, ang: 30 });
    assert.ok(close(both.end.x, 100 * Math.cos(Math.PI / 6)) && close(both.end.y, 50));
});

test('CIRCLE: raio e diâmetro travados', () => {
    const r = circleDynamicInput({ x: 0, y: 0 }, { x: 3, y: 4 }, { r: 10 }, 'r', 1);
    assert.ok(close(r.radius, 10) && close(r.edge.x, 6) && close(r.edge.y, 8));
    const d = circleDynamicInput({ x: 0, y: 0 }, { x: 3, y: 4 }, { d: 10 }, 'd', 0.5);
    assert.ok(close(d.radius, 5) && close(d.values.d, 10));
    const free = circleDynamicInput({ x: 0, y: 0 }, { x: 3, y: 4 }, {}, 'd', 0.5);
    assert.ok(close(free.values.d, 10));
});

test('Cota automática: círculo mostra a cota do raio e do diâmetro', () => {
    const r = circleDynamicInput({ x: 0, y: 0 }, { x: 10, y: 0 }, {}, 'r', 1);
    assert.deepEqual(r.guides.map((g) => [g.start, g.end, g.dimGuide]), [[{ x: 0, y: 0 }, { x: 10, y: 0 }, true]]);
    const d = circleDynamicInput({ x: 0, y: 0 }, { x: 10, y: 0 }, {}, 'd', 0.5);
    assert.deepEqual(d.guides[0].start, { x: -10, y: 0 });
});

test('Cota automática: prompt de ponto vira comprimento/ângulo; numérico vira distância; ângulo fica fora', async () => {
    const { autoDimSpec } = await import('../src/cad/commands.js');
    const editor = { viewport: { pixelsToWorld: (n) => n } };
    const ref = { x: 0, y: 0 };
    const pt = autoDimSpec(editor, { mode: 'point', reference: ref, prompt: 'Próximo ponto' });
    assert.deepEqual(pt.fields.map((f) => f.key), ['len', 'ang']);
    assert.ok(pt.guides({ x: 30, y: 0 }).every((g) => g.dimGuide));
    const diam = autoDimSpec(editor, { mode: 'point', reference: ref, prompt: 'Diâmetro do círculo:', allowNumber: true });
    assert.equal(diam.fields[0].label, 'Diâmetro');
    assert.equal(diam.commitNumber, true);
    assert.equal(diam.values({ x: 0, y: 25 }).v, 25);
    assert.equal(autoDimSpec(editor, { mode: 'point', reference: ref, prompt: 'Ângulo incluído (graus):', allowNumber: true }), null);
    assert.equal(autoDimSpec(editor, { mode: 'point', reference: null, prompt: 'Primeiro ponto' }), null);
    assert.equal(autoDimSpec(editor, { mode: 'point', reference: ref, prompt: 'x', dynInput: false }), null);
});
