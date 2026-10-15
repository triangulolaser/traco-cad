import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { purgeDocument, mergeOverlappingLines } from '../src/cad/edit-commands.js';
import { parseDxf } from '../src/cad/dxf.js';
import { createLayer, ensureEntityIds } from '../src/cad/document.js';

const doc = () => ({
    currentLayer: 'ATUAL',
    layers: ['0', 'ATUAL', 'VAZIA', 'USADA', 'SO_BLOCO', 'BLOCO_MORTO', 'TRAVADA'].map((n) => createLayer(n, { locked: n === 'TRAVADA' })),
    blocks: {
        PECA: { basePoint: { x: 0, y: 0 }, entities: [{ type: 'line', layer: 'SO_BLOCO', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }, { type: 'insert', name: 'FURO', layer: '0' }] },
        FURO: { basePoint: { x: 0, y: 0 }, entities: [{ type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: 1 }] },
        SOBRA: { basePoint: { x: 0, y: 0 }, entities: [{ type: 'line', layer: 'BLOCO_MORTO', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] },
    },
    entities: [
        { id: 'a', type: 'line', layer: 'USADA', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
        { id: 'b', type: 'insert', name: 'PECA', layer: '0', position: { x: 0, y: 0 } },
        { id: 'z', type: 'line', layer: 'USADA', start: { x: 2, y: 2 }, end: { x: 2, y: 2 } },
        { id: 'c', type: 'circle', layer: 'USADA', center: { x: 0, y: 0 }, radius: 0 },
        { id: 'p', type: 'polyline', layer: 'USADA', vertices: [{ x: 1, y: 1, bulge: 0 }, { x: 1, y: 1, bulge: 0 }] },
        { id: 't', type: 'text', layer: 'USADA', position: { x: 0, y: 0 }, text: '  ' },
        { id: 'k', type: 'line', layer: 'TRAVADA', start: { x: 3, y: 3 }, end: { x: 3, y: 3 } },
    ],
});

test('limpeza remove camadas e blocos sem uso, seguindo blocos aninhados', () => {
    const { doc: out, removed } = purgeDocument(doc());
    assert.deepEqual(removed.blocks, ['SOBRA']);
    assert.deepEqual(removed.layers.sort(), ['BLOCO_MORTO', 'VAZIA']);
    assert.deepEqual(Object.keys(out.blocks).sort(), ['FURO', 'PECA']);
    assert.ok(out.layers.some((l) => l.name === 'SO_BLOCO'), 'camada usada só dentro de bloco fica');
    assert.ok(out.layers.some((l) => l.name === 'ATUAL'), 'camada atual fica');
    assert.equal(removed.zeroLength, 3);
    assert.equal(removed.emptyText, 1);
    assert.deepEqual(out.entities.map((x) => x.id), ['a', 'b', 'k'], 'camada bloqueada protege a entidade');
});

test('limpeza só de camadas não mexe em blocos nem geometria', () => {
    const { doc: out, removed } = purgeDocument(doc(), { layers: true, blocks: false, zeroLength: false, emptyText: false });
    assert.deepEqual(removed.layers, ['VAZIA']);
    assert.equal(out.entities.length, 7);
    assert.equal(Object.keys(out.blocks).length, 3);
});

test('nada a limpar devolve listas vazias', () => {
    const d = { currentLayer: '0', layers: [createLayer('0')], entities: [{ id: 'a', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] };
    const { removed, doc: out } = purgeDocument(d);
    assert.deepEqual(removed, { layers: [], blocks: [], zeroLength: 0, emptyText: 0 });
    assert.equal(out.blocks, undefined);
});

test('overkill une linhas colineares sobrepostas e mantém as que só se tocam', () => {
    const L = (id, x1, y1, x2, y2, layer = '0') => ({ id, type: 'line', layer, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
    const { replacements, removed } = mergeOverlappingLines([
        L('a', 0, 0, 10, 0), L('b', 5, 0, 15, 0), L('c', 15, 0, 20, 0),
        L('d', 0, 5, 3, 5), L('e', 1, 5, 2, 5, 'OUTRA'), L('v', 2, 1, 2, 9), L('w', 2, 4, 2, 6),
    ]);
    assert.deepEqual([...removed].sort(), ['b', 'w']);
    const a = replacements.get('a');
    assert.deepEqual([a.start, a.end], [{ x: 0, y: 0 }, { x: 15, y: 0 }]);
    assert.ok(replacements.has('v'));
});

// DXF de cliente: não vai para a versão pública, que roda sem ele.
const overkillDxf = resolve('tests/Fixtures/cad-overkill-miguel.dxf');

test('overkill no DXF do Miguel une as linhas repetidas por trecho', { skip: !existsSync(overkillDxf) && 'DXF privado ausente' }, () => {
    const doc = ensureEntityIds(parseDxf(readFileSync(overkillDxf, 'utf8')));
    const lines = doc.entities.filter((x) => x.type === 'line');
    const { removed } = mergeOverlappingLines(lines);
    assert.equal(removed.size, 23);
    const again = lines.filter((x) => !removed.has(x.id)).map((x) => mergeOverlappingLines(lines).replacements.get(x.id) ?? x);
    assert.equal(mergeOverlappingLines(again).removed.size, 0, 'segunda passada não acha mais nada');
});

test('overkill respeita a tolerância informada', () => {
    const L = (id, x1, y1, x2, y2) => ({ id, type: 'line', layer: '0', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
    const lines = [L('a', 0, 0, 10, 0), L('b', 5, 0.005, 15, 0.005)];
    assert.equal(mergeOverlappingLines(lines, 0.001).removed.size, 0);
    assert.deepEqual([...mergeOverlappingLines(lines, 0.01).removed], ['b']);
});
