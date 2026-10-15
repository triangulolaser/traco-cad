import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';
import { createDocument, addEntities } from '../src/cad/document.js';

function recordingCanvas(log) {
    const ctx = new Proxy({}, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (prop === 'stroke') return () => log.push('lote');
            if (prop === 'measureText') return (t) => ({ width: String(t).length * 7 });
            return () => {};
        },
        set(target, prop, value) { target[prop] = value; return true; },
    });
    return { width: 800, height: 600, style: {}, getContext: () => ctx };
}

test('linha em hover é desenhada por cima de imagem raster que vem depois dela', () => {
    const log = [];
    const renderer = new Renderer(recordingCanvas(log), new Viewport(800, 600));
    renderer.drawEntity = (entity) => log.push(entity.id);
    let doc = createDocument();
    doc = addEntities(doc, [
        { id: 'linha', type: 'line', start: { x: -50, y: 0 }, end: { x: 50, y: 0 }, layer: '0' },
        { id: 'outra', type: 'line', start: { x: -50, y: 10 }, end: { x: 50, y: 10 }, layer: '0' },
        { id: 'scan', type: 'image', position: { x: -100, y: -100 }, width: 200, height: 200, layer: '0' },
    ]);
    log.length = 0;
    renderer.draw({ doc, selection: new Set(), hover: 'linha' });
    const scan = log.indexOf('scan');
    assert.ok(scan >= 0, 'imagem deve ser desenhada');
    assert.ok(log.indexOf('linha') > scan, `hover depois da imagem: ${log.join(',')}`);
    assert.ok(log.indexOf('lote') > scan, 'lote de linhas depois da imagem');
});
