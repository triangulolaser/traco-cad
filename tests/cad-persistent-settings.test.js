import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCadSettings, saveCadSettings, CAD_SETTINGS_KEY } from '../src/cad/storage.js';
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

test('storage: saveCadSettings e loadCadSettings persistem e restauram configurações com tipos corretos', () => {
    const storage = createMockStorage();

    const settingsToSave = {
        grid: false,
        ortho: true,
        softAxis: false,
        polar: false,
        polarIncrement: 30,
        osnap: false,
        otrack: false,
        snaps: { end: true, mid: false, cen: true, int: false, qua: false, per: true, tan: false, nea: false },
    };

    saveCadSettings(settingsToSave, storage);

    const loaded = loadCadSettings(storage);
    assert.ok(loaded);
    assert.equal(loaded.grid, false);
    assert.equal(loaded.ortho, true);
    assert.equal(loaded.softAxis, false);
    assert.equal(loaded.polar, false);
    assert.equal(loaded.polarIncrement, 30);
    assert.equal(loaded.osnap, false);
    assert.equal(loaded.otrack, false);
    assert.equal(loaded.snaps.mid, false);
    assert.equal(loaded.snaps.per, true);
    assert.equal(loaded.snaps.tan, false);
});

test('editor: toggle e setSnapMode persistem no localStorage e mantêm valores ao recriar editor', () => {
    const storage = createMockStorage();

    const root1 = createMockCadRoot();
    const editor1 = new Editor(root1, { storage });

    // Verifica defaults iniciais
    assert.equal(editor1.settings.grid, true);
    assert.equal(editor1.settings.ortho, false);
    assert.equal(editor1.settings.snaps.end, true);

    // 1. Modifica configurações: desliga grade, liga orto e desliga snap 'nea'
    editor1.toggle('grid'); // grid vira false
    assert.equal(editor1.settings.grid, false);

    editor1.toggle('ortho'); // ortho vira true, polar vira false
    assert.equal(editor1.settings.ortho, true);
    assert.equal(editor1.settings.polar, false);

    editor1.setSnapMode('nea', false);
    assert.equal(editor1.settings.snaps.nea, false);

    // 2. Simula recarregar a página instanciando um novo Editor com o mesmo storage
    const root2 = createMockCadRoot();
    const editor2 = new Editor(root2, { storage });

    // As configurações devem ter sido restauradas fielmente
    assert.equal(editor2.settings.grid, false, 'Grade deve permanecer desligada ao recarregar');
    assert.equal(editor2.settings.ortho, true, 'Orto deve permanecer ligado ao recarregar');
    assert.equal(editor2.settings.polar, false, 'Polar deve permanecer desligado ao recarregar');
    assert.equal(editor2.settings.snaps.nea, false, 'Snap NEA deve permanecer desmarcado ao recarregar');
    assert.equal(editor2.settings.snaps.end, true, 'Snap END deve permanecer ativo');
});

test('editor: alternar polar desativa ortho e persiste ambas as mudanças', () => {
    const storage = createMockStorage();

    const root = createMockCadRoot();
    const editor = new Editor(root, { storage });

    // Liga orto
    editor.toggle('ortho');
    assert.equal(editor.settings.ortho, true);
    assert.equal(editor.settings.polar, false);

    // Agora liga polar: orto deve desligar automaticamente e persistir
    editor.toggle('polar');
    assert.equal(editor.settings.polar, true);
    assert.equal(editor.settings.ortho, false);

    // Recarrega
    const editorReloaded = new Editor(createMockCadRoot(), { storage });
    assert.equal(editorReloaded.settings.polar, true);
    assert.equal(editorReloaded.settings.ortho, false);
});

test('ui: configurações restauradas no boot alimentam estado inicial de grade, orto e snaps', () => {
    const storage = createMockStorage();
    // Salva estado prévio: grade desligada, orto ligado, snap mid desligado
    saveCadSettings({
        grid: false,
        ortho: true,
        polar: false,
        osnap: true,
        snaps: { end: true, mid: false, cen: true, tan: false },
    }, storage);

    const editor = new Editor(createMockCadRoot(), { storage });

    assert.equal(editor.settings.grid, false, 'Grade inicia desligada');
    assert.equal(editor.settings.ortho, true, 'Orto inicia ligado');
    assert.equal(editor.settings.snaps.mid, false, 'Snap MID inicia desligado');
    assert.equal(editor.settings.snaps.tan, false, 'Snap TAN inicia desligado');
    assert.equal(editor.settings.snaps.end, true, 'Snap END inicia ligado');
});

