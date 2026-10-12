import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dimensionGeometry, dimensionCurves, chooseLinearKind, autoDimensionFor, formatMeasurement, transformDimension } from '../src/cad/dimensions.js';
import { entityCurves, entityBox, rotateEntity, translateEntity } from '../src/cad/geometry.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { writeDxf, parseDxf } from '../src/cad/dxf.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const closePoint = (p, q, tol = 1e-6) => close(p.x, q.x, tol) && close(p.y, q.y, tol);

test('baseline de cotas usa somente textGap, independente da altura do texto', () => {
    for (const textHeight of [2.5, 10]) {
        for (const scale of [1, 3]) {
            const style = { textHeight, textGap: 0.9, scale };
            for (const kind of ['horizontal', 'vertical', 'aligned']) {
                const g = dimensionGeometry({ kind, p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 }, linePoint: { x: -10, y: 60 } }, style);
                const t = g.texts[0], a = t.rotation * Math.PI / 180;
                const line = g.segments[0];
                const dx = t.position.x - (line.a.x + line.b.x) / 2;
                const dy = t.position.y - (line.a.y + line.b.y) / 2;
                assert.ok(close(-dx * Math.sin(a) + dy * Math.cos(a), 0.9 * scale), kind);
            }
            for (const kind of ['radius', 'diameter']) {
                const inside = dimensionGeometry({ kind, center: { x: 0, y: 0 }, radius: 10, linePoint: { x: 5, y: 0 } }, style);
                assert.ok(close(inside.texts[0].position.y, 0.9 * scale));
                const outside = dimensionGeometry({ kind, center: { x: 0, y: 0 }, radius: 10, linePoint: { x: 20, y: 0 } }, style);
                assert.ok(close(outside.texts[0].position.y, 0.9 * scale));
            }
        }
    }
});

test('formatação da medida respeita precisão e prefixo', () => {
    assert.equal(formatMeasurement(100, { precision: 2 }), '100');
    assert.equal(formatMeasurement(12.5, { precision: 2 }), '12.5');
    assert.equal(formatMeasurement(12.345, { precision: 2 }), '12.35');
    assert.equal(formatMeasurement(7, { precision: 0 }), '7');
    assert.equal(formatMeasurement(25, { precision: 2 }, 'Ø'), 'Ø25');
});

test('cota horizontal: linha de cota, extensões, setas e texto', () => {
    const dim = { type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 100, y: 10 }, linePoint: { x: 50, y: 30 } };
    const g = dimensionGeometry(dim, { textHeight: 2.5, arrowSize: 2.5, extOffset: 0.625, extBeyond: 1.25, textGap: 0.9, precision: 2 });
    assert.equal(g.text, '100');
    assert.ok(close(g.measurement, 100));
    const dimLine = g.segments[0];
    assert.ok(closePoint(dimLine.a, { x: 0, y: 30 }) && closePoint(dimLine.b, { x: 100, y: 30 }));
    assert.equal(g.segments.length, 3, 'linha de cota + duas extensões');
    assert.ok(close(g.segments[1].a.y, 0.625) && close(g.segments[1].b.y, 31.25));
    assert.equal(g.arrows.length, 2);
    assert.ok(closePoint(g.arrows[0][0], { x: 0, y: 30 }) && closePoint(g.arrows[1][0], { x: 100, y: 30 }));
    assert.equal(g.texts.length, 1);
    assert.ok(g.texts[0].position.y > 30, 'texto acima da linha de cota');
    assert.ok(close(g.texts[0].rotation, 0));
});

test('cota vertical e alinhada medem corretamente e posicionam a linha pelo ponto', () => {
    const v = dimensionGeometry({ kind: 'vertical', p1: { x: 0, y: 0 }, p2: { x: 5, y: 40 }, linePoint: { x: -10, y: 20 } });
    assert.equal(v.text, '40');
    assert.ok(close(v.segments[0].a.x, -10) && close(v.segments[0].b.x, -10));
    const a = dimensionGeometry({ kind: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 }, linePoint: { x: 0, y: 10 } });
    assert.equal(a.text, '50');
    // Linha de cota paralela a p1→p2 (direção 3,4) deslocada para o lado do ponto.
    const d = { x: a.segments[0].b.x - a.segments[0].a.x, y: a.segments[0].b.y - a.segments[0].a.y };
    assert.ok(close(d.x / d.y, 0.75));
    assert.ok(a.segments[0].a.x < 0, 'deslocada para a esquerda');
});

test('cota de raio e diâmetro', () => {
    const r = dimensionGeometry({ kind: 'radius', center: { x: 0, y: 0 }, radius: 10, linePoint: { x: 5, y: 5 } });
    assert.equal(r.text, 'R10');
    assert.equal(r.arrows.length, 1);
    assert.ok(close(Math.hypot(r.arrows[0][0].x, r.arrows[0][0].y), 10), 'seta na circunferência');
    const d = dimensionGeometry({ kind: 'diameter', center: { x: 0, y: 0 }, radius: 10, linePoint: { x: 30, y: 0 } });
    assert.equal(d.text, 'Ø20');
    assert.equal(d.arrows.length, 2);
    assert.ok(d.segments.some((s) => closePoint(s.a, { x: -10, y: 0 })), 'linha atravessa o círculo');
    assert.ok(d.segments.length >= 2, 'com linha de chamada quando o texto fica fora');
});

