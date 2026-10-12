import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dimensionGeometry, dimensionCurves, transformDimension } from '../src/cad/dimensions.js';
import { writeDxf } from '../src/cad/dxf.js';
import { createDocument, addEntities } from '../src/cad/document.js';

const close = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

test('cota angular mede ângulo reto (90 graus) entre dois eixos', () => {
    const dim = {
        type: 'dimension',
        kind: 'angular',
        vertex: { x: 0, y: 0 },
        p1: { x: 10, y: 0 },
        p2: { x: 0, y: 10 },
        linePoint: { x: 15, y: 15 },
    };
    const g = dimensionGeometry(dim, { textHeight: 2.5, arrowSize: 2.5, extOffset: 1, extBeyond: 2, precision: 1 });
    assert.equal(g.text, '90°');
    assert.ok(close(g.measurement, 90));
    assert.equal(g.arcs.length, 1);
    assert.ok(close(g.arcs[0].startAngle, 0));
    assert.ok(close(g.arcs[0].endAngle, Math.PI / 2));
    assert.equal(g.arrows.length, 2);
    assert.equal(g.texts.length, 1);
    assert.equal(g.texts[0].text, '90°');
});

test('cota angular mede chanfro ou ângulo de 45 graus', () => {
    const dim = {
        type: 'dimension',
        kind: 'angular',
        vertex: { x: 0, y: 0 },
        p1: { x: 20, y: 0 },
        p2: { x: 20, y: 20 },
        linePoint: { x: 10, y: 5 },
    };
    const g = dimensionGeometry(dim);
    assert.equal(g.text, '45°');
    assert.ok(close(g.measurement, 45));
    assert.equal(g.arcs.length, 1);
    assert.ok(close(g.arcs[0].startAngle, 0));
    assert.ok(close(g.arcs[0].endAngle, Math.PI / 4));
});

test('cota angular suporta textOverride customizado', () => {
    const dim = {
        type: 'dimension',
        kind: 'angular',
        vertex: { x: 0, y: 0 },
        p1: { x: 10, y: 0 },
        p2: { x: 0, y: 10 },
        linePoint: { x: 10, y: 10 },
        textOverride: '90° ± 0.5°',
    };
    const g = dimensionGeometry(dim);
    assert.equal(g.text, '90° ± 0.5°');
    assert.equal(g.texts[0].text, '90° ± 0.5°');
});

test('cota angular gera curvas para snap e hit test', () => {
    const dim = {
        type: 'dimension',
        kind: 'angular',
        vertex: { x: 0, y: 0 },
        p1: { x: 10, y: 0 },
        p2: { x: 0, y: 10 },
        linePoint: { x: 25, y: 25 },
    };
    const curves = dimensionCurves(dim);
    const arcCurve = curves.find((c) => c.kind === 'arc');
    assert.ok(arcCurve, 'deve conter o arco de cota nas curvas');
    assert.ok(close(arcCurve.radius, Math.hypot(25, 25)));
    const segments = curves.filter((c) => c.kind === 'segment');
    assert.ok(segments.length >= 6, 'segmentos de setas e linhas de extensão');
});

test('cota angular transforma com rotação e translação', () => {
    const dim = {
        type: 'dimension',
        kind: 'angular',
        vertex: { x: 0, y: 0 },
        p1: { x: 10, y: 0 },
        p2: { x: 0, y: 10 },
        linePoint: { x: 15, y: 15 },
    };
    // Transladar (100, 200)
    const shifted = transformDimension(dim, (p) => ({ x: p.x + 100, y: p.y + 200 }));
    assert.deepEqual(shifted.vertex, { x: 100, y: 200 });
    assert.deepEqual(shifted.p1, { x: 110, y: 200 });
    assert.deepEqual(shifted.p2, { x: 100, y: 210 });
    assert.deepEqual(shifted.linePoint, { x: 115, y: 215 });
    const g = dimensionGeometry(shifted);
    assert.equal(g.text, '90°');
    assert.deepEqual(g.arcs[0].center, { x: 100, y: 200 });
});

test('cota angular é exportada para DXF contendo ARC de cota', () => {
    const doc = addEntities(createDocument(), [{
        type: 'dimension',
        kind: 'angular',
        vertex: { x: 0, y: 0 },
        p1: { x: 10, y: 0 },
        p2: { x: 0, y: 10 },
        linePoint: { x: 15, y: 15 },
    }]);
    const dxf = writeDxf(doc);
    assert.ok(dxf.includes('ARC'), 'DXF deve incluir entidade ARC para o arco de cota');
    assert.ok(dxf.includes('SOLID'), 'DXF deve incluir SOLID para as setas');
    assert.ok(dxf.includes('90%%d'), 'DXF deve incluir o texto 90%%d codificado');
});
