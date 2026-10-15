import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf } from '../src/cad/dxf.js';

const pair = (code, value) => `${code}\n${value}\n`;
const mleader = (rightAttachment, dogleg = -1) => pair(0, 'MULTILEADER') + pair(8, '0')
    + pair(300, 'CONTEXT_DATA{') + pair(40, 1) + pair(304, 'DOBRA') + pair(41, 10) + pair(140, 4)
    + pair(174, 1) + pair(175, rightAttachment) + pair(12, 90) + pair(22, 100)
    + pair(302, 'LEADER{') + pair(40, 2) + pair(10, 100) + pair(20, 100) + pair(11, dogleg) + pair(21, 0)
    + pair(304, 'LEADER_LINE{') + pair(10, 150) + pair(20, 50) + pair(305, '}') + pair(303, '}')
    + pair(301, '}');
const dxf = (body) => pair(0, 'SECTION') + pair(2, 'ENTITIES') + body + pair(0, 'ENDSEC') + pair(0, 'EOF');

test('MULTILEADER traz o texto e sublinha quando o anexo pede', () => {
    const parsed = parseDxf(dxf(mleader(6)), { preserveDimensions: true });
    assert.equal(parsed.entities.find((e) => e.type === 'text')?.text, 'DOBRA');
    const line = parsed.entities.find((e) => e.type === 'polyline');
    const xs = line.vertices.map((v) => v.x);
    // seta em 150, conexão em 100, dogleg de 2 para a esquerda e o sublinhado segue além do texto
    assert.deepEqual(xs.slice(0, 3), [150, 100, 98]);
    assert.ok(xs[3] < 98 - 10, `sublinhado deveria ir para a esquerda: ${xs[3]}`);
});

test('MULTILEADER sem anexo de sublinhado termina no dogleg', () => {
    const parsed = parseDxf(dxf(mleader(1)), { preserveDimensions: true });
    const line = parsed.entities.find((e) => e.type === 'polyline');
    assert.deepEqual(line.vertices.map((v) => v.x), [150, 100, 98]);
});

test('MULTILEADER com dogleg à direita usa o anexo esquerdo (174), como o AutoCAD posiciona o texto', () => {
    const parsed = parseDxf(dxf(mleader(6, 1)), { preserveDimensions: true });
    const line = parsed.entities.find((e) => e.type === 'polyline');
    assert.deepEqual(line.vertices.map((v) => v.x), [150, 100, 102]);
});
