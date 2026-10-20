import test from 'node:test';
import assert from 'node:assert/strict';

// Mocks de ambiente global para execução headless em Node
if (typeof globalThis.window === 'undefined') {
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
}
if (typeof globalThis.document === 'undefined') {
    globalThis.document = { addEventListener() {}, removeEventListener() {} };
}

import { Editor } from '../src/cad/editor.js';
import { Viewport } from '../src/cad/viewport.js';
import { createDocument, addEntities } from '../src/cad/document.js';

function createMockEditor(initialEntities = [], initialSelectedIds = []) {
    const listeners = {};
    const canvas = {
        addEventListener: (type, fn) => { listeners[type] = fn; },
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        classList: { add() {}, remove() {}, toggle() {} },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };

    const doc = addEntities(createDocument(), initialEntities);
    const editor = {
        canvas,
        viewport: new Viewport(800, 600),
        doc,
        selection: new Set(initialSelectedIds),
        pending: null,
        activeGrip: null,
        hoverGrip: null,
        window: null,
        pointer: { down: null, button: null, panning: false, last: null, moved: false },
        panActive: false,
        settings: { snaps: {} },
        terminal: { focus() {} },
        eventScreen: Editor.prototype.eventScreen,
        hitTest: Editor.prototype.hitTest,
        entitiesInWindow: Editor.prototype.entitiesInWindow,
        finishWindow: Editor.prototype.finishWindow,
        clearSelection: Editor.prototype.clearSelection,
        onClick: Editor.prototype.onClick,
        onRightClick: Editor.prototype.onRightClick,
        updateSnap() {},
        updateHoverGrip() {},
        invalidate() {},
        onChange() {},
    };

    Editor.prototype.bindEvents.call(editor);
    return { editor, listeners };
}

test('clique fora no vazio com seleção ativa mantém a seleção e arma a caixa clique-clique', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 10, y: 10 }, end: { x: 50, y: 10 } },
        { id: 'l2', type: 'line', start: { x: 100, y: 100 }, end: { x: 150, y: 100 } },
    ], ['l1']);

    assert.equal(editor.selection.has('l1'), true);

    // 1. Clique fora em ponto vazio (screen 300, 300)
    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });

    // A seleção só é desmarcada ao soltar sem arrasto; a janela já é criada no pressionar
    assert.equal(editor.selection.has('l1'), true);
    assert.ok(editor.window);
    assert.equal(editor.window.armed, false);

    // 2. Soltar o clique sem arrasto arma a janela clique-clique sem perder a seleção
    listeners.pointerup({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    assert.equal(editor.selection.has('l1'), true);
    assert.ok(editor.window);
    assert.equal(editor.window.armed, true);

    // 3. Mover o cursor expande a janela de seleção
    listeners.pointermove({ clientX: 500, clientY: 500 });
    assert.ok(editor.window.b);

    // 4. Segundo clique conclui a janela de seleção
    listeners.pointerdown({ button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: 500, clientY: 500, pointerId: 1 });

    // Janela é finalizada sem perder a seleção
    assert.equal(editor.window, null);
    assert.equal(editor.selection.has('l1'), true);
});

test('clique e arrasto no vazio com seleção ativa soma os objetos da área à seleção anterior', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: -200, y: -200 }, end: { x: -150, y: -200 } },
    ], ['l1']);

    assert.equal(editor.selection.has('l1'), true);

    // 1. Pressionar no vazio não perde a seleção anterior
    listeners.pointerdown({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    assert.equal(editor.selection.has('l1'), true);
    assert.ok(editor.window);

    // 2. Arrastar além de DRAG_PIXELS (4px)
    listeners.pointermove({ clientX: 250, clientY: 250 });

    // 3. Soltar mantém a janela aberta (como no BricsCAD); o próximo clique conclui
    listeners.pointerup({ button: 0, clientX: 250, clientY: 250, pointerId: 1 });
    assert.ok(editor.window);
    assert.equal(editor.window.armed, true);
    listeners.pointermove({ clientX: 300, clientY: 300 });
    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    assert.equal(editor.window, null);
    assert.equal(editor.selection.has('l1'), true);
});

test('ctrl-clique no vazio preserva a seleção anterior e arma a janela para seleção/remoção', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 10, y: 10 }, end: { x: 50, y: 10 } },
    ], ['l1']);

    // Pressionar no vazio com Ctrl pressionado
    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, pointerId: 1, ctrlKey: true });

    // A seleção anterior NÃO é limpa
    assert.equal(editor.selection.has('l1'), true);
    assert.ok(editor.window);

    listeners.pointerup({ button: 0, clientX: 300, clientY: 300, pointerId: 1, ctrlKey: true });
    assert.equal(editor.window.armed, true);
    assert.equal(editor.selection.has('l1'), true);
});

test('botão direito cancela janela de seleção armada sem afetar o estado ocioso', () => {
    const { editor } = createMockEditor();

    editor.window = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, armed: true };
    editor.onRightClick();

    assert.equal(editor.window, null);
});

test('tremor de até 10 px no primeiro clique ainda arma a janela clique-clique', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: -200, y: -200 }, end: { x: -150, y: -200 } },
    ]);

    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    listeners.pointermove({ clientX: 306, clientY: 305 });
    listeners.pointerup({ button: 0, clientX: 306, clientY: 305, pointerId: 1 });

    assert.ok(editor.window);
    assert.equal(editor.window.armed, true);
});

