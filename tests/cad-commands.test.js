import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filletLines, extendEntity, joinCurves, polylineArea, tangentBulge, trimPolyline, resolveCommand, COMMANDS } from '../src/cad/commands.js';
import { entityCurves, bulgeToArc, angleInArc, distance } from '../src/cad/geometry.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const closePoint = (p, q, tol = 1e-6) => close(p.x, q.x, tol) && close(p.y, q.y, tol);

test('fillet entre duas linhas gera arco tangente e apara as linhas', () => {
    const l1 = { id: 'a', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const l2 = { id: 'b', type: 'line', layer: '0', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } };
    const r = filletLines(l1, { x: 5, y: 0 }, l2, { x: 10, y: 5 }, 2);
    assert.ok(r);
    assert.ok(closePoint(r.first.end, { x: 8, y: 0 }));
    assert.ok(closePoint(r.second.start, { x: 10, y: 2 }));
    assert.ok(closePoint(r.arc.center, { x: 8, y: 2 }));
    assert.ok(close(r.arc.radius, 2));
    // O arco curto passa pelo canto inferior direito (ângulo -45° a partir do centro).
    assert.ok(angleInArc(-Math.PI / 4, r.arc.start, r.arc.end));
    assert.ok(!angleInArc((3 * Math.PI) / 4, r.arc.start, r.arc.end));

    const corner = filletLines(l1, { x: 5, y: 0 }, { ...l2, start: { x: 10, y: 3 } }, { x: 10, y: 5 }, 0);
    assert.equal(corner.arc, null);
    assert.ok(closePoint(corner.second.start, { x: 10, y: 0 }));
    assert.equal(filletLines(l1, { x: 5, y: 0 }, { ...l2, start: { x: 0, y: 5 }, end: { x: 10, y: 5 } }, { x: 5, y: 5 }, 1), null, 'paralelas');
    // Raio maior que as linhas: como no AutoCAD com TRIMMODE, as linhas são estendidas até as tangências.
    const big = filletLines(l1, { x: 5, y: 0 }, l2, { x: 10, y: 5 }, 50);
    assert.ok(big && close(big.arc.radius, 50));
    assert.ok(closePoint(big.first.start, { x: -40, y: 0 }) && closePoint(big.first.end, { x: 10, y: 0 }));
    assert.ok(closePoint(big.second.end, { x: 10, y: 50 }));
});

test('extend estende linha e arco até o limite mais próximo na direção do clique', () => {
    const line = { id: 'a', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } };
    const limits = [{ kind: 'segment', a: { x: 10, y: -5 }, b: { x: 10, y: 5 } }, { kind: 'segment', a: { x: 20, y: -5 }, b: { x: 20, y: 5 } }];
    const extended = extendEntity(line, limits, { x: 4.5, y: 0 });
    assert.ok(closePoint(extended.end, { x: 10, y: 0 }));
    assert.equal(extendEntity(line, limits, { x: 0.5, y: 0 }), null, 'sem limite atrás do início');

    const arc = { id: 'b', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI / 4 };
    const vertical = [{ kind: 'segment', a: { x: 0, y: -10 }, b: { x: 0, y: 10 } }];
    const arcExt = extendEntity(arc, vertical, { x: 5 * Math.cos(Math.PI / 4), y: 5 * Math.sin(Math.PI / 4) });
    assert.ok(close(arcExt.end, Math.PI / 2));
});

