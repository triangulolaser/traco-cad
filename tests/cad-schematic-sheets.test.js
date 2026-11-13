// Folhas prontas do esquema (ADR 0007, E2b e E3): conector de página, carimbo, impressão por folha,
// painel do símbolo com rótulos da biblioteca e lista de peças. A colaboração fica em
// cad-collab-schematic.test.js (não vai para a versão pública).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument, addEntities, updateEntities } from '../src/cad/document.js';
import {
    buildLibrary, registerLibrary, libraryToBundle, libraryFromBundle, libraryFromFiles, attributeLabel, CONNECTOR_REF,
    isBuiltinLibrary, unregisterLibrary,
} from '../src/cad/schematic-library.js';
import {
    createSymbol, syncSchematic, analyzeSchematic, connectorReferences, connectorReferenceTexts,
} from '../src/cad/schematic.js';
import { MODE_SCHEMATIC, withMode, addSheet, setActiveSheet } from '../src/cad/schematic-mode.js';
import { schematicCheckList } from '../src/cad/schematic-check.js';
import { sheetDecorations, normalizeTitleBlock, TITLE_BLOCK, FRAME_MARGIN } from '../src/cad/schematic-sheet.js';
import { sheetPrintSvg, schematicPrintPages, bomPrintSvgs } from '../src/cad/schematic-print.js';
import { schematicBom, bomCsv, bomCodeLabel } from '../src/cad/schematic-bom.js';
import { schematicPropertiesHtml, symbolAttributeNames } from '../src/cad/schematic-panel.js';
import { documentToTraco, tracoToDocument } from '../src/cad/traco-file.js';
import { librarySections } from '../src/cad/schematic-ui.js';

const port = (name, x, y, orientation, type) => ({ name, position: { x, y }, orientation, type, required: true });

function symbolDef(id, ports, extra = {}) {
    return {
        formato: 'traco-simbolo', versao: 1, id, nome: `Peça ${id}`, categoria: 'teste', unidade: 'mm',
        geometria: ports.map((p) => ({ type: 'line', start: { x: 0, y: 0 }, end: p.position })),
        portas: ports,
        atributos: [{ nome: 'etiqueta', prefixo: 'Q', visivel: true, posicao: { x: 0, y: 10 }, altura: 2.5 }, { nome: 'descricao', visivel: false }, { nome: 'codigo', visivel: false }],
        ...extra,
    };
}

// Biblioteca de empresa fictícia com rótulo próprio para o código.
const manifest = {
    formato: 'traco-biblioteca', versao: 1, id: 'empresa-exemplo', nome: 'Empresa exemplo', versao_biblioteca: '0.2.0',
    rotulos: { codigo: 'Código interno' }, simbolos: ['fonte-pressao.json', 'fonte-retorno.json', 'fonte-piloto.json', 'fonte-trabalho.json'],
};
const defs = [
    symbolDef('fonte-pressao', [port('P', 0, 10, 'n', 'pressao')]),
    symbolDef('fonte-retorno', [port('R', 0, 10, 'n', 'retorno')]),
    symbolDef('fonte-piloto', [port('X', 0, 10, 'n', 'piloto')]),
    symbolDef('fonte-trabalho', [port('A', 0, 10, 'n', 'trabalho')]),
];
registerLibrary(buildLibrary(manifest, defs));

const sym = (id, ref, x, y, atributos = {}, sheet) => ({ ...createSymbol(ref, { x, y }, { atributos }), id, ...(sheet ? { sheet } : {}) });
const link = (id, from, to, extra = {}) => ({ type: 'link', id, from, to, ...extra });

