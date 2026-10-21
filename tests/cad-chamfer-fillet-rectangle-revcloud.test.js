import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import {
    createDocument,
    addEntities,
    replaceEntities,
} from '../src/cad/document.js';
import {
    createRectangleEntity,
    polylineFillet,
    polylineChamfer,
    createRevcloudFromEntity,
} from '../src/cad/edit-tools.js';
import { polylineCurves, distance } from '../src/cad/geometry.js';

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
        runCommand(name, args) {
            logs.push({ msg: `RUN: ${name}`, level: 'command' });
        },
    };
    return editor;
}

test('createRectangleEntity: gera retângulo simples, com filete, chanfro e rotação', () => {
    // 1. Simples
    const r1 = createRectangleEntity({ x: 0, y: 0 }, { x: 100, y: 50 });
    assert.equal(r1.type, 'polyline');
    assert.equal(r1.closed, true);
    assert.equal(r1.vertices.length, 4);

    // 2. Com Filete (raio 10): gera 8 vértices com 4 arcos de bulge ~ 0.4142
    const r2 = createRectangleEntity({ x: 0, y: 0 }, { x: 100, y: 50 }, { fillet: 10 });
    assert.equal(r2.vertices.length, 8);
    const arcCount = r2.vertices.filter((v) => Math.abs(v.bulge) > 0.4).length;
    assert.equal(arcCount, 4, 'Deve conter 4 arcos nos cantos');

    // 3. Com Chanfro (10x10): gera 8 vértices lineares (bulge 0)
    const r3 = createRectangleEntity({ x: 0, y: 0 }, { x: 100, y: 50 }, { chamfer1: 10, chamfer2: 10 });
    assert.equal(r3.vertices.length, 8);
    assert.ok(r3.vertices.every((v) => v.bulge === 0), 'Chanfro deve ter todos os segmentos lineares');

    // 4. Com Rotação de 90 graus: dimensão local 100x50 rotacionada 90 graus
    const localB = { x: 100, y: 50 };
    const worldB = { x: -50, y: 100 }; // (100, 50) rotacionado 90°
    const r4 = createRectangleEntity({ x: 0, y: 0 }, worldB, { rotation: 90 });
    const minX = Math.min(...r4.vertices.map((v) => v.x));
    const maxX = Math.max(...r4.vertices.map((v) => v.x));
    const minY = Math.min(...r4.vertices.map((v) => v.y));
    const maxY = Math.max(...r4.vertices.map((v) => v.y));
    assert.ok(Math.abs(minX - (-50)) < 1e-4, 'MinX deve ser aprox -50');
    assert.ok(Math.abs(maxX - 0) < 1e-4, 'MaxX deve ser aprox 0 após rotação');
    assert.ok(Math.abs(minY - 0) < 1e-4, 'MinY deve ser aprox 0');
    assert.ok(Math.abs(maxY - 100) < 1e-4, 'MaxY deve ser aprox 100');
});

test('Comando RECTANG: suporta opções interativas Dimensões e Área', async () => {
    const editor = createMockEditor();

    // Cenário: usuário aciona RECTANG, clica (0, 0), escolhe 'd' (Dimensões), informa 80x40 e clica no quadrante (+1, +1)
    let getPointCount = 0;
    editor.getPoint = async (prompt, options) => {
        getPointCount++;
        if (getPointCount === 1) return { point: { x: 0, y: 0 } };
        if (getPointCount === 2) return { keyword: 'd' }; // escolhe Dimensões
        if (getPointCount === 3) return { point: { x: 50, y: 50 } }; // clica no quadrante positivo
    };

    let getNumberCount = 0;
    editor.getNumber = async (prompt) => {
        getNumberCount++;
        if (getNumberCount === 1) return 80; // Comprimento
        if (getNumberCount === 2) return 40; // Largura
    };

    await COMMANDS.RECTANG.run(editor);

    const rects = editor.doc.entities.filter((e) => e.type === 'polyline');
    assert.equal(rects.length, 1);
    const r = rects[0];
    const xs = r.vertices.map((v) => v.x);
    const ys = r.vertices.map((v) => v.y);
    assert.equal(Math.max(...xs) - Math.min(...xs), 80, 'Comprimento deve ser 80');
    assert.equal(Math.max(...ys) - Math.min(...ys), 40, 'Largura deve ser 40');
});