test('join encadeia linhas e arcos numa polilinha e detecta fechamento', () => {
    const entities = [
        { id: '1', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { id: '2', type: 'arc', layer: '0', center: { x: 10, y: 5 }, radius: 5, start: -Math.PI / 2, end: Math.PI / 2 },
        { id: '3', type: 'line', layer: '0', start: { x: 0, y: 10 }, end: { x: 10, y: 10 } },
        { id: '4', type: 'line', layer: '0', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ];
    const poly = joinCurves(entities);
    assert.ok(poly);
    assert.equal(poly.closed, true);
    assert.equal(poly.vertices.length, 4);
    const arcVertex = poly.vertices.find((v) => v.bulge !== 0);
    assert.ok(arcVertex);
    assert.ok(close(Math.abs(arcVertex.bulge), 1));
    // O arco reconstruído passa por (15,5).
    const idx = poly.vertices.indexOf(arcVertex);
    const next = poly.vertices[(idx + 1) % poly.vertices.length];
    const rebuilt = bulgeToArc(arcVertex, next, arcVertex.bulge);
    assert.ok(closePoint(rebuilt.center, { x: 10, y: 5 }));
    assert.ok(angleInArc(0, rebuilt.start, rebuilt.end));

    assert.equal(joinCurves([entities[0], entities[2]]), null, 'desconectadas');
});

test('área de polilinha fechada com arcos e retângulo', () => {
    const rect = { type: 'polyline', closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 5, bulge: 0 }, { x: 0, y: 5, bulge: 0 }] };
    assert.ok(close(Math.abs(polylineArea(rect)), 50));
    // Círculo de raio 5 como dois semicírculos (bulge 1).
    const circle = { type: 'polyline', closed: true, vertices: [{ x: -5, y: 0, bulge: 1 }, { x: 5, y: 0, bulge: 1 }] };
    assert.ok(close(Math.abs(polylineArea(circle)), Math.PI * 25, 1e-6));
});

test('tangentBulge produz arco tangente ao segmento anterior', () => {
    const vertices = [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }];
    const bulge = tangentBulge(vertices, { x: 20, y: 10 });
    const arc = bulgeToArc(vertices[1], { x: 20, y: 10 }, bulge);
    // Tangente em (10,0) na direção +X implica centro em (10, r) sobre a vertical.
    assert.ok(close(arc.center.x, 10));
    assert.ok(close(arc.radius, 10));
});

test('trim de polilinha apara só o segmento clicado e preserva os demais', () => {
    const rect = { id: 'r', type: 'polyline', layer: '0', closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }, { x: 0, y: 10, bulge: 0 }] };
    const cutters = [{ kind: 'segment', a: { x: 4, y: -5 }, b: { x: 4, y: 15 } }, { kind: 'segment', a: { x: 6, y: -5 }, b: { x: 6, y: 15 } }];
    const result = trimPolyline(rect, cutters, { x: 5, y: 0 });
    assert.ok(Array.isArray(result));
    // 3 lados intactos + 2 pedaços do lado inferior.
    assert.equal(result.length, 5);
    const bottomPieces = result.filter((e) => e.type === 'line' && close(e.start.y, 0) && close(e.end.y, 0));
    assert.equal(bottomPieces.length, 2);
    assert.ok(bottomPieces.every((e) => !(e.start.x > 4 && e.start.x < 6) && !(e.end.x > 4 && e.end.x < 6)));
});

test('aliases de comandos resolvem para o nome canônico', () => {
    assert.equal(resolveCommand('l').name, 'LINE');
    assert.equal(resolveCommand('PL').name, 'PLINE');
    assert.equal(resolveCommand('rec').name, 'RECTANG');
    assert.equal(resolveCommand('tr').name, 'TRIM');
    assert.equal(resolveCommand('nada'), null);
    const aliases = Object.values(COMMANDS).flatMap((c) => c.aliases);
    assert.equal(new Set(aliases).size, aliases.length, 'aliases duplicados');
    assert.ok(Object.keys(COMMANDS).every((name) => !aliases.includes(name)), 'alias colide com nome de comando');
    assert.equal(entityCurves({ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }).length, 1);
    assert.ok(close(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5));
});

