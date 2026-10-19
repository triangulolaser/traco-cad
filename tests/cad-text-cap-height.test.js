import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';
import { CAP_HEIGHT_RATIO, LINE_SPACING } from '../src/cad/fonts.js';

// Altura de texto/cota no CAD é a altura da maiúscula, como no BricsCAD: o corpo da fonte é maior.
test('drawText usa a altura como altura da maiúscula e espaçamento de linha do MTEXT', () => {
    const fonts = [];
    const ys = [];
    const ctx = {
        save() {}, restore() {}, translate() {}, rotate() {},
        set font(value) { fonts.push(value); },
        fillText(_t, _x, y) { ys.push(y); },
        measureText: () => ({ width: 10 }),
    };
    const viewport = new Viewport(800, 600);
    viewport.scale = 10;
    Renderer.prototype.drawText.call({ ctx, viewport }, { type: 'text', text: 'A\nB', height: 8, position: { x: 0, y: 0 }, valign: 'top' }, { color: '#000' });
    const size = Number(/([\d.]+)px/.exec(fonts.at(-1))[1]);
    assert.ok(Math.abs(size - 80 / CAP_HEIGHT_RATIO) < 1e-6, `corpo ${size}px`);
    assert.ok(Math.abs(ys[0] - 80) < 1e-6, 'topo alinhado ao topo da maiúscula');
    assert.ok(Math.abs(ys[1] - ys[0] - 80 * LINE_SPACING) < 1e-6);
});
