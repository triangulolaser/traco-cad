import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createXline,
    createRay,
    xlineBisector,
    xlineOffsetDistance,
    xlineOffsetThrough,
    gripsFor,
    moveGrip,
    CONSTRUCTION_LINE_LENGTH,
} from '../src/cad/edit-tools.js';
import { transformEntity, distance, angleOf } from '../src/cad/geometry.js';
import { writeDxf, parseDxf } from '../src/cad/dxf.js';
import { COMMANDS } from '../src/cad/commands.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('createXline: cria linha de construção infinita com direção e ponto base normalizados', () => {
    const xl = createXline({ x: 10, y: 20 }, { x: 2, y: 0 });
    assert.equal(xl.type, 'line');
    assert.equal(xl.construction, 'xline');
    assert.deepEqual(xl.point, { x: 10, y: 20 });
    assert.deepEqual(xl.basePoint, { x: 10, y: 20 });
    assert.ok(close(xl.unitVector.x, 1) && close(xl.unitVector.y, 0));
    assert.ok(close(xl.start.x, 10 - CONSTRUCTION_LINE_LENGTH));
    assert.ok(close(xl.start.y, 20));
    assert.ok(close(xl.end.x, 10 + CONSTRUCTION_LINE_LENGTH));
    assert.ok(close(xl.end.y, 20));
});

test('createRay: cria raio semi-infinito com início na origem', () => {
    const ray = createRay({ x: 5, y: 15 }, { x: 0, y: 5 });
    assert.equal(ray.type, 'line');
    assert.equal(ray.construction, 'ray');
    assert.deepEqual(ray.start, { x: 5, y: 15 });
    assert.deepEqual(ray.point, { x: 5, y: 15 });
    assert.ok(close(ray.unitVector.x, 0) && close(ray.unitVector.y, 1));
    assert.ok(close(ray.end.x, 5));
    assert.ok(close(ray.end.y, 15 + CONSTRUCTION_LINE_LENGTH));
});

