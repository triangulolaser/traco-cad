import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf } from '../src/cad/dxf.js';

const pair = (code, value) => `${code}\n${value}\n`;
const line = (x1, paper = false) => pair(0, 'LINE') + pair(8, '0') + (paper ? pair(67, 1) : '') + pair(10, x1) + pair(20, 0) + pair(11, x1 + 10) + pair(21, 0);
const polyline = (paper) => pair(0, 'POLYLINE') + pair(8, '0') + (paper ? pair(67, 1) : '') + pair(70, 1)
    + [[0, 0], [5, 0], [5, 5]].map(([x, y]) => pair(0, 'VERTEX') + pair(8, '0') + (paper ? pair(67, 1) : '') + pair(10, x) + pair(20, y)).join('')
    + pair(0, 'SEQEND');
const dxf = (body) => pair(0, 'SECTION') + pair(2, 'ENTITIES') + body + pair(0, 'ENDSEC') + pair(0, 'EOF');

test('entidades de layout (67=1) não entram no model space', () => {
    const parsed = parseDxf(dxf(line(0) + line(100, true) + polyline(true) + polyline(false) + line(200)), { preserveBlocks: true, preserveDimensions: true });
    assert.deepEqual(parsed.entities.filter((e) => e.type === 'line').map((e) => e.start.x), [0, 200]);
    const polylines = parsed.entities.filter((e) => e.type === 'polyline');
    assert.equal(polylines.length, 1);
    assert.equal(polylines[0].vertices.length, 3);
});
