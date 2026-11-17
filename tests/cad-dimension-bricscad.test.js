import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, addEntities, History } from '../src/cad/document.js';
import { COMMANDS, dimensionTarget } from '../src/cad/commands.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';

const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', layer: '0', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });

test('Dimensão usa a linha inteira mesmo com interseções dos dois lados', () => {
    const base = line('a', 0, 0, 100, 0);
    const others = [base, line('b', 30, -10, 30, 10), line('c', 70, -10, 70, 10), line('d', 85, -10, 85, 10)];
    assert.deepEqual(dimensionTarget(base, { x: 50, y: 0 }, others), { kind: 'auto', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, auto: 'linear' });
    const left = dimensionTarget(base, { x: 10, y: 0 }, others);
    assert.deepEqual([left.p1, left.p2], [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
});

test('Dimensão sem cruzamento cota a linha inteira; cota e texto não cortam', () => {
    const base = line('a', 0, 0, 100, 0);
    const dim = { id: 'x', type: 'dimension', kind: 'vertical', p1: { x: 50, y: -10 }, p2: { x: 50, y: 10 }, linePoint: { x: 50, y: 0 } };
    const t = dimensionTarget(base, { x: 50, y: 0 }, [base, dim]);
    assert.deepEqual([t.p1, t.p2], [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
});

test('Dimensão em polilinha usa o segmento clicado; círculo vira diâmetro', () => {
    const poly = { id: 'p', type: 'polyline', layer: '0', closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] };
    const t = dimensionTarget(poly, { x: 100, y: 20 }, [poly]);
    assert.deepEqual([t.p1, t.p2], [{ x: 100, y: 0 }, { x: 100, y: 50 }]);
    const circle = { id: 'c', type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: 5 };
    assert.equal(dimensionTarget(circle, { x: 5, y: 0 }, [circle]).kind, 'diameter');
});

test('DIMENSION: clique na linha e puxa a cota acima vira horizontal de ponta a ponta', async () => {
    let doc = createDocument();
    doc = addEntities(doc, [line(undefined, 0, 0, 100, 0), line(undefined, 40, -10, 40, 10)]);
    const target = doc.entities[0];
    const picks = [{ entity: target, point: { x: 80, y: 0 }, pickPoint: { x: 80, y: 0 } }, { enter: true }];
    const editor = {
        doc,
        history: new History(doc),
        selection: new Set(),
        memory: {},
        commit(desc, next) { this.doc = next; },
        log() {},
        async getPointOrEntity() { return picks.shift(); },
        async getPoint() { return { point: { x: 70, y: 20 } }; },
    };
    await COMMANDS.DIMENSION.run(editor);
    const dim = editor.doc.entities.find((e) => e.type === 'dimension');
    assert.ok(dim);
    assert.equal(dim.kind, 'horizontal');
    assert.equal(dimensionGeometry(dim, editor.doc.dimStyle).text, '100');
});

test('Dimensão preserva extremos inclinados, invertidos e transladados com cruzamentos', () => {
    for (const reverse of [false, true]) {
        const base = reverse ? line('a', 1030, 2040, 1000, 2000) : line('a', 1000, 2000, 1030, 2040);
        const others = [base, line('b', 990, 2010, 1050, 2010), line('c', 990, 2030, 1050, 2030)];
        for (const pick of [{ x: 1003, y: 2004 }, { x: 1015, y: 2020 }, { x: 1027, y: 2036 }]) {
            const target = dimensionTarget(base, pick, others);
            assert.deepEqual(target.p1, base.start);
            assert.deepEqual(target.p2, base.end);
            assert.equal(dimensionGeometry({ ...target, kind: 'aligned', linePoint: { x: 980, y: 2060 } }).text, '50');
        }
    }
});

test('Dimensão não recorta segmento de polilinha cruzado e preserva raios', () => {
    const poly = { id: 'p', type: 'polyline', closed: false, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] };
    const target = dimensionTarget(poly, { x: 50, y: 0 }, [poly, line('b', 30, -10, 30, 10)]);
    assert.deepEqual([target.p1, target.p2], [poly.vertices[0], poly.vertices[1]]);
    const arc = { type: 'arc', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI };
    assert.equal(dimensionTarget(arc, { x: 0, y: 5 }).kind, 'radius');
    assert.equal(dimensionTarget(line('zero', 0, 0, 0, 0), { x: 0, y: 0 }), null);
});
