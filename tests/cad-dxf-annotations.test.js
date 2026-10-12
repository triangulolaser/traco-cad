import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';

// Pares código/valor no formato de grupo do DXF.
const dxf = (...entities) => ['0', 'SECTION', '2', 'ENTITIES', ...entities.flat().map(String), '0', 'ENDSEC', '0', 'EOF'].join('\n');
const ent = (type, pairs) => ['0', type, ...pairs.flatMap(([c, v]) => [c, v])];

const LEADER = ent('LEADER', [[8, 'COTA'], [100, 'AcDbLeader'], [71, 1], [76, 3], [10, 0], [20, 0], [30, 0], [10, 10], [20, 10], [30, 0], [10, 30], [20, 10], [30, 0]]);
const MLEADER = ent('MULTILEADER', [
    [8, 'COTA'], [300, 'CONTEXT_DATA{'], [40, 1], [10, 38], [20, 28], [41, 3.5], [140, 4], [304, 'FURO Ø10\\PPASSANTE'], [12, 40], [22, 30],
    [302, 'LEADER{'], [10, 30], [20, 28], [11, 1], [21, 0], [40, 8],
    [304, 'LEADER_LINE{'], [10, 10], [20, 10], [10, 20], [20, 20], [305, '}'],
    [303, '}'], [301, '}'],
]);
const ATTRIBS = [
    ent('INSERT', [[8, '0'], [66, 1], [2, 'CARIMBO'], [10, 200], [20, 0]]),
    ent('ATTRIB', [[8, '0'], [10, 202], [20, 12], [40, 3], [1, 'TAMPA LATERAL'], [2, 'DESENHO'], [70, 0]]),
    ent('ATTRIB', [[8, '0'], [10, 202], [20, 4], [40, 2.5], [1, 'OCULTO'], [2, 'REV'], [70, 1]]),
    ['0', 'SEQEND'],
];
const TABLE = ent('ACAD_TABLE', [[8, 'TABELA'], [2, '*T1'], [10, 500], [20, 100]]);
const XLINE = ent('XLINE', [[8, 'CONSTR'], [10, 5], [20, 5], [11, 0], [21, 1]]);
const RAY = ent('RAY', [[8, 'CONSTR'], [10, 0], [20, 0], [11, 1], [21, 0]]);

const cad = (text) => parseDxf(text, { preserveBlocks: true, preserveDimensions: true }).entities;

test('LEADER vira polilinha com seta preenchida na ponta', () => {
    const [line, arrow] = cad(dxf(LEADER));
    assert.equal(line.type, 'polyline');
    assert.deepEqual(line.vertices.map((v) => [v.x, v.y]), [[0, 0], [10, 10], [30, 10]]);
    assert.equal(line.layer, 'COTA');
    assert.equal(arrow.type, 'hatch');
    assert.equal(arrow.pattern, 'SOLID');
    assert.deepEqual([arrow.loops[0].vertices[0].x, arrow.loops[0].vertices[0].y], [0, 0], 'seta na ponta da chamada');
});

test('MULTILEADER traz linha até o patamar, seta e texto', () => {
    const out = cad(dxf(MLEADER));
    const line = out.find((e) => e.type === 'polyline');
    assert.deepEqual(line.vertices.map((v) => [v.x, v.y]), [[10, 10], [20, 20], [30, 28], [38, 28]]);
    assert.ok(out.some((e) => e.type === 'hatch'));
    const text = out.find((e) => e.type === 'text');
    assert.equal(text.text, 'FURO Ø10\nPASSANTE');
    assert.deepEqual(text.position, { x: 40, y: 30 });
    assert.equal(text.height, 3.5);
});

test('ATTRIB visível vira texto; invisível é ignorado', () => {
    const block = ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '8', '0', '2', 'CARIMBO', '70', '0', '10', '0', '20', '0', '0', 'ENDBLK', '0', 'ENDSEC'];
    const texts = cad([...block, ...dxf(...ATTRIBS).split('\n')].join('\n')).filter((e) => e.type === 'text');
    assert.deepEqual(texts.map((t) => t.text), ['TAMPA LATERAL']);
    assert.equal(texts[0].attributeTag, 'DESENHO');
});

test('ACAD_TABLE referencia o bloco anônimo com a geometria da tabela', () => {
    const blocks = ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '8', '0', '2', '*T1', '70', '1', '10', '0', '20', '0', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '50', '21', '0', '0', 'ENDBLK', '0', 'ENDSEC'];
    const text = [...blocks, ...dxf(TABLE).split('\n')].join('\n');
    const [table] = cad(text);
    assert.equal(table.type, 'insert');
    assert.equal(table.name, '*T1');
    assert.deepEqual(table.position, { x: 500, y: 100 });
    assert.equal(table.layer, 'TABELA');
    assert.equal(table.definition.entities[0].type, 'line');
});

test('XLINE e RAY importam como linhas de construção e voltam infinitas no DXF', () => {
    const [xline, ray] = cad(dxf(XLINE, RAY));
    assert.equal(xline.construction, 'xline');
    assert.ok(xline.start.y < -1000 && xline.end.y > 1000 && xline.start.x === 5);
    assert.equal(ray.construction, 'ray');
    assert.deepEqual(ray.start, { x: 0, y: 0 });
    const out = writeDxf({ layers: [], entities: [xline, ray] });
    assert.match(out, /\n\s*XLINE\r?\n/);
    assert.match(out, /\n\s*RAY\r?\n/);
    const back = cad(out);
    assert.deepEqual(back.map((e) => e.construction), ['xline', 'ray']);
});

test('importação de corte (sem preserveDimensions) continua ignorando anotações', () => {
    const plain = parseDxf(dxf(LEADER, MLEADER, XLINE, RAY)).entities;
    assert.equal(plain.length, 0);
});

test('cota e POLYLINE com cor 256 herdam a cor da layer', () => {
    const DIM = ent('DIMENSION', [[8, 'cota'], [62, 256], [2, '*D1'], [10, 0], [20, 10], [70, 32], [3, 'STANDARD'], [13, 0], [23, 0], [14, 50], [24, 0]]);
    const POLY = [...ent('POLYLINE', [[8, 'cota'], [62, 256], [70, 0]]), ...ent('VERTEX', [[10, 0], [20, 0]]), ...ent('VERTEX', [[10, 5], [20, 0]]), '0', 'SEQEND'];
    const entities = cad(dxf(DIM, POLY));
    assert.equal(entities.find((e) => e.type === 'dimension').color, 'bylayer');
    assert.equal(entities.find((e) => e.type === 'polyline').color, 'bylayer');
});
