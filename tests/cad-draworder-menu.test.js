import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMMANDS, resolveCommand, reorderEntities } from '../src/cad/commands.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';

const line = (id) => ({ id, type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' });
const text = (id, x = 0) => ({ id, type: 'text', position: { x, y: 0 }, text: 'A', height: 5, layer: '0' });
const dim = (id) => ({ id, type: 'dimension', kind: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, linePoint: { x: 0, y: 5 }, textPosition: { x: 5, y: 5 }, layer: '0' });
const hatch = (id) => ({ id, type: 'hatch', loops: [{ vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }], pattern: 'SOLID', layer: '0' });

function fakeEditor(doc, { selection = [], keyword = null, ref = null } = {}) {
    return {
        doc,
        logs: [],
        prompts: [],
        log(msg) { this.logs.push(msg); },
        commit(_desc, d) { this.doc = d; },
        async getSelection() { return selection; },
        async getKeyword(prompt) { this.prompts.push(prompt); return keyword ? { key: keyword } : null; },
        async getEntity() { return ref ? { entity: ref } : null; },
    };
}

test('reorderEntities: frente, trás, acima e abaixo da referência', () => {
    const list = [line(1), line(2), line(3), line(4)];
    assert.deepEqual(reorderEntities(list, [1], 'f').map((e) => e.id), [2, 3, 4, 1]);
    assert.deepEqual(reorderEntities(list, [4], 't').map((e) => e.id), [4, 1, 2, 3]);
    assert.deepEqual(reorderEntities(list, [1], 'a', 3).map((e) => e.id), [2, 3, 1, 4]);
    assert.deepEqual(reorderEntities(list, [4], 'u', 2).map((e) => e.id), [1, 4, 2, 3]);
});

test('DRAWORDER com opção do menu não pergunta a direção', async () => {
    const doc = addEntities(createDocument(), [line(1), line(2), line(3)]);
    const front = fakeEditor(doc, { selection: [1] });
    await COMMANDS.DRAWORDER.run(front, ['f']);
    assert.deepEqual(front.doc.entities.map((e) => e.id), [2, 3, 1]);
    assert.equal(front.prompts.length, 0);

    const back = fakeEditor(doc, { selection: [3] });
    await COMMANDS.DRAWORDER.run(back, ['t']);
    assert.deepEqual(back.doc.entities.map((e) => e.id), [3, 1, 2]);

    const above = fakeEditor(doc, { selection: [1], ref: doc.entities[1] });
    await COMMANDS.DRAWORDER.run(above, ['a']);
    assert.deepEqual(above.doc.entities.map((e) => e.id), [2, 1, 3]);
    assert.equal(above.prompts.length, 0);

    const ask = fakeEditor(doc, { selection: [1], keyword: 't' });
    await COMMANDS.DRAWORDER.run(ask, []);
    assert.equal(ask.prompts.length, 1, 'sem opção, segue perguntando');
});

test('TEXTTOFRONT leva textos, cotas ou ambos para a frente; HATCHTOBACK manda hachuras para trás', async () => {
    assert.equal(resolveCommand('TEXTOFRENTE').name, 'TEXTTOFRONT');
    assert.equal(resolveCommand('HACHURATRAS').name, 'HATCHTOBACK');
    const doc = addEntities(createDocument(), [text('t1'), dim('d1'), line('l1'), hatch('h1'), line('l2')]);

    const t = fakeEditor(doc);
    await COMMANDS.TEXTTOFRONT.run(t, ['t']);
    assert.deepEqual(t.doc.entities.map((e) => e.id), ['d1', 'l1', 'h1', 'l2', 't1']);

    const d = fakeEditor(doc);
    await COMMANDS.TEXTTOFRONT.run(d, ['d']);
    assert.deepEqual(d.doc.entities.map((e) => e.id), ['t1', 'l1', 'h1', 'l2', 'd1']);

    const a = fakeEditor(doc, { keyword: 'a' });
    await COMMANDS.TEXTTOFRONT.run(a, []);
    assert.deepEqual(a.doc.entities.map((e) => e.id), ['l1', 'h1', 'l2', 't1', 'd1']);
    assert.equal(a.prompts.length, 1);

    const h = fakeEditor(doc);
    await COMMANDS.HATCHTOBACK.run(h);
    assert.deepEqual(h.doc.entities.map((e) => e.id), ['h1', 't1', 'd1', 'l1', 'l2']);

    const none = fakeEditor(addEntities(createDocument(), [line(1)]));
    let committed = false;
    none.commit = () => { committed = true; };
    await COMMANDS.HATCHTOBACK.run(none);
    assert.equal(committed, false, 'sem hachura não cria passo no desfazer');
});

function recordingCanvas() {
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

test('renderizador sobrepõe na ordem do documento, não na ordem do índice espacial', () => {
    const renderer = new Renderer(recordingCanvas(), new Viewport(800, 600));
    const drawn = [];
    renderer.drawEntity = (entity) => drawn.push(entity.id);
    const items = Array.from({ length: 40 }, (_, i) => text(`t${i}`, (i * 37) % 200 - 100));
    for (const order of [items, [...items].reverse()]) {
        const doc = addEntities(createDocument(), order);
        drawn.length = 0;
        renderer.draw({ doc, selection: new Set() });
        const expected = order.map((e) => e.id).filter((id) => drawn.includes(id));
        assert.ok(expected.length > 10, 'textos visíveis');
        assert.deepEqual(drawn.filter((id) => id.startsWith('t')), expected);
    }
});

test('Ribbon: menu Ordem com as nove opções', () => {
    const desktop = readFileSync(resolve('index.html'), 'utf8');
    assert.ok(desktop.includes('data-cad-split="draworder"'));
    const labels = ['Ordem Desenho', 'Trazer para a Frente', 'Enviar para Trás', 'Trazer Acima', 'Enviar Abaixo',
        'Trazer Texto p/ Frente', 'Trazer Dimensões p/ Frente', 'Trazer Texto e Dimensões p/ Frente', 'Enviar Hachuras p/ Trás'];
    for (const label of labels) assert.ok(desktop.includes(`data-cad-label="${label}"`), `sem ${label}`);
    for (const arg of ['f', 't', 'a', 'u']) assert.ok(desktop.includes(`data-cad-command="DRAWORDER" data-cad-args="${arg}"`));
    for (const arg of ['t', 'd', 'a']) assert.ok(desktop.includes(`data-cad-command="TEXTTOFRONT" data-cad-args="${arg}"`));
    assert.ok(desktop.includes('data-cad-command="HATCHTOBACK"'));
});
