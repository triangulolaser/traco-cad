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
        invalidate() {},
        onChange() {},
    };

    Editor.prototype.bindEvents.call(editor);
    return { editor, listeners };
}

test('clique fora no vazio com seleção ativa desmarca a seleção anterior e arma imediatamente a nova seleção por área', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 10, y: 10 }, end: { x: 50, y: 10 } },
        { id: 'l2', type: 'line', start: { x: 100, y: 100 }, end: { x: 150, y: 100 } },
    ], ['l1']);

    assert.equal(editor.selection.has('l1'), true);

    // 1. Clique fora em ponto vazio (screen 300, 300)
    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });

    // A seleção anterior é desmarcada imediatamente e a janela de seleção é criada
    assert.equal(editor.selection.size, 0);
    assert.ok(editor.window);
    assert.equal(editor.window.armed, false);

    // 2. Soltar o clique sem arrasto arma a janela para modo clique-clique (como no AutoCAD)
    listeners.pointerup({ button: 0, clientX: 300, clientY: 300, pointerId: 1 });
    assert.ok(editor.window);
    assert.equal(editor.window.armed, true);

    // 3. Mover o cursor expande a janela de seleção
    listeners.pointermove({ clientX: 500, clientY: 500 });
    assert.ok(editor.window.b);

    // 4. Segundo clique conclui a janela de seleção
    listeners.pointerdown({ button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    listeners.pointerup({ button: 0, clientX: 500, clientY: 500, pointerId: 1 });

    // Janela é finalizada e limpa
    assert.equal(editor.window, null);
});

test('clique e arrasto no vazio com seleção ativa desmarca e seleciona os objetos na área arrastada', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: -200, y: -200 }, end: { x: -150, y: -200 } },
    ], ['l1']);

    assert.equal(editor.selection.has('l1'), true);

    // 1. Pressionar no vazio
    listeners.pointerdown({ button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    assert.equal(editor.selection.size, 0);
    assert.ok(editor.window);

    // 2. Arrastar além de DRAG_PIXELS (4px)
    listeners.pointermove({ clientX: 250, clientY: 250 });

    // 3. Soltar finaliza imediatamente a janela de seleção por arrasto
    listeners.pointerup({ button: 0, clientX: 250, clientY: 250, pointerId: 1 });
    assert.equal(editor.window, null);
});

test('shift-clique no vazio preserva a seleção anterior e arma a janela para seleção/remoção', () => {
    const { editor, listeners } = createMockEditor([
        { id: 'l1', type: 'line', start: { x: 10, y: 10 }, end: { x: 50, y: 10 } },
    ], ['l1']);

    // Pressionar no vazio com shift pressionado
    listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, pointerId: 1, shiftKey: true });

    // A seleção anterior NÃO é limpa
    assert.equal(editor.selection.has('l1'), true);
    assert.ok(editor.window);

    listeners.pointerup({ button: 0, clientX: 300, clientY: 300, pointerId: 1, shiftKey: true });
    assert.equal(editor.window.armed, true);
    assert.equal(editor.selection.has('l1'), true);
});

test('botão direito cancela janela de seleção armada sem afetar o estado ocioso', () => {
    const { editor } = createMockEditor();

    editor.window = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, armed: true };
    editor.onRightClick();

    assert.equal(editor.window, null);
});
