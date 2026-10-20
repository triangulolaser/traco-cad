import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Mocks de ambiente global para execução headless em Node
if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        innerWidth: 1280,
        innerHeight: 800,
        addEventListener() {},
        removeEventListener() {},
        confirm: () => true,
        prompt: () => 'Novo Nome.dxf',
    };
}
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
        createElement(tag) {
            return createMockElement(tag);
        },
    };
}

import { TabManager } from '../src/cad.js';
import { createDocument, addEntities, History } from '../src/cad/document.js';

function createMockElement(tagName = 'div', dataset = {}) {
    const listeners = {};
    const attributes = {};
    const children = [];
    const classes = new Set();
    const el = {
        tagName: tagName.toUpperCase(),
        dataset: { ...dataset },
        className: '',
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
        style: {},
        set innerHTML(html) {
            this._innerHTML = html;
            this.children.length = 0;
            const buttonRegex = /<button[^>]*data-action="([^"]+)"[^>]*>/g;
            let m;
            while ((m = buttonRegex.exec(html)) !== null) {
                const btn = createMockElement('button', { action: m[1] });
                btn.setAttribute('data-action', m[1]);
                this.appendChild(btn);
            }
        },
        get innerHTML() {
            return this._innerHTML || '';
        },
        hidden: false,
        disabled: false,
        children,
        childNodes: children,
        addEventListener(type, fn) {
            listeners[type] = listeners[type] || [];
            listeners[type].push(fn);
        },
        dispatchEvent(event) {
            const fns = listeners[event.type] || [];
            fns.forEach((fn) => fn(event));
        },
        trigger(type, eventObj = {}) {
            const evt = { type, stopPropagation() {}, preventDefault() {}, ...eventObj };
            this.dispatchEvent(evt);
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] ?? null;
        },
        querySelectorAll(selector) {
            const matches = [];
            const check = (node) => {
                if (selector.startsWith('[data-action="')) {
                    const act = selector.match(/\[data-action="([^"]+)"\]/)?.[1];
                    if (node.dataset?.action === act) matches.push(node);
                } else if (selector.startsWith('[data-cad-tab-context-menu]')) {
                    if (node.dataset && 'cadTabContextMenu' in node.dataset) matches.push(node);
                    if (node.hasAttribute && node.hasAttribute('data-cad-tab-context-menu')) matches.push(node);
                } else if (selector === '[data-action]') {
                    if (node.dataset?.action) matches.push(node);
                } else if (selector === '[data-cad-tabs-list]') {
                    if (node.dataset && 'cadTabsList' in node.dataset) matches.push(node);
                } else if (selector === '[data-cad-save-status]') {
                    if (node.dataset && 'cadSaveStatus' in node.dataset) matches.push(node);
                } else if (selector === '[data-cad-tab-add]') {
                    if (node.dataset && 'cadTabAdd' in node.dataset) matches.push(node);
                } else if (selector === '.cad-tab') {
                    if (node.className && node.className.includes('cad-tab')) matches.push(node);
                }
                for (const child of node.children || []) check(child);
            };
            for (const child of children) check(child);
            return matches;
        },
        appendChild(child) {
            children.push(child);
            child.parentElement = this;
            return child;
        },
        setAttribute(k, v) {
            attributes[k] = String(v);
            if (k === 'hidden') this.hidden = true;
        },
        removeAttribute(k) {
            delete attributes[k];
            if (k === 'hidden') this.hidden = false;
        },
        hasAttribute(k) {
            return k in attributes;
        },
        getAttribute(k) {
            return attributes[k];
        },
        contains(target) {
            if (target === this) return true;
            for (const c of children) {
                if (c === target || (c.contains && c.contains(target))) return true;
            }
            return false;
        },
        getBoundingClientRect() {
            return { left: 100, top: 50, width: 190, height: 220 };
        },
    };
    return el;
}

function createMockEditor() {
    let doc = createDocument();
    let session = { history: new History(doc), viewport: null, memory: {} };
    return {
        get doc() { return session.history.present; },
        get history() { return session.history; },
        getSession: () => session,
        setSession: (s) => { session = s; },
        zoomExtents: () => {},
        setDocumentName: (name) => { session.history.present.name = name; },
        log: () => {},
    };
}

