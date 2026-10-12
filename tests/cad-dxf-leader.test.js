import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDxf } from '../src/cad/dxf.js';

const dxf = (...pairs) => pairs.map(String).join('\n') + '\n';
const tables = dxf(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'DIMSTYLE',
    0, 'DIMSTYLE', 2, '1-1', 40, 1, 41, 2.5, 0, 'ENDTAB', 0, 'ENDSEC');
const leader = (extra = []) => dxf(0, 'LEADER', 8, 'DESENHO', 100, 'AcDbLeader', 3, '1-1', 71, 1, 76, 3,
    10, 10, 20, 0, 30, 0, 10, 13, 20, 4, 30, 0, 10, 30, 20, 4, 30, 0, ...extra);
const doc = (body) => tables + dxf(0, 'SECTION', 2, 'ENTITIES') + body + dxf(0, 'ENDSEC', 0, 'EOF');

test('LEADER do BricsCAD vira polilinha com a seta do DIMSTYLE', () => {
    const { entities } = parseDxf(doc(leader()), { preserveBlocks: true, preserveDimensions: true });
    const path = entities.find((e) => e.type === 'polyline' && !e.closed);
    assert.deepEqual(path.vertices.map((v) => [v.x, v.y]), [[10, 0], [13, 4], [30, 4]]);
    assert.equal(path.layer, 'DESENHO');
    // Seta cheia (hatch SOLID), como a do MULTILEADER: ponta no primeiro vértice, base a DIMASZ × DIMSCALE.
    const arrow = entities.find((e) => e.type === 'hatch');
    const [tip, b, c] = arrow.loops[0].vertices;
    assert.deepEqual([tip.x, tip.y], [10, 0]);
    assert.ok(Math.abs(Math.hypot((b.x + c.x) / 2 - 10, (b.y + c.y) / 2) - 2.5) < 1e-9);
    assert.equal(arrow.layer, 'DESENHO');
});

test('LEADER usa o DIMASZ do override em XDATA e respeita seta desligada', () => {
    const opts = { preserveBlocks: true, preserveDimensions: true };
    const xdata = [1001, 'ACAD', 1000, 'DSTYLE', 1002, '{', 1070, 41, 1040, 1, 1002, '}'];
    const withOverride = parseDxf(doc(leader(xdata)), opts).entities.find((e) => e.type === 'hatch');
    const [, b, c] = withOverride.loops[0].vertices;
    assert.ok(Math.abs(Math.hypot((b.x + c.x) / 2 - 10, (b.y + c.y) / 2) - 1) < 1e-9);
    const noArrow = parseDxf(doc(leader().replace('\n71\n1\n', '\n71\n0\n')), opts).entities;
    assert.equal(noArrow.length, 1);
});

test('LEADER é anotação: a importação de corte (sem preserveDimensions) ignora', () => {
    assert.equal(parseDxf(doc(leader())).entities.length, 0);
});
