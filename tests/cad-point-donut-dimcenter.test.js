import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import {
    createDocument,
    addEntities,
    editableEntities,
    layerOf,
} from '../src/cad/document.js';
import {
    entityBox,
    transformEntity,
    translateEntity,
    rotateEntity,
    scaleEntity,
    polylineCurves,
    distance,
} from '../src/cad/geometry.js';
import { getEntityGrips, applyGripMove } from '../src/cad/grips.js';
import { findSnap } from '../src/cad/snaps.js';
import { DIMENSION_LAYER } from '../src/cad/dimensions.js';

function createMockEditor(initialDoc = createDocument()) {
    let doc = initialDoc;
    const logs = [];
    const memory = {};
    const commits = [];

    const editor = {
        doc,
        selection: new Set(),
        memory,
        commits,
        logs,
        log(msg, level = 'info') {
            logs.push({ msg, level });
        },
        commit(desc, nextDoc) {
            commits.push({ desc, prev: doc, next: nextDoc });
            doc = nextDoc;
            editor.doc = nextDoc;
        },
        get activeLayer() {
            return doc.activeLayer;
        },
    };
    return editor;
}

test('Comando POINT: registrado com aliases PO e PONTO', () => {
    assert.ok(COMMANDS.POINT, 'Comando POINT deve estar registrado');
    assert.deepEqual(COMMANDS.POINT.aliases.slice(0, 2), ['PO', 'PONTO']);
    assert.equal(resolveCommand('PO')?.name, 'POINT');
    assert.equal(resolveCommand('PONTO')?.name, 'POINT');
    assert.equal(resolveCommand('po')?.name, 'POINT');
});

test('Comando POINT: cria entidades point em loop com preview até Enter', async () => {
    const editor = createMockEditor();
    let callCount = 0;

    editor.getPoint = async (prompt, options) => {
        callCount++;
        if (callCount === 1) {
            // Verifica que o preview gera entidade point
            if (options.preview) {
                const prev = options.preview({ x: 10, y: 20 });
                assert.equal(prev[0].type, 'point');
                assert.deepEqual(prev[0].position, { x: 10, y: 20 });
            }
            return { point: { x: 10, y: 20 } };
        }
        if (callCount === 2) {
            return { point: { x: 30, y: 40 } };
        }
        return { enter: true };
    };

    await COMMANDS.POINT.run(editor);

    const points = editor.doc.entities.filter((e) => e.type === 'point');
    assert.equal(points.length, 2, 'Deve ter criado 2 pontos');
    assert.deepEqual(points[0].position, { x: 10, y: 20 });
    assert.deepEqual(points[1].position, { x: 30, y: 40 });
    assert.equal(editor.commits.length, 2);
    assert.ok(editor.logs.some((l) => l.msg.includes('2 ponto(s) criado(s)')));
});

test('Entidade POINT: geometria (entityBox, transformEntity, grips, OSNAP)', () => {
    const pt = { id: 'pt1', type: 'point', position: { x: 50, y: 50 }, layer: '0' };

    // 1. entityBox
    const box = entityBox(pt);
    assert.equal(box.minX, 50);
    assert.equal(box.maxX, 50);
    assert.equal(box.minY, 50);
    assert.equal(box.maxY, 50);

    // 2. transformEntity (translação)
    const translated = translateEntity(pt, { x: 10, y: -20 });
    assert.deepEqual(translated.position, { x: 60, y: 30 });

    // 3. transformEntity (escala a partir da origem)
    const scaled = scaleEntity(pt, { x: 0, y: 0 }, 2);
    assert.deepEqual(scaled.position, { x: 100, y: 100 });

    // 4. getEntityGrips e applyGripMove
    const grips = getEntityGrips(pt);
    assert.equal(grips.length, 1);
    assert.equal(grips[0].type, 'point');
    assert.deepEqual(grips[0].point, { x: 50, y: 50 });

    const moved = applyGripMove(pt, grips[0], { x: 80, y: 90 });
    assert.deepEqual(moved.position, { x: 80, y: 90 });

    // 5. OSNAP nod
    const snap = findSnap([pt], { x: 50.8, y: 49.6 }, 2.0, { nod: true, end: true });
    assert.ok(snap, 'Deve encontrar snap nod no ponto');
    assert.equal(snap.mode, 'nod');
    assert.deepEqual(snap.point, { x: 50, y: 50 });
});

