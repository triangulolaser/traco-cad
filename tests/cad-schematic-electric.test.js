// Domínio elétrico do esquema (decisão 13 do formato): porta `eletrico`, fio na ligação, seção Fios
// na lista de peças e a biblioteca IEC 60617 genérica embutida. A colaboração do fio fica em
// cad-collab-schematic.test.js, que não vai para a versão pública.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument, addEntities } from '../src/cad/document.js';
import { validateSymbol, getSymbolDef, searchSymbols, isBuiltinLibrary, PORT_TYPES, CONNECTOR_REF } from '../src/cad/schematic-library.js';
import { createSymbol, syncSchematic, analyzeSchematic, typesCompatible, normalizeWire } from '../src/cad/schematic.js';
import { schematicBom, bomCsv, bomSections } from '../src/cad/schematic-bom.js';
import { bomPrintSvgs } from '../src/cad/schematic-print.js';
import { schematicPropertiesHtml } from '../src/cad/schematic-panel.js';
import { documentToTraco, tracoToDocument } from '../src/cad/traco-file.js';
import { MODE_SCHEMATIC, withMode } from '../src/cad/schematic-mode.js';
import iec60617 from '../src/cad/schematic-lib/iec60617.js';

const sym = (id, ref, x, y, atributos = {}) => ({ ...createSymbol(ref, { x, y }, { atributos }), id });
const link = (id, from, to, extra = {}) => ({ type: 'link', id, from, to, ...extra });
const build = (entities) => syncSchematic(addEntities(withMode(createDocument(), MODE_SCHEMATIC), entities));

// Fusível F1 alimentando a lâmpada H1, com o retorno no terra.
function circuit(extraLinks = []) {
    const fuse = getSymbolDef('iec60617/fusivel');
    const lamp = getSymbolDef('iec60617/lampada');
    const ground = getSymbolDef('iec60617/terra');
    const [f1, f2] = fuse.portas.map((p) => p.name);
    const [l1, l2] = lamp.portas.map((p) => p.name);
    return build([
        sym('F1', 'iec60617/fusivel', 0, 0, { etiqueta: 'F1' }),
        sym('H1', 'iec60617/lampada', 40, 0, { etiqueta: 'H1' }),
        sym('G1', 'iec60617/terra', 80, 0, { etiqueta: 'G1' }),
        sym('V1', 'iec60617/alimentacao-12v', -40, 0, { etiqueta: 'V1' }),
        link('w1', { symbol: 'V1', port: '+12V' }, { symbol: 'F1', port: f1 }, { fio: { numero: '1', cor: 'vermelho', secao_mm2: 1.5 } }),
        link('w2', { symbol: 'F1', port: f2 }, { symbol: 'H1', port: l1 }, { fio: { numero: '2', secao_mm2: 1 } }),
        link('w3', { symbol: 'H1', port: l2 }, { symbol: 'G1', port: ground.portas[0].name }),
        ...extraLinks,
    ]);
}

test('IEC 60617 0.1.1 embutida: 19 símbolos válidos, todas as portas elétricas', () => {
    assert.ok(PORT_TYPES.includes('eletrico'));
    assert.equal(iec60617.manifesto.id, 'iec60617');
    assert.equal(iec60617.manifesto.versao_biblioteca, '0.1.1');
    assert.equal(iec60617.simbolos.length, 19);
    assert.deepEqual(iec60617.manifesto.simbolos, iec60617.simbolos.map((s) => `${s.id}.json`));
    for (const s of iec60617.simbolos) {
        assert.deepEqual(validateSymbol(s), [], s.id);
        for (const p of s.portas) assert.equal(p.type, 'eletrico', `${s.id}.${p.name}`);
    }
    assert.ok(isBuiltinLibrary('iec60617'));
    assert.equal(getSymbolDef('iec60617/alimentacao-12v').rede_global, '+12V');
    assert.ok(searchSymbols('rele').some((s) => s.ref === 'iec60617/rele-4-vias'));
});

test('rede elétrica: só com elétrico; elétrico com hidráulico é E2', () => {
    assert.ok(typesCompatible('eletrico', 'eletrico'));
    for (const t of ['pressao', 'retorno', 'succao', 'trabalho', 'piloto', 'dreno']) assert.equal(typesCompatible('eletrico', t), false, t);
    const ok = circuit();
    const an = analyzeSchematic(ok);
    assert.deepEqual(an.problems.filter((p) => p.code === 'E2'), []);
    assert.deepEqual([...an.electricLinks].sort(), ['w1', 'w2', 'w3']);
    for (const id of ['w1', 'w2', 'w3']) assert.equal(an.linkLineType.get(id), 'CONTINUOUS');
    const tank = sym('T1', 'iso1219/tanque', 120, 0, { etiqueta: 'R1' });
    const mixed = build([...ok.entities.filter((e) => e.type !== 'link' || e.id !== 'w3'), tank,
        link('w3', { symbol: 'H1', port: getSymbolDef('iec60617/lampada').portas[1].name }, { symbol: 'T1', port: 'T' })]);
    const e2 = analyzeSchematic(mixed).problems.find((p) => p.code === 'E2');
    assert.ok(e2, 'elétrico ligado no tanque acusa E2');
    assert.deepEqual(e2.types, ['eletrico', 'retorno']);
    assert.ok(e2.ids.includes('H1') && e2.ids.includes('T1'));
});

