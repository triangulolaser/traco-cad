import test from 'node:test';
import assert from 'node:assert/strict';

import { getEntityGrips, applyGripMove, findGripAt } from '../src/cad/grips.js';

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
