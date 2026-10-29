import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import { createDocument } from '../src/cad/document.js';
import { createSlotEntity, createRectangleEntity, getEntityAreaAndPerimeter, slotParams, resizeSlot } from '../src/cad/edit-tools.js';
import { entityBox } from '../src/cad/geometry.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

function scriptedEditor(steps) {
    const queue = [...steps];
    const logs = [];
    const editor = {
        doc: createDocument(),
        memory: {},
        logs,
        previews: [],
        log(msg, level = 'info') { logs.push({ msg, level }); },
        commit(desc, next) { editor.desc = desc; editor.doc = next; },
        async getPoint(prompt, options = {}) {
            const step = queue.shift();
            assert.ok(step, `prompt sem resposta: ${prompt}`);
            if (options.preview && step.point) editor.previews.push(options.preview(step.point));
            editor.lastPrompt = prompt;
            return step;
        },
        async getNumber(prompt) {
            const step = queue.shift();
            assert.ok(step && 'number' in step, `getNumber sem resposta: ${prompt}`);
            return step.number;
        },
    };
    return editor;
}

test('createSlotEntity centro a centro: comprimento total soma a largura', () => {
    const e = createSlotEntity({ x: 10, y: 5 }, { x: 40, y: 5 }, 8, 'c');
    assert.equal(e.type, 'polyline');
    assert.equal(e.closed, true);
    assert.deepEqual(e.vertices.map((v) => v.bulge), [0, 1, 0, 1]);
    const box = entityBox(e);
    near(box.minX, 6, 'minX');
    near(box.maxX, 44, 'maxX');
    near(box.minY, 1, 'minY');
    near(box.maxY, 9, 'maxY');
    const { area, perimeter } = getEntityAreaAndPerimeter(e);
    near(area, 30 * 8 + Math.PI * 16, 'área');
    near(perimeter, 2 * 30 + Math.PI * 8, 'perímetro');
});

test('createSlotEntity borda a borda: pontas definem o comprimento total, inclinado', () => {
    const ang = Math.PI / 6;
    const a = { x: 0, y: 0 };
    const b = { x: 50 * Math.cos(ang), y: 50 * Math.sin(ang) };
    const e = createSlotEntity(a, b, 10, 'b');
    const { area, perimeter } = getEntityAreaAndPerimeter(e);
    near(area, 40 * 10 + Math.PI * 25, 'área');
    near(perimeter, 2 * 40 + Math.PI * 10, 'perímetro');
    // Os centros dos arcos ficam a um raio das pontas.
    const centerFirst = { x: (e.vertices[0].x + e.vertices[3].x) / 2, y: (e.vertices[0].y + e.vertices[3].y) / 2 };
    near(centerFirst.x, 5 * Math.cos(ang), 'centro x');
    near(centerFirst.y, 5 * Math.sin(ang), 'centro y');
});

test('createSlotEntity: sem trecho reto vira círculo; borda curta demais é inválida', () => {
    assert.deepEqual(createSlotEntity({ x: 1, y: 1 }, { x: 1, y: 1 }, 6, 'c'), { type: 'circle', center: { x: 1, y: 1 }, radius: 3 });
    const c = createSlotEntity({ x: 0, y: 0 }, { x: 6, y: 0 }, 6, 'b');
    assert.equal(c.type, 'circle');
    near(c.center.x, 3, 'centro');
    assert.equal(createSlotEntity({ x: 0, y: 0 }, { x: 4, y: 0 }, 6, 'b'), null);
    assert.equal(createSlotEntity({ x: 0, y: 0 }, { x: 4, y: 0 }, 0, 'c'), null);
});

test('SLOT: aliases em português', () => {
    for (const name of ['SLOT', 'oblongo', 'OBL', 'rasgo']) assert.equal(resolveCommand(name)?.name, 'SLOT', name);
});

