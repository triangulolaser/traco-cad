// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setLineLength, entityLength } from '../src/cad/geometry.js';

const line = { id: 'a', type: 'line', start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, layer: '0' };
const close = (p, x, y) => { assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9, `${p.x},${p.y} ≠ ${x},${y}`); };

test('setLineLength mantém a direção e respeita a ponta fixa', () => {
    const s = setLineLength(line, 10, 'start');
    close(s.start, 0, 0); close(s.end, 6, 8);
    const e = setLineLength(line, 10, 'end');
    close(e.start, -3, -4); close(e.end, 3, 4);
    const m = setLineLength(line, 10, 'middle');
    close(m.start, -1.5, -2); close(m.end, 4.5, 6);
    for (const r of [s, e, m]) assert.ok(Math.abs(entityLength(r) - 10) < 1e-9);
});

test('setLineLength ignora comprimento inválido e linha degenerada', () => {
    assert.equal(setLineLength(line, 0), line);
    const zero = { ...line, end: { x: 0, y: 0 } };
    assert.equal(setLineLength(zero, 5), zero);
});

test('propriedades de várias linhas têm Comprimento e Ponta fixa', () => {
    const content = readFileSync(resolve(process.cwd(), 'src/cad.js'), 'utf-8');
    assert.match(content, /data-prop="line-length"/);
    assert.match(content, /data-prop="line-anchor"/);
    assert.match(content, /'Vários'/);
});
