import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseDxf } from '../src/cad/dxf.js';
import { dimensionGeometry, dimensionText, defaultDimStyle } from '../src/cad/dimensions.js';

// Feedback Traço 15/10/2026: colagem do SolidWorks (Ctrl+Shift+D) traz cota com texto "%%c<>";
// o Traço mostrava "Ø<>" literal em vez de Ø65,20.

test('marcador <> dentro do texto sobrescrito vira a medição', () => {
    const style = { ...defaultDimStyle(), decimals: 2 };
    assert.equal(dimensionText('Ø<>', 65.2, style), `Ø${dimensionText(undefined, 65.2, style)}`);
    assert.equal(dimensionText('2x <> furos', 10, style), `2x ${dimensionText(undefined, 10, style)} furos`);
    assert.equal(dimensionText('FIXO', 10, style), 'FIXO');
});

test('cota "%%c<>" do SolidWorks mostra Ø com o valor real (vista 1:2)', () => {
    const p = (c, v) => `${c}\n${v}\n`;
    const dxf = p(0, 'SECTION') + p(2, 'HEADER') + p(9, '$INSUNITS') + p(70, 4) + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'TABLES')
        + p(0, 'TABLE') + p(2, 'DIMSTYLE') + p(0, 'DIMSTYLE') + p(2, 'SLDDIMSTYLE0') + p(40, 1) + p(41, 3.302) + p(140, 3.5)
        + p(144, 2) + p(271, 2) + p(0, 'ENDTAB') + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'ENTITIES')
        + p(0, 'DIMENSION') + p(8, '0') + p(2, '_D') + p(10, 32.6) + p(20, 10) + p(30, 0) + p(11, 16) + p(21, 10) + p(31, 0)
        + p(70, 160) + p(1, '%%c<>') + p(3, 'SLDDIMSTYLE0') + p(13, 0) + p(23, 0) + p(33, 0) + p(14, 32.6) + p(24, 0) + p(34, 0)
        + p(0, 'ENDSEC') + p(0, 'EOF');
    const doc = parseDxf(dxf, { preserveBlocks: true, preserveDimensions: true });
    const dim = doc.entities.find((e) => e.type === 'dimension');
    assert.ok(dim);
    const text = dimensionGeometry(dim, doc.dimStyle ?? defaultDimStyle()).text;
    assert.match(text, /^Ø65[.,]2/);
});
