import test from 'node:test';
import assert from 'node:assert/strict';
import { HATCH_PATTERNS, hatchFamilies, patternGeometry, upgradeHatch, boundaryLoopsAt, setHatchProps } from '../src/cad/hatch.js';
import { mirrorEntity } from '../src/cad/geometry.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { printSvg } from '../src/cad/print.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const square = (x0, y0, size) => ({ vertices: [{ x: x0, y: y0, bulge: 0 }, { x: x0 + size, y: y0, bulge: 0 }, { x: x0 + size, y: y0 + size, bulge: 0 }, { x: x0, y: y0 + size, bulge: 0 }] });
const circleLoop = (cx, cy, r) => ({ vertices: [{ x: cx - r, y: cy, bulge: 1 }, { x: cx + r, y: cy, bulge: 1 }] });
const hatch = (extra) => ({ type: 'hatch', layer: '0', loops: [square(0, 0, 100)], opacity: 0.35, ...extra });
const deg = (s) => ((Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI + 360) % 180;
const len = (s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
// Distância perpendicular entre linhas paralelas vizinhas do padrão.
const gaps = (segments, angle) => {
    const n = { x: -Math.sin((angle * Math.PI) / 180), y: Math.cos((angle * Math.PI) / 180) };
    const offs = [...new Set(segments.map((s) => Math.round((s.a.x * n.x + s.a.y * n.y) * 1e6) / 1e6))].sort((a, b) => a - b);
    return offs.slice(1).map((o, i) => o - offs[i]);
};

test('ANSI31 como no BricsCAD: ângulo 0 = linhas a 45°, escala 1 = 3,175 mm; escala e ângulo mudam o desenho', () => {
    const base = patternGeometry(hatch({ pattern: 'ANSI31', angle: 0, scale: 1 }));
    assert.ok(base.complete && base.segments.length > 30);
    assert.ok(base.segments.every((s) => close(deg(s), 45, 1e-6)));
    assert.ok(gaps(base.segments, 45).every((g) => close(g, 3.175, 1e-6)));
    const scaled = patternGeometry(hatch({ pattern: 'ANSI31', angle: 0, scale: 2 }));
    assert.ok(gaps(scaled.segments, 45).every((g) => close(g, 6.35, 1e-6)));
    const turned = patternGeometry(hatch({ pattern: 'ANSI31', angle: 90, scale: 1 }));
    assert.ok(turned.segments.every((s) => close(deg(s), 135, 1e-6)));
    // Recorte pelo contorno: nada sai do quadrado.
    assert.ok(base.segments.every((s) => [s.a, s.b].every((p) => p.x > -1e-6 && p.x < 100 + 1e-6 && p.y > -1e-6 && p.y < 100 + 1e-6)));
});

test('XADREZ é chapa piso: fileiras de traços a +45° intercaladas com fileiras a -45°, escalando com a hachura', () => {
    for (const scale of [1, 3]) {
        const { segments } = patternGeometry(hatch({ pattern: 'XADREZ', angle: 0, scale, loops: [square(-200.3, -200.1, 400)] }));
        const step = 3.175 * scale;
        const lug = 0.7 * step * Math.SQRT2;
        const inner = segments.filter((s) => [s.a, s.b].every((p) => Math.abs(p.x) < 190 && Math.abs(p.y) < 190));
        assert.ok(inner.length > 50, 'muitos traços');
        const up = inner.filter((s) => close(deg(s), 45, 1e-6));
        const down = inner.filter((s) => close(deg(s), 135, 1e-6));
        assert.equal(up.length + down.length, inner.length, 'só traços a ±45°');
        assert.ok(inner.every((s) => close(len(s), lug, 1e-6)), 'traços inteiros e separados');
        // +45° nas casas (par, par), -45° nas (ímpar, ímpar): cada fileira tem uma só direção,
        // as vizinhas têm a outra e ficam deslocadas meio passo.
        const cell = (s) => ({ i: ((s.a.x + s.b.x) / 2) / step, j: ((s.a.y + s.b.y) / 2) / step });
        for (const [list, parity] of [[up, 0], [down, 1]]) {
            for (const s of list) {
                const { i, j } = cell(s);
                assert.ok(close(i, Math.round(i), 1e-6) && close(j, Math.round(j), 1e-6), 'centro na grade');
                assert.equal(Math.abs(Math.round(i)) % 2, parity, 'coluna');
                assert.equal(Math.abs(Math.round(j)) % 2, parity, 'fileira');
            }
        }
        assert.ok(Math.abs(up.length - down.length) < up.length * 0.15, 'metade de cada');
    }
});

test('SAND salvo pelo Traço sem definição passa a desenhar o XADREZ', () => {
    assert.equal(upgradeHatch(hatch({ pattern: 'SAND', angle: 0, scale: 1 })).pattern, 'XADREZ');
    assert.deepEqual(patternGeometry(hatch({ pattern: 'SAND', angle: 10, scale: 2 })).segments, patternGeometry(hatch({ pattern: 'XADREZ', angle: 10, scale: 2 })).segments);
    const fromFile = hatch({ pattern: 'SAND', angle: 0, scale: 1, definition: [{ angle: 0, x: 0, y: 0, dx: 0, dy: 7, dashes: [] }], definitionAngle: 0, definitionScale: 1 });
    assert.equal(upgradeHatch(fromFile).pattern, 'SAND', 'definição do arquivo continua valendo');
});

test('todos os padrões da biblioteca geram geometria finita e recortada', () => {
    for (const name of Object.keys(HATCH_PATTERNS)) {
        const g = patternGeometry(hatch({ pattern: name, angle: 30, scale: 1.5 }));
        assert.ok(g.complete, name);
        if (name === 'SOLID') { assert.equal(g.segments.length + g.dots.length, 0); continue; }
        assert.ok(g.segments.length + g.dots.length > 10, name);
        assert.ok([...g.segments.flatMap((s) => [s.a, s.b]), ...g.dots].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), name);
    }
});

test('hachura antiga (ângulo absoluto + espaçamento) continua com o mesmo desenho', () => {
    const legacy = hatch({ pattern: 'ANSI31', angle: 30, spacing: 5 });
    const up = upgradeHatch(legacy);
    assert.equal(up.spacing, undefined);
    assert.ok(close(up.angle, -15) && close(up.scale, 5 / 3.175));
    const [f] = hatchFamilies(legacy);
    assert.ok(close((f.angle * 180) / Math.PI, 30) && close(f.dy, 5));
    const dots = hatchFamilies(hatch({ pattern: 'DOTS', angle: 0, spacing: 4 }));
    assert.equal(dots.length, 1);
    assert.ok(close(dots[0].dy, 4) && dots[0].dashes[0] === 0 && close(dots[0].dashes[1], -4));
    const cross = hatchFamilies(hatch({ pattern: 'ANSI37', angle: 10, spacing: 2 }));
    assert.deepEqual(cross.map((x) => Math.round((x.angle * 180) / Math.PI)), [10, 100]);
});

test('DXF: XADREZ com escala e ângulo volta igual; linhas de definição do arquivo são respeitadas', () => {
    const doc = addEntities(createDocument(), [hatch({ pattern: 'XADREZ', angle: 15, scale: 2 })]);
    const text = writeDxf(doc);
    assert.match(text, /\n2\nXADREZ\n/);
    assert.match(text, /\n52\n15\n/);
    assert.match(text, /\n41\n2\n/);
    assert.match(text, /\n78\n2\n/);
    const back = parseDxf(text).entities.find((e) => e.type === 'hatch');
    assert.equal(back.pattern, 'XADREZ');
    assert.ok(close(back.scale, 2) && close(back.angle, 15));
    const a = patternGeometry(doc.entities[0]).segments;
    const b = patternGeometry(back).segments;
    assert.equal(a.length, b.length);
    a.forEach((s, i) => assert.ok(close(s.a.x, b[i].a.x, 1e-4) && close(s.a.y, b[i].a.y, 1e-4)));
    // Padrão que o Traço não conhece: as linhas gravadas pelo outro CAD desenham a hachura.
    const other = ['0', 'SECTION', '2', 'ENTITIES', '0', 'HATCH', '8', '0', '2', 'XPTO', '70', '0', '71', '0', '91', '1', '92', '2', '72', '0', '73', '1', '93', '4',
        '10', '0', '20', '0', '10', '50', '20', '0', '10', '50', '20', '50', '10', '0', '20', '50', '97', '0',
        '75', '0', '76', '2', '52', '0', '41', '1', '77', '0', '78', '1', '53', '0', '43', '0', '44', '0', '45', '0', '46', '7', '79', '2', '49', '4', '49', '-3', '98', '0',
        '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const imported = parseDxf(other).entities[0];
    assert.equal(imported.pattern, 'XPTO');
    const segs = patternGeometry(imported).segments;
    assert.ok(segs.length > 10 && segs.every((s) => close(deg(s), 0) && len(s) <= 4 + 1e-6));
    assert.ok(gaps(segs, 0).every((g) => close(g, 7, 1e-6)));
    // Mudar a escala depois de importar ainda vale para a definição do arquivo.
    const bigger = setHatchProps(imported, { scale: 2 });
    assert.ok(gaps(patternGeometry({ ...bigger, loops: [square(0, 0, 100)] }).segments, 0).every((g) => close(g, 14, 1e-6)));
    assert.equal(setHatchProps(imported, { pattern: 'ANSI31' }).definition, undefined);
});

test('espelhar hachura espelha o padrão (XADREZ não vira outro desenho)', () => {
    const original = hatch({ pattern: 'ANSI38', angle: 20, scale: 1.3 });
    const mirrored = mirrorEntity(original, { x: 0, y: 0 }, { x: 0, y: 10 });
    const reflect = (p) => ({ x: -p.x, y: p.y });
    const expected = patternGeometry(original).segments.map((s) => ({ a: reflect(s.a), b: reflect(s.b) }));
    const same = (p, q) => close(p.x, q.x, 1e-6) && close(p.y, q.y, 1e-6);
    const got = patternGeometry(mirrored).segments;
    assert.equal(got.length, expected.length);
    assert.ok(got.every((s) => expected.some((e) => (same(s.a, e.a) && same(s.b, e.b)) || (same(s.a, e.b) && same(s.b, e.a)))), 'cada traço espelhado coincide');
});

test('pontos internos: menor contorno em volta do clique e ilhas aninhado/exterior/ignorar', () => {
    const outer = square(0, 0, 100);
    const hole = circleLoop(50, 50, 30);
    const island = square(45, 45, 10);
    const far = square(200, 0, 10);
    const loops = [far, island, hole, outer];
    const sameSet = (got, want, msg) => { assert.equal(got.length, want.length, msg); assert.equal(got[0], want[0], msg); want.forEach((l) => assert.ok(got.includes(l), msg)); };
    sameSet(boundaryLoopsAt({ x: 5, y: 5 }, loops, 'nested'), [outer, hole, island]);
    assert.deepEqual(boundaryLoopsAt({ x: 5, y: 5 }, loops, 'outer'), [outer, hole]);
    assert.deepEqual(boundaryLoopsAt({ x: 5, y: 5 }, loops, 'ignore'), [outer]);
    sameSet(boundaryLoopsAt({ x: 30, y: 50 }, loops, 'nested'), [hole, island], 'clique no anel interno');
    assert.deepEqual(boundaryLoopsAt({ x: 150, y: 50 }, loops, 'nested'), [], 'fora de tudo');
    // Contorno repetido (duas polilinhas iguais) não anula a ilha no par/ímpar.
    assert.deepEqual(boundaryLoopsAt({ x: 5, y: 5 }, [outer, hole, { vertices: hole.vertices.map((v) => ({ ...v })) }], 'nested'), [outer, hole]);
});

test('Propriedades: escala inválida é recusada; impressão desenha o mesmo padrão', () => {
    assert.throws(() => setHatchProps(hatch({ pattern: 'ANSI31', angle: 0, scale: 1 }), { scale: 0 }), /maior que zero/);
    assert.throws(() => setHatchProps(hatch({ pattern: 'ANSI31', angle: 0, scale: 1 }), { pattern: 'NADA' }), /desconhecido/);
    const doc = addEntities(createDocument(), [hatch({ pattern: 'XADREZ', angle: 0, scale: 2, loops: [square(0, 0, 40)] })]);
    const svg = printSvg(doc, { fit: true });
    const expected = patternGeometry(doc.entities[0]).segments.length;
    const drawn = (svg.match(/M[-\d.]+ [-\d.]+L/g) ?? []).length;
    assert.ok(drawn >= expected && expected > 10, `${drawn} traços impressos para ${expected}`);
});
