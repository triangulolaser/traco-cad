import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textBox } from '../src/cad/geometry.js';

// MTEXT com largura de caixa e parágrafos vazios (\P\P\P), como a tabela do DWG do Miguel (16/10).
test('linhas vazias de MTEXT com largura de caixa ocupam altura', () => {
    const base = { type: 'text', position: { x: 0, y: 0 }, height: 20, valign: 'top', boxWidth: 2615 };
    const full = textBox({ ...base, text: 'a\nb\n\n\nc' });
    const packed = textBox({ ...base, text: 'a\nb\nc' });
    const h = (b) => Math.max(...b.map((p) => p.y)) - Math.min(...b.map((p) => p.y));
    assert.ok(h(full) > h(packed) * 1.5, `${h(full)} vs ${h(packed)}`);
});
