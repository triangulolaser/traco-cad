import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { dwgToDocument, dwgToDxfText } from '../src/cad/dwg.js';
import { addEntities, createDocument } from '../src/cad/document.js';

const section = (name, ...rows) => ['0', 'SECTION', '2', name, ...rows, '0', 'ENDSEC'];
const mtext = (text) => ['0', 'MTEXT', '8', '0', '10', '0', '20', '0', '40', '2.5', '1', text];
const text = (raw) => parseDxf([...section('ENTITIES', ...mtext(raw)), '0', 'EOF'].join('\n')).entities[0].text;

test('MTEXT preserva o conteúdo da fração empilhada', () => {
    assert.equal(text('\\A1;1 peça #{\\H0.7x;\\S1/8;}"\\P+ calandra x38mm'), '1 peça #1/8"\n+ calandra x38mm');
    assert.equal(text('#{\\S1/8;}"'), '#1/8"');
    assert.equal(text('\\S3#4; e \\S1^ 2;'), '3/4 e 1/2');
    assert.equal(text('\\S+0,1^-0,1;'), '+0,1/-0,1');
    assert.equal(text('\\S^-0,1;'), '-0,1');
    assert.equal(text('\\S1\\/2/3;'), '1/2/3');
});

test('Fração sobrevive a salvar e reabrir', () => {
    const doc = addEntities(createDocument(), parseDxf([...section('ENTITIES', ...mtext('#{\\S1/8;}"')), '0', 'EOF'].join('\n')).entities);
    assert.equal(parseDxf(writeDxf(doc)).entities.find((e) => e.type === 'text').text, '#1/8"');
});

const arcDxf = [
    ...section('BLOCKS',
        '0', 'BLOCK', '8', '0', '2', '*D7', '70', '1', '10', '0', '20', '0',
        '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0',
        '0', 'MTEXT', '8', '0', '10', '5', '20', '1', '40', '2.5', '1', '411',
        '0', 'ENDBLK', '8', '0'),
    ...section('ENTITIES',
        // Flags 5 e código 15: se cair no ramo nativo, viraria uma cota angular com valor errado.
        '0', 'ARC_DIMENSION', '8', 'COTAS', '2', '*D7', '10', '0', '20', '0', '70', '5',
        '13', '1', '23', '0', '14', '0', '24', '1', '15', '0', '25', '0'),
    '0', 'EOF',
].join('\n');

test('Cota de arco abre no CAD pela geometria do bloco', () => {
    const { entities } = parseDxf(arcDxf, { preserveBlocks: true, preserveDimensions: true, dimensionColor: 1 });
    assert.equal(entities.some((e) => e.type === 'dimension'), false);
    assert.deepEqual(entities.map((e) => e.type).sort(), ['line', 'text']);
    assert.equal(entities.find((e) => e.type === 'text').text, '411');
    assert.ok(entities.every((e) => e.color === 1));
});

test('Importações de corte não recebem a cota de arco como contorno', () => {
    assert.deepEqual(parseDxf(arcDxf).entities, []);
    assert.deepEqual(parseDxf(arcDxf, { dimensionGraphics: false }).entities, []);
});

test('DWG: ARC_DIMENSION chega ao DXF interno com o bloco e entra no documento', async () => {
    const acad = await import('@node-projects/acad-ts');
    const cad = new acad.CadDocument();
    const record = new acad.BlockRecord('*D7');
    cad.blockRecords.add(record);
    const label = new acad.MText();
    label.value = '411';
    record.entities.add(label);
    const dim = new acad.DimensionArc();
    dim.block = record;
    dim.center = new acad.XYZ(0, 0, 0);
    dim.firstPoint = new acad.XYZ(10, 0, 0);
    dim.secondPoint = new acad.XYZ(0, 10, 0);
    cad.entities.add(dim);
    const dwg = acad.DwgWriter.writeToBuffer(cad);

    const dxf = await dwgToDxfText(dwg);
    const entitySection = dxf.slice(dxf.search(/\n\s*2\r?\nENTITIES\b/));
    const arc = entitySection.slice(entitySection.search(/\bARC_DIMENSION\b/));
    assert.match(arc, /\bAcDbDimension\b/);
    assert.match(arc, /\n\s*2\r?\n\*D\d+\r?\n/);

    const doc = await dwgToDocument(dwg);
    assert.ok(doc.entities.some((e) => e.type === 'text' && e.text === '411'));
});