test('borne de uma porta: vários fios na mesma porta formam uma rede só', () => {
    const doc = build([
        sym('X1', 'iec60617/borne', 0, 0, { etiqueta: 'X1' }),
        sym('H1', 'iec60617/lampada', 40, 0, { etiqueta: 'H1' }),
        sym('H2', 'iec60617/lampada', 40, 40, { etiqueta: 'H2' }),
        link('a', { symbol: 'X1', port: '1' }, { symbol: 'H1', port: getSymbolDef('iec60617/lampada').portas[0].name }),
        link('b', { symbol: 'X1', port: '1' }, { symbol: 'H2', port: getSymbolDef('iec60617/lampada').portas[0].name }),
    ]);
    const an = analyzeSchematic(doc);
    assert.equal(an.linkNet.get('a'), an.linkNet.get('b'));
    assert.deepEqual(an.problems.filter((p) => p.code === 'E2'), []);
});

test('normalizeWire: campos opcionais, número com vírgula, vazio vira null', () => {
    assert.equal(normalizeWire(null), null);
    assert.equal(normalizeWire({ numero: '  ', cor: '' }), null);
    assert.deepEqual(normalizeWire({ numero: ' 12 ', cor: 'azul', secao_mm2: '1,5', comprimento_mm: 'x', extra: 1 }), { numero: '12', cor: 'azul', secao_mm2: 1.5 });
    assert.deepEqual(normalizeWire({ secao_mm2: 0, comprimento_mm: 850 }), { comprimento_mm: 850 });
});

test('lista de peças: seção Fios com de/para etiqueta.porta; sem fio inventado; sem mangueiras', () => {
    const doc = circuit();
    const bom = schematicBom(doc);
    assert.deepEqual(bomSections(bom), { hoses: false, wires: true });
    assert.equal(bom.unlabeledLinks, 0, 'fio não conta como ligação sem rótulo de mangueira');
    assert.deepEqual(bom.wires.map((w) => [w.numero, w.de.split('.')[0], w.para.split('.')[0], w.cor, w.secao_mm2]), [
        ['1', 'V1', 'F1', 'vermelho', 1.5],
        ['2', 'F1', 'H1', '', 1],
        ['', 'H1', 'G1', '', null],
    ]);
    const csv = bomCsv(doc);
    assert.match(csv, /Fio;De;Para;Cor;Seção \(mm²\);Comprimento \(mm\)/);
    assert.match(csv, /\r\n1;V1\.\+12V;F1\.[^;]+;vermelho;1,5;\r\n/);
    assert.doesNotMatch(csv, /Mangueira/);
    const svg = bomPrintSvgs(doc).join('');
    assert.match(svg, />Fios</);
    assert.doesNotMatch(svg, />Mangueiras</);
    assert.ok(bom.parts.some((p) => p.ref === 'iec60617/fusivel'), 'componentes elétricos são peças');
});

test('lista de peças: hidráulico e elétrico no mesmo esquema saem em seções separadas', () => {
    const hyd = [
        sym('B1', 'iso1219/bomba-fixa', 200, 0, { etiqueta: 'B1' }),
        sym('R1', 'iso1219/tanque', 200, -40, { etiqueta: 'R1' }),
    ];
    const pump = getSymbolDef('iso1219/bomba-fixa').portas;
    const suction = pump.find((p) => p.type === 'succao') ?? pump[0];
    const doc = circuit([...hyd, link('h1', { symbol: 'B1', port: suction.name }, { symbol: 'R1', port: 'T' }, { rotulo: 'M-01' })]);
    const bom = schematicBom(doc);
    assert.deepEqual(bomSections(bom), { hoses: true, wires: true });
    assert.deepEqual(bom.hoses.map((h) => h.rotulo), ['M-01']);
    assert.equal(bom.wires.length, 3);
    const csv = bomCsv(doc);
    assert.ok(csv.indexOf('Mangueira') < csv.indexOf('Fio;De'), 'mangueiras antes dos fios');
});

test('ponta do fio em conector de página mostra o sinal', () => {
    const doc = build([
        sym('H1', 'iec60617/lampada', 0, 0, { etiqueta: 'H1' }),
        sym('X9', CONNECTOR_REF, 40, 0, { etiqueta: 'X9', sinal: 'FAROL' }),
        link('w', { symbol: 'H1', port: getSymbolDef('iec60617/lampada').portas[0].name }, { symbol: 'X9', port: 'X' }),
    ]);
    assert.equal(schematicBom(doc).wires[0].para, '→ FAROL');
});

