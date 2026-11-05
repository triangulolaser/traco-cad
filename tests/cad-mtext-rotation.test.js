import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDxf } from '../src/cad/dxf.js';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';

const dxf = (pairs) => `${[[0, 'SECTION'], [2, 'ENTITIES'], ...pairs, [0, 'ENDSEC'], [0, 'EOF']].map(([c, v]) => `${c}\n${v}`).join('\n')}\n`;
// Trecho de MTEXT como o R2018 grava: depois do texto, 10/20 é a direção e 11/21 repete a posição.
const embedded = [[101, 'Embedded Object'], [70, 1], [10, 1], [20, 0], [30, 0], [11, 19392.2], [21, 33010.4], [31, 0], [40, 659.6], [41, 0], [42, 639.3], [43, 66.7], [71, 2], [72, 1], [44, 659.6], [45, 125], [73, 0], [74, 0], [46, 0]];
const mtext = (extra = []) => [[0, 'MTEXT'], [8, '0'], [10, 19392.2], [20, 33010.4], [40, 25], [41, 659.6], [71, 1], [72, 5], [1, 'cortar 1 peça'], ...extra, [73, 1], [44, 1]];

test('bloco Embedded Object do R2018 não altera ângulo, posição, altura nem largura do MTEXT', () => {
    const [text] = parseDxf(dxf([...mtext(), ...embedded])).entities;
    assert.equal(text.rotation, 0);
    assert.deepEqual(text.position, { x: 19392.2, y: 33010.4 });
    assert.equal(text.height, 25);
    assert.equal(text.boxWidth, 659.6);
    assert.equal(text.attachmentPoint, 1);
    assert.equal(text.text, 'cortar 1 peça');
});

test('MTEXT rotacionado de verdade mantém o ângulo com ou sem Embedded Object', () => {
    const byVector = parseDxf(dxf([...mtext([[11, 0], [21, 1]]), ...embedded])).entities[0];
    assert.equal(byVector.rotation, 90);
    const byAngle = parseDxf(dxf([...mtext([[50, 30]]), ...embedded])).entities[0];
    assert.equal(byAngle.rotation, 30);
    assert.equal(parseDxf(dxf(mtext([[50, 30]]))).entities[0].rotation, 30);
});

function drawn(entity, scale) {
    const calls = { rotate: [], translate: [], bars: [], text: [] };
    const ctx = {
        save() {},
        restore() {},
        scale() {},
        rotate: (a) => calls.rotate.push(a),
        translate: (x, y) => calls.translate.push([x, y]),
        fillRect: (x, y, w, h) => calls.bars.push({ x, y, w, h }),
        fillText: (t, x, y) => calls.text.push({ t, x, y }),
        measureText: (t) => ({ width: t.length }),
    };
    const viewport = new Viewport(800, 600);
    viewport.scale = scale;
    Renderer.prototype.drawText.call({ ctx, viewport }, { type: 'text', height: 10, position: { x: 0, y: 0 }, ...entity }, { color: '#fff' });
    return calls;
}

test('zoom afastado desenha a barra no ângulo do texto', () => {
    const calls = drawn({ text: 'abcd', rotation: 30 }, 0.2);
    assert.equal(calls.text.length, 0);
    assert.equal(calls.bars.length, 1);
    assert.ok(Math.abs(calls.rotate[0] + (30 * Math.PI) / 180) < 1e-9);
});

test('a barra fica na mesma faixa do texto em cada alinhamento, com uma barra por linha', () => {
    const top = { text: 'abcd', attachmentPoint: 1, halign: 'left', valign: 'top' };
    const far = drawn(top, 0.2).bars[0];
    const near = drawn(top, 2).text[0];
    assert.ok(Math.abs(far.y / 0.2 - near.y / 2) < 10, 'mesma altura em unidades do desenho');
    assert.ok(far.y > -1, 'alinhado ao topo fica abaixo do ponto de inserção');

    const centered = drawn({ text: 'abcd', halign: 'center', valign: 'baseline' }, 0.2).bars[0];
    assert.ok(Math.abs(centered.x + centered.w / 2) < 1e-9);
    const right = drawn({ text: 'abcd', halign: 'right', valign: 'baseline' }, 0.2).bars[0];
    assert.ok(Math.abs(right.x + right.w) < 1e-9);

    const lines = drawn({ text: 'a\nb\nc', valign: 'top', attachmentPoint: 1 }, 0.2).bars;
    assert.equal(lines.length, 3);
    assert.ok(lines[0].y < lines[1].y && lines[1].y < lines[2].y);
});

test('a barra não passa da largura da caixa do MTEXT', () => {
    const [bar] = drawn({ text: 'x'.repeat(200), boxWidth: 50, attachmentPoint: 1, halign: 'left', valign: 'top' }, 0.2).bars;
    assert.equal(bar.w, 50 * 0.2);
    assert.equal(bar.x, 0);
});
