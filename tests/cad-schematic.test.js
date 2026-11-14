import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument, addEntities, updateEntities, removeEntities } from '../src/cad/document.js';
import { transformEntity, entityBox } from '../src/cad/geometry.js';
import {
    validateSymbol, buildLibrary, registerLibrary, unregisterLibrary, libraryFromFiles, searchSymbols, getSymbolDef,
} from '../src/cad/schematic-library.js';
import {
    createSymbol, syncSchematic, analyzeSchematic, symbolPorts, routeLink, linkPoints, findLinkNear, splitLinkAt, nextLabel, typesCompatible, symbolBodyBox, routeLinkAround,
} from '../src/cad/schematic.js';
import { documentToTraco, tracoToDocument } from '../src/cad/traco-file.js';
import iso1219 from '../src/cad/schematic-lib/iso1219.js';

function symbolDef(id, ports, extra = {}) {
    const geometria = ports.map((p) => ({ type: 'line', start: { x: 0, y: 0 }, end: p.position }));
    return {
        formato: 'traco-simbolo', versao: 1, id, nome: id, categoria: 'teste', norma: 'ISO 1219-1', unidade: 'mm',
        geometria, portas: ports, atributos: [{ nome: 'etiqueta', prefixo: 'X', visivel: true, posicao: { x: 0, y: 10 }, altura: 2.5 }], ...extra,
    };
}

const port = (name, x, y, orientation, type, required = true) => ({ name, position: { x, y }, orientation, type, required });

// Biblioteca sintética para as regras de rede.
registerLibrary(buildLibrary(
    { formato: 'traco-biblioteca', versao: 1, id: 'teste', nome: 'Teste', versao_biblioteca: '1.0.0', simbolos: [] },
    [
        symbolDef('fonte-pressao', [port('P', 0, 10, 'n', 'pressao')]),
        symbolDef('fonte-piloto', [port('X', 0, 10, 'n', 'piloto')]),
        symbolDef('fonte-succao', [port('S', 0, 10, 'n', 'succao')]),
        symbolDef('fonte-dreno', [port('L', 0, 10, 'n', 'dreno')]),
        symbolDef('fonte-trabalho', [port('A', 0, 10, 'n', 'trabalho')]),
        symbolDef('fonte-retorno', [port('R', 0, 10, 'n', 'retorno')]),
        symbolDef('restricao', [port('A', 0, -10, 's', 'passante'), port('B', 0, 10, 'n', 'passante')]),
        symbolDef('reservatorio', [port('T', 0, 10, 'n', 'retorno')], { rede_global: 'tanque' }),
        symbolDef('opcional', [port('A', 0, 10, 'n', 'trabalho', false)]),
    ],
));

function link(from, to, extra = {}) {
    return { type: 'link', from, to, ...extra };
}

function build(entities) {
    return syncSchematic(addEntities(createDocument(), entities));
}

test('biblioteca embutida: ISO 1219 0.2.0, 20 símbolos válidos e portas com as chaves do terminal', () => {
    assert.equal(iso1219.manifesto.id, 'iso1219');
    assert.equal(iso1219.manifesto.versao_biblioteca, '0.2.0');
    assert.equal(iso1219.simbolos.length, 20);
    assert.deepEqual(iso1219.manifesto.simbolos, iso1219.simbolos.map((s) => `${s.id}.json`));
    assert.equal(new Set(iso1219.simbolos.map((s) => s.id)).size, 20);
    for (const s of iso1219.simbolos) {
        assert.deepEqual(validateSymbol(s), [], s.id);
        for (const p of s.portas) assert.deepEqual(Object.keys(p).sort(), ['name', 'orientation', 'position', 'required', 'type']);
    }
    assert.equal(getSymbolDef('iso1219/tanque').rede_global, 'tanque');
    assert.deepEqual(searchSymbols('cilindro').map((s) => s.ref), ['iso1219/cilindro-dupla-acao']);
    assert.ok(searchSymbols('reservatorio').some((s) => s.ref === 'iso1219/tanque'), 'busca pela categoria, sem acento');
});

