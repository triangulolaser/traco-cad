import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, addEntities, History } from '../src/cad/document.js';
import { COMMANDS } from '../src/cad/commands.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';

function createMockEditor(doc = createDocument()) {
    const logs = [];
    const commitments = [];
    return {
        doc,
        history: new History(doc),
        canvas: { clientWidth: 800, clientHeight: 600, width: 800, height: 600 },
        viewport: { originX: 0, originY: 0, scale: 1 },
        selection: new Set(),
        logs,
        commitments,
        commit(desc, newDoc) {
            commitments.push({ desc, newDoc });
            this.doc = newDoc;
            this.history = new History(newDoc);
        },
        log(msg, level) {
            logs.push({ msg, level });
        },
        invalidate() {},
        render() {},
        async getPoint(prompt, options = {}) {
            if (this.pointQueue && this.pointQueue.length > 0) {
                const next = this.pointQueue.shift();
                return typeof next === 'function' ? next(prompt, options) : next;
            }
            return { point: { x: 0, y: 0 } };
        },
        async getPointOrEntity(prompt, options = {}) {
            if (this.pointOrEntityQueue && this.pointOrEntityQueue.length > 0) {
                const next = this.pointOrEntityQueue.shift();
                return typeof next === 'function' ? next(prompt, options) : next;
            }
            return { point: { x: 0, y: 0 } };
        },
        async getEntity(prompt, options = {}) {
            if (this.entityQueue && this.entityQueue.length > 0) {
                return this.entityQueue.shift();
            }
            return null;
        },
    };
}

test('DIMLINEAR suporta dois pontos quaisquer arbitrários sem depender de entidades', async () => {
    const editor = createMockEditor();
    
    // Fila de pontos simulando cliques do usuário:
    // 1. Primeiro ponto qualquer (ex: 15.5, 20.0)
    // 2. Segundo ponto qualquer (ex: 85.5, 40.0)
    // 3. Posição da linha de cota (ex: 50.0, 70.0)
    editor.pointQueue = [
        { point: { x: 15.5, y: 20.0 } },
        { point: { x: 85.5, y: 40.0 } },
        { point: { x: 50.0, y: 70.0 } },
    ];

    const entity = await COMMANDS.DIMLINEAR.run(editor);

    assert.ok(entity, 'Deve retornar a entidade de cota linear');
    assert.equal(entity.type, 'dimension');
    assert.deepEqual(entity.p1, { x: 15.5, y: 20.0 });
    assert.deepEqual(entity.p2, { x: 85.5, y: 40.0 });
    assert.deepEqual(entity.linePoint, { x: 50.0, y: 70.0 });
    assert.equal(entity.kind, 'horizontal'); // Posição acima com deltaX maior

    // Validação da geometria
    const g = dimensionGeometry(entity, editor.doc.dimStyle);
    assert.equal(g.text, '70'); // |85.5 - 15.5| = 70
});

test('DIMLINEAR permite selecionar objeto quando pressionado Enter no primeiro prompt', async () => {
    const doc = createDocument();
    const lineEntity = { id: 'line-1', type: 'line', start: { x: 10, y: 10 }, end: { x: 60, y: 10 }, layer: '0' };
    const editor = createMockEditor(addEntities(doc, [lineEntity]));

    // 1. Usuário pressiona Enter (ou 'o') no primeiro prompt
    // 2. Clica para definir a posição da linha de cota
    editor.pointQueue = [
        { enter: true },
        { point: { x: 35, y: 30 } },
    ];
    editor.entityQueue = [
        { entity: lineEntity, point: { x: 25, y: 10 } },
    ];

    const entity = await COMMANDS.DIMLINEAR.run(editor);

    assert.ok(entity, 'Deve retornar cota linear gerada a partir do objeto');
    assert.deepEqual(entity.p1, { x: 10, y: 10 });
    assert.deepEqual(entity.p2, { x: 60, y: 10 });
    const g = dimensionGeometry(entity, editor.doc.dimStyle);
    assert.equal(g.text, '50');
});

test('DIMALIGNED suporta dois pontos quaisquer arbitrários', async () => {
    const editor = createMockEditor();

    // 1. Ponto 1: (0, 0)
    // 2. Ponto 2: (30, 40) -> hipotenusa 50
    // 3. Posição da cota: (-10, 50)
    editor.pointQueue = [
        { point: { x: 0, y: 0 } },
        { point: { x: 30, y: 40 } },
        { point: { x: -10, y: 50 } },
    ];

    const entity = await COMMANDS.DIMALIGNED.run(editor);

    assert.ok(entity, 'Deve retornar entidade de cota alinhada');
    assert.equal(entity.kind, 'aligned');
    assert.deepEqual(entity.p1, { x: 0, y: 0 });
    assert.deepEqual(entity.p2, { x: 30, y: 40 });

    const g = dimensionGeometry(entity, editor.doc.dimStyle);
    assert.equal(g.text, '50');
});

test('DIMHORIZONTAL e DIMVERTICAL forçam as direções corretas com dois pontos quaisquer', async () => {
    const editor = createMockEditor();

    // Horizontal
    editor.pointQueue = [
        { point: { x: 10, y: 20 } },
        { point: { x: 70, y: 80 } },
        { point: { x: 40, y: 90 } },
    ];
    const horiz = await COMMANDS.DIMHORIZONTAL.run(editor);
    assert.equal(horiz.kind, 'horizontal');
    assert.equal(dimensionGeometry(horiz, editor.doc.dimStyle).text, '60');

    // Vertical
    editor.pointQueue = [
        { point: { x: 10, y: 20 } },
        { point: { x: 70, y: 80 } },
        { point: { x: 90, y: 50 } },
    ];
    const vert = await COMMANDS.DIMVERTICAL.run(editor);
    assert.equal(vert.kind, 'vertical');
    assert.equal(dimensionGeometry(vert, editor.doc.dimStyle).text, '60');
});

test('DIM (Cota Auto) suporta dois pontos quaisquer com cliques consecutivos', async () => {
    const editor = createMockEditor();

    // Rodar uma iteração do dimAuto com dois pontos quaisquer e depois Enter para sair
    editor.pointOrEntityQueue = [
        { point: { x: 20, y: 15 } },
        { enter: true }, // encerra o loop do dimAuto
    ];
    editor.pointQueue = [
        { point: { x: 100, y: 15 } }, // segundo ponto
        { point: { x: 60, y: 35 } },  // posição da linha de cota
    ];

    await COMMANDS.DIM.run(editor);

    const dims = editor.doc.entities.filter((e) => e.type === 'dimension');
    assert.equal(dims.length, 1, 'Deve criar exatamente 1 cota a partir dos dois pontos');
    assert.deepEqual(dims[0].p1, { x: 20, y: 15 });
    assert.deepEqual(dims[0].p2, { x: 100, y: 15 });
    assert.equal(dimensionGeometry(dims[0], editor.doc.dimStyle).text, '80');
});
