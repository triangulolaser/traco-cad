import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDxf, writeDxf } from '../src/cad/dxf.js';

// SolidWorks 2014 recusa R2000 sem dicionário raiz e layouts ("arquivo inválido ou incompleto").
test('writeDxf grava dicionário raiz e layouts ligados aos block records', () => {
    const doc = {
        layers: [{ name: '0', color: 7, visible: true }],
        entities: [{ type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
    };
    const dxf = writeDxf(doc);
    const objects = dxf.slice(dxf.indexOf('OBJECTS'));

    assert.match(objects, /DICTIONARY\n5\nC\n100\nAcDbDictionary\n/);
    assert.match(objects, /3\nACAD_GROUP\n350\nD\n/);
    assert.match(objects, /3\nACAD_LAYOUT\n350\n1A\n/);
    assert.match(objects, /AcDbLayout\n1\nModel\n/);
    assert.match(objects, /AcDbLayout\n1\nLayout1\n/);
    assert.match(dxf, /\*Model_Space\n340\n1E\n/);
    assert.match(dxf, /\*Paper_Space\n340\n1F\n/);
    assert.equal(parseDxf(dxf).entities.length, 1);
});
