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

test('cota angular entre duas linhas cota o setor apontado entre os quatro', async () => {
    const { resolveAngularQuadrant } = await import('../src/cad/dimensions.js');
    const vertex = { x: 0, y: 0 };
    const p1 = { x: 1, y: 0 };
    const p2 = { x: Math.cos(Math.PI / 3), y: Math.sin(Math.PI / 3) };
    const cases = [
        [{ x: 10, y: 3 }, 60],
        [{ x: -3, y: 10 }, 120],
        [{ x: -10, y: -3 }, 60],
        [{ x: 3, y: -10 }, 120],
    ];
    for (const [cursor, expected] of cases) {
        const r = resolveAngularQuadrant(vertex, p1, p2, cursor);
        const g = dimensionGeometry({ type: 'dimension', kind: 'angular', vertex, ...r, linePoint: cursor });
        assert.ok(close(g.measurement, expected), `cursor ${JSON.stringify(cursor)}: ${g.measurement}`);
        const mid = g.arcs[0].startAngle + (((g.arcs[0].endAngle - g.arcs[0].startAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / 2;
        const dot = Math.cos(mid) * cursor.x + Math.sin(mid) * cursor.y;
        assert.ok(dot > 0, 'arco no lado do cursor');
    }
});

test('cota angular travada não troca de setor ao arrastar e põe o texto por dentro do arco', () => {
    const style = { textHeight: 2.5, arrowSize: 2.5, extOffset: 1, extBeyond: 2, textGap: 1, precision: 1 };
    const base = { type: 'dimension', kind: 'angular', vertex: { x: 0, y: 0 }, p1: { x: 0, y: -40 }, p2: { x: 30, y: -30 }, sectorLocked: true };
    for (const linePoint of [{ x: 5, y: -30 }, { x: -20, y: 20 }]) {
        const g = dimensionGeometry({ ...base, linePoint }, style);
        assert.ok(close(g.measurement, 45), `${g.measurement}`);
    }
    const g = dimensionGeometry({ ...base, linePoint: { x: 10, y: -25 } }, style);
    const r = Math.hypot(10, 25);
    const t = g.texts[0];
    const h = t.rotation * Math.PI / 180;
    // base do texto e topo (base + altura na direção "para cima" do texto) ficam dentro do raio
    const baseMid = { x: t.position.x, y: t.position.y };
    const top = { x: baseMid.x - Math.sin(h) * t.height, y: baseMid.y + Math.cos(h) * t.height };
    assert.ok(Math.hypot(baseMid.x, baseMid.y) < r && Math.hypot(top.x, top.y) < r);
});

test('cota angular desenha a chamada do lado sem linha mesmo com o setor invertido', () => {
    const style = { textHeight: 2.5, arrowSize: 2.5, extOffset: 1, extBeyond: 2, textGap: 1, precision: 1 };
    // p1 longo (linha da peça), p2 no vértice (lado oposto da diagonal); setor de p2 para p1
    const dim = { type: 'dimension', kind: 'angular', vertex: { x: 0, y: 0 }, p1: { x: 0, y: -100 }, p2: { x: 0.7e-6, y: -0.7e-6 }, sectorLocked: true, linePoint: { x: 10, y: -20 } };
    const g = dimensionGeometry(dim, style);
    assert.ok(close(g.measurement, 45));
    const diag = g.segments.find((sg) => Math.abs(sg.b.x + sg.b.y) < 1e-6 && sg.b.x > 0);
    assert.ok(diag, 'falta a chamada na diagonal');
});

test('cota angular travada vai para o setor oposto e para as laterais mantendo o ângulo', () => {
    const style = { textHeight: 2.5, arrowSize: 2.5, extOffset: 1, extBeyond: 2, textGap: 1, precision: 1 };
    const base = { type: 'dimension', kind: 'angular', vertex: { x: 0, y: 0 }, p1: { x: 40, y: 0 }, p2: { x: 0, y: 40 }, sectorLocked: true };
    const opp = dimensionGeometry({ ...base, linePoint: { x: -20, y: -20 } }, style);
    assert.ok(close(opp.measurement, 90));
    assert.ok(close(opp.arcs[0].startAngle, Math.PI) && close(opp.arcs[0].endAngle, 1.5 * Math.PI));
    assert.equal(opp.segments.length, 2);
    const side = dimensionGeometry({ ...base, linePoint: { x: 20, y: -10 } }, style);
    assert.ok(close(side.measurement, 90));
    assert.equal(side.arcs.length, 2);
    assert.ok(close(side.arcs[0].startAngle, 0) && close(side.arcs[0].endAngle, Math.PI / 2));
    const t = side.texts[0];
    assert.ok(t.position.y < 0, 'texto acompanha o cursor na lateral');
});

test('setas da cota angular: dentro do arco quando cabe, fora com rabicho quando não cabe', () => {
    const style = { textHeight: 2.5, arrowSize: 2.5, extOffset: 1, extBeyond: 2, textGap: 1, precision: 1 };
    const inSector = (pt, a0, a1) => { const a = Math.atan2(pt.y, pt.x); return a > a0 + 1e-9 && a < a1 - 1e-9; };
    const wide = dimensionGeometry({ type: 'dimension', kind: 'angular', vertex: { x: 0, y: 0 }, p1: { x: 40, y: 0 }, p2: { x: 0, y: 40 }, linePoint: { x: 20, y: 20 } }, style);
    for (const ar of wide.arrows) assert.ok(inSector(ar[1], 0, Math.PI / 2), 'corpo da seta dentro');
    const a = (5 * Math.PI) / 180;
    const narrow = dimensionGeometry({ type: 'dimension', kind: 'angular', vertex: { x: 0, y: 0 }, p1: { x: 40, y: 0 }, p2: { x: 40 * Math.cos(a), y: 40 * Math.sin(a) }, linePoint: { x: 20, y: 1 } }, style);
    for (const ar of narrow.arrows) assert.ok(!inSector(ar[1], 0, a), 'corpo da seta fora');
    assert.equal(narrow.arcs.length, 3);
});
