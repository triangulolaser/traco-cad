import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { commonTangents, distance } from '../src/cad/geometry.js';
import { findOverrideSnap, parseSnapOverride, resolveDeferredTangent, SNAP_OVERRIDE_PROMPTS } from '../src/cad/snaps.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const big = { id: 'g', type: 'circle', center: { x: 0, y: 0 }, radius: 50 };
const small = { id: 's', type: 'circle', center: { x: 200, y: 0 }, radius: 20 };
const curveOf = (c) => ({ kind: 'circle', center: c.center, radius: c.radius });

// A reta ab toca o círculo: distância do centro à reta igual ao raio, com o ponto sobre ela.
function assertTangent(a, b, c, onIt) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.abs(dx * (c.center.y - a.y) - dy * (c.center.x - a.x)) / Math.hypot(dx, dy);
    close(dist, c.radius, 1e-7);
    close(distance(onIt, c.center), c.radius, 1e-7);
}

describe('snap TAN digitado (override) e tangente ajustada', () => {
    it('reconhece os códigos de snap digitados, com ou sem _', () => {
        assert.equal(parseSnapOverride('tan'), 'tan');
        assert.equal(parseSnapOverride(' TAN '), 'tan');
        assert.equal(parseSnapOverride('_tan'), 'tan');
        assert.equal(parseSnapOverride('end'), 'end');
        assert.equal(parseSnapOverride('100,20'), null);
        assert.equal(parseSnapOverride('t'), null);
        assert.equal(SNAP_OVERRIDE_PROMPTS.tan, 'Snap para tangente de:');
    });

    it('calcula as 4 tangentes comuns a dois círculos separados', () => {
        const pairs = commonTangents(curveOf(big), curveOf(small));
        assert.equal(pairs.length, 4);
        pairs.forEach(({ a, b }) => {
            assertTangent(a, b, big, a);
            assertTangent(a, b, small, b);
        });
        // Círculos que se cruzam só têm as 2 externas; um dentro do outro, nenhuma.
        assert.equal(commonTangents(curveOf(big), { kind: 'circle', center: { x: 60, y: 0 }, radius: 20 }).length, 2);
        assert.equal(commonTangents(curveOf(big), { kind: 'circle', center: { x: 10, y: 0 }, radius: 5 }).length, 0);
    });

    it('sem ponto anterior, TAN marca a tangente ajustada sobre o círculo', () => {
        const snap = findOverrideSnap([big, small], { x: 30, y: -41 }, 2, 'tan');
        assert.equal(snap.mode, 'tan');
        assert.equal(snap.entity.id, 'g');
        assert.ok(snap.deferred);
        close(distance(snap.point, big.center), 50, 1e-9);
        assert.equal(findOverrideSnap([big, small], { x: 120, y: 80 }, 2, 'tan'), null);
    });

    it('TAN nos dois círculos dá a tangente externa de baixo quando os cliques são embaixo', () => {
        const first = findOverrideSnap([big, small], { x: 0, y: -50.5 }, 2, 'tan');
        const second = findOverrideSnap([big, small], { x: 200, y: -20.4 }, 2, 'tan', { deferred: first.deferred });
        assert.equal(second.entity.id, 's');
        assertTangent(second.tangentFrom, second.point, big, second.tangentFrom);
        assertTangent(second.tangentFrom, second.point, small, second.point);
        assert.ok(second.tangentFrom.y < 0 && second.point.y < 0, 'externa inferior');
        // Externa: os dois pontos de tangência ficam do mesmo lado da reta dos centros.
        assert.equal(Math.sign(second.tangentFrom.y), Math.sign(second.point.y));
    });

    it('TAN embaixo no primeiro e em cima no segundo dá a tangente cruzada (interna)', () => {
        const first = findOverrideSnap([big, small], { x: 10, y: -50.2 }, 2, 'tan');
        const second = findOverrideSnap([big, small], { x: 195, y: 19.5 }, 2, 'tan', { deferred: first.deferred });
        assertTangent(second.tangentFrom, second.point, big, second.tangentFrom);
        assertTangent(second.tangentFrom, second.point, small, second.point);
        assert.ok(second.tangentFrom.y < 0 && second.point.y > 0, 'interna');
    });

    it('tangente ajustada até um ponto livre escolhe o lado clicado', () => {
        const first = findOverrideSnap([big], { x: 0, y: 50.3 }, 2, 'tan');
        const p = { x: 150, y: 0 };
        const a = resolveDeferredTangent(first.deferred, p);
        assert.ok(a.y > 0);
        assertTangent(a, p, big, a);
        assert.equal(resolveDeferredTangent(first.deferred, { x: 10, y: 0 }), null);
    });

    it('com ponto anterior, TAN acha a tangência mesmo com o cursor longe dela na borda', () => {
        const snap = findOverrideSnap([small], { x: 220, y: 0 }, 2, 'tan', { reference: { x: 0, y: 0 } });
        assert.equal(snap.mode, 'tan');
        assertTangent({ x: 0, y: 0 }, snap.point, small, snap.point);
    });

    it('arco só aceita tangências dentro do trecho', () => {
        const upperArc = { id: 'a', type: 'arc', center: { x: 200, y: 0 }, radius: 20, start: 0, end: Math.PI };
        const first = findOverrideSnap([big], { x: 0, y: -50.2 }, 2, 'tan');
        const snap = findOverrideSnap([upperArc], { x: 200, y: 20.3 }, 2, 'tan', { deferred: first.deferred });
        assert.ok(snap.point.y >= 0);
        assertTangent(snap.tangentFrom, snap.point, upperArc, snap.point);
    });

    it('outros overrides usam só o modo digitado', () => {
        const line = { id: 'l', type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
        const end = findOverrideSnap([line], { x: 49, y: 1 }, 2, 'mid');
        assert.equal(end.mode, 'mid');
        assert.equal(findOverrideSnap([line], { x: 49, y: 1 }, 2, 'end'), null);
    });
});
