import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetEntityMultiple, hasPolylineSelfIntersectionOrInvasion } from '../src/cad/offset-planar.js';
import { polylineCurves, polar, sweepCCW, distanceToCurve } from '../src/cad/geometry.js';
import { pointInLoopExact } from '../src/cad/topology-dcel.js';

// Synthetic four-lobed contour: inward offsets separate adjacent support circles.
const vertices = [
    { x: -6, y: 9, bulge: 1.2 }, { x: -6, y: -9, bulge: 1.7 },
    { x: 6, y: -9, bulge: 1.2 }, { x: 6, y: 9, bulge: 1.7 },
];
function reverse(vs) {
    return vs.map((_, k) => { const i = vs.length - 1 - k;
        return { ...vs[i], bulge: -vs[(i + vs.length - 1) % vs.length].bulge }; });
}
for (const clockwise of [false, true]) {
    for (const [size, dx, dy] of [[1, 0, 0], [1, 185, 364], [10, -500, 1200]]) {
        test('offset joins separated arcs: clockwise=' + clockwise + ', scale=' + size + ', x=' + dx, () => {
            const e = { type: 'polyline', closed: true,
                vertices: (clockwise ? reverse(vertices) : vertices).map(v => ({ ...v, x: v.x * size + dx, y: v.y * size + dy })) };
            const dist = size;
            const original = polylineCurves(e.vertices, true);
            const snapshot = JSON.stringify(e);
            const result = offsetEntityMultiple(e, dist, { x: dx - 12 * size, y: dy });
            assert.equal(JSON.stringify(e), snapshot, 'original is unchanged');
            assert.equal(result.length, 1, 'one connected island survives');
            const out = result[0];
            assert.equal(out.closed, true);
            assert.equal(hasPolylineSelfIntersectionOrInvasion(out, e, dist), false);
            const curves = polylineCurves(out.vertices, true);
            assert.equal(curves.filter(c => Math.abs(c.radius - dist) < 1e-6).length, 4, 'four round corner joins');
            for (const c of curves) {
                assert.equal(c.kind, 'arc', 'preserve exact circular geometry');
                for (let n = 1; n < 64; n++) {
                    const p = polar(c.center, c.start + sweepCCW(c.start, c.end) * n / 64, c.radius);
                    assert.equal(pointInLoopExact(p, e), true, 'inside original');
                    const d = Math.min(...original.map(c0 => distanceToCurve(p, c0)));
                    assert.ok(Math.abs(d - dist) < 1e-6 * size, 'uniform distance: ' + d);
                }
            }
        });
    }
}
