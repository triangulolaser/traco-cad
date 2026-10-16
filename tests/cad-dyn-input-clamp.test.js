import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDynFieldPosition } from '../src/cad/editor.js';

test('campo da entrada dinâmica fica dentro da tela quando a cota sai da área visível', () => {
    assert.deepEqual(clampDynFieldPosition({ x: 1500, y: 900 }, 960, 700), { x: 960 - 36, y: 700 - 14 });
    assert.deepEqual(clampDynFieldPosition({ x: -200, y: -50 }, 960, 700), { x: 36, y: 14 });
    assert.deepEqual(clampDynFieldPosition({ x: 400, y: 300 }, 960, 700), { x: 400, y: 300 });
});
