import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operatorListToEntities, PT_TO_MM } from '../src/cad/pdfimport.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const closePoint = (p, q, tol = 1e-6) => close(p.x, q.x, tol) && close(p.y, q.y, tol);

// Mapa de operadores compatível com pdf.js (valores arbitrários, só precisam ser distintos).
const OPS = { save: 10, restore: 11, transform: 12, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, clip: 29, eoClip: 30, constructPath: 91, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };

test('vetorização de PDF: caminhos com transformação, retângulo, bézier e descarte de clip', () => {
    const fn = [];
    const args = [];
    // save; transform escala 2 e deslocamento (10,20); path: moveTo(0,0) lineTo(36,0) ; stroke
    fn.push(OPS.save); args.push([]);
    fn.push(OPS.transform); args.push([2, 0, 0, 2, 10, 20]);
    fn.push(OPS.constructPath); args.push([[OPS.moveTo, OPS.lineTo], [0, 0, 36, 0]]);
    fn.push(OPS.stroke); args.push([]);
    fn.push(OPS.restore); args.push([]);
    // retângulo em pontos: 72x72 pt = 25,4 mm
    fn.push(OPS.constructPath); args.push([[OPS.rectangle], [0, 0, 72, 72]]);
    fn.push(OPS.fill); args.push([]);
    // bézier achatada
    fn.push(OPS.constructPath); args.push([[OPS.moveTo, OPS.curveTo], [0, 0, 0, 50, 100, 50, 100, 0]]);
    fn.push(OPS.stroke); args.push([]);
    // caminho de clip é descartado
    fn.push(OPS.constructPath); args.push([[OPS.rectangle], [0, 0, 500, 500]]);
    fn.push(OPS.clip); args.push([]);
    fn.push(OPS.endPath); args.push([]);
    const entities = operatorListToEntities(fn, args, OPS);
    assert.equal(entities.length, 3);
    const [line, rect, curve] = entities;
    assert.equal(line.type, 'line');
    assert.ok(closePoint(line.start, { x: 10 * PT_TO_MM, y: 20 * PT_TO_MM }));
    assert.ok(closePoint(line.end, { x: (10 + 72) * PT_TO_MM, y: 20 * PT_TO_MM }));
    assert.equal(rect.type, 'polyline');
    assert.equal(rect.closed, true);
    assert.equal(rect.vertices.length, 4);
    assert.ok(close(rect.vertices[2].x, 25.4) && close(rect.vertices[2].y, 25.4));
    assert.equal(curve.type, 'polyline');
    assert.ok(curve.vertices.length > 8);
    assert.ok(closePoint(curve.vertices[curve.vertices.length - 1], { x: 100 * PT_TO_MM, y: 0 }));
    // ponto médio da bézier (t=0,5) fica em (50, 37,5) pt
    const mid = curve.vertices[Math.floor(curve.vertices.length / 2)];
    assert.ok(close(mid.x, 50 * PT_TO_MM, 0.5) && close(mid.y, 37.5 * PT_TO_MM, 0.5));
});

test('vetorização de PDF: form XObject aplica matriz e restaura; operadores soltos de caminho também funcionam', () => {
    const fn = [OPS.paintFormXObjectBegin, OPS.moveTo, OPS.lineTo, OPS.closeStroke, OPS.paintFormXObjectEnd, OPS.moveTo, OPS.lineTo, OPS.stroke];
    const args = [[[1, 0, 0, 1, 100, 0], [0, 0, 10, 10]], [0, 0], [10, 0], [], [], [0, 0], [10, 0], []];
    const entities = operatorListToEntities(fn, args, OPS, { unit: 1 });
    assert.equal(entities.length, 2);
    assert.ok(closePoint(entities[0].start, { x: 100, y: 0 }) && closePoint(entities[0].end, { x: 110, y: 0 }));
    assert.ok(closePoint(entities[1].start, { x: 0, y: 0 }));
});
