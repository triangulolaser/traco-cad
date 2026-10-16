import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';
import { createDocument, addEntities } from '../src/cad/document.js';

function canvas() {
    const ctx = new Proxy({}, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'measureText') return (t) => ({ width: String(t).length * 7 });
            return () => {};
        },
        set(target, prop, value) { target[prop] = value; return true; },
    });
    return { width: 800, height: 600, style: {}, getContext: () => ctx };
}

test('mover deixa o original no lugar, tracejado e apagado', () => {
    const calls = [];
    const renderer = new Renderer(canvas(), new Viewport(800, 600));
    renderer.drawEntity = (entity, style) => calls.push({ id: entity.id, style });
    const doc = addEntities(createDocument(), [
        { id: 'peca', type: 'line', start: { x: -50, y: 0 }, end: { x: 50, y: 0 }, layer: '0' },
    ]);
    renderer.draw({ doc, selection: new Set(), hiddenIds: new Set(['peca']), ghostIds: new Set(['peca']) });
    const ghost = calls.find((c) => c.id === 'peca');
    assert.ok(ghost, 'original deve aparecer como fantasma');
    assert.equal(ghost.style.dashed, true);
    assert.ok(ghost.style.alpha < 0.6);
});

test('escondido sem fantasma continua invisível (edição de texto)', () => {
    const calls = [];
    const renderer = new Renderer(canvas(), new Viewport(800, 600));
    renderer.drawEntity = (entity) => calls.push(entity.id);
    const doc = addEntities(createDocument(), [
        { id: 'peca', type: 'line', start: { x: -50, y: 0 }, end: { x: 50, y: 0 }, layer: '0' },
    ]);
    renderer.draw({ doc, selection: new Set(), hiddenIds: new Set(['peca']) });
    assert.ok(!calls.includes('peca'));
});

test('prévia com cor ACI numérica (DXF) vira hex ajustado ao fundo', () => {
    const calls = [];
    const renderer = new Renderer(canvas(), new Viewport(800, 600));
    renderer.drawEntity = (entity, style) => calls.push(style.color);
    const doc = createDocument();
    renderer.draw({ doc, selection: new Set(), preview: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, color: 7, layer: '0' }] });
    assert.equal(calls[0], renderer.entityDisplayColor('#ffffff'));
});
