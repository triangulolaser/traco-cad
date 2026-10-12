import test from 'node:test';
import assert from 'node:assert/strict';
import {
    convertEntityToPolyline,
    setPolylineWidth,
    setPolylineClosed,
    reversePolyline,
    fitPolyline,
    splinePolyline,
    decurvePolyline,
    joinToPolyline,
} from '../src/cad/edit-tools.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { writeDxf, parseDxf } from '../src/cad/dxf.js';
import { distance, sweepCCW } from '../src/cad/geometry.js';

const p = (x, y) => ({ x, y });
const close = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

test('PEDIT: Conversão de Line e Arc em Polyline', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(10, 0) };
    const polyFromLine = convertEntityToPolyline(line);
    assert.equal(polyFromLine.type, 'polyline');
    assert.equal(polyFromLine.closed, false);
    assert.equal(polyFromLine.vertices.length, 2);
    assert.deepEqual(polyFromLine.vertices[0], { x: 0, y: 0, bulge: 0 });
    assert.deepEqual(polyFromLine.vertices[1], { x: 10, y: 0, bulge: 0 });

    // Semicírculo de raio 10 (de 0 a PI)
    const arc = { id: 'a1', type: 'arc', layer: '0', center: p(0, 0), radius: 10, start: 0, end: Math.PI };
    const polyFromArc = convertEntityToPolyline(arc);
    assert.equal(polyFromArc.type, 'polyline');
    assert.equal(polyFromArc.closed, false);
    assert.equal(polyFromArc.vertices.length, 2);
    // Para 180°, bulge = tan(PI/4) = 1
    assert.ok(close(polyFromArc.vertices[0].bulge, 1));
    assert.ok(close(polyFromArc.vertices[0].x, 10));
    assert.ok(close(polyFromArc.vertices[0].y, 0));
    assert.ok(close(polyFromArc.vertices[1].x, -10));
    assert.ok(close(polyFromArc.vertices[1].y, 0));
});

test('PEDIT: Fechar e Abrir Polilinha (Close / Open)', () => {
    const openPoly = {
        id: 'p1',
        type: 'polyline',
        layer: '0',
        closed: false,
        vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }],
    };

    const closed = setPolylineClosed(openPoly, true);
    assert.equal(closed.closed, true);

    const reOpened = setPolylineClosed(closed, false);
    assert.equal(reOpened.closed, false);
});

test('PEDIT: Definir Largura Constante (Width)', () => {
    const poly = {
        id: 'p1',
        type: 'polyline',
        layer: '0',
        closed: false,
        vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }],
    };

    const withWidth = setPolylineWidth(poly, 2.5);
    assert.equal(withWidth.constantWidth, 2.5);

    const zeroWidth = setPolylineWidth(withWidth, 0);
    assert.equal(zeroWidth.constantWidth, undefined);

    assert.throws(() => setPolylineWidth(poly, -1), /largura deve ser um número não negativo/i);
});

test('PEDIT: Inverter Polilinha (Reverse) preservando geometria reta e em arco', () => {
    // Polilinha reta
    const straight = {
        id: 'p1',
        type: 'polyline',
        layer: '0',
        closed: false,
        vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 20, bulge: 0 }],
    };
    const revStraight = reversePolyline(straight);
    assert.deepEqual(revStraight.vertices[0], { x: 10, y: 20, bulge: 0 });
    assert.deepEqual(revStraight.vertices[1], { x: 10, y: 0, bulge: 0 });
    assert.deepEqual(revStraight.vertices[2], { x: 0, y: 0, bulge: 0 });

    // Polilinha com arco (bulge = 1 de (0,0) a (10,0))
    const curved = {
        id: 'p2',
        type: 'polyline',
        layer: '0',
        closed: false,
        vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 0 }],
    };
    const revCurved = reversePolyline(curved);
    assert.equal(revCurved.vertices.length, 2);
    assert.equal(revCurved.vertices[0].x, 10);
    assert.equal(revCurved.vertices[0].y, 0);
    // Ao inverter o sentido da curva, o sinal do bulge inverte (-1)
    assert.ok(close(revCurved.vertices[0].bulge, -1));
    assert.equal(revCurved.vertices[1].x, 0);
    assert.equal(revCurved.vertices[1].y, 0);
    assert.equal(revCurved.vertices[1].bulge, 0);
});