test('Comando DONUT: registrado com aliases DO, DOUGHNUT e ANEL', () => {
    assert.ok(COMMANDS.DONUT, 'Comando DONUT deve estar registrado');
    assert.deepEqual(COMMANDS.DONUT.aliases.slice(0, 3), ['DO', 'DOUGHNUT', 'ANEL']);
    assert.equal(resolveCommand('DO')?.name, 'DONUT');
    assert.equal(resolveCommand('DOUGHNUT')?.name, 'DONUT');
    assert.equal(resolveCommand('ANEL')?.name, 'DONUT');
});

test('Comando DONUT: cria polilinha fechada com 2 arcos e espessura constante correta', async () => {
    const editor = createMockEditor();

    let step = 0;
    editor.getNumber = async (prompt, options) => {
        step++;
        if (step === 1) {
            // Diâmetro interno = 20
            assert.ok(prompt.toLowerCase().includes('interno'));
            return 20;
        }
        if (step === 2) {
            // Diâmetro externo = 40
            assert.ok(prompt.toLowerCase().includes('externo'));
            return 40;
        }
    };

    let pointCount = 0;
    editor.getPoint = async (prompt, options) => {
        pointCount++;
        if (pointCount === 1) {
            // Testa preview
            if (options.preview) {
                const prev = options.preview({ x: 100, y: 100 });
                assert.equal(prev[0].type, 'polyline');
                assert.equal(prev[0].closed, true);
                assert.equal(prev[0].constantWidth, 10); // (40 - 20) / 2 = 10
            }
            return { point: { x: 100, y: 100 } };
        }
        return { enter: true };
    };

    await COMMANDS.DONUT.run(editor);

    const donuts = editor.doc.entities.filter((e) => e.type === 'polyline');
    assert.equal(donuts.length, 1);
    const d = donuts[0];
    assert.equal(d.closed, true);
    assert.equal(d.constantWidth, 10); // (40 - 20) / 2
    assert.equal(d.vertices.length, 2);

    // Raio médio Rm = (20 + 40) / 4 = 15
    // Vértice 0 em (100 - 15, 100) = (85, 100) com bulge 1
    // Vértice 1 em (100 + 15, 100) = (115, 100) com bulge 1
    assert.deepEqual(d.vertices[0], { x: 85, y: 100, bulge: 1 });
    assert.deepEqual(d.vertices[1], { x: 115, y: 100, bulge: 1 });

    // Verifica que polylineCurves reconstrói dois semicírculos perfeitos
    const curves = polylineCurves(d.vertices, d.closed);
    assert.equal(curves.length, 2);
    assert.equal(curves[0].kind, 'arc');
    assert.equal(curves[1].kind, 'arc');
    assert.equal(curves[0].radius, 15);
    assert.equal(curves[1].radius, 15);
    assert.deepEqual(curves[0].center, { x: 100, y: 100 });
    assert.deepEqual(curves[1].center, { x: 100, y: 100 });

    // Memória preservada
    assert.equal(editor.memory.donutInside, 20);
    assert.equal(editor.memory.donutOutside, 40);
});

