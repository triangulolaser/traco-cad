import test from 'node:test';
import assert from 'node:assert/strict';

import { getEntityGrips, applyGripMove, findGripAt, dimensionTextCenterSnap } from '../src/cad/grips.js';

test('getEntityGrips returns correct grips for line', () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const grips = getEntityGrips(line);

    assert.equal(grips.length, 3);
    assert.deepEqual(grips[0], { id: 'l1:start', entityId: 'l1', type: 'start', point: { x: 0, y: 0 } });
    assert.deepEqual(grips[1], { id: 'l1:mid', entityId: 'l1', type: 'mid', point: { x: 5, y: 0 } });
    assert.deepEqual(grips[2], { id: 'l1:end', entityId: 'l1', type: 'end', point: { x: 10, y: 0 } });
});

test('applyGripMove stretches line start, end, and moves whole line by mid', () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const grips = getEntityGrips(line);

    const startMoved = applyGripMove(line, grips[0], { x: -5, y: 5 });
    assert.deepEqual(startMoved.start, { x: -5, y: 5 });
    assert.deepEqual(startMoved.end, { x: 10, y: 0 });

    const endMoved = applyGripMove(line, grips[2], { x: 15, y: 5 });
    assert.deepEqual(endMoved.start, { x: 0, y: 0 });
    assert.deepEqual(endMoved.end, { x: 15, y: 5 });

    const midMoved = applyGripMove(line, grips[1], { x: 5, y: 10 });
    assert.deepEqual(midMoved.start, { x: 0, y: 10 });
    assert.deepEqual(midMoved.end, { x: 10, y: 10 });
});

test('getEntityGrips and applyGripMove for circle', () => {
    const circle = { id: 'c1', type: 'circle', center: { x: 10, y: 20 }, radius: 5 };
    const grips = getEntityGrips(circle);

    assert.equal(grips.length, 5);
    const centerGrip = grips.find((g) => g.type === 'center');
    const q0Grip = grips.find((g) => g.type === 'quadrant' && g.index === 0);
    assert.ok(centerGrip);
    assert.deepEqual(centerGrip.point, { x: 10, y: 20 });
    assert.deepEqual(q0Grip.point, { x: 15, y: 20 });

    // Moving center moves the circle
    const movedCircle = applyGripMove(circle, centerGrip, { x: 12, y: 22 });
    assert.deepEqual(movedCircle.center, { x: 12, y: 22 });
    assert.equal(movedCircle.radius, 5);

    // Moving quadrant resizes circle
    const resizedCircle = applyGripMove(circle, q0Grip, { x: 18, y: 20 });
    assert.equal(resizedCircle.radius, 8);
    assert.deepEqual(resizedCircle.center, { x: 10, y: 20 });
});

test('getEntityGrips and applyGripMove for arc', () => {
    // 90-degree arc from 0 to PI/2, radius 10 at (0,0)
    const arc = { id: 'a1', type: 'arc', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 };
    const grips = getEntityGrips(arc);

    assert.equal(grips.length, 4); // center, start, end, mid
    const startGrip = grips.find((g) => g.type === 'start');
    const endGrip = grips.find((g) => g.type === 'end');
    const midGrip = grips.find((g) => g.type === 'mid');
    const centerGrip = grips.find((g) => g.type === 'center');

    assert.ok(startGrip && endGrip && midGrip && centerGrip);
    assert.equal(Math.round(startGrip.point.x), 10);
    assert.equal(Math.round(startGrip.point.y), 0);
    assert.equal(Math.round(endGrip.point.x), 0);
    assert.equal(Math.round(endGrip.point.y), 10);

    // Adjusting start angle
    const startAdjusted = applyGripMove(arc, startGrip, { x: 0, y: -10 }); // angle -PI/2 = 3PI/2
    assert.ok(Math.abs(startAdjusted.start - (3 * Math.PI) / 2) < 1e-4);

    // Adjusting radius via mid grip
    const radiusAdjusted = applyGripMove(arc, midGrip, { x: 15, y: 15 });
    assert.ok(Math.abs(radiusAdjusted.radius - Math.hypot(15, 15)) < 1e-4);
});

