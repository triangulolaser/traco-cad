// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDocument, addEntities, updateEntities, LINETYPES, LINEWEIGHTS, aciToHex } from '../src/cad/document.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';

test('cad.js contém controles para layer, cor, linetype, lineweight e tamanho do texto na barra de propriedades', () => {
    const cadJsPath = resolve(process.cwd(), 'src/cad.js');
    const content = readFileSync(cadJsPath, 'utf-8');

    assert.match(content, /data-prop="layer"/, 'Deve conter controle de layer');
    assert.match(content, /data-prop="color"/, 'Deve conter seletor de cor');
    assert.match(content, /data-prop="color-picker"/, 'Deve conter color picker nativo acessível via swatch');
    assert.match(content, /data-prop="linetype"/, 'Deve conter select de tipo de linha');
    assert.match(content, /data-prop="lineweight"/, 'Deve conter select de espessura de linha');
    assert.match(content, /data-prop="text-height"/, 'Deve conter input de tamanho de texto');
    assert.match(content, /Tipo de linha dos objetos/, 'Deve registrar commit com label descritivo de tipo de linha');
    assert.match(content, /Espessura dos objetos/, 'Deve registrar commit com label descritivo de espessura');
    assert.match(content, /Tamanho do texto/, 'Deve registrar commit com label descritivo de tamanho do texto');
});

test('cad.css estiliza o swatch da cor e os seletores da barra de propriedades', () => {
    const cadCssPath = resolve(process.cwd(), 'src/styles/cad.css');
    const content = readFileSync(cadCssPath, 'utf-8');

    assert.ok(content.includes('.cad-prop-swatch'), 'Deve conter classe .cad-prop-swatch');
    assert.ok(content.includes('cursor: pointer'), 'Deve conter cursor: pointer no swatch');
    assert.ok(content.includes('.cad-prop-swatch:hover'), 'Deve conter hover do swatch');
});

test('dimensions.js: effectiveStyle respeita customização individual de textHeight na cota', () => {
    const doc = createDocument();
    doc.dimStyle = { textHeight: 2.5, arrowSize: 2.5, extOffset: 0.625, extBeyond: 1.25, textGap: 0.9, precision: 2, scale: 1 };

    const cotaPadrao = {
        id: 'dim1',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 100, y: 0 },
        linePoint: { x: 50, y: 20 },
    };

    const cotaCustomizada = {
        ...cotaPadrao,
        id: 'dim2',
        textHeight: 5.0,
    };

    const gPadrao = dimensionGeometry(cotaPadrao, doc.dimStyle);
    const gCustom = dimensionGeometry(cotaCustomizada, doc.dimStyle);

    assert.equal(gPadrao.texts[0].height, 2.5, 'Cota padrão deve usar textHeight do dimStyle');
    assert.equal(gCustom.texts[0].height, 5.0, 'Cota customizada deve usar textHeight definido na entidade');
});