// Duas folhas: F1 com a fonte e um conector, F2 com o outro conector e o destino.
function twoSheets({ left = 'empresa-exemplo/fonte-pressao', right = 'empresa-exemplo/fonte-retorno', sinal = 'A', peer = true } = {}) {
    let doc = withMode(createDocument(), MODE_SCHEMATIC);
    doc = addSheet(doc).doc;
    const leftPort = left.endsWith('pressao') ? 'P' : left.endsWith('piloto') ? 'X' : left.endsWith('trabalho') ? 'A' : 'R';
    const rightPort = right.endsWith('pressao') ? 'P' : right.endsWith('piloto') ? 'X' : right.endsWith('trabalho') ? 'A' : 'R';
    const entities = [
        sym('s1', left, 50, 50, { etiqueta: 'Q1' }, 'F1'),
        sym('x1', CONNECTOR_REF, 100, 80, { etiqueta: 'X1', sinal }, 'F1'),
        link('l1', { symbol: 's1', port: leftPort }, { symbol: 'x1', port: 'X' }, { sheet: 'F1' }),
        sym('s2', right, 50, 50, { etiqueta: 'Q2' }, 'F2'),
    ];
    if (peer) {
        entities.push(sym('x2', CONNECTOR_REF, 100, 80, { etiqueta: 'X2', sinal }, 'F2'));
        entities.push(link('l2', { symbol: 's2', port: rightPort }, { symbol: 'x2', port: 'X' }, { sheet: 'F2' }));
    }
    // addEntities põe tudo na folha ativa: entra folha por folha.
    for (const sheet of ['F1', 'F2']) doc = addEntities(setActiveSheet(doc, sheet), entities.filter((e) => e.sheet === sheet));
    return syncSchematic(setActiveSheet(doc, 'F1'));
}

test('rotulos: a biblioteca guarda, o pacote grava e o painel usa o nome da biblioteca', () => {
    const lib = libraryFromFiles([
        { name: 'biblioteca.json', text: JSON.stringify({ ...manifest, id: 'empresa-ida-volta' }) },
        ...defs.map((d) => ({ name: `${d.id}.json`, text: JSON.stringify(d) })),
    ]);
    assert.deepEqual(lib.rotulos, { codigo: 'Código interno' });
    const bundle = libraryToBundle(lib);
    assert.deepEqual(bundle.manifesto.rotulos, { codigo: 'Código interno' });
    const back = libraryFromBundle(JSON.parse(JSON.stringify(bundle)));
    assert.deepEqual(back.rotulos, { codigo: 'Código interno' });
    // Sem rótulo no manifesto, o pacote não ganha o campo.
    assert.equal('rotulos' in libraryToBundle(buildLibrary({ ...manifest, id: 'sem-rotulo', rotulos: undefined }, defs)).manifesto, false);
    assert.throws(() => buildLibrary({ ...manifest, id: 'rotulo-ruim', rotulos: { codigo: 3 } }, defs), /rotulos inválido/);
    assert.equal(attributeLabel('empresa-exemplo/fonte-pressao', 'codigo'), 'Código interno');
    assert.equal(attributeLabel('iso1219/tanque', 'codigo'), 'Código');
    assert.equal(attributeLabel('empresa-exemplo/fonte-pressao', 'etiqueta'), 'Etiqueta');
});

test('painel: atributos na ordem da definição, rótulo da biblioteca e portas ligadas ou soltas', () => {
    const doc = twoSheets();
    const s1 = doc.entities.find((e) => e.id === 's1');
    assert.deepEqual(symbolAttributeNames(s1), ['etiqueta', 'descricao', 'codigo']);
    const html = schematicPropertiesHtml(doc, [s1]);
    assert.match(html, /Código interno/);
    assert.match(html, /data-schematic-attr="codigo"/);
    assert.match(html, /pressão · <span class="cad-port-ok">ligada/);
    const loose = schematicPropertiesHtml(doc, [doc.entities.find((e) => e.id === 's2')]);
    assert.match(loose, /ligada/);
    const hose = schematicPropertiesHtml(doc, [doc.entities.find((e) => e.id === 'l1')]);
    assert.match(hose, /data-schematic-hose/);
    const none = schematicPropertiesHtml(doc, []);
    assert.match(none, /Carimbo/);
    assert.match(none, /data-schematic-title="titulo"/);
    assert.equal(schematicPropertiesHtml(createDocument(), []), '', 'no CAD o painel não muda');
});

