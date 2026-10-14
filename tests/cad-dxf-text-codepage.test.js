import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';

// DXF AC1015 é lido na codepage do desenho (ANSI_1252). UTF-8 cru virava
// "PLANIFICAÃÃO" no QCAD.
test('writeDxf grava acentos como \\U+XXXX e a leitura devolve o texto original', () => {
    const text = 'PLANIFICAÇÃO 4× peça(s) PÓS-DOBRA Ø10 90°';
    const doc = { ...createDocument(), entities: [{ id: '1', type: 'text', text, position: { x: 0, y: 0 }, height: 5 }] };
    const dxf = writeDxf(doc);
    assert.ok(!/[^\x00-\x7f]/.test(dxf), 'DXF AC1015 deve ser ASCII puro');
    assert.match(dxf, /PLANIFICA\\U\+00C7\\U\+00C3O/);
    assert.equal(parseDxf(dxf).entities.find((e) => e.type === 'text').text, text);
});
