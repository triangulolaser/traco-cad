import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../src/cad/commands.js';
import { blockNameFor, insertExportedBlock, copyExportedBlock, formatBytes, exportedByPath, showExportBalloon } from '../src/cad/export-balloon.js';
import { expandInsert } from '../src/cad/blocks.js';

const line = { id: 'a', type: 'line', layer: 'CORTE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };

function fakeEditor(doc = {}) {
    const logs = [];
    const editor = {
        logs,
        doc: { units: 4, layers: [{ name: '0' }], entities: [], blocks: {}, currentLayer: '0', ...doc },
        log: (msg, level) => logs.push([msg, level]),
        commit(label, next) { this.committed = label; this.doc = next; },
    };
    return editor;
}

test('nome do bloco vem do arquivo, sem extensão e sem repetir nome existente', () => {
    assert.equal(blockNameFor('C:\\Blocos\\flange-120.dxf'), 'flange-120');
    assert.equal(blockNameFor('a:b.DXF'), 'a_b');
    assert.equal(blockNameFor('flange.dxf', { flange: {}, 'flange-2': {} }), 'flange-3');
});

test('soltar no desenho insere como bloco com o ponto base no ponto solto', () => {
    const editor = fakeEditor();
    const data = { name: 'flange.dxf', entities: [line], layers: [{ name: '0' }, { name: 'CORTE', color: 1 }], base: { x: 5, y: 0 }, units: 4 };
    assert.equal(insertExportedBlock(editor, data, { x: 100, y: 50 }), true);
    assert.equal(editor.committed, 'Inserir bloco');
    assert.ok(editor.doc.blocks.flange);
    assert.ok(editor.doc.layers.some((l) => l.name === 'CORTE'));
    const insert = editor.doc.entities.find((e) => e.type === 'insert');
    assert.equal(insert.name, 'flange');
    const [placed] = expandInsert(insert);
    assert.deepEqual([placed.start.x, placed.start.y, placed.end.x, placed.end.y], [95, 50, 105, 50]);
});

test('unidades diferentes não inserem e avisam', () => {
    const editor = fakeEditor({ units: 1 });
    const ok = insertExportedBlock(editor, { name: 'a.dxf', entities: [line], base: { x: 0, y: 0 }, units: 4 }, { x: 0, y: 0 });
    assert.equal(ok, false);
    assert.equal(editor.committed, undefined);
    assert.ok(editor.logs.some(([, level]) => level === 'warn'));
});

test('Copiar deixa o bloco no clipboard do desenho pelo ponto base', async () => {
    const editor = fakeEditor();
    await copyExportedBlock(editor, { entities: [line], layers: [{ name: 'CORTE' }], base: { x: 5, y: 0 }, units: 4 }, { clipboardSequence: async () => 7 });
    assert.deepEqual(editor.entityClipboard.base, { x: 5, y: 0 });
    assert.equal(editor.entityClipboard.entities.length, 1);
    assert.equal(editor.entityClipboard.systemSeq, 7);
});

test('tamanho do arquivo legível', () => {
    assert.equal(formatBytes(500), '500 B');
    assert.equal(formatBytes(14 * 1024), '14 KB');
    assert.equal(formatBytes(1.5 * 1024 * 1024), '1,5 MB');
});

test('sem DOM o balão não quebra', () => {
    assert.equal(showExportBalloon(fakeEditor(), { name: 'a.dxf', entities: [line] }), null);
});

test('WBLOCK mostra o balão com o arquivo gravado, a geometria e o ponto base', async () => {
    const shown = [];
    globalThis.window = { desktopBridge: { saveFile: async () => null, fileExists: async () => false } };
    try {
        const editor = {
            memory: {},
            doc: { units: 4, layers: [{ name: '0' }, { name: 'CORTE' }], entities: [line] },
            getSelection: async () => ['a'],
            entitiesById: () => [line],
            log: () => {},
            wblockUi: {
                openWblockDialog: async () => ({ action: 'ok', path: 'C:\\B\\flange', base: { x: 5, y: 0, z: 0 } }),
                confirmOverwrite: async () => true,
                showBalloon: (ed, data) => shown.push(data),
            },
        };
        await COMMANDS.WBLOCK.run(editor);
        assert.equal(shown.length, 1);
        assert.equal(shown[0].name, 'flange.dxf');
        assert.equal(shown[0].path, 'C:\\B\\flange.dxf');
        assert.deepEqual(shown[0].base, { x: 5, y: 0 });
        assert.equal(shown[0].units, 4);
        assert.equal(shown[0].entities.length, 1);
        assert.match(shown[0].content, /CORTE/);
    } finally {
        delete globalThis.window;
    }
});

test('caminho desconhecido não é tratado como bloco do balão', () => {
    assert.equal(exportedByPath('C:\\nada\\x.dxf'), null);
    assert.equal(exportedByPath(null), null);
});
