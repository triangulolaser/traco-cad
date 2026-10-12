import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { createDocument } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';

test('writeDxf converte texto com quebras de linha em MTEXT com \\P preservando paridade estrita de códigos de grupo', () => {
    const doc = {
        ...createDocument(),
        entities: [
            { id: '1', type: 'text', text: 'Linha 1\nLinha 2\nLinha 3', position: { x: 10, y: 20 }, height: 5 },
            { id: '2', type: 'text', text: 'Pistão\nRoda Dianteira Cabine', position: { x: 50, y: 60 }, height: 4, halign: 'center' },
            { id: '3', type: 'text', text: '\nDescarga\nSobe/Desce\n', position: { x: 80, y: 90 }, height: 3.5 },
            { id: '4', type: 'text', text: 'Linha CRLF 1\r\nLinha CRLF 2', position: { x: 120, y: 130 }, height: 4 },
            { id: '5', type: 'text', text: 'C1-P30\n', position: { x: 200, y: 200 }, height: 2.5 },
        ],
    };

    const dxf = writeDxf(doc);
    const lines = dxf.trim().split(/\r?\n/);

    // Auditoria de alternância: Toda linha de índice par (0, 2, 4...) DEVE ser um código de grupo inteiro
    const badCodes = [];
    for (let i = 0; i < lines.length; i += 2) {
        const code = lines[i].trim();
        if (!/^-?\d+$/.test(code)) {
            badCodes.push({ lineIndex: i + 1, code, prevValue: lines[i - 1] });
        }
    }

    assert.equal(badCodes.length, 0, `Nenhum código de grupo inválido pode existir no DXF gerado: ${JSON.stringify(badCodes)}`);

    // Nenhum valor de grupo 1 pode conter quebras de linha brutas
    for (let i = 0; i < lines.length; i += 2) {
        if (lines[i] === '1') {
            const val = lines[i + 1];
            assert.ok(!val.includes('\n'), 'Valor do grupo 1 não pode ter quebra de linha bruta');
            assert.ok(!val.includes('\r'), 'Valor do grupo 1 não pode ter retorno de carro bruto');
        }
    }

    // Leitura reversa: deve restaurar as entidades com fidelidade
    const reloaded = parseDxf(dxf);
    assert.equal(reloaded.entities.length, 5);

    const ent1 = reloaded.entities.find((e) => e.text.includes('Linha 1'));
    assert.ok(ent1);
    assert.equal(ent1.isMText, true);
    assert.equal(ent1.text, 'Linha 1\nLinha 2\nLinha 3');

    const ent2 = reloaded.entities.find((e) => e.text.includes('Pistão'));
    assert.ok(ent2);
    assert.equal(ent2.isMText, true);
    assert.equal(ent2.text, 'Pistão\nRoda Dianteira Cabine');
    assert.equal(ent2.halign, 'center');
});

test('writeDxf em entidades de blocos converte textos multi-linha em MTEXT sem desincronizar BLOCKS', () => {
    const doc = {
        ...createDocument(),
        blocks: {
            PAINEL_TESTE: {
                basePoint: { x: 0, y: 0 },
                entities: [
                    { id: 'b1', type: 'text', text: 'Pistão\nRoda Traseira Direita', position: { x: 0, y: 0 }, height: 4 },
                    { id: 'b2', type: 'text', text: 'Sensor\nTransmissão', position: { x: 10, y: 10 }, height: 3 },
                ],
            },
        },
        entities: [
            { id: 'i1', type: 'insert', name: 'PAINEL_TESTE', position: { x: 100, y: 100 }, scaleX: 1, scaleY: 1, rotation: 0 },
        ],
    };

    const dxf = writeDxf(doc);
    const lines = dxf.trim().split(/\r?\n/);

    const badCodes = [];
    for (let i = 0; i < lines.length; i += 2) {
        const code = lines[i].trim();
        if (!/^-?\d+$/.test(code)) {
            badCodes.push({ lineIndex: i + 1, code });
        }
    }
    assert.equal(badCodes.length, 0);

    const reloaded = parseDxf(dxf, { preserveBlocks: true });
    assert.ok(reloaded.blocks.PAINEL_TESTE);
    assert.equal(reloaded.blocks.PAINEL_TESTE.entities.length, 2);
    assert.equal(reloaded.blocks.PAINEL_TESTE.entities[0].text, 'Pistão\nRoda Traseira Direita');
    assert.equal(reloaded.blocks.PAINEL_TESTE.entities[1].text, 'Sensor\nTransmissão');
});

test('Auditoria estrutural: Diagrama Eletrônica exportado não possui nenhum código de grupo inválido', () => {
    const filePath = '/Users/usuario/Downloads/Diagrama Eletrônica.dxf';
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split(/\r?\n/);

    const badCodes = [];
    for (let i = 0; i < lines.length; i += 2) {
        const code = lines[i].trim();
        if (!/^-?\d+$/.test(code)) {
            badCodes.push({ lineIndex: i + 1, code });
            if (badCodes.length > 5) break;
        }
    }

    assert.equal(badCodes.length, 0, `O arquivo DXF em disco deve ter 0 códigos inválidos (encontrado ${badCodes.length})`);

    const doc = parseDxf(content, { preserveBlocks: true, preserveDimensions: true });
    assert.ok(doc.entities.length >= 2900, 'Todas as entidades devem ser lidas');
    assert.ok(Object.keys(doc.blocks).length >= 10, 'Todos os blocos devem ser preservados');
});
