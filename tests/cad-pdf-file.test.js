import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPdfFile } from '../src/cad/pdf-file.js';

const editor = { pickFile() { throw new Error('HTML picker must not read desktop PDF'); } };
test('desktop PDF uses native dialog and preserves every binary byte', async () => {
    const bytes = Array.from({ length: 256 }, (_, i) => i);
    const file = await pickPdfFile(editor, {
        async showOpenDialog(options) {
            assert.equal(options.multiple, false);
            assert.deepEqual(options.filters[0].extensions, ['pdf']);
            return '/Volumes/Desenhos/peça 3,00.pdf';
        },
        async readFileBinary(path) { assert.equal(path, '/Volumes/Desenhos/peça 3,00.pdf'); return bytes; },
    });
    assert.equal(file.name, 'peça 3,00.pdf');
    assert.equal(file.type, 'application/pdf');
    assert.equal(file.filePath, '/Volumes/Desenhos/peça 3,00.pdf');
    assert.deepEqual(Array.from(new Uint8Array(await file.arrayBuffer())), bytes);
});
test('native cancellation does not read or reopen the HTML picker', async () => {
    assert.equal(await pickPdfFile(editor, { showOpenDialog: async () => null, readFileBinary() { throw Error('read'); } }), null);
});
test('native errors propagate, not silently retried as text', async () => {
    await assert.rejects(pickPdfFile(editor, { showOpenDialog: async () => '/a.pdf', readFileBinary() { throw Error('permission denied'); } }), /permission denied/);
});
test('browser keeps the HTML picker', async () => {
    const file = new File(['%PDF'], 'web.pdf');
    assert.equal(await pickPdfFile({ pickFile(accept) { assert.equal(accept, '.pdf,application/pdf'); return file; } }, null), file);
});
test('existing drop wins over native dialog', async () => {
    const file = new File(['%PDF'], 'drop.pdf');
    const e = { pendingDropFile: file, pickFile() { const f = this.pendingDropFile; this.pendingDropFile = null; return f; } };
    assert.equal(await pickPdfFile(e, { showOpenDialog() { throw Error('must not prompt'); }, readFileBinary() {} }), file);
    assert.equal(e.pendingDropFile, null);
});
test('typed array views preserve their offset and Windows names', async () => {
    const data = new Uint8Array([0, 37, 80, 68, 70, 255]);
    const file = await pickPdfFile(editor, { showOpenDialog: async () => ['C:\\parts\\test.pdf'], readFileBinary: async () => data.subarray(1, 5) });
    assert.equal(file.name, 'test.pdf');
    assert.equal(await file.text(), '%PDF');
});

test('PDFIMPORT command uses native picker and cancellation leaves drawing untouched', async () => {
    const { resolveCommand } = await import('../src/cad/commands.js');
    const previous = globalThis.window;
    let prompted = 0;
    globalThis.window = { desktopBridge: {
        showOpenDialog: async () => { prompted++; return null; },
        readFileBinary() { throw Error('must not read after cancel'); },
    } };
    try {
        await resolveCommand('PDFIMPORT').run({ ...editor, log() { throw Error('unexpected error or mutation'); } });
        assert.equal(prompted, 1);
    } finally { globalThis.window = previous; }
});