test('fillet entre linha e arco, arco e arco, e círculo', async () => {
    const { filletCurves } = await import('../src/cad/commands.js');
    // Linha horizontal y=0 e arco de raio 10 centrado em (0,20), parte inferior (270°±).
    const line = { id: 'l', type: 'line', layer: '0', start: { x: -40, y: 0 }, end: { x: 40, y: 0 } };
    const arc = { id: 'a', type: 'arc', layer: '0', center: { x: 0, y: 20 }, radius: 10, start: Math.PI, end: 2 * Math.PI };
    // Cliques: linha à direita, arco no lado direito inferior. Raio 6: centro do fillet a 6 da reta (y=6) e a 16 do centro do arco.
    const r = filletCurves(line, { x: 20, y: 0 }, arc, { x: 7, y: 13 }, 6);
    assert.ok(r, 'fillet linha-arco deveria existir');
    assert.ok(close(r.arc.center.y, 6), `centro do fillet deveria ter y=6, obteve ${r.arc.center.y}`);
    assert.ok(close(distance(r.arc.center, arc.center), 16), 'centro externamente tangente ao arco');
    assert.ok(r.arc.center.x > 0, 'fillet do lado direito');
    assert.ok(close(r.first.start.x, r.arc.center.x), 'linha aparada no ponto de tangência');
    assert.ok(close(r.first.end.x, 40), 'ponta direita da linha preservada');
    assert.equal(r.second.type, 'arc');
    // Ponto de tangência no arco fica sobre o círculo original.
    const tangentOnArc = { x: arc.center.x + (r.arc.center.x - arc.center.x) * (10 / 16), y: arc.center.y + (r.arc.center.y - arc.center.y) * (10 / 16) };
    assert.ok(close(distance(tangentOnArc, arc.center), 10));

    // Arco-arco: dois arcos externos, raio 6 (centros a 30; 10+6+10+6 = 32 ≥ 30, então existe tangência externa).
    const a1 = { id: 'a1', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 };
    const a2 = { id: 'a2', type: 'arc', layer: '0', center: { x: 30, y: 0 }, radius: 10, start: Math.PI / 2, end: Math.PI };
    const rr = filletCurves(a1, { x: 7, y: 7 }, a2, { x: 23, y: 7 }, 6);
    assert.ok(rr && rr.arc, 'fillet arco-arco deveria existir');
    assert.ok(close(distance(rr.arc.center, a1.center), 16) && close(distance(rr.arc.center, a2.center), 16));
    assert.ok(rr.arc.center.y > 0, 'concordância pelo lado de cima, onde estão os cliques');

    // Círculo permanece inteiro.
    const circle = { id: 'c', type: 'circle', layer: '0', center: { x: 0, y: 20 }, radius: 10 };
    const rc = filletCurves(line, { x: 20, y: 0 }, circle, { x: 8, y: 14 }, 6);
    assert.ok(rc && rc.arc);
    assert.equal(rc.second.type, 'circle');
    assert.ok(close(rc.second.radius, 10));

    // Raio 0 entre linha e arco: canto vivo na interseção.
    const sharp = filletCurves(line, { x: 20, y: 0 }, { ...arc, center: { x: 0, y: 5 } }, { x: 5, y: -3 }, 0);
    assert.ok(sharp && sharp.arc === null);
    assert.ok(close(sharp.first.start.y, 0) && sharp.first.start.x > 0);
});

test('trim por janela remove só os trechos dentro do retângulo; extend por janela estende as pontas internas', async () => {
    const { trimInsideBox, extendEntity } = await import('../src/cad/commands.js');
    // Linha horizontal cruzada por duas verticais em x=10 e x=20; janela cobre x 12..18.
    const line = { id: 'h', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 30, y: 0 } };
    const cutters = [{ kind: 'segment', a: { x: 10, y: -5 }, b: { x: 10, y: 5 } }, { kind: 'segment', a: { x: 20, y: -5 }, b: { x: 20, y: 5 } }];
    const kept = trimInsideBox(line, cutters, { minX: 12, minY: -1, maxX: 18, maxY: 1 });
    assert.equal(kept.length, 2);
    assert.ok(kept.every((p) => p.end.x <= 10.0001 || p.start.x >= 19.9999));
    assert.equal(trimInsideBox(line, cutters, { minX: 40, minY: -1, maxX: 50, maxY: 1 }), undefined, 'janela longe não altera');

    const ext = extendEntity({ id: 'e', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }, cutters, { x: 5, y: 0 });
    assert.ok(closePoint(ext.end, { x: 10, y: 0 }));
});

