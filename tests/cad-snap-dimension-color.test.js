import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';

function strokeCanvas(log) {
    const ctx = new Proxy({}, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'stroke') return () => log.push(target.strokeStyle);
            return () => {};
        },
        set(target, prop, value) { target[prop] = value; return true; },
    });
    return { width: 800, height: 600, style: {}, getContext: () => ctx };
}

test('snap em cota usa a cor roxa e snap em geometria mantém a cor normal', () => {
    const log = [];
    const renderer = new Renderer(strokeCanvas(log), new Viewport(800, 600));
    const point = { x: 0, y: 0 };
    renderer.drawSnap({ mode: 'end', point, entity: { type: 'dimension' } });
    renderer.drawSnap({ mode: 'end', point, entity: { type: 'line' } });
    renderer.drawSnap({ mode: 'end', point });
    assert.equal(log[0], renderer.theme.snapDim);
    assert.notEqual(renderer.theme.snapDim, renderer.theme.snap);
    assert.equal(log[1], renderer.theme.snap);
    assert.equal(log[2], renderer.theme.snap);
});
