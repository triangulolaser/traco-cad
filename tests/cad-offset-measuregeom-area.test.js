import test from 'node:test';
import assert from 'node:assert/strict';
import {
    distanceToEntity,
    polygonAreaAndPerimeter,
    polylineArea,
    getEntityAreaAndPerimeter,
} from '../src/cad/edit-tools.js';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import { createDocument, addEntities } from '../src/cad/document.js';

function close(a, b, tol = 1e-4) {
    return Math.abs(a - b) <= tol;
}

test('distanceToEntity: calcula distância precisa até linha, círculo, arco e polilinha', () => {
    const line = { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    assert.ok(close(distanceToEntity({ x: 50, y: 25 }, line), 25));
    assert.ok(close(distanceToEntity({ x: -10, y: 0 }, line), 10)); // além do início

    const circle = { type: 'circle', center: { x: 0, y: 0 }, radius: 20 };
    assert.ok(close(distanceToEntity({ x: 0, y: 35 }, circle), 15)); // ponto externo
    assert.ok(close(distanceToEntity({ x: 0, y: 5 }, circle), 15));  // ponto interno

    const poly = {
        type: 'polyline',
        closed: true,
        vertices: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
            { x: 0, y: 50 },
        ],
    };
    assert.ok(close(distanceToEntity({ x: 25, y: -10 }, poly), 10));
});

test('polygonAreaAndPerimeter: calcula área e perímetro corretos por sequência de pontos', () => {
    // Retângulo 30 x 20
    const rectPts = [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
        { x: 0, y: 20 },
    ];
    const rectRes = polygonAreaAndPerimeter(rectPts);
    assert.ok(close(rectRes.area, 600));
    assert.ok(close(rectRes.perimeter, 100));

    // Triângulo base 20, altura 10 -> área 100
    const triPts = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 10, y: 10 },
    ];
    const triRes = polygonAreaAndPerimeter(triPts);
    assert.ok(close(triRes.area, 100));
    assert.ok(close(triRes.perimeter, 20 + 2 * Math.hypot(10, 10)));

    // Menos de 3 pontos
    assert.equal(polygonAreaAndPerimeter([{ x: 0, y: 0 }, { x: 10, y: 0 }]).area, 0);
});

test('getEntityAreaAndPerimeter: suporta círculo, elipse e polilinha fechada', () => {
    const circle = { type: 'circle', center: { x: 0, y: 0 }, radius: 10 };
    const circleRes = getEntityAreaAndPerimeter(circle);
    assert.ok(close(circleRes.area, Math.PI * 100));
    assert.ok(close(circleRes.perimeter, 2 * Math.PI * 10));

    const ellipse = {
        type: 'ellipse',
        center: { x: 0, y: 0 },
        major: { x: 20, y: 0 },
        ratio: 0.5,
    };
    const ellRes = getEntityAreaAndPerimeter(ellipse);
    assert.ok(close(ellRes.area, Math.PI * 20 * 10));
    assert.ok(ellRes.perimeter > 0);

    const poly = {
        type: 'polyline',
        closed: true,
        vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ],
    };
    const polyRes = getEntityAreaAndPerimeter(poly);
    assert.ok(close(polyRes.area, 100));
    assert.ok(close(polyRes.perimeter, 40));
});

test('Comando OFFSET: registrado com aliases e suporta modo Através, Apagar e Camada', async () => {
    assert.ok(COMMANDS.OFFSET);
    assert.ok(COMMANDS.OFFSET.aliases.includes('O'));
    assert.ok(COMMANDS.OFFSET.aliases.includes('DESLOC'));

    const cmd = resolveCommand('DESLOC');
    assert.ok(cmd);

    // Mock do editor com suporte a Através ('t')
    const sourceLine = { id: 1, type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, layer: '0' };
    let doc = addEntities(createDocument(), [sourceLine]);
    const commits = [];

    const editorThrough = {
        doc,
        memory: {},
        logs: [],
        log(msg, type = 'info') { this.logs.push({ msg, type }); },
        commit(desc, newDoc) { commits.push({ desc, doc: newDoc }); this.doc = newDoc; },
        async getPoint(prompt, opts) {
            if (opts?.options?.some(o => o.key === 't')) {
                // Seleciona a opção Através
                return { keyword: 't' };
            }
            if (prompt.includes('ponto através')) {
                // Ponto Y = 15
                return { point: { x: 50, y: 15 } };
            }
            return { enter: true };
        },
        async getEntity(prompt) {
            if (commits.length === 0) return { entity: this.doc.entities[0] };
            return null; // Encerra no segundo loop
        },
    };

    await COMMANDS.OFFSET.run(editorThrough);
    assert.equal(commits.length, 1);
    assert.equal(editorThrough.doc.entities.length, 2);
    const newLine = editorThrough.doc.entities[1];
    assert.ok(close(newLine.start.y, 15));
    assert.ok(close(newLine.end.y, 15));
});

