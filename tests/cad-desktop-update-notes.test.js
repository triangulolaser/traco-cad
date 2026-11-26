import test from 'node:test';
import assert from 'node:assert/strict';
import { updateNotesText } from '../src/update-notes.js';

test('novidades sem repetir nome e versão do título', () => {
    const opts = { appName: 'Traço', version: '0.3.89' };
    assert.equal(updateNotesText('Traço 0.3.89: OFFSET mostra o lado.', opts), 'OFFSET mostra o lado.');
    assert.equal(updateNotesText('Traço CAD v0.3.89 — OFFSET mostra o lado.', opts), 'OFFSET mostra o lado.');
    assert.equal(updateNotesText('0.3.89 - OFFSET mostra o lado.', opts), 'OFFSET mostra o lado.');
    assert.equal(updateNotesText('  Traço 0.3.89  ', opts), '');
});

test('novidades sem prefixo ficam como estão', () => {
    const opts = { appName: 'Traço', version: '0.3.89' };
    assert.equal(updateNotesText('OFFSET mostra o lado.', opts), 'OFFSET mostra o lado.');
    assert.equal(updateNotesText('Traço 0.3.88 tinha um erro no OFFSET.', opts), 'Traço 0.3.88 tinha um erro no OFFSET.');
    assert.equal(updateNotesText('Traço 0.3.890 novo', opts), 'Traço 0.3.890 novo');
    assert.equal(updateNotesText(null, opts), '');
});
