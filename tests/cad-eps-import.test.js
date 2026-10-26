import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {} };
if (typeof globalThis.document === 'undefined') globalThis.document = { addEventListener() {}, removeEventListener() {} };

const { Editor } = await import('../src/cad/editor.js');
const { parseDxf } = await import('../src/cad/dxf.js');

const PT = 72 / 25.4; // pontos por mm
// Retângulo 100 x 50 mm como o CorelDRAW escreve no corpo da página.
const corelEps = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 300 150
%%Creator: CorelDRAW
%%BeginProlog
/@c { closepath } bind def
%%EndProlog
%%Page: 1 1
@sv
@gs
0 0 m
${100 * PT} 0 L
${100 * PT} ${50 * PT} L
0 ${50 * PT} L
@c
S
@gr
@rs
%%Trailer
%%EOF
`;

const fakeEditor = () => {
    const calls = [];
    const logs = [];
    const editor = Object.create(Editor.prototype);
    editor.importDxfText = async (text, name, options) => { calls.push({ text, name, options }); };
    editor.log = (msg, level) => { logs.push({ msg, level }); };
    return { editor, calls, logs };
};

test('EPS do Corel abre no Traço como DXF em mm, com o nome trocado para .dxf', async () => {
    const { editor, calls, logs } = fakeEditor();
    const bytes = new TextEncoder().encode(corelEps);
    await editor.importEpsBuffer(bytes.buffer, 'FACA.EPS', { filePath: '/tmp/FACA.EPS' });
    assert.equal(logs.length, 0, JSON.stringify(logs));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'FACA.dxf');
    assert.equal(calls[0].options.filePath, '/tmp/FACA.EPS');
    const parsed = parseDxf(calls[0].text);
    const xs = [], ys = [];
    for (const e of parsed.entities) {
        assert.equal(e.type, 'line');
        xs.push(e.start.x, e.end.x); ys.push(e.start.y, e.end.y);
    }
    assert.equal(parsed.entities.length, 4);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 100) < 0.01);
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 50) < 0.01);
});

test('EPS inválido avisa e não chama o importador de DXF', async () => {
    const { editor, calls, logs } = fakeEditor();
    await editor.importEpsBuffer(new TextEncoder().encode('não é postscript').buffer, 'x.eps');
    assert.equal(calls.length, 0);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].msg, /EPS/);
});
