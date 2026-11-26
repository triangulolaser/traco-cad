import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/cad/extra-entities.js';
import { offsetEntity, distance } from '../src/cad/geometry.js';
import { offsetSide, offsetArrows, offsetBand, offsetHint, outlinePoints, OFFSET_SIDE_LABEL } from '../src/cad/offset-hint.js';
import en from '../src/cad/locales/en.js';
import es from '../src/cad/locales/es.js';

// Círculo grande com deslocamento pequeno: o caso em que fora/dentro some na tela.
const big = { type: 'circle', center: { x: 0, y: 0 }, radius: 1500 };
const viewport = { scale: 0.3, pixelsToWorld: (px) => px / 0.3 };

test('circle: side is FORA outside and DENTRO inside, even for a tiny offset', () => {
    const outCursor = { x: 0, y: 1530 };
    const inCursor = { x: 0, y: 1470 };
    const out = offsetEntity(big, 6.3, outCursor);
    const inn = offsetEntity(big, 6.3, inCursor);
    assert.equal(offsetSide(big, [out], outCursor), 'out');
    assert.equal(offsetSide(big, [inn], inCursor), 'in');
    assert.equal(OFFSET_SIDE_LABEL.out, 'FORA');
    assert.equal(OFFSET_SIDE_LABEL.in, 'DENTRO');
});

test('arrows have fixed screen spacing and point from the source to the copy', () => {
    const cursor = { x: 0, y: 1530 };
    const out = offsetEntity(big, 6.3, cursor);
    const arrows = offsetArrows(big, [out], cursor, viewport.pixelsToWorld);
    assert.equal(arrows.length, 2);
    for (const a of arrows) {
        assert.ok(Math.abs(distance(a.at, big.center) - 1500) < 1e-6, 'arrow sits on the source');
        // Para fora: a direção acompanha o raio.
        const radial = { x: a.at.x / 1500, y: a.at.y / 1500 };
        assert.ok(a.dir.x * radial.x + a.dir.y * radial.y > 0.999);
        // ~150 px do ponto mais próximo do cursor, qualquer que seja a distância de 6.3.
        const gap = distance(a.at, { x: 0, y: 1500 });
        assert.ok(gap > 450 && gap < 510, `gap ${gap}`);
    }
    const inn = offsetEntity(big, 6.3, { x: 0, y: 1470 });
    const inArrows = offsetArrows(big, [inn], { x: 0, y: 1470 }, viewport.pixelsToWorld);
    for (const a of inArrows) assert.ok(a.dir.x * a.at.x + a.dir.y * a.at.y < 0, 'inward arrows point to the center');
});

test('closed band uses even-odd rings that hug source and copy', () => {
    const out = offsetEntity(big, 6.3, { x: 0, y: 1530 });
    const band = offsetBand(big, [out], 0.3);
    assert.equal(band.evenOdd, true);
    assert.equal(band.rings.length, 2);
    assert.ok(band.rings[0].every((p) => Math.abs(Math.hypot(p.x, p.y) - 1500) < 1e-6));
    assert.ok(band.rings[1].every((p) => Math.abs(Math.hypot(p.x, p.y) - 1506.3) < 1e-6));
});

test('open line: left/right by drawing direction and a single band polygon', () => {
    const line = { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const up = { x: 50, y: 5 };
    const down = { x: 50, y: -5 };
    const above = offsetEntity(line, 2, up);
    assert.equal(offsetSide(line, [above], up), 'left');
    assert.equal(offsetSide(line, [offsetEntity(line, 2, down)], down), 'right');
    const band = offsetBand(line, [above], 1);
    assert.equal(band.evenOdd, false);
    assert.equal(band.rings[0].length, 4);
});

test('arc and closed polyline report FORA/DENTRO', () => {
    const arc = { type: 'arc', center: { x: 0, y: 0 }, radius: 50, start: 0, end: Math.PI / 2 };
    assert.equal(offsetSide(arc, [offsetEntity(arc, 1, { x: 40, y: 40 })], { x: 40, y: 40 }), 'out');
    assert.equal(offsetSide(arc, [offsetEntity(arc, 1, { x: 30, y: 30 })], { x: 30, y: 30 }), 'in');
    const square = { type: 'polyline', closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const outside = { x: 50, y: -3 };
    const inside = { x: 50, y: 3 };
    assert.equal(offsetSide(square, [offsetEntity(square, 0.5, outside)], outside), 'out');
    assert.equal(offsetSide(square, [offsetEntity(square, 0.5, inside)], inside), 'in');
    const hint = offsetHint(square, [offsetEntity(square, 0.5, inside)], inside, { scale: 2, pixelsToWorld: (px) => px / 2 });
    assert.equal(hint.side, 'in');
    assert.ok(hint.band.rings.length === 2);
    assert.ok(hint.arrows.length >= 1);
});

test('bulged polyline outline follows the arc, not the chord', () => {
    const pl = { type: 'polyline', closed: false, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 20, y: 0 }] };
    const pts = outlinePoints(pl, 1);
    assert.ok(pts.length > 4);
    assert.deepEqual(pts[0], { x: 0, y: 0 });
    assert.deepEqual(pts[pts.length - 1], { x: 20, y: 0 });
    // bulge 1 = semicírculo: todos a 10 do centro (10,0).
    assert.ok(pts.every((p) => Math.abs(Math.hypot(p.x - 10, p.y) - 10) < 1e-9));
});

test('side labels are translated', () => {
    for (const key of Object.values(OFFSET_SIDE_LABEL)) {
        assert.ok(en[key], `en: ${key}`);
        assert.ok(es[key], `es: ${key}`);
    }
});
