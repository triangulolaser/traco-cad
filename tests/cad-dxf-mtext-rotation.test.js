import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';

const mtextDxf = (code50) => [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'MTEXT', '8', '0', '100', 'AcDbEntity', '100', 'AcDbMText',
    '10', '10', '20', '20', '30', '0', '40', '4.2', '71', '1',
    '1', 'CIMA 9.29° R 4.2 K0.48', '50', String(code50),
    '0', 'ENDSEC', '0', 'EOF', '',
].join('\n');

test('MTEXT: código 50 é lido em graus, inclusive ângulos pequenos', () => {
    for (const angle of [0, 1.5, 3, 5.2, 6.28, 9.29, 45, 177.8, -3.4, 270]) {
        const [text] = parseDxf(mtextDxf(angle)).entities;
        assert.ok(Math.abs(text.rotation - angle) < 1e-9, `${angle}° virou ${text.rotation}°`);
    }
});

test('MTEXT: vetor de direção (11/21) continua tendo prioridade sobre o código 50', () => {
    const dxf = mtextDxf(3).replace('\n50\n3\n', '\n11\n0\n21\n1\n31\n0\n50\n3\n');
    const [text] = parseDxf(dxf).entities;
    assert.ok(Math.abs(text.rotation - 90) < 1e-9);
});

test('MTEXT inclinado salvo pelo Traço reabre com o mesmo ângulo', () => {
    const angles = [2.5, 4, 6, 12, -5];
    const doc = {
        ...createDocument(),
        entities: angles.map((rotation, i) => ({ id: String(i + 1), type: 'text', isMText: true, text: `Linha ${i}\nK0.48`, position: { x: 10, y: 10 * i }, height: 4.2, rotation })),
    };
    const reopened = parseDxf(writeDxf(doc)).entities.filter((e) => e.type === 'text');
    assert.deepEqual(reopened.map((e) => Math.round(e.rotation * 1e6) / 1e6), angles);
});
