import test from 'node:test';
import assert from 'node:assert/strict';
import { lengthenEntity } from '../src/cad/edit-tools.js';
import { distance, sweepCCW, entityLength } from '../src/cad/geometry.js';
import { writeDxf, parseDxf } from '../src/cad/dxf.js';
import { createDocument, addEntities } from '../src/cad/document.js';

const close = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;
const p = (x, y) => ({ x, y });

test('LENGTHEN: Line DElta (positivo e negativo na extremidade final e inicial)', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(100, 0) };

    // Clique mais próximo de 'end' (x=80): estende o fim
    const extendedEnd = lengthenEntity(line, p(80, 0), 'delta', 25);
    assert.deepEqual(extendedEnd.start, p(0, 0));
    assert.ok(close(extendedEnd.end.x, 125));
    assert.ok(close(extendedEnd.end.y, 0));
    assert.ok(close(distance(extendedEnd.start, extendedEnd.end), 125));

    // Clique mais próximo de 'start' (x=20): estende o início
    const extendedStart = lengthenEntity(line, p(20, 0), 'delta', 30);
    assert.deepEqual(extendedStart.end, p(100, 0));
    assert.ok(close(extendedStart.start.x, -30));
    assert.ok(close(extendedStart.start.y, 0));
    assert.ok(close(distance(extendedStart.start, extendedStart.end), 130));

    // Delta negativo encurta o fim
    const shortenedEnd = lengthenEntity(line, p(90, 0), 'delta', -40);
    assert.deepEqual(shortenedEnd.start, p(0, 0));
    assert.ok(close(shortenedEnd.end.x, 60));
    assert.ok(close(distance(shortenedEnd.start, shortenedEnd.end), 60));

    // Delta negativo encurta o início
    const shortenedStart = lengthenEntity(line, p(10, 0), 'delta', -35);
    assert.deepEqual(shortenedStart.end, p(100, 0));
    assert.ok(close(shortenedStart.start.x, 35));
    assert.ok(close(distance(shortenedStart.start, shortenedStart.end), 65));
});

test('LENGTHEN: Line Percent e Total', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(50, 0) };

    // 200% dobra o comprimento
    const p200 = lengthenEntity(line, p(40, 0), 'percent', 200);
    assert.ok(close(distance(p200.start, p200.end), 100));
    assert.ok(close(p200.end.x, 100));

    // 50% reduz pela metade a partir do início
    const p50 = lengthenEntity(line, p(10, 0), 'percent', 50);
    assert.ok(close(distance(p50.start, p50.end), 25));
    assert.ok(close(p50.start.x, 25));

    // Total 150
    const t150 = lengthenEntity(line, p(45, 0), 'total', 150);
    assert.ok(close(distance(t150.start, t150.end), 150));
    assert.ok(close(t150.end.x, 150));

    // Total 15 a partir do início
    const t15 = lengthenEntity(line, p(5, 0), 'total', 15);
    assert.ok(close(distance(t15.start, t15.end), 15));
    assert.ok(close(t15.start.x, 35));
});

test('LENGTHEN: Line DYnamic (projeção do cursor)', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(100, 0) };

    // Projeta cursor em (180, 50) estendendo o fim
    const dynEnd = lengthenEntity(line, p(80, 0), 'dynamic', p(180, 50));
    assert.deepEqual(dynEnd.start, p(0, 0));
    assert.ok(close(dynEnd.end.x, 180));
    assert.ok(close(dynEnd.end.y, 0));

    // Projeta cursor em (-50, 20) estendendo o início
    const dynStart = lengthenEntity(line, p(20, 0), 'dynamic', p(-50, 20));
    assert.deepEqual(dynStart.end, p(100, 0));
    assert.ok(close(dynStart.start.x, -50));
    assert.ok(close(dynStart.start.y, 0));
});

test('LENGTHEN: Arc DElta, Percent, Total e DYnamic', () => {
    // Arco com raio 50 de 0 a 90° (comprimento = 25 * PI ≈ 78.5398)
    const arc = { id: 'a1', type: 'arc', layer: '0', center: p(0, 0), radius: 50, start: 0, end: Math.PI / 2 };
    const pStart = p(50, 0);
    const pEnd = p(0, 50);

    // Delta positivo no fim: estende o ângulo final
    const deltaLen = 25 * (Math.PI / 2); // adiciona 45°
    const dEnd = lengthenEntity(arc, pEnd, 'delta', deltaLen);
    assert.ok(close(dEnd.start, 0));
    assert.ok(close(dEnd.end, (3 * Math.PI) / 4));
    assert.ok(close(sweepCCW(dEnd.start, dEnd.end) * 50, 50 * (3 * Math.PI / 4)));

    // Delta no início: estende o início no sentido horário (ângulo menor)
    const dStart = lengthenEntity(arc, pStart, 'delta', deltaLen);
    assert.ok(close(dStart.end, Math.PI / 2));
    assert.ok(close(sweepCCW(dStart.start, dStart.end), (3 * Math.PI) / 4));

    // Percent 200%: dobra o arco para 180°
    const pArc = lengthenEntity(arc, pEnd, 'percent', 200);
    assert.ok(close(pArc.start, 0));
    assert.ok(close(pArc.end, Math.PI));

    // Total correspondente a 180° (50 * PI)
    const tArc = lengthenEntity(arc, pEnd, 'total', 50 * Math.PI);
    assert.ok(close(tArc.start, 0));
    assert.ok(close(tArc.end, Math.PI));

    // DYnamic: cursor em (-50, 0) leva o fim a 180°
    const dyArc = lengthenEntity(arc, pEnd, 'dynamic', p(-50, 0));
    assert.ok(close(dyArc.end, Math.PI));
});