test('validador: mesmas conferências do gerador da biblioteca', () => {
    const ok = symbolDef('ok', [port('A', 0, 10, 'n', 'trabalho')]);
    assert.deepEqual(validateSymbol(ok), []);
    const errs = (patch) => validateSymbol({ ...ok, ...patch });
    assert.ok(errs({ portas: [port('A', 0, 10, 'n', 'hidraulica')] }).some((e) => /tipo hidraulica/.test(e)));
    assert.ok(errs({ portas: [port('A', 0, 10, 'x', 'trabalho')] }).some((e) => /orientação/.test(e)));
    assert.ok(errs({ portas: [port('A', 0, 12, 'n', 'trabalho')] }).some((e) => /grade/.test(e)));
    assert.ok(errs({ portas: [port('A', 5, 10, 'n', 'trabalho')] }).some((e) => /solta do desenho/.test(e)));
    assert.ok(errs({ portas: [port('A', 0, 10, 'n', 'trabalho'), port('A', 0, 10, 'n', 'trabalho')] }).includes('porta repetida'));
    assert.ok(errs({ portas: [port('A', 0, 10, 'n', 'passante', false)] }).some((e) => /passante é sempre obrigatória/.test(e)));
    assert.ok(errs({ atributos: [] }).includes('sem prefixo de etiqueta'));
    assert.ok(errs({ geometria: [...ok.geometria, { type: 'spline' }] }).some((e) => /spline fora da lista/.test(e)));
    assert.ok(errs({ versao: 2 }).includes('formato/versão'));
    // Chaves antigas (posicao/orientacao/tipo) não passam: o formato congelado usa as do terminal.
    const old = { ...ok, portas: [{ nome: 'A', posicao: { x: 0, y: 10 }, orientacao: 'n', tipo: 'trabalho', obrigatoria: true }] };
    assert.ok(validateSymbol(old).length > 0);
});

test('carregador por pasta: manifesto + arquivos; problema em qualquer símbolo recusa a biblioteca inteira', () => {
    const a = symbolDef('a', [port('A', 0, 10, 'n', 'trabalho')]);
    const manifest = { formato: 'traco-biblioteca', versao: 1, id: 'pasta', nome: 'Pasta', versao_biblioteca: '0.2.0', simbolos: ['a.json'] };
    const lib = libraryFromFiles([{ name: 'biblioteca.json', text: JSON.stringify(manifest) }, { name: 'sub/a.json', text: JSON.stringify(a) }]);
    assert.equal(lib.simbolos.get('a').nome, 'a');
    assert.throws(() => libraryFromFiles([{ name: 'a.json', text: '{}' }]), /biblioteca\.json/);
    const bad = { ...a, portas: [port('A', 1, 10, 'n', 'trabalho')] };
    assert.throws(() => libraryFromFiles([{ name: 'biblioteca.json', text: JSON.stringify(manifest) }, { name: 'a.json', text: JSON.stringify(bad) }]), /Biblioteca inválida: a: porta A fora da grade/);
    assert.equal(unregisterLibrary('iso1219'), false, 'a embutida não sai');
});

test('rotação de 90 em 90 e espelho: portas acompanham e o espelho troca e/w como o terminal', () => {
    const v = { ...createSymbol('iso1219/valvula-4-3-centro-fechado', { x: 40, y: 50 }), id: 'v' };
    const p = (sym, name) => symbolPorts(sym).find((q) => q.name === name);
    assert.deepEqual(p(v, 'P'), { name: 'P', type: 'pressao', required: true, position: { x: 35, y: 45 }, orientation: 's' });
    const r90 = { ...v, rotation: 90 };
    assert.deepEqual([p(r90, 'P').position, p(r90, 'P').orientation], [{ x: 45, y: 45 }, 'e']);
    const m = { ...v, espelho: true };
    assert.deepEqual([p(m, 'P').position, p(m, 'P').orientation], [{ x: 45, y: 45 }, 's']);
    const motor = { ...createSymbol('iso1219/cilindro-dupla-acao', { x: 0, y: 0 }), id: 'c', rotation: 90 };
    assert.equal(p(motor, 'A').orientation, 'e');
    assert.equal(p({ ...motor, espelho: true }, 'A').orientation, 'e', 'porta s girada 90° vira e; espelho troca e/w só antes da rotação');
    // Transformação genérica (ROTATE/MIRROR do Traço) cai sempre em 0/90/180/270 + espelho.
    const rot = transformEntity(v, (q) => ({ x: -q.y, y: q.x }));
    assert.deepEqual([rot.position, rot.rotation, rot.espelho], [{ x: -50, y: 40 }, 90, false]);
    const mir = transformEntity(v, (q) => ({ x: -q.x, y: q.y }), { mirror: true });
    assert.deepEqual([mir.position, mir.rotation, mir.espelho], [{ x: -40, y: 50 }, 0, true]);
    assert.deepEqual(p(mir, 'P').position, { x: -35, y: 45 }, 'espelhar no mundo = espelho da instância');
    const mirX = transformEntity(v, (q) => ({ x: q.x, y: -q.y }), { mirror: true });
    assert.deepEqual([mirX.rotation, mirX.espelho], [180, true]);
    assert.deepEqual(p(mirX, 'A').position, { x: 35, y: -75 });
    assert.ok(Number.isFinite(entityBox(v).minX));
});