test('alça da ponta do arco aumenta e diminui o raio passando pela outra ponta e pelo meio', () => {
    const arc = { id: 'a2', type: 'arc', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 };
    const grips = getEntityGrips(arc);
    const endGrip = grips.find((g) => g.type === 'end');
    const startPt = grips.find((g) => g.type === 'start').point;
    const midPt = grips.find((g) => g.type === 'mid').point;
    const onArc = (a, pt) => Math.abs(Math.hypot(pt.x - a.center.x, pt.y - a.center.y) - a.radius) < 1e-6;

    // Puxar a ponta para longe da corda abre o arco: raio maior.
    const bigger = applyGripMove(arc, endGrip, { x: -12, y: 4 });
    assert.ok(bigger.radius > arc.radius, `raio ${bigger.radius}`);
    assert.ok(onArc(bigger, startPt) && onArc(bigger, midPt) && onArc(bigger, { x: -12, y: 4 }));

    // Puxar para dentro fecha o arco: raio menor.
    const smaller = applyGripMove(arc, endGrip, { x: 1, y: 8 });
    assert.ok(smaller.radius < arc.radius, `raio ${smaller.radius}`);
    assert.ok(onArc(smaller, startPt) && onArc(smaller, midPt));

    // Ponta alinhada com a outra ponta e o meio: mantém o raio e só gira o ângulo.
    const aligned = applyGripMove(arc, endGrip, { x: 10 + (midPt.x - 10) * 2, y: midPt.y * 2 });
    assert.equal(aligned.radius, arc.radius);
});

test('getEntityGrips and applyGripMove for polyline', () => {
    const poly = {
        id: 'p1',
        type: 'polyline',
        vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
        ],
    };
    const grips = getEntityGrips(poly);
    assert.equal(grips.length, 3);
    assert.equal(grips[1].index, 1);

    const vertexMoved = applyGripMove(poly, grips[1], { x: 15, y: 5 });
    assert.deepEqual(vertexMoved.vertices[0], { x: 0, y: 0 });
    assert.deepEqual(vertexMoved.vertices[1], { x: 15, y: 5 });
    assert.deepEqual(vertexMoved.vertices[2], { x: 10, y: 10 });
});

test('getEntityGrips and applyGripMove for dimensions (including angular)', () => {
    const dimAngular = {
        id: 'd1',
        type: 'dimension',
        dimType: 'angular',
        vertex: { x: 0, y: 0 },
        p1: { x: 10, y: 0 },
        p2: { x: 0, y: 10 },
        linePoint: { x: 7, y: 7 },
    };
    const grips = getEntityGrips(dimAngular);
    assert.equal(grips.length, 4);

    const linePointGrip = grips.find((g) => g.type === 'linePoint');
    const vertexGrip = grips.find((g) => g.type === 'vertex');
    assert.ok(linePointGrip && vertexGrip);

    const movedLinePoint = applyGripMove(dimAngular, linePointGrip, { x: 12, y: 12 });
    assert.deepEqual(movedLinePoint.linePoint, { x: 12, y: 12 });
    assert.deepEqual(movedLinePoint.vertex, { x: 0, y: 0 });

    const movedVertex = applyGripMove(dimAngular, vertexGrip, { x: 2, y: 2 });
    assert.deepEqual(movedVertex.vertex, { x: 2, y: 2 });
});

test('findGripAt detects grip within tolerance and rejects beyond', () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const grips = getEntityGrips(line);
    // Identity screen conversion
    const worldToScreen = (p) => ({ x: p.x, y: p.y });

    const hit = findGripAt(grips, { x: 2, y: 3 }, worldToScreen, 8);
    assert.ok(hit);
    assert.equal(hit.id, 'l1:start');

    const miss = findGripAt(grips, { x: 20, y: 30 }, worldToScreen, 8);
    assert.equal(miss, null);
});

test('alças somem acima de GRIP_OBJECT_LIMIT objetos selecionados', async () => {
    const { gripsVisible, GRIP_OBJECT_LIMIT } = await import('../src/cad/grips.js');
    assert.equal(gripsVisible(0), false);
    assert.equal(gripsVisible(1), true);
    assert.equal(gripsVisible(GRIP_OBJECT_LIMIT), true);
    assert.equal(gripsVisible(GRIP_OBJECT_LIMIT + 1), false);
});

test('cota importada: alça da linha leva o texto junto e o texto tem alça própria', () => {
    // Cota vertical do ITEM 10 REFERENCIA (DWG do SolidWorks): texto com posição gravada.
    const dim = { id: 'd1', type: 'dimension', kind: 'vertical', p1: { x: 95.8, y: 162 }, p2: { x: 95.8, y: 251.5 }, linePoint: { x: 145.7, y: 251.5 }, textPosition: { x: 145.7, y: 205.8 } };
    const grips = getEntityGrips(dim);
    const line = grips.find((g) => g.type === 'linePoint');
    const moved = applyGripMove(dim, line, { x: 175.7, y: 240 });
    assert.deepEqual(moved.linePoint, { x: 175.7, y: 240 });
    assert.ok(Math.abs(moved.textPosition.x - 175.7) < 1e-9);
    assert.ok(Math.abs(moved.textPosition.y - 205.8) < 1e-9, 'ao longo da linha o texto fica onde estava');

    const text = grips.find((g) => g.type === 'textPosition');
    assert.ok(text);
    const byText = applyGripMove(dim, text, { x: 150, y: 190 });
    assert.deepEqual(byText.textPosition, { x: 150, y: 190 });
    assert.ok(Math.abs(byText.linePoint.x - 150) < 1e-9, 'a linha de cota acompanha o texto');
    assert.ok(Math.abs(byText.linePoint.y - 251.5) < 1e-9);

    const rotated = { ...dim, kind: 'rotated', rotation: 0, linePoint: { x: 0, y: 10 }, textPosition: { x: 5, y: 10 } };
    const r = applyGripMove(rotated, getEntityGrips(rotated).find((g) => g.type === 'linePoint'), { x: 3, y: 14 });
    assert.ok(Math.abs(r.textPosition.x - 5) < 1e-9 && Math.abs(r.textPosition.y - 14) < 1e-9);

    const plain = { id: 'd2', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, linePoint: { x: 0, y: 5 } };
    assert.equal(applyGripMove(plain, getEntityGrips(plain)[0], { x: 0, y: 8 }).textPosition, undefined);
});

