import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';
import { transformEntity } from '../src/cad/geometry.js';
import { normalizeEntity } from '../src/cad/document.js';
import '../src/cad/extra-entities.js';

test('drawSpline calcula e reaproveita _sampledPts em cache, decimando vertices no zoom afastado', () => {
    const spline = {
        id: 'sp1',
        type: 'spline',
        degree: 3,
        controlPoints: [
            { x: 0, y: 0 },
            { x: 10, y: 30 },
            { x: 20, y: -20 },
            { x: 30, y: 10 },
            { x: 40, y: 0 },
        ],
        knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
    };

    let lineToCalls = 0;
    let moveToCalls = 0;
    const mockCtx = {
        beginPath: () => {},
        moveTo: () => { moveToCalls++; },
        lineTo: () => { lineToCalls++; },
        stroke: () => {},
    };

    // Zoom afastado (scale = 0.05 px por unidade)
    const viewportOut = new Viewport(1000, 1000);
    viewportOut.scale = 0.05;
    viewportOut.originX = 500;
    viewportOut.originY = 500;

    const renderer = { ctx: mockCtx, viewport: viewportOut };

    assert.equal(spline._sampledPts, undefined, 'Cache inicial deve ser indefinido');
    Renderer.prototype.drawSpline.call(renderer, spline, {});

    assert.ok(Array.isArray(spline._sampledPts), '_sampledPts deve ser populado no primeiro frame');
    assert.ok(spline._sampledPts.length > 10, 'deve conter amostras de de Boor');
    const cachedRef = spline._sampledPts;
    const initialLineTos = lineToCalls;
    assert.ok(initialLineTos > 0, 'deve ter emitido lineTos');
    // Em escala 0.05 (largura total 40 * 0.05 = 2px), a decimação espacial deve reduzir drasticamente
    assert.ok(initialLineTos < cachedRef.length, 'decimação adaptativa deve reduzir passos sub-pixel');

    // Segundo frame: deve usar a mesma referência de cache
    lineToCalls = 0;
    Renderer.prototype.drawSpline.call(renderer, spline, {});
    assert.equal(spline._sampledPts, cachedRef, 'deve reutilizar cache existente');
    assert.equal(lineToCalls, initialLineTos, 'contagem de lineTos deve ser estável');

    // Zoom aproximado (scale = 10): deve emitir mais pontos para fidelidade visual completa
    const viewportIn = new Viewport(1000, 1000);
    viewportIn.scale = 10;
    viewportIn.originX = 500;
    viewportIn.originY = 500;
    renderer.viewport = viewportIn;

    lineToCalls = 0;
    Renderer.prototype.drawSpline.call(renderer, spline, {});
    assert.ok(lineToCalls > initialLineTos, 'zoom próximo deve renderizar curva detalhada sem perda');
});

test('transformEntity e normalizeEntity invalidam _sampledPts', () => {
    const spline = {
        id: 'sp2',
        type: 'spline',
        degree: 3,
        controlPoints: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 20, y: 0 },
        ],
        knots: [0, 0, 0, 1, 1, 1],
        _sampledPts: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        _bbox: { minX: 0, maxX: 20, minY: 0, maxY: 10 },
    };

    const transformed = transformEntity(spline, (p) => ({ x: p.x + 10, y: p.y + 5 }));
    assert.equal(transformed._sampledPts, undefined, 'transformEntity deve remover _sampledPts');
    assert.equal(transformed._bbox, undefined, 'transformEntity deve remover _bbox');
    assert.equal(transformed.controlPoints[0].x, 10);

    const normalized = normalizeEntity(spline);
    assert.equal(normalized._sampledPts, undefined, 'normalizeEntity deve remover _sampledPts');
    assert.equal(normalized._bbox, undefined, 'normalizeEntity deve remover _bbox');
});

test('drawText usa greeking para textos com altura de 0.75px a 3.5px e culling abaixo de 0.75px', () => {
    let fillRectCalls = 0;
    let fillTextCalls = 0;
    let measureTextCalls = 0;

    const mockCtx = {
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        fillRect: () => { fillRectCalls++; },
        fillText: () => { fillTextCalls++; },
        measureText: () => { measureTextCalls++; return { width: 50 }; },
    };

    const viewport = new Viewport(800, 600);
    const renderer = { ctx: mockCtx, viewport };

    const textEntity = {
        type: 'text',
        text: 'DIAGRAMA ESQUEMATICO PRINCIPAL',
        height: 2.5,
        position: { x: 100, y: 100 },
    };

    // 1. Zoom muito afastado: escala onde altura é < 0.75px (ex: scale = 0.2 -> px = 0.5px)
    viewport.scale = 0.2;
    Renderer.prototype.drawText.call(renderer, textEntity, { color: '#000000' });
    assert.equal(fillRectCalls, 0, 'subpixel (<0.75px) não deve desenhar nada');
    assert.equal(fillTextCalls, 0);

    // 2. Zoom afastado: altura entre 0.75px e 3.5px (ex: scale = 1.0 -> px = 2.5px)
    viewport.scale = 1.0;
    Renderer.prototype.drawText.call(renderer, textEntity, { color: '#000000' });
    assert.equal(fillRectCalls, 1, 'text greeking deve chamar fillRect rápido');
    assert.equal(fillTextCalls, 0, 'não deve chamar fillText lento');
    assert.equal(measureTextCalls, 0, 'não deve chamar measureText caro');

    // 3. Zoom normal/próximo: altura > 3.5px (ex: scale = 4.0 -> px = 10px)
    viewport.scale = 4.0;
    Renderer.prototype.drawText.call(renderer, textEntity, { color: '#000000' });
    assert.equal(fillTextCalls, 1, 'zoom legível deve renderizar texto real via fillText');
    assert.ok(measureTextCalls >= 1, 'deve medir texto real');
});

test('drawHatch sai imediatamente se a projecao em tela for menor que 1.5px', () => {
    let pathCreated = false;
    const oldPath2D = globalThis.Path2D;
    globalThis.Path2D = class {
        constructor() { pathCreated = true; }
        moveTo() {}
        lineTo() {}
        closePath() {}
    };

    try {
        const viewport = new Viewport(1000, 1000);
        viewport.scale = 0.001; // hachura de 100x100mm vira 0.1px em tela
        viewport.originX = 500;
        viewport.originY = 500;

        const hatchEntity = {
            type: 'hatch',
            pattern: 'ANSI31',
            angle: 45,
            spacing: 3,
            loops: [{
                vertices: [
                    { x: 0, y: 0 },
                    { x: 100, y: 0 },
                    { x: 100, y: 100 },
                    { x: 0, y: 100 },
                ],
            }],
        };

        const renderer = { ctx: {}, viewport };
        Renderer.prototype.drawHatch.call(renderer, hatchEntity, {});
        assert.equal(pathCreated, false, 'drawHatch deve sair antes de instanciar Path2D se bounds em tela < 1.5px');
    } finally {
        globalThis.Path2D = oldPath2D;
    }
});
