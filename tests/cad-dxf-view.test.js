import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument, addEntities } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { Viewport } from '../src/cad/viewport.js';

test('Viewport: getView e setView realizam roundtrip matemático exato de zoom e pan', () => {
    const vp = new Viewport(1000, 500); // 1000x500 pixels (aspect ratio = 2.0)

    // Define uma visualização específica: centro em (250, -120), altura de 200mm
    const ok = vp.setView({ center: { x: 250, y: -120 }, height: 200 });
    assert.equal(ok, true, 'setView deve retornar true para parâmetros válidos');

    // Escala esperada: 500px / 200mm = 2.5 px/mm
    assert.equal(vp.scale, 2.5);

    const view = vp.getView();
    assert.ok(Math.abs(view.center.x - 250) < 1e-9, `Centro X esperado 250, obtido ${view.center.x}`);
    assert.ok(Math.abs(view.center.y - (-120)) < 1e-9, `Centro Y esperado -120, obtido ${view.center.y}`);
    assert.ok(Math.abs(view.height - 200) < 1e-9, `Altura esperada 200, obtido ${view.height}`);
    assert.ok(Math.abs(view.aspectRatio - 2.0) < 1e-9, `Aspect ratio esperado 2.0, obtido ${view.aspectRatio}`);

    // Rejeição de entradas inválidas
    assert.equal(vp.setView({ center: { x: 0, y: 0 }, height: 0 }), false);
    assert.equal(vp.setView({ center: { x: 0, y: 0 }, height: -50 }), false);
    assert.equal(vp.setView({ center: { x: NaN, y: 0 }, height: 100 }), false);
    assert.equal(vp.setView(null), false);
});

test('writeDxf: grava $VIEWCTR e $VIEWSIZE no HEADER e VPORT *ACTIVE com dados da viewport', () => {
    const doc = addEntities(createDocument(), [
        { type: 'line', layer: '0', start: { x: 100, y: 100 }, end: { x: 200, y: 200 } },
    ]);
    doc.view = {
        center: { x: 150.5, y: 75.25 },
        height: 320.0,
        aspectRatio: 1.6,
    };

    const dxf = writeDxf(doc);

    // 1. Deve gravar $VIEWCTR no HEADER
    assert.match(dxf, /\$VIEWCTR\r?\n10\r?\n150\.5\r?\n20\r?\n75\.25\r?\n30\r?\n0\r?\n/, 'HEADER deve conter $VIEWCTR com centro X e Y');

    // 2. Deve gravar $VIEWSIZE no HEADER
    assert.match(dxf, /\$VIEWSIZE\r?\n40\r?\n320\r?\n/, 'HEADER deve conter $VIEWSIZE com a altura da visão');

    // 3. Deve gravar $VIEWDIR no HEADER
    assert.match(dxf, /\$VIEWDIR\r?\n10\r?\n0\r?\n20\r?\n0\r?\n30\r?\n1\r?\n/, 'HEADER deve conter $VIEWDIR');

    // 4. Deve gravar registro *ACTIVE na tabela VPORT com o centro (12, 22), altura (40) e proporção (41)
    assert.match(dxf, /TABLE\r?\n2\r?\nVPORT[\s\S]*?2\r?\n\*ACTIVE[\s\S]*?12\r?\n150\.5\r?\n22\r?\n75\.25[\s\S]*?40\r?\n320[\s\S]*?41\r?\n1\.6/, 'VPORT *ACTIVE deve conter centro, altura e aspect ratio');
});

test('writeDxf: aceita override explícito de view via opções', () => {
    const doc = addEntities(createDocument(), [
        { type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 50, y: 50 } },
    ]);
    // doc.view não definido; passado via options.view
    const dxf = writeDxf(doc, {
        view: { center: { x: -80, y: 40 }, height: 180, aspectRatio: 1.333333 },
    });

    assert.match(dxf, /\$VIEWCTR\r?\n10\r?\n-80\r?\n20\r?\n40\r?\n/);
    assert.match(dxf, /\$VIEWSIZE\r?\n40\r?\n180\r?\n/);
    assert.match(dxf, /12\r?\n-80\r?\n22\r?\n40[\s\S]*?40\r?\n180[\s\S]*?41\r?\n1\.333333/);
});