function createTabManagerFixture() {
    const root = createMockElement('div', { storageScope: 'test' });
    const list = createMockElement('div', { cadTabsList: '' });
    const status = createMockElement('span', { cadSaveStatus: '' });
    const addBtn = createMockElement('button', { cadTabAdd: '' });
    root.appendChild(list);
    root.appendChild(status);
    root.appendChild(addBtn);

    const editor = createMockEditor();
    const manager = new TabManager(editor, root);
    // Aba inicial
    manager.tabs.push({ id: manager.nextId++, session: editor.getSession() });
    manager.activeId = manager.tabs[0].id;
    manager.render();
    return { root, list, status, addBtn, editor, manager };
}

// ---------------------------------------------------------------------------
// 1. Validação Declarativa dos Arquivos do Projeto (Blade, Desktop HTML e CSS)

test('Blade view e Desktop HTML contêm o menu de contexto de abas com todas as ações necessárias', () => {
    const bladePath = resolve('index.html');
    const desktopPath = resolve('index.html');

    assert.ok(existsSync(desktopPath), 'cad-desktop/index.html deve existir');
    const desktopContent = readFileSync(desktopPath, 'utf8');

    const expectedActions = ['close', 'close-others', 'close-right', 'close-left', 'close-all', 'duplicate', 'rename', 'new'];

    if (existsSync(bladePath)) {
        const bladeContent = readFileSync(bladePath, 'utf8');
        expectedActions.forEach((action) => {
            assert.ok(
                bladeContent.includes(`data-action="${action}"`),
                `Ação "${action}" deve existir no menu de contexto do Blade`
            );
        });
        assert.ok(bladeContent.includes('data-cad-tab-context-menu'), 'Atributo data-cad-tab-context-menu presente no Blade');
    }

    expectedActions.forEach((action) => {
        assert.ok(
            desktopContent.includes(`data-action="${action}"`),
            `Ação "${action}" deve existir no menu de contexto do Desktop HTML`
        );
    });

    assert.ok(desktopContent.includes('data-cad-tab-context-menu'), 'Atributo data-cad-tab-context-menu presente no Desktop HTML');
});

test('cad.css contém regras completas de estilo para o menu de contexto de abas', () => {
    const cssPath = resolve('src/styles/cad.css');
    assert.ok(existsSync(cssPath), 'resources/css/cad.css deve existir');

    const cssContent = readFileSync(cssPath, 'utf8');
    assert.ok(cssContent.includes('.cad-tab-context-menu'), 'Classe .cad-tab-context-menu definida');
    assert.ok(cssContent.includes('.cad-tab-context-item'), 'Classe .cad-tab-context-item definida');
    assert.ok(cssContent.includes('.cad-tab-context-separator'), 'Classe .cad-tab-context-separator definida');
    assert.ok(cssContent.includes('.cad-tab-context-item:disabled'), 'Regra para item desabilitado definida');
});

// ---------------------------------------------------------------------------
// 2. Testes de Unidade Funcionais do TabManager

test('TabManager adiciona novas abas e ativa corretamente', () => {
    const { manager } = createTabManagerFixture();
    assert.equal(manager.tabs.length, 1);

    const doc2 = { ...createDocument(), name: 'Peça 2.dxf' };
    const tab2 = manager.add(doc2);

    assert.equal(manager.tabs.length, 2);
    assert.equal(manager.activeId, tab2.id);
    assert.equal(manager.current().id, tab2.id);
});

test('close(id) fecha uma aba específica e ativa vizinho remanescente', () => {
    const { manager } = createTabManagerFixture();
    const tab2 = manager.add({ ...createDocument(), name: 'Aba 2.dxf' });
    const tab3 = manager.add({ ...createDocument(), name: 'Aba 3.dxf' });

    assert.equal(manager.tabs.length, 3);
    assert.equal(manager.activeId, tab3.id);

    // Fechar a aba 3 (ativa): deve ativar a aba 2
    manager.close(tab3.id);
    assert.equal(manager.tabs.length, 2);
    assert.equal(manager.activeId, tab2.id);
    assert.equal(manager.tabs.some((t) => t.id === tab3.id), false);
});

