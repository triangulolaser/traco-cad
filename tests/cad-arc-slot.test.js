import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import { createDocument } from '../src/cad/document.js';
import { createArcSlotEntity, getEntityAreaAndPerimeter, slotParams } from '../src/cad/edit-tools.js';
import { entityBox } from '../src/cad/geometry.js';
import { writeDxf, parseDxf } from '../src/cad/dxf.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const deg = (d) => (d * Math.PI) / 180;
const O = { x: 0, y: 0 };

function scriptedEditor(steps) {
    const queue = [...steps];
    const editor = {
        doc: createDocument(),
        memory: {},
        logs: [],
        log(msg, level = 'info') { editor.logs.push({ msg, level }); },
        commit(desc, next) { editor.desc = desc; editor.doc = next; },
        async getPoint(prompt, options = {}) {
            const step = queue.shift();
            assert.ok(step, `prompt sem resposta: ${prompt}`);
            // Caminho do cursor antes do clique: alimenta a prévia como o mouse faria.
            for (const point of step.path ?? []) options.preview?.(point);
            if (options.preview && step.point) options.preview(step.point);
            return step;
        },
    };
    return editor;
}
const polylines = (editor) => editor.doc.entities.filter((e) => e.type === 'polyline');

test('quarto de volta: fechada, caixa, área e perímetro exatos', () => {
    const e = createArcSlotEntity({ x: 100, y: 50 }, 40, 0, Math.PI / 2, 10);
    assert.equal(e.closed, true);
    assert.equal(e.vertices.length, 4);
    near(e.vertices[0].x, 145, 'externo inicial');
    near(e.vertices[0].y, 50, 'externo inicial');
    near(e.vertices[3].x, 135, 'interno inicial');
    const { area, perimeter } = getEntityAreaAndPerimeter(e);
    near(area, 2 * (Math.PI / 2) * 40 * 5 + Math.PI * 25, 'área');
    near(perimeter, (Math.PI / 2) * 2 * 40 + 2 * Math.PI * 5, 'perímetro');
    const box = entityBox(e);
    near(box.maxX, 145, 'maxX');
    near(box.maxY, 95, 'maxY');
    near(box.minX, 95, 'minX: ponta além do centro');
    near(box.minY, 45, 'minY: ponta além do centro');
});

test('volta maior que 180°: bulge acima de 1 mantém área e sobrevive ao DXF', () => {
    const e = createArcSlotEntity(O, 50, deg(30), deg(300), 8);
    assert.ok(e.vertices[0].bulge > 1);
    const sweep = deg(270);
    const expected = 2 * sweep * 50 * 4 + Math.PI * 16;
    near(getEntityAreaAndPerimeter(e).area, expected, 'área');
    const doc = { ...createDocument(), entities: [{ ...e, id: 'a', layer: '0' }] };
    const back = parseDxf(writeDxf(doc)).entities.filter((x) => x.type === 'polyline');
    assert.equal(back.length, 1);
    assert.equal(back[0].closed, true);
    assert.ok(Math.abs(getEntityAreaAndPerimeter(back[0]).area - expected) < 1e-3, 'área depois do DXF');
});

test('não confunde com oblongo reto nas Propriedades', () => {
    assert.equal(slotParams(createArcSlotEntity(O, 40, 0, deg(90), 10)), null);
});

test('rejeita largura zero, largura que não cabe no raio e pontas que se tocam', () => {
    assert.equal(createArcSlotEntity(O, 40, 0, deg(90), 0), null);
    assert.equal(createArcSlotEntity(O, 40, 0, deg(90), 80), null);
    assert.equal(createArcSlotEntity(O, 40, deg(10), deg(10), 10), null);
    // Sobram 10°: corda de ~7 entre os centros das pontas.
    assert.equal(createArcSlotEntity(O, 40, 0, deg(350), 10), null);
    assert.ok(createArcSlotEntity(O, 40, 0, deg(330), 10));
    // Arco curtinho é válido: as pontas ficam em lados opostos.
    assert.ok(createArcSlotEntity(O, 40, 0, deg(2), 10));
});

