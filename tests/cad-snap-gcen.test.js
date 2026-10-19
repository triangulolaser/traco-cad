import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
import { findSnap, findCenterHints, geometricCenter, defaultSnapSettings, SNAP_MODES } from '../src/cad/snaps.js';

const rect = { id: 'r', type: 'polyline', closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }] };
const lShape = { id: 'l', type: 'polyline', closed: true, vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }] };

describe('snap de centro geométrico (GCEN)', () => {
    it('calcula o centroide de área de polilinhas fechadas', () => {
        assert.deepEqual(geometricCenter(rect), { x: 50, y: 20 });
        const g = geometricCenter(lShape);
        close(g.x, 25 / 3);
        close(g.y, 25 / 3);
        assert.equal(geometricCenter({ ...rect, closed: false }), null);
    });

    it('considera arcos por bulge (círculo de duas metades e meio disco)', () => {
        const circle = { type: 'polyline', closed: true, vertices: [{ x: 10, y: 0, bulge: 1 }, { x: -10, y: 0, bulge: 1 }] };
        const c = geometricCenter(circle);
        close(c.x, 0);
        close(c.y, 0);
        // Meio disco superior de raio 10: centroide em y = 4r/3π. Ordem horária (bulge negativo) também.
        const half = { type: 'polyline', closed: true, vertices: [{ x: 10, y: 0, bulge: 1 }, { x: -10, y: 0, bulge: 0 }] };
        close(geometricCenter(half).y, 40 / (3 * Math.PI));
        const halfCw = { type: 'polyline', closed: true, vertices: [{ x: -10, y: 0, bulge: -1 }, { x: 10, y: 0, bulge: 0 }] };
        close(geometricCenter(halfCw).y, 40 / (3 * Math.PI));
    });

    it('encaixa no centro geométrico com o cursor perto dele e aparece no menu', () => {
        const snap = findSnap([rect], { x: 50.5, y: 20.3 }, 1, defaultSnapSettings());
        assert.equal(snap.mode, 'gcen');
        assert.deepEqual(snap.point, { x: 50, y: 20 });
        assert.equal(findSnap([rect], { x: 50.5, y: 20.3 }, 1, { ...defaultSnapSettings(), gcen: false }), null);
        assert.equal(SNAP_MODES.some((m) => m.key === 'gcen'), true);
    });

    it('passar pela borda revela o centro geométrico', () => {
        const hints = findCenterHints([rect], { x: 30, y: 0.2 }, 1, defaultSnapSettings());
        assert.equal(hints[0].mode, 'gcen');
        assert.deepEqual(hints[0].point, { x: 50, y: 20 });
    });
});
