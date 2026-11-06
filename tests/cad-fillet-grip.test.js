import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFilletCorners, filletRadiusFromCursor, filletAtCorner, getFilletGrips, niceRadiusStep } from '../src/cad/fillet-grip.js';
import { distance, polar, entityLength } from '../src/cad/geometry.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const closePoint = (p, q, tol = 1e-6) => close(p.x, q.x, tol) && close(p.y, q.y, tol);

const h = { id: 'h', type: 'line', layer: '0', start: { x: 0, y: 10 }, end: { x: 10, y: 10 } };
const v = { id: 'v', type: 'line', layer: '0', start: { x: 10, y: 10 }, end: { x: 10, y: 0 } };

test('duas linhas com canto comum mostram uma alça dentro do canto', () => {
    const grips = getFilletGrips([h, v], 0.1);
    assert.equal(grips.length, 1);
    const g = grips[0];
    assert.equal(g.type, 'fillet');
    assert.deepEqual(g.entityIds, ['h', 'v']);
    assert.ok(closePoint(g.corner.corner, { x: 10, y: 10 }));
    // Bissetriz aponta para dentro (−x, −y) e a alça fica a 18 px do canto.
    assert.ok(g.point.x < 10 && g.point.y < 10);
    assert.ok(close(distance(g.point, { x: 10, y: 10 }), 1.8));
});

test('sem alça: uma só entidade, linhas soltas, colineares ou tipos não suportados', () => {
    assert.equal(getFilletGrips([h], 0.1).length, 0);
    assert.equal(getFilletGrips([h, { ...v, start: { x: 10, y: 9 } }], 0.01).length, 0);
    const colinear = { id: 'c', type: 'line', start: { x: 10, y: 10 }, end: { x: 20, y: 10 } };
    assert.equal(getFilletGrips([h, colinear], 0.1).length, 0);
    const circle = { id: 'o', type: 'circle', center: { x: 0, y: 0 }, radius: 10 };
    assert.equal(getFilletGrips([h, circle], 0.1).length, 0);
});

test('o meio do arco acompanha o cursor na bissetriz', () => {
    const [info] = findFilletCorners(h, v);
    // Canto de 90°: arco de raio 2 tem o meio a 2(√2 − 1) do canto.
    const d = 2 * (Math.SQRT2 - 1);
    const cursor = { x: 10 - d / Math.SQRT2, y: 10 - d / Math.SQRT2 };
    assert.ok(close(filletRadiusFromCursor(info, cursor), 2));
    assert.equal(filletRadiusFromCursor(info, { x: 11, y: 11 }), 0, 'para fora do canto não há raio');
});

test('concordância apara as duas linhas e cria o arco tangente', () => {
    const r = filletAtCorner(h, v, 2);
    assert.ok(r);
    assert.ok(close(r.radius, 2));
    assert.ok(closePoint(r.first.end, { x: 8, y: 10 }));
    assert.ok(closePoint(r.first.start, { x: 0, y: 10 }));
    assert.ok(closePoint(r.second.start, { x: 10, y: 8 }));
    assert.ok(closePoint(r.second.end, { x: 10, y: 0 }));
    assert.ok(closePoint(r.arc.center, { x: 8, y: 8 }));
});

test('raio maior que as linhas fica limitado ao maior que cabe, sem estender', () => {
    const r = filletAtCorner(h, v, 50);
    assert.ok(r);
    assert.ok(r.radius < 10 && r.radius > 9.9, `raio ${r.radius}`);
    assert.ok(entityLength(r.first) < 10 && entityLength(r.second) < 10);
});

test('raio arredondado pelo passo do zoom', () => {
    assert.equal(niceRadiusStep(0.03), 0.05);
    assert.equal(niceRadiusStep(0.1), 0.1);
    assert.equal(niceRadiusStep(0.15), 0.2);
    const r = filletAtCorner(h, v, 2.034, { step: 0.05 });
    assert.ok(close(r.radius, 2.05));
});

