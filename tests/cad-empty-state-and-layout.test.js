import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mocks de ambiente global para execução headless em Node
if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        innerWidth: 1280,
        innerHeight: 800,
        location: { search: '', href: 'https://example.com/cad', pathname: '/cad' },
        history: { replaceState() {} },
        addEventListener() {},
        removeEventListener() {},
        confirm: () => true,
        prompt: () => '',
    };
}
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => ({ content: 'csrf-token' }),
        createElement: (tag) => ({
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); },
                toggle(c, force) {
                    if (force === undefined) {
                        if (this._classes.has(c)) this._classes.delete(c);
                        else this._classes.add(c);
                    } else if (force) this._classes.add(c);
                    else this._classes.delete(c);
                },
            },
            setAttribute() {},
            getAttribute() { return null; },
            appendChild() {},
            querySelectorAll: () => [],
            addEventListener() {},
        }),
    };
}

import { TabManager } from '../src/cad.js';
import { createDocument, History } from '../src/cad/document.js';

function createMockElement(tag, dataset = {}) {
    const classes = new Set();
    const children = [];
    const listeners = {};
    const styles = {};
    return {
        tagName: tag.toUpperCase(),
        dataset,
        style: styles,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (classes.has(c)) classes.delete(c);
                    else classes.add(c);
                } else if (force) classes.add(c);
                else classes.delete(c);
            },
            contains: (c) => classes.has(c),
        },
        children,
        appendChild(child) {
            children.push(child);
            return child;
        },
        querySelector(selector) {
            if (selector.includes('data-cad-tab-add')) return children.find(c => c.dataset && 'cadTabAdd' in c.dataset);
            if (selector.includes('data-cad-tabs-list')) return children.find(c => c.dataset && 'cadTabsList' in c.dataset);
            if (selector.includes('data-cad-save-status')) return children.find(c => c.dataset && 'cadSaveStatus' in c.dataset);
            if (selector.includes('data-cad-doc-name')) return { textContent: '' };
            if (selector.includes('data-cad-entity-count')) return { textContent: '' };
            if (selector.includes('data-cad-coords')) return { textContent: '' };
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener(event, fn) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
        },
    };
}

function createTabManagerFixture() {
    const root = createMockElement('div', { storageScope: 'test-empty' });
    const list = createMockElement('div', { cadTabsList: '' });
    const status = createMockElement('span', { cadSaveStatus: '' });
    const addBtn = createMockElement('button', { cadTabAdd: '' });
    root.appendChild(list);
    root.appendChild(status);
    root.appendChild(addBtn);

    const doc = createDocument();
    const editor = {
        doc,
        history: new History(doc),
        selection: new Set(),
        terminal: { clear: () => {} },
        settings: {},
        getSession() {
            return { history: this.history, viewport: null, memory: {} };
        },
        setSession({ history }) {
            this.history = history;
            this.doc = history.present;
        },
        zoomExtents() {},
        render() {},
        log() {},
    };

    const manager = new TabManager(editor, root);
    editor.tabs = manager;
    return { root, list, addBtn, editor, manager };
}

test('TabManager: fechar a única aba aberta deixa tabs vazio e adiciona classe is-empty sem reabrir Sem título.dxf', () => {
    const { root, manager } = createTabManagerFixture();
    // Adiciona uma aba inicial
    const tab1 = manager.add({ ...createDocument(), name: 'Peca1.dxf' });
    assert.equal(manager.tabs.length, 1);
    assert.equal(root.classList.contains('is-empty'), false);

    // Fecha a única aba existente
    manager.close(tab1.id);

    assert.equal(manager.tabs.length, 0, 'Não deve restar nenhuma aba aberta');
    assert.equal(manager.activeId, null, 'activeId deve ser nulo');
    assert.equal(manager.current(), null, 'current() deve retornar null');
    assert.ok(root.classList.contains('is-empty'), 'Root deve conter classe is-empty');
});

test('TabManager: adicionar nova aba após estar vazio remove is-empty e ativa o documento', () => {
    const { root, manager } = createTabManagerFixture();
    const tab1 = manager.add({ ...createDocument(), name: 'Peca1.dxf' });
    manager.close(tab1.id);
    assert.equal(manager.tabs.length, 0);
    assert.ok(root.classList.contains('is-empty'));

    // Adiciona nova aba
    const tabNova = manager.add({ ...createDocument(), name: 'NovoDesenho.dxf' });
    assert.equal(manager.tabs.length, 1);
    assert.equal(manager.activeId, tabNova.id);
    assert.equal(root.classList.contains('is-empty'), false, 'Classe is-empty deve ser removida');
    assert.equal(manager.current().session.history.present.name, 'NovoDesenho.dxf');
});

