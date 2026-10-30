import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopsFromEntities, patternSegments, hatchBox } from '../src/cad/hatch.js';
import { autoDimensionPart } from '../src/cad/autodim.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { entityCurves, rotateEntity, translateEntity, distance } from '../src/cad/geometry.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('laços de hachura a partir de polilinha, círculo e cadeia de linhas+arcos', () => {
    const rect = { id: 'r', type: 'polyline', layer: '0', closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }, { x: 0, y: 10, bulge: 0 }] };
    const circle = { id: 'c', type: 'circle', layer: '0', center: { x: 5, y: 5 }, radius: 2 };
    const loops = loopsFromEntities([rect, circle]);
    assert.equal(loops.length, 2);
    assert.equal(loops[1].vertices.length, 2);
    assert.ok(close(loops[1].vertices[0].bulge, 1));
    const chain = loopsFromEntities([
        { id: '1', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { id: '2', type: 'arc', layer: '0', center: { x: 10, y: 5 }, radius: 5, start: -Math.PI / 2, end: Math.PI / 2 },
        { id: '3', type: 'line', layer: '0', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
        { id: '4', type: 'line', layer: '0', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    ]);
    assert.equal(chain.length, 1);
    assert.ok(chain[0].vertices.some((v) => v.bulge !== 0));
    assert.equal(loopsFromEntities([{ id: 'l', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]).length, 0);
});

test('segmentos do padrão ficam dentro do contorno e respeitam furo (par/ímpar)', () => {
    const hatch = { type: 'hatch', layer: '0', pattern: 'ANSI31', angle: 0, spacing: 2, loops: [
        { vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 20, y: 0, bulge: 0 }, { x: 20, y: 10, bulge: 0 }, { x: 0, y: 10, bulge: 0 }] },
        { vertices: [{ x: 8, y: 5, bulge: 1 }, { x: 12, y: 5, bulge: 1 }] },
    ] };
    const segs = patternSegments(hatch);
    assert.ok(segs.length > 5);
    segs.forEach((s) => {
        [s.a, s.b].forEach((p) => {
            assert.ok(p.x >= -1e-6 && p.x <= 20 + 1e-6 && p.y >= -1e-6 && p.y <= 10 + 1e-6, `fora do contorno ${JSON.stringify(p)}`);
            assert.ok(distance(p, { x: 10, y: 5 }) >= 2 - 1e-6, 'segmento entra no furo');
        });
    });
    // Linha horizontal em y≈5 deve estar partida em dois trechos ao redor do furo.
    const atMid = segs.filter((s) => close(s.a.y, 4, 1e-6) || close(s.a.y, 6, 1e-6));
    assert.ok(atMid.length >= 2);
    const box = hatchBox(hatch);
    assert.ok(close(box.maxX, 20) && close(box.maxY, 10));
    assert.ok(entityCurves(hatch).every((c) => c.approx));
});

test('hachura: transformações e DXF (polilinha com bulge, padrão e sólido)', () => {
    const hatch = { type: 'hatch', layer: '0', pattern: 'ANSI37', angle: 45, spacing: 3, opacity: 0.35, loops: [{ vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 1 }] }] };
    // Hachura antiga (ângulo absoluto 45° + espaçamento 3) vira ANSI37 com ângulo 0 e escala 3/3,175.
    const moved = translateEntity(hatch, { x: 5, y: 5 });
    assert.ok(close(moved.loops[0].vertices[0].x, 5) && close(moved.angle, 0) && close(moved.scale, 3 / 3.175));
    const rotated = rotateEntity(hatch, { x: 0, y: 0 }, Math.PI / 2);
    assert.ok(close(rotated.angle, 90));
    let doc = addEntities(createDocument(), [hatch, { type: 'hatch', layer: '0', pattern: 'SOLID', angle: 0, spacing: 3, loops: [{ vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 4, y: 0, bulge: 0 }, { x: 4, y: 4, bulge: 0 }] }] }]);
    const text = writeDxf(doc);
    assert.match(text, /\n0\nHATCH\n/);
    assert.match(text, /\n2\nANSI37\n/);
    assert.match(text, /\n70\n1\n/);
    const parsed = parseDxf(text);
    const hatches = parsed.entities.filter((e) => e.type === 'hatch');
    assert.equal(hatches.length, 2);
    assert.equal(hatches[0].pattern, 'ANSI37');
    assert.ok(close(hatches[0].loops[0].vertices[0].bulge, 1));
    assert.ok(close(hatches[0].scale, 3 / 3.175) && close(hatches[0].angle, 0));
    assert.equal(hatches[1].pattern, 'SOLID');
    // HATCH de outro CAD com laço de arestas (linha + arco).
    const edges = ['0', 'SECTION', '2', 'ENTITIES', '0', 'HATCH', '8', '0', '2', 'ANSI31', '70', '0', '71', '0', '91', '1', '92', '1', '93', '3',
        '72', '1', '10', '0', '20', '0', '11', '10', '21', '0',
        '72', '2', '10', '10', '20', '5', '40', '5', '50', '270', '51', '90', '73', '1',
        '72', '1', '10', '10', '20', '10', '11', '0', '21', '10',
        '97', '0', '75', '0', '76', '1', '52', '30', '41', '1', '77', '0', '78', '1', '53', '30', '43', '0', '44', '0', '45', '0', '46', '3', '79', '0', '98', '0',
        '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const other = parseDxf(edges);
    assert.equal(other.entities[0].type, 'hatch');
    assert.equal(other.entities[0].loops[0].vertices.length, 3);
    assert.ok(other.entities[0].loops[0].vertices[1].bulge > 0.9);
    assert.ok(close(other.entities[0].angle, 30));
});