test('Comando OFFSET: opção Apagar substitui entidade original', async () => {
    const sourceLine = { id: 1, type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, layer: '0' };
    let doc = addEntities(createDocument(), [sourceLine]);
    const commits = [];

    let step = 0;
    const editorErase = {
        doc,
        memory: {},
        logs: [],
        log(msg, type = 'info') { this.logs.push({ msg, type }); },
        commit(desc, newDoc) { commits.push({ desc, doc: newDoc }); this.doc = newDoc; },
        async getPoint(prompt, opts) {
            if (step === 0) {
                step++;
                return { keyword: 'e' }; // Escolhe Apagar
            }
            if (step === 1) {
                step++;
                return { number: 10 }; // Define distância 10
            }
            if (prompt.includes('lado do deslocamento')) {
                return { point: { x: 50, y: 10 } };
            }
            return { enter: true };
        },
        async getKeyword(prompt, opts) {
            return { key: 's', label: 'Sim' }; // Confirma Apagar = Sim
        },
        async getEntity(prompt) {
            if (commits.length === 0) return { entity: this.doc.entities[0] };
            return null;
        },
    };

    await COMMANDS.OFFSET.run(editorErase);
    assert.equal(commits.length, 1);
    // Como apagou a origem, o documento ainda deve ter 1 entidade, mas deslocada para Y=10!
    assert.equal(editorErase.doc.entities.length, 1);
    const remaining = editorErase.doc.entities[0];
    assert.ok(close(remaining.start.y, 10));
    assert.ok(close(remaining.end.y, 10));
});

test('Comando OFFSET: digitar nova distância durante o comando troca o valor sem sair', async () => {
    const sourceLine = { id: 1, type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, layer: '0' };
    const doc = addEntities(createDocument(), [sourceLine]);
    const commits = [];
    const entityAnswers = [{ number: 30 }, 'line', { number: 50 }, 'line', null];
    const sideAnswers = [{ point: { x: 50, y: 1 } }, { number: 70 }, { point: { x: 50, y: -1 } }];
    const editor = {
        doc,
        memory: {},
        log() {},
        commit(desc, newDoc) { commits.push(newDoc); this.doc = newDoc; },
        async getPoint(prompt) {
            if (prompt.includes('lado do deslocamento')) return sideAnswers.shift();
            return { number: 10 };
        },
        async getEntity(prompt, opts) {
            assert.equal(opts.allowNumber, true);
            const a = entityAnswers.shift();
            return a === 'line' ? { entity: sourceLine } : a;
        },
    };

    await COMMANDS.OFFSET.run(editor);
    assert.equal(commits.length, 2);
    const ys = editor.doc.entities.filter((e) => e.id !== 1).map((e) => e.start.y).sort((a, b) => a - b);
    // 30 no primeiro, 50 → 70 trocado na escolha do lado
    assert.ok(close(ys[0], -70));
    assert.ok(close(ys[1], 30));
    assert.equal(editor.memory.offset, 70);
});

