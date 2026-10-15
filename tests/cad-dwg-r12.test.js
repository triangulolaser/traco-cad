import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dwgToDocument, dwgVersion } from '../src/cad/dwg.js';
import { readR12, r12ToDxf } from '../src/cad/dwgR12.js';
import { parseDxf } from '../src/cad/dxf.js';

// Os dois DWG foram gravados em R12 pelo motor ODA (QCAD Pro) a partir de DXF feitos para o teste.
const sample = new URL('./fixtures/cad-r12-sample.dwg', import.meta.url);
const rich = new URL('./fixtures/cad-r12-rich.dwg', import.meta.url);
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('DWG R12 (AC1009) abre pelo leitor nativo', async () => {
    const buffer = fs.readFileSync(sample);
    assert.equal(dwgVersion(buffer), 'AC1009');
    const doc = await dwgToDocument(buffer, { name: 'r12.dwg' });
    const byType = Object.groupBy(doc.entities, (e) => e.type);
    assert.equal(byType.line?.length, 1);
    assert.equal(byType.text?.[0]?.text, 'R12');
    const circle = byType.circle[0];
    assert.deepEqual([circle.center.x, circle.center.y, circle.radius, circle.layer], [50, 25, 10, 'CORTE']);
    const arc = byType.arc[0];
    assert.ok(close(arc.start, 3 * Math.PI / 2) && close(arc.end, Math.PI / 2));
    assert.equal(doc.sourceFormat, 'dwg');
});

test('R12: layers com acento e desligado, cor própria, texto girado e polilinha com arco', () => {
    const { layers, entities } = readR12(new Uint8Array(fs.readFileSync(rich)));
    assert.deepEqual(layers.map((l) => [l.name, l.color, l.off]), [['0', 7, false], ['CORTE', 1, false], ['FURAÇÃO', 3, false], ['OCULTO', 5, true]]);
    const lines = entities.filter((e) => e.type === 'LINE');
    assert.deepEqual(lines.map((l) => l.color), [256, 4]);
    const text = entities.find((e) => e.type === 'TEXT' && e.text === 'PEÇA 12');
    assert.ok(close(text.rotation, Math.PI / 4));
    const polyline = entities.find((e) => e.type === 'POLYLINE');
    assert.equal(polyline.flag & 1, 1);
    assert.deepEqual(polyline.vertices.map((v) => [v.x, v.y, v.bulge]), [[0, 200, 0], [100, 200, 1], [100, 250, 0], [0, 250, 0]]);
});

test('R12: bloco, inserção girada e escalada e atributo visível como texto', async () => {
    const doc = await dwgToDocument(fs.readFileSync(rich), { name: 'rico.dwg' });
    assert.ok(doc.blocks.FURO, 'bloco FURO definido');
    const inserts = doc.entities.filter((e) => e.type === 'insert');
    assert.equal(inserts.length, 2);
    const turned = inserts.find((e) => e.layer === 'FURAÇÃO');
    assert.deepEqual([turned.position.x, turned.position.y, turned.scaleX, turned.rotation], [50, 50, 2, 90]);
    assert.ok(doc.entities.some((e) => e.type === 'text' && e.text === 'A-77'));
    const parsed = parseDxf(r12ToDxf(readR12(new Uint8Array(fs.readFileSync(rich)))));
    assert.equal(parsed.layers.find((l) => l.name === 'OCULTO').visible, false);
});

test('R12 inválido dá erro claro', () => {
    assert.throws(() => readR12(new TextEncoder().encode('AC1015' + '\0'.repeat(200))), /DWG R12/);
});
