import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    computeAutoDimScale,
    getDrawingContentBox,
    ensureDimensionSetup,
    DIMENSION_LAYER,
    defaultDimStyle,
    dimensionGeometry,
} from '../src/cad/dimensions.js';
import { createDocument, addEntities, layerOf, entityColor } from '../src/cad/document.js';
import { COMMANDS } from '../src/cad/commands.js';

test('computeAutoDimScale: calcula escala proporcional pelo tamanho retangular máximo', () => {
    // Peças pequenas ou nulas: escala mínima 1.0 (ou proporcional até 0.2 para micro-peças)
    assert.equal(computeAutoDimScale(0), 1);
    assert.equal(computeAutoDimScale(-100), 1);
    assert.equal(computeAutoDimScale(50), 1);
    assert.equal(computeAutoDimScale(100), 1);

    // Peças médias e chapas de corte a laser
    assert.equal(computeAutoDimScale(200), 2);
    assert.equal(computeAutoDimScale(500), 5);
    assert.equal(computeAutoDimScale(1000), 10);
    assert.equal(computeAutoDimScale(1500), 15);
    assert.equal(computeAutoDimScale(2000), 20);
    assert.equal(computeAutoDimScale(3000), 30);

    // Valores intermediários com 1 casa decimal limpa
    assert.equal(computeAutoDimScale(250), 2.5);
    assert.equal(computeAutoDimScale(1250), 12.5);
});

test('getDrawingContentBox: extrai bounding box do conteúdo ignorando cotas', () => {
    const doc = createDocument();
    doc.entities = [
        { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 500, y: 0 } },
        { id: '2', type: 'line', start: { x: 500, y: 0 }, end: { x: 500, y: 300 } },
        { id: '3', type: 'line', start: { x: 500, y: 300 }, end: { x: 0, y: 300 } },
        { id: '4', type: 'line', start: { x: 0, y: 300 }, end: { x: 0, y: 0 } },
        // Cota externa que não deve inflar a caixa do conteúdo
        { id: '5', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 500, y: 0 }, linePoint: { x: 250, y: -100 } },
    ];

    const box = getDrawingContentBox(doc);
    assert.equal(box.minX, 0);
    assert.equal(box.minY, 0);
    assert.equal(box.maxX, 500);
    assert.equal(box.maxY, 300);

    const maxDim = Math.max(box.maxX - box.minX, box.maxY - box.minY);
    assert.equal(maxDim, 500);
    assert.equal(computeAutoDimScale(maxDim), 5);
});

test('ensureDimensionSetup: cria layer dimensions em vermelho (ACI 1) e ajusta escala', () => {
    const doc = createDocument();
    doc.entities = [
        // Chapa de 1200 x 600 mm
        { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 1200, y: 0 } },
        { id: '2', type: 'line', start: { x: 1200, y: 0 }, end: { x: 1200, y: 600 } },
    ];

    assert.equal(layerOf(doc, DIMENSION_LAYER), null, 'Layer dimensions não existe inicialmente');
    assert.equal(doc.dimStyle.scale, 1, 'Escala inicial é 1');

    const logs = [];
    const mockEditor = {
        history: { present: doc },
        get doc() { return this.history.present; },
        log: (msg) => logs.push(msg),
        onChange: () => {},
        invalidate: () => {},
    };

    ensureDimensionSetup(mockEditor);

    const updatedDoc = mockEditor.doc;
    const dimLayer = layerOf(updatedDoc, DIMENSION_LAYER);
    assert.ok(dimLayer, 'Layer dimensions foi criado');
    assert.equal(dimLayer.color, 1, 'Cor do layer dimensions é vermelha (ACI 1)');

    // Cor exibida no canvas / visualização
    const hexColor = entityColor({ layer: DIMENSION_LAYER }, updatedDoc);
    assert.equal(hexColor, '#ff0000', 'Hexadecimal da cor do layer é vermelho');

    // Escala proporcional calculada a partir de 1200 mm -> 12x
    assert.equal(updatedDoc.dimStyle.scale, 12, 'Escala deve ser 12 para chapa de 1200mm');
    assert.ok(logs.some((l) => l.includes("Layer 'dimensions' (vermelho) criado") && l.includes('12x')));
});