test('PEDIT: Ajustar com Arcos Tangentes (Fit) e Suavizar com B-Spline (Spline) e Decurvar (Decurve)', () => {
    const poly = {
        id: 'p1',
        type: 'polyline',
        layer: '0',
        closed: false,
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 10, bulge: 0 },
            { x: 20, y: 0, bulge: 0 },
            { x: 30, y: 10, bulge: 0 },
        ],
    };

    // Fit calcula arcos tangentes suaves
    const fitted = fitPolyline(poly);
    assert.equal(fitted.vertices.length, 4);
    assert.ok(fitted.vertices.some((v) => Math.abs(v.bulge) > 1e-4), 'Deveria conter bulges não-nulos calculados');

    // Spline gera amostragem suave
    const splined = splinePolyline(poly);
    assert.ok(splined.vertices.length > poly.vertices.length, 'Spline deveria gerar vértices amostrados adicionais');

    // Decurve restaura os vértices retos originais
    const decurved = decurvePolyline(splined);
    assert.equal(decurved.vertices.length, 4);
    assert.ok(decurved.vertices.every((v) => v.bulge === 0));
    assert.equal(decurved.vertices[0].x, 0);
    assert.equal(decurved.vertices[3].x, 30);
});

test('PEDIT: Unir (Join) linhas e arcos conectados à polilinha', () => {
    const basePoly = {
        id: 'p1',
        type: 'polyline',
        layer: '0',
        closed: false,
        vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }],
    };

    const l2 = { id: 'l2', type: 'line', layer: '0', start: p(10, 0), end: p(10, 10) };
    const l3 = { id: 'l3', type: 'line', layer: '0', start: p(10, 10), end: p(0, 10) };
    const disconnected = { id: 'l4', type: 'line', layer: '0', start: p(100, 100), end: p(200, 100) };

    const res = joinToPolyline(basePoly, [l2, l3, disconnected]);
    assert.equal(res.joinedIds.length, 2);
    assert.ok(res.joinedIds.includes('l2'));
    assert.ok(res.joinedIds.includes('l3'));
    assert.ok(!res.joinedIds.includes('l4'));

    assert.equal(res.polyline.vertices.length, 4);
    assert.deepEqual(res.polyline.vertices[0], { x: 0, y: 0, bulge: 0 });
    assert.deepEqual(res.polyline.vertices[1], { x: 10, y: 0, bulge: 0 });
    assert.deepEqual(res.polyline.vertices[2], { x: 10, y: 10, bulge: 0 });
    assert.deepEqual(res.polyline.vertices[3], { x: 0, y: 10, bulge: 0 });
    assert.equal(res.polyline.closed, false);
});

test('PEDIT: Unir (Join) com fechamento automático ao encontrar extremidade inicial', () => {
    const basePoly = {
        id: 'p1',
        type: 'polyline',
        layer: '0',
        closed: false,
        vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }],
    };

    // Linha de retorno ao início (0, 0)
    const closingLine = { id: 'l_close', type: 'line', layer: '0', start: p(10, 10), end: p(0, 0) };

    const res = joinToPolyline(basePoly, [closingLine]);
    assert.equal(res.joinedIds.length, 1);
    assert.equal(res.polyline.closed, true);
    assert.equal(res.polyline.vertices.length, 3);
});

test('PEDIT: Ida e volta em DXF de polilinha com Width e Bulge', () => {
    const poly = {
        id: 'p_dxf',
        type: 'polyline',
        layer: '0',
        closed: true,
        constantWidth: 3.5,
        vertices: [
            { x: 0, y: 0, bulge: 0.5 },
            { x: 50, y: 0, bulge: 0 },
            { x: 50, y: 50, bulge: 0 },
        ],
    };

    const doc = addEntities(createDocument(), [poly]);
    const dxfText = writeDxf(doc);
    assert.match(dxfText, /\n43\n3\.5\n/, 'DXF deve conter o código de grupo 43 com a largura constante');

    const parsed = parseDxf(dxfText);
    const back = parsed.entities.find((e) => e.type === 'polyline');
    assert.ok(back);
    assert.equal(back.constantWidth, 3.5);
    assert.equal(back.closed, true);
    assert.equal(back.vertices.length, 3);
    assert.ok(close(back.vertices[0].bulge, 0.5));
});