test('roteamento: só L ou Z, ortogonal', () => {
    assert.deepEqual(routeLink({ x: 0, y: 0 }, 'n', { x: 10, y: 20 }, 's'), [{ x: 0, y: 10 }, { x: 10, y: 10 }]);
    assert.deepEqual(routeLink({ x: 0, y: 0 }, 'e', { x: 10, y: 20 }, 'n'), [{ x: 10, y: 0 }]);
    assert.deepEqual(routeLink({ x: 0, y: 0 }, 'n', { x: 10, y: 20 }, 'e'), [{ x: 0, y: 20 }]);
    assert.deepEqual(routeLink({ x: 0, y: 0 }, 'n', { x: 10, y: 20 }, 's', 'L'), [{ x: 0, y: 20 }]);
    assert.deepEqual(routeLink({ x: 0, y: 0 }, 'n', { x: 0, y: 20 }, 's'), [], 'alinhado: reta');
});

test('ligação presa à porta acompanha o símbolo; vértice manual fica', () => {
    let doc = build([
        { ...createSymbol('teste/fonte-pressao', { x: 0, y: 0 }), id: 'a' },
        { ...createSymbol('teste/fonte-pressao', { x: 30, y: 40 }), id: 'b' },
        { ...link({ symbol: 'a', port: 'P' }, { symbol: 'b', port: 'P' }), id: 'l' },
    ]);
    const l0 = doc.entities.find((e) => e.id === 'l');
    assert.deepEqual(linkPoints(l0), [{ x: 0, y: 10 }, { x: 0, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 50 }]);
    doc = syncSchematic(updateEntities(doc, ['b'], (e) => ({ ...e, position: { x: 50, y: 40 } })));
    assert.deepEqual(linkPoints(doc.entities.find((e) => e.id === 'l')).at(-1), { x: 50, y: 50 });
    // Vértices manuais: só o primeiro e o último acompanham.
    doc = syncSchematic(updateEntities(doc, ['l'], (e) => ({ ...e, manual: true, vertices: [{ x: 0, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 60 }, { x: 50, y: 60 }] })));
    doc = syncSchematic(updateEntities(doc, ['b'], (e) => ({ ...e, position: { x: 70, y: 40 } })));
    assert.deepEqual(linkPoints(doc.entities.find((e) => e.id === 'l')), [{ x: 0, y: 10 }, { x: 0, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 60 }, { x: 70, y: 60 }, { x: 70, y: 50 }]);
    // Sem mudança nas portas, o documento é o mesmo objeto.
    assert.equal(syncSchematic(doc), doc);
});

test('apagar o símbolo deixa a ligação solta, no lugar e sem erro', () => {
    let doc = build([
        { ...createSymbol('teste/fonte-pressao', { x: 0, y: 0 }), id: 'a' },
        { ...createSymbol('teste/fonte-pressao', { x: 30, y: 40 }), id: 'b' },
        { ...link({ symbol: 'a', port: 'P' }, { symbol: 'b', port: 'P' }), id: 'l' },
    ]);
    doc = syncSchematic(removeEntities(doc, ['b']));
    const an = analyzeSchematic(doc);
    assert.ok(an.loose.has('l'));
    assert.deepEqual(an.problems, []);
    assert.deepEqual(linkPoints(doc.entities.find((e) => e.id === 'l')).at(-1), { x: 30, y: 50 });
});