test('xlineBisector: calcula a bissetriz angular exata entre dois segmentos a partir de um vértice', () => {
    // Vértice na origem, P1 no eixo X (0 rad), P2 no eixo Y (PI/2 rad) -> bissetriz a 45 graus (PI/4 rad)
    const bis = xlineBisector({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    assert.equal(bis.construction, 'xline');
    assert.deepEqual(bis.point, { x: 0, y: 0 });
    const expectedDir = Math.SQRT1_2; // cos(45°) = sin(45°) = 0.707106...
    assert.ok(close(bis.unitVector.x, expectedDir, 1e-5));
    assert.ok(close(bis.unitVector.y, expectedDir, 1e-5));
});

test('xlineOffsetDistance e xlineOffsetThrough: geram linhas paralelas na distância e ponto corretos', () => {
    const baseLine = { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };

    // Offset por distância com ponto do lado superior (+Y)
    const offTop = xlineOffsetDistance(baseLine, 25, { x: 50, y: 10 });
    assert.equal(offTop.construction, 'xline');
    assert.ok(close(offTop.point.y, 25));
    assert.ok(close(offTop.unitVector.x, 1) && close(offTop.unitVector.y, 0));

    // Offset por distância com ponto do lado inferior (-Y)
    const offBottom = xlineOffsetDistance(baseLine, 15, { x: 50, y: -10 });
    assert.ok(close(offBottom.point.y, -15));

    // Offset através de um ponto específico
    const offThrough = xlineOffsetThrough(baseLine, { x: 30, y: 42 });
    assert.equal(offThrough.construction, 'xline');
    assert.ok(close(offThrough.point.x, 30) && close(offThrough.point.y, 42));
    assert.ok(close(offThrough.unitVector.x, 1) && close(offThrough.unitVector.y, 0));
});

test('transformEntity e grips: movem e rotacionam xline e ray preservando consistência', () => {
    const xl = createXline({ x: 10, y: 10 }, { x: 1, y: 0 });

    // Grips
    const grips = gripsFor(xl);
    assert.equal(grips.length, 1);
    assert.equal(grips[0].key, 'point');
    assert.deepEqual(grips[0].point, { x: 10, y: 10 });

    // Mover grip
    const moved = moveGrip(xl, 'point', { x: 20, y: 30 });
    assert.deepEqual(moved.point, { x: 20, y: 30 });

    // Translação
    const translated = transformEntity(xl, (p) => ({ x: p.x + 5, y: p.y + 10 }));
    assert.deepEqual(translated.point, { x: 15, y: 20 });
    assert.ok(close(translated.start.y, 20));
    assert.ok(close(translated.end.y, 20));

    // Rotação de 90° em torno da origem
    const rotated = transformEntity(xl, (p) => ({ x: -p.y, y: p.x }));
    assert.deepEqual(rotated.point, { x: -10, y: 10 });
    assert.ok(close(rotated.unitVector.x, 0) && close(rotated.unitVector.y, 1));
});

test('DXF: exportação e importação roundtrip de XLINE e RAY', () => {
    const xl = createXline({ x: 15, y: 25 }, { x: 0, y: 1 });
    const ray = createRay({ x: 50, y: 60 }, { x: 1, y: 0 });

    const doc = {
        layers: [{ name: '0', color: 7, visible: true, locked: false }],
        entities: [xl, ray],
    };

    const dxfText = writeDxf(doc);
    assert.match(dxfText, /\n\s*XLINE\r?\n/);
    assert.match(dxfText, /\n\s*RAY\r?\n/);

    const imported = parseDxf(dxfText, { preserveDimensions: true });
    const impXl = imported.entities.find((e) => e.construction === 'xline');
    const impRay = imported.entities.find((e) => e.construction === 'ray');

    assert.ok(impXl, 'Deveria importar XLINE como entidade de construção');
    assert.ok(impRay, 'Deveria importar RAY como entidade de construção');

    assert.ok(close(impXl.point.x, 15) && close(impXl.point.y, 25));
    assert.ok(close(impXl.unitVector.x, 0) && close(impXl.unitVector.y, 1));

    assert.ok(close(impRay.point.x, 50) && close(impRay.point.y, 60));
    assert.ok(close(impRay.unitVector.x, 1) && close(impRay.unitVector.y, 0));
});

test('Comando RAY e XLINE: registrados com aliases AutoCAD e opções interativas', async () => {
    assert.ok(COMMANDS.RAY, 'Comando RAY deve existir');
    assert.deepEqual(COMMANDS.RAY.aliases.slice(0, 1), ['RAIO']);

    assert.ok(COMMANDS.XLINE, 'Comando XLINE deve existir');
    assert.deepEqual(COMMANDS.XLINE.aliases.slice(0, 3), ['XL', 'LINHAC', 'LINHACONSTR']);

    // Teste de execução do RAY por mock
    const commits = [];
    const mockRayEditor = {
        doc: { currentLayer: '0', entities: [] },
        getPoint: async (prompt, opts) => {
            if (prompt.includes('Ponto inicial')) return { point: { x: 10, y: 10 } };
            if (prompt.includes('Ponto através')) {
                if (commits.length === 0) return { point: { x: 20, y: 10 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            commits.push({ label, entities: newDoc.entities });
            mockRayEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.RAY.run(mockRayEditor);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].label, 'Raio');
    const createdRay = commits[0].entities[0];
    assert.equal(createdRay.construction, 'ray');
    assert.deepEqual(createdRay.start, { x: 10, y: 10 });
    assert.ok(close(createdRay.unitVector.x, 1) && close(createdRay.unitVector.y, 0));

    // Teste de execução do XLINE Horizontal (args ['h'])
    const xlCommits = [];
    let xlStep = 0;
    const mockXlEditor = {
        doc: { currentLayer: '0', entities: [] },
        getPoint: async (prompt, opts) => {
            if (xlStep === 0) {
                xlStep++;
                return { point: { x: 0, y: 50 } };
            }
            return { enter: true };
        },
        commit: (label, newDoc) => {
            xlCommits.push({ label, entities: newDoc.entities });
            mockXlEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.XLINE.run(mockXlEditor, ['h']);
    assert.equal(xlCommits.length, 1);
    assert.equal(xlCommits[0].label, 'Linha de construção (horizontal)');
    const createdXl = xlCommits[0].entities[0];
    assert.equal(createdXl.construction, 'xline');
    assert.ok(close(createdXl.point.y, 50));
    assert.ok(close(createdXl.unitVector.x, 1) && close(createdXl.unitVector.y, 0));
});

test('XLINE opções: Vertical, Ângulo, Bissetriz e Deslocamento por terminal', async () => {
    // 1. Vertical
    const vCommits = [];
    const mockVEditor = {
        doc: { currentLayer: '0', entities: [] },
        getPoint: async (prompt) => {
            if (prompt.includes('Especifique um ponto')) return { keyword: 'v' };
            if (vCommits.length === 0) return { point: { x: 75, y: 0 } };
            return { enter: true };
        },
        commit: (label, newDoc) => {
            vCommits.push({ label, entities: newDoc.entities });
            mockVEditor.doc = newDoc;
        },
        log: () => {},
    };
    await COMMANDS.XLINE.run(mockVEditor);
    assert.equal(vCommits.length, 1);
    assert.equal(vCommits[0].label, 'Linha de construção (vertical)');
    assert.ok(close(vCommits[0].entities[0].point.x, 75));
    assert.ok(close(vCommits[0].entities[0].unitVector.x, 0) && close(vCommits[0].entities[0].unitVector.y, 1));

    // 2. Ângulo direto
    const aCommits = [];
    const mockAEditor = {
        doc: { currentLayer: '0', entities: [] },
        getPoint: async (prompt) => {
            if (prompt.includes('Especifique um ponto')) return { keyword: 'a' };
            if (aCommits.length === 0) return { point: { x: 10, y: 10 } };
            return { enter: true };
        },
        request: async (type, prompt) => {
            if (prompt.includes('ângulo da linha')) return { number: 45 };
            return null;
        },
        commit: (label, newDoc) => {
            aCommits.push({ label, entities: newDoc.entities });
            mockAEditor.doc = newDoc;
        },
        log: () => {},
    };
    await COMMANDS.XLINE.run(mockAEditor);
    assert.equal(aCommits.length, 1);
    assert.equal(aCommits[0].label, 'Linha de construção (ângulo)');
    assert.ok(close(aCommits[0].entities[0].unitVector.x, Math.SQRT1_2, 1e-4));
    assert.ok(close(aCommits[0].entities[0].unitVector.y, Math.SQRT1_2, 1e-4));

    // 3. Bissetriz
    const bCommits = [];
    const mockBEditor = {
        doc: { currentLayer: '0', entities: [] },
        getPoint: async (prompt) => {
            if (prompt.includes('Especifique um ponto ou [')) return { keyword: 'b' };
            if (prompt.includes('vértice')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('inicial')) return { point: { x: 100, y: 0 } };
            if (prompt.includes('final')) {
                if (bCommits.length === 0) return { point: { x: 0, y: 100 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            bCommits.push({ label, entities: newDoc.entities });
            mockBEditor.doc = newDoc;
        },
        log: () => {},
    };
    await COMMANDS.XLINE.run(mockBEditor);
    assert.equal(bCommits.length, 1);
    assert.equal(bCommits[0].label, 'Linha de construção (bissetriz)');
    assert.ok(close(bCommits[0].entities[0].unitVector.x, Math.SQRT1_2, 1e-4));
    assert.ok(close(bCommits[0].entities[0].unitVector.y, Math.SQRT1_2, 1e-4));

    // 4. Deslocamento por distância
    const dCommits = [];
    let dHits = 0;
    const existingLine = { id: 'base-line', type: 'line', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } };
    const mockDEditor = {
        doc: { currentLayer: '0', entities: [existingLine] },
        memory: {},
        getPoint: async (prompt) => {
            if (prompt.includes('Especifique um ponto ou [')) return { keyword: 'd' };
            if (prompt.includes('lado')) return { point: { x: 50, y: 20 } };
            return null;
        },
        request: async (type, prompt) => {
            if (prompt.includes('distância de deslocamento')) return { number: 30 };
            return null;
        },
        getEntity: async () => {
            dHits++;
            return dHits === 1 ? { entity: existingLine } : null;
        },
        commit: (label, newDoc) => {
            dCommits.push({ label, entities: newDoc.entities });
            mockDEditor.doc = newDoc;
        },
        log: () => {},
    };
    await COMMANDS.XLINE.run(mockDEditor);
    assert.equal(dCommits.length, 1);
    assert.equal(dCommits[0].label, 'Linha de construção (deslocamento)');
    const createdOffset = dCommits[0].entities[dCommits[0].entities.length - 1];
    assert.equal(createdOffset.construction, 'xline');
    assert.ok(close(createdOffset.point.y, 30));
    assert.ok(close(createdOffset.unitVector.x, 1) && close(createdOffset.unitVector.y, 0));

    // 5. Modo padrão (Dois pontos)
    const ptsCommits = [];
    let ptStep = 0;
    const mockPtsEditor = {
        doc: { currentLayer: '0', entities: [] },
        getPoint: async (prompt) => {
            if (prompt.includes('Especifique um ponto ou [')) return { point: { x: 10, y: 20 } };
            if (prompt.includes('Ponto através:')) {
                ptStep++;
                if (ptStep === 1) return { point: { x: 20, y: 30 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            ptsCommits.push({ label, entities: newDoc.entities });
            mockPtsEditor.doc = newDoc;
        },
        log: () => {},
    };
    await COMMANDS.XLINE.run(mockPtsEditor);
    assert.equal(ptsCommits.length, 1);
    assert.equal(ptsCommits[0].label, 'Linha de construção');
    const createdTwoPts = ptsCommits[0].entities[0];
    assert.equal(createdTwoPts.construction, 'xline');
    assert.deepEqual(createdTwoPts.point, { x: 10, y: 20 });
    assert.ok(close(createdTwoPts.unitVector.x, Math.SQRT1_2, 1e-4));
    assert.ok(close(createdTwoPts.unitVector.y, Math.SQRT1_2, 1e-4));
});