test('escolha automática do tipo linear pela posição', () => {
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 30, y: 40 };
    assert.equal(chooseLinearKind(p1, p2, { x: 15, y: 100 }), 'horizontal');
    assert.equal(chooseLinearKind(p1, p2, { x: -50, y: 20 }), 'vertical');
    assert.equal(chooseLinearKind(p1, p2, { x: -20, y: 60 }), 'aligned');
    assert.equal(chooseLinearKind({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 100 }), 'horizontal');
    assert.equal(chooseLinearKind({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 100 }), 'vertical');
});

test('cota automática por entidade: linha, círculo, arco e segmento de polilinha', () => {
    assert.equal(autoDimensionFor({ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { x: 5, y: 0 }).auto, 'linear');
    assert.equal(autoDimensionFor({ type: 'circle', center: { x: 0, y: 0 }, radius: 4 }, { x: 4, y: 0 }).kind, 'diameter');
    assert.equal(autoDimensionFor({ type: 'arc', center: { x: 0, y: 0 }, radius: 4, start: 0, end: 1 }, { x: 4, y: 0 }).kind, 'radius');
    const poly = { type: 'polyline', closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 1 }, { x: 10, y: 10, bulge: 0 }] };
    const seg = autoDimensionFor(poly, { x: 5, y: 0.1 });
    assert.equal(seg.kind, 'aligned');
    assert.ok(closePoint(seg.p1, { x: 0, y: 0 }) && closePoint(seg.p2, { x: 10, y: 0 }));
    const arcSeg = autoDimensionFor(poly, { x: 15, y: 5 });
    assert.equal(arcSeg.kind, 'radius');
    assert.ok(close(arcSeg.radius, 5));
    assert.equal(autoDimensionFor({ type: 'text' }, { x: 0, y: 0 }), null);
});

test('cota entra no kernel: curvas para snap/hit, bbox e transformações', () => {
    const dim = { type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, linePoint: { x: 50, y: 20 } };
    const curves = entityCurves(dim);
    assert.ok(curves.length >= 3);
    assert.equal(dimensionCurves(dim).length, curves.length);
    const box = entityBox(dim);
    assert.ok(box.minX <= 0 && box.maxX >= 100 && box.maxY >= 20);
    const moved = translateEntity(dim, { x: 5, y: 5 });
    assert.ok(closePoint(moved.p1, { x: 5, y: 5 }) && closePoint(moved.linePoint, { x: 55, y: 25 }));
    const rotated = rotateEntity(dim, { x: 0, y: 0 }, Math.PI / 2);
    assert.equal(rotated.kind, 'vertical', 'rotação de 90° troca horizontal por vertical');
    const tilted = transformDimension(dim, (p) => ({ x: p.x * Math.cos(0.3) - p.y * Math.sin(0.3), y: p.x * Math.sin(0.3) + p.y * Math.cos(0.3) }), false);
    assert.equal(tilted.kind, 'aligned');
    const radial = translateEntity({ type: 'dimension', kind: 'radius', center: { x: 0, y: 0 }, radius: 5, linePoint: { x: 3, y: 3 } }, { x: 1, y: 0 });
    assert.ok(closePoint(radial.center, { x: 1, y: 0 }) && close(radial.radius, 5));
});

test('DXF: cota exportada explodida e DIMENSION importada pelo bloco anônimo', () => {
    let doc = createDocument();
    doc = addEntities(doc, [{ type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, linePoint: { x: 50, y: 20 } }]);
    const text = writeDxf(doc);
    assert.match(text, /\n0\nSOLID\n/);
    assert.match(text, /\n1\n100\n/);
    const back = parseDxf(text);
    assert.ok(back.entities.some((e) => e.type === 'text' && e.text === '100'));
    assert.ok(back.entities.filter((e) => e.type === 'line').length >= 3);
    assert.ok(back.entities.filter((e) => e.type === 'polyline' && e.closed).length === 2, 'setas como polilinhas fechadas');

    const dxf = [
        '0', 'SECTION', '2', 'BLOCKS',
        '0', 'BLOCK', '8', '0', '2', '*D1', '10', '0', '20', '0',
        '0', 'LINE', '8', '0', '10', '0', '20', '5', '11', '10', '21', '5',
        '0', 'TEXT', '8', '0', '10', '5', '20', '6', '40', '2.5', '1', '10',
        '0', 'ENDBLK',
        '0', 'ENDSEC',
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'DIMENSION', '8', 'COTAS', '2', '*D1', '10', '0', '20', '5', '70', '32',
        '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 2);
    assert.equal(parsed.entities[0].type, 'line');
    assert.equal(parsed.entities[1].text, '10');
});
