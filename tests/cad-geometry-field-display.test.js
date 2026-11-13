// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryFields, geometryFieldDisplay, setGeometryField } from '../src/cad/edit-tools.js';

const show = (e) => Object.fromEntries(geometryFields(e).map((f) => [f.key, geometryFieldDisplay(f)]));

test('painel mostra o círculo com 4 casas, sem a cauda de ponto flutuante', () => {
    const circle = { id: 'c', type: 'circle', center: { x: 712.7668810826867, y: 480.37457420696625 }, radius: 24.999999999999996 };
    const v = show(circle);
    assert.equal(v['center.x'], '712.7669');
    assert.equal(v['center.y'], '480.3746');
    assert.equal(v.radius, '25');
    assert.equal(v.diameter, '50');
});

test('zeros à direita e -0 somem; razão e bulge ficam com 6 casas', () => {
    assert.equal(geometryFieldDisplay({ key: 'center.x', value: 100 }), '100');
    assert.equal(geometryFieldDisplay({ key: 'center.x', value: -0.00001 }), '0');
    assert.equal(geometryFieldDisplay({ key: 'ratio', value: 0.123456789 }), '0.123457');
    assert.equal(geometryFieldDisplay({ key: 'vertices.2.bulge', value: 0.41421356 }), '0.414214');
});

test('arredondar a exibição não altera a geometria salva', () => {
    const circle = { id: 'c', type: 'circle', center: { x: 1.23456789, y: 2 }, radius: 3.33333333 };
    show(circle);
    assert.equal(circle.radius, 3.33333333);
    const edited = setGeometryField(circle, 'diameter', '50');
    assert.equal(edited.radius, 25);
    assert.equal(edited.center.x, 1.23456789, 'campo não editado mantém precisão total');
});
