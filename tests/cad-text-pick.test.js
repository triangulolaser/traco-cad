import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInTextBox, textBox } from '../src/cad/geometry.js';

const base = { type: 'text', position: { x: 10, y: 20 }, height: 10, text: 'AB', rotation: 0 };

test('texto girado: canto vazio da caixa alinhada aos eixos fica fora', () => {
    const entity = { ...base, position: { x: 0, y: 0 }, rotation: 45, text: 'TEXTO LONGO' };
    const xs = textBox(entity).map((p) => p.x);
    assert.equal(pointInTextBox({ x: Math.max(...xs) - 1, y: 1 }, entity), false);
    assert.equal(pointInTextBox({ x: 20, y: 22 }, entity), true);
});

test('texto espelhado: a caixa fica do lado em que o renderer desenha', () => {
    const entity = { ...base, mirrored: true };
    assert.ok(Math.max(...textBox(entity).map((p) => p.x)) <= 10 + 1e-9);
    assert.equal(pointInTextBox({ x: 5, y: 25 }, entity), true);
    assert.equal(pointInTextBox({ x: 15, y: 25 }, entity), false);
});

test('duas linhas com baseline: a segunda desce a partir da posição', () => {
    const box = textBox({ ...base, text: 'A\nB' });
    const ys = box.map((p) => p.y);
    assert.ok(Math.abs(Math.max(...ys) - 30) < 1e-9);
    assert.ok(Math.abs(Math.min(...ys) - (20 - 10 * 5 / 3)) < 1e-9);
});