test('updateEntities aplica edições de propriedades em lote para layer, cor, linetype, lineweight e tamanho de texto', () => {
    let doc = createDocument();
    doc = addEntities(doc, [
        { id: 'cota1', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 80, y: 0 }, linePoint: { x: 40, y: 15 }, layer: '0', color: 'bylayer' },
        { id: 'cota2', type: 'dimension', kind: 'vertical', p1: { x: 0, y: 0 }, p2: { x: 0, y: 50 }, linePoint: { x: -10, y: 25 }, layer: '0', color: 'bylayer' },
        { id: 'txt1', type: 'text', text: 'CORTE A-A', position: { x: 10, y: 10 }, height: 2.5, layer: '0', color: 'bylayer' },
        { id: 'linha1', type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, layer: '0', color: 'bylayer' },
    ]);

    const selectionIds = ['cota1', 'cota2', 'txt1'];

    // 1. Alterar Layer
    doc = updateEntities(doc, selectionIds, (e) => ({ ...e, layer: 'COTAS' }));
    assert.equal(doc.entities.find(e => e.id === 'cota1')?.layer, 'COTAS');
    assert.equal(doc.entities.find(e => e.id === 'cota2')?.layer, 'COTAS');
    assert.equal(doc.entities.find(e => e.id === 'txt1')?.layer, 'COTAS');
    assert.equal(doc.entities.find(e => e.id === 'linha1')?.layer, '0', 'Entidade não selecionada preserva layer');

    // 2. Alterar Cor (ACI 1 = Vermelho)
    doc = updateEntities(doc, selectionIds, (e) => ({ ...e, color: 1 }));
    assert.equal(doc.entities.find(e => e.id === 'cota1')?.color, 1);
    assert.equal(doc.entities.find(e => e.id === 'cota2')?.color, 1);
    assert.equal(doc.entities.find(e => e.id === 'txt1')?.color, 1);

    // 3. Alterar Tipo de Linha (DASHED)
    doc = updateEntities(doc, selectionIds, (e) => ({ ...e, lineType: 'DASHED' }));
    assert.equal(doc.entities.find(e => e.id === 'cota1')?.lineType, 'DASHED');
    assert.equal(doc.entities.find(e => e.id === 'cota2')?.lineType, 'DASHED');

    // 4. Alterar Espessura (35 = 0.35 mm)
    doc = updateEntities(doc, selectionIds, (e) => ({ ...e, lineWeight: 35 }));
    assert.equal(doc.entities.find(e => e.id === 'cota1')?.lineWeight, 35);
    assert.equal(doc.entities.find(e => e.id === 'cota2')?.lineWeight, 35);

    // 5. Alterar Tamanho do Texto (4.0 mm)
    const newTextHeight = 4.0;
    doc = updateEntities(doc, selectionIds, (e) => {
        if (e.type === 'text') {
            return { ...e, height: newTextHeight };
        }
        if (e.type === 'dimension') {
            return {
                ...e,
                textHeight: newTextHeight,
                style: { ...(e.style ?? {}), textHeight: newTextHeight },
            };
        }
        return e;
    });

    const cota1Atualizada = doc.entities.find(e => e.id === 'cota1');
    const txt1Atualizado = doc.entities.find(e => e.id === 'txt1');
    assert.equal(cota1Atualizada?.textHeight, 4.0, 'Cota deve atualizar textHeight');
    assert.equal(cota1Atualizada?.style?.textHeight, 4.0, 'Cota deve sincronizar style.textHeight');
    assert.equal(txt1Atualizado?.height, 4.0, 'Texto deve atualizar height');

    // Validar geometria resultante recalculada com novo tamanho
    const geo = dimensionGeometry(cota1Atualizada, doc.dimStyle);
    assert.equal(geo.texts[0].height, 4.0, 'dimensionGeometry deve renderizar texto na altura 4.0');
});

test('dxf.js lê e preserva lineType e lineWeight ao importar entidades', async () => {
    const { parseDxf, writeDxf } = await import('../src/cad/dxf.js');

    const dxfSource = `0
SECTION
2
ENTITIES
0
LINE
8
0
6
DASHED
370
35
10
0.0
20
0.0
11
100.0
21
50.0
0
ENDSEC
0
EOF`;

    const doc = parseDxf(dxfSource);
    const line = doc.entities.find(e => e.type === 'line');
    assert.ok(line, 'Deveria encontrar a linha');
    assert.equal(line.lineType, 'DASHED', 'lineType deve ser importado');
    assert.equal(line.lineWeight, 35, 'lineWeight deve ser importado');

    // Roundtrip de exportação
    const exportedDxf = writeDxf(doc);
    assert.match(exportedDxf, /6\r?\nDASHED/, 'Deve exportar grupo 6 DASHED');
    assert.match(exportedDxf, /370\r?\n35/, 'Deve exportar grupo 370 35');
});
