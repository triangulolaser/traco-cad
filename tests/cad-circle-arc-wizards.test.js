// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    arcFromStartCenterEnd,
    arcFromStartCenterAngle,
    arcFromStartCenterChord,
    arcFromStartEndAngle,
    arcFromStartEndDirection,
    arcFromStartEndRadius,
    circleFromTangentsAndRadius,
    distance,
    degToRad,
    radToDeg,
} from '../src/cad/geometry.js';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';

test('Geometria: arcFromStartCenterEnd calcula centro, raio e ângulos CCW com precisão', () => {
    const start = { x: 10, y: 0 };
    const center = { x: 0, y: 0 };
    const end = { x: 0, y: 10 };

    const arc = arcFromStartCenterEnd(start, center, end);
    assert.ok(arc, 'Arco deve ser criado');
    assert.equal(arc.radius, 10);
    assert.equal(arc.start, 0);
    assert.ok(Math.abs(arc.end - Math.PI / 2) < 1e-6, 'Ângulo final deve ser 90 graus (PI/2)');
    assert.equal(arc.center.x, 0);
    assert.equal(arc.center.y, 0);
});

test('Geometria: arcFromStartCenterAngle cria arco com ângulo positivo (CCW) e negativo', () => {
    const start = { x: 10, y: 0 };
    const center = { x: 0, y: 0 };

    // 90 graus
    const arc90 = arcFromStartCenterAngle(start, center, Math.PI / 2);
    assert.ok(arc90);
    assert.equal(arc90.radius, 10);
    assert.equal(arc90.start, 0);
    assert.ok(Math.abs(arc90.end - Math.PI / 2) < 1e-6);

    // -90 graus
    const arcNeg = arcFromStartCenterAngle(start, center, -Math.PI / 2);
    assert.ok(arcNeg);
    assert.equal(arcNeg.radius, 10);
});

test('Geometria: arcFromStartCenterChord cria arco subtendido por corda e rejeita corda > diâmetro', () => {
    const start = { x: 10, y: 0 };
    const center = { x: 0, y: 0 };

    // Para R=10, corda de 90° é sqrt(10^2 + 10^2) = 14.1421356
    const chord = Math.sqrt(200);
    const arc = arcFromStartCenterChord(start, center, chord);
    assert.ok(arc);
    assert.equal(arc.radius, 10);
    assert.ok(Math.abs(arc.end - Math.PI / 2) < 1e-4);

    // Corda maior que 2*R (ex: 25 para R=10) deve retornar null
    assert.equal(arcFromStartCenterChord(start, center, 25), null);
});

test('Geometria: arcFromStartEndAngle determina centro e raio a partir de dois pontos e ângulo incluído', () => {
    const start = { x: 10, y: 0 };
    const end = { x: 0, y: 10 };

    // Ângulo de 90° entre (10,0) e (0,10) deve ter centro em (0,0) e raio 10
    const arc = arcFromStartEndAngle(start, end, Math.PI / 2);
    assert.ok(arc);
    assert.ok(Math.abs(arc.center.x) < 1e-5);
    assert.ok(Math.abs(arc.center.y) < 1e-5);
    assert.ok(Math.abs(arc.radius - 10) < 1e-5);
});

test('Geometria: arcFromStartEndDirection constrói arco tangente ao vetor de direção', () => {
    const start = { x: 10, y: 0 };
    const end = { x: 0, y: 10 };
    // Tangente apontando para cima no ponto inicial (+Y)
    const dir = { x: 10, y: 5 };

    const arc = arcFromStartEndDirection(start, end, dir);
    assert.ok(arc);
    assert.ok(arc.radius > 0);
});

test('Geometria: arcFromStartEndRadius constrói arco menor ou maior e rejeita raio menor que meia-corda', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 20, y: 0 };
    // Corda = 20, meia-corda = 10

    // Raio válido = 10 (semi-círculo)
    const arcSemi = arcFromStartEndRadius(start, end, 10);
    assert.ok(arcSemi);
    assert.ok(Math.abs(arcSemi.radius - 10) < 1e-5);
    assert.ok(Math.abs(arcSemi.center.x - 10) < 1e-5);

    // Raio menor que meia-corda (ex: 8) deve falhar
    assert.equal(arcFromStartEndRadius(start, end, 8), null);
});