test('ensureDimensionSetup: preserva escala customizada se o usuário já a definiu ou se já existem cotas', () => {
    const doc = createDocument();
    doc.dimStyle.scale = 8; // Usuário configurou manualmente antes
    doc.entities = [
        { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    ];

    const mockEditor = {
        history: { present: doc },
        get doc() { return this.history.present; },
        log: () => {},
        onChange: () => {},
        invalidate: () => {},
    };

    ensureDimensionSetup(mockEditor);

    // Layer dimensions é criado, mas a escala do usuário não é sobrescrita
    assert.ok(layerOf(mockEditor.doc, DIMENSION_LAYER));
    assert.equal(mockEditor.doc.dimStyle.scale, 8, 'Escala customizada pelo usuário foi mantida');
});

test('DIMPART: gera cotas no layer dimensions em vermelho e com auto-escala', async () => {
    const doc = createDocument();
    // Chapa 800 x 400 mm
    doc.entities = [
        { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 800, y: 0 } },
        { id: '2', type: 'line', start: { x: 800, y: 0 }, end: { x: 800, y: 400 } },
        { id: '3', type: 'line', start: { x: 800, y: 400 }, end: { x: 0, y: 400 } },
        { id: '4', type: 'line', start: { x: 0, y: 400 }, end: { x: 0, y: 0 } },
    ];

    let currentDoc = doc;
    const logs = [];
    const mockEditor = {
        get doc() { return currentDoc; },
        set doc(d) { currentDoc = d; },
        history: {
            get present() { return currentDoc; },
            set present(d) { currentDoc = d; },
        },
        selection: new Set(),
        entitiesById: (ids) => currentDoc.entities.filter((e) => ids.includes(e.id)),
        commit: (label, newDoc) => { currentDoc = newDoc; return newDoc; },
        clearSelection: () => {},
        log: (msg) => logs.push(msg),
        onChange: () => {},
        invalidate: () => {},
    };

    await COMMANDS['DIMPART'].run(mockEditor);

    // Layer dimensions criado
    const dimLayer = layerOf(currentDoc, DIMENSION_LAYER);
    assert.ok(dimLayer, 'Layer dimensions deve ser criado por DIMPART');
    assert.equal(dimLayer.color, 1, 'Cor vermelha ACI 1');

    // Escala de 800mm -> 8x
    assert.equal(currentDoc.dimStyle.scale, 8, 'Escala calculada deve ser 8x para chapa de 800mm');

    // Todas as cotas geradas estão no layer dimensions
    const dims = currentDoc.entities.filter((e) => e.type === 'dimension');
    assert.ok(dims.length >= 2, 'Cotas gerais horizontal e vertical geradas');
    assert.ok(dims.every((d) => d.layer === DIMENSION_LAYER), 'Todas as cotas devem estar no layer dimensions');

    // Cor das cotas é vermelha
    dims.forEach((d) => {
        assert.equal(entityColor(d, currentDoc), '#ff0000');
    });
});

test('DIMSCALE auto: recalcula a escala pelo conteúdo atual do desenho', async () => {
    const doc = createDocument();
    // Chapa 2400 x 1200 mm
    doc.entities = [
        { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 2400, y: 0 } },
        { id: '2', type: 'line', start: { x: 2400, y: 0 }, end: { x: 2400, y: 1200 } },
    ];

    let currentDoc = doc;
    const logs = [];
    const mockEditor = {
        get doc() { return currentDoc; },
        set doc(d) { currentDoc = d; },
        commit: (label, newDoc) => { currentDoc = newDoc; return newDoc; },
        log: (msg) => logs.push(msg),
    };

    await COMMANDS['DIMSCALE'].run(mockEditor, ['auto']);

    assert.equal(currentDoc.dimStyle.scale, 24, 'Escala deve ser recalculada para 24x (2400mm / 100)');
    assert.ok(logs.some((l) => l.includes('24x') && l.includes('2400 mm')));
});

test('DIMLINEAR: atribui automaticamente layer dimensions em vermelho e ajusta escala da peça', async () => {
    const doc = createDocument();
    // Peça de 500 mm
    doc.entities = [
        { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 500, y: 0 } },
    ];

    let currentDoc = doc;
    const mockEditor = {
        get doc() { return currentDoc; },
        set doc(d) { currentDoc = d; },
        history: {
            get present() { return currentDoc; },
            set present(d) { currentDoc = d; },
        },
        getPointOrEntity: async () => ({ point: { x: 0, y: 0 } }),
        getPoint: async (prompt) => {
            if (prompt === 'Segundo ponto') return { point: { x: 500, y: 0 } };
            return { point: { x: 250, y: -50 } };
        },
        commit: (label, newDoc) => { currentDoc = newDoc; return newDoc; },
        log: () => {},
        onChange: () => {},
        invalidate: () => {},
    };

    await COMMANDS['DIMLINEAR'].run(mockEditor);

    const dim = currentDoc.entities.find((e) => e.type === 'dimension');
    assert.ok(dim, 'Cota linear deve ser inserida');
    assert.equal(dim.layer, DIMENSION_LAYER, 'Cota linear deve estar no layer dimensions');
    assert.equal(currentDoc.dimStyle.scale, 5, 'Escala ajustada para 5x (peça de 500mm)');
    assert.equal(entityColor(dim, currentDoc), '#ff0000', 'Cor deve ser vermelha');
});

test('ensureDimensionSetup: escala ajustada a partir de pontos de referência se o desenho estiver vazio', () => {
    const doc = createDocument();
    // Desenho vazio (sem entidades)
    doc.entities = [];

    const mockEditor = {
        history: { present: doc },
        get doc() { return this.history.present; },
        log: () => {},
        onChange: () => {},
        invalidate: () => {},
    };

    // Usuário clica em 2 pontos distantes 1500 mm
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 1500, y: 0 };

    ensureDimensionSetup(mockEditor, [p1, p2]);

    assert.equal(mockEditor.doc.dimStyle.scale, 15, 'Escala calculada pelos pontos de referência: 15x (1500mm / 100)');
    assert.ok(layerOf(mockEditor.doc, DIMENSION_LAYER), 'Layer dimensions criado');
});

test('ensureDimensionSetup: cotas importadas do DWG não impedem o ajuste da escala das cotas novas', () => {
    const doc = createDocument();
    doc.entities = [
        { id: '1', type: 'line', start: { x: 0, y: 0 }, end: { x: 3000, y: 0 } },
        { id: '2', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 }, linePoint: { x: 0, y: 50 }, dimStyleName: 'STANDARD' },
    ];
    const mockEditor = { history: { present: doc }, get doc() { return this.history.present; }, log: () => {}, onChange: () => {}, invalidate: () => {} };
    ensureDimensionSetup(mockEditor);
    assert.ok(mockEditor.doc.dimStyle.scale > 1, `escala ficou ${mockEditor.doc.dimStyle.scale}`);
});