test('linha e arco que se encontram (caso do anexo) também ganham concordância', () => {
    // Arco de raio 50 com centro em (50, 0), de 90° a 180°: termina em (0, 0) e começa em (50, 50).
    const arc = { id: 'a', type: 'arc', layer: '0', center: { x: 50, y: 0 }, radius: 50, start: Math.PI / 2, end: Math.PI };
    const top = { id: 't', type: 'line', layer: '0', start: { x: 50, y: 50 }, end: { x: 100, y: 50 } };
    // Canto tangente (arco chega horizontal na linha): sem alça.
    assert.equal(getFilletGrips([arc, top], 0.1).length, 0);
    // Linha inclinada saindo do topo do arco: há canto.
    const slanted = { id: 's', type: 'line', layer: '0', start: { x: 50, y: 50 }, end: { x: 100, y: 0 } };
    const grips = getFilletGrips([arc, slanted], 0.1);
    assert.equal(grips.length, 1);
    const r = filletAtCorner(arc, slanted, 5);
    assert.ok(r, 'concordância arco-linha');
    assert.ok(close(r.radius, 5));
    assert.ok(distance(r.arc.center, { x: 50, y: 50 }) < 10, 'centro dentro do canto, não longe dele');
    // Arco aparado continua sobre o círculo original e a linha mantém a ponta distante.
    assert.ok(close(r.first.radius, 50));
    assert.ok(closePoint(r.second.end, { x: 100, y: 0 }));
    const t1 = polar(r.first.center, r.first.end, r.first.radius);
    const t1b = polar(r.first.center, r.first.start, r.first.radius);
    const arcEnds = [polar(r.arc.center, r.arc.start, 5), polar(r.arc.center, r.arc.end, 5)];
    const touches = (p) => arcEnds.some((q) => distance(p, q) < 1e-6);
    assert.ok(touches(t1) || touches(t1b), 'arco de concordância encosta no arco aparado');
    assert.ok(arcEnds.some((q) => distance(q, r.second.start) < 1e-6), 'e na linha aparada');
});

test('dois arcos fechando uma lente não ganham alça (lado ambíguo)', () => {
    const a1 = { id: 'a1', type: 'arc', center: { x: 0, y: -5 }, radius: 10, start: Math.asin(0.5), end: Math.PI - Math.asin(0.5) };
    const p1 = polar(a1.center, a1.start, 10);
    const p2 = polar(a1.center, a1.end, 10);
    const a2 = { id: 'a2', type: 'arc', center: { x: 0, y: 5 }, radius: 10, start: Math.PI + Math.asin(0.5), end: -Math.asin(0.5) };
    assert.ok(closePoint(polar(a2.center, a2.start, 10), p2) && closePoint(polar(a2.center, a2.end, 10), p1));
    assert.equal(getFilletGrips([a1, a2], 0.01).length, 0);
});

test('ordem das pontas não importa: canto no início de uma e no fim da outra', () => {
    const hr = { ...h, start: h.end, end: h.start };
    const r = filletAtCorner(hr, v, 3);
    assert.ok(r && close(r.radius, 3));
    assert.ok(closePoint(r.first.start, { x: 7, y: 10 }) && closePoint(r.first.end, { x: 0, y: 10 }));
    assert.ok(closePoint(r.second.start, { x: 10, y: 7 }));
});

test('ângulo agudo: raio sai do arrasto e respeita o comprimento das linhas', () => {
    const a = { id: 'a', type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const b = { id: 'b', type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 20 } };
    const [info] = findFilletCorners(a, b);
    const rFromDrag = filletRadiusFromCursor(info, { x: 10, y: 2 });
    const r = filletAtCorner(a, b, rFromDrag, { corner: info });
    assert.ok(r);
    // Meio do arco de concordância perto da projeção do cursor na bissetriz.
    const mid = polar(r.arc.center, r.arc.start + ((r.arc.end - r.arc.start + 2 * Math.PI) % (2 * Math.PI)) / 2, r.radius);
    const d = (10 * info.bisector.x + 2 * info.bisector.y);
    assert.ok(close(distance(mid, { x: 0, y: 0 }), d, 1e-6), `${distance(mid, { x: 0, y: 0 })} vs ${d}`);
});