test('entrada dinâmica: x,y relativo ao ponto anterior, #x,y absoluto, negativos aceitos', async () => {
    const { parsePointInput } = await import('../src/cad/input.js');
    const last = { x: 100, y: 50 };
    assert.deepEqual(parsePointInput('-20,-10', { last, dynamic: true }).point, { x: 80, y: 40 });
    assert.deepEqual(parsePointInput('#20,10', { last, dynamic: true }).point, { x: 20, y: 10 });
    assert.deepEqual(parsePointInput('20,10', { last, dynamic: false }).point, { x: 20, y: 10 });
    const polarRel = parsePointInput('10<180', { last, dynamic: true }).point;
    assert.ok(close(polarRel.x, 90) && close(polarRel.y, 50));
    assert.deepEqual(parsePointInput('@5,5', { last, dynamic: true }).point, { x: 105, y: 55 });
});

test('Editor.prototype.selectedEntities retorna entidades selecionadas de forma consistente', async () => {
    const { Editor } = await import('../src/cad/editor.js');
    const e1 = { id: 'c1', type: 'circle', center: { x: 50, y: 50 }, radius: 25 };
    const e2 = { id: 'p1', type: 'polyline', closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    const mock = {
        doc: { entities: [e1, e2] },
        selection: new Set(),
        entitiesById: Editor.prototype.entitiesById,
        selectedEntities: Editor.prototype.selectedEntities,
    };

    // Sem seleção: array vazio
    assert.deepEqual(mock.selectedEntities(), []);

    // Com seleção de c1
    mock.selection.add('c1');
    assert.deepEqual(mock.selectedEntities(), [e1]);

    // Com seleção de c1 e p1
    mock.selection.add('p1');
    assert.deepEqual(mock.selectedEntities(), [e1, e2]);

    // Com ID fantasma que não existe mais em doc.entities
    mock.selection.add('fantasma_99');
    assert.deepEqual(mock.selectedEntities(), [e1, e2]);
});

test('suggestCommands lista comandos e apelidos pelo prefixo', async () => {
    const { suggestCommands } = await import('../src/cad/commands.js');
    const ex = suggestCommands('ex');
    assert.ok(ex.length > 1 && ex.every((s) => s.name.startsWith('EX') || COMMANDS[s.name].aliases.some((a) => a.startsWith('EX'))));
    assert.ok(ex.some((s) => s.name === 'EXTEND'));
    assert.equal(suggestCommands('l')[0].name, 'LINE');
    assert.deepEqual(suggestCommands('12'), []);
    assert.deepEqual(suggestCommands(''), []);
});

test('ARRAY vindo da ribbon com tipo escolhido não pergunta o tipo de novo', async () => {
    const line = { id: 'a', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    let committed = null;
    const asked = [];
    const editor = {
        memory: {},
        doc: { entities: [line] },
        getSelection: async () => ['a'],
        entitiesById: () => [line],
        getKeyword: async (prompt) => { asked.push(prompt); throw new Error(`perguntou: ${prompt}`); },
        getNumber: async () => 3,
        getPoint: async (prompt) => ({ point: prompt.startsWith('Ponto base') ? { x: 0, y: 0 } : { x: 0, y: 20 } }),
        commit: (_label, value) => { committed = value; },
        log: () => {},
        clearSelection: () => {},
    };
    await COMMANDS.ARRAY.run(editor, ['l']);
    assert.deepEqual(asked, []);
    assert.equal(editor.memory.arrayMode, 'l');
    assert.ok(committed);
});

function wblockEditor(logs) {
    const line = { id: 'a', type: 'line', layer: 'CORTE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    return {
        memory: {},
        doc: { units: 4, layers: [{ name: '0' }, { name: 'CORTE' }, { name: 'OUTRA' }], entities: [line] },
        getSelection: async () => ['a'],
        entitiesById: () => [line],
        getPoint: async () => ({ point: { x: 5, y: 0 } }),
        log: (msg, level) => logs.push([msg, level]),
    };
}

function wblockUi(answers, overwrite = []) {
    const shown = [];
    const confirms = [];
    return {
        shown, confirms,
        openWblockDialog: async (opts) => { shown.push(opts); return answers.shift(); },
        confirmOverwrite: async (path) => { confirms.push(path); return overwrite.shift(); },
    };
}

test('WBLOCK no desktop: caminho anterior e base 0,0 já preenchidos, OK grava direto', async () => {
    const logs = [];
    const saved = [];
    globalThis.window = { desktopBridge: { saveFile: async (path, content) => saved.push({ path, content }), showSaveDialog: async () => null } };
    try {
        const editor = wblockEditor(logs);
        editor.memory.wblockPath = 'C:\\Blocos\\flange.dxf';
        editor.getPoint = async () => { throw new Error('não deveria pedir ponto base'); };
        editor.wblockUi = wblockUi([{ action: 'ok', path: 'C:\\Blocos\\flange.dxf', base: { x: 0, y: 0, z: 0 } }]);
        await COMMANDS.WBLOCK.run(editor);
        assert.equal(editor.wblockUi.shown[0].path, 'C:\\Blocos\\flange.dxf');
        assert.deepEqual(editor.wblockUi.shown[0].base, { x: 0, y: 0, z: 0 });
        assert.equal(typeof editor.wblockUi.shown[0].browse, 'function');
        assert.equal(saved.length, 1);
        assert.equal(saved[0].path, 'C:\\Blocos\\flange.dxf');
        assert.match(saved[0].content, /CORTE/);
        assert.doesNotMatch(saved[0].content, /OUTRA/);
        assert.ok(logs.every(([, level]) => level !== 'error'));
    } finally {
        delete globalThis.window;
    }
});

test('WBLOCK no desktop: arquivo existente pede confirmação; Não volta para a janela', async () => {
    const saved = [];
    globalThis.window = { desktopBridge: { saveFile: async (path, content) => saved.push({ path, content }), readFileBinary: async () => [1] } };
    try {
        const editor = wblockEditor([]);
        editor.wblockUi = wblockUi(
            [{ action: 'ok', path: 'C:\\B\\a', base: { x: 0, y: 0, z: 0 } }, { action: 'ok', path: 'C:\\B\\a', base: { x: 0, y: 0, z: 0 } }],
            [false, true],
        );
        await COMMANDS.WBLOCK.run(editor);
        assert.deepEqual(editor.wblockUi.confirms, ['C:\\B\\a.dxf', 'C:\\B\\a.dxf']);
        assert.equal(editor.wblockUi.shown.length, 2);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].path, 'C:\\B\\a.dxf');
    } finally {
        delete globalThis.window;
    }
});

test('WBLOCK: escolher ponto base no desenho volta para a janela com o ponto', async () => {
    const editor = wblockEditor([]);
    let downloaded = null;
    editor.downloadText = (content, name) => { downloaded = { content, name }; };
    editor.wblockUi = wblockUi([
        { action: 'pick', path: 'peca', base: { x: 0, y: 0, z: 0 } },
        { action: 'ok', path: 'peca', base: { x: 5, y: 0, z: 0 } },
    ]);
    await COMMANDS.WBLOCK.run(editor);
    assert.deepEqual(editor.wblockUi.shown[1].base, { x: 5, y: 0, z: 0 });
    assert.equal(editor.wblockUi.shown[1].browse, null);
    assert.equal(downloaded.name, 'peca.dxf');
    assert.match(downloaded.content, /EOF/);
    assert.deepEqual(editor.memory.wblockBase, { x: 5, y: 0, z: 0 });
});

test('WBLOCK: cancelar não grava', async () => {
    const editor = wblockEditor([]);
    editor.downloadText = () => { throw new Error('não deveria baixar'); };
    editor.wblockUi = wblockUi([{ action: 'cancel' }]);
    await COMMANDS.WBLOCK.run(editor);
});