test('conector de página: o mesmo sinal junta as redes de folhas diferentes', () => {
    // Pressão numa folha e retorno na outra pelo mesmo sinal: E2 atravessa a folha.
    const bad = twoSheets();
    const e2 = analyzeSchematic(bad).problems.filter((p) => p.code === 'E2');
    assert.equal(e2.length, 1);
    assert.deepEqual(e2[0].types, ['pressao', 'retorno']);
    assert.ok(e2[0].ids.includes('s1') && e2[0].ids.includes('s2'));
    // Pressão com trabalho: compatível, nenhum problema, uma rede.
    const ok = twoSheets({ right: 'empresa-exemplo/fonte-trabalho' });
    const an = analyzeSchematic(ok);
    assert.deepEqual(an.problems, []);
    assert.equal(an.linkNet.get('l1'), an.linkNet.get('l2'));
    // Piloto pelos conectores: as duas ligações saem tracejadas.
    const pilot = twoSheets({ left: 'empresa-exemplo/fonte-piloto', right: 'empresa-exemplo/fonte-piloto' });
    const pan = analyzeSchematic(pilot);
    assert.equal(pan.linkLineType.get('l1'), 'DASHED');
    assert.equal(pan.linkLineType.get('l2'), 'DASHED');
    // Sinais diferentes não se ligam: dois avisos A6.
    let split = twoSheets({ right: 'empresa-exemplo/fonte-trabalho' });
    split = updateEntities(split, ['x2'], (e) => ({ ...e, atributos: { ...e.atributos, sinal: 'B' } }));
    const san = analyzeSchematic(split);
    assert.notEqual(san.linkNet.get('l1'), san.linkNet.get('l2'));
    assert.deepEqual(san.problems.map((p) => [p.code, p.sinal]), [['A6', 'A'], ['A6', 'B']]);
});

test('conector de página: sem par vira A6, sem ligação vira E1, e não entra como peça', () => {
    const lonely = twoSheets({ peer: false });
    const codes = analyzeSchematic(lonely).problems.map((p) => p.code).sort();
    assert.deepEqual(codes, ['A6', 'E1'], 'conector sem par e a fonte da F2 solta');
    const list = schematicCheckList(lonely, (id) => lonely.entities.find((e) => e.id === id)?.atributos?.etiqueta ?? id);
    const a6 = list.items.find((i) => i.code === 'A6');
    assert.equal(a6.level, 'warn');
    assert.match(a6.text, /sinal A só aparece em X1/);
    assert.equal(a6.sheet, 'F1');
    let doc = withMode(createDocument(), MODE_SCHEMATIC);
    doc = addEntities(doc, [sym('x9', CONNECTOR_REF, 0, 0, { etiqueta: 'X9' })]);
    const e1 = analyzeSchematic(doc).problems.map((p) => p.code).sort();
    assert.deepEqual(e1, ['A6', 'E1'], 'sem sinal e sem ligação');
    assert.equal(schematicBom(twoSheets()).parts.length, 2, 'conectores ficam fora da lista de peças');
});

test('conector de página: referência cruzada com o número da outra folha, derivada', () => {
    const doc = twoSheets();
    const refs = connectorReferences(doc);
    assert.deepEqual(refs.get('x1'), [2]);
    assert.deepEqual(refs.get('x2'), [1]);
    const texts = connectorReferenceTexts(doc, (e) => e.sheet === 'F1');
    assert.equal(texts.length, 1);
    assert.equal(texts[0].text, 'fl. 2');
    // A bandeira aponta para +X a partir de (100,80): o texto começa depois da ponta.
    assert.ok(texts[0].position.x > 120);
    assert.equal(documentToTraco(doc).includes('fl. 2'), false, 'a referência não vai para o arquivo');
    // Biblioteca embutida do Traço: aparece com a ISO, não sai pelo SIMBIB.
    assert.equal(isBuiltinLibrary('traco'), true);
    assert.equal(unregisterLibrary('traco'), false);
    const sections = librarySections('');
    assert.deepEqual(sections.filter((s) => s.builtin).map((s) => s.id), ['iso1219', 'traco']);
});