test('RANHURA por 3 pontos: passa pelo ponto pedido, em qualquer ordem de pontas', async () => {
    assert.equal(resolveCommand('RANHURA').name, 'ARCSLOT');
    for (const [a, b] of [[{ x: 50, y: 0 }, { x: -50, y: 0 }], [{ x: -50, y: 0 }, { x: 50, y: 0 }]]) {
        const editor = scriptedEditor([{ point: a }, { point: b }, { point: { x: 0, y: 50 } }, { number: 6 }]);
        await COMMANDS.ARCSLOT.run(editor, ['3p']);
        const box = entityBox(polylines(editor)[0]);
        near(box.maxY, 53, 'topo: raio 50 + meia largura');
        near(box.minY, -3, 'pontas: meia largura abaixo');
        near(box.maxX, 53, 'direita');
        assert.equal(editor.desc, 'Ranhura em arco');
    }
});

test('RANHURA por 3 pontos colineares repete o prompt sem criar nada', async () => {
    const editor = scriptedEditor([{ point: O }, { point: { x: 10, y: 0 } }, { point: { x: 5, y: 0 } }, { point: { x: 5, y: 5 } }, { number: 1 }]);
    await COMMANDS.ARCSLOT.run(editor, ['3p']);
    assert.ok(editor.logs.some((l) => l.level === 'error' && /colineares/.test(l.msg)));
    assert.equal(polylines(editor).length, 1);
});

test('RANHURA pelo centro: anti-horária sem cursor e o caminho do mouse escolhe o lado', async () => {
    const start = { x: 40, y: 0 };
    const end = { x: 0, y: 40 };
    // Sem movimento: anti-horária, quarto de volta.
    let editor = scriptedEditor([{ point: O }, { point: start }, { point: end }, { number: 10 }]);
    editor.getPoint = ((orig) => async (prompt, options) => orig(prompt, /final/.test(prompt) ? { ...options, preview: undefined } : options))(editor.getPoint);
    await COMMANDS.ARCSLOT.run(editor, ['c']);
    near(getEntityAreaAndPerimeter(polylines(editor)[0]).area, 2 * deg(90) * 40 * 5 + Math.PI * 25, 'CCW 90°');

    // Mouse descendo pelo lado de baixo: chega ao mesmo ponto pelo sentido horário, 270°.
    const path = [{ x: 40, y: -5 }, { x: 0, y: -40 }, { x: -40, y: 0 }, { x: -20, y: 30 }];
    editor = scriptedEditor([{ point: O }, { point: start }, { point: end, path }, { number: 10 }]);
    await COMMANDS.ARCSLOT.run(editor, ['c']);
    near(getEntityAreaAndPerimeter(polylines(editor)[0]).area, 2 * deg(270) * 40 * 5 + Math.PI * 25, 'CW 270°');
});

test('largura: clique mede da linha de centro, Enter usa a lembrada e valor inválido repete', async () => {
    const editor = scriptedEditor([
        { point: O }, { point: { x: 40, y: 0 } }, { point: { x: 0, y: 40 } },
        { number: 100 },
        { point: { x: 47, y: 0 } },
    ]);
    await COMMANDS.ARCSLOT.run(editor, ['c']);
    assert.ok(editor.logs.some((l) => l.level === 'error' && /Largura inválida/.test(l.msg)));
    const { perimeter } = getEntityAreaAndPerimeter(polylines(editor)[0]);
    near(perimeter, deg(90) * 2 * 40 + 2 * Math.PI * 7, 'largura 14 pelo clique a 7 da linha');
    assert.equal(editor.memory.arcSlotWidth, 14);
});

test('modo muda no prompt e fica lembrado; cancelar não cria nada', async () => {
    let editor = scriptedEditor([{ keyword: 'c' }, { point: O }, { point: { x: 40, y: 0 } }, { point: { x: 0, y: 40 } }, { number: 10 }]);
    await COMMANDS.ARCSLOT.run(editor);
    assert.equal(editor.memory.arcSlotMode, 'c');
    assert.equal(polylines(editor).length, 1);
    editor = scriptedEditor([{ point: O }, null]);
    editor.getPoint = ((orig) => async (p, o) => { try { return await orig(p, o); } catch { return null; } })(editor.getPoint);
    await COMMANDS.ARCSLOT.run(editor, ['3p']);
    assert.equal(polylines(editor).length, 0);
});
