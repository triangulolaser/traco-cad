import test from 'node:test';
import assert from 'node:assert/strict';
import { aciToHex, LINETYPES, hexToAci } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';

test('ACI completo: 202 é o roxo do BricsCAD, cores antigas mantidas e reversíveis', () => {
    assert.equal(aciToHex(202), '#9900cc');
    assert.equal(aciToHex('202'), '#9900cc');
    assert.equal(aciToHex(200), '#bf00ff');
    assert.equal(aciToHex(1), '#ff0000');
    assert.equal(aciToHex(253), '#828282');
    assert.equal(hexToAci('#9900cc'), 202);
});

test('tipos de linha 2/X2 do acad.lin: CENTERX2 é o CENTER em dobro', () => {
    assert.deepEqual(LINETYPES.CENTERX2.pattern, LINETYPES.CENTER.pattern.map((v) => v * 2));
    assert.deepEqual(LINETYPES.HIDDEN2.pattern, LINETYPES.HIDDEN.pattern.map((v) => v / 2));
});

const dim = (y10, y11, y13, y14) => ['0', 'DIMENSION', '8', 'COTAS', '2', '*D1', '10', '285', '20', String(y10), '30', '0', '11', '285', '21', String(y11), '31', '0', '70', '160', '1', '<>', '100', 'AcDbAlignedDimension', '13', '279', '23', String(y13), '33', '0', '14', '279', '24', String(y14), '34', '0', '100', 'AcDbRotatedDimension', '50', '90'];
const dxf = (...e) => ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');

test('cota com texto deslocado (bit 128) abre na posição do código 11 e volta no DXF', () => {
    const { entities } = parseDxf(dxf(...dim(210.5, 229.17, 213.59, 210.54)), { preserveDimensions: true });
    const d = entities.find((e) => e.type === 'dimension');
    assert.deepEqual(d.textPosition, { x: 285, y: 229.17 });
    const g = dimensionGeometry(d, {});
    assert.ok(g.texts[0].position.y > 213.59, 'texto acima da linha de chamada superior');
    const again = parseDxf(writeDxf({ layers: [], entities: [d], blocks: {} }), { preserveDimensions: true }).entities.find((e) => e.type === 'dimension');
    assert.deepEqual(again.textPosition, { x: 285, y: 229.17 });
});

test('cota curta sem posição gravada joga o texto para fora, como o BricsCAD', () => {
    const d = { type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 3, y: 0 }, linePoint: { x: 0, y: -10 } };
    const g = dimensionGeometry(d, { textHeight: 2.5, arrowSize: 2.5 });
    assert.ok(g.texts[0].position.x > 3, 'texto começa depois da segunda linha de chamada');
    const roomy = dimensionGeometry({ ...d, p2: { x: 100, y: 0 } }, { textHeight: 2.5, arrowSize: 2.5 });
    assert.ok(roomy.texts[0].position.x > 0 && roomy.texts[0].position.x < 100);
});