test('close(id) de aba inativa redesenha a barra e mantém a aba ativa', () => {
    const { manager } = createTabManagerFixture();
    const first = manager.tabs[0];
    const active = manager.add({ ...createDocument(), name: 'Sem título.dxf' });
    let renders = 0;
    const render = manager.render.bind(manager);
    manager.render = () => { renders += 1; render(); };

    manager.close(first.id);

    assert.equal(manager.activeId, active.id);
    assert.deepEqual(manager.tabs.map((t) => t.id), [active.id]);
    assert.ok(renders > 0, 'a barra de abas precisa ser redesenhada sem a aba fechada');
});

test('closeToTheRight(targetId) fecha apenas as abas localizadas à direita do alvo', () => {
    const { manager } = createTabManagerFixture();
    const tab1 = manager.tabs[0];
    const tab2 = manager.add({ ...createDocument(), name: 'Aba 2.dxf' });
    const tab3 = manager.add({ ...createDocument(), name: 'Aba 3.dxf' });
    const tab4 = manager.add({ ...createDocument(), name: 'Aba 4.dxf' });

    assert.equal(manager.tabs.length, 4);

    // Fechar à direita da aba 2 (deve fechar abas 3 e 4, mantendo 1 e 2)
    manager.closeToTheRight(tab2.id);

    assert.equal(manager.tabs.length, 2);
    assert.deepEqual(manager.tabs.map((t) => t.id), [tab1.id, tab2.id]);
    assert.equal(manager.activeId, tab2.id);
});

test('closeToTheLeft(targetId) fecha apenas as abas localizadas à esquerda do alvo', () => {
    const { manager } = createTabManagerFixture();
    const tab1 = manager.tabs[0];
    const tab2 = manager.add({ ...createDocument(), name: 'Aba 2.dxf' });
    const tab3 = manager.add({ ...createDocument(), name: 'Aba 3.dxf' });
    const tab4 = manager.add({ ...createDocument(), name: 'Aba 4.dxf' });

    assert.equal(manager.tabs.length, 4);

    // Fechar à esquerda da aba 3 (deve fechar abas 1 e 2, mantendo 3 e 4)
    manager.closeToTheLeft(tab3.id);

    assert.equal(manager.tabs.length, 2);
    assert.deepEqual(manager.tabs.map((t) => t.id), [tab3.id, tab4.id]);
    assert.equal(manager.activeId, tab3.id);
});

test('closeOthers(targetId) fecha todas as outras abas e mantém o alvo ativo', () => {
    const { manager } = createTabManagerFixture();
    const tab2 = manager.add({ ...createDocument(), name: 'Aba 2.dxf' });
    manager.add({ ...createDocument(), name: 'Aba 3.dxf' });
    manager.add({ ...createDocument(), name: 'Aba 4.dxf' });

    assert.equal(manager.tabs.length, 4);

    // Fechar outras em relação à aba 2
    manager.closeOthers(tab2.id);

    assert.equal(manager.tabs.length, 1);
    assert.equal(manager.tabs[0].id, tab2.id);
    assert.equal(manager.activeId, tab2.id);
});

test('closeAll() fecha todas as abas e deixa o estado vazio sem reabrir Sem título.dxf', () => {
    const { manager, root } = createTabManagerFixture();
    manager.add({ ...createDocument(), name: 'Aba 2.dxf' });
    manager.add({ ...createDocument(), name: 'Aba 3.dxf' });

    assert.equal(manager.tabs.length, 3);

    manager.closeAll();

    assert.equal(manager.tabs.length, 0, 'Não deve restar nenhuma aba aberta');
    assert.equal(manager.activeId, null, 'activeId deve ser null');
    assert.equal(manager.current(), null, 'Nenhum documento deve estar ativo');
    assert.ok(root.classList.contains('is-empty'), 'Root deve conter classe is-empty quando todas as abas forem fechadas');
});

test('duplicate(targetId) clona o documento em uma nova aba com sufixo (cópia)', () => {
    const { manager } = createTabManagerFixture();
    const initialTab = manager.tabs[0];
    initialTab.session.history.present.name = 'Chapa Laser.dxf';
    initialTab.session.history.present.entities = [{ type: 'LINE', id: 'l1', x1: 0, y1: 0, x2: 100, y2: 0 }];

    const dupTab = manager.duplicate(initialTab.id);

    assert.equal(manager.tabs.length, 2);
    assert.equal(manager.activeId, dupTab.id);
    assert.equal(dupTab.session.history.present.name, 'Chapa Laser (cópia).dxf');
    assert.equal(dupTab.session.history.present.entities.length, 1);
    assert.equal(dupTab.session.history.present.entities[0].id, 'l1');
});