test('carimbo: campos normalizados, ida e volta no .traco e desenho derivado por folha', () => {
    assert.deepEqual(normalizeTitleBlock({ titulo: '  Circuito  ', autor: '', outro: 'x', revisao: 2 }), { titulo: 'Circuito', revisao: '2' });
    let doc = twoSheets();
    doc = { ...doc, carimbo: { empresa: 'Oficina Exemplo', titulo: 'Circuito do implemento', numero: 'ESQ-001', revisao: 'B', autor: 'Fulano', data: '13/11/2026' } };
    doc = updateEntities(doc, ['l1'], (e) => ({ ...e, rotulo: 'M1 1/2" 800 mm' }));
    const text = documentToTraco(doc);
    assert.match(text, /"carimbo": \{/);
    assert.match(text, /"rotulo": "M1 1\/2\\" 800 mm"/);
    const { doc: back } = tracoToDocument(text);
    assert.deepEqual(back.carimbo, doc.carimbo);
    assert.equal(back.entities.find((e) => e.id === 'l1').rotulo, 'M1 1/2" 800 mm');
    assert.equal(documentToTraco(back), text, 'determinístico');
    const deco = sheetDecorations(back, 'F2');
    const texts = deco.filter((e) => e.type === 'text').map((e) => e.text);
    assert.ok(texts.includes('2/2'), 'folha 2 de 2');
    assert.ok(texts.includes('Circuito do implemento'));
    assert.ok(texts.includes('Folha 2'));
    assert.ok(texts.includes('ESQ-001'));
    // Moldura dentro do papel, com a margem de arquivamento à esquerda.
    const xs = deco.filter((e) => e.type === 'line').flatMap((e) => [e.start.x, e.end.x]);
    assert.equal(Math.min(...xs), FRAME_MARGIN.left);
    assert.equal(Math.max(...xs), 297 - FRAME_MARGIN.right);
    // Carimbo vazio não vai para o arquivo.
    assert.equal(documentToTraco({ ...back, carimbo: { titulo: ' ' } }).includes('carimbo'), false);
});

test('impressão: uma página A4 por folha, 1:1, só com o que está nela, moldura e carimbo', () => {
    let doc = twoSheets({ left: 'empresa-exemplo/fonte-piloto', right: 'empresa-exemplo/fonte-piloto' });
    doc = { ...doc, carimbo: { titulo: 'Circuito de teste' } };
    const svg = sheetPrintSvg(doc, 'F1', { page: { number: 1, total: 2 } });
    assert.match(svg, /width="297mm" height="210mm" viewBox="0 0 297 210"/);
    assert.match(svg, /Circuito de teste/);
    assert.match(svg, />Q1</);
    assert.doesNotMatch(svg, />Q2</, 'a outra folha não entra');
    assert.match(svg, /stroke-dasharray="3 1.5"/, 'piloto tracejado');
    assert.match(svg, />fl\. 2</);
    assert.match(svg, />1\/2</);
    assert.doesNotMatch(svg, /#ffffff/i, 'branco vira preto no papel');
    const pages = schematicPrintPages(doc, { bom: true });
    assert.equal(pages.length, 3);
    assert.match(pages[0], />1\/3</);
    assert.match(pages[2], /Lista de peças/);
    assert.match(pages[2], />3\/3</);
    const active = schematicPrintPages(setActiveSheet(doc, 'F2'), { sheets: 'active' });
    assert.equal(active.length, 1);
    assert.match(active[0], />2\/2</);
    assert.match(active[0], />Q2</);
});

test('lista de peças: agrupa por definição e código, mangueiras pelo rótulo, CSV com o rótulo da biblioteca', () => {
    let doc = withMode(createDocument(), MODE_SCHEMATIC);
    doc = addEntities(doc, [
        sym('a', 'empresa-exemplo/fonte-pressao', 0, 0, { etiqueta: 'Q10', codigo: '1001', descricao: 'Fonte A' }),
        sym('b', 'empresa-exemplo/fonte-pressao', 30, 0, { etiqueta: 'Q2', codigo: '1001' }),
        sym('c', 'empresa-exemplo/fonte-pressao', 60, 0, { etiqueta: 'Q3', codigo: '1002' }),
        sym('d', 'empresa-exemplo/fonte-trabalho', 90, 0, { etiqueta: 'Q1', codigo: '2001' }),
        sym('x', CONNECTOR_REF, 120, 0, { etiqueta: 'X1', sinal: 'A' }),
        link('m1', { symbol: 'a', port: 'P' }, { symbol: 'd', port: 'A' }, { rotulo: 'M-1/2' }),
        link('m2', { symbol: 'b', port: 'P' }, { symbol: 'x', port: 'X' }, { rotulo: 'M-1/2' }),
        link('m3', { symbol: 'c', port: 'P' }, { point: { x: 60, y: 40 } }),
    ]);
    const bom = schematicBom(doc);
    assert.deepEqual(bom.parts.map((p) => [p.item, p.etiquetas.join(','), p.quantidade, p.codigo]), [
        [1, 'Q1', 1, '2001'],
        [2, 'Q2,Q10', 2, '1001'],
        [3, 'Q3', 1, '1002'],
    ]);
    assert.equal(bom.parts[1].descricao, 'Fonte A');
    assert.deepEqual(bom.hoses.map((h) => [h.rotulo, h.quantidade]), [['M-1/2', 2]]);
    assert.equal(bom.unlabeledLinks, 1);
    assert.equal(schematicBom(doc), bom, 'em cache enquanto o desenho não muda');
    assert.equal(bomCodeLabel(doc), 'Código interno');
    // ISO embutida junto: o rótulo da empresa continua valendo.
    const mixed = addEntities(doc, [sym('t', 'iso1219/tanque', 0, -40, { etiqueta: 'R1' })]);
    assert.equal(bomCodeLabel(mixed), 'Código interno');
    assert.equal(bomCodeLabel(addEntities(withMode(createDocument(), MODE_SCHEMATIC), [sym('t', 'iso1219/tanque', 0, 0, { etiqueta: 'R1' })])), 'Código');
    const csv = bomCsv(doc);
    assert.ok(csv.startsWith('﻿Item;Etiquetas;Quantidade;Peça;Descrição;Código interno;Símbolo\r\n'));
    assert.match(csv, /\r\n2;Q2, Q10;2;Peça fonte-pressao;Fonte A;1001;empresa-exemplo\/fonte-pressao\r\n/);
    assert.match(csv, /\r\nMangueira;Quantidade\r\nM-1\/2;2\r\n$/);
    const pages = bomPrintSvgs(doc, { firstNumber: 2, total: 2 });
    assert.equal(pages.length, 1);
    assert.match(pages[0], /Código interno/);
    assert.match(pages[0], /Q2, Q10/);
    // Lista longa quebra em páginas, sem passar por cima do carimbo.
    const many = addEntities(withMode(createDocument(), MODE_SCHEMATIC), Array.from({ length: 60 }, (_, i) => sym(`p${i}`, 'empresa-exemplo/fonte-pressao', i * 30, 0, { etiqueta: `Q${i + 1}`, codigo: String(5000 + i) })));
    const long = bomPrintSvgs(many);
    assert.equal(long.length, 3);
    for (const page of long) {
        const ys = [...page.matchAll(/<text x="[\d.]+" y="([\d.]+)" font-size="3"/g)].map((m) => Number(m[1]));
        assert.ok(Math.max(...ys) < 210 - FRAME_MARGIN.bottom - TITLE_BLOCK.height, 'tabela acima do carimbo');
    }
    assert.match(long[2], /Lista de peças \(3\/3\)/);
});

test('A7: objeto por cima do carimbo vira aviso na conferência, por folha', () => {
    let doc = withMode(createDocument(), MODE_SCHEMATIC);
    doc = addEntities(doc, [sym('r1', 'iso1219/tanque', 60, 60, { etiqueta: 'R1' })]);
    assert.equal(schematicCheckList(doc).items.filter((i) => i.code === 'A7').length, 0, 'fora do carimbo');
    doc = addEntities(doc, [sym('r3', 'iso1219/tanque', 200, 30, { etiqueta: 'R3' })]);
    const a7 = schematicCheckList(doc, (id) => (id === 'r3' ? 'R3' : id)).items.filter((i) => i.code === 'A7');
    assert.equal(a7.length, 1);
    assert.equal(a7[0].level, 'warn');
    assert.deepEqual(a7[0].ids, ['r3']);
    assert.equal(a7[0].sheet, 'F1');
    assert.match(a7[0].text, /1 objeto\(s\) sobre o carimbo: R3/);
});
