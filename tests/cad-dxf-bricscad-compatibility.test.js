import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument, addEntities } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';

test('writeDxf: estrutura canônica AC1015 compatível com BricsCAD e AutoCAD sem ponteiros nulos', () => {
    const doc = addEntities(createDocument(), [
        { type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 100, y: 50 } },
        { type: 'circle', layer: '0', center: { x: 50, y: 25 }, radius: 10 },
        { type: 'arc', layer: '0', center: { x: 20, y: 20 }, radius: 15, start: 0, end: Math.PI },
    ]);

    const dxf = writeDxf(doc);

    // BricsCAD rejeita com "Id de objeto nulo: <object> (0)" se encontrar 330 com valor 0.
    assert.doesNotMatch(dxf, /\n330\r?\n0\r?\n/, 'DXF não pode conter grupo 330 com valor 0 (kNull ObjectId)');

    // 1. HEADER deve conter $TEXTSTYLE e $DIMSTYLE apontando para STANDARD
    assert.match(dxf, /\$TEXTSTYLE\r?\n7\r?\nSTANDARD\r?\n/, 'HEADER deve definir $TEXTSTYLE como STANDARD');
    assert.match(dxf, /\$DIMSTYLE\r?\n2\r?\nSTANDARD\r?\n/, 'HEADER deve definir $DIMSTYLE como STANDARD');

    // 2. VPORT ativa canônica
    assert.match(dxf, /TABLE\r?\n2\r?\nVPORT[\s\S]*?VPORT\r?\n5\r?\n[0-9A-Fa-f]+[\s\S]*?2\r?\n\*ACTIVE\r?\n/, 'Deve conter tabela VPORT com registro *ACTIVE');

    // 3. APPID ACAD completo com handle e subclasses
    assert.match(dxf, /TABLE\r?\n2\r?\nAPPID[\s\S]*?100\r?\nAcDbSymbolTableRecord\r?\n100\r?\nAcDbRegAppTableRecord\r?\n2\r?\nACAD\r?\n/, 'Deve conter APPID ACAD completo');

    // 4. STYLE com registro STANDARD
    assert.match(dxf, /TABLE\r?\n2\r?\nSTYLE[\s\S]*?2\r?\nSTANDARD\r?\n/, 'Tabela STYLE deve conter entrada STANDARD');

    // 5. DIMSTYLE com registro STANDARD e subclasse AcDbDimStyleTable
    assert.match(dxf, /TABLE\r?\n2\r?\nDIMSTYLE[\s\S]*?100\r?\nAcDbDimStyleTable[\s\S]*?2\r?\nSTANDARD\r?\n/, 'Tabela DIMSTYLE deve conter subclasse e entrada STANDARD');

    // 6. BLOCK_RECORD com *Model_Space e *Paper_Space
    assert.match(dxf, /TABLE\r?\n2\r?\nBLOCK_RECORD[\s\S]*?2\r?\n\*Model_Space[\s\S]*?2\r?\n\*Paper_Space[\s\S]*?ENDTAB/, 'Deve conter BLOCK_RECORD com *Model_Space e *Paper_Space');

    // 7. BLOCKS com definições de *Model_Space e *Paper_Space
    assert.match(dxf, /SECTION\r?\n2\r?\nBLOCKS[\s\S]*?BLOCK[\s\S]*?2\r?\n\*Model_Space[\s\S]*?ENDBLK[\s\S]*?BLOCK[\s\S]*?2\r?\n\*Paper_Space[\s\S]*?ENDBLK/, 'Seção BLOCKS deve conter blocos *Model_Space e *Paper_Space');

    // 8. Seção OBJECTS limpa (sem dicionários órfãos com handles arbitrários)
    assert.match(dxf, /SECTION\r?\n2\r?\nOBJECTS\r?\n0\r?\nENDSEC\r?\n0\r?\nEOF/, 'Seção OBJECTS deve ser limpa');

    // 9. Valida que nenhum ponteiro DXF (330, 340, 350, 360, 390) aponta para 0
    const lines = dxf.split(/\r?\n/);
    const pointerCodes = new Set(['330', '340', '350', '360', '390']);
    for (let i = 0; i < lines.length - 1; i += 2) {
        const code = lines[i].trim();
        const value = lines[i + 1]?.trim();
        if (pointerCodes.has(code)) {
            assert.notEqual(value, '0', `Código de grupo ${code} na linha ${i + 1} não pode apontar para 0`);
            assert.ok(/^[0-9A-Fa-f]+$/.test(value), `Código de grupo ${code} deve conter handle hexadecimal válido`);
        }
    }

    // 10. Roundtrip de importação continua íntegro
    const reimported = parseDxf(dxf);
    assert.equal(reimported.entities.length, 3);
});

test('parseBlocks: ignora layouts anônimos (*Model_Space e *Paper_Space) para não poluir doc.blocks', () => {
    const rawDxf = [
        '0', 'SECTION',
        '2', 'BLOCKS',
        '0', 'BLOCK',
        '2', '*Model_Space',
        '10', '0', '20', '0', '30', '0',
        '0', 'ENDBLK',
        '0', 'BLOCK',
        '2', '*Paper_Space',
        '10', '0', '20', '0', '30', '0',
        '0', 'ENDBLK',
        '0', 'BLOCK',
        '2', 'MeuBloco',
        '10', '0', '20', '0', '30', '0',
        '0', 'LINE',
        '8', '0',
        '10', '0', '20', '0', '30', '0',
        '11', '10', '21', '10', '31', '0',
        '0', 'ENDBLK',
        '0', 'ENDSEC',
        '0', 'SECTION',
        '2', 'ENTITIES',
        '0', 'INSERT',
        '2', 'MeuBloco',
        '10', '5', '20', '5', '30', '0',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const doc = parseDxf(rawDxf);
    // Deve conter apenas as entidades expandidas do bloco do usuário MeuBloco
    assert.equal(doc.entities.length, 1);
    assert.equal(doc.entities[0].type, 'line');

    // Ao reescrever o DXF, a tabela BLOCK_RECORD deve conter *Model_Space, *Paper_Space
    const exportedDxf = writeDxf(doc);
    assert.match(exportedDxf, /TABLE\r?\n2\r?\nBLOCK_RECORD[\s\S]*?2\r?\n\*Model_Space/);
    assert.match(exportedDxf, /TABLE\r?\n2\r?\nBLOCK_RECORD[\s\S]*?2\r?\n\*Paper_Space/);
});