test('rename(targetId) altera o nome da aba ativa e atualiza o histórico', () => {
    const { manager } = createTabManagerFixture();
    const tab1 = manager.tabs[0];

    const oldPrompt = globalThis.window.prompt;
    globalThis.window.prompt = () => 'Peça Usinada Final.dxf';
    try {
        manager.rename(tab1.id);
        assert.equal(tab1.session.history.present.name, 'Peça Usinada Final.dxf');
    } finally {
        globalThis.window.prompt = oldPrompt;
    }
});

test('showContextMenu ajusta botões desabilitados dependendo da posição da aba', () => {
    const { manager } = createTabManagerFixture();
    const tab1 = manager.tabs[0];

    // Com apenas 1 aba: close-others, close-right e close-left devem estar desabilitados
    manager.showContextMenu({ clientX: 150, clientY: 40, preventDefault() {}, stopPropagation() {} }, tab1.id);
    const menu = manager.getOrCreateContextMenu();

    assert.equal(menu.querySelector('[data-action="close-others"]').disabled, true);
    assert.equal(menu.querySelector('[data-action="close-right"]').disabled, true);
    assert.equal(menu.querySelector('[data-action="close-left"]').disabled, true);

    // Adicionar mais abas
    const tab2 = manager.add({ ...createDocument(), name: 'Aba 2.dxf' });
    const tab3 = manager.add({ ...createDocument(), name: 'Aba 3.dxf' });

    // Clicar com botão direito na aba 1 (primeira à esquerda: close-left disabled, close-right enabled)
    manager.showContextMenu({ clientX: 100, clientY: 40, preventDefault() {}, stopPropagation() {} }, tab1.id);
    assert.equal(menu.querySelector('[data-action="close-others"]').disabled, false);
    assert.equal(menu.querySelector('[data-action="close-right"]').disabled, false);
    assert.equal(menu.querySelector('[data-action="close-left"]').disabled, true);

    // Clicar com botão direito na aba 2 (do meio: close-left enabled, close-right enabled)
    manager.showContextMenu({ clientX: 200, clientY: 40, preventDefault() {}, stopPropagation() {} }, tab2.id);
    assert.equal(menu.querySelector('[data-action="close-others"]').disabled, false);
    assert.equal(menu.querySelector('[data-action="close-right"]').disabled, false);
    assert.equal(menu.querySelector('[data-action="close-left"]').disabled, false);

    // Clicar com botão direito na aba 3 (última à direita: close-right disabled, close-left enabled)
    manager.showContextMenu({ clientX: 300, clientY: 40, preventDefault() {}, stopPropagation() {} }, tab3.id);
    assert.equal(menu.querySelector('[data-action="close-others"]').disabled, false);
    assert.equal(menu.querySelector('[data-action="close-right"]').disabled, true);
    assert.equal(menu.querySelector('[data-action="close-left"]').disabled, false);
});

test('Proteção de abas com modificações não salvas respeita confirmação do usuário', () => {
    const { manager } = createTabManagerFixture();
    const tab1 = manager.tabs[0];
    tab1.session.history.present.entities = [{ type: 'LINE', id: 'l1', x1: 0, y1: 0, x2: 50, y2: 50 }];

    const tab2 = manager.add({ ...createDocument(), name: 'Aba Limpa.dxf' });

    // Caso 1: Usuário cancela o fechamento da aba suja
    const oldConfirm = globalThis.window.confirm;
    globalThis.window.confirm = () => false; // Cancela
    try {
        manager.close(tab1.id);
        // Aba 1 não deve ser fechada pois o usuário cancelou
        assert.equal(manager.tabs.length, 2);
        assert.ok(manager.tabs.some((t) => t.id === tab1.id));
    } finally {
        globalThis.window.confirm = oldConfirm;
    }

    // Caso 2: Usuário confirma o fechamento da aba suja
    globalThis.window.confirm = () => true; // Confirma
    try {
        manager.close(tab1.id);
        // Aba 1 agora foi fechada
        assert.equal(manager.tabs.length, 1);
        assert.equal(manager.tabs[0].id, tab2.id);
    } finally {
        globalThis.window.confirm = oldConfirm;
    }
});

