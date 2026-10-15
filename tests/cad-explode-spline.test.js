import test from 'node:test';
import assert from 'node:assert/strict';

import { COMMANDS } from '../src/cad/commands.js';
import { sampleSpline } from '../src/cad/splines.js';

function run(spline) {
    let committed = null;
    const editor = {
        doc: { entities: [spline] },
        getSelection: async () => [spline.id],
        entitiesById: (ids) => [spline].filter((e) => ids.includes(e.id)),
        commit: (_label, doc) => { committed = doc; },
        clearSelection: () => {},
        log: (msg) => assert.fail(msg),
    };
    return COMMANDS.EXPLODE.run(editor).then(() => committed.entities);
}

const ends = (e) => e.type === 'line' ? [e.start, e.end]
    : [{ x: e.center.x + e.radius * Math.cos(e.start), y: e.center.y + e.radius * Math.sin(e.start) },
        { x: e.center.x + e.radius * Math.cos(e.end), y: e.center.y + e.radius * Math.sin(e.end) }];

test('EXPLODE: spline curva vira poucos arcos colados na curva original', async () => {
    const spline = {
        id: 's1', type: 'spline', layer: 'CORTE', color: 3, degree: 3,
        controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 40, y: 0 }],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
    };
    const out = await run(spline);
    assert.ok(out.some((e) => e.type === 'arc'));
    assert.ok(out.length < 30, `arcos demais: ${out.length}`);
    assert.ok(out.every((e) => e.layer === 'CORTE' && e.color === 3));
    // Cada ponto da spline fica a no máximo 0,02 mm de algum arco.
    const pts = sampleSpline(spline, 200);
    for (const p of pts) {
        const d = Math.min(...out.map((e) => e.type === 'arc'
            ? Math.abs(Math.hypot(p.x - e.center.x, p.y - e.center.y) - e.radius)
            : 0));
        assert.ok(d < 0.02, `desvio ${d}`);
    }
    // Pontas encadeadas: arco pode estar invertido, então compara o conjunto.
    const all = out.flatMap(ends);
    assert.ok(all.some((q) => Math.hypot(q.x, q.y) < 1e-6));
    assert.ok(all.some((q) => Math.hypot(q.x - 40, q.y) < 1e-6));
});

test('EXPLODE: spline reta vira linhas retas', async () => {
    const spline = {
        id: 's2', type: 'spline', layer: '0', degree: 1,
        controlPoints: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }],
        knots: [0, 0, 1, 2, 2],
    };
    const out = await run(spline);
    assert.equal(out.length, 2);
    assert.ok(out.every((e) => e.type === 'line'));
    assert.deepEqual(out[0].start, { x: 0, y: 0 });
    assert.ok(Math.hypot(out[1].end.x - 50, out[1].end.y - 30) < 1e-9);
});
