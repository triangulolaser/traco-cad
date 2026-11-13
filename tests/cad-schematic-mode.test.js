// Modos CAD | Esquemático e folhas do esquema (ADR 0007, E2a).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createDocument, addEntities, visibleEntities, editableEntities, isEntityEditable,
} from '../src/cad/document.js';
import { createSymbol, syncSchematic, findPortNear, nextLabel, symbolPorts } from '../src/cad/schematic.js';
import {
    MODE_CAD, MODE_SCHEMATIC, documentMode, canSwitchMode, withMode, addSheet, renameSheet, removeSheet, setActiveSheet,
    activeSheetId, entitySheet, sheetFrame, sheetEntityCounts, SCHEMATIC_ONLY_COMMANDS,
} from '../src/cad/schematic-mode.js';
import { schematicCheckList } from '../src/cad/schematic-check.js';
import { documentToTraco, tracoToDocument } from '../src/cad/traco-file.js';
import { suggestCommands, saveFormatOf } from '../src/cad/commands.js';
import { librarySections, symbolPreviewSvg, schematicBarHtml, SCHEMATIC_BAR } from '../src/cad/schematic-ui.js';
import { serializeDocument } from '../src/cad/storage.js';

const schematic = () => withMode(createDocument(), MODE_SCHEMATIC);

test('modo: documento novo é CAD; só troca com o desenho vazio', () => {
    const cad = createDocument();
    assert.equal(documentMode(cad), MODE_CAD);
    assert.equal(canSwitchMode(cad), true);
    const sch = withMode(cad, MODE_SCHEMATIC);
    assert.equal(documentMode(sch), MODE_SCHEMATIC);
    assert.deepEqual(sch.sheets, [{ id: 'F1', nome: 'Folha 1', formato: 'A4' }]);
    assert.equal(sch.currentSheet, 'F1');
    const full = addEntities(sch, [createSymbol('iso1219/tanque', { x: 10, y: 10 })]);
    assert.equal(canSwitchMode(full), false);
    assert.equal(withMode(full, MODE_CAD), null, 'esquema com símbolo não vira CAD');
    const drawn = addEntities(cad, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]);
    assert.equal(withMode(drawn, MODE_SCHEMATIC), null, 'desenho CAD com linha não vira esquema');
    assert.equal(sch.name, 'Sem título.traco', 'nome padrão acompanha o formato do modo');
    const back = withMode(sch, MODE_CAD);
    assert.equal(documentMode(back), MODE_CAD);
    assert.equal(back.sheets, undefined);
    assert.equal(back.name, 'Sem título.dxf');
});

test('folhas: o que entra vai para a folha ativa; as outras saem da vista, da seleção e das portas', () => {
    let doc = schematic();
    doc = syncSchematic(addEntities(doc, [{ ...createSymbol('iso1219/tanque', { x: 0, y: 0 }, { atributos: { etiqueta: 'R1' } }), id: 'r1' }]));
    assert.equal(doc.entities[0].sheet, 'F1');
    const { doc: two, sheet } = addSheet(doc);
    assert.equal(sheet.id, 'F2');
    assert.equal(two.currentSheet, 'F2', 'folha nova fica ativa');
    let d = syncSchematic(addEntities(two, [{ ...createSymbol('iso1219/tanque', { x: 0, y: 0 }, { atributos: { etiqueta: 'R2' } }), id: 'r2' }]));
    assert.equal(d.entities.find((e) => e.id === 'r2').sheet, 'F2');
    assert.deepEqual(visibleEntities(d).map((e) => e.id), ['r2']);
    assert.deepEqual(editableEntities(d).map((e) => e.id), ['r2']);
    assert.equal(isEntityEditable(d, d.entities.find((e) => e.id === 'r1')), false);
    // Mesmas coordenadas nas duas folhas: o LIGAR só enxerga a porta da folha ativa.
    const portPos = symbolPorts(d.entities.find((e) => e.id === 'r2'))[0].position;
    assert.equal(findPortNear(d, portPos, 1).symbol.id, 'r2');
    d = setActiveSheet(d, 'F1');
    assert.equal(findPortNear(d, portPos, 1).symbol.id, 'r1');
    assert.deepEqual(visibleEntities(d).map((e) => e.id), ['r1']);
    // Etiqueta continua única no esquema inteiro.
    assert.equal(nextLabel(d, 'R'), 'R3');
    assert.deepEqual([...sheetEntityCounts(d)], [['F1', 1], ['F2', 1]]);
    assert.deepEqual(sheetFrame(d), { minX: 0, minY: 0, maxX: 297, maxY: 210, sheet: d.sheets[0] });
    assert.equal(setActiveSheet(d, 'F9'), d, 'folha inexistente não muda nada');
});

