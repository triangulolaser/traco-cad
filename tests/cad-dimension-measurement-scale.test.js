import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { dimensionGeometry, defaultDimStyle } from '../src/cad/dimensions.js';

// Feedback Traço 21/09/2026 (Daniel): desenho de vista em escala 1:20 mostrava a medida do papel
// (65.03) em vez da medida real da peça (1300.6). DIMLFAC define esse fator linear.

const p = (code, value) => `${code}\n${value}\n`;
const SPAN = 65.03;
const REAL = 1300.6;

function buildDxf({ headerLfac, styleLfac, xdataLfac, blockText = String(REAL), span = SPAN } = {}) {
    return p(0, 'SECTION') + p(2, 'HEADER') + p(9, '$INSUNITS') + p(70, 4)
        + (headerLfac ? p(9, '$DIMLFAC') + p(40, headerLfac) : '') + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'TABLES')
        + p(0, 'TABLE') + p(2, 'LAYER') + p(0, 'LAYER') + p(2, '0') + p(62, 7) + p(70, 0) + p(0, 'ENDTAB')
        + p(0, 'TABLE') + p(2, 'DIMSTYLE') + p(0, 'DIMSTYLE') + p(2, 'ISO-25') + p(40, 1) + p(41, 2.5) + p(140, 2.5)
        + p(147, 0.9) + (styleLfac ? p(144, styleLfac) : '') + p(271, 2) + p(0, 'ENDTAB')
        + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'BLOCKS')
        + p(0, 'BLOCK') + p(2, '*D1') + p(70, 1) + p(10, 0) + p(20, 0) + p(30, 0) + p(3, '*D1') + p(1, '')
        + p(0, 'TEXT') + p(8, '0') + p(10, span / 2) + p(20, 12) + p(30, 0) + p(40, 2.5) + p(1, blockText)
        + p(0, 'ENDBLK') + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'ENTITIES')
        + p(0, 'LINE') + p(8, '0') + p(10, 0) + p(20, 0) + p(30, 0) + p(11, span) + p(21, 0) + p(31, 0)
        + p(0, 'DIMENSION') + p(8, '0') + p(2, '*D1') + p(3, 'ISO-25') + p(70, 1)
        + p(10, span / 2) + p(20, 10) + p(30, 0) + p(11, span / 2) + p(21, 12) + p(31, 0)
        + p(13, 0) + p(23, 0) + p(33, 0) + p(14, span) + p(24, 0) + p(34, 0)
        + (xdataLfac ? p(1001, 'ACAD') + p(1000, 'DSTYLE') + p(1002, '{') + p(1070, 144) + p(1040, xdataLfac) + p(1002, '}') : '')
        + p(0, 'ENDSEC') + p(0, 'EOF');
}

function importedDimension(options) {
    const doc = parseDxf(buildDxf(options), { preserveBlocks: true, preserveDimensions: true });
    const dimension = doc.entities.find((e) => e.type === 'dimension');
    assert.ok(dimension, 'a cota deve ser importada como entidade nativa');
    return { doc, dimension, geometry: dimensionGeometry(dimension, doc.dimStyle ?? defaultDimStyle()) };
}

test('DXF: DIMLFAC do DIMSTYLE converte a medida do papel na medida real da peça', () => {
    const { dimension, geometry } = importedDimension({ styleLfac: 20 });
    assert.equal(dimension.measurementScale, 20);
    assert.equal(geometry.text, '1300.6');
    // A geometria da cota continua no desenho: só o valor exibido é convertido.
    assert.ok(Math.abs(geometry.measurement - SPAN) < 1e-9);
});

test('DXF: $DIMLFAC do cabeçalho vale quando o DIMSTYLE não declara fator', () => {
    const { geometry } = importedDimension({ headerLfac: 20 });
    assert.equal(geometry.text, '1300.6');
});

test('DXF: override DIMLFAC em XDATA da cota tem precedência sobre o DIMSTYLE', () => {
    assert.equal(importedDimension({ xdataLfac: 20 }).geometry.text, '1300.6');
    assert.equal(importedDimension({ styleLfac: 5, xdataLfac: 20 }).geometry.text, '1300.6');
});

