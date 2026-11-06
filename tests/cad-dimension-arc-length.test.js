import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dimensionGeometry, transformDimension, arcLengthSweep } from '../src/cad/dimensions.js';
import { entityBox } from '../src/cad/geometry.js';
import { arcLengthDimensionFor } from '../src/cad/commands.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { writeDxf, parseDxf } from '../src/cad/dxf.js';
import { documentToDwg, dwgToDocument } from '../src/cad/dwg.js';
import { getEntityGrips } from '../src/cad/grips.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
// Arco de R100 de 30° a 150° (120°): comprimento 100·2π/3.
const arc = { type: 'arc', center: { x: 0, y: 0 }, radius: 100, start: Math.PI / 6, end: (5 * Math.PI) / 6 };
const LENGTH = (100 * 2 * Math.PI) / 3;

function arcDimension(extra = {}) {
    return { ...arcLengthDimensionFor(arc), type: 'dimension', linePoint: { x: 0, y: 120 }, ...extra };
}

test('DIMARC mede o comprimento do arco, não a corda nem o ângulo', () => {
    const g = dimensionGeometry(arcDimension(), { precision: 2 });
    assert.ok(close(g.measurement, LENGTH));
    assert.equal(g.text, LENGTH.toFixed(2));
});

test('cota de arco desenha o arco concêntrico pelo ponto escolhido, chamadas radiais e o símbolo sobre o número', () => {
    const style = { textHeight: 2.5, arrowSize: 2.5, extOffset: 0.625, extBeyond: 1.25, textGap: 0.9 };
    const g = dimensionGeometry(arcDimension(), style);
    const main = g.arcs[0];
    assert.ok(close(main.radius, 120));
    assert.ok(close(main.startAngle, Math.PI / 6) && close(main.endAngle, (5 * Math.PI) / 6));
    assert.equal(g.arrows.length, 2);
    assert.equal(g.segments.length, 2);
    for (const seg of g.segments) {
        // Chamada radial: começa um pouco fora do arco medido e passa além da cota.
        assert.ok(close(Math.hypot(seg.a.x, seg.a.y), 100.625));
        assert.ok(close(Math.hypot(seg.b.x, seg.b.y), 121.25));
    }
    // Número por fora, no topo do arco, na horizontal; símbolo ⌒ acima dele.
    const text = g.texts[0];
    assert.ok(close(text.rotation % 360, 0));
    assert.ok(text.position.y > 120);
    const symbol = g.arcs[g.arcs.length - 1];
    assert.ok(symbol.center.y + symbol.radius > text.position.y + style.textHeight);
});

test('cota de arco por dentro do arco medido puxa as chamadas para o centro', () => {
    const style = { textHeight: 2.5, arrowSize: 2.5, extOffset: 0.625, extBeyond: 1.25, textGap: 0.9 };
    const g = dimensionGeometry(arcDimension({ linePoint: { x: 0, y: 70 } }), style);
    for (const seg of g.segments) {
        assert.ok(close(Math.hypot(seg.a.x, seg.a.y), 99.375));
        assert.ok(close(Math.hypot(seg.b.x, seg.b.y), 68.75));
    }
});

test('trecho em arco de polilinha também recebe cota de arco', () => {
    // Meia-volta de (100,0) a (-100,0) passando por cima: bulge 1.
    const pl = { type: 'polyline', closed: false, vertices: [{ x: -200, y: 0, bulge: 0 }, { x: 100, y: 0, bulge: 1 }, { x: -100, y: 0, bulge: 0 }] };
    const base = arcLengthDimensionFor(pl, { x: 0, y: 101 });
    assert.equal(base.kind, 'arclength');
    assert.ok(close(arcLengthSweep(base).length, 100 * Math.PI));
    assert.equal(arcLengthDimensionFor({ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }), null);
});

test('mover, escalar e espelhar mantêm o comprimento medido', () => {
    const dim = arcDimension();
    const moved = transformDimension(dim, (p) => ({ x: p.x + 50, y: p.y - 10 }), false);
    assert.ok(close(arcLengthSweep(moved).length, LENGTH));
    const scaled = transformDimension(dim, (p) => ({ x: p.x * 2, y: p.y * 2 }), false);
    assert.ok(close(arcLengthSweep(scaled).length, LENGTH * 2));
    const mirrored = transformDimension(dim, (p) => ({ x: p.x, y: -p.y }), true);
    assert.ok(close(arcLengthSweep(mirrored).length, LENGTH), 'espelhado ainda mede o arco curto, não o complementar');
});

test('alças da cota de arco: só a posição do arco de cota', () => {
    const grips = getEntityGrips({ ...arcDimension(), id: 'd1' }, {});
    assert.deepEqual(grips.map((g) => g.type), ['linePoint']);
});

test('caixa da cota de arco cobre o arco de cota e o texto', () => {
    const box = entityBox(arcDimension());
    assert.ok(box.maxY > 120 && box.minX < -100 && box.maxX > 100);
});

function docWithArcDimension(extra = {}) {
    let doc = createDocument();
    doc = addEntities(doc, [{ ...arc, layer: '0' }, { ...arcDimension(extra), layer: '0' }]);
    return doc;
}

test('DXF: outros CADs veem o comprimento escrito e o Traço reabre a cota viva', () => {
    const dxf = writeDxf(docWithArcDimension());
    assert.match(dxf, /TRACO_ARCDIM/);
    assert.match(dxf, new RegExp(`\\n1\\n${LENGTH.toFixed(2).replace('.', '\\.')}\\n`), 'texto literal para leitores sem cota de arco');
    const back = parseDxf(dxf, { preserveDimensions: true });
    const dim = back.entities.find((e) => e.type === 'dimension');
    assert.equal(dim.kind, 'arclength');
    assert.equal(dim.textOverride, undefined);
    assert.ok(close(dimensionGeometry(dim, {}).measurement, LENGTH, 1e-4));
});

test('DXF: texto trocado pelo usuário volta como texto do usuário', () => {
    const back = parseDxf(writeDxf(docWithArcDimension({ textOverride: 'DESENV. <>' })), { preserveDimensions: true });
    const dim = back.entities.find((e) => e.type === 'dimension');
    assert.equal(dim.kind, 'arclength');
    assert.equal(dim.textOverride, 'DESENV. <>');
});

test('DXF para corte não leva a cota de arco', () => {
    const back = parseDxf(writeDxf(docWithArcDimension()), { dimensionGraphics: false });
    assert.equal(back.entities.filter((e) => e.type === 'dimension').length, 0);
    assert.equal(back.entities.filter((e) => e.type === 'arc').length, 1);
});

test('DWG: salvar e reabrir mantém a cota de arco', async () => {
    const buffer = await documentToDwg(docWithArcDimension());
    const back = await dwgToDocument(buffer, { name: 'arco.dwg' });
    const dim = back.entities.find((e) => e.type === 'dimension');
    assert.ok(dim, 'cota presente');
    assert.equal(dim.kind, 'arclength');
    assert.ok(close(dimensionGeometry(dim, {}).measurement, LENGTH, 1e-3));
});

test('STRETCH pegando só uma ponta não deforma a cota de arco', async () => {
    const { stretchEntity } = await import('../src/cad/edit-tools.js');
    const dim = arcDimension();
    const box = { minX: dim.p1.x - 1, minY: dim.p1.y - 1, maxX: dim.p1.x + 1, maxY: dim.p1.y + 1 };
    const out = stretchEntity(dim, box, { x: 20, y: 0 });
    assert.deepEqual(out.p1, dim.p1);
    assert.ok(close(arcLengthSweep(out).length, LENGTH));
});
