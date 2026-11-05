import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/cad/renderer.js';
import { Viewport } from '../src/cad/viewport.js';
import { createDocument } from '../src/cad/document.js';
import { dashClipFor, dashPeriod, pathDashedArc, pathDashedSegment, strokeDashedEllipse, strokeDashedPolyline } from '../src/cad/dash-clip.js';

const VIEW = { width: 800, height: 600 };

function recorder() {
    const ops = [];
    return {
        ops,
        lineDashOffset: 0,
        save() {},
        restore() {},
        setTransform() {},
        fillRect() {},
        strokeRect() {},
        fillText() {},
        measureText: (text) => ({ width: String(text).length * 7 }),
        setLineDash(dash) { ops.push({ op: 'dash', dash }); },
        beginPath() { ops.push({ op: 'beginPath' }); },
        moveTo(x, y) { ops.push({ op: 'moveTo', x, y }); },
        lineTo(x, y) { ops.push({ op: 'lineTo', x, y }); },
        arc(x, y, r, a0, a1, ccw) { ops.push({ op: 'arc', x, y, r, a0, a1, ccw: Boolean(ccw) }); },
        stroke() { ops.push({ op: 'stroke', offset: this.lineDashOffset }); },
    };
}

test('período do padrão: ímpar é duplicado como no canvas', () => {
    assert.equal(dashPeriod([6, 4]), 10);
    assert.equal(dashPeriod([5]), 10);
    assert.equal(dashPeriod([]), 0);
    assert.equal(dashClipFor([], VIEW), null);
});

test('segmento dentro da tela fica idêntico', () => {
    const ctx = recorder();
    pathDashedSegment(ctx, 10, 20, 100, 200, dashClipFor([6, 4], VIEW));
    assert.deepEqual(ctx.ops, [{ op: 'moveTo', x: 10, y: 20 }, { op: 'lineTo', x: 100, y: 200 }]);
});

test('segmento longo parte de um múltiplo do período e não passa do recorte', () => {
    const clip = dashClipFor([6, 4], VIEW);
    const ctx = recorder();
    pathDashedSegment(ctx, -1e8, 300, 1e8, 300, clip);
    const [move, line] = ctx.ops;
    const distance = move.x + 1e8;
    assert.ok(Math.abs(distance / 10 - Math.round(distance / 10)) < 1e-6, 'fase preservada');
    assert.ok(move.x <= clip.minX && move.x > clip.minX - 10.0001);
    assert.ok(Math.abs(line.x - clip.maxX) < 1e-3);
});

test('segmento fora da tela não gera caminho', () => {
    const ctx = recorder();
    pathDashedSegment(ctx, -500, -500, 2000, -400, dashClipFor([6, 4], VIEW));
    assert.equal(ctx.ops.length, 0);
});

test('círculo inteiro na tela mantém o arco nativo', () => {
    const ctx = recorder();
    pathDashedArc(ctx, 400, 300, 100, 0, 1, Math.PI * 2, dashClipFor([6, 4], VIEW));
    const arc = ctx.ops.find((o) => o.op === 'arc');
    assert.equal(arc.a0, 0);
    assert.equal(arc.a1, Math.PI * 2);
    assert.equal(arc.ccw, false);
});

test('arco no sentido do mundo mantém o sentido e a fase', () => {
    const clip = dashClipFor([6, 4], VIEW);
    const ctx = recorder();
    // Centro à esquerda da tela, raio 5000 px; só a parte perto de phi = 0 aparece.
    pathDashedArc(ctx, 400 - 5000, 300, 5000, 1, -1, 2, clip);
    const arc = ctx.ops.find((o) => o.op === 'arc');
    assert.equal(arc.ccw, true);
    assert.ok(arc.a0 < 1 && arc.a0 > arc.a1, 'ângulo decresce no sentido anti-horário');
    const traveled = (1 - arc.a0) * 5000;
    assert.ok(Math.abs(traveled / 10 - Math.round(traveled / 10)) < 1e-6, 'fase preservada');
});

test('arco de raio enorme vira poucas cordas sobre a curva, dentro do recorte', () => {
    const clip = dashClipFor([6, 4], VIEW);
    const ctx = recorder();
    const r = 1e8;
    pathDashedArc(ctx, 400 - r, 300, r, 0.5, -1, 1, clip);
    assert.equal(ctx.ops.some((o) => o.op === 'arc'), false);
    const points = ctx.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
    assert.ok(points.length >= 2 && points.length < 200, `${points.length} pontos`);
    for (const p of points) {
        assert.ok(Math.abs(Math.hypot(p.x - (400 - r), p.y - 300) - r) < 1e-4);
        assert.ok(p.y >= clip.minY - 10.0001 && p.y <= clip.maxY + 10.0001);
    }
});