test('DXF: sem DIMLFAC, o texto do bloco anônimo da cota prevalece sobre a medida recalculada', () => {
    const { dimension, geometry } = importedDimension({});
    assert.equal(dimension.textOverride, '1300.6');
    assert.equal(geometry.text, '1300.6');
});

test('DXF: desenho 1:1 permanece intacto, sem fator nem override espúrio', () => {
    const { dimension, geometry } = importedDimension({ blockText: String(SPAN) });
    assert.equal(dimension.measurementScale, undefined);
    assert.equal(dimension.textOverride, undefined);
    assert.equal(geometry.text, '65.03');
});

test('DXF: bloco anônimo sem texto numérico não inventa override', () => {
    const { dimension, geometry } = importedDimension({ blockText: '' });
    assert.equal(dimension.textOverride, undefined);
    assert.equal(geometry.text, '65.03');
});

test('DXF roundtrip: writeDxf grava DIMLFAC e a reimportação mantém a medida real', () => {
    const { doc } = importedDimension({ styleLfac: 20 });
    const out = writeDxf(doc);
    assert.match(out, /\n144\n20/);
    const back = parseDxf(out, { preserveBlocks: true, preserveDimensions: true });
    const dimension = back.entities.find((e) => e.type === 'dimension');
    assert.equal(dimensionGeometry(dimension, back.dimStyle ?? defaultDimStyle()).text, '1300.6');
});

test('Cota radial em desenho escalado converte R e Ø pelo mesmo fator', () => {
    const style = { ...defaultDimStyle(), measurementScale: 20 };
    const radius = dimensionGeometry({ type: 'dimension', kind: 'radius', center: { x: 0, y: 0 }, radius: 53.592, linePoint: { x: 80, y: 0 } }, style);
    assert.equal(radius.text, 'R1071.84');
    const diameter = dimensionGeometry({ type: 'dimension', kind: 'diameter', center: { x: 0, y: 0 }, radius: 0.6, linePoint: { x: 5, y: 0 } }, style);
    assert.equal(diameter.text, 'Ø24');
});

// Construto real do desenho do feedback: cota linear rotacionada (código 70 = 32, código 50 = 36.034°)
// num desenho 1:20, com a medida do próprio arquivo no código 42.
function rotatedDxf({ rotation = 36.034432, measured = 50, p1 = { x: 134.36017, y: 74.80388 }, p2 = { x: 136.38183, y: 76.27456 }, blockText = '50' } = {}) {
    return p(0, 'SECTION') + p(2, 'HEADER') + p(9, '$DIMLFAC') + p(40, 1) + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'TABLES')
        + p(0, 'TABLE') + p(2, 'LAYER') + p(0, 'LAYER') + p(2, 'COTAS') + p(62, 4) + p(70, 0) + p(0, 'ENDTAB')
        + p(0, 'TABLE') + p(2, 'DIMSTYLE') + p(0, 'DIMSTYLE') + p(2, 'SLDDIMSTYLE1') + p(40, 1) + p(41, 2.5)
        + p(140, 3.5) + p(144, 20) + p(147, 0.9) + p(271, 2) + p(0, 'ENDTAB') + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'BLOCKS')
        + p(0, 'BLOCK') + p(2, '*D15') + p(70, 1) + p(10, 0) + p(20, 0) + p(30, 0) + p(3, '*D15') + p(1, '')
        + p(0, 'MTEXT') + p(8, 'COTAS') + p(10, 131) + p(20, 83) + p(30, 0) + p(40, 3.5) + p(1, blockText)
        + p(0, 'ENDBLK') + p(0, 'ENDSEC')
        + p(0, 'SECTION') + p(2, 'ENTITIES')
        + p(0, 'DIMENSION') + p(8, 'COTAS') + p(2, '*D15') + p(3, 'SLDDIMSTYLE1') + p(70, 160)
        + p(10, 130.96388) + p(20, 83.72231) + p(30, 0) + p(11, 121.25058) + p(21, 76.65626) + p(31, 0)
        + p(1, '<>') + p(42, measured)
        + p(13, p1.x) + p(23, p1.y) + p(33, 0) + p(14, p2.x) + p(24, p2.y) + p(34, 0) + p(50, rotation)
        + p(0, 'ENDSEC') + p(0, 'EOF');
}