test('LENGTHEN: Polyline com segmentos de linha e bulge', () => {
    // Polilinha aberta: segmento reto (0,0)->(50,0), depois arco bulge 1 (semicírculo até (50,50))
    const poly = {
        id: 'pl1',
        type: 'polyline',
        closed: false,
        layer: '0',
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 50, y: 0, bulge: 1 },
            { x: 50, y: 50, bulge: 0 },
        ],
    };

    // Alonga a ponta final (arco) por delta 10
    const lenBefore = entityLength(poly);
    const modEnd = lengthenEntity(poly, p(50, 50), 'delta', 10);
    const lenAfter = entityLength(modEnd);
    assert.ok(close(lenAfter, lenBefore + 10));
    assert.deepEqual(modEnd.vertices[0], poly.vertices[0]);

    // Alonga a ponta inicial (segmento reto) por delta 20
    const modStart = lengthenEntity(poly, p(0, 0), 'delta', 20);
    assert.ok(close(entityLength(modStart), lenBefore + 20));
    assert.ok(close(modStart.vertices[0].x, -20));
    assert.ok(close(modStart.vertices[0].y, 0));
    assert.deepEqual(modStart.vertices[2], poly.vertices[2]);
});

test('LENGTHEN: Casos-limite e rejeições', () => {
    // Segmento de comprimento zero
    const zeroLine = { id: 'z1', type: 'line', layer: '0', start: p(10, 10), end: p(10, 10) };
    assert.throws(() => lengthenEntity(zeroLine, p(10, 10), 'delta', 10), /comprimento zero/);

    // Linha normal encurtada além de zero
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(50, 0) };
    assert.throws(() => lengthenEntity(line, p(50, 0), 'delta', -60), /maior que zero/);
    assert.throws(() => lengthenEntity(line, p(50, 0), 'total', -10), /maior que zero/);
    assert.throws(() => lengthenEntity(line, p(50, 0), 'percent', -50), /maior que zero/);

    // Polilinha fechada rejeitada
    const closedPoly = {
        id: 'cp1',
        type: 'polyline',
        closed: true,
        layer: '0',
        vertices: [p(0, 0), p(10, 0), p(10, 10)],
    };
    assert.throws(() => lengthenEntity(closedPoly, p(0, 0), 'delta', 10), /abertas/);

    // Círculo rejeitado
    const circle = { id: 'c1', type: 'circle', layer: '0', center: p(0, 0), radius: 20 };
    assert.throws(() => lengthenEntity(circle, p(20, 0), 'delta', 10), /abertas/);
});

test('LENGTHEN: Ida e volta em DXF das entidades alteradas', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(100, 0) };
    const extendedLine = lengthenEntity(line, p(100, 0), 'delta', 50);

    const arc = { id: 'a1', type: 'arc', layer: '0', center: p(0, 0), radius: 40, start: 0, end: Math.PI / 2 };
    const extendedArc = lengthenEntity(arc, p(0, 40), 'percent', 150);

    const poly = {
        id: 'pl1',
        type: 'polyline',
        closed: false,
        layer: '0',
        vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 50, y: 0, bulge: 0.5 }, { x: 80, y: 30, bulge: 0 }],
    };
    const extendedPoly = lengthenEntity(poly, p(0, 0), 'delta', 25);

    const doc = addEntities(createDocument(), [extendedLine, extendedArc, extendedPoly]);
    const dxfText = writeDxf(doc);
    const parsed = parseDxf(dxfText);

    // Comparar line
    const pLine = parsed.entities.find((e) => e.type === 'line');
    assert.ok(pLine);
    assert.ok(close(pLine.start.x, 0) && close(pLine.start.y, 0));
    assert.ok(close(pLine.end.x, 150) && close(pLine.end.y, 0));

    // Comparar arc
    const pArc = parsed.entities.find((e) => e.type === 'arc');
    assert.ok(pArc);
    assert.ok(close(pArc.radius, 40));
    assert.ok(close(pArc.start, 0));
    assert.ok(close(pArc.end, (3 * Math.PI) / 4));

    // Comparar polyline
    const pPoly = parsed.entities.find((e) => e.type === 'polyline');
    assert.ok(pPoly);
    assert.equal(pPoly.vertices.length, 3);
    assert.ok(close(pPoly.vertices[0].x, -25));
});
