import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMeasurement, dimensionGeometry, defaultDimStyle } from '../src/cad/dimensions.js';

test('Tolerâncias industriais: formatação simétrica ±', () => {
    const style = { precision: 2, tolerance: { type: 'symmetrical', value: 0.1 } };
    assert.equal(formatMeasurement(50, style), '50 ±0.1');

    // Com precisão decimal
    assert.equal(formatMeasurement(25.4, { precision: 2, tolerance: 0.05 }), '25.4 ±0.05');
});

test('Tolerâncias industriais: desvios assimétricos (+ / -)', () => {
    const style = { precision: 2, tolerance: { type: 'deviation', upper: 0.05, lower: -0.02 } };
    assert.equal(formatMeasurement(100, style), '100 +0.05/-0.02');

    // Desvios positivos em ambos
    const stylePlus = { precision: 2, tolerance: { type: 'deviation', upper: 0.1, lower: 0.02 } };
    assert.equal(formatMeasurement(80, stylePlus), '80 +0.1/+0.02');
});

test('Tolerâncias industriais: limites máximo e mínimo (limits)', () => {
    const style = { precision: 2, tolerance: { type: 'limits', upper: 0.15, lower: -0.05 } };
    // 50 + 0.15 = 50.15, 50 - 0.05 = 49.95
    assert.equal(formatMeasurement(50, style), '50.15/49.95');
});

test('Prefixos e Sufixos: 4x ⌀, M8, (REF) e mm', () => {
    const style = { precision: 1 };
    assert.equal(formatMeasurement(12, style, '4x Ø', ' mm'), '4x Ø12 mm');
    assert.equal(formatMeasurement(50, style, '', ' (REF)'), '50 (REF)');
});

test('dimensionGeometry renderiza cota linear com tolerância e sufixo', () => {
    const entity = {
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 100, y: 0 },
        linePoint: { x: 0, y: 20 },
        prefix: '2x ',
        suffix: ' mm',
        tolerance: { type: 'symmetrical', value: 0.2 },
    };
    const geom = dimensionGeometry(entity, defaultDimStyle());
    assert.equal(geom.text, '2x 100 mm ±0.2');
    assert.equal(geom.texts.length, 1);
    assert.equal(geom.texts[0].text, '2x 100 mm ±0.2');
});

test('dimensionGeometry renderiza cota radial com tolerância', () => {
    const entity = {
        type: 'dimension',
        kind: 'diameter',
        center: { x: 50, y: 50 },
        radius: 10,
        linePoint: { x: 70, y: 50 },
        tolerance: { type: 'deviation', upper: 0.03, lower: -0.01 },
    };
    const geom = dimensionGeometry(entity, defaultDimStyle());
    assert.equal(geom.text, 'Ø20 +0.03/-0.01');
});