test('cad.css: regras de tela cheia para .app-content e .container-fluid com !important', () => {
    const cssPath = resolve('src/styles/cad.css');
    const css = readFileSync(cssPath, 'utf8');

    // Verifica .app-main
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-main\s*\{[^}]*padding:\s*0\s*!important/s,
        'app-main deve ter padding: 0 !important para anular padding-bottom do AdminLTE'
    );
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-main\s*\{[^}]*height:\s*100vh\s*!important/s,
        'app-main deve ter height: 100vh !important'
    );

    // Verifica .app-content
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-content\s*\{[^}]*padding:\s*0\s*!important/s,
        'app-content deve ter padding: 0 !important'
    );
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-content\s*\{[^}]*height:\s*100%\s*!important/s,
        'app-content deve ter height: 100% !important para ocupar toda a altura de app-main'
    );

    // Verifica .container-fluid
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-content\s*>\s*\.container-fluid\s*\{[^}]*padding:\s*0\s*!important/s,
        'container-fluid deve ter padding: 0 !important'
    );
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-content\s*>\s*\.container-fluid\s*\{[^}]*height:\s*100%\s*!important/s,
        'container-fluid deve ter height: 100% !important'
    );
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-content\s*>\s*\.container-fluid\s*\{[^}]*margin:\s*0\s*!important/s,
        'container-fluid deve ter margin: 0 !important'
    );
    assert.match(
        css,
        /body:has\(\[data-cad-app\]\)\s+\.app-content\s*>\s*\.container-fluid\s*\{[^}]*max-width:\s*100%\s*!important/s,
        'container-fluid deve ter max-width: 100% !important'
    );
});

test('cad.css: estado vazio .cad-app.is-empty oculta workspace contents, terminal e statusbar', () => {
    const cssPath = resolve('src/styles/cad.css');
    const css = readFileSync(cssPath, 'utf8');

    assert.match(
        css,
        /\.cad-app\.is-empty\s+\.cad-workspace\s*>\s*(?:\*|:not\(\.cad-start\))\s*\{[^}]*display:\s*none\s*!important/s,
        '.cad-workspace > * deve ser display: none !important quando is-empty'
    );
    assert.match(
        css,
        /\.cad-app\.is-empty\s+\.cad-terminal\s*\{[^}]*display:\s*none\s*!important/s,
        '.cad-terminal deve ser display: none !important quando is-empty'
    );
    assert.match(
        css,
        /\.cad-app\.is-empty\s+\.cad-statusbar\s*\{[^}]*display:\s*none\s*!important/s,
        '.cad-statusbar deve ser display: none !important quando is-empty'
    );
});

test('cad.css: destaque do botão escolhido no aviso de fechar guia vence o reset de :focus', () => {
    const css = readFileSync(resolve('src/styles/cad.css'), 'utf8');
    const rule = css.match(/\.cad-app \.cad-confirm-modal \.cad-btn\.is-selected\s*\{([^}]*)\}/);
    assert.ok(rule, 'regra do botão selecionado ausente');
    assert.match(rule[1], /outline:[^;]*!important/);
    assert.match(rule[1], /box-shadow:[^;]*!important/);
});

test('WBLOCK: janela segue o tema do Traço e mantém o foco visível', () => {
    const css = readFileSync(resolve('src/styles/cad.css'), 'utf8');
    const box = css.match(/\.cad-wblock-dialog\s*\{([^}]*)\}/);
    assert.ok(box, 'regra da janela ausente');
    assert.match(box[1], /background:\s*var\(--cad-panel\)/);
    assert.match(box[1], /color:\s*var\(--cad-text\)/);
    const wblockRules = css.match(/\.cad-wblock[^{]*\{[^}]*\}/g).join('\n');
    assert.doesNotMatch(wblockRules, /#(?:18212f|0f172a|334155|64748b|475569)/i, 'cores fixas do tema escuro voltaram');
    const focus = css.match(/\.cad-app \.cad-wblock-dialog button:focus\s*\{([^}]*)\}/);
    assert.ok(focus, 'foco do botão ausente');
    assert.match(focus[1], /outline:[^;]*!important/);
    const js = readFileSync(resolve('src/cad/wblock-dialog.js'), 'utf8');
    assert.match(js, /querySelector\('\[data-cad-app\]'\)/, 'janela deve ser anexada dentro do .cad-app para herdar o tema');
});