test('Comando DONUT: suporta disco sólido quando diâmetro interno = 0', async () => {
    const editor = createMockEditor();

    let step = 0;
    editor.getNumber = async (prompt, options) => {
        step++;
        if (step === 1) return 0; // Diâmetro interno = 0
        if (step === 2) return 20; // Diâmetro externo = 20
    };

    let ptStep = 0;
    editor.getPoint = async () => {
        ptStep++;
        if (ptStep === 1) return { point: { x: 0, y: 0 } };
        return { enter: true };
    };

    await COMMANDS.DONUT.run(editor);

    const d = editor.doc.entities[0];
    assert.equal(d.type, 'polyline');
    // Rm = (0 + 20) / 4 = 5
    // Width = (20 - 0) / 2 = 10
    // Borda externa = Rm + Width/2 = 5 + 5 = 10 (raio 10, diâmetro 20)
    // Borda interna = Rm - Width/2 = 5 - 5 = 0 (disco maciço)
    assert.equal(d.constantWidth, 10);
    assert.deepEqual(d.vertices[0], { x: -5, y: 0, bulge: 1 });
    assert.deepEqual(d.vertices[1], { x: 5, y: 0, bulge: 1 });
});

test('Comando DIMCENTER: registrado com aliases DCE, CENTRO e MARCACENTRO', () => {
    assert.ok(COMMANDS.DIMCENTER, 'Comando DIMCENTER deve estar registrado');
    assert.deepEqual(COMMANDS.DIMCENTER.aliases.slice(0, 3), ['DCE', 'CENTRO', 'MARCACENTRO']);
    assert.equal(resolveCommand('DCE')?.name, 'DIMCENTER');
    assert.equal(resolveCommand('CENTRO')?.name, 'DIMCENTER');
    assert.equal(resolveCommand('MARCACENTRO')?.name, 'DIMCENTER');
});

test('Comando DIMCENTER: cria linhas cruzadas no centro de arco ou círculo', async () => {
    let doc = createDocument();
    const circle = { id: 'c1', type: 'circle', center: { x: 150, y: 200 }, radius: 35, layer: '0' };
    doc = addEntities(doc, [circle]);
    doc.dimStyle = { scale: 1.0, dimCen: 3.0 };

    const editor = createMockEditor(doc);

    let pickCount = 0;
    editor.getEntity = async (prompt, options) => {
        pickCount++;
        if (pickCount === 1) {
            return { entity: circle };
        }
        return { enter: true };
    };

    await COMMANDS.DIMCENTER.run(editor);

    // Deve ter adicionado 2 linhas (horizontal e vertical) cruzando em (150, 200) com tamanho 3.0
    const lines = editor.doc.entities.filter((e) => e.type === 'line');
    assert.equal(lines.length, 2, 'Deve ter criado 2 linhas da cruzeta de centro');

    const h = lines.find((l) => l.start.y === l.end.y);
    const v = lines.find((l) => l.start.x === l.end.x);
    assert.ok(h, 'Deve ter linha horizontal');
    assert.ok(v, 'Deve ter linha vertical');

    assert.deepEqual(h.start, { x: 147, y: 200 });
    assert.deepEqual(h.end, { x: 153, y: 200 });
    assert.deepEqual(v.start, { x: 150, y: 197 });
    assert.deepEqual(v.end, { x: 150, y: 203 });

    // Layer de cota
    assert.equal(h.layer, DIMENSION_LAYER);
    assert.equal(v.layer, DIMENSION_LAYER);
});

test('Comando DIMCENTER: suporta linhas estendidas quando dimCen é negativo', async () => {
    let doc = createDocument();
    const circle = { id: 'c2', type: 'circle', center: { x: 100, y: 100 }, radius: 40, layer: '0' };
    doc = addEntities(doc, [circle]);
    doc.dimStyle = { scale: 1.0, dimCen: -2.5 };

    const editor = createMockEditor(doc);

    let pickCount = 0;
    editor.getEntity = async () => {
        pickCount++;
        if (pickCount === 1) return { entity: circle };
        return { enter: true };
    };

    await COMMANDS.DIMCENTER.run(editor);

    // Com dimCen < 0, cria 2 linhas da cruzeta central + 4 extensões nas pontas = 6 linhas
    const lines = editor.doc.entities.filter((e) => e.type === 'line');
    assert.equal(lines.length, 6, 'Cruzeta central + 4 extensões de centro');
});