function rotatedDimension(options) {
    const doc = parseDxf(rotatedDxf(options), { preserveBlocks: true, preserveDimensions: true });
    const dimension = doc.entities.find((e) => e.type === 'dimension');
    assert.ok(dimension, 'a cota rotacionada deve ser importada');
    return { doc, dimension, geometry: dimensionGeometry(dimension, doc.dimStyle ?? defaultDimStyle()) };
}

test('DXF: cota linear rotacionada mede a projeção na direção do código 50, não em X', () => {
    const { dimension, geometry } = rotatedDimension();
    assert.equal(dimension.kind, 'rotated');
    assert.ok(Math.abs(dimension.rotation - 36.034432) < 1e-6);
    // Projeção 2.5 no papel; medida lida em X daria 2.02 e o desenho mostraria 40.43.
    assert.ok(Math.abs(geometry.measurement - 2.5) < 1e-3, `medida ${geometry.measurement}`);
    assert.equal(geometry.text, '50');
    assert.equal(dimension.textOverride, undefined, 'o valor vem do cálculo, não de um override');
});

test('DXF: ângulos 0 e 90 no código 50 continuam horizontal e vertical', () => {
    assert.equal(rotatedDimension({ rotation: 0, measured: 40.43 }).dimension.kind, 'horizontal');
    assert.equal(rotatedDimension({ rotation: 180, measured: 40.43 }).dimension.kind, 'horizontal');
    assert.equal(rotatedDimension({ rotation: 90, measured: 29.41 }).dimension.kind, 'vertical');
});

test('DXF: medida declarada no código 42 impede exibir valor recalculado divergente', () => {
    // Geometria que o Traço mediria como 2.5 x 20 = 50, mas o arquivo afirma 77 e mostrava 77.
    const { dimension, geometry } = rotatedDimension({ measured: 77, blockText: '77' });
    assert.equal(dimension.textOverride, '77');
    assert.equal(geometry.text, '77');
});

test('DXF roundtrip: cota rotacionada preserva a direção de medição', () => {
    const { doc } = rotatedDimension();
    const back = parseDxf(writeDxf(doc), { preserveBlocks: true, preserveDimensions: true });
    const dimension = back.entities.find((e) => e.type === 'dimension');
    assert.equal(dimension.kind, 'rotated');
    assert.ok(Math.abs(dimension.rotation - 36.034432) < 1e-3);
    assert.equal(dimensionGeometry(dimension, back.dimStyle ?? defaultDimStyle()).text, '50');
});

test('Cota angular ignora o fator linear', () => {
    const style = { ...defaultDimStyle(), measurementScale: 20 };
    const angular = dimensionGeometry({
        type: 'dimension', kind: 'angular', vertex: { x: 0, y: 0 },
        p1: { x: 10, y: 0 }, p2: { x: 0, y: 10 }, linePoint: { x: 7, y: 7 },
    }, style);
    assert.equal(angular.text, '90°');
});

// 16/10/2026: escala da cota editada no painel precisa sobreviver à gravação do DXF.
test('DXF roundtrip: escala definida só na cota (painel) é gravada e reimportada', () => {
    const { doc } = importedDimension({});
    const entities = doc.entities.map((e) => (e.type === 'dimension' ? { ...e, textOverride: undefined, measurementScale: 20 } : e));
    const out = writeDxf({ ...doc, entities });
    const back = parseDxf(out, { preserveBlocks: true, preserveDimensions: true });
    const dimension = back.entities.find((e) => e.type === 'dimension');
    assert.equal(dimensionGeometry(dimension, back.dimStyle ?? defaultDimStyle()).text, '1300.6');
});
