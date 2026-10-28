import test from 'node:test';
import assert from 'node:assert/strict';
import { circleTangentToThree } from '../src/cad/geometry.js';
import { placeDimensionText, dimensionGeometry, defaultDimStyle } from '../src/cad/dimensions.js';
import { COMMANDS, resolveCommand, suggestCommands } from '../src/cad/commands.js';
import { createDocument, addEntities } from '../src/cad/document.js';

const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', layer: '0', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test('AI_CIRCTAN: U de três linhas (caso do print do BricsCAD)', () => {
    const c = circleTangentToThree([
        { entity: line(1, 0, 0, 0, 100), point: { x: 0, y: 30 } },
        { entity: line(2, 100, 0, 100, 100), point: { x: 100, y: 40 } },
        { entity: line(3, -10, -20, 110, -20), point: { x: 50, y: -20 } },
    ]);
    close(c.center.x, 50); close(c.center.y, 30); close(c.radius, 50);
});

test('AI_CIRCTAN: incírculo do triângulo 3-4-5 e lado escolhido pelos cliques', () => {
    const tri = [line(1, 0, 0, 4, 0), line(2, 4, 0, 4, 3), line(3, 4, 3, 0, 0)];
    const inc = circleTangentToThree([
        { entity: tri[0], point: { x: 3, y: 0 } }, { entity: tri[1], point: { x: 4, y: 1 } }, { entity: tri[2], point: { x: 2.4, y: 1.8 } },
    ]);
    close(inc.center.x, 3); close(inc.center.y, 1); close(inc.radius, 1);
});

test('AI_CIRCTAN: linha + dois círculos', () => {
    const c = circleTangentToThree([
        { entity: line(1, -100, 0, 100, 0), point: { x: 0, y: 0 } },
        { entity: { id: 2, type: 'circle', center: { x: -20, y: 10 }, radius: 10 }, point: { x: -10, y: 10 } },
        { entity: { id: 3, type: 'arc', center: { x: 20, y: 10 }, radius: 10, start: 0, end: Math.PI }, point: { x: 10, y: 10 } },
    ]);
    // Simétrico em x=0, tangente à linha y=0 e externo aos dois: r = y e (20² + (y-10)²) = (r+10)² → y = 10.
    close(c.center.x, 0); close(c.radius, c.center.y);
    close(Math.hypot(c.center.x + 20, c.center.y - 10), c.radius + 10);
});

test('AI_CIRCTAN: comando cria o círculo', async () => {
    const ents = [line(1, 0, 0, 0, 100), line(2, 100, 0, 100, 100), line(3, -10, -20, 110, -20)];
    const pts = [{ x: 0, y: 30 }, { x: 100, y: 40 }, { x: 50, y: -20 }];
    let i = 0;
    const editor = {
        doc: addEntities(createDocument(), ents), logs: [],
        log(m) { this.logs.push(m); }, commit(_, d) { this.doc = d; },
        async getEntity(_, opts) { const e = this.doc.entities[i]; assert.ok(opts.filter(e)); return { entity: e, point: pts[i++] }; },
    };
    await resolveCommand('ai_circtan').run(editor);
    const circle = editor.doc.entities.find((e) => e.type === 'circle');
    close(circle.radius, 50);
    assert.equal(suggestCommands('AI_')[0].name.startsWith('AI_'), true);
});

test('AI_CIRCTAN: retângulo em polilinha, três lados do mesmo objeto', async () => {
    const rect = { id: 1, type: 'polyline', layer: '0', closed: true, vertices: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 240 }, { x: 0, y: 240 }] };
    const pts = [{ x: 0, y: 100 }, { x: 0, y: 120 }, { x: 80, y: 90 }, { x: 40, y: 0 }];
    let i = 0;
    const editor = {
        doc: addEntities(createDocument(), [rect]), logs: [],
        log(m) { this.logs.push(m); }, commit(_, d) { this.doc = d; },
        async getEntity(_, opts) { const e = this.doc.entities[0]; assert.ok(opts.filter(e)); return { entity: e, point: pts[i++] }; },
    };
    await resolveCommand('ai_circtan').run(editor);
    // Segundo clique no mesmo lado é recusado; depois lado direito e base: círculo de raio 40 encostado embaixo.
    assert.ok(editor.logs.includes('Esse trecho já foi selecionado.'));
    const circle = editor.doc.entities.find((e) => e.type === 'circle');
    close(circle.radius, 40); close(circle.center.x, 40); close(circle.center.y, 40);
});

test('AI_CIRCTAN: trecho em arco (bulge) da polilinha vale como arco', async () => {
    // Semicírculo de raio 10 centrado na origem (bulge 1) + duas linhas.
    const pl = { id: 1, type: 'polyline', layer: '0', closed: false, vertices: [{ x: 10, y: 0, bulge: 1 }, { x: -10, y: 0 }] };
    const ents = [pl, line(2, -100, -30, 100, -30), line(3, -100, 30, 100, 30)];
    const pts = [{ x: 0, y: 10 }, { x: 0, y: -30 }, { x: 0, y: 30 }];
    let i = 0;
    const editor = {
        doc: addEntities(createDocument(), ents), logs: [],
        log(m) { this.logs.push(m); }, commit(_, d) { this.doc = d; },
        async getEntity(_, opts) { const e = this.doc.entities[i]; assert.ok(opts.filter(e)); return { entity: e, point: pts[i++] }; },
    };
    await resolveCommand('ai_circtan').run(editor);
    const circle = editor.doc.entities.find((e) => e.type === 'circle');
    close(circle.radius, 30);
    // Tangente ao círculo de apoio do arco: por fora (30 + 10) ou envolvendo-o (30 − 10).
    const d = Math.hypot(circle.center.x, circle.center.y);
    assert.ok(Math.abs(d - 40) < 1e-6 || Math.abs(d - 20) < 1e-6, `centro a ${d}`);
});

test('AI_DIM_TEXT*: centro, acima e posição padrão', () => {
    const style = defaultDimStyle();
    const dim = { id: 9, type: 'dimension', kind: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, linePoint: { x: 0, y: 20 }, textPosition: { x: 300, y: 80 } };
    const home = placeDimensionText(dim, style, 'home');
    assert.equal(home.textPosition, undefined);
    const center = placeDimensionText(dim, style, 'center');
    assert.deepEqual(center.textPosition, { x: 50, y: 20 });
    const gCenter = dimensionGeometry(center, style);
    const gHome = dimensionGeometry(home, style);
    assert.ok(gCenter.texts[0].position.y < 20, 'centralizado: base abaixo da linha');
    const above = dimensionGeometry(placeDimensionText(dim, style, 'above'), style);
    close(above.texts[0].position.y, gHome.texts[0].position.y);
    close(above.texts[0].position.x, gHome.texts[0].position.x);
    assert.equal(placeDimensionText({ ...dim, kind: 'radius' }, style, 'center'), null);
});

test('AI_*: registrados', () => {
    for (const n of ['AI_CIRCTAN', 'AI_DESELECT', 'AI_SELALL', 'AI_DRAWORDER', 'AI_MOLC', 'AI_PROPCHK', 'AI_DIM_TEXTHOME', 'AI_DIM_TEXTCENTER', 'AI_DIM_TEXTABOVE']) assert.ok(COMMANDS[n], n);
});
