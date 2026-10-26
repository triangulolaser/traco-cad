import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, THEMES } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';

// Canvas falso: getImageData devolve pixels de cor uniforme; stroke registra a cor.
function pixelCanvas(log, rgb) {
    const state = { rgb };
    const ctx = new Proxy({}, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'stroke' || prop === 'strokeRect') return () => log.push(target.strokeStyle);
            if (prop === 'getImageData') return (x, y, w, h) => {
                const data = new Uint8ClampedArray(w * h * 4);
                for (let i = 0; i < data.length; i += 4) data.set([...state.rgb, 255], i);
                return { data };
            };
            return () => {};
        },
        set(target, prop, value) { target[prop] = value; return true; },
    });
    return { canvas: { width: 800, height: 600, style: {}, getContext: () => ctx }, state };
}

const cursor = { x: 0, y: 0 };

test('mira no tema claro sobre imagem preta usa as cores do tema escuro', () => {
    const log = [];
    const { canvas } = pixelCanvas(log, [10, 10, 10]);
    const renderer = new Renderer(canvas, new Viewport(800, 600));
    renderer.setTheme('light');
    renderer.drawCrosshair(cursor, false, 'select');
    assert.deepEqual(log, [THEMES.dark.crosshairX, THEMES.dark.crosshairY, THEMES.dark.crosshair]);
});

test('mira no tema escuro sobre área clara usa as cores do tema claro', () => {
    const log = [];
    const { canvas } = pixelCanvas(log, [245, 245, 245]);
    const renderer = new Renderer(canvas, new Viewport(800, 600));
    renderer.setTheme('dark');
    renderer.drawCrosshair(cursor, false, 'pick');
    assert.ok(log.includes(THEMES.light.crosshair));
    assert.ok(!log.includes(THEMES.dark.crosshair));
});

test('histerese: tom médio não troca a mira de lado', () => {
    const log = [];
    const { canvas, state } = pixelCanvas(log, [10, 10, 10]);
    const renderer = new Renderer(canvas, new Viewport(800, 600));
    renderer.setTheme('light');
    renderer.drawCrosshair(cursor, false, 'pick');
    assert.equal(renderer.lastCrosshairDark, true);
    state.rgb = [120, 120, 120];
    renderer.drawCrosshair(cursor, false, 'pick');
    assert.equal(renderer.lastCrosshairDark, true);
    state.rgb = [230, 230, 230];
    renderer.drawCrosshair(cursor, false, 'pick');
    assert.equal(renderer.lastCrosshairDark, false);
});

test('sem leitura de pixels a mira segue o tema', () => {
    const log = [];
    const ctx = new Proxy({}, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'strokeRect') return () => log.push(target.strokeStyle);
            if (prop === 'getImageData') return () => { throw new Error('tainted'); };
            return () => {};
        },
        set(target, prop, value) { target[prop] = value; return true; },
    });
    const renderer = new Renderer({ width: 800, height: 600, style: {}, getContext: () => ctx }, new Viewport(800, 600));
    renderer.setTheme('light');
    renderer.drawCrosshair(cursor, false, 'pick');
    assert.ok(log.includes(THEMES.light.crosshair));
});
