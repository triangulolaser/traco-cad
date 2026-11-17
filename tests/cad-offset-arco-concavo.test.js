import test from 'node:test';
import assert from 'node:assert/strict';

import { offsetEntityMultiple } from '../src/cad/offset-planar.js';
import { polylineCurves, sweepCCW } from '../src/cad/geometry.js';

// Chapa com recorte côncavo em arco na lateral direita (centro do arco fora da peça).
const R = 411.36;
const bulge = -Math.tan((2 * Math.asin(280 / R)) / 4);
const ccw = [
    { x: 0, y: 0, bulge: 0 },
    { x: 500, y: 0, bulge: 0 },
    { x: 510, y: 10, bulge: 0 },
    { x: 510, y: 60, bulge },
    { x: 510, y: 620, bulge: 0 },
    { x: 510, y: 670, bulge: 0 },
    { x: 500, y: 680, bulge: 0 },
    { x: 0, y: 680, bulge: 0 },
];

function reversed(vs) {
    const n = vs.length;
    return vs.map((_, k) => {
        const i = n - 1 - k;
        return { x: vs[i].x, y: vs[i].y, bulge: -(vs[(i - 1 + n) % n].bulge ?? 0) };
    });
}

function arcsOf(entity) {
    return polylineCurves(entity.vertices, entity.closed).filter((c) => c.kind === 'arc');
}

for (const [name, vertices] of [['anti-horária', ccw], ['horária', reversed(ccw)]]) {
    test(`offset interno de polilinha ${name} mantém o arco côncavo com raio maior`, () => {
        for (const side of [{ x: 5, y: 300 }, { x: 250, y: 3 }, { x: 300, y: 340 }]) {
            const [out] = offsetEntityMultiple({ type: 'lwpolyline', closed: true, vertices }, 1, side);
            assert.ok(out, 'offset deve existir');
            const arcs = arcsOf(out);
            assert.equal(arcs.length, 1, 'o arco não pode sumir');
            assert.ok(Math.abs(arcs[0].radius - (R + 1)) < 1e-6, `raio ${arcs[0].radius}`);
            const sweep = sweepCCW(arcs[0].start, arcs[0].end);
            assert.ok(sweep < Math.PI / 2, `arco não pode virar o complementar (varredura ${sweep})`);
        }
    });

    test(`offset externo de polilinha ${name} reduz o raio do arco côncavo`, () => {
        const [out] = offsetEntityMultiple({ type: 'lwpolyline', closed: true, vertices }, 1, { x: 600, y: 340 });
        const arcs = arcsOf(out);
        assert.equal(arcs.length, 1);
        assert.ok(Math.abs(arcs[0].radius - (R - 1)) < 1e-6);
        assert.ok(sweepCCW(arcs[0].start, arcs[0].end) < Math.PI / 2);
    });
}

test('offset de polilinha aberta começando por arco com bulge negativo parte do início do percurso', () => {
    const open = { type: 'lwpolyline', closed: false, vertices: [{ x: 510, y: 60, bulge }, { x: 510, y: 620, bulge: 0 }, { x: 0, y: 620, bulge: 0 }] };
    const [out] = offsetEntityMultiple(open, 1, { x: 300, y: 340 });
    assert.ok(out);
    assert.ok(out.vertices[0].y < 100, `primeiro vértice deve ficar perto de y=60, veio ${out.vertices[0].y}`);
    assert.equal(arcsOf(out).length, 1);
});