test('painel: ligação elétrica edita o fio; hidráulica continua com a mangueira', () => {
    const doc = circuit();
    const w1 = doc.entities.find((e) => e.id === 'w1');
    const html = schematicPropertiesHtml(doc, [w1]);
    assert.match(html, /data-schematic-wire="numero"[^>]*value="1"/);
    assert.match(html, /data-schematic-wire="secao_mm2"[^>]*value="1,5"/);
    assert.doesNotMatch(html, /data-schematic-hose/);
    const two = schematicPropertiesHtml(doc, doc.entities.filter((e) => e.id === 'w1' || e.id === 'w2'));
    assert.match(two, /2 fios/);
    assert.match(two, /data-schematic-wire="numero" placeholder="\*Varia\*"/);
    const f1 = doc.entities.find((e) => e.id === 'F1');
    assert.match(schematicPropertiesHtml(doc, [f1]), /elétrico/);
});

test('.traco: o fio é gravado normalizado e volta igual', () => {
    const doc = circuit();
    const text = documentToTraco(doc);
    const data = JSON.parse(text);
    const w1 = data.ligacoes.find((l) => l.id === 'w1');
    assert.deepEqual(w1.fio, { cor: 'vermelho', numero: '1', secao_mm2: 1.5 });
    assert.equal('fio' in data.ligacoes.find((l) => l.id === 'w3'), false, 'ligação sem fio não grava o campo');
    const back = tracoToDocument(text).doc;
    assert.deepEqual(back.entities.find((e) => e.id === 'w1').fio, { numero: '1', cor: 'vermelho', secao_mm2: 1.5 });
    assert.equal(documentToTraco(back), text, 'reabrir e salvar dá o mesmo arquivo');
});

test('símbolo espelhado: legenda do desenho continua legível e do lado espelhado', async () => {
    const { symbolChildren } = await import('../src/cad/schematic.js');
    const { textBox } = await import('../src/cad/geometry.js');
    const ref = 'iec60617/conector-12-femea';
    const texts = (s) => symbolChildren(s).filter((c) => c.type === 'text' && /^\d+$/.test(c.text));
    for (const rotation of [0, 90]) {
        const plain = createSymbol(ref, { x: 0, y: 0 }, { rotation });
        const mirrored = createSymbol(ref, { x: 0, y: 0 }, { rotation, espelho: true });
        const a = texts(plain);
        const b = texts(mirrored);
        assert.equal(b.length, a.length);
        for (let i = 0; i < a.length; i += 1) {
            assert.ok(!b[i].mirrored, `${b[i].text} não espelhado`);
            assert.equal(Math.round(b[i].rotation % 360), Math.round(a[i].rotation % 360), `${b[i].text} com a rotação da instância (rot ${rotation})`);
            // Caixa do texto espelhada em relação à do símbolo sem espelho.
            const bx = textBox(b[i]).map((p) => p.x);
            const ax = textBox(a[i]).map((p) => p.x);
            if (rotation === 0) assert.ok(Math.abs(Math.min(...bx) + Math.max(...ax)) < 1e-6 && Math.abs(Math.max(...bx) + Math.min(...ax)) < 1e-6, `${b[i].text} na posição espelhada`);
        }
    }
});

test('IEC 60617 0.1.1: peça de um ponto só não leva legenda de porta', () => {
    for (const id of ['borne', 'splice', 'terra', 'alimentacao-12v', 'alimentacao-24v']) {
        const def = getSymbolDef(`iec60617/${id}`);
        const names = new Set(def.portas.map((p) => p.name));
        assert.ok(!def.geometria.some((g) => g.type === 'text' && names.has(g.text)), id);
    }
});

test('impressão: texto alinhado à direita (conector espelhado) termina no ponto, como na tela', async () => {
    const { entitySvg } = await import('../src/cad/print.js');
    const doc = createDocument();
    const right = entitySvg({ type: 'text', position: { x: 0, y: 0 }, height: 2.5, rotation: 0, text: 'P102', halign: 'right' }, doc, 1, true);
    assert.match(right, /<text text-anchor="end"/);
    const left = entitySvg({ type: 'text', position: { x: 0, y: 0 }, height: 2.5, rotation: 0, text: 'P102' }, doc, 1, true);
    assert.doesNotMatch(left, /text-anchor/);
    const mirrored = createSymbol(CONNECTOR_REF, { x: 100, y: 0 }, { espelho: true, atributos: { etiqueta: 'X1', sinal: 'P102' } });
    const { symbolChildren } = await import('../src/cad/schematic.js');
    const label = symbolChildren(mirrored).find((c) => c.type === 'text' && c.text === 'P102');
    assert.match(entitySvg(label, doc, 1, true), /text-anchor="end"/);
});