test('Geometria: circleFromTangentsAndRadius determina círculo tangente a duas linhas', () => {
    // Linha 1 horizontal no eixo X: (0,0) -> (100,0)
    const line1 = { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const pick1 = { x: 20, y: 5 }; // quadrante +Y

    // Linha 2 vertical no eixo Y: (0,0) -> (0,100)
    const line2 = { type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };
    const pick2 = { x: 5, y: 20 }; // quadrante +X

    const r = 10;
    const circle = circleFromTangentsAndRadius(line1, pick1, line2, pick2, r);
    assert.ok(circle);
    assert.equal(circle.radius, 10);
    assert.ok(Math.abs(circle.center.x - 10) < 1e-5, 'Centro X deve ser 10');
    assert.ok(Math.abs(circle.center.y - 10) < 1e-5, 'Centro Y deve ser 10');
});

test('Comandos: CIRCLE e ARC despacham todos os submodos suportados', () => {
    const circleCmd = resolveCommand('CIRCLE');
    const arcCmd = resolveCommand('ARC');

    assert.ok(circleCmd, 'Comando CIRCLE deve existir');
    assert.ok(arcCmd, 'Comando ARC deve existir');

    // Aliases
    assert.equal(resolveCommand('C').name, 'CIRCLE');
    assert.equal(resolveCommand('CIRCULO').name, 'CIRCLE');
    assert.equal(resolveCommand('A').name, 'ARC');
    assert.equal(resolveCommand('ARCO').name, 'ARC');
});

test('UI Blade e Desktop contêm split-buttons de Círculo e Arco com todos os 15 assistentes', () => {
    const bladePath = resolve('index.html');
    const desktopPath = resolve('index.html');

    const blade = readFileSync(bladePath, 'utf8');
    const desktop = readFileSync(desktopPath, 'utf8');

    for (const [name, content] of [['Desktop', desktop]]) {
        // Verifica split buttons
        if (name === 'Blade') {
            assert.ok(content.includes("'id' => 'circle'") && content.includes('data-cad-split='), `${name} deve ter split de círculo`);
            assert.ok(content.includes("'id' => 'arc'") && content.includes('data-cad-split='), `${name} deve ter split de arco`);
        } else {
            assert.ok(content.includes('data-cad-split="circle"'), `${name} deve ter split de círculo`);
            assert.ok(content.includes('data-cad-split="arc"'), `${name} deve ter split de arco`);
        }

        // 5 assistentes de círculo
        assert.ok(content.includes('Circulo Centro-Raio') || content.includes('Círculo Centro-Raio'), `${name} deve conter Centro-Raio`);
        assert.ok(content.includes('Circulo Centro-Diâmetro') || content.includes('Círculo Centro-Diâmetro'), `${name} deve conter Centro-Diâmetro`);
        assert.ok(content.includes('Círculo 2-Pontos') || content.includes('Circulo 2-Pontos'), `${name} deve conter 2-Pontos`);
        assert.ok(content.includes('Circulo 3-Pontos') || content.includes('Círculo 3-Pontos'), `${name} deve conter 3-Pontos`);
        assert.ok(content.includes('Circulo Tangente-Raio') || content.includes('Círculo Tangente-Raio'), `${name} deve conter Tangente-Raio`);

        // 10 assistentes de arco
        assert.ok(content.includes('Arco 3-Pontos'), `${name} deve conter Arco 3-Pontos`);
        assert.ok(content.includes('Arco Iniciar-Centro-Fim'), `${name} deve conter Iniciar-Centro-Fim`);
        assert.ok(content.includes('Arco Inicio-Centro-Angulo') || content.includes('Arco Início-Centro-Ângulo'), `${name} deve conter Início-Centro-Ângulo`);
        assert.ok(content.includes('Arco Inicio-Centro-Comprimento') || content.includes('Arco Início-Centro-Comprimento'), `${name} deve conter Início-Centro-Comprimento`);
        assert.ok(content.includes('Arco Inicio-Fim-Angulo') || content.includes('Arco Início-Fim-Ângulo'), `${name} deve conter Início-Fim-Ângulo`);
        assert.ok(content.includes('Arco Inicio-Fim-Direção') || content.includes('Arco Início-Fim-Direção') || content.includes('Arco Inicio-Fim-Direcao'), `${name} deve conter Início-Fim-Direção`);
        assert.ok(content.includes('Arco Inicio-Fim-Raio') || content.includes('Arco Início-Fim-Raio'), `${name} deve conter Início-Fim-Raio`);
        assert.ok(content.includes('Arco Centro-Inicio-Fim') || content.includes('Arco Centro-Início-Fim'), `${name} deve conter Centro-Início-Fim`);
        assert.ok(content.includes('Arco Centro-Inicio-Angulo') || content.includes('Arco Centro-Início-Ângulo'), `${name} deve conter Centro-Início-Ângulo`);
        assert.ok(content.includes('Arco Centro-Inicio-Comprimento') || content.includes('Arco Centro-Início-Comprimento'), `${name} deve conter Centro-Início-Comprimento`);
    }
});

test('UI CSS e JS: Dropdown do split button usa position: fixed e z-index >= 100000 para evitar clipping por overflow', () => {
    const cssPath = resolve('src/styles/cad.css');
    const jsPath = resolve('src/cad.js');

    const css = readFileSync(cssPath, 'utf8');
    const js = readFileSync(jsPath, 'utf8');

    // Valida que o CSS define position: fixed e z-index de sobreposição
    assert.match(css, /\.cad-ribbon-dropdown-menu\s*\{[^}]*position:\s*fixed/);
    assert.match(css, /\.cad-ribbon-dropdown-menu\s*\{[^}]*z-index:\s*100000/);

    // Valida que o JS calcula posicionamento dinâmico em tela com getBoundingClientRect
    assert.ok(js.includes('positionMenu'), 'cad.js deve definir função positionMenu');
    assert.ok(js.includes('menu.style.position = \'fixed\''), 'cad.js deve posicionar menu como fixed');
    assert.ok(js.includes('rect.bottom + 2'), 'cad.js deve ancorar logo abaixo do botão');
    assert.ok(js.includes('addEventListener(\'scroll\''), 'cad.js deve fechar menu ao rolar painel da ribbon');
});

function createMockEditor() {
    const doc = {
        entities: [],
        layers: [{ name: '0', color: '#ffffff' }],
        currentLayer: '0',
    };
    const prompts = [];
    const commits = [];
    const pointQueue = [];
    return {
        doc,
        prompts,
        commits,
        pointQueue,
        log() {},
        invalidate() {},
        render() {},
        async getPoint(prompt, options = {}) {
            prompts.push({ prompt, options });
            if (pointQueue.length > 0) {
                const next = pointQueue.shift();
                return typeof next === 'function' ? next(prompt, options) : next;
            }
            return null;
        },
        commit(label, updatedDoc) {
            commits.push({ label, doc: updatedDoc });
            this.doc = updatedDoc;
        },
    };
}

test('Comando ARC (modo padrão interativo): segue sequência 1-Ponto inicial, 2-Ponto final, 3-Passagem', async () => {
    const editor = createMockEditor();
    editor.pointQueue.push(
        { point: { x: 0, y: 0 } },   // Ponto 1: inicial
        { point: { x: 20, y: 0 } },  // Ponto 2: final
        { point: { x: 10, y: 10 } }, // Ponto 3: passagem
    );

    const arcCmd = resolveCommand('ARC');
    await arcCmd.run(editor, []);

    assert.equal(editor.prompts.length, 3);
    assert.match(editor.prompts[0].prompt, /Ponto inicial/i);
    assert.match(editor.prompts[1].prompt, /Ponto final/i);
    assert.match(editor.prompts[2].prompt, /passar/i);

    assert.equal(editor.commits.length, 1);
    assert.equal(editor.commits[0].label, 'Arco');
    const created = editor.commits[0].doc.entities.find(e => e.type === 'arc');
    assert.ok(created, 'Entidade de arco deve ser criada');
    assert.ok(Math.abs(created.center.x - 10) < 1e-5);
    assert.ok(Math.abs(created.center.y - 0) < 1e-5);
    assert.ok(Math.abs(created.radius - 10) < 1e-5);
});

test('Comando ARC 3p: segue sequência 1-Ponto inicial, 2-Ponto final, 3-Passagem', async () => {
    const editor = createMockEditor();
    editor.pointQueue.push(
        { point: { x: 0, y: 0 } },   // Ponto 1: inicial
        { point: { x: 20, y: 0 } },  // Ponto 2: final
        { point: { x: 10, y: 10 } }, // Ponto 3: passagem
    );

    const arcCmd = resolveCommand('ARC');
    await arcCmd.run(editor, ['3p']);

    assert.equal(editor.prompts.length, 3);
    assert.match(editor.prompts[0].prompt, /Ponto inicial/i);
    assert.match(editor.prompts[1].prompt, /Ponto final/i);
    assert.match(editor.prompts[2].prompt, /passar/i);

    assert.equal(editor.commits.length, 1);
    assert.equal(editor.commits[0].label, 'Arco');
    const created = editor.commits[0].doc.entities.find(e => e.type === 'arc');
    assert.ok(created, 'Entidade de arco deve ser criada');
    assert.ok(Math.abs(created.center.x - 10) < 1e-5);
    assert.ok(Math.abs(created.center.y - 0) < 1e-5);
    assert.ok(Math.abs(created.radius - 10) < 1e-5);
});



function createPolygonEditor(points, keyword) {
    const editor = createMockEditor();
    editor.memory = {};
    editor.keywords = [];
    editor.getNumber = async () => 6;
    editor.getKeyword = async (prompt, options, def) => { editor.keywords.push(prompt); return { key: keyword ?? def }; };
    editor.pointQueue.push(...points.map((p) => (p.keyword ? p : { point: p })));
    return editor;
}

const polygonVertices = (editor) => editor.commits[0].doc.entities.find((e) => e.type === 'polyline').vertices;

test('POLYGON i (ribbon Centro-Vértice): vértice no ponto clicado, sem perguntar inscrito/circunscrito', async () => {
    const editor = createPolygonEditor([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    await resolveCommand('POLYGON').run(editor, ['i']);
    assert.equal(editor.keywords.length, 0);
    assert.equal(editor.prompts[0].options.options, undefined, 'sem a opção Aresta no centro');
    const v = polygonVertices(editor);
    assert.equal(v.length, 6);
    assert.ok(Math.abs(v[0].x - 10) < 1e-9 && Math.abs(v[0].y) < 1e-9);
});

test('POLYGON c (ribbon Centro-Lado): meio do lado no ponto clicado', async () => {
    const editor = createPolygonEditor([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    await resolveCommand('POLYGON').run(editor, ['c']);
    assert.equal(editor.keywords.length, 0);
    const v = polygonVertices(editor);
    const mids = v.map((p, i) => ({ x: (p.x + v[(i + 1) % 6].x) / 2, y: (p.y + v[(i + 1) % 6].y) / 2 }));
    assert.ok(mids.some((m) => Math.abs(m.x - 10) < 1e-9 && Math.abs(m.y) < 1e-9), 'um lado tangencia (10,0)');
});

test('POLYGON e (ribbon Borda): lado entre os dois pontos, sem pedir centro', async () => {
    const editor = createPolygonEditor([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    await resolveCommand('POLYGON').run(editor, ['e']);
    assert.match(editor.prompts[0].prompt, /Primeiro ponto da aresta/);
    const v = polygonVertices(editor);
    assert.deepEqual([v[0].x, v[0].y, v[1].x, v[1].y], [0, 0, 10, 0]);
    assert.equal(v.length, 6);
});

test('POLYGON sem modo (terminal): mantém Aresta e a pergunta inscrito/circunscrito', async () => {
    const editor = createPolygonEditor([{ x: 0, y: 0 }, { x: 10, y: 0 }], 'i');
    await resolveCommand('POLYGON').run(editor, []);
    assert.equal(editor.prompts[0].options.options[0].key, 'a');
    assert.equal(editor.keywords.length, 1);
    const edge = createPolygonEditor([{ keyword: 'a' }, { x: 0, y: 0 }, { x: 10, y: 0 }]);
    await resolveCommand('POLYGON').run(edge, []);
    assert.deepEqual([polygonVertices(edge)[1].x, polygonVertices(edge)[1].y], [10, 0]);
});

// O HTML do desktop existe nas duas árvores (o template web não); a paridade de comandos
// entre os dois fica no cad-ribbon.test.js.
test('Ribbon: Retângulo virou botão com seta e os três polígonos', () => {
    const html = readFileSync(resolve('index.html'), 'utf8');
    const block = html.slice(html.indexOf('data-cad-split="rectangle"'), html.indexOf('data-cad-command="HATCH"'));
    assert.ok(block.length > 0, 'split do retângulo');
    for (const [args, text] of [['i', 'Polígono, Centro-Vértice'], ['c', 'Polígono, Centro-Lado'], ['e', 'Polígono, Borda']]) {
        assert.ok(block.includes(`data-cad-command="POLYGON" data-cad-args="${args}" data-cad-label="${text}"`), text);
    }
    assert.ok(block.includes('data-cad-command="RECTANG" data-cad-label="Retângulo"'));
});
