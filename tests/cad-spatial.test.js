import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialIndex } from '../src/cad/spatial-index.js';
import { entityBox } from '../src/cad/geometry.js';

test('SpatialIndex: árvore vazia retorna array vazio e tamanho 0', () => {
    const index = new SpatialIndex();
    assert.equal(index.size(), 0);
    assert.deepEqual(index.search({ minX: 0, minY: 0, maxX: 10, maxY: 10 }), []);
    assert.deepEqual(index.searchRadius({ x: 5, y: 5 }, 10), []);
});

test('SpatialIndex: bulk-loading via STR e busca exata por janela', () => {
    const entities = [
        { id: 'e1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } },
        { id: 'e2', type: 'line', start: { x: 50, y: 50 }, end: { x: 60, y: 60 } },
        { id: 'e3', type: 'circle', center: { x: 100, y: 100 }, radius: 5 },
        { id: 'e4', type: 'line', start: { x: 5, y: 5 }, end: { x: 15, y: 15 } },
    ];

    const index = new SpatialIndex({ getBBox: entityBox });
    index.load(entities);

    assert.equal(index.size(), 4);

    // Consulta na região (0..20) deve encontrar e1 e e4
    const res1 = index.search({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    const ids1 = res1.map((e) => e.id).sort();
    assert.deepEqual(ids1, ['e1', 'e4']);

    // Consulta na região (40..70) deve encontrar e2
    const res2 = index.search({ minX: 40, minY: 40, maxX: 70, maxY: 70 });
    assert.deepEqual(res2.map((e) => e.id), ['e2']);

    // Consulta fora de tudo
    const res3 = index.search({ minX: 200, minY: 200, maxX: 300, maxY: 300 });
    assert.equal(res3.length, 0);
});

test('SpatialIndex: busca por raio (searchRadius) para OSNAP e Pick', () => {
    const entities = [
        { id: 'hole1', type: 'circle', center: { x: 10, y: 10 }, radius: 2 },
        { id: 'hole2', type: 'circle', center: { x: 50, y: 50 }, radius: 2 },
        { id: 'hole3', type: 'circle', center: { x: 100, y: 10 }, radius: 2 },
    ];

    const index = new SpatialIndex({ getBBox: entityBox });
    index.load(entities);

    // Cursor próximo a hole1 com tolerância de 3mm
    const nearHole1 = index.searchRadius({ x: 11, y: 9 }, 3);
    assert.equal(nearHole1.length, 1);
    assert.equal(nearHole1[0].id, 'hole1');

    // Cursor longe de qualquer entidade
    const farAway = index.searchRadius({ x: 30, y: 30 }, 5);
    assert.equal(farAway.length, 0);
});

test('SpatialIndex: inserção e remoção dinâmicas preservam consistência', () => {
    const index = new SpatialIndex({ getBBox: entityBox });
    const e1 = { id: 'p1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const e2 = { id: 'p2', type: 'line', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } };

    index.load([e1]);
    assert.equal(index.size(), 1);

    index.insert(e2);
    assert.equal(index.size(), 2);

    let res = index.search({ minX: 15, minY: -5, maxX: 35, maxY: 5 });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'p2');

    // Remove e2
    const removed = index.remove('p2');
    assert.equal(removed, true);
    assert.equal(index.size(), 1);

    res = index.search({ minX: 15, minY: -5, maxX: 35, maxY: 5 });
    assert.equal(res.length, 0);

    // Tenta remover id inexistente
    assert.equal(index.remove('non-existent'), false);
});

test('SpatialIndex: suporta coordenadas negativas e desenho industrial denso', () => {
    const entities = [];
    for (let x = -100; x <= 100; x += 10) {
        for (let y = -100; y <= 100; y += 10) {
            entities.push({
                id: `grid_${x}_${y}`,
                type: 'circle',
                center: { x, y },
                radius: 1,
            });
        }
    }

    const index = new SpatialIndex({ getBBox: entityBox });
    index.load(entities);
    assert.equal(index.size(), 441);

    // Busca no quadrante negativo (-55..-25 em X e Y)
    const res = index.search({ minX: -55, minY: -55, maxX: -25, maxY: -25 });
    // Deve pegar x: -50, -40, -30 e y: -50, -40, -30 => 3 x 3 = 9 pontos
    assert.equal(res.length, 9);
});
