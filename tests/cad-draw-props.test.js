import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor, DRAW_COMMANDS, withDrawProps } from '../src/cad/editor.js';
import { History, createDocument, addEntities } from '../src/cad/document.js';

const fakeEditor = (running, drawProps, doc = createDocument()) => {
    const ed = {
        running,
        drawProps,
        history: new History(doc),
        selection: new Set(),
        invalidate() {},
        onChange() {},
    };
    Object.defineProperty(ed, 'doc', { get: () => ed.history.present });
    Object.defineProperty(ed, 'drawing', { get: () => Object.getOwnPropertyDescriptor(Editor.prototype, 'drawing').get.call(ed) });
    ed.applyDrawProps = Editor.prototype.applyDrawProps.bind(ed);
    ed.commit = Editor.prototype.commit.bind(ed);
    return ed;
};
const line = (id, extra = {}) => ({ id, type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, ...extra });

test('LINE com cor escolhida antes: a linha nova já nasce vermelha, com tipo e espessura', () => {
    const ed = fakeEditor('LINE', { color: 1, lineType: 'DASHED', lineWeight: 50 });
    ed.commit('Linha', addEntities(ed.doc, [line('a')]));
    const [e] = ed.doc.entities;
    assert.equal(e.color, 1);
    assert.equal(e.lineType, 'DASHED');
    assert.equal(e.lineWeight, 50);
});

test('Propriedades de desenho não alteram objetos existentes nem cor explícita do comando', () => {
    const base = addEntities(createDocument(), [line('old')]);
    const ed = fakeEditor('HATCH', { color: 3, lineType: 'bylayer', lineWeight: 'bylayer' }, base);
    ed.commit('Hachura', addEntities(ed.doc, [line('n1'), line('n2', { color: 5 })]));
    const byId = Object.fromEntries(ed.doc.entities.map((e) => [e.id, e]));
    assert.equal(byId.old.color, 'bylayer');
    assert.equal(byId.n1.color, 3);
    assert.equal(byId.n2.color, 5);
});

test('Edições (COPY) preservam as propriedades da origem', () => {
    const ed = fakeEditor('COPY', { color: 1, lineType: 'bylayer', lineWeight: 'bylayer' });
    ed.commit('Copiar', addEntities(ed.doc, [line('c')]));
    assert.equal(ed.doc.entities[0].color, 'bylayer');
    assert.ok(!DRAW_COMMANDS.has('COPY'));
});

test('ByLayer nas propriedades de desenho mantém o comportamento anterior', () => {
    const e = line('x', { color: 'bylayer' });
    assert.equal(withDrawProps(e, { color: 'bylayer', lineType: 'bylayer', lineWeight: 'bylayer' }), e);
});

test('Painel Propriedades mostra cor, tipo e espessura durante o comando de desenho', () => {
    const content = readFileSync(resolve(process.cwd(), 'src/cad.js'), 'utf-8');
    assert.match(content, /if \(editor\.drawing\)/);
    for (const prop of ['layer', 'color', 'color-picker', 'lineType', 'lineWeight']) assert.match(content, new RegExp(`data-draw-prop="${prop}"`));
    assert.match(content, /editor\.setDrawProp\('color'/);
});

test('Opções de cota do comando vão para a cota nova e não mexem nas antigas nem no estilo do desenho', () => {
    const old = { id: 'old', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, linePoint: { x: 5, y: 5 } };
    const base = addEntities(createDocument(), [old]);
    const dimStyle = { arrowSize: 5, scale: 2, textHeight: 4, precision: 0, measurementScale: 3 };
    const ed = fakeEditor('DIMLINEAR', { color: 'bylayer', lineType: 'bylayer', lineWeight: 'bylayer', dimStyle }, base);
    ed.commit('Cota', addEntities(ed.doc, [{ ...old, id: 'new', textHeight: 9, scale: 7, measurementScale: 8 }]));
    const byId = Object.fromEntries(ed.doc.entities.map((e) => [e.id, e]));
    assert.equal(byId.old.style, undefined);
    assert.deepEqual(byId.new.style, dimStyle);
    // Campos de topo venceriam o style em dimensionStyle(): saem quando o painel define o valor.
    assert.equal(byId.new.textHeight, undefined);
    assert.equal(byId.new.scale, undefined);
    assert.equal(byId.new.measurementScale, 3);
    assert.equal(ed.doc.dimStyle, base.dimStyle);
});

test('Sem opções de cota escolhidas, a cota nova continua herdando o estilo do desenho', () => {
    const dim = { id: 'd', type: 'dimension', kind: 'horizontal', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, linePoint: { x: 5, y: 5 } };
    assert.equal(withDrawProps(dim, { color: 'bylayer', lineType: 'bylayer', lineWeight: 'bylayer', dimStyle: {} }), dim);
});