test('polylineFillet: aplica concordância em todos os cantos de uma polilinha fechada', () => {
    // Retângulo 100x100
    const pline = {
        type: 'polyline',
        closed: true,
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 100, y: 0, bulge: 0 },
            { x: 100, y: 100, bulge: 0 },
            { x: 0, y: 100, bulge: 0 },
        ],
    };

    const filleted = polylineFillet(pline, 10);
    assert.equal(filleted.vertices.length, 8, '4 cantos arredondados geram 8 vértices');
    const curves = polylineCurves(filleted.vertices, filleted.closed);
    const arcs = curves.filter((c) => c.kind === 'arc');
    assert.equal(arcs.length, 4, 'Deve conter 4 curvas de arco');
    arcs.forEach((arc) => {
        assert.ok(Math.abs(arc.radius - 10) < 1e-4, 'Raio de cada arco deve ser 10');
    });
});

test('polylineFillet: arco convexo (centro para dentro) nos dois sentidos', () => {
    const square = [
        { x: 0, y: 0, bulge: 0 },
        { x: 100, y: 0, bulge: 0 },
        { x: 100, y: 100, bulge: 0 },
        { x: 0, y: 100, bulge: 0 },
    ];
    for (const vertices of [square, [...square].reverse()]) {
        const filleted = polylineFillet({ type: 'polyline', closed: true, vertices }, 10);
        const arcs = polylineCurves(filleted.vertices, true).filter((c) => c.kind === 'arc');
        assert.equal(arcs.length, 4);
        for (const arc of arcs) {
            const cx = arc.center.x, cy = arc.center.y;
            assert.ok([10, 90].some((v) => Math.abs(cx - v) < 1e-4) && [10, 90].some((v) => Math.abs(cy - v) < 1e-4),
                `centro deve ficar dentro do quadrado, veio (${cx}, ${cy})`);
        }
    }
});

test('polylineChamfer: aplica chanfro em todos os cantos de uma polilinha fechada', () => {
    const pline = {
        type: 'polyline',
        closed: true,
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 100, y: 0, bulge: 0 },
            { x: 100, y: 100, bulge: 0 },
            { x: 0, y: 100, bulge: 0 },
        ],
    };

    const chamfered = polylineChamfer(pline, 15, 15);
    assert.equal(chamfered.vertices.length, 8, '4 cantos chanfrados geram 8 vértices');
    assert.ok(chamfered.vertices.every((v) => v.bulge === 0), 'Todos os segmentos devem ser retas');
});

test('Comando FILLET: suporta opção PoliLinha e Raio', async () => {
    let doc = createDocument();
    const pline = {
        id: 'pl1',
        type: 'polyline',
        closed: true,
        layer: '0',
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 200, y: 0, bulge: 0 },
            { x: 200, y: 200, bulge: 0 },
            { x: 0, y: 200, bulge: 0 },
        ],
    };
    doc = addEntities(doc, [pline]);
    const editor = createMockEditor(doc);

    let getEntityCount = 0;
    editor.getEntity = async (prompt, options) => {
        getEntityCount++;
        if (getEntityCount === 1) return { keyword: 'r' }; // Altera raio
        if (getEntityCount === 2) return { keyword: 'p' }; // Escolhe PoliLinha
        if (getEntityCount === 3) return { entity: pline }; // Seleciona a polilinha
    };

    editor.getNumber = async () => 20; // Novo raio = 20

    await COMMANDS.FILLET.run(editor);

    assert.equal(editor.memory.fillet, 20);
    const updated = editor.doc.entities.find((e) => e.id === 'pl1');
    assert.equal(updated.vertices.length, 8, 'A polilinha inteira foi filetada com raio 20');
});

