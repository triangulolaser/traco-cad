import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { textBox, transformEntity } from '../src/cad/geometry.js';
import { createDocument, addEntities } from '../src/cad/document.js';

test('DXF: TEXT com alinhamento padrão (Left, Baseline) usa coordenadas (10, 20)', () => {
    const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'TEXT',
        '8', '0',
        '10', '100.0',
        '20', '200.0',
        '40', '5.0',
        '1', 'TEXTO PADRAO',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 1);
    const text = parsed.entities[0];
    assert.equal(text.type, 'text');
    assert.equal(text.text, 'TEXTO PADRAO');
    assert.equal(text.position.x, 100);
    assert.equal(text.position.y, 200);
    assert.equal(text.halign, 'left');
    assert.equal(text.valign, 'baseline');
});

test('DXF: TEXT com justificativa Center (72=1) e Middle (73=2) adota segundo ponto de alinhamento (11, 21)', () => {
    // No AutoCAD, quando 72 ou 73 != 0, (10, 20) é recalculado ou 0,0, e o ponto especificado é (11, 21).
    const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'TEXT',
        '8', '0',
        '10', '0.0',
        '20', '0.0',
        '11', '150.0',
        '21', '250.0',
        '40', '10.0',
        '72', '1', // Center
        '73', '2', // Middle
        '1', 'LOTE 188',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 1);
    const text = parsed.entities[0];
    assert.equal(text.type, 'text');
    assert.equal(text.text, 'LOTE 188');
    assert.equal(text.position.x, 150);
    assert.equal(text.position.y, 250);
    assert.equal(text.halign, 'center');
    assert.equal(text.valign, 'middle');
});

test('DXF: TEXT com Middle especial (72=4, 73=0) mapeia para center e middle no ponto (11, 21)', () => {
    const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'TEXT',
        '8', 'NOTAS',
        '10', '0.0',
        '20', '0.0',
        '11', '320.0',
        '21', '80.0',
        '40', '3.0',
        '72', '4', // Middle
        '1', 'CHAPA # 1"',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 1);
    const text = parsed.entities[0];
    assert.equal(text.position.x, 320);
    assert.equal(text.position.y, 80);
    assert.equal(text.halign, 'center');
    assert.equal(text.valign, 'middle');
});

test('DXF: MTEXT com Attachment Point 1 (Top-Left) e quebras de linha \\P', () => {
    const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'MTEXT',
        '8', 'NOTAS',
        '10', '50.0',
        '20', '100.0',
        '40', '4.0',
        '71', '1', // Top-Left
        '1', '01 PEÇA\\PCHAPA # 1"',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 1);
    const mtext = parsed.entities[0];
    assert.equal(mtext.type, 'text');
    assert.equal(mtext.text, '01 PEÇA\nCHAPA # 1"');
    assert.equal(mtext.position.x, 50);
    assert.equal(mtext.position.y, 100);
    assert.equal(mtext.attachmentPoint, 1);
    assert.equal(mtext.halign, 'left');
    assert.equal(mtext.valign, 'top');
});

test('DXF: MTEXT com Attachment Point 5 (Middle-Center)', () => {
    const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'MTEXT',
        '8', 'NOTAS',
        '10', '200.0',
        '20', '300.0',
        '40', '8.0',
        '71', '5', // Middle-Center
        '1', 'LOTE 188',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 1);
    const mtext = parsed.entities[0];
    assert.equal(mtext.halign, 'center');
    assert.equal(mtext.valign, 'middle');
});

test('Geometria: textBox projeta caixa delimitadora em torno do ponto de inserção com halign e valign', () => {
    // 1. Left / Baseline: ponto em (100, 200). Texto de altura 10.
    const tLeft = {
        type: 'text',
        position: { x: 100, y: 200 },
        height: 10,
        text: 'TESTE',
        halign: 'left',
        valign: 'baseline',
    };
    const boxLeft = textBox(tLeft);
    // Cantos no mundo CAD: X >= 100, Y >= 200 (pois baseline oy=0)
    assert.ok(boxLeft.every((p) => p.x >= 99.99));
    assert.ok(boxLeft.every((p) => p.y >= 199.99));

    // 2. Center / Middle: ponto em (100, 200). Texto centrado.
    const tCenter = {
        type: 'text',
        position: { x: 100, y: 200 },
        height: 10,
        text: 'TESTE',
        halign: 'center',
        valign: 'middle',
    };
    const boxCenter = textBox(tCenter);
    // Deve haver pontos à esquerda de 100 e à direita de 100; e abaixo de 200 e acima de 200.
    const xs = boxCenter.map((p) => p.x);
    const ys = boxCenter.map((p) => p.y);
    assert.ok(Math.min(...xs) < 100 && Math.max(...xs) > 100);
    assert.ok(Math.min(...ys) < 200 && Math.max(...ys) > 200);

    // 3. Right / Top: ponto em (100, 200). Texto à esquerda e abaixo de (100, 200) no mundo CAD.
    const tRightTop = {
        type: 'text',
        position: { x: 100, y: 200 },
        height: 10,
        text: 'TESTE',
        halign: 'right',
        valign: 'top',
    };
    const boxRightTop = textBox(tRightTop);
    const xsRT = boxRightTop.map((p) => p.x);
    const ysRT = boxRightTop.map((p) => p.y);
    assert.ok(Math.max(...xsRT) <= 100.01);
    assert.ok(Math.max(...ysRT) <= 200.01);
});

test('DXF Roundtrip: writeDxf preserva pares 72/73 e 11/21 para textos com justificação', () => {
    const doc = addEntities(createDocument(), [
        {
            type: 'text',
            position: { x: 120, y: 340 },
            height: 6,
            rotation: 0,
            text: 'COTAS ESPECIAIS',
            halign: 'center',
            valign: 'middle',
        },
    ]);

    const dxf = writeDxf(doc);
    assert.match(dxf, /\n72\n1\n/); // halign: center
    assert.match(dxf, /\n73\n2\n/); // valign: middle
    assert.match(dxf, /\n11\n120(\.0+)?\n/);
    assert.match(dxf, /\n21\n340(\.0+)?\n/);

    const reimported = parseDxf(dxf);
    assert.equal(reimported.entities.length, 1);
    const t = reimported.entities[0];
    assert.equal(t.position.x, 120);
    assert.equal(t.position.y, 340);
    assert.equal(t.halign, 'center');
    assert.equal(t.valign, 'middle');
});