test('Aba carregada de arquivo DXF/DWG sem edições fecha imediatamente sem pedir confirmação', () => {
    const { manager } = createTabManagerFixture();
    const docDxf = {
        ...createDocument(),
        name: 'UNQ15- 134 -2 PÇS, 2,00mm - DOBRA_CORRIGIDO.DXF',
        entities: [{ type: 'LINE', id: 'l1', x1: 0, y1: 0, x2: 100, y2: 100 }],
    };
    const tabDxf = manager.add(docDxf);
    assert.equal(manager.tabs.length, 2);

    let confirmWasCalled = false;
    const oldConfirm = globalThis.window.confirm;
    globalThis.window.confirm = () => { confirmWasCalled = true; return false; };
    try {
        manager.close(tabDxf.id);
        assert.equal(confirmWasCalled, false, 'window.confirm não deve ser chamado para arquivo sem alterações');
        assert.equal(manager.tabs.length, 1);
        assert.equal(manager.tabs.some((t) => t.id === tabDxf.id), false);
    } finally {
        globalThis.window.confirm = oldConfirm;
    }
});


// ---------------------------------------------------------------------------
// Ctrl+W / Ctrl+F4: perguntam Salvar / Não salvar / Cancelar antes de fechar.

function withConfirms(answers, fn) {
    const old = globalThis.window.confirm;
    const queue = [...answers];
    globalThis.window.confirm = () => queue.shift();
    return Promise.resolve(fn()).finally(() => { globalThis.window.confirm = old; });
}

function dirtyFixture() {
    const fixture = createTabManagerFixture();
    fixture.manager.root = null; // sem DOM: a pergunta cai no window.confirm
    fixture.manager.tabs[0].session.history.present.entities = [{ type: 'LINE', id: 'l1', x1: 0, y1: 0, x2: 50, y2: 50 }];
    return fixture;
}

test('Ctrl+W com alteração: Cancelar mantém a aba aberta', async () => {
    const { manager } = dirtyFixture();
    const clean = manager.add({ ...createDocument(), name: 'Limpa.dxf' });
    manager.activate(manager.tabs[0].id);
    const closed = await withConfirms([false, false], () => manager.closeCurrent());
    assert.equal(closed, false);
    assert.equal(manager.tabs.length, 2);
    assert.ok(manager.tabs.some((t) => t.id === clean.id));
});

test('Ctrl+W com alteração: Não salvar fecha a aba', async () => {
    const { manager } = dirtyFixture();
    manager.add({ ...createDocument(), name: 'Limpa.dxf' });
    const dirtyId = manager.tabs[0].id;
    manager.activate(dirtyId);
    const closed = await withConfirms([false, true], () => manager.closeCurrent());
    assert.equal(closed, true);
    assert.equal(manager.tabs.some((t) => t.id === dirtyId), false);
});

test('Ctrl+W com alteração: Salvar roda o SAVE e não fecha se a aba continuar suja', async () => {
    const { manager, editor } = dirtyFixture();
    const commands = [];
    editor.runCommand = async (name) => { commands.push(name); };
    const closed = await withConfirms([true], () => manager.closeCurrent());
    assert.deepEqual(commands, ['SAVE']);
    assert.equal(closed, false);
    assert.equal(manager.tabs.length, 1);
});

test('Ctrl+F4 fecha todas as abas e a janela; Cancelar não fecha nada', async () => {
    const { manager } = dirtyFixture();
    manager.add({ ...createDocument(), name: 'Limpa.dxf' });
    let windowClosed = 0;
    globalThis.window.desktopBridge = { closeWindow: async () => { windowClosed += 1; } };
    try {
        assert.equal(await withConfirms([false, false], () => manager.requestQuit()), false);
        assert.equal(manager.tabs.length, 2);
        assert.equal(windowClosed, 0);
        assert.equal(await withConfirms([false, true], () => manager.requestQuit()), true);
        assert.equal(manager.tabs.length, 0);
        assert.equal(windowClosed, 1);
    } finally {
        delete globalThis.window.desktopBridge;
    }
});
