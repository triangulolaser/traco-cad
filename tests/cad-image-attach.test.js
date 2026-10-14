import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageCorners, imageVisibleCorners, imageLocalPoint } from '../src/cad/extra-entities.js';
import { COMMANDS, imageClipFromCorners } from '../src/cad/commands.js';
import { IMAGE_ACCEPT } from '../src/cad/file-types.js';
import { entityCurves } from '../src/cad/geometry.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;
const image = (extra = {}) => ({ id: 'img', type: 'image', position: { x: 10, y: 20 }, width: 200, height: 100, rotation: 0, src: 'data:', opacity: 1, ...extra });

test('o Abrir aceita JPG, PNG e BMP e manda a imagem para o desenho atual', async () => {
    assert.deepEqual(IMAGE_ACCEPT.split(',').sort(), ['.bmp', '.jpeg', '.jpg', '.png']);
    let accept = null;
    let opened = null;
    const logs = [];
    const editor = {
        pickFiles: async (a) => { accept = a; return [{ name: 'peça escaneada.JPG' }, { name: 'tabela.xlsx' }]; },
        openFiles: async (files) => { opened = files; },
        log: (msg) => logs.push(msg),
    };
    await COMMANDS.OPEN.run(editor);
    assert.ok(accept.includes('.jpg') && accept.includes('.dxf'));
    assert.deepEqual(opened.map((f) => f.name), ['peça escaneada.JPG']);
    assert.ok(logs.some((m) => m.includes('tabela.xlsx')));
});

test('recorte guarda frações do quadro e funciona com a imagem girada', () => {
    const plain = image();
    const clip = imageClipFromCorners(plain, { x: 60, y: 120 }, { x: 0, y: 70 });
    assert.deepEqual(clip, { u0: 0, v0: 0.5, u1: 0.25, v1: 1 });
    assert.equal(imageClipFromCorners(plain, { x: 500, y: 500 }, { x: 600, y: 600 }), null);

    const turned = image({ rotation: 90 });
    const local = imageLocalPoint(turned, { x: 10 - 50, y: 20 + 100 });
    assert.ok(near(local.u, 0.5) && near(local.v, 0.5));
    const c = imageVisibleCorners({ ...turned, clip: { u0: 0.5, v0: 0, u1: 1, v1: 1 } });
    assert.ok(near(c[0].x, 10) && near(c[0].y, 120));
    assert.ok(near(c[2].x, -90) && near(c[2].y, 220));
});

test('seleção e snap da imagem recortada seguem só a parte visível', () => {
    const clipped = image({ clip: { u0: 0.5, v0: 0.5, u1: 1, v1: 1 } });
    const xs = entityCurves(clipped).flatMap((s) => [s.a.x, s.b.x]);
    assert.equal(Math.min(...xs), 110);
    assert.deepEqual(imageCorners(clipped)[0], { x: 10, y: 20 });
});

test('IMAGEADJUST limita a opacidade entre 10% e 100% e só mexe em imagens', async () => {
    let doc = { entities: [image(), { id: 'l', type: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }], layers: [] };
    const editor = {
        get doc() { return doc; },
        getSelection: async () => ['img', 'l'],
        entitiesById: (ids) => doc.entities.filter((e) => ids.includes(e.id)),
        getNumber: async () => 5,
        commit: (_label, next) => { doc = next; },
        log: () => {},
    };
    await COMMANDS.IMAGEADJUST.run(editor);
    assert.equal(doc.entities.find((e) => e.id === 'img').opacity, 0.1);
    assert.equal(doc.entities.find((e) => e.id === 'l').opacity, undefined);
});

test('IMAGECLIP › Remover devolve a imagem inteira', async () => {
    let doc = { entities: [image({ clip: { u0: 0, v0: 0, u1: 0.5, v1: 0.5 } })], layers: [] };
    const editor = {
        get doc() { return doc; },
        getEntity: async () => ({ entity: doc.entities[0] }),
        getKeyword: async () => ({ key: 'r', label: 'Remover' }),
        commit: (_label, next) => { doc = next; },
        log: () => {},
    };
    await COMMANDS.IMAGECLIP.run(editor);
    assert.equal(doc.entities[0].clip, undefined);
});

test('folha A4 escaneada entra com 210 × 297 mm', async () => {
    const { imageDefaultWidthMm, imageDpi } = await import('../src/cad/commands.js');
    assert.equal(imageDefaultWidthMm(2480, 3508, 300), 210);
    assert.equal(imageDefaultWidthMm(2480, 3508, null), 210);
    assert.equal(imageDefaultWidthMm(1240, 1754, 72), 210);
    assert.equal(imageDefaultWidthMm(3508, 2480, 96), 297);
    assert.equal(imageDefaultWidthMm(3508, 4961, 300), 297); // A3
    assert.ok(Math.abs(imageDefaultWidthMm(600, 600, 300) - 50.8) < 1e-9);
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0x01, 0x2c, 0x01, 0x2c]);
    assert.equal(await imageDpi(new Blob([jfif])), 300);
});