test('redes: E2 por tipos incompatíveis, rede global do tanque e E1 de porta obrigatória solta', () => {
    const doc = build([
        { ...createSymbol('teste/fonte-pressao', { x: 0, y: 0 }), id: 'p' },
        { ...createSymbol('teste/fonte-piloto', { x: 20, y: 0 }), id: 'x' },
        { ...createSymbol('teste/fonte-succao', { x: 40, y: 0 }), id: 's' },
        { ...createSymbol('teste/reservatorio', { x: 60, y: 0 }), id: 't1' },
        { ...createSymbol('teste/reservatorio', { x: 80, y: 0 }), id: 't2' },
        { ...createSymbol('teste/opcional', { x: 100, y: 0 }), id: 'o' },
        { ...link({ symbol: 'p', port: 'P' }, { symbol: 'x', port: 'X' }), id: 'l1' },
        { ...link({ symbol: 's', port: 'S' }, { symbol: 't1', port: 'T' }), id: 'l2' },
    ]);
    const an = analyzeSchematic(doc);
    // Piloto na pressão é aviso A5, não erro.
    assert.equal(an.problems.filter((p) => p.code === 'E2').length, 0);
    const a5 = an.problems.filter((p) => p.code === 'A5');
    assert.equal(a5.length, 1);
    assert.deepEqual(a5[0].types, ['piloto', 'pressao']);
    assert.ok(a5[0].ids.includes('l1'));
    // t2 entra na rede do tanque pela rede global, mas a porta dele continua obrigatória e solta.
    const tank = an.nets.find((n) => n.ports.some((p) => p.symbol === 't2'));
    assert.ok(tank.ports.some((p) => p.symbol === 's'));
    assert.deepEqual(an.problems.filter((p) => p.code === 'E1').map((p) => p.ids[0]), ['t2'], 'porta opcional solta não acusa');
    assert.equal(an.linkLineType.get('l2'), 'CONTINUOUS');
    assert.ok(!typesCompatible('succao', 'pressao'));
    assert.ok(typesCompatible('succao', 'retorno'));
});

test('passante: não une as redes, tipo atravessa a peça (inclusive em cadeia) e E2 vale depois da herança', () => {
    const doc = build([
        { ...createSymbol('teste/fonte-piloto', { x: 0, y: 0 }), id: 'x' },
        { ...createSymbol('teste/restricao', { x: 0, y: 30 }), id: 'r1' },
        { ...createSymbol('teste/restricao', { x: 0, y: 60 }), id: 'r2' },
        { ...link({ symbol: 'x', port: 'X' }, { symbol: 'r1', port: 'A' }), id: 'l1' },
        { ...link({ symbol: 'r1', port: 'B' }, { symbol: 'r2', port: 'A' }), id: 'l2' },
        { ...link({ symbol: 'r2', port: 'B' }, { point: { x: 0, y: 90 } }), id: 'l3' },
    ]);
    const an = analyzeSchematic(doc);
    assert.notEqual(an.linkNet.get('l1'), an.linkNet.get('l2'), 'A e B em redes separadas');
    assert.deepEqual(['l1', 'l2', 'l3'].map((id) => an.linkLineType.get(id)), ['DASHED', 'DASHED', 'DASHED']);
    assert.deepEqual(an.problems, []);
    // Sem tipo dos dois lados: contínua.
    const bare = analyzeSchematic(build([
        { ...createSymbol('teste/restricao', { x: 0, y: 0 }), id: 'r' },
        { ...link({ symbol: 'r', port: 'B' }, { point: { x: 0, y: 40 } }), id: 'l' },
        { ...link({ symbol: 'r', port: 'A' }, { point: { x: 0, y: -40 } }), id: 'm' },
    ]));
    assert.equal(bare.linkLineType.get('l'), 'CONTINUOUS');
    // Piloto de um lado e pressão do outro: E2 através da restrição.
    const cross = analyzeSchematic(build([
        { ...createSymbol('teste/fonte-piloto', { x: 0, y: 0 }), id: 'x' },
        { ...createSymbol('teste/fonte-pressao', { x: 40, y: 0 }), id: 'p' },
        { ...createSymbol('teste/restricao', { x: 20, y: 30 }), id: 'r' },
        { ...link({ symbol: 'x', port: 'X' }, { symbol: 'r', port: 'A' }), id: 'l1' },
        { ...link({ symbol: 'r', port: 'B' }, { symbol: 'p', port: 'P' }), id: 'l2' },
    ]));
    assert.deepEqual(cross.problems.map((p) => [p.code, p.ids]), [['A5', ['r']]]);
    // Sucção de um lado e pressão do outro: E2 através da restrição.
    const crossErr = analyzeSchematic(build([
        { ...createSymbol('teste/fonte-succao', { x: 0, y: 0 }), id: 's' },
        { ...createSymbol('teste/fonte-pressao', { x: 40, y: 0 }), id: 'p' },
        { ...createSymbol('teste/restricao', { x: 20, y: 30 }), id: 'r' },
        { ...link({ symbol: 's', port: 'S' }, { symbol: 'r', port: 'A' }), id: 'l1' },
        { ...link({ symbol: 'r', port: 'B' }, { symbol: 'p', port: 'P' }), id: 'l2' },
    ]));
    assert.deepEqual(crossErr.problems.map((p) => [p.code, p.ids]), [['E2', ['r']]]);
    // Porta passante solta: E1 (passante é sempre obrigatória).
    const open = analyzeSchematic(build([
        { ...createSymbol('teste/fonte-piloto', { x: 0, y: 0 }), id: 'x' },
        { ...createSymbol('teste/restricao', { x: 0, y: 30 }), id: 'r' },
        { ...link({ symbol: 'x', port: 'X' }, { symbol: 'r', port: 'A' }), id: 'l1' },
    ]));
    assert.deepEqual(open.problems.map((p) => [p.code, p.port]), [['E1', 'B']]);
});