test('cotagem automática de chapa com furos e cantos arredondados', () => {
    const parts = [
        { id: 'l1', type: 'line', layer: '0', start: { x: 10, y: 0 }, end: { x: 150, y: 0 } },
        { id: 'l2', type: 'line', layer: '0', start: { x: 160, y: 10 }, end: { x: 160, y: 90 } },
        { id: 'l3', type: 'line', layer: '0', start: { x: 150, y: 100 }, end: { x: 10, y: 100 } },
        { id: 'l4', type: 'line', layer: '0', start: { x: 0, y: 90 }, end: { x: 0, y: 10 } },
        { id: 'a1', type: 'arc', layer: '0', center: { x: 150, y: 10 }, radius: 10, start: -Math.PI / 2, end: 0 },
        { id: 'a2', type: 'arc', layer: '0', center: { x: 150, y: 90 }, radius: 10, start: 0, end: Math.PI / 2 },
        { id: 'a3', type: 'arc', layer: '0', center: { x: 10, y: 90 }, radius: 10, start: Math.PI / 2, end: Math.PI },
        { id: 'a4', type: 'arc', layer: '0', center: { x: 10, y: 10 }, radius: 10, start: Math.PI, end: 1.5 * Math.PI },
        { id: 'c1', type: 'circle', layer: '0', center: { x: 25, y: 25 }, radius: 6 },
        { id: 'c2', type: 'circle', layer: '0', center: { x: 135, y: 25 }, radius: 6 },
        { id: 'c3', type: 'circle', layer: '0', center: { x: 25, y: 75 }, radius: 6 },
        { id: 'c4', type: 'circle', layer: '0', center: { x: 135, y: 75 }, radius: 6 },
        { id: 'c5', type: 'circle', layer: '0', center: { x: 80, y: 50 }, radius: 22 },
        { id: 'old', type: 'dimension', layer: 'COTAS', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, linePoint: { x: 0, y: -5 } },
    ];
    const dims = autoDimensionPart(parts, { dimStyle: { textHeight: 2.5, scale: 1, precision: 2 }, layer: 'COTAS' });
    const kinds = dims.map((d) => d.kind);
    const overallH = dims.find((d) => d.kind === 'horizontal' && close(dimensionGeometry(d).measurement, 160));
    const overallV = dims.find((d) => d.kind === 'vertical' && close(dimensionGeometry(d).measurement, 100));
    assert.ok(overallH && overallV, 'dimensões gerais 160 e 100');
    assert.ok(overallH.linePoint.y < 0 && overallV.linePoint.x > 160, 'gerais fora da peça');
    // Cadeia horizontal fechada: 0→25, 25→80, 80→135, 135→160; soma igual à geral.
    const chainH = dims.filter((d) => d.kind === 'horizontal' && d !== overallH).map((d) => dimensionGeometry(d).measurement).sort((a, b) => a - b);
    assert.deepEqual(chainH.map((v) => Math.round(v)), [25, 25, 55, 55]);
    assert.ok(close(chainH.reduce((s, v) => s + v, 0), 160, 1e-6), 'cadeia deve fechar na dimensão geral');
    // Extensão sai do furo mais próximo da linha de cota, sem atravessar a peça.
    const at25 = dims.find((d) => d.kind === 'horizontal' && d !== overallH && close(d.p1.x, 25) && close(d.p2.x, 80));
    assert.ok(at25 && close(at25.p1.y, 25) && close(at25.p2.y, 50), 'referência deve ser o furo mais baixo de cada posição');
    const chainRow = dims.filter((d) => d.kind === 'horizontal' && d !== overallH);
    assert.ok(chainRow.every((d) => d.linePoint.y > overallH.linePoint.y && d.linePoint.y < 0), 'cadeia entre a peça e a geral');
    // Diâmetros: dois valores únicos (12 e 44), o de 12 com "4x".
    const diameters = dims.filter((d) => d.kind === 'diameter');
    assert.equal(diameters.length, 2);
    assert.ok(diameters.some((d) => d.textOverride === '4x Ø12'));
    // Raios: um único R10.
    const radii = dims.filter((d) => d.kind === 'radius');
    assert.equal(radii.length, 1);
    assert.ok(close(radii[0].radius, 10));
    assert.ok(dims.every((d) => d.layer === 'COTAS' && d.type === 'dimension'));
    assert.ok(!kinds.includes(undefined));
});

