// ADR 0011: o esquemático saiu do Traço; o .traco continua como arquivo de desenho com imagem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentToTraco, tracoToDocument, SCHEMATIC_REMOVED_MESSAGE } from '../src/cad/traco-file.js';
import { createDocument } from '../src/cad/document.js';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';

const line = { type: 'line', id: 'l1', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };

test('grava cabeçalho compatível com as versões que ainda têm o esquemático', () => {
    const raw = JSON.parse(documentToTraco({ ...createDocument(), entities: [line] }));
    assert.equal(raw.formato, 'traco-esquema');
    assert.equal(raw.modo, 'cad');
    assert.deepEqual([raw.simbolos, raw.juncoes, raw.ligacoes, raw.bibliotecas], [[], [], [], []]);
    assert.equal(raw.folhas, undefined);
    assert.equal(raw.carimbo, undefined);
    const back = tracoToDocument(JSON.stringify(raw)).doc;
    assert.equal(back.mode, undefined);
    assert.deepEqual(back.entities.map((e) => e.id), ['l1']);
});

test('esquema com símbolo ou ligação é recusado com mensagem, não aberto pela metade', () => {
    const base = JSON.parse(documentToTraco({ ...createDocument(), entities: [line] }));
    const comSimbolo = { ...base, modo: 'esquema', simbolos: [{ id: 's1', camada: '0', def: 'iso1219/bomba', posicao: { x: 0, y: 0 } }] };
    assert.throws(() => tracoToDocument(JSON.stringify(comSimbolo)), (e) => e.message === SCHEMATIC_REMOVED_MESSAGE);
    const comLigacao = { ...base, ligacoes: [{ id: 'k1', camada: '0', de: { ponto: { x: 0, y: 0 } }, para: { ponto: { x: 5, y: 0 } } }] };
    assert.throws(() => tracoToDocument(JSON.stringify(comLigacao)), /módulo esquemático foi retirado/);
});

test('esquema sem símbolos abre como CAD, sem folha nas entidades', () => {
    const base = JSON.parse(documentToTraco(createDocument()));
    const raw = { ...base, modo: 'esquema', folhas: [{ id: 'f1', nome: 'Folha 1', formato: 'A4' }], anotacoes: [{ ...line, sheet: 'f1' }] };
    const { doc, warnings } = tracoToDocument(JSON.stringify(raw));
    assert.equal(doc.mode, undefined);
    assert.equal(doc.sheets, undefined);
    assert.equal(doc.entities[0].sheet, undefined);
    assert.match(warnings.join(' '), /retirado/);
});

test('comandos do esquemático não existem mais', () => {
    for (const name of ['SYMBOL', 'CONNECT', 'SYMLIB', 'SCHEMACHECK', 'SHEET', 'BOM', 'MODE']) assert.equal(COMMANDS[name], undefined, name);
    for (const alias of ['SIMBOLO', 'LIGAR', 'SIMBIB', 'VERIFICAR', 'FOLHA', 'LISTAPECAS', 'MODO']) assert.equal(resolveCommand?.(alias) ?? null, null, alias);
});