test('folhas: renomear e excluir; excluir leva o conteúdo e a última folha não sai', () => {
    let doc = schematic();
    assert.throws(() => removeSheet(doc, 'F1'), /ao menos uma folha/);
    doc = addEntities(doc, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, id: 'a' }]);
    doc = addSheet(doc).doc;
    doc = addEntities(doc, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, id: 'b' }]);
    doc = renameSheet(doc, 'F2', '  Comando  ');
    assert.equal(doc.sheets[1].nome, 'Comando');
    assert.throws(() => renameSheet(doc, 'F2', ' '), /vazio/);
    const removed = removeSheet(doc, 'F1');
    assert.deepEqual(removed.sheets.map((s) => s.id), ['F2']);
    assert.deepEqual(removed.entities.map((e) => e.id), ['b']);
    assert.equal(activeSheetId(removed), 'F2');
    // Numeração não reaproveita id existente.
    assert.equal(addSheet(removed).sheet.id, 'F3');
});

test('CAD com uma folha só não filtra nada; entidade sem campo é da primeira folha', () => {
    const cad = addEntities(createDocument(), [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]);
    assert.equal(cad.entities[0].sheet, undefined, 'CAD não grava folha');
    const legacy = { ...schematic(), entities: [{ type: 'line', id: 'x', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] };
    assert.equal(entitySheet(legacy, legacy.entities[0]), 'F1');
});

test('.traco: modo e folhas no arquivo, folha em cada objeto; ida e volta idêntica', () => {
    let doc = schematic();
    doc = syncSchematic(addEntities(doc, [
        { ...createSymbol('iso1219/bomba-variavel-ls', { x: 50, y: 50 }, { atributos: { etiqueta: 'B1' } }), id: 'b1' },
        { type: 'text', id: 'n1', position: { x: 10, y: 10 }, height: 2.5, rotation: 0, text: 'nota' },
    ]));
    doc = addSheet(doc, 'Comando').doc;
    doc = syncSchematic(addEntities(doc, [{ ...createSymbol('iso1219/tanque', { x: 20, y: 20 }, { atributos: { etiqueta: 'R1' } }), id: 'r1' }]));
    const text = documentToTraco(doc);
    const data = JSON.parse(text);
    assert.equal(data.modo, 'esquema');
    assert.deepEqual(data.folhas, [{ formato: 'A4', id: 'F1', nome: 'Folha 1' }, { formato: 'A4', id: 'F2', nome: 'Comando' }]);
    assert.deepEqual(data.simbolos.map((s) => [s.id, s.folha]), [['b1', 'F1'], ['r1', 'F2']]);
    assert.equal(data.anotacoes[0].sheet, 'F1');
    assert.equal(data.folha_atual, undefined, 'folha ativa é vista, não vai para o arquivo');
    const { doc: back, warnings } = tracoToDocument(text);
    assert.deepEqual(warnings, []);
    assert.equal(documentMode(back), MODE_SCHEMATIC);
    assert.equal(activeSheetId(back), 'F1', 'reabre na primeira folha');
    assert.equal(documentToTraco(back), text);
    // Trocar de folha não muda o arquivo.
    assert.equal(documentToTraco(setActiveSheet(doc, 'F1')), text);
});

test('.traco: sem modo é esquema da E1; modo cad reabre no CAD; folha inexistente cai na primeira', () => {
    const cad = syncSchematic(addEntities(createDocument(), [{ ...createSymbol('iso1219/tanque', { x: 0, y: 0 }), id: 't' }]));
    const cadText = documentToTraco(cad);
    assert.equal(JSON.parse(cadText).modo, 'cad');
    assert.equal(JSON.parse(cadText).folhas, undefined);
    assert.equal(documentMode(tracoToDocument(cadText).doc), MODE_CAD);
    const e1 = JSON.parse(cadText);
    delete e1.modo;
    const old = tracoToDocument(JSON.stringify(e1)).doc;
    assert.equal(documentMode(old), MODE_SCHEMATIC);
    assert.deepEqual(old.sheets.map((s) => s.id), ['F1']);
    const bad = JSON.parse(cadText);
    bad.modo = 'esquema';
    bad.folhas = [{ id: 'F1', nome: 'A' }];
    bad.simbolos[0].folha = 'F7';
    const res = tracoToDocument(JSON.stringify(bad));
    assert.equal(res.doc.entities[0].sheet, 'F1');
    assert.ok(res.warnings.some((w) => /folha inexistente/.test(w)));
});

test('salvar: esquema vazio já sai em .traco; aba guardada mantém modo e folhas', () => {
    assert.equal(saveFormatOf(schematic()), 'traco');
    assert.equal(saveFormatOf(createDocument()), 'dxf');
    const s = serializeDocument(addSheet(schematic()).doc);
    assert.equal(s.mode, 'esquema');
    assert.equal(s.sheets.length, 2);
    assert.equal(s.currentSheet, 'F2');
    assert.equal(serializeDocument(createDocument()).mode, undefined);
});

test('autocompletar: comandos do esquema só aparecem no modo Esquemático', () => {
    const names = (mode) => suggestCommands('S', 200, { mode }).map((s) => s.name);
    assert.ok(!names('cad').includes('SYMBOL'));
    assert.ok(names('esquema').includes('SYMBOL'));
    assert.ok(!suggestCommands('LIG', 50).some((s) => s.name === 'CONNECT'));
    assert.ok(suggestCommands('LIG', 50, { mode: 'esquema' }).some((s) => s.name === 'CONNECT'));
    assert.ok(!suggestCommands('VERIF', 50).some((s) => s.name === 'SCHEMACHECK'));
    // MODO aparece nos dois: é a porta de entrada pelo terminal.
    assert.ok(suggestCommands('MOD', 50).some((s) => s.name === 'MODE'));
    // Desenho livre continua no terminal do esquema.
    assert.ok(names('esquema').includes('SPLINE') || suggestCommands('LINE', 50, { mode: 'esquema' }).some((s) => s.name === 'LINE'));
    assert.deepEqual([...SCHEMATIC_ONLY_COMMANDS].sort(), ['BOM', 'CONNECT', 'SCHEMACHECK', 'SHEET', 'SYMBOL', 'SYMLIB']);
});

test('conferência ao vivo: E1 com a folha do problema, em cache enquanto o desenho não muda', () => {
    let doc = schematic();
    doc = syncSchematic(addEntities(doc, [{ ...createSymbol('iso1219/bomba-variavel-ls', { x: 50, y: 50 }, { atributos: { etiqueta: 'B1' } }), id: 'b1' }]));
    doc = addSheet(doc).doc;
    const list = schematicCheckList(doc, (id) => (id === 'b1' ? 'B1' : id));
    assert.ok(list.errors >= 1);
    assert.ok(list.items.every((i) => i.sheet === 'F1'));
    assert.match(list.items[0].text, /^Porta obrigatória sem ligação: B1\./);
    assert.equal(schematicCheckList(doc), list, 'mesmo documento: mesma lista do cache');
    const empty = schematicCheckList(schematic());
    assert.deepEqual([empty.errors, empty.warnings, empty.items.length], [0, 0, 0]);
});

test('biblioteca na tela: ISO embutida primeiro, busca sem acento, prévia com as portas', () => {
    const all = librarySections();
    assert.equal(all[0].builtin, true);
    assert.equal(all[0].id, 'iso1219');
    assert.equal(all[0].symbols.length, 5);
    const found = librarySections('valvula');
    assert.deepEqual(found[0].symbols.map((s) => s.ref), ['iso1219/valvula-4-3-centro-fechado']);
    const svg = symbolPreviewSvg('iso1219/valvula-4-3-centro-fechado');
    assert.match(svg, /^<svg class="cad-symbol-preview" viewBox="[-\d. ]+"/);
    assert.equal((svg.match(/<circle /g) ?? []).length, 4, 'P, T, A e B');
    assert.equal(symbolPreviewSvg('nada/x'), '');
});

test('barra do Esquemático: grupos da maquete e nada de desenho livre', () => {
    assert.deepEqual(SCHEMATIC_BAR.map((g) => g.label), ['Arquivo', 'Símbolos', 'Ligações', 'Editar', 'Identificação', 'Folha', 'Conferir', 'Sair']);
    const cmds = SCHEMATIC_BAR.flatMap((g) => g.items.map((i) => i.cmd)).filter(Boolean);
    for (const free of ['LINE', 'PLINE', 'CIRCLE', 'ARC', 'HATCH', 'TRIM']) assert.ok(!cmds.includes(free), free);
    const html = schematicBarHtml();
    assert.match(html, /data-cad-schematic-cmd="SYMBOL"/);
    assert.match(html, /data-cad-schematic-cmd="CONNECT"/);
});