test('círculo cruzando a tela gera só os trechos visíveis', () => {
    const clip = dashClipFor([6, 4], VIEW);
    const ctx = recorder();
    pathDashedArc(ctx, 400, 300, 450, 0, 1, Math.PI * 2, clip);
    const arcs = ctx.ops.filter((o) => o.op === 'arc');
    assert.ok(arcs.length >= 2);
    for (const arc of arcs) {
        const mid = (arc.a0 + arc.a1) / 2;
        const x = 400 + 450 * Math.cos(mid);
        const y = 300 + 450 * Math.sin(mid);
        assert.ok(x >= clip.minX && x <= clip.maxX && y >= clip.minY && y <= clip.maxY);
    }
});

test('elipse enorme: cordas sobre a curva e fase em lineDashOffset', () => {
    const clip = dashClipFor([6, 4], VIEW);
    const ctx = recorder();
    const a = 1e8;
    const b = 4e7;
    strokeDashedEllipse(ctx, 400, 300 + b, a, b, 0, 0, 1, Math.PI * 2, clip);
    const points = ctx.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
    assert.ok(points.length >= 2 && points.length < 2100);
    for (const p of points) {
        const u = (p.x - 400) / a;
        const v = (p.y - 300 - b) / b;
        assert.ok(Math.abs(u * u + v * v - 1) < 1e-6);
    }
    const stroke = ctx.ops.find((o) => o.op === 'stroke');
    assert.ok(stroke.offset >= 0 && stroke.offset < 10);
    assert.equal(ctx.lineDashOffset, 0, 'não vaza a fase para o próximo traçado');
});

test('polilinha mantém a fase acumulada ao entrar na tela', () => {
    const clip = dashClipFor([6, 4], VIEW);
    const ctx = recorder();
    strokeDashedPolyline(ctx, [{ x: -100, y: 300 }, { x: 37, y: 300 }, { x: 100, y: 300 }], clip);
    const stroke = ctx.ops.find((o) => o.op === 'stroke');
    // Entra na tela em x = -16, depois de percorrer 84 px: 84 % 10 = 4.
    assert.equal(stroke.offset, 4);
    assert.equal(ctx.lineDashOffset, 0);
});

function renderedOps(entities, selection, scale, at) {
    const ctx = recorder();
    const canvas = { width: 800, height: 600, style: {}, getContext: () => ctx };
    const viewport = new Viewport(800, 600);
    const renderer = new Renderer(canvas, viewport);
    renderer.resize(800, 600, 1);
    viewport.scale = scale;
    viewport.centerOn(at);
    const doc = createDocument();
    doc.entities = entities.map((e, i) => ({ id: `e${i}`, layer: '0', color: 'bylayer', ...e }));
    renderer.draw({ doc, selection: new Set(selection), preview: [], showGrid: false, hover: null, showCrosshair: false });
    return ctx.ops;
}

// Regressão: com zoom alto, nada do que é tracejado pode mandar coordenadas distantes ao
// canvas, porque é o comprimento fora da tela que torna o quadro lento.
for (const [name, entity, at] of [
    ['arco selecionado', { type: 'arc', center: { x: 0, y: -1000 }, radius: 1000, start: 0.3, end: 2.9 }, { x: 0, y: 0 }],
    ['círculo selecionado', { type: 'circle', center: { x: 0, y: -1000 }, radius: 1000 }, { x: 0, y: 0 }],
    ['linha selecionada', { type: 'line', start: { x: -2000, y: -700 }, end: { x: 2000, y: 700 } }, { x: 0, y: 0 }],
]) {
    test(`${name} com zoom alto só desenha perto da tela`, () => {
        const ops = renderedOps([entity], ['e0'], 1e4, at);
        const moves = ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
        assert.ok(moves.length > 0, 'a entidade continua desenhada');
        assert.equal(ops.some((o) => o.op === 'arc' && o.r > 1e5), false, 'sem arco nativo gigante');
        for (const p of moves) {
            assert.ok(Math.abs(p.x) < 2000 && Math.abs(p.y) < 2000, `(${p.x}, ${p.y})`);
        }
    });
}

test('linha com tipo tracejado também é recortada no lote, sem seleção', () => {
    const ops = renderedOps([{ type: 'line', lineType: 'DASHED', start: { x: -2000, y: -700 }, end: { x: 2000, y: 700 } }], [], 1e4, { x: 0, y: 0 });
    const moves = ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
    assert.ok(moves.length > 0);
    for (const p of moves) assert.ok(Math.abs(p.x) < 2000 && Math.abs(p.y) < 2000);
});

test('linha contínua não passa pelo recorte', () => {
    const ops = renderedOps([{ type: 'line', start: { x: -2000, y: 0 }, end: { x: 2000, y: 0 } }], [], 1e4, { x: 0, y: 0 });
    const moves = ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
    assert.ok(moves.some((p) => Math.abs(p.x) > 1e6));
});