test('arrastar a partir de cima de um objeto abre a janela; clique parado seleciona só o objeto', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { id: 'l2', type: 'line', start: { x: 10, y: 20 }, end: { x: 100, y: 20 } },
    ]);
    const on = editor.viewport.worldToScreen({ x: 50, y: 0 });
    const far = editor.viewport.worldToScreen({ x: 150, y: 40 });

    listeners.pointerdown({ button: 0, clientX: on.x, clientY: on.y, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: on.x + 2, clientY: on.y, pointerId: 1 });
    assert.equal(editor.window, null);
    assert.deepEqual([...editor.selection], ['l1']);

    editor.selection.clear();
    const s2 = editor.viewport.worldToScreen({ x: 1, y: 0 });
    listeners.pointerdown({ button: 0, clientX: s2.x, clientY: s2.y, pointerId: 1 });
    assert.ok(editor.window);
    listeners.pointermove({ clientX: far.x, clientY: far.y });
    listeners.pointerup({ button: 0, clientX: far.x, clientY: far.y, pointerId: 1 });
    assert.equal(editor.window.armed, true);
    listeners.pointerdown({ button: 0, clientX: far.x, clientY: far.y, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: far.x, clientY: far.y, pointerId: 1 });
    assert.equal(editor.window, null);
    assert.equal(editor.selection.has('l2'), true);
});

test('clique em objeto seguido de janela arrastada mantém o objeto e soma os da janela', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        { id: 'l2', type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    ]);
    const a = editor.viewport.screenToWorld({ x: 100, y: 100 });
    const b = editor.viewport.screenToWorld({ x: 200, y: 200 });
    editor.doc.entities.find((e) => e.id === 'l2').start = { x: Math.min(a.x, b.x) + (b.x - a.x) * 0.25, y: (a.y + b.y) / 2 };
    editor.doc.entities.find((e) => e.id === 'l2').end = { x: Math.min(a.x, b.x) + (b.x - a.x) * 0.75, y: (a.y + b.y) / 2 };
    editor.selection.add('l1');

    listeners.pointerdown({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    listeners.pointermove({ clientX: 200, clientY: 200 });
    listeners.pointerup({ button: 0, clientX: 200, clientY: 200, pointerId: 1 });
    listeners.pointerdown({ button: 0, clientX: 200, clientY: 200, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: 200, clientY: 200, pointerId: 1 });

    assert.equal(editor.window, null);
    assert.deepEqual([...editor.selection].sort(), ['l1', 'l2']);
});

test('caixa clique-clique soma à seleção anterior', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        { id: 'l2', type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    ], ['l1']);
    const a = editor.viewport.screenToWorld({ x: 100, y: 100 });
    const b = editor.viewport.screenToWorld({ x: 200, y: 200 });
    const l2 = editor.doc.entities.find((e) => e.id === 'l2');
    l2.start = { x: a.x + (b.x - a.x) * 0.25, y: (a.y + b.y) / 2 };
    l2.end = { x: a.x + (b.x - a.x) * 0.75, y: (a.y + b.y) / 2 };

    listeners.pointerdown({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    assert.equal(editor.selection.has('l1'), true);
    listeners.pointermove({ clientX: 200, clientY: 200 });
    listeners.pointerdown({ button: 0, clientX: 200, clientY: 200, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: 200, clientY: 200, pointerId: 1 });

    assert.equal(editor.window, null);
    assert.deepEqual([...editor.selection].sort(), ['l1', 'l2']);
});

test('ctrl (ou cmd) alterna: tira o selecionado e põe o não selecionado; shift não tira', () => {
    const { editor } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { id: 'l2', type: 'line', start: { x: 0, y: 50 }, end: { x: 10, y: 50 } },
    ], ['l1']);
    editor.onClick({ x: 5, y: 0 }, { shiftKey: true });
    assert.equal(editor.selection.has('l1'), true);
    editor.onClick({ x: 5, y: 0 }, { ctrlKey: true });
    assert.equal(editor.selection.has('l1'), false);
    editor.onClick({ x: 5, y: 50 }, { metaKey: true });
    assert.equal(editor.selection.has('l2'), true);
    editor.selection = new Set(['l1']);
    editor.window = { a: { x: -1, y: -1 }, idle: true };
    editor.finishWindow({ x: 11, y: 51 }, { shiftKey: true });
    assert.deepEqual([...editor.selection].sort(), ['l1', 'l2']);
    editor.selection = new Set(['l1']);
    editor.window = { a: { x: -1, y: -1 }, idle: true };
    editor.finishWindow({ x: 11, y: 51 }, { ctrlKey: true });
    assert.deepEqual([...editor.selection], ['l2']);
});

test('trocar de aba com a caixa clique-clique armada descarta a caixa', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 10, y: 10 }, end: { x: 50, y: 10 } },
    ]);
    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    assert.equal(editor.window?.armed, true);

    Editor.prototype.setSession.call(editor, { history: { present: editor.doc }, viewport: null });
    assert.equal(editor.window, null);

    // O clique seguinte na outra aba volta a abrir uma caixa nova, não fecha a antiga.
    listeners.pointerdown({ button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    assert.equal(editor.window?.armed, false);
    assert.deepEqual(editor.selection, new Set());
});