test('Comando CHAMFER: registrado com aliases e suporta opção PoliLinha e Ângulo', async () => {
    assert.ok(COMMANDS.CHAMFER);
    assert.deepEqual(COMMANDS.CHAMFER.aliases.slice(0, 2), ['CHA', 'CHANFRO']);
    assert.equal(resolveCommand('CHA')?.name, 'CHAMFER');
    assert.equal(resolveCommand('CHANFRO')?.name, 'CHAMFER');

    let doc = createDocument();
    const pline = {
        id: 'pl2',
        type: 'polyline',
        closed: true,
        layer: '0',
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 100, y: 0, bulge: 0 },
            { x: 100, y: 100, bulge: 0 },
            { x: 0, y: 100, bulge: 0 },
        ],
    };
    doc = addEntities(doc, [pline]);
    const editor = createMockEditor(doc);

    let getEntityCount = 0;
    editor.getEntity = async (prompt) => {
        getEntityCount++;
        if (getEntityCount === 1) return { keyword: 'a' }; // Escolhe Ângulo
        if (getEntityCount === 2) return { keyword: 'p' }; // Escolhe PoliLinha
        if (getEntityCount === 3) return { entity: pline }; // Seleciona
    };

    let getNumCount = 0;
    editor.getNumber = async () => {
        getNumCount++;
        if (getNumCount === 1) return 10; // d1 = 10
        if (getNumCount === 2) return 45; // 45 graus -> d2 = 10
    };

    await COMMANDS.CHAMFER.run(editor);

    const updated = editor.doc.entities.find((e) => e.id === 'pl2');
    assert.equal(updated.vertices.length, 8, 'A polilinha foi chanfrada em todos os cantos');
});

test('Comando REVCLOUD: registrado com aliases REV e NUVEMREV e converte círculo', async () => {
    assert.ok(COMMANDS.REVCLOUD);
    assert.deepEqual(COMMANDS.REVCLOUD.aliases.slice(0, 2), ['REV', 'NUVEMREV']);
    assert.equal(resolveCommand('REV')?.name, 'REVCLOUD');
    assert.equal(resolveCommand('NUVEMREV')?.name, 'REVCLOUD');

    let doc = createDocument();
    const circle = { id: 'c1', type: 'circle', center: { x: 50, y: 50 }, radius: 30, layer: '0' };
    doc = addEntities(doc, [circle]);
    const editor = createMockEditor(doc);

    let getPointCount = 0;
    editor.getPoint = async () => {
        getPointCount++;
        if (getPointCount === 1) return { keyword: 'o' }; // Escolhe Objeto
    };

    editor.getEntity = async () => ({ entity: circle });
    editor.getKeyword = async () => ({ key: 'n' }); // Inverter = Não

    await COMMANDS.REVCLOUD.run(editor);

    // Círculo substituído por nuvem de revisão
    const clouds = editor.doc.entities.filter((e) => e.type === 'polyline' && e.closed);
    assert.equal(clouds.length, 1);
    const cloud = clouds[0];
    assert.ok(cloud.vertices.length >= 6, 'Nuvem deve ter múltiplos arcos');
    assert.ok(cloud.vertices.every((v) => Math.abs(v.bulge) > 0.4), 'Todos os segmentos devem ter bulge de nuvem');
});

test('createRevcloudFromEntity: suporta inverter sentido dos arcos', () => {
    const circle = { type: 'circle', center: { x: 0, y: 0 }, radius: 50, layer: '0' };
    const normalCloud = createRevcloudFromEntity(circle, 15, false);
    const invertedCloud = createRevcloudFromEntity(circle, 15, true);

    assert.ok(normalCloud.vertices[0].bulge > 0, 'Nuvem normal deve ter bulge positivo');
    assert.ok(invertedCloud.vertices[0].bulge < 0, 'Nuvem invertida deve ter bulge negativo');
});