test('texto da cota encaixa no centro da medida mantendo o afastamento', () => {
    const dim = { type: 'dimension', kind: 'vertical', p1: { x: 95.8, y: 162 }, p2: { x: 95.8, y: 251.5 }, linePoint: { x: 145.7, y: 251.5 } };
    assert.deepEqual(dimensionTextCenterSnap(dim, { x: 150, y: 208 }, 2), { x: 150, y: 206.75 });
    assert.equal(dimensionTextCenterSnap(dim, { x: 150, y: 230 }, 2), null);
    assert.equal(dimensionTextCenterSnap({ ...dim, kind: 'radius' }, { x: 150, y: 207 }, 2), null);
});

test('cota linear: alça da seta põe as setas por fora ou por dentro', async () => {
    const { dimensionGeometry, defaultDimStyle } = await import('../src/cad/dimensions.js');
    const dim = { id: 'd9', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 35.49, y: 0 }, linePoint: { x: 10, y: 10 } };
    const grips = getEntityGrips(dim);
    const a1 = grips.find((g) => g.id === 'd9:arrow1');
    const a2 = grips.find((g) => g.id === 'd9:arrow2');
    assert.deepEqual(a1.point, { x: 0, y: 10 });
    assert.deepEqual(a2.point, { x: 35.49, y: 10 });
    // linePoint coincidente com a seta continua sendo a alça escolhida.
    const onLine = { ...dim, linePoint: { x: 35.49, y: 10 } };
    assert.equal(findGripAt(getEntityGrips(onLine), { x: 35.49, y: 10 }, (p) => p, 8).type, 'linePoint');

    const out = applyGripMove(dim, a1, { x: -5, y: 10 });
    assert.equal(out.arrowPlacement, 'outside');
    assert.equal(applyGripMove(dim, a2, { x: 40, y: 12 }).arrowPlacement, 'outside');
    assert.equal(applyGripMove(out, a2, { x: 30, y: 10 }).arrowPlacement, 'inside');
    assert.equal(applyGripMove(dim, a1, a1.point), dim);

    const style = defaultDimStyle();
    const tipX = (g) => g.arrows.map((tri) => Math.min(...tri.map((p) => p.x)));
    // Por dentro o corpo da 1ª seta fica à direita da ponta (x ≥ 0); por fora, à esquerda.
    assert.ok(tipX(dimensionGeometry(dim, style))[0] >= 0);
    assert.ok(tipX(dimensionGeometry(out, style))[0] < 0);
    const short = { ...dim, p2: { x: 5, y: 0 } };
    assert.ok(tipX(dimensionGeometry(short, style))[0] < 0);
    assert.ok(tipX(dimensionGeometry({ ...short, arrowPlacement: 'inside' }, style))[0] >= 0);
});

test('cota linear: alça no meio da linha sob o número arrasta o texto para o outro lado', async () => {
    const { dimensionGeometry, defaultDimStyle } = await import('../src/cad/dimensions.js');
    const style = defaultDimStyle();
    const dim = { id: 'd8', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, linePoint: { x: 0, y: 10 } };
    const g = getEntityGrips(dim, style).find((x) => x.type === 'textAlong');
    assert.ok(Math.abs(g.point.x - 20) < 1e-9 && Math.abs(g.point.y - 10) < 1e-9);
    const moved = applyGripMove(dim, g, { x: -15, y: 10 });
    const t = dimensionGeometry(moved, style).texts[0];
    const before = dimensionGeometry(dim, style).texts[0];
    assert.ok(Math.abs(t.position.y - before.position.y) < 1e-6);
    assert.ok(t.position.x < 0);
    assert.equal(moved.linePoint.y, 10);
    const g2 = getEntityGrips(moved, style).find((x) => x.type === 'textAlong');
    assert.ok(Math.abs(g2.point.x + 15) < 1e-6 && Math.abs(g2.point.y - 10) < 1e-6);
    assert.equal(applyGripMove(dim, g, { x: 20, y: 18 }).linePoint.y, 18);
});
