import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { dwgToDocument, dwgToDxfText, documentToDwg } from '../src/cad/dwg.js';

test('dwgToDocument lê arquivo DWG real em memória preservando entidades, camadas e viewport', async () => {
    const fixturePath = '/Users/usuario/Downloads/new block1234567.dwg';
    if (!fs.existsSync(fixturePath)) return;
    const buffer = fs.readFileSync(fixturePath);
    const doc = await dwgToDocument(buffer, { name: 'new block1234567.dwg', filePath: fixturePath });

    assert.equal(doc.name, 'new block1234567.dwg');
    assert.equal(doc.sourceFormat, 'dwg');
    assert.equal(doc.filePath, fixturePath);
    assert.ok(doc.entities.length >= 10, 'deve conter entidades 2D');
    assert.ok(doc.layers.length >= 1, 'deve conter camadas');
    assert.ok(doc.view, 'deve conter dados da viewport salvos no DWG');
    assert.ok(Number.isFinite(doc.view.center.x));
    assert.ok(Number.isFinite(doc.view.center.y));
    assert.ok(doc.view.height > 0);
});

test('dwgToDocument lê desenho industrial complexo (Diagrama Eletrônica.dwg) com milhares de entidades e blocos', async () => {
    const fixturePath = '/Users/usuario/Downloads/Diagrama Eletrônica.dwg';
    if (!fs.existsSync(fixturePath)) return;
    const buffer = fs.readFileSync(fixturePath);
    const doc = await dwgToDocument(buffer, { name: 'Diagrama Eletrônica.dwg' });

    assert.equal(doc.sourceFormat, 'dwg');
    assert.ok(doc.entities.length > 2000, `deve ter milhares de entidades (encontrado ${doc.entities.length})`);
    assert.ok(doc.layers.length >= 7, 'deve ter pelo menos 7 layers');
    assert.ok(Object.keys(doc.blocks).length >= 10, 'deve conter blocos');
    assert.ok(doc.view, 'deve conter viewport recuperada');
});

test('dwgToDxfText converte buffer DWG em texto DXF ASCII diretamente em memória', async () => {
    const fixturePath = '/Users/usuario/Downloads/new block1234567.dwg';
    if (!fs.existsSync(fixturePath)) return;
    const buffer = fs.readFileSync(fixturePath);
    const dxfText = await dwgToDxfText(buffer);

    assert.equal(typeof dxfText, 'string');
    assert.ok(dxfText.includes('SECTION'), 'DXF deve conter seções');
    assert.ok(dxfText.includes('HEADER'), 'DXF deve conter cabeçalho');
    assert.ok(dxfText.includes('ENTITIES'), 'DXF deve conter entidades');
    assert.ok(dxfText.includes('EOF'), 'DXF deve conter EOF');
});

