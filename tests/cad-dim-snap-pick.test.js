import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/cad/editor.js';

if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        addEventListener() {},
        removeEventListener() {},
        history: { replaceState() {} },
    };
}

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        createElement() {
            return { textContent: '', appendChild() {}, className: '', style: {}, setAttribute() {} };
        },
    };
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = () => {};
}


// Mock de Storage em memória isolado
function createMockStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        _raw: store,
    };
}

// Mock de DOM mínimo para instanciar o Editor sem erros em Node.js
function createMockCadRoot() {
    const stage = {
        getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0 }),
    };
    const canvas = {
        width: 800,
        height: 600,
        style: {},
        getContext: () => ({
            save: () => {},
            restore: () => {},
            clearRect: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {},
            fill: () => {},
            arc: () => {},
            rect: () => {},
            fillText: () => {},
            strokeText: () => {},
            setLineDash: () => {},
            scale: () => {},
            translate: () => {},
        }),
        addEventListener: () => {},
        removeEventListener: () => {},
    };

    const historyEl = {
        children: [],
        appendChild(el) { this.children.push(el); },
        removeChild(el) { const idx = this.children.indexOf(el); if (idx >= 0) this.children.splice(idx, 1); },
        get firstChild() { return this.children[0] ?? null; },
        scrollTop: 0,
        scrollHeight: 0,
    };
    const inputEl = { addEventListener: () => {}, focus: () => {}, setAttribute: () => {}, value: '' };
    const promptEl = { textContent: '' };

    const terminalContainer = {
        addEventListener: () => {},
        querySelector: (selector) => {
            if (selector === '[data-cad-terminal-history]') return historyEl;
            if (selector === '[data-cad-terminal-input]') return inputEl;
            if (selector === '[data-cad-terminal-prompt]') return promptEl;
            return null;
        },
    };

    const classList = new Set();

    const root = {
        dataset: {},
        classList: {
            add: (c) => classList.add(c),
            remove: (c) => classList.delete(c),
            contains: (c) => classList.has(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (classList.has(c)) classList.delete(c);
                    else classList.add(c);
                } else if (force) classList.add(c);
                else classList.delete(c);
            },
        },
        querySelector: (selector) => {
            if (selector === '[data-cad-stage]') return stage;
            if (selector === '[data-cad-canvas]') return canvas;
            if (selector === '[data-cad-terminal]') return terminalContainer;
            if (selector === '[data-cad-terminal-history]') return historyEl;
            if (selector === '[data-cad-terminal-input]') return inputEl;
            if (selector === '[data-cad-terminal-prompt]') return promptEl;
            if (selector === '[data-cad-file-input]') return null;
            return null;
        },
        querySelectorAll: () => [],
    };

    return root;
}


// Regressão: no DIM, clicar sobre a linha (pointOrEntity) devolvia a mira crua,
// ignorando o snap; o 1º ponto da cota "fugia" do extremo (80 virava 79.9).
test('pointOrEntity sobre a entidade devolve o ponto do snap de extremidade', async () => {
    const editor = new Editor(createMockCadRoot(), { storage: createMockStorage() });
    editor.settings.osnap = true;
    editor.settings.snaps = { ...editor.settings.snaps, end: true };
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 80, y: 0 }, layer: editor.doc.currentLayer };
    editor.doc.entities.push(line);
    const pending = editor.getPointOrEntity('Primeiro ponto da cota');
    const near = { x: 0.1, y: 0 };
    editor.cursorWorld = near;
    editor.updateSnap();
    assert.ok(editor.snap, 'snap de extremidade deveria estar ativo');
    editor.onClick(near, { shiftKey: false });
    const res = await pending;
    assert.equal(res.entity?.id, 'l1');
    assert.deepEqual(res.point, { x: 0, y: 0 });
    assert.deepEqual(res.pickPoint, near);
});
