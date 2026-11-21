import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_ACI, paletteGrid } from '../src/cad/color-palette.js';

test('paleta: grade 12x10 com cinzas de branco a preto e cores únicas', () => {
    const grid = paletteGrid();
    assert.equal(grid.length, 10);
    assert.ok(grid.every((row) => row.length === 12));
    assert.equal(grid[0][0], '#ffffff');
    assert.equal(grid[0][11], '#000000');
    const all = grid.flat();
    assert.ok(all.every((hex) => /^#[0-9a-f]{6}$/.test(hex)), 'tudo em hex de 6 dígitos');
    assert.equal(new Set(all).size, all.length, 'sem quadradinhos repetidos');
});

test('paleta: linha de cores indexadas cobre ACI 1 a 9', () => {
    assert.deepEqual(PALETTE_ACI.map(([n]) => n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
