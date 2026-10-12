import test from 'node:test';
import assert from 'node:assert/strict';
import { divideEntity, measureEntity } from '../src/cad/edit-tools.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { writeDxf, parseDxf } from '../src/cad/dxf.js';

const close = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;
const p = (x, y) => ({ x, y });

test('DIVIDE: Linha reta em N partes gera N-1 pontos nos locais exatos', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(100, 0) };
    const points = divideEntity(line, 4);

    assert.equal(points.length, 3);
    assert.equal(points.every((pt) => pt.type === 'point'), true);
    assert.ok(close(points[0].position.x, 25) && close(points[0].position.y, 0));
    assert.ok(close(points[1].position.x, 50) && close(points[1].position.y, 0));
    assert.ok(close(points[2].position.x, 75) && close(points[2].position.y, 0));
});

test('DIVIDE: Círculo (objeto fechado) gera N pontos uniformemente distribuídos', () => {
    const circle = { id: 'c1', type: 'circle', layer: '0', center: p(0, 0), radius: 50 };
    const points = divideEntity(circle, 4);

    assert.equal(points.length, 4);
    assert.ok(close(points[0].position.x, 50) && close(points[0].position.y, 0));
    assert.ok(close(points[1].position.x, 0) && close(points[1].position.y, 50));
    assert.ok(close(points[2].position.x, -50) && close(points[2].position.y, 0));
    assert.ok(close(points[3].position.x, 0) && close(points[3].position.y, -50));
});

test('DIVIDE: Arco aberto e Polilinha com bulge', () => {
    // Arco de 90° com raio 100
    const arc = { id: 'a1', type: 'arc', layer: '0', center: p(0, 0), radius: 100, start: 0, end: Math.PI / 2 };
    const arcPts = divideEntity(arc, 2);
    assert.equal(arcPts.length, 1);
    assert.ok(close(arcPts[0].position.x, 100 * Math.cos(Math.PI / 4)));
    assert.ok(close(arcPts[0].position.y, 100 * Math.sin(Math.PI / 4)));

    // Polilinha com segmento reto de 50mm e semicírculo (bulge 1) com comprimento 25*PI
    const poly = {
        id: 'pl1',
        type: 'polyline',
        closed: false,
        layer: '0',
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 50, y: 0, bulge: 1 },
            { x: 50, y: 50, bulge: 0 },
        ],
    };
    const polyPts = divideEntity(poly, 3);
    assert.equal(polyPts.length, 2);
});

test('DIVIDE: Inserção de blocos com e sem alinhamento', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(0, 100) };

    // Com alinhamento: rotação acompanha o vetor (90°)
    const aligned = divideEntity(line, 2, { block: 'SETA', align: true });
    assert.equal(aligned.length, 1);
    assert.equal(aligned[0].type, 'insert');
    assert.equal(aligned[0].name, 'SETA');
    assert.ok(close(aligned[0].position.x, 0) && close(aligned[0].position.y, 50));
    assert.ok(close(aligned[0].rotation, 90));

    // Sem alinhamento: rotação é 0°
    const unaligned = divideEntity(line, 2, { block: 'SETA', align: false });
    assert.equal(unaligned.length, 1);
    assert.equal(unaligned[0].rotation, 0);
});

test('DIVIDE: Casos-limite e validações', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(100, 0) };
    assert.throws(() => divideEntity(line, 1), /pelo menos 2/);
    assert.throws(() => divideEntity(line, 0), /pelo menos 2/);
    assert.throws(() => divideEntity(line, -3), /pelo menos 2/);

    const zeroLine = { id: 'z1', type: 'line', layer: '0', start: p(0, 0), end: p(0, 0) };
    assert.throws(() => divideEntity(zeroLine, 3), /comprimento zero/);
});

test('MEASURE: Linha reta medida por intervalo a partir do início ou do fim', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(100, 0) };

    // Clique mais perto do início (x=10): mede a partir de (0,0) -> pontos em 30, 60, 90
    const fromStart = measureEntity(line, 30, p(10, 0));
    assert.equal(fromStart.length, 3);
    assert.ok(close(fromStart[0].position.x, 30));
    assert.ok(close(fromStart[1].position.x, 60));
    assert.ok(close(fromStart[2].position.x, 90));

    // Clique mais perto do fim (x=90): mede a partir de (100,0) -> pontos em 70, 40, 10
    const fromEnd = measureEntity(line, 30, p(90, 0));
    assert.equal(fromEnd.length, 3);
    assert.ok(close(fromEnd[0].position.x, 70));
    assert.ok(close(fromEnd[1].position.x, 40));
    assert.ok(close(fromEnd[2].position.x, 10));
});

test('MEASURE: Círculo e Arco com opção Bloco', () => {
    const circle = { id: 'c1', type: 'circle', layer: '0', center: p(0, 0), radius: 10 };
    // Perímetro ≈ 62.8318, intervalo de 20 gera 3 inserções
    const circleInserts = measureEntity(circle, 20, null, { block: 'FURO', align: true });
    assert.equal(circleInserts.length, 3);
    assert.equal(circleInserts[0].type, 'insert');
    assert.equal(circleInserts[0].name, 'FURO');

    const arc = { id: 'a1', type: 'arc', layer: '0', center: p(0, 0), radius: 50, start: 0, end: Math.PI };
    // Comprimento 50 * PI ≈ 157.0796, intervalo de 50 gera 3 pontos
    const arcPts = measureEntity(arc, 50, p(50, 0));
    assert.equal(arcPts.length, 3);
});

test('MEASURE: Casos-limite', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(50, 0) };
    assert.throws(() => measureEntity(line, 0, p(0, 0)), /maior que zero/);
    assert.throws(() => measureEntity(line, -5, p(0, 0)), /maior que zero/);

    // Intervalo maior que o comprimento do objeto retorna lista vazia sem erro
    const empty = measureEntity(line, 100, p(0, 0));
    assert.equal(empty.length, 0);
});

test('DIVIDE e MEASURE: Ida e volta em DXF das entidades criadas (POINT e INSERT)', () => {
    const line = { id: 'l1', type: 'line', layer: '0', start: p(0, 0), end: p(100, 0) };
    const divPoints = divideEntity(line, 5); // 4 pontos
    const measInserts = measureEntity(line, 25, p(10, 0), { block: 'MARCA', align: false }); // 3 inserts

    const baseDoc = createDocument();
    baseDoc.blocks = {
        MARCA: {
            basePoint: p(0, 0),
            entities: [{ type: 'circle', center: p(0, 0), radius: 2, layer: '0' }],
        },
    };
    const doc = addEntities(baseDoc, [...divPoints, ...measInserts]);
    const dxfText = writeDxf(doc);
    const parsed = parseDxf(dxfText, { preserveBlocks: true, preserveDimensions: true });

    // Verifica que todos os 4 pontos foram salvos e lidos
    const pts = parsed.entities.filter((e) => e.type === 'point');
    assert.equal(pts.length, 4);
    assert.ok(close(pts[0].position.x, 20));
    assert.ok(close(pts[1].position.x, 40));
    assert.ok(close(pts[2].position.x, 60));
    assert.ok(close(pts[3].position.x, 80));

    // Verifica que os 3 inserts foram salvos e lidos
    const inserts = parsed.entities.filter((e) => e.type === '__insert' || e.type === 'insert');
    assert.equal(inserts.length, 3);
    assert.equal(inserts[0].name, 'MARCA');
    assert.ok(close(inserts[0].position.x, 25));
    assert.ok(close(inserts[1].position.x, 50));
    assert.ok(close(inserts[2].position.x, 75));
});