test('Comando AREA: calcula área por objeto e suporta Adicionar/Subtrair', async () => {
    assert.ok(COMMANDS.AREA);
    assert.ok(COMMANDS.AREA.aliases.includes('AA'));
    assert.equal(resolveCommand('AREA').name, 'AREA');
    assert.equal(resolveCommand('AA').name, 'AREA');

    const circle1 = { id: 1, type: 'circle', center: { x: 0, y: 0 }, radius: 10, layer: '0' }; // Área ~314.159
    const circle2 = { id: 2, type: 'circle', center: { x: 50, y: 0 }, radius: 5, layer: '0' };  // Área ~78.5398
    let doc = addEntities(createDocument(), [circle1, circle2]);

    const logs = [];
    let promptCount = 0;
    let pickCount = 0;

    const editorArea = {
        doc,
        memory: {},
        logs,
        log(msg, type = 'info') { this.logs.push({ msg, type }); },
        async getPoint(prompt, opts) {
            promptCount++;
            if (promptCount === 1) return { keyword: 'a' }; // Entra no modo Adicionar
            if (promptCount === 2) return { keyword: 'o' }; // Seleciona primeiro objeto
            if (promptCount === 3) return { keyword: 's' }; // Muda para Subtrair
            if (promptCount === 4) return { keyword: 'o' }; // Seleciona segundo objeto
            return { enter: true };
        },
        async getEntity(prompt) {
            pickCount++;
            if (pickCount === 1) return { entity: circle1 };
            if (pickCount === 2) return { entity: circle2 };
            return null;
        },
    };

    await COMMANDS.AREA.run(editorArea);
    // Verificamos se o log calculou e subtraiu as áreas
    const hasAddedLog = logs.some(l => l.msg.includes('314.1593'));
    const hasSubtractedLog = logs.some(l => l.msg.includes('235.6194')); // 314.1593 - 78.5398 = 235.6195
    assert.ok(hasAddedLog);
    assert.ok(hasSubtractedLog);
});

test('Comando MEASUREGEOM e ID: aliases e medição de raio e ângulo', async () => {
    assert.ok(COMMANDS.MEASUREGEOM);
    assert.ok(COMMANDS.MEASUREGEOM.aliases.includes('MEDIRGEOM'));
    assert.ok(COMMANDS.MEASUREGEOM.aliases.includes('MGEOM'));
    assert.equal(resolveCommand('MEASUREGEOM').name, 'MEASUREGEOM');
    assert.equal(resolveCommand('MEDIRGEOM').name, 'MEASUREGEOM');

    const arc = { id: 1, type: 'arc', center: { x: 0, y: 0 }, radius: 25, start: 0, end: Math.PI / 2 };
    const line1 = { id: 2, type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const line2 = { id: 3, type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 10 } };
    const doc = addEntities(createDocument(), [arc, line1, line2]);

    // Teste de medição de Raio via MEASUREGEOM
    const logsRadius = [];
    const editorRadius = {
        doc,
        logs: logsRadius,
        log(msg) { this.logs.push(msg); },
        async getKeyword(prompt, opts) { return { key: 'r' }; },
        async getEntity(prompt) { return { entity: arc }; },
    };
    await COMMANDS.MEASUREGEOM.run(editorRadius);
    assert.ok(logsRadius.some(m => m.includes('Raio = 25') && m.includes('Diâmetro = 50')));

    // Teste de medição de Ângulo entre 2 linhas ortogonais
    const logsAngle = [];
    let linePick = 0;
    const editorAngle = {
        doc,
        logs: logsAngle,
        log(msg) { this.logs.push(msg); },
        async getKeyword(prompt, opts) { return { key: 'a' }; },
        async getEntity(prompt) {
            linePick++;
            return { entity: linePick === 1 ? line1 : line2 };
        },
    };
    await COMMANDS.MEASUREGEOM.run(editorAngle);
    assert.ok(logsAngle.some(m => m.includes('90')));

    // Teste de ID
    const logsId = [];
    const editorId = {
        doc,
        logs: logsId,
        log(msg) { this.logs.push(msg); },
        async getPoint(prompt) { return { point: { x: 12.345, y: 67.89 } }; },
    };
    await COMMANDS.ID.run(editorId);
    assert.ok(logsId.some(m => m.includes('X = 12.345') && m.includes('Y = 67.89') && m.includes('Z = 0.000')));
});