test('Cotar peça em desenho solto: sem cadeia de furos e gerais ancoradas na geometria', () => {
    // Caso do Traço (14/10): círculo Ø500, linha comprida e segmento de 500 soltos, sem contorno fechado.
    const parts = [
        { id: 'c', type: 'circle', layer: '0', center: { x: 250, y: 250 }, radius: 250 },
        { id: 'l', type: 'line', layer: '0', start: { x: 250, y: 0 }, end: { x: 1339.71, y: 0 } },
        { id: 's', type: 'line', layer: '0', start: { x: 1339.71, y: 0 }, end: { x: 1339.71, y: 500 } },
    ];
    const dims = autoDimensionPart(parts, { dimStyle: { textHeight: 2.5, scale: 1 }, layer: 'COTAS' });
    const horizontal = dims.filter((d) => d.kind === 'horizontal');
    const vertical = dims.filter((d) => d.kind === 'vertical');
    assert.equal(horizontal.length, 1, 'círculo solto não vira furo: só a geral horizontal');
    assert.equal(vertical.length, 1, 'só a geral vertical');
    assert.ok(close(dimensionGeometry(horizontal[0]).measurement, 1339.71));
    assert.ok(close(dimensionGeometry(vertical[0]).measurement, 500));
    // Extensões presas em pontos que existem: quadrante esquerdo do círculo e pontas das linhas.
    assert.ok(close(horizontal[0].p1.x, 0) && close(horizontal[0].p1.y, 250));
    assert.ok(close(horizontal[0].p2.x, 1339.71) && close(horizontal[0].p2.y, 0));
    assert.ok(close(vertical[0].p1.x, 1339.71) && close(vertical[0].p1.y, 0));
    assert.ok(close(vertical[0].p2.x, 1339.71) && close(vertical[0].p2.y, 500));
    const diameters = dims.filter((d) => d.kind === 'diameter');
    assert.equal(diameters.length, 1);
    assert.ok(close(diameters[0].radius, 250));
});

test('Cotar peça: círculo fora do contorno (no recorte de uma peça em L) não entra na cadeia', () => {
    const lShape = { id: 'p', type: 'polyline', layer: '0', closed: true, vertices: [
        { x: 0, y: 0, bulge: 0 }, { x: 100, y: 0, bulge: 0 }, { x: 100, y: 40, bulge: 0 },
        { x: 40, y: 40, bulge: 0 }, { x: 40, y: 100, bulge: 0 }, { x: 0, y: 100, bulge: 0 },
    ] };
    const hole = { id: 'h', type: 'circle', layer: '0', center: { x: 20, y: 20 }, radius: 5 };
    const loose = { id: 'x', type: 'circle', layer: '0', center: { x: 70, y: 70 }, radius: 5 };
    const dims = autoDimensionPart([lShape, hole, loose], { dimStyle: { textHeight: 2.5, scale: 1 }, layer: 'COTAS' });
    const chainH = dims.filter((d) => d.kind === 'horizontal').map((d) => Math.round(dimensionGeometry(d).measurement)).sort((a, b) => a - b);
    assert.deepEqual(chainH, [20, 80, 100], 'cadeia só com o furo de dentro (20 + 80) e a geral');
    const chainV = dims.filter((d) => d.kind === 'vertical').map((d) => Math.round(dimensionGeometry(d).measurement)).sort((a, b) => a - b);
    assert.deepEqual(chainV, [20, 80, 100]);
    assert.equal(dims.filter((d) => d.kind === 'diameter').length, 1, 'só o furo da peça recebe diâmetro');
});

test('Cotar peça: contorno com arco de bulge negativo continua reconhecendo os furos', () => {
    // Retângulo 100×60 com o lado de cima afundado por um arco (bulge negativo) e um furo abaixo dele.
    const part = { id: 'p', type: 'polyline', layer: '0', closed: true, vertices: [
        { x: 0, y: 0, bulge: 0 }, { x: 100, y: 0, bulge: 0 }, { x: 100, y: 60, bulge: -0.3 },
        { x: 0, y: 60, bulge: 0 },
    ] };
    const hole = { id: 'h', type: 'circle', layer: '0', center: { x: 30, y: 20 }, radius: 4 };
    const dims = autoDimensionPart([part, hole], { dimStyle: { textHeight: 2.5, scale: 1 }, layer: 'COTAS' });
    assert.equal(dims.filter((d) => d.kind === 'horizontal').length, 3, 'cadeia 30 + 70 e a geral');
    assert.equal(dims.filter((d) => d.kind === 'diameter').length, 1);
});
