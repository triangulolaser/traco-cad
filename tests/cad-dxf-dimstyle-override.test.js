import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';
import { createDocument, addEntities } from '../src/cad/document.js';

const lines = (...pairs) => pairs.map(String).join('\n') + '\n';

// Estilo com DIMSCALE 0 (como o STANDARD$0 do DWG do Miguel, 16/10) e cota com override DSTYLE em XDATA.
function dxf({ withOverride }) {
    const xdata = withOverride ? lines(1001, 'ACAD', 1000, 'DSTYLE', 1002, '{',
        1070, 278, 1070, 44, // DIMDSEP ',' (valor 44 não pode virar DIMEXE)
        1070, 41, 1040, 5, 1070, 140, 1040, 12, 1070, 40, 1040, 1, 1002, '}') : '';
    return lines(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'DIMSTYLE', 70, 1,
        0, 'DIMSTYLE', 2, 'STANDARD$0', 70, 0, 40, 0, 41, 120, 42, 80, 44, 80, 140, 100, 147, 40, 271, 0,
        0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES',
        0, 'DIMENSION', 8, '0', 2, '*D1', 10, 0, 20, 50, 30, 0, 11, 50, 21, 50, 31, 0, 70, 32, 1, '<>', 3, 'STANDARD$0',
        100, 'AcDbAlignedDimension', 13, 0, 23, 0, 33, 0, 14, 400, 24, 0, 34, 0, 100, 'AcDbRotatedDimension', 50, 0)
        + xdata + lines(0, 'ENDSEC', 0, 'EOF');
}

const dimOf = (text) => parseDxf(text, { preserveBlocks: true, preserveDimensions: true }).entities.find((e) => e.type === 'dimension');

test('override DSTYLE da cota (DIMTXT/DIMASZ/DIMSCALE) vence o estilo', () => {
    const dim = dimOf(dxf({ withOverride: true }));
    assert.equal(dim.style.textHeight, 12);
    assert.equal(dim.style.arrowSize, 5);
    assert.equal(dim.style.scale, 1);
    assert.equal(dim.style.extBeyond, 80);
});

test('DIMSCALE 0 não zera texto e setas', () => {
    const dim = dimOf(dxf({ withOverride: false }));
    assert.equal(dim.style.scale, 1);
    const g = dimensionGeometry(dim, dim.style);
    assert.ok(g.texts[0].height > 0, `altura do texto ${g.texts[0]?.height}`);
});

test('DXF gravado pelo Traço não sai com DIMSCALE 0 nem texto de altura 0', () => {
    const doc = addEntities(createDocument(), [{ type: 'dimension', kind: 'horizontal', layer: '0', p1: { x: 0, y: 0 }, p2: { x: 110, y: 0 }, linePoint: { x: 0, y: 30 }, style: { scale: 0, textHeight: 10 } }]);
    const out = writeDxf(doc);
    assert.doesNotMatch(out, /\nDIMSTYLE\n(?:[^\n]*\n)*?\s*40\n0\n\s*41\n/);
    const back = dimOf(out);
    assert.equal(back.style.scale, 1);
    assert.equal(dimensionGeometry(back, back.style).texts[0].height, 10);
});
