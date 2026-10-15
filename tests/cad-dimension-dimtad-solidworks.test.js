import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseDxf } from '../src/cad/dxf.js';
import { dimensionGeometry, defaultDimStyle } from '../src/cad/dimensions.js';

// Feedback Traço 15/10/2026: cotas coladas do SolidWorks (DIMTAD=1) ficavam com o texto cortado pela linha de cota.
// O SolidWorks grava o código 11 sobre a linha; com DIMTAD=1 o texto vai acima dela, afastado por DIMGAP.

test('DIMTAD=1 com código 11 sobre a linha põe o texto acima da linha de cota', () => {
    const doc = parseDxf(readFileSync(new URL('./fixtures/solidworks-cotas-dimtad.dxf', import.meta.url), 'utf8'), { preserveBlocks: true, preserveDimensions: true });
    const dims = doc.entities.filter((e) => e.type === 'dimension');
    assert.equal(dims.length, 7);
    for (const d of dims) {
        const style = { ...(doc.dimStyle ?? defaultDimStyle()), ...(d.style ?? {}) };
        assert.equal(style.textAbove, true);
        const g = dimensionGeometry(d, style);
        const pos = g.texts[0].position;
        const vertical = Math.abs(Math.sin(g.texts[0].rotation ?? 0)) > 0.5;
        // Base do texto a DIMGAP da linha: acima na horizontal, à esquerda na vertical (texto girado 90°).
        const gap = vertical ? d.linePoint.x - pos.x : pos.y - d.linePoint.y;
        assert.ok(Math.abs(gap - style.textGap) < 1e-6, `${g.text}: afastamento ${gap}`);
    }
});