test('junção: terminar sobre uma ligação divide a ligação e une as redes', () => {
    let doc = build([
        { ...createSymbol('teste/fonte-pressao', { x: 0, y: 0 }), id: 'a' },
        { ...createSymbol('teste/fonte-pressao', { x: 0, y: 100 }), id: 'b' },
        { ...createSymbol('teste/fonte-pressao', { x: 40, y: 40 }), id: 'c' },
        { ...link({ symbol: 'a', port: 'P' }, { symbol: 'b', port: 'P' }), id: 'l' },
    ]);
    const hit = findLinkNear(doc, { x: 0.4, y: 50 }, 1);
    assert.deepEqual(hit.point, { x: 0, y: 50 });
    const { first, second, junction } = splitLinkAt(hit.link, hit.segment, hit.point, 'j', 'l2');
    doc = syncSchematic(addEntities(updateEntities(doc, ['l'], () => first), [second, junction, { ...link({ junction: 'j' }, { symbol: 'c', port: 'P' }), id: 'l3' }]));
    const an = analyzeSchematic(doc);
    assert.equal(new Set(['l', 'l2', 'l3'].map((id) => an.linkNet.get(id))).size, 1);
    assert.deepEqual(an.problems, []);
});

test('.traco determinístico: ida e volta idêntica, só o símbolo movido muda no diff, sem pontas derivadas', () => {
    const doc = build([
        { type: 'line', start: { x: -50, y: -50 }, end: { x: 150, y: -50 }, id: 'ln' },
        { ...createSymbol('iso1219/bomba-variavel-ls', { x: 0, y: 0 }, { atributos: { etiqueta: 'B1' } }), id: 'b' },
        { ...createSymbol('iso1219/valvula-4-3-centro-fechado', { x: 60, y: 60 }, { rotation: 90, espelho: true, atributos: { etiqueta: 'V1' } }), id: 'v' },
        { ...createSymbol('iso1219/tanque', { x: 0, y: -60 }, { atributos: { etiqueta: 'R1' } }), id: 't' },
        { ...link({ symbol: 'b', port: 'P' }, { symbol: 'v', port: 'P' }), id: 'l1' },
        { ...link({ symbol: 'b', port: 'S' }, { symbol: 't', port: 'T' }), id: 'l2' },
    ]);
    const text = documentToTraco(doc);
    assert.equal(documentToTraco(doc), text);
    assert.doesNotMatch(text, /"ends"|"pontas"|_bbox/);
    const { doc: back, warnings } = tracoToDocument(text, { name: 'x.traco' });
    assert.deepEqual(warnings, []);
    assert.equal(documentToTraco(back), text, 'reabrir e salvar dá o mesmo arquivo');
    assert.deepEqual(linkPoints(back.entities.find((e) => e.id === 'l1')), linkPoints(doc.entities.find((e) => e.id === 'l1')));
    assert.equal(back.entities.find((e) => e.id === 'v').espelho, true);
    const moved = syncSchematic(updateEntities(doc, ['v'], (e) => ({ ...e, position: { x: 80, y: 60 } })));
    const a = text.split('\n');
    const b = documentToTraco(moved).split('\n');
    assert.equal(a.length, b.length);
    const diff = a.map((line, i) => (line === b[i] ? null : [line, b[i]])).filter(Boolean);
    assert.deepEqual(diff, [['        "x": 60,', '        "x": 80,']]);
});

