import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from '../src/cad/commands.js';
import { arrayCopies, arrayEntityCount, arrayFieldValues, arrayFromXdata, arrayParamsError, createArrayInsert, isArrayInsert, updateArrayField, MAX_ARRAY_ENTITIES } from '../src/cad/array.js';
import { expandInsert } from '../src/cad/blocks.js';
import { addEntities, createDocument, replaceEntities } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { entityBox, translateEntity, rotateEntity, transformEntity } from '../src/cad/geometry.js';
import { findSnap, defaultSnapSettings } from '../src/cad/snaps.js';

const line = { id: 'a', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
const rect = { mode: 'r', rows: 2, cols: 3, rowSpacing: 20, colSpacing: 30, associative: true };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} != ${b}`);
const starts = (list) => list.map((e) => `${Math.round(e.start.x * 1e3) / 1e3},${Math.round(e.start.y * 1e3) / 1e3}`).sort();

test('retangular: linhas × colunas menos a origem, nas distâncias pedidas', () => {
    assert.deepEqual(starts(arrayCopies([line], rect)), ['0,20', '30,0', '30,20', '60,0', '60,20']);
});

test('polar: 360° reparte em N passos; ângulo parcial inclui as duas pontas', () => {
    const base = { mode: 'p', count: 4, fill: 360, rotate: true, center: { x: 0, y: -50 } };
    const full = arrayCopies([line], base);
    assert.equal(full.length, 3);
    near(full[1].start.y, -100);
    const partial = arrayCopies([line], { ...base, count: 3, fill: 180 });
    near(partial[1].start.y, -100, 'última em 180°');
});

test('polar sem rotação: o conjunto anda inteiro e mantém a forma', () => {
    const other = { ...line, id: 'b', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } };
    const copies = arrayCopies([line, other], { mode: 'p', count: 2, fill: 180, rotate: false, center: { x: 100, y: 0 } });
    near(copies[1].start.y - copies[0].start.y, 5, 'distância entre os dois objetos');
    near(copies[0].end.x - copies[0].start.x, 10, 'sem girar');
});

test('linear: distância e ângulo', () => {
    const copies = arrayCopies([line], { mode: 'l', count: 3, distance: 10, angle: 90 });
    near(copies[1].start.y, 20);
    near(copies[1].start.x, 0);
});

test('parâmetros inválidos não geram matriz', () => {
    assert.ok(arrayParamsError({ ...rect, rows: 1.5 }));
    assert.ok(arrayParamsError({ ...rect, rows: 1, cols: 1 }));
    assert.ok(arrayParamsError({ ...rect, rowSpacing: 0 }));
    assert.equal(arrayParamsError({ ...rect, rows: 1, rowSpacing: 0 }), null);
    assert.ok(arrayParamsError({ mode: 'p', count: 3, fill: 360 }), 'polar sem centro');
    assert.ok(arrayParamsError({ mode: 'p', count: 3, fill: 0, center: { x: 0, y: 0 } }));
    assert.ok(arrayParamsError({ mode: 'l', count: 2, distance: 0, angle: 0 }));
    assert.ok(arrayParamsError({ ...rect, rows: MAX_ARRAY_ENTITIES, cols: 2 }), 'teto de entidades');
});

test('ARRAY sem janela: confirmar associativa troca as origens por uma matriz na mesma posição', async () => {
    const doc = addEntities(createDocument(), [line]);
    const id = doc.entities[0].id;
    const answers = [2, 3, 20, 30];
    const previews = [];
    const editor = {
        memory: {}, doc,
        getSelection: async () => [id],
        entitiesById: (ids) => doc.entities.filter((e) => ids.includes(e.id)),
        getNumber: async () => answers.shift(),
        commit(_label, value) { this.doc = value; },
        log() {}, clearSelection() {},
        set preview(value) { previews.push(value.length); },
    };
    await COMMANDS.ARRAY.run(editor, ['r']);
    assert.equal(editor.doc.entities.length, 1);
    const array = editor.doc.entities[0];
    assert.ok(isArrayInsert(array));
    assert.deepEqual(starts(expandInsert(array)), ['0,0', '0,20', '30,0', '30,20', '60,0', '60,20']);
    assert.ok(previews.some((n) => n === 5), `pré-visualização com as 5 cópias antes de confirmar: ${previews}`);
    assert.equal(previews.at(-1), 0, 'pré-visualização limpa ao final');
    assert.equal(editor.memory.arrayRows, 2);
});

test('ARRAY não associativa: cópias comuns ao lado das origens', async () => {
    const doc = addEntities(createDocument(), [line]);
    const editor = {
        memory: { arrayAssociative: false }, doc,
        getSelection: async () => [doc.entities[0].id],
        entitiesById: (ids) => doc.entities.filter((e) => ids.includes(e.id)),
        getNumber: async (_p, o) => o.defaultValue,
        commit(_label, value) { this.doc = value; },
        log() {}, clearSelection() {},
    };
    await COMMANDS.ARRAY.run(editor, ['r']);
    assert.equal(editor.doc.entities.length, 4);
    assert.ok(editor.doc.entities.every((e) => e.type === 'line'));
});

test('edição posterior refaz a matriz, sem alterar a origem nem o nome de outra cópia', () => {
    const array = { ...createArrayInsert([line], rect), id: 'm' };
    const twin = { ...array, id: 'n' };
    const edited = updateArrayField(array, 'cols', 5);
    assert.equal(expandInsert(edited).length, 10);
    assert.deepEqual(starts(expandInsert(edited)).filter((s) => s.endsWith(',0')), ['0,0', '120,0', '30,0', '60,0', '90,0']);
    assert.notEqual(edited.name, twin.name);
    assert.equal(expandInsert(twin).length, 6);
    assert.equal(updateArrayField(edited, 'rowSpacing', 7).array.rowSpacing, 7);
    assert.throws(() => updateArrayField(array, 'rows', 0));
});

test('matriz movida, girada e escalada: painel e edição seguem em coordenadas do desenho', () => {
    let polar = { ...createArrayInsert([line], { mode: 'p', count: 4, fill: 360, rotate: true, center: { x: 5, y: 50 } }), id: 'p' };
    polar = translateEntity(polar, { x: 100, y: 0 });
    const v = arrayFieldValues(polar);
    near(v.centerX, 105);
    near(v.centerY, 50);
    const moved = updateArrayField(polar, 'count', 6);
    near(arrayFieldValues(moved).centerX, 105, 'centro preservado ao editar');
    assert.equal(expandInsert(moved).length, 6);
    near(expandInsert(moved)[0].start.x, 100, 'origem preservada');

    let linear = { ...createArrayInsert([line], { mode: 'l', count: 3, distance: 10, angle: 0 }), id: 'l' };
    linear = rotateEntity(linear, { x: 0, y: 0 }, Math.PI / 2);
    near(arrayFieldValues(linear).angle, 90);
    const longer = updateArrayField(linear, 'distance', 40);
    near(expandInsert(longer)[2].start.y, 80, 'distância no eixo girado');

    const scaled = transformEntity({ ...createArrayInsert([line], rect), id: 's' }, (p) => ({ x: p.x * 2, y: p.y * 2 }));
    near(arrayFieldValues(scaled).colSpacing, 60);
    const respaced = updateArrayField(scaled, 'colSpacing', 100);
    near(expandInsert(respaced).at(-1).start.x, 200);
});

test('escala não uniforme: cada distância usa o fator do próprio eixo', () => {
    const array = { ...createArrayInsert([line], rect), id: 'n', scaleX: 2, scaleY: 3 };
    const values = arrayFieldValues(array);
    near(values.colSpacing, 60);
    near(values.rowSpacing, 60);
    near(updateArrayField(array, 'rowSpacing', 90).array.rowSpacing, 30);
});

test('matriz espelhada: o valor exibido bate com a geometria e a edição mantém o espelho', () => {
    const mirrored = transformEntity({ ...createArrayInsert([line], { mode: 'l', count: 3, distance: 10, angle: 90 }), id: 'x' }, (p) => ({ x: p.x, y: -p.y }), { mirror: true });
    const before = expandInsert(mirrored).map((e) => e.start.y).sort((a, b) => a - b);
    near(before[0], -20);
    near(arrayFieldValues(mirrored).angle, -90);
    const again = updateArrayField(mirrored, 'count', 4);
    near(Math.min(...expandInsert(again).map((e) => e.start.y)), -30);
});

test('DXF: matriz salva e reaberta continua editável e com a mesma geometria', () => {
    const circle = { id: 'c', type: 'circle', layer: '0', center: { x: 5, y: 8 }, radius: 2 };
    for (const params of [rect, { mode: 'p', count: 5, fill: 270, rotate: false, center: { x: 100.125, y: -3.5 } }, { mode: 'l', count: 4, distance: 12.5, angle: 33 }]) {
        const doc = addEntities(createDocument(), [createArrayInsert([line, circle], params)]);
        const text = writeDxf(doc);
        assert.match(text, /TRACO_ARRAY/);
        const back = parseDxf(text, { preserveBlocks: true, preserveDimensions: true });
        const array = back.entities[0];
        assert.ok(isArrayInsert(array), `array preservado em ${params.mode}`);
        assert.equal(array.array.sourceCount, 2);
        assert.equal(array.__arrayXdata, undefined);
        assert.equal(expandInsert(array).length, arrayEntityCount(params, 2));
        const before = entityBox(doc.entities[0]);
        const after = entityBox(array);
        for (const key of ['minX', 'minY', 'maxX', 'maxY']) near(after[key], before[key], key);
        const bigger = updateArrayField(array, params.mode === 'r' ? 'rows' : 'count', params.mode === 'r' ? 3 : params.count + 1);
        assert.equal(expandInsert(bigger).length, 2 * (params.mode === 'r' ? 9 : params.count + 1));
        assert.ok(params.mode !== 'p' || bigger.array.center.x === 100.125);
    }
});

test('DXF: APPID declara a aplicação do XDATA e a string cabe no limite', () => {
    const doc = addEntities(createDocument(), [createArrayInsert([line], { mode: 'p', count: 12345, fill: -271.123456789, rotate: true, center: { x: -123456.123456789, y: 987654.987654321 } })]);
    const text = writeDxf(doc);
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const table = lines.findIndex((l, i) => l === 'APPID' && lines[i - 1] === '2');
    const count = lines.findIndex((l, i) => i > table && l === '70');
    const end = lines.indexOf('ENDTAB', table);
    // ACAD, TRACO_ARRAY e TRACO_ARCDIM (cota de arco): o contador bate com os registros.
    assert.equal(Number(lines[count + 1]), lines.slice(table + 1, end).filter((l) => l === 'APPID').length);
    assert.equal(lines[count + 1], '3');
    assert.equal(lines.slice(table, end).filter((l) => l === 'TRACO_ARRAY').length, 1);
    const xdata = lines.lastIndexOf('TRACO_ARRAY');
    assert.equal(lines[xdata - 1], '1001');
    assert.equal(lines[xdata + 1], '1000');
    assert.ok(lines[xdata + 2].length < 255, lines[xdata + 2]);
});

test('XDATA que não confere com a definição vira bloco comum, sem risco de perder geometria', () => {
    assert.equal(arrayFromXdata('{"mode":"r","rows":2,"cols":2,"rowSpacing":1,"colSpacing":1,"sourceCount":1}', 3), null);
    assert.ok(arrayFromXdata('{"mode":"r","rows":2,"cols":2,"rowSpacing":1,"colSpacing":1,"sourceCount":1}', 4));
    assert.equal(arrayFromXdata('não é json', 4), null);
    assert.equal(arrayFromXdata('{"mode":"x","sourceCount":1}', 4), null);
});

test('EXPLODE: a matriz vira objetos comuns editáveis', async () => {
    let doc = addEntities(createDocument(), [createArrayInsert([line], rect)]);
    const editor = {
        memory: {}, get doc() { return doc; },
        getSelection: async () => [doc.entities[0].id],
        entitiesById: (ids) => doc.entities.filter((e) => ids.includes(e.id)),
        commit(_label, value) { doc = value; },
        log() {}, clearSelection() {},
    };
    await COMMANDS.EXPLODE.run(editor);
    assert.equal(doc.entities.length, 6);
    assert.ok(doc.entities.every((e) => e.type === 'line' && !e.array));
    assert.equal(new Set(doc.entities.map((e) => e.id)).size, 6);
});

test('snap acha extremidade e centro dos itens da matriz', () => {
    const circle = { type: 'circle', layer: '0', center: { x: 5, y: 8 }, radius: 2 };
    const array = { ...createArrayInsert([line, circle], rect), id: 'm' };
    const settings = { ...defaultSnapSettings(), end: true, cen: true };
    const end = findSnap([array], { x: 60.05, y: 20.05 }, 1, settings);
    assert.equal(end?.mode, 'end');
    near(end.point.x, 60);
    const center = findSnap([array], { x: 35.05, y: 28.05 }, 1, settings);
    assert.equal(center?.mode, 'cen');
    near(center.point.y, 28);
});

test('layers: um layer comum vai para a matriz; origens em layers diferentes mantêm os seus', () => {
    const a = { ...line, layer: 'CORTE' };
    assert.equal(createArrayInsert([a], rect).layer, 'CORTE');
    const mixed = createArrayInsert([a, { ...line, id: 'b', layer: 'DOBRA' }], rect);
    assert.equal(mixed.layer, '0');
    assert.deepEqual([...new Set(expandInsert({ ...mixed, id: 'z' }).map((e) => e.layer))].sort(), ['CORTE', 'DOBRA']);
});

test('replaceEntities mantém desfazer simples: uma entrada só no lugar das origens', () => {
    const doc = addEntities(createDocument(), [line, { ...line, id: 'b' }]);
    const ids = doc.entities.map((e) => e.id);
    const array = createArrayInsert(doc.entities, rect);
    const next = replaceEntities(doc, new Map(ids.map((id, i) => [id, i === 0 ? array : null])));
    assert.equal(next.entities.length, 1);
    assert.equal(doc.entities.length, 2, 'documento anterior intacto');
});

const polarInsert = () => createArrayInsert([{ id: 'p', type: 'line', layer: '0', start: { x: 61, y: 0 }, end: { x: 71, y: 0 } }], { mode: 'p', count: 6, fill: 360, rotate: true, center: { x: 0, y: 0 }, associative: true });

test('polar no painel: raio, diâmetro, ângulo entre itens e direção como no BricsCAD', () => {
    const values = arrayFieldValues(polarInsert());
    near(values.radius, 66);
    near(values.diameter, 132);
    near(values.angleBetween, 60);
    assert.equal(values.direction, 'ccw');
});

test('polar: mudar raio ou diâmetro mantém o centro e os itens no círculo novo', () => {
    const edited = updateArrayField(polarInsert(), 'radius', 80);
    const values = arrayFieldValues(edited);
    near(values.radius, 80);
    near(values.centerX, 0);
    near(values.centerY, 0);
    const mid = (e) => ({ x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 });
    edited.definition.entities.forEach((e) => near(Math.hypot(mid(e).x, mid(e).y), 80, 'item fora do círculo'));
    near(edited.definition.entities[0].end.x - edited.definition.entities[0].start.x, 10, 'item mantém o tamanho');
    near(arrayFieldValues(updateArrayField(edited, 'diameter', 100)).radius, 50);
});

test('polar: ângulo entre itens ajusta o preenchimento e volta a fechar o círculo', () => {
    const narrow = updateArrayField(polarInsert(), 'angleBetween', 30);
    near(arrayFieldValues(narrow).fill, 150);
    near(arrayFieldValues(narrow).angleBetween, 30);
    near(arrayFieldValues(updateArrayField(narrow, 'angleBetween', 60)).fill, 360);
    assert.throws(() => updateArrayField(polarInsert(), 'angleBetween', 90), /360/);
    assert.throws(() => updateArrayField(polarInsert(), 'angleBetween', 0), /maior que zero/);
});

test('polar: direção inverte o giro sem mexer na origem', () => {
    const insert = updateArrayField(polarInsert(), 'angleBetween', 30);
    const cw = updateArrayField(insert, 'direction', 'cw');
    assert.equal(arrayFieldValues(cw).direction, 'cw');
    near(arrayFieldValues(cw).fill, -150);
    near(cw.definition.entities[0].start.x, 61);
    assert.ok(cw.definition.entities[1].start.y < 0, 'primeira cópia gira para baixo');
    assert.equal(arrayFieldValues(updateArrayField(cw, 'direction', 'ccw')).direction, 'ccw');
});

test('polar: raio inválido ou origem sobre o centro não destrói a matriz', () => {
    assert.throws(() => updateArrayField(polarInsert(), 'radius', 0), /maior que zero/);
    const centered = createArrayInsert([{ id: 'c', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }], { mode: 'p', count: 4, fill: 360, rotate: true, center: { x: 5, y: 0 }, associative: true });
    assert.throws(() => updateArrayField(centered, 'radius', 10), /sobre o centro/);
});

test('polar movida, girada e escalada: raio editado segue em coordenadas do desenho', () => {
    let insert = polarInsert();
    insert = { ...insert, position: { x: 500, y: 200 }, rotation: 30, scaleX: 2, scaleY: 2 };
    near(arrayFieldValues(insert).radius, 132);
    const edited = updateArrayField(insert, 'radius', 200);
    near(arrayFieldValues(edited).radius, 200);
    near(arrayFieldValues(edited).centerX, arrayFieldValues(insert).centerX);
    near(arrayFieldValues(edited).centerY, arrayFieldValues(insert).centerY);
});
