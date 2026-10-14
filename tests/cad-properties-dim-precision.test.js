// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDocument, addEntities, updateEntities } from '../src/cad/document.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';
import { writeDxf } from '../src/cad/dxf.js';

const dim = (id, x) => ({ id, type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x, y: 0 }, linePoint: { x: x / 2, y: 10 }, layer: '0' });

test('painel de propriedades oferece "Precisão dim" de 0 a 0.00000000 para cotas', () => {
    const content = readFileSync(resolve(process.cwd(), 'src/cad.js'), 'utf-8');
    assert.match(content, /Precisão dim/);
    assert.match(content, /data-prop="dim-precision"/);
    assert.match(content, /length: 9/);
});

test('precisão por cota sobrepõe o estilo do desenho e chega ao texto e ao DXF', () => {
    let doc = addEntities(createDocument(), [dim('a', 12.3456), dim('b', 7.5)]);
    doc = updateEntities(doc, ['a'], (e) => ({ ...e, style: { ...(e.style ?? {}), precision: 3 } }));
    const a = doc.entities.find((e) => e.id === 'a');
    const b = doc.entities.find((e) => e.id === 'b');
    assert.equal(a.style.precision, 3);
    assert.equal(dimensionGeometry(a, doc.dimStyle).text, '12.346');
    assert.equal(dimensionGeometry(b, doc.dimStyle).text, '7.5');
    doc = updateEntities(doc, ['a'], (e) => ({ ...e, style: { ...e.style, precision: 0 } }));
    assert.equal(dimensionGeometry(doc.entities.find((e) => e.id === 'a'), doc.dimStyle).text, '12');
    const dxf = writeDxf(doc);
    assert.match(dxf, /\n271\n0\n/);
});