test('documentToDwg serializa documento do Traço CAD em binário DWG válido', async () => {
    const doc = {
        layers: [
            { name: '0', color: '#ffffff', visible: true, locked: false },
            { name: 'PECA_CORTE', color: '#00ff00', visible: true, locked: false },
            { name: 'COTAS', color: '#ff0000', visible: true, locked: false },
        ],
        entities: [
            { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 150, y: 0 }, layer: 'PECA_CORTE' },
            { id: '2', type: 'circle', center: { x: 75, y: 75 }, radius: 25, layer: '0' },
            { id: '3', type: 'arc', center: { x: 50, y: 50 }, radius: 20, start: 0, end: Math.PI, layer: 'PECA_CORTE' },
            {
                id: '4',
                type: 'polyline',
                vertices: [
                    { x: 10, y: 10, bulge: 0.2 },
                    { x: 30, y: 10 },
                    { x: 30, y: 30 },
                ],
                closed: true,
                layer: 'PECA_CORTE',
            },
            { id: '5', type: 'text', position: { x: 10, y: 5 }, text: 'Exemplo Engenharia', height: 4, rotation: 0, layer: '0' },
            { id: '6', type: 'point', position: { x: 100, y: 100 }, layer: '0' },
            ...DWG_ROUNDTRIP_EXTRAS,
        ],
        units: 'mm',
        view: {
            center: { x: 75, y: 50 },
            height: 180,
            aspectRatio: 1.6,
        },
    };

    const dwgBytes = await documentToDwg(doc);
    assert.ok(dwgBytes instanceof Uint8Array);
    assert.ok(dwgBytes.length > 1000, `Tamanho gerado do DWG deve ser razoável (${dwgBytes.length} bytes)`);

    // Valida roundtrip: reabre o binário gerado com dwgToDocument
    const restored = await dwgToDocument(dwgBytes, { name: 'teste_saida.dwg' });
    assert.equal(restored.name, 'teste_saida.dwg');
    assert.equal(restored.sourceFormat, 'dwg');
    assert.deepEqual(countByType(restored.entities), countByType(doc.entities), 'DWG deve preservar todos os tipos de entidade');
    assert.ok(restored.layers.some((l) => l.name === 'PECA_CORTE'), 'deve conter a camada PECA_CORTE');
    assert.ok(restored.view, 'deve preservar viewport');
    assert.ok(Math.abs(restored.view.center.x - 75) < 1, 'centro X deve ser ~75');
    assert.ok(Math.abs(restored.view.center.y - 50) < 1, 'centro Y deve ser ~50');
    assert.ok(Math.abs(restored.view.height - 180) < 5, 'altura visual deve ser ~180');

    const dim = restored.entities.find((e) => e.type === 'dimension');
    assert.equal(dim.layer, 'COTAS');
    assert.ok(Math.abs(dim.p1.x - 0) < 1e-6 && Math.abs(dim.p2.x - 150) < 1e-6, 'cota mantém os pontos medidos');
    const hatch = restored.entities.find((e) => e.type === 'hatch');
    assert.equal(hatch.loops[0].vertices.length, 4, 'hachura mantém o contorno');
    const spline = restored.entities.find((e) => e.type === 'spline');
    assert.equal(spline.controlPoints.length, 4, 'spline mantém os pontos de controle');
    assert.ok(restored.entities.some((e) => e.type === 'text' && e.text === 'Exemplo Engenharia'));
});

test('documentToDwg preserva blocos e inserções', async () => {
    const doc = {
        layers: [{ name: '0', color: '#ffffff', visible: true, locked: false }],
        blocks: {
            FURO: { basePoint: { x: 0, y: 0 }, entities: [{ type: 'circle', center: { x: 0, y: 0 }, radius: 5, layer: '0' }] },
        },
        entities: [
            { id: 'i1', type: 'insert', name: 'FURO', position: { x: 10, y: 10 }, scaleX: 1, scaleY: 1, rotation: 0, layer: '0' },
            { id: 'i2', type: 'insert', name: 'FURO', position: { x: 40, y: 10 }, scaleX: 1, scaleY: 1, rotation: 0, layer: '0' },
        ],
        units: 'mm',
    };
    const restored = await dwgToDocument(await documentToDwg(doc));
    assert.ok(restored.blocks.FURO, 'bloco FURO deve existir no DWG');
    assert.equal(restored.entities.filter((e) => e.type === 'insert' && e.name === 'FURO').length, 2);
});

const DWG_ROUNDTRIP_EXTRAS = [
    {
        id: '7', type: 'dimension', kind: 'horizontal', layer: 'COTAS',
        p1: { x: 0, y: 0 }, p2: { x: 150, y: 0 }, linePoint: { x: 75, y: -20 },
    },
    {
        id: '8', type: 'hatch', layer: '0', pattern: 'SOLID',
        loops: [{ vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] }],
    },
    {
        id: '9', type: 'spline', layer: '0', degree: 3, closed: false, periodic: false,
        controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 40, y: 0 }],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
    },
    { id: '10', type: 'ellipse', layer: '0', center: { x: 200, y: 0 }, major: { x: 30, y: 0 }, ratio: 0.5, start: 0, end: Math.PI * 2 },
];

function countByType(entities) {
    return entities.reduce((acc, e) => ({ ...acc, [e.type]: (acc[e.type] || 0) + 1 }), {});
}