test('.traco: ligação solta reabre no lugar; biblioteca ausente avisa sem impedir abrir', () => {
    let doc = build([
        { ...createSymbol('teste/fonte-pressao', { x: 0, y: 0 }), id: 'a' },
        { ...createSymbol('teste/fonte-pressao', { x: 30, y: 40 }), id: 'b' },
        { ...link({ symbol: 'a', port: 'P' }, { symbol: 'b', port: 'P' }), id: 'l' },
    ]);
    doc = syncSchematic(removeEntities(doc, ['b']));
    const text = documentToTraco(doc);
    assert.match(text, /"pontas"/);
    const back = tracoToDocument(text).doc;
    assert.deepEqual(linkPoints(back.entities.find((e) => e.id === 'l')).at(-1), { x: 30, y: 50 });
    const alien = text.replace(/teste\/fonte-pressao/g, 'outra/peca').replace('"id": "teste"', '"id": "outra"');
    const res = tracoToDocument(alien);
    assert.ok(res.warnings.some((w) => /outra/.test(w)));
    assert.throws(() => tracoToDocument('{"formato":"outro"}'), /Não é um arquivo de esquema/);
});

test('etiqueta automática por prefixo', () => {
    const doc = build([
        { ...createSymbol('iso1219/tanque', { x: 0, y: 0 }, { atributos: { etiqueta: 'R1' } }) },
        { ...createSymbol('iso1219/tanque', { x: 0, y: 0 }, { atributos: { etiqueta: 'R7' } }) },
    ]);
    assert.equal(nextLabel(doc, 'R'), 'R8');
    assert.equal(nextLabel(doc, 'V'), 'V1');
});

test('circuitos reais: tanques separados, pilotos em linha de potência e pares que continuam erro', () => {
    // Sucção num tanque e dreno em outro: sem E2, porque o E2 confere a rede antes de juntar os tanques.
    const tanks = analyzeSchematic(build([
        { ...createSymbol('teste/fonte-succao', { x: 0, y: 0 }), id: 's' },
        { ...createSymbol('teste/fonte-dreno', { x: 40, y: 0 }), id: 'd' },
        { ...createSymbol('teste/reservatorio', { x: 0, y: 30 }), id: 't1' },
        { ...createSymbol('teste/reservatorio', { x: 40, y: 30 }), id: 't2' },
        { ...link({ symbol: 's', port: 'S' }, { symbol: 't1', port: 'T' }), id: 'ls' },
        { ...link({ symbol: 'd', port: 'L' }, { symbol: 't2', port: 'T' }), id: 'ld' },
    ]));
    assert.deepEqual(tanks.problems, []);
    // Na lista de redes os tanques continuam sendo uma rede só.
    const tank = tanks.nets.find((n) => n.ports.some((p) => p.symbol === 't1'));
    assert.deepEqual(tank.ports.map((p) => p.symbol).sort(), ['d', 's', 't1', 't2']);
    // Dreno até o tanque sai tracejado; sucção até o tanque, contínua.
    assert.equal(tanks.linkLineType.get('ld'), 'DASHED');
    assert.equal(tanks.linkLineType.get('ls'), 'CONTINUOUS');
    // Dreno direto na sucção continua erro.
    const direct = analyzeSchematic(build([
        { ...createSymbol('teste/fonte-succao', { x: 0, y: 0 }), id: 's' },
        { ...createSymbol('teste/fonte-dreno', { x: 40, y: 0 }), id: 'd' },
        { ...link({ symbol: 's', port: 'S' }, { symbol: 'd', port: 'L' }), id: 'l' },
    ]));
    assert.deepEqual(direct.problems.map((p) => [p.code, p.types]), [['E2', ['dreno', 'succao']]]);
    // Piloto do contrabalanço na linha de trabalho oposta: aviso A5.
    const counter = analyzeSchematic(build([
        { ...createSymbol('teste/fonte-piloto', { x: 0, y: 0 }), id: 'x' },
        { ...createSymbol('teste/fonte-trabalho', { x: 40, y: 0 }), id: 'b' },
        { ...link({ symbol: 'x', port: 'X' }, { symbol: 'b', port: 'A' }), id: 'l' },
    ]));
    assert.deepEqual(counter.problems.map((p) => [p.code, p.types]), [['A5', ['piloto', 'trabalho']]]);
    // Piloto com retorno, sucção ou dreno e pressão com retorno continuam erro.
    const pairs = [
        ['fonte-piloto', 'X', 'fonte-retorno', 'R', ['piloto', 'retorno']],
        ['fonte-piloto', 'X', 'fonte-succao', 'S', ['piloto', 'succao']],
        ['fonte-piloto', 'X', 'fonte-dreno', 'L', ['dreno', 'piloto']],
        ['fonte-pressao', 'P', 'fonte-retorno', 'R', ['pressao', 'retorno']],
        ['fonte-trabalho', 'A', 'fonte-dreno', 'L', ['dreno', 'trabalho']],
        ['fonte-trabalho', 'A', 'fonte-succao', 'S', ['succao', 'trabalho']],
    ];
    for (const [da, pa, db, pb, types] of pairs) {
        const an = analyzeSchematic(build([
            { ...createSymbol(`teste/${da}`, { x: 0, y: 0 }), id: 'a' },
            { ...createSymbol(`teste/${db}`, { x: 40, y: 0 }), id: 'b' },
            { ...link({ symbol: 'a', port: pa }, { symbol: 'b', port: pb }), id: 'l' },
        ]));
        assert.deepEqual(an.problems.map((p) => [p.code, p.types]), [['E2', types]], types.join('+'));
    }
});

