import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    intersectSegments,
    intersectLineCircle,
    intersectCircles,
    intersectCurves,
    arcFromThreePoints,
    bulgeToArc,
    polylineCurves,
    offsetEntity,
    splitEntityAt,
    rotateEntity,
    mirrorEntity,
    entityBox,
    curveIntersectsBox,
    angleInArc,
    perpendicularFoot,
    entityLength,
    distance,
} from '../src/cad/geometry.js';
import { parsePointInput, parseNumberInput, matchKeyword, splitCommandLine } from '../src/cad/input.js';
import { History, createDocument, addEntities, removeEntities, replaceEntities, setCurrentLayer, entityColor } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { findSnap, findCenterHints, applyOrtho, applyPolar, defaultSnapSettings } from '../src/cad/snaps.js';
import { wheelZoomFactor } from '../src/cad/editor.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const closePoint = (p, q, tol = 1e-6) => close(p.x, q.x, tol) && close(p.y, q.y, tol);

test('interseção de segmentos, reta-círculo e círculo-círculo', () => {
    const hit = intersectSegments({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
    assert.ok(closePoint(hit, { x: 5, y: 5 }));
    assert.equal(intersectSegments({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 4 }), null);
    assert.equal(intersectSegments({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), null, 'paralelas');

    const lc = intersectLineCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5);
    assert.equal(lc.length, 2);
    assert.ok(closePoint(lc[0].point, { x: -5, y: 0 }));
    assert.ok(closePoint(lc[1].point, { x: 5, y: 0 }));
    assert.equal(intersectLineCircle({ x: -10, y: 5 }, { x: 10, y: 5 }, { x: 0, y: 0 }, 5).length, 1, 'tangente');
    assert.equal(intersectLineCircle({ x: -10, y: 6 }, { x: 10, y: 6 }, { x: 0, y: 0 }, 5).length, 0);

    const cc = intersectCircles({ x: 0, y: 0 }, 5, { x: 6, y: 0 }, 5);
    assert.equal(cc.length, 2);
    assert.ok(close(cc[0].x, 3) && close(Math.abs(cc[0].y), 4));
    assert.equal(intersectCircles({ x: 0, y: 0 }, 5, { x: 20, y: 0 }, 5).length, 0);
});

test('interseção respeita extensão de arcos e segmentos', () => {
    const arc = { kind: 'arc', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI / 2 };
    const seg = { kind: 'segment', a: { x: -10, y: 0 }, b: { x: 10, y: 0 } };
    const hits = intersectCurves(seg, arc);
    assert.equal(hits.length, 1);
    assert.ok(closePoint(hits[0], { x: 5, y: 0 }));
    const short = { kind: 'segment', a: { x: 6, y: 0 }, b: { x: 10, y: 0 } };
    assert.equal(intersectCurves(short, arc).length, 0);
    assert.equal(intersectCurves(short, arc, { extend1: true }).length, 1);
});

test('arco por três pontos mantém o ponto do meio dentro do arco', () => {
    const arc = arcFromThreePoints({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 });
    assert.ok(closePoint(arc.center, { x: 0, y: 0 }));
    assert.ok(close(arc.radius, 5));
    assert.ok(angleInArc(Math.PI / 2, arc.start, arc.end));
    assert.ok(!angleInArc(-Math.PI / 2, arc.start, arc.end));

    const reversed = arcFromThreePoints({ x: 5, y: 0 }, { x: 0, y: -5 }, { x: -5, y: 0 });
    assert.ok(angleInArc(-Math.PI / 2, reversed.start, reversed.end));
    assert.ok(!angleInArc(Math.PI / 2, reversed.start, reversed.end));
    assert.equal(arcFromThreePoints({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
});

test('bulge de polilinha vira arco com centro e sentido corretos', () => {
    // Bulge positivo = arco anti-horário do vértice inicial ao final. De (0,0) a (10,0) em torno de (5,0)
    // o percurso anti-horário passa por baixo, em (5,-5). Convenção DXF/AutoCAD.
    const arc = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    assert.ok(closePoint(arc.center, { x: 5, y: 0 }));
    assert.ok(close(arc.radius, 5));
    assert.ok(angleInArc((3 * Math.PI) / 2, arc.start, arc.end));
    assert.ok(!angleInArc(Math.PI / 2, arc.start, arc.end));
    const cw = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, -1);
    assert.ok(angleInArc(Math.PI / 2, cw.start, cw.end));
    // Bulge pequeno positivo: centro fica à esquerda da direção a→b, arco abaulado para a direita.
    const small = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5);
    assert.ok(small.center.y > 0);
    const curves = polylineCurves([{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }], true);
    assert.deepEqual(curves.map((c) => c.kind), ['arc', 'segment', 'segment']);
});

test('offset de linha, círculo e retângulo', () => {
    const line = { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const up = offsetEntity(line, 2, { x: 5, y: 5 });
    assert.ok(closePoint(up.start, { x: 0, y: 2 }) && closePoint(up.end, { x: 10, y: 2 }));
    const down = offsetEntity(line, 2, { x: 5, y: -5 });
    assert.ok(closePoint(down.start, { x: 0, y: -2 }));
    const circle = { type: 'circle', center: { x: 0, y: 0 }, radius: 5 };
    assert.ok(close(offsetEntity(circle, 1, { x: 10, y: 0 }).radius, 6));
    assert.ok(close(offsetEntity(circle, 1, { x: 0, y: 0 }).radius, 4));
    assert.equal(offsetEntity(circle, 6, { x: 0, y: 0 }), null);

    const rect = { type: 'polyline', closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }, { x: 0, y: 10, bulge: 0 }] };
    const inner = offsetEntity(rect, 1, { x: 5, y: 5 });
    assert.equal(inner.vertices.length, 4);
    assert.ok(closePoint(inner.vertices[0], { x: 1, y: 1 }));
    assert.ok(closePoint(inner.vertices[2], { x: 9, y: 9 }));
    const outer = offsetEntity(rect, 1, { x: -5, y: 5 });
    assert.ok(closePoint(outer.vertices[0], { x: -1, y: -1 }));
});

test('split de linha, círculo e arco nos pontos de corte', () => {
    const line = { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    const parts = splitEntityAt(line, [{ x: 4, y: 0 }, { x: 8, y: 0 }]);
    assert.equal(parts.length, 3);
    assert.ok(closePoint(parts[1].start, { x: 4, y: 0 }) && closePoint(parts[1].end, { x: 8, y: 0 }));
    const circle = { type: 'circle', center: { x: 0, y: 0 }, radius: 5, layer: '0' };
    const arcs = splitEntityAt(circle, [{ x: 5, y: 0 }, { x: -5, y: 0 }]);
    assert.equal(arcs.length, 2);
    assert.ok(arcs.every((a) => a.type === 'arc'));
    const arc = { type: 'arc', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI, layer: '0' };
    const arcParts = splitEntityAt(arc, [{ x: 0, y: 5 }]);
    assert.equal(arcParts.length, 2);
    assert.ok(close(arcParts[0].end, Math.PI / 2));
});

test('rotação e espelhamento preservam geometria de arcos', () => {
    const arc = { type: 'arc', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI / 2 };
    const rotated = rotateEntity(arc, { x: 0, y: 0 }, Math.PI / 2);
    assert.ok(close(rotated.start, Math.PI / 2) && close(rotated.end, Math.PI));
    const mirrored = mirrorEntity(arc, { x: 0, y: 0 }, { x: 0, y: 1 });
    // Espelhado no eixo Y: arco de 90° a 180° (CCW), continua com ponto médio em 135°.
    assert.ok(angleInArc((3 * Math.PI) / 4, mirrored.start, mirrored.end));
    assert.ok(!angleInArc(Math.PI / 4, mirrored.start, mirrored.end));
    assert.ok(close(entityLength(arc), (Math.PI / 2) * 5));
});

test('bounding box e seleção crossing', () => {
    const arc = { type: 'arc', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI / 2 };
    const box = entityBox(arc);
    assert.ok(close(box.minX, 0) && close(box.maxX, 5) && close(box.minY, 0) && close(box.maxY, 5));
    const seg = { kind: 'segment', a: { x: -10, y: 5 }, b: { x: 10, y: 5 } };
    assert.ok(curveIntersectsBox(seg, { minX: 0, minY: 0, maxX: 2, maxY: 10 }));
    assert.ok(!curveIntersectsBox(seg, { minX: 0, minY: 6, maxX: 2, maxY: 10 }));
    const foot = perpendicularFoot({ x: 5, y: 7 }, { kind: 'segment', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    assert.ok(closePoint(foot, { x: 5, y: 0 }));
});

test('entrada de coordenadas absoluta, relativa e polar', () => {
    assert.deepEqual(parsePointInput('10,20').point, { x: 10, y: 20 });
    assert.deepEqual(parsePointInput('@5,-3', { last: { x: 10, y: 20 } }).point, { x: 15, y: 17 });
    const polarRel = parsePointInput('@10<90', { last: { x: 0, y: 0 } }).point;
    assert.ok(closePoint(polarRel, { x: 0, y: 10 }));
    const polarAbs = parsePointInput('10<0').point;
    assert.ok(closePoint(polarAbs, { x: 10, y: 0 }));
    assert.ok(parsePointInput('@1,1').error);
    assert.equal(parsePointInput('abc'), null);
    assert.equal(parseNumberInput('12.5'), 12.5);
    assert.equal(parseNumberInput('x'), null);
    const options = [{ key: 'c', label: 'Close' }, { key: 'u', label: 'Undo' }];
    assert.equal(matchKeyword('c', options).key, 'c');
    assert.equal(matchKeyword('clo', options).key, 'c');
    assert.equal(matchKeyword('z', options), null);
    assert.deepEqual(splitCommandLine('  line  1,2 '), { name: 'LINE', args: ['1,2'] });
});

test('histórico de documento faz undo e redo linear', () => {
    const history = new History(createDocument());
    history.commit('linha', addEntities(history.present, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]));
    history.commit('círculo', addEntities(history.present, [{ type: 'circle', center: { x: 0, y: 0 }, radius: 1 }]));
    assert.equal(history.present.entities.length, 2);
    assert.equal(history.undo(), 'círculo');
    assert.equal(history.present.entities.length, 1);
    assert.equal(history.redo(), 'círculo');
    assert.equal(history.present.entities.length, 2);
    history.undo();
    history.commit('apaga', removeEntities(history.present, [history.present.entities[0].id]));
    assert.equal(history.canRedo(), false);
    assert.equal(history.present.entities.length, 0);
});

test('replaceEntities preserva o id do primeiro fragmento e cria novos para os demais', () => {
    let doc = addEntities(createDocument(), [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const id = doc.entities[0].id;
    doc = replaceEntities(doc, new Map([[id, splitEntityAt(doc.entities[0], [{ x: 5, y: 0 }])]]));
    assert.equal(doc.entities.length, 2);
    assert.equal(doc.entities[0].id, id);
    assert.notEqual(doc.entities[1].id, id);
    doc = setCurrentLayer(doc, 'CORTE');
    assert.equal(doc.currentLayer, 'CORTE');
    assert.equal(doc.layers.length, 2);
    doc = addEntities(doc, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }]);
    assert.equal(doc.entities[2].layer, 'CORTE');
    assert.equal(entityColor(doc.entities[2], doc), '#ffffff');
});

test('DXF: roundtrip de entidades, layers e bulge', () => {
    let doc = createDocument();
    doc = setCurrentLayer(doc, 'CORTE');
    doc = addEntities(doc, [
        { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 50.5 } },
        { type: 'circle', center: { x: 10, y: 10 }, radius: 7.25 },
        { type: 'arc', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI / 2 },
        { type: 'polyline', closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 1 }, { x: 10, y: 10, bulge: 0 }] },
        { type: 'text', position: { x: 1, y: 2 }, height: 3.5, rotation: 15, text: 'Ø12 ±0.1' },
    ]);
    const text = writeDxf(doc);
    assert.match(text, /AC1015/);
    assert.match(text, /\n2\nCORTE\n/);
    const parsed = parseDxf(text);
    assert.equal(parsed.entities.length, 5);
    assert.deepEqual(parsed.entities.map((e) => e.type), ['line', 'circle', 'arc', 'polyline', 'text']);
    assert.ok(closePoint(parsed.entities[0].end, { x: 100, y: 50.5 }));
    assert.ok(close(parsed.entities[1].radius, 7.25));
    assert.ok(close(parsed.entities[2].end, Math.PI / 2));
    assert.equal(parsed.entities[3].closed, true);
    assert.ok(close(parsed.entities[3].vertices[1].bulge, 1));
    assert.equal(parsed.entities[4].text, 'Ø12 ±0.1');
    assert.ok(close(parsed.entities[4].rotation, 15));
    assert.ok(parsed.layers.some((l) => l.name === 'CORTE'));
    assert.ok(parsed.entities.every((e) => e.layer === 'CORTE'));
});

test('DXF: lê POLYLINE/VERTEX legado, INSERT de bloco e MTEXT', () => {
    const dxf = [
        '0', 'SECTION', '2', 'BLOCKS',
        '0', 'BLOCK', '8', '0', '2', 'FURO', '10', '0', '20', '0',
        '0', 'CIRCLE', '8', '0', '10', '0', '20', '0', '40', '2',
        '0', 'ENDBLK',
        '0', 'ENDSEC',
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'POLYLINE', '8', 'A', '70', '1',
        '0', 'VERTEX', '8', 'A', '10', '0', '20', '0',
        '0', 'VERTEX', '8', 'A', '10', '5', '20', '0',
        '0', 'VERTEX', '8', 'A', '10', '5', '20', '5',
        '0', 'SEQEND',
        '0', 'INSERT', '8', 'B', '2', 'FURO', '10', '20', '20', '30', '41', '2', '42', '2',
        '0', 'MTEXT', '8', 'A', '10', '1', '20', '1', '40', '2', '1', '{\\fArial;Peça\\P123}',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');
    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 3);
    const [poly, circle, mtext] = parsed.entities;
    assert.equal(poly.type, 'polyline');
    assert.equal(poly.closed, true);
    assert.equal(poly.vertices.length, 3);
    assert.equal(circle.type, 'circle');
    assert.ok(closePoint(circle.center, { x: 20, y: 30 }));
    assert.ok(close(circle.radius, 4));
    assert.equal(circle.layer, 'B');
    assert.equal(mtext.text, 'Peça\n123');
    assert.ok(parsed.layers.some((l) => l.name === 'A') && parsed.layers.some((l) => l.name === 'B'));
});

test('snaps: prioridade de ponto final sobre mais próximo, interseção e perpendicular', () => {
    const entities = [
        { id: 'a', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { id: 'b', type: 'line', layer: '0', start: { x: 5, y: -5 }, end: { x: 5, y: 5 } },
        { id: 'c', type: 'circle', layer: '0', center: { x: 30, y: 0 }, radius: 3 },
    ];
    const settings = { ...defaultSnapSettings(), nea: true, qua: true };
    assert.equal(findSnap(entities, { x: 9.8, y: 0.1 }, 0.5, settings).mode, 'end');
    const inter = findSnap(entities, { x: 5.1, y: 0.1 }, 0.5, settings);
    assert.equal(inter.mode, 'int');
    assert.ok(closePoint(inter.point, { x: 5, y: 0 }));
    assert.equal(findSnap(entities, { x: 2.5, y: 0.1 }, 0.5, settings).mode, 'nea');
    const per = findSnap(entities, { x: 7, y: 0.2 }, 0.5, settings, { reference: { x: 7, y: 8 } });
    assert.equal(per.mode, 'per');
    assert.ok(closePoint(per.point, { x: 7, y: 0 }));
    assert.equal(findSnap(entities, { x: 33, y: 0.1 }, 0.5, settings).mode, 'qua');
    assert.equal(findSnap(entities, { x: 30.1, y: 0.1 }, 0.5, settings).mode, 'cen');
    assert.equal(findSnap(entities, { x: 100, y: 100 }, 0.5, settings), null);
});

test('orto e polar', () => {
    assert.deepEqual(applyOrtho({ x: 0, y: 0 }, { x: 10, y: 3 }), { x: 10, y: 0 });
    assert.deepEqual(applyOrtho({ x: 0, y: 0 }, { x: 2, y: 9 }), { x: 0, y: 9 });
    const polar = applyPolar({ x: 0, y: 0 }, { x: 10, y: 10.2 }, 45);
    assert.ok(close(polar.x, polar.y));
    const free = applyPolar({ x: 0, y: 0 }, { x: 10, y: 5 }, 45);
    assert.deepEqual(free, { x: 10, y: 5 });
});

test('rastreio por projeção: alinhamento, interseção de projeções, com objetos e extensão', async () => {
    const { findTrackingSnap, trackingPointFromSnap, addTrackingPoint, mergeSnaps } = await import('../src/cad/tracking.js');
    const line = { id: 'a', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const tp = trackingPointFromSnap({ mode: 'end', point: { x: 10, y: 0 }, entity: line });
    assert.equal(tp.ext.kind, 'ray');
    assert.ok(close(tp.ext.angle, 0), 'extensão deve apontar para fora da linha');
    let tracking = addTrackingPoint([], tp, 0.5);
    tracking = addTrackingPoint(tracking, trackingPointFromSnap({ mode: 'mid', point: { x: 10, y: 0.1 }, entity: line }), 0.5);
    assert.equal(tracking.length, 1, 'ponto duplicado não deve ser adquirido');

    // Projeção vertical a partir do ponto adquirido (10,0): cursor em (10.2, 30) → (10, 30).
    let r = findTrackingSnap({ tracking, cursor: { x: 10.2, y: 30 }, tolerance: 0.5 });
    assert.equal(r.snap.mode, 'trk');
    assert.ok(closePoint(r.snap.point, { x: 10, y: 30 }));
    // Longe de qualquer alinhamento: nada.
    assert.equal(findTrackingSnap({ tracking, cursor: { x: 25, y: 30 }, tolerance: 0.5 }), null);

    // Extensão: cursor além da ponta, sobre a reta da linha.
    r = findTrackingSnap({ tracking, cursor: { x: 25, y: 0.2 }, tolerance: 0.5 });
    assert.ok(['ext', 'trk'].includes(r.snap.mode));
    assert.ok(closePoint(r.snap.point, { x: 25, y: 0 }));

    // Interseção entre projeção vertical do ponto adquirido e projeção horizontal do ponto de referência.
    r = findTrackingSnap({ tracking, reference: { x: 0, y: 30 }, cursor: { x: 10.3, y: 30.2 }, tolerance: 0.5 });
    assert.equal(r.snap.mode, 'trkint');
    assert.ok(closePoint(r.snap.point, { x: 10, y: 30 }));
    // Sem polar, a linha do ponto de referência sozinha não projeta.
    r = findTrackingSnap({ tracking, reference: { x: 0, y: 30 }, cursor: { x: 40, y: 30.2 }, tolerance: 0.5 });
    assert.equal(r?.snap ?? null, null);
    r = findTrackingSnap({ tracking, reference: { x: 0, y: 30 }, cursor: { x: 43, y: 30.2 }, tolerance: 0.5, polarOn: true });
    assert.equal(r.snap.mode, 'trk');
    assert.ok(closePoint(r.snap.point, { x: 43, y: 30 }));
    // Em (40,30) a linha de 45° do ponto adquirido cruza a horizontal da referência: interseção.
    r = findTrackingSnap({ tracking, reference: { x: 0, y: 30 }, cursor: { x: 40.1, y: 30.2 }, tolerance: 0.5, polarOn: true });
    assert.equal(r.snap.mode, 'trkint');
    assert.ok(closePoint(r.snap.point, { x: 40, y: 30 }));

    // Interseção de projeção com objeto: linha inclinada cruzando a vertical x=10 em (10,20).
    const diag = { id: 'b', type: 'line', layer: '0', start: { x: 0, y: 10 }, end: { x: 20, y: 30 } };
    r = findTrackingSnap({ tracking, cursor: { x: 10.2, y: 20.3 }, tolerance: 0.5, entities: [line, diag] });
    assert.equal(r.snap.mode, 'trkint');
    assert.ok(closePoint(r.snap.point, { x: 10, y: 20 }));

    // Extensão de arco: círculo completo.
    const arc = { id: 'c', type: 'arc', layer: '0', center: { x: 0, y: 0 }, radius: 5, start: 0, end: Math.PI / 2 };
    const arcTracking = addTrackingPoint([], trackingPointFromSnap({ mode: 'end', point: { x: 5, y: 0 }, entity: arc }), 0.5);
    r = findTrackingSnap({ tracking: arcTracking, cursor: { x: 0.2, y: -4.9 }, tolerance: 0.5 });
    assert.equal(r.snap.mode, 'ext');
    assert.ok(close(Math.hypot(r.snap.point.x, r.snap.point.y), 5));

    // Merge: END vence rastreio; rastreio vence NEA.
    assert.equal(mergeSnaps({ mode: 'end', point: { x: 0, y: 0 } }, { mode: 'trkint', point: { x: 1, y: 1 } }).mode, 'end');
    assert.equal(mergeSnaps({ mode: 'nea', point: { x: 0, y: 0 } }, { mode: 'trk', point: { x: 1, y: 1 } }).mode, 'trk');
    assert.equal(mergeSnaps(null, null), null);
});

test('offset de polilinha com arcos unidos mantém concentricidade e recalcula bulge', () => {
    const lens = { type: 'polyline', closed: true, vertices: [{ x: -83.537, y: 93.766, bulge: 7.8055 }, { x: -38.16, y: 93.766, bulge: -0.8801 }] };
    const original = polylineCurves(lens.vertices, true);
    const check = (result, expectedRadii) => {
        assert.ok(result, 'offset deveria existir');
        assert.equal(result.vertices.length, 2);
        const curves = polylineCurves(result.vertices, true);
        assert.deepEqual(curves.map((c) => c.kind), ['arc', 'arc']);
        curves.forEach((c, i) => {
            assert.ok(closePoint(c.center, original[i].center, 1e-3), `arco ${i} deixou de ser concêntrico: ${JSON.stringify(c.center)} vs ${JSON.stringify(original[i].center)}`);
            assert.ok(close(c.radius, expectedRadii[i], 1e-3), `raio do arco ${i}: ${c.radius} ≠ ${expectedRadii[i]}`);
        });
        // Os vértices são interseções dos dois círculos deslocados.
        result.vertices.forEach((v) => {
            curves.forEach((c) => assert.ok(close(distance(v, c.center), c.radius, 1e-3), 'vértice fora do arco deslocado'));
        });
        // Sentidos preservados: primeiro anti-horário, segundo horário.
        assert.ok(result.vertices[0].bulge > 0 && result.vertices[1].bulge < 0);
    };
    // Clique dentro da peça (abaixo da mordida): offset para dentro — arco grande encolhe, mordida (arco horário) cresce.
    check(offsetEntity(lens, 2, { x: -60, y: 40 }), [original[0].radius - 2, original[1].radius + 2]);
    // Clique dentro da mordida (fora da peça) e clique bem acima: offset para fora.
    check(offsetEntity(lens, 2, { x: -60, y: 93.766 }), [original[0].radius + 2, original[1].radius - 2]);
    check(offsetEntity(lens, 2, { x: -60, y: 200 }), [original[0].radius + 2, original[1].radius - 2]);
});

test('offset de retângulo com cantos arredondados preserva centros dos fillets', () => {
    const b = Math.tan(Math.PI / 8); // arco de 90°
    const r = 5;
    const rounded = { type: 'polyline', closed: true, vertices: [
        { x: r, y: 0, bulge: 0 }, { x: 40 - r, y: 0, bulge: b }, { x: 40, y: r, bulge: 0 }, { x: 40, y: 20 - r, bulge: b },
        { x: 40 - r, y: 20, bulge: 0 }, { x: r, y: 20, bulge: b }, { x: 0, y: 20 - r, bulge: 0 }, { x: 0, y: r, bulge: b },
    ] };
    const original = polylineCurves(rounded.vertices, true);
    const inner = offsetEntity(rounded, 1, { x: 20, y: 10 });
    const innerCurves = polylineCurves(inner.vertices, true);
    assert.equal(inner.vertices.length, 8);
    innerCurves.forEach((c, i) => {
        if (c.kind === 'arc') {
            assert.ok(closePoint(c.center, original[i].center, 1e-6));
            assert.ok(close(c.radius, r - 1, 1e-6));
        }
    });
    assert.ok(closePoint(inner.vertices[0], { x: r, y: 1 }, 1e-6));
    const outer = offsetEntity(rounded, 1, { x: 20, y: -50 });
    const outerCurves = polylineCurves(outer.vertices, true);
    outerCurves.forEach((c, i) => {
        if (c.kind === 'arc') assert.ok(close(c.radius, r + 1, 1e-6) && closePoint(c.center, original[i].center, 1e-6));
    });
    assert.ok(closePoint(outer.vertices[0], { x: r, y: -1 }, 1e-6));
});

test('zoom da roda é proporcional ao deslocamento, não fixo por evento', () => {
    const roda = (deltaY, deltaMode = 0) => wheelZoomFactor({ deltaY, deltaMode });
    // Um clique de mouse (100 px no Chrome, 3 linhas no Firefox) mantém o passo histórico de 1,15x.
    assert.ok(close(roda(-100), 1.15, 1e-9));
    assert.ok(close(roda(100), 1 / 1.15, 1e-9));
    assert.ok(close(roda(-3, 1), 1.15, 1e-9));
    assert.ok(close(roda(-0.25, 2), 1.15, 1e-9));

    // Trackpad: dezenas de eventos pequenos precisam somar o passo de um clique, não um por evento.
    const acumulado = (deltaY, vezes) => Array.from({ length: vezes }, () => roda(deltaY)).reduce((a, f) => a * f, 1);
    assert.ok(close(acumulado(-4, 10), 1.15 ** 0.4, 1e-9));
    assert.ok(acumulado(-4, 10) < 1.1, 'dez eventos de trackpad não podem dobrar o zoom');
    assert.ok(close(acumulado(-4, 25), 1.15, 1e-9), 'um gesto inteiro equivale a um clique de mouse');

    // Evento gigante (pinça no trackpad, rolagem por página) fica com teto.
    assert.ok(close(roda(-5000), 1.15 ** 2, 1e-9));
    assert.ok(close(roda(5000), 1.15 ** -2, 1e-9));
});

test('borda do círculo revela o centro sem puxar o snap', () => {
    const circle = { id: 'c1', type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: 10 };
    const settings = defaultSnapSettings();
    const hints = findCenterHints([circle], { x: 10.1, y: 0.3 }, 0.5, settings);
    assert.equal(hints.length, 1);
    assert.deepEqual(hints[0].point, { x: 0, y: 0 });
    assert.equal(findCenterHints([circle], { x: 5, y: 0 }, 0.5, settings).length, 0);
    assert.equal(findCenterHints([circle], { x: 10.1, y: 0 }, 0.5, { ...settings, cen: false }).length, 0);
});
