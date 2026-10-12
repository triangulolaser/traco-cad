import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon } from '../src/cad/edit-tools.js';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import { createDocument, addEntities } from '../src/cad/document.js';

test('pointInPolygon: verifica inclusão e exclusão de pontos em polígonos convexos e côncavos', () => {
    const square = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
    ];
    assert.equal(pointInPolygon({ x: 50, y: 50 }, square), true);
    assert.equal(pointInPolygon({ x: 150, y: 50 }, square), false);
    assert.equal(pointInPolygon({ x: -10, y: 50 }, square), false);

    // Polígono em L
    const lShape = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 100 },
        { x: 0, y: 100 },
    ];
    assert.equal(pointInPolygon({ x: 25, y: 25 }, lShape), true);
    assert.equal(pointInPolygon({ x: 75, y: 75 }, lShape), false); // corte do L
});

test('Comando DRAWORDER: registrado com aliases e reordena entidades (Frente, Trás, Acima, Abaixo)', async () => {
    assert.ok(COMMANDS.DRAWORDER);
    assert.ok(COMMANDS.DRAWORDER.aliases.includes('ORDEMDES'));
    assert.ok(COMMANDS.DRAWORDER.aliases.includes('ORDEM'));
    assert.equal(resolveCommand('ORDEMDES').name, 'DRAWORDER');

    const e1 = { id: 1, type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    const e2 = { id: 2, type: 'line', start: { x: 0, y: 10 }, end: { x: 10, y: 10 }, layer: '0' };
    const e3 = { id: 3, type: 'line', start: { x: 0, y: 20 }, end: { x: 10, y: 20 }, layer: '0' };
    let doc = addEntities(createDocument(), [e1, e2, e3]);

    // Teste Frente: mover e1 para frente de tudo (fim da lista)
    let commits = [];
    const editorFront = {
        doc,
        logs: [],
        log(msg) { this.logs.push(msg); },
        commit(desc, d) { commits.push(d); this.doc = d; },
        async getSelection() { return [1]; },
        async getKeyword() { return { key: 'f' }; },
    };
    await COMMANDS.DRAWORDER.run(editorFront);
    assert.equal(commits.length, 1);
    assert.deepEqual(editorFront.doc.entities.map(e => e.id), [2, 3, 1]);

    // Teste Trás: mover e3 para trás de tudo (início da lista)
    commits = [];
    const editorBack = {
        doc,
        logs: [],
        log(msg) { this.logs.push(msg); },
        commit(desc, d) { commits.push(d); this.doc = d; },
        async getSelection() { return [3]; },
        async getKeyword() { return { key: 't' }; },
    };
    await COMMANDS.DRAWORDER.run(editorBack);
    assert.equal(commits.length, 1);
    assert.deepEqual(editorBack.doc.entities.map(e => e.id), [3, 1, 2]);

    // Teste Acima: mover e1 para imediatamente acima de e2
    commits = [];
    const editorAbove = {
        doc,
        logs: [],
        log(msg) { this.logs.push(msg); },
        commit(desc, d) { commits.push(d); this.doc = d; },
        async getSelection() { return [1]; },
        async getKeyword() { return { key: 'a' }; },
        async getEntity() { return { entity: e2 }; },
    };
    await COMMANDS.DRAWORDER.run(editorAbove);
    assert.equal(commits.length, 1);
    assert.deepEqual(editorAbove.doc.entities.map(e => e.id), [2, 1, 3]);
});

test('Comando SELECTSIMILAR: registrado com aliases e filtra entidades pelo mesmo tipo e layer', async () => {
    assert.ok(COMMANDS.SELECTSIMILAR);
    assert.ok(COMMANDS.SELECTSIMILAR.aliases.includes('SELECSIMILAR'));
    assert.ok(COMMANDS.SELECTSIMILAR.aliases.includes('SIMILAR'));
    assert.equal(resolveCommand('SIMILAR').name, 'SELECTSIMILAR');

    const l1 = { id: 1, type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    const l2 = { id: 2, type: 'line', start: { x: 10, y: 0 }, end: { x: 20, y: 0 }, layer: '0' };
    const c1 = { id: 3, type: 'circle', center: { x: 0, y: 0 }, radius: 10, layer: '0' };
    const l3 = { id: 4, type: 'line', start: { x: 0, y: 10 }, end: { x: 20, y: 10 }, layer: 'COTAS' };
    const doc = addEntities(createDocument(), [l1, l2, c1, l3]);

    const editor = {
        doc,
        selection: new Set([1]), // Pré-seleção da linha 1
        entitiesById(ids) { return this.doc.entities.filter(e => ids.includes(e.id)); },
        logs: [],
        log(msg) { this.logs.push(msg); },
        invalidate() {},
        onChange() {},
    };

    await COMMANDS.SELECTSIMILAR.run(editor);
    // Deve selecionar as linhas 1 e 2 do layer 0 (excluindo círculo e linha no layer COTAS)
    assert.equal(editor.selection.size, 2);
    assert.ok(editor.selection.has(1));
    assert.ok(editor.selection.has(2));
    assert.ok(!editor.selection.has(3));
    assert.ok(!editor.selection.has(4));
});

test('Comando BOUNDARY: cria polilinha fechada a partir de cadeia de linhas ou ponto interno', async () => {
    assert.ok(COMMANDS.BOUNDARY);
    assert.ok(COMMANDS.BOUNDARY.aliases.includes('BPOLY'));
    assert.ok(COMMANDS.BOUNDARY.aliases.includes('CONTORNO'));
    assert.equal(resolveCommand('CONTORNO').name, 'BOUNDARY');

    // 4 linhas formando retângulo 50 x 30
    const l1 = { id: 1, type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, layer: '0' };
    const l2 = { id: 2, type: 'line', start: { x: 50, y: 0 }, end: { x: 50, y: 30 }, layer: '0' };
    const l3 = { id: 3, type: 'line', start: { x: 50, y: 30 }, end: { x: 0, y: 30 }, layer: '0' };
    const l4 = { id: 4, type: 'line', start: { x: 0, y: 30 }, end: { x: 0, y: 0 }, layer: '0' };
    const doc = addEntities(createDocument(), [l1, l2, l3, l4]);

    const commits = [];
    const editorSelect = {
        doc,
        logs: [],
        log(msg) { this.logs.push(msg); },
        commit(desc, d) { commits.push(d); this.doc = d; },
        clearSelection() {},
        async getPoint() { return { keyword: 's' }; },
        async getSelection() { return [1, 2, 3, 4]; },
        entitiesById(ids) { return this.doc.entities.filter(e => ids.includes(e.id)); },
    };

    await COMMANDS.BOUNDARY.run(editorSelect);
    assert.equal(commits.length, 1);
    const poly = editorSelect.doc.entities.find(e => e.type === 'polyline' && e.closed);
    assert.ok(poly, 'Deveria ter gerado uma polilinha fechada');
    assert.equal(poly.vertices.length, 4);

    // Teste por ponto interno
    const commitsPoint = [];
    const editorPoint = {
        doc,
        logs: [],
        log(msg) { this.logs.push(msg); },
        commit(desc, d) { commitsPoint.push(d); this.doc = d; },
        clearSelection() {},
        async getPoint() { return { point: { x: 25, y: 15 } }; }, // Ponto central
    };
    await COMMANDS.BOUNDARY.run(editorPoint);
    assert.equal(commitsPoint.length, 1);
    const polyPoint = editorPoint.doc.entities.find(e => e.type === 'polyline' && e.closed);
    assert.ok(polyPoint, 'Deveria ter gerado polilinha por ponto interno');
});

test('Comando BURST: desagrupa bloco preservando atributos como texto', async () => {
    assert.ok(COMMANDS.BURST);
    assert.equal(resolveCommand('BURST').name, 'BURST');

    // Cria documento com definição de bloco e insert com atributos
    let doc = createDocument();
    doc.blocks = {
        'CARIMBO': [
            { type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
        ],
    };
    const insert = {
        id: 10,
        type: 'insert',
        name: 'CARIMBO',
        position: { x: 100, y: 100 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        layer: '0',
        attributes: {
            'TITULO': {
                position: { x: 105, y: 105 },
                value: 'PECA-TESTE-TRLS',
                height: 3.5,
            },
        },
    };
    doc = addEntities(doc, [insert]);

    const commits = [];
    const editor = {
        doc,
        logs: [],
        log(msg) { this.logs.push(msg); },
        commit(desc, d) { commits.push(d); this.doc = d; },
        clearSelection() {},
        async getSelection() { return [10]; },
        entitiesById(ids) { return this.doc.entities.filter(e => ids.includes(e.id)); },
    };

    await COMMANDS.BURST.run(editor);
    assert.equal(commits.length, 1);
    // Deve ter substituído o insert por uma linha e um texto com 'PECA-TESTE-TRLS'
    assert.ok(!editor.doc.entities.some(e => e.type === 'insert'));
    const text = editor.doc.entities.find(e => e.type === 'text');
    assert.ok(text, 'Deveria ter gerado entidade texto para o atributo');
    assert.equal(text.text, 'PECA-TESTE-TRLS');
});
