import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseDxf } from '../src/cad/dxf.js';
import { translateEntity } from '../src/cad/geometry.js';
import '../src/cad/dimensions.js';

// Feedback Traço 15/10/2026: ao mover o mouse antes de clicar para colar, as cotas verticais 33 e 35 entortavam.
// Erro de ponto flutuante na translação fazia a cota vertical virar alinhada.

test('mover cotas verticais/horizontais não muda o tipo', () => {
    const doc = parseDxf(readFileSync(new URL('./fixtures/solidworks-cotas-dimtad.dxf', import.meta.url), 'utf8'), { preserveBlocks: true, preserveDimensions: true });
    const dims = doc.entities.filter((e) => e.type === 'dimension');
    for (const delta of [{ x: 0.1, y: 0.3 }, { x: -123.456, y: 78.9 }, { x: 1e-3, y: -7.77 }, { x: 512.33, y: -301.7 }]) {
        for (const d of dims) assert.equal(translateEntity(d, delta).kind, d.kind);
    }
});
