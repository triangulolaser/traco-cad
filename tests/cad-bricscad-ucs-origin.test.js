// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Renderer } from '../src/cad/renderer.js';

test('renderer.js: remove linhas infinitas de eixos e implementa o ícone UCS estilo BricsCAD (WCS)', () => {
    const rendererJsPath = resolve(process.cwd(), 'src/cad/renderer.js');
    const content = readFileSync(rendererJsPath, 'utf-8');

    // Assegura que drawAxes não desenha linhas de 0 até viewport.width / height
    assert.doesNotMatch(content, /ctx\.lineTo\(viewport\.width,\s*Math\.round\(o\.y\)\s*\+\s*0\.5\)/, 'Linhas infinitas no eixo X devem ter sido removidas');
    assert.doesNotMatch(content, /ctx\.lineTo\(Math\.round\(o\.x\)\s*\+\s*0\.5,\s*viewport\.height\)/, 'Linhas infinitas no eixo Y devem ter sido removidas');

    // Assegura elementos do ícone UCS BricsCAD em drawOrigin
    assert.match(content, /strokeRect\(ox,\s*oy\s*-\s*boxSize,\s*boxSize,\s*boxSize\)/, 'Deve desenhar caixa WCS na origem');
    assert.match(content, /fillText\('W',/, 'Deve exibir marcador W (World) dentro da caixa WCS');
    assert.match(content, /fillText\('X',/, 'Deve exibir rótulo X na ponta do braço horizontal');
    assert.match(content, /fillText\('Y',/, 'Deve exibir rótulo Y no topo do braço vertical');
    assert.doesNotMatch(content, /fillText\('0,0'/, 'Texto rudimentar 0,0 deve ter sido substituído');
});

test('Renderer.drawOrigin desenha a caixa WCS e eixos X/Y discretos sem cruzar a tela inteira', () => {
    const operations = [];
    const textOperations = [];

    const mockCtx = {
        save() { operations.push('save'); },
        restore() { operations.push('restore'); },
        setLineDash() {},
        beginPath() { operations.push('beginPath'); },
        moveTo(x, y) { operations.push(`moveTo(${x},${y})`); },
        lineTo(x, y) { operations.push(`lineTo(${x},${y})`); },
        stroke() { operations.push('stroke'); },
        strokeRect(x, y, w, h) { operations.push(`strokeRect(${x},${y},${w},${h})`); },
        fillText(text, x, y) { textOperations.push({ text, x, y }); },
        font: '',
        textAlign: '',
        textBaseline: '',
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
    };

    const mockCanvas = {
        getContext: () => mockCtx,
    };

    const mockViewport = {
        width: 800,
        height: 600,
        worldToScreen(p) {
            // Suponha origem (0,0) no centro da tela (400, 300)
            return { x: 400 + p.x, y: 300 - p.y };
        },
    };

    const renderer = new Renderer(mockCanvas, mockViewport);

    // Executa drawOrigin
    renderer.drawOrigin();

    // Validações
    assert.ok(operations.some(op => op.startsWith('strokeRect(400.5,288.5,12,12)')), 'Caixa WCS deve ter sido desenhada na origem');
    assert.ok(operations.some(op => op.includes('moveTo(400.5,300.5)') && operations.some(o => o.includes('lineTo(454.5,300.5)'))), 'Braço do eixo X com 54px');
    assert.ok(operations.some(op => op.includes('lineTo(400.5,246.5)')), 'Braço do eixo Y com 54px para cima');

    const wLabel = textOperations.find(t => t.text === 'W');
    const xLabel = textOperations.find(t => t.text === 'X');
    const yLabel = textOperations.find(t => t.text === 'Y');

    assert.ok(wLabel, 'Deve conter texto W');
    assert.ok(xLabel, 'Deve conter rótulo X');
    assert.ok(yLabel, 'Deve conter rótulo Y');
    assert.equal(xLabel.x, 400.5 + 54 + 5, 'Rótulo X posicionado à direita do eixo X');
    assert.equal(yLabel.y, 300.5 - 54 - 4, 'Rótulo Y posicionado acima do eixo Y');

    // Executa drawAxes: não deve gerar linhas de tela inteira
    operations.length = 0;
    renderer.drawAxes();
    assert.equal(operations.length, 0, 'drawAxes não deve registrar linhas');
});