test('parseDxf: extrai $VIEWCTR e $VIEWSIZE do cabeçalho', () => {
    const dxfText = [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$ACADVER',
        '1', 'AC1015',
        '9', '$VIEWCTR',
        '10', '325.5',
        '20', '140.2',
        '30', '0.0',
        '9', '$VIEWSIZE',
        '40', '450.0',
        '0', 'ENDSEC',
        '0', 'SECTION',
        '2', 'ENTITIES',
        '0', 'LINE',
        '8', '0',
        '10', '0',
        '20', '0',
        '11', '10',
        '21', '10',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxfText);
    assert.ok(parsed.view, 'Deve retornar objeto view quando presente no cabeçalho');
    assert.equal(parsed.view.center.x, 325.5);
    assert.equal(parsed.view.center.y, 140.2);
    assert.equal(parsed.view.height, 450.0);
});

test('parseDxf: extrai view da tabela VPORT *ACTIVE se HEADER não contiver view', () => {
    const dxfText = [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$ACADVER',
        '1', 'AC1015',
        '0', 'ENDSEC',
        '0', 'SECTION',
        '2', 'TABLES',
        '0', 'TABLE',
        '2', 'VPORT',
        '70', '1',
        '0', 'VPORT',
        '2', '*ACTIVE',
        '12', '75.0',
        '22', '-30.0',
        '40', '220.0',
        '41', '1.5',
        '0', 'ENDTAB',
        '0', 'ENDSEC',
        '0', 'SECTION',
        '2', 'ENTITIES',
        '0', 'CIRCLE',
        '8', '0',
        '10', '75',
        '20', '-30',
        '40', '10',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxfText);
    assert.ok(parsed.view, 'Deve resolver view a partir de VPORT *ACTIVE');
    assert.equal(parsed.view.center.x, 75.0);
    assert.equal(parsed.view.center.y, -30.0);
    assert.equal(parsed.view.height, 220.0);
    assert.equal(parsed.view.aspectRatio, 1.5);
});

test('parseDxf: ignora VPORT *ACTIVE dummy (0,0 / 100) quando entidades estão longe e não há $VIEWCTR', () => {
    // Simula arquivo antigo gerado por exportador simples que gravou VPORT estático 0,0/100,
    // mas com desenho real localizado em 2000, 3000.
    const dxfText = [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$ACADVER',
        '1', 'AC1015',
        '0', 'ENDSEC',
        '0', 'SECTION',
        '2', 'TABLES',
        '0', 'TABLE',
        '2', 'VPORT',
        '70', '1',
        '0', 'VPORT',
        '2', '*ACTIVE',
        '12', '0',
        '22', '0',
        '40', '100',
        '41', '1',
        '0', 'ENDTAB',
        '0', 'ENDSEC',
        '0', 'SECTION',
        '2', 'ENTITIES',
        '0', 'LINE',
        '8', '0',
        '10', '2000',
        '20', '3000',
        '11', '2100',
        '21', '3100',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxfText);
    assert.equal(parsed.view, undefined, 'Deve ignorar VPORT dummy para acionar zoomExtents sobre as entidades');
});

test('Roundtrip DXF: writeDxf preserva com alta fidelidade a visão recuperada pelo parseDxf', () => {
    const doc = addEntities(createDocument(), [
        { type: 'line', layer: '0', start: { x: 50, y: 50 }, end: { x: 500, y: 300 } },
    ]);
    const originalView = {
        center: { x: 275.123456, y: 185.654321 },
        height: 620.5,
        aspectRatio: 1.777778,
    };

    const dxf = writeDxf(doc, { view: originalView });
    const parsed = parseDxf(dxf);

    assert.ok(parsed.view, 'Parsed view deve existir após roundtrip');
    assert.ok(Math.abs(parsed.view.center.x - originalView.center.x) < 1e-4);
    assert.ok(Math.abs(parsed.view.center.y - originalView.center.y) < 1e-4);
    assert.ok(Math.abs(parsed.view.height - originalView.height) < 1e-4);
    assert.ok(Math.abs(parsed.view.aspectRatio - originalView.aspectRatio) < 1e-4);
});
