import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDxf } from '../src/cad/dxf.js';

const hatchDxf = (edges, tail = []) => ['0', 'SECTION', '2', 'ENTITIES', '0', 'HATCH', '8', '0', '2', 'ANSI31', '70', '0', '91', '1', '92', '1', '93', String(edges.length),
    ...edges.flat(), '97', '0', '75', '0', '76', '1', '52', '45', '41', '1', ...tail, '0', 'ENDSEC', '0', 'EOF'].join('\n');
const edgeLine = (x1, y1, x2, y2) => ['72', '1', '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
const edgeArc = (cx, cy, r, a1, a2, ccw) => ['72', '2', '10', String(cx), '20', String(cy), '40', String(r), '50', String(a1), '51', String(a2), '73', ccw ? '1' : '0'];

test('HATCH DXF: arco horário usa ângulos espelhados e não vira círculo quase completo', () => {
    // Quadrado 10×10 com lado esquerdo trocado por meia-volta horária de (0,10) a (0,0) passando por (5,5).
    const dxf = hatchDxf([edgeLine(0, 0, 10, 0), edgeLine(10, 0, 10, 10), edgeLine(10, 10, 0, 10), edgeArc(0, 5, 5, 270, 90, false)],
        ['98', '1', '10', '99', '20', '99']);
    const doc = parseDxf(dxf);
    const hatch = (doc.entities ?? doc).find((e) => e.type === 'hatch');
    const v = hatch.loops[0].vertices;
    assert.equal(v.length, 4);
    assert.ok(Math.abs(v[3].x) < 1e-9 && Math.abs(v[3].y - 10) < 1e-9, 'arco começa em (0,10)');
    assert.ok(Math.abs(v[3].bulge + 1) < 1e-9, 'meia-volta horária = bulge -1');
    assert.ok(v.every((p) => p.x >= -1e-9 && p.x <= 10 && p.y >= 0 && p.y <= 10), 'ponto-semente não contamina a última aresta');
});

test('HATCH DXF: arco anti-horário preserva início e varredura', () => {
    const dxf = hatchDxf([edgeLine(10, 0, 10, 10), edgeArc(5, 10, 5, 0, 180, true), edgeLine(0, 10, 0, 0), edgeLine(0, 0, 10, 0)]);
    const hatch = (parseDxf(dxf).entities ?? []).find((e) => e.type === 'hatch');
    const arc = hatch.loops[0].vertices[1];
    assert.ok(Math.abs(arc.x - 10) < 1e-9 && Math.abs(arc.y - 10) < 1e-9);
    assert.ok(Math.abs(arc.bulge - 1) < 1e-9);
});