function crossesBox(points, box) {
    for (let i = 0; i + 1 < points.length; i += 1) {
        const [p, q] = [points[i], points[i + 1]];
        if (Math.max(p.x, q.x) > box.minX + 1e-6 && Math.min(p.x, q.x) < box.maxX - 1e-6
            && Math.max(p.y, q.y) > box.minY + 1e-6 && Math.min(p.y, q.y) < box.maxY - 1e-6) return true;
    }
    return false;
}

test('LIGAR: porta de cima ligada por baixo contorna o motor em vez de atravessá-lo', () => {
    const motor = { ...createSymbol('iso1219/motor-unidirecional', { x: 0, y: 0 }, { atributos: { etiqueta: 'M1' } }), id: 'm' };
    const tank = { ...createSymbol('iso1219/tanque', { x: 20, y: -60 }, { atributos: { etiqueta: 'R1' } }), id: 't' };
    const doc = build([motor, tank, { ...link({ symbol: 'm', port: 'A' }, { symbol: 't', port: 'T' }), id: 'l' }]);
    const l = doc.entities.find((e) => e.id === 'l');
    const pts = linkPoints(l);
    const box = symbolBodyBox(doc.entities.find((e) => e.id === 'm'));
    assert.ok(box && box.maxY <= 15 + 1e-6, 'caixa do corpo sem os textos');
    assert.equal(crossesBox(pts, box), false, `não passa por dentro do motor: ${JSON.stringify(pts)}`);
    assert.equal(crossesBox(pts, symbolBodyBox(doc.entities.find((e) => e.id === 't'))), false, 'nem do reservatório');
    // Sai para cima, na direção da porta.
    assert.ok(pts[1].y > pts[0].y && Math.abs(pts[1].x - pts[0].x) < 1e-9, 'primeiro trecho para cima');
    for (let i = 0; i + 1 < pts.length; i += 1) assert.ok(Math.abs(pts[i].x - pts[i + 1].x) < 1e-9 || Math.abs(pts[i].y - pts[i + 1].y) < 1e-9, 'ortogonal');
});

test('LIGAR: sem obstáculo o traçado continua o L/Z de antes', () => {
    const box = { minX: -10, minY: -20, maxX: 10, maxY: 0 };
    assert.deepEqual(routeLinkAround({ point: { x: 0, y: 0 }, orientation: 'n', box }, { point: { x: 10, y: 20 }, orientation: 's', box: null }), [{ x: 0, y: 10 }, { x: 10, y: 10 }]);
});
