import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGcode, gcodeToEntities, looksLikeGcode, orderLabelPosition, CNC_LAYERS } from '../src/cad/cnc.js';
import { serializeDocument } from '../src/cad/storage.js';
import { createDocument, addEntities } from '../src/cad/document.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const program = `N1 (Filename: teste)
N3 G21
N4 G90 G40
N7 G00 Z0.000
N9 G00 X-1.59 Y1.58
(Seq 1 - UNQ10-24 - 1 P, 2.00mm - CORTE)
N10 M03
N12 G01 X-2.59 Y1.58
N13 G01 X-102.69 Y1.58
N14 G01 X-102.69 Y191.78
N17 M05
N18 G00 X-671.41 Y57.3
(Seq 2 - UNQ15 - DOBRA _1_)
N20 M03
N22 G01 X-670.47 Y57.65
N23 M05
N126 G00 X-190.65 Y1543.04
(Seq 4 - CORTE)
N128 M03
N130 G01 X-192.07 Y1544.45
N131 G03 X-192.07 Y1544.45 I3.46 J-3.47
N132 M05
N133 G00 X-102.68 Y1921.06
N135 M03
N137 G01 X-101.68 Y1921.06
N140 G02 X-23.42 Y1537.78 I-80.1 J0.02
N145 M05
N176 M30`;

test('reconhece G-code e separa corte, marcação, deslocamento e perfurações', () => {
    assert.ok(looksLikeGcode(program));
    assert.ok(!looksLikeGcode('0\nSECTION\n2\nENTITIES\n'));
    const parsed = parseGcode(program);
    assert.equal(parsed.units, 'mm');
    assert.equal(parsed.groups.length, 3);
    assert.equal(parsed.groups[1].isMark, true);
    const pierces = parsed.moves.filter((m) => m.kind === 'pierce');
    assert.equal(pierces.length, 4);
    assert.ok(close(pierces[0].at.x, -1.59) && close(pierces[0].at.y, 1.58), 'perfuração na posição do M03');
    const rapids = parsed.moves.filter((m) => m.kind === 'rapid');
    assert.equal(rapids.length, 3, 'o primeiro G00 posiciona, os demais deslocam');
    const cuts = parsed.moves.filter((m) => m.kind === 'cut');
    assert.equal(cuts.length, 6);
    const arcs = parsed.moves.filter((m) => m.kind === 'arc');
    assert.equal(arcs.length, 2);
    assert.equal(arcs[0].ccw, true);
    assert.ok(close(arcs[0].center.x, -192.07 + 3.46) && close(arcs[0].center.y, 1544.45 - 3.47));
});

test('entidades CNC: layers, círculo completo do G03, arco horário do G02, setas e ordem', () => {
    const r = gcodeToEntities(program);
    assert.equal(r.stats.pierces, 4);
    const layers = new Set(r.entities.map((e) => e.layer));
    ['cut', 'mark', 'rapid', 'pierce', 'order', 'direction'].forEach((k) => assert.ok(layers.has(CNC_LAYERS[k].name), `layer ${k}`));
    assert.equal(r.layers.find((l) => l.name === CNC_LAYERS.rapid.name).lineType, 'DASHED');
    const marks = r.entities.filter((e) => e.layer === CNC_LAYERS.mark.name);
    assert.equal(marks.length, 1, 'movimento da Seq DOBRA vai para marcação');
    const fullCircle = r.entities.find((e) => e.type === 'circle' && e.layer === CNC_LAYERS.cut.name);
    assert.ok(fullCircle && close(fullCircle.radius, Math.hypot(3.46, 3.47)), 'G03 com início=fim vira círculo');
    const arc = r.entities.find((e) => e.type === 'arc' && e.layer === CNC_LAYERS.cut.name);
    assert.ok(arc && close(arc.radius, Math.hypot(80.1, 0.02), 1e-6));
    assert.equal(arc.cnc.ccw, false);
    // Arco horário: armazenado anti-horário de fim→início; ponto de início do movimento está no fim do arco.
    const startAngle = Math.atan2(1921.06 - arc.center.y, -101.68 - arc.center.x);
    assert.ok(close(((startAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), arc.end, 1e-6));
    const order = r.entities.filter((e) => e.layer === CNC_LAYERS.order.name).map((e) => e.text);
    assert.deepEqual(order, ['1', '2', '3', '4']);
    const arrows = r.entities.filter((e) => e.layer === CNC_LAYERS.direction.name);
    assert.ok(arrows.length >= 2 && arrows.every((a) => a.type === 'polyline' && a.closed && a.vertices.length === 3));
    const rapid = r.entities.filter((e) => e.layer === CNC_LAYERS.rapid.name);
    assert.equal(rapid.length, 3);
    assert.ok(r.stats.cutLength > 400 && r.stats.rapidLength > 1000);
});

test('serialização do documento para armazenamento local preserva o essencial', () => {
    let doc = addEntities(createDocument(), [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }]);
    doc = { ...doc, name: 'peça.dxf' };
    const s = serializeDocument(doc);
    assert.equal(s.entities.length, 1);
    assert.equal(s.name, 'peça.dxf');
    assert.ok(s.layers.length === 1 && s.dimStyle && s.currentLayer === '0');
    assert.equal(JSON.parse(JSON.stringify(s)).entities[0].type, 'line');
});

test('rótulos de ordem de perfuração não se sobrepõem em furos coincidentes ou próximos', () => {
    // Três perfurações no mesmo ponto e duas quase juntas: é o caso real do programa do laser,
    // onde o offset fixo empilhava os números em cima uns dos outros.
    const programa = [
        'G21 G90',
        'G00 X100 Y100', 'M03', 'G01 X110 Y100', 'M05',
        'G00 X100 Y100', 'M03', 'G01 X100 Y110', 'M05',
        'G00 X100 Y100', 'M03', 'G01 X90 Y100', 'M05',
        'G00 X100.4 Y100.4', 'M03', 'G01 X105 Y105', 'M05',
        'G00 X300 Y300', 'M03', 'G01 X310 Y300', 'M05',
        'M30',
    ].join('\n');
    const r = gcodeToEntities(programa);
    const rotulos = r.entities.filter((e) => e.layer === CNC_LAYERS.order.name);
    assert.deepEqual(rotulos.map((e) => e.text), ['1', '2', '3', '4', '5']);

    const caixa = (e) => ({
        minX: e.position.x,
        minY: e.position.y,
        maxX: e.position.x + e.text.length * e.height * 0.7,
        maxY: e.position.y + e.height,
    });
    for (let i = 0; i < rotulos.length; i += 1) {
        for (let j = i + 1; j < rotulos.length; j += 1) {
            const a = caixa(rotulos[i]);
            const b = caixa(rotulos[j]);
            const sobrepoe = a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
            assert.ok(!sobrepoe, `rótulos ${rotulos[i].text} e ${rotulos[j].text} se sobrepõem`);
        }
    }
    // Cada rótulo continua perto do seu furo: empilhar não pode virar deriva.
    const furos = r.entities.filter((e) => e.layer === CNC_LAYERS.pierce.name && e.type === 'circle');
    rotulos.forEach((rotulo) => {
        const furo = furos.find((f) => f.cnc.pierce === rotulo.cnc.pierce);
        const dist = Math.hypot(rotulo.position.x - furo.center.x, rotulo.position.y - furo.center.y);
        assert.ok(dist < rotulo.height * 10, `rótulo ${rotulo.text} ficou longe do furo: ${dist.toFixed(2)}`);
    });
});

test('posicionamento de rótulo devolve a posição padrão quando não sobra espaço', () => {
    const taken = [];
    const opcoes = { textHeight: 2, markerSize: 1, taken };
    const primeira = orderLabelPosition({ x: 0, y: 0 }, '7', opcoes);
    assert.ok(primeira.x > 0 && primeira.y > 0, 'primeiro rótulo usa o canto padrão');
    assert.equal(taken.length, 1);
    const segunda = orderLabelPosition({ x: 0, y: 0 }, '8', opcoes);
    assert.notDeepEqual(segunda, primeira);
    assert.equal(taken.length, 2);
});