test('SLOT pela ribbon borda a borda: largura pela opção e dois pontos', async () => {
    const editor = scriptedEditor([{ keyword: 'l' }, { number: 12 }, { point: { x: 0, y: 0 } }, { point: { x: 0, y: 60 } }]);
    await COMMANDS.SLOT.run(editor, ['b']);
    const [e] = editor.doc.entities;
    assert.equal(editor.desc, 'Oblongo');
    const box = entityBox(e);
    near(box.minY, 0, 'minY');
    near(box.maxY, 60, 'maxY');
    near(box.maxX - box.minX, 12, 'largura');
    assert.equal(editor.memory.slotWidth, 12);
    assert.equal(editor.memory.slotMode, 'b');
    assert.ok(editor.previews[0][0], 'prévia do oblongo no segundo ponto');
});

test('SLOT pelo terminal: troca de modo, memória e repetição após comprimento inválido', async () => {
    const editor = scriptedEditor([
        { keyword: 'b' }, { point: { x: 0, y: 0 } }, { point: { x: 5, y: 0 } }, { point: { x: 30, y: 0 } },
    ]);
    editor.memory.slotWidth = 10;
    await COMMANDS.SLOT.run(editor, []);
    assert.ok(editor.logs.some((l) => l.level === 'error'), 'avisa comprimento menor que a largura');
    const box = entityBox(editor.doc.entities[0]);
    near(box.minX, 0, 'minX');
    near(box.maxX, 30, 'maxX');

    const again = scriptedEditor([{ point: { x: 0, y: 0 } }, { point: { x: 30, y: 0 } }]);
    again.memory = editor.memory;
    await COMMANDS.SLOT.run(again, ['c']);
    const box2 = entityBox(again.doc.entities[0]);
    near(box2.minX, -5, 'centro a centro estende um raio para cada lado');
    near(box2.maxX, 35, 'maxX');
});

test('slotParams reconhece o oblongo em qualquer vértice inicial e sentido', () => {
    const e = createSlotEntity({ x: 0, y: 0 }, { x: 30, y: 40 }, 10, 'c');
    const rotated = { ...e, vertices: [...e.vertices.slice(1), e.vertices[0]] };
    const reversed = { ...e, vertices: [...e.vertices].reverse().map((v, i, a) => ({ ...v, bulge: -(a[(i + 1) % 4].bulge) })) };
    for (const shape of [e, rotated, reversed]) {
        const p = slotParams(shape);
        assert.ok(p, 'reconhecido');
        near(p.width, 10, 'largura');
        near(p.centers, 50, 'centro a centro');
        near(p.length, 60, 'total');
    }
    assert.equal(slotParams(createRectangleEntity({ x: 0, y: 0 }, { x: 10, y: 5 })), null, 'retângulo não é oblongo');
    assert.equal(slotParams({ ...e, closed: false }), null);
    assert.equal(slotParams({ ...e, vertices: e.vertices.map((v, i) => (i === 1 ? { ...v, bulge: 0.5 } : v)) }), null);
});

test('resizeSlot: largura mantém os centros; comprimento e centro a centro mantêm o meio e a direção', () => {
    const e = { ...createSlotEntity({ x: 0, y: 0 }, { x: 0, y: 40 }, 10, 'c'), id: 'x', layer: 'FUROS', color: 1 };
    const w = resizeSlot(e, { width: 6 });
    let p = slotParams(w);
    near(p.width, 6, 'largura');
    near(p.centers, 40, 'centros parados');
    near(p.c1.x, 0, 'mesma direção');
    assert.equal(w.id, 'x');
    assert.equal(w.layer, 'FUROS');
    assert.equal(w.color, 1);
    p = slotParams(resizeSlot(e, { length: 70 }));
    near(p.length, 70, 'total');
    near(p.width, 10, 'largura mantida');
    near((p.c1.y + p.c2.y) / 2, 20, 'meio parado');
    near(p.c1.x, 0, 'direção vertical');
    p = slotParams(resizeSlot(e, { centers: 25 }));
    near(p.centers, 25, 'centros');
    near(p.length, 35, 'total');
    assert.throws(() => resizeSlot(e, { length: 8 }), /pelo menos a largura/);
    assert.throws(() => resizeSlot(e, { length: 10 }), /círculo/);
    assert.equal(resizeSlot({ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }, { width: 2 }), null);
});
