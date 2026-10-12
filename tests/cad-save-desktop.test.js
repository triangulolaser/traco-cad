import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { History, createDocument, addEntities } from '../src/cad/document.js';
import { TabManager } from '../src/cad.js';
import { COMMANDS } from '../src/cad/commands.js';
import { serializeDocument } from '../src/cad/storage.js';

test('History: rastreia dirty/clean com precisão através de commits, markClean e undo/redo', () => {
    const doc0 = createDocument();
    const history = new History(doc0);

    assert.equal(history.isDirty(), false, 'Histórico novo deve começar limpo');

    const doc1 = addEntities(doc0, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }]);
    history.commit('Linha 1', doc1);
    assert.equal(history.isDirty(), true, 'Após commit deve estar sujo');

    history.markClean();
    assert.equal(history.isDirty(), false, 'Após markClean deve estar limpo');

    const doc2 = addEntities(doc1, [{ type: 'circle', center: { x: 20, y: 20 }, radius: 5 }]);
    history.commit('Círculo 1', doc2);
    assert.equal(history.isDirty(), true, 'Novo commit após salvar deve voltar a ficar sujo');

    // Desfaz o círculo -> volta ao ponto de salvamento!
    history.undo();
    assert.equal(history.isDirty(), false, 'Desfazer até o ponto de salvamento deve restaurar estado limpo');

    // Desfaz a linha -> antes do ponto de salvamento!
    history.undo();
    assert.equal(history.isDirty(), true, 'Desfazer para antes do ponto de salvamento deve considerar sujo');

    // Refaz até o ponto de salvamento
    history.redo();
    assert.equal(history.isDirty(), false, 'Refazer até o ponto de salvamento volta a ficar limpo');
});

test('serializeDocument preserva filePath', () => {
    const doc = { ...createDocument(), name: 'teste.dxf', filePath: '/Users/usuario/Downloads/teste.dxf' };
    const serialized = serializeDocument(doc);
    assert.equal(serialized.filePath, '/Users/usuario/Downloads/teste.dxf');
});

test('TabManager.isTabDirty: respeita documento salvo e limpo', () => {
    const editorMock = {
        doc: createDocument(),
        history: new History(createDocument()),
        onChange: () => {},
        selection: new Set(),
        invalidate: () => {},
        getSession: () => ({ history: new History(createDocument()), viewport: null, memory: {} }),
        setSession: () => {},
        zoomExtents: () => {},
        log: () => {},
    };

    const rootMock = {
        dataset: { storageScope: 'test' },
        querySelectorAll: () => [],
        querySelector: () => null,
        appendChild: () => {},
    };

    const tabManager = new TabManager(editorMock, rootMock);
    const doc = {
        ...createDocument(),
        name: 'peca.dxf',
        filePath: '/Users/usuario/Downloads/peca.dxf',
        entities: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
    };
    const tab = tabManager.add(doc);
    assert.equal(tabManager.isTabDirty(tab), false, 'Aba recém aberta com arquivo deve estar limpa');

    // Adiciona entidade e faz commit
    const docEdited = addEntities(doc, [{ type: 'circle', center: { x: 5, y: 5 }, radius: 2 }]);
    tab.session.history.commit('Círculo', docEdited);
    assert.equal(tabManager.isTabDirty(tab), true, 'Aba com modificações não salvas deve estar suja');

    // Simula salvamento
    tab.session.history.markClean();
    assert.equal(tabManager.isTabDirty(tab), false, 'Após salvar e markClean, aba deve estar limpa');
});

test('SAVE em DXF no Desktop: sempre força showSaveDialog (Salvar Como) mesmo com filePath existente (estilo AutoCAD/BricsCAD)', async () => {
    let savedPath = null;
    let savedContent = null;
    let dialogOpened = false;
    let dialogOptions = null;

    globalThis.window = {
        desktopBridge: {
            isDesktop: true,
            saveFile: async (path, content) => {
                savedPath = path;
                savedContent = content;
                return true;
            },
            showSaveDialog: async (options) => {
                dialogOpened = true;
                dialogOptions = options;
                return '/Users/usuario/Documents/outro.dxf';
            },
        },
    };

    let doc = {
        ...createDocument(),
        name: 'new block (1).dxf',
        filePath: '/Users/usuario/Downloads/new block (1).dxf',
        entities: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 50 } }],
    };
    const history = new History(doc);
    const docEdited = addEntities(doc, [{ type: 'circle', center: { x: 10, y: 10 }, radius: 5 }]);
    history.commit('Círculo', docEdited);

    assert.equal(history.isDirty(), true);

    const logs = [];
    const editor = {
        get doc() { return doc; },
        set doc(val) { doc = val; },
        history,
        tabs: { render: () => {}, save: () => {} },
        setDocumentName: (name, filePath) => {
            doc = { ...doc, name, filePath };
        },
        log: (msg) => logs.push(msg),
    };

    await COMMANDS.SAVE.run(editor);

    assert.equal(dialogOpened, true, 'Deve sempre abrir o diálogo de Salvar Como para DXF, protegendo o original');
    assert.equal(dialogOptions.defaultPath, '/Users/usuario/Downloads/new block (1).dxf', 'Deve sugerir o caminho atual como padrão');
    assert.equal(savedPath, '/Users/usuario/Documents/outro.dxf', 'Deve salvar no caminho confirmado no diálogo');
    assert.ok(savedContent.includes('SECTION'), 'Deve conter estrutura DXF válida');
    assert.equal(doc.filePath, '/Users/usuario/Documents/outro.dxf', 'Deve atualizar o filePath do documento');
    assert.equal(doc.name, 'outro.dxf', 'Deve atualizar o nome do documento');
    assert.equal(history.isDirty(), false, 'Histórico deve ficar limpo após salvar com sucesso');
    assert.ok(logs.some((l) => l.includes('Salvo em /Users/usuario/Documents/outro.dxf')));

    delete globalThis.window;
});

test('SAVE em DXF no Desktop: cancelamento do diálogo não altera o documento nem o estado dirty', async () => {
    let savedPath = null;
    let dialogOpened = false;

    globalThis.window = {
        desktopBridge: {
            isDesktop: true,
            saveFile: async (path) => {
                savedPath = path;
                return true;
            },
            showSaveDialog: async () => {
                dialogOpened = true;
                return null; // Usuário cancelou
            },
        },
    };

    const doc = {
        ...createDocument(),
        name: 'peca.dxf',
        filePath: '/Users/usuario/Downloads/peca.dxf',
        entities: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
    };
    const history = new History(doc);
    const docEdited = addEntities(doc, [{ type: 'circle', center: { x: 5, y: 5 }, radius: 2 }]);
    history.commit('Círculo', docEdited);

    assert.equal(history.isDirty(), true);

    const logs = [];
    const editor = {
        get doc() { return history.present; },
        history,
        tabs: { render: () => {}, save: () => {} },
        log: (msg) => logs.push(msg),
    };

    await COMMANDS.SAVE.run(editor);

    assert.equal(dialogOpened, true);
    assert.equal(savedPath, null, 'Não deve gravar nenhum arquivo no disco quando cancelado');
    assert.equal(history.isDirty(), true, 'Documento deve permanecer sujo (dirty)');
    assert.ok(logs.some((l) => l.includes('Salvamento cancelado.')));

    delete globalThis.window;
});

test('SAVE no Desktop: abre showSaveDialog se filePath não existir (novo desenho)', async () => {
    let savedPath = null;
    let savedContent = null;
    let dialogOpened = false;

    globalThis.window = {
        desktopBridge: {
            isDesktop: true,
            saveFile: async (path, content) => {
                savedPath = path;
                savedContent = content;
                return true;
            },
            showSaveDialog: async (options) => {
                dialogOpened = true;
                assert.ok(options.filters.some((f) => f.extensions.includes('dxf')));
                return '/Users/usuario/Desktop/meu_projeto.dxf';
            },
        },
    };

    let doc = {
        ...createDocument(),
        name: 'Sem título.dxf',
        filePath: null,
        entities: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
    };
    const history = new History(doc);

    const editor = {
        get doc() { return doc; },
        set doc(val) { doc = val; },
        history,
        tabs: { render: () => {}, save: () => {} },
        setDocumentName: (name, filePath) => {
            doc = { ...doc, name, filePath };
        },
        log: () => {},
    };

    await COMMANDS.SAVE.run(editor);

    assert.equal(dialogOpened, true, 'Deve abrir showSaveDialog para arquivo novo');
    assert.equal(savedPath, '/Users/usuario/Desktop/meu_projeto.dxf');
    assert.equal(doc.filePath, '/Users/usuario/Desktop/meu_projeto.dxf');
    assert.equal(doc.name, 'meu_projeto.dxf');
    assert.equal(history.isDirty(), false);

    delete globalThis.window;
});

test('SAVE em DXF na Web: sempre solicita nome antes de baixar e não entra em loop', async () => {
    let downloadedName = null;
    let downloadedContent = null;

    let doc = {
        ...createDocument(),
        name: 'original.dxf',
        filePath: null,
        entities: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 20, y: 20 } }],
    };
    const history = new History(doc);
    const docEdited = addEntities(doc, [{ type: 'circle', center: { x: 5, y: 5 }, radius: 2 }]);
    history.commit('Círculo', docEdited);

    const logs = [];
    const editor = {
        get doc() { return doc; },
        set doc(val) { doc = val; },
        history,
        tabs: { render: () => {}, save: () => {} },
        getString: async (prompt, { defaultValue }) => {
            assert.equal(defaultValue, 'original.dxf');
            return 'copia_revisada';
        },
        setDocumentName: (name, filePath) => {
            doc = { ...doc, name, filePath };
        },
        downloadText: (content, name) => {
            downloadedContent = content;
            downloadedName = name;
        },
        log: (msg) => logs.push(msg),
    };

    await COMMANDS.SAVE.run(editor);

    assert.equal(downloadedName, 'copia_revisada.dxf', 'Deve anexar .dxf e baixar com novo nome');
    assert.ok(downloadedContent.includes('SECTION'), 'Deve conter conteúdo DXF');
    assert.equal(doc.name, 'copia_revisada.dxf');
    assert.equal(history.isDirty(), false, 'Histórico deve ficar limpo após exportação');
    assert.ok(logs.some((l) => l.includes('Exportado copia_revisada.dxf')));
});

test('SAVE em arquivo não-DXF (ex: elmt) com filePath no Desktop: salva diretamente sem diálogo', async () => {
    let savedPath = null;
    let dialogOpened = false;

    globalThis.window = {
        desktopBridge: {
            isDesktop: true,
            saveFile: async (path) => {
                savedPath = path;
                return true;
            },
            showSaveDialog: async () => {
                dialogOpened = true;
                return '/Users/usuario/outro.elmt';
            },
        },
    };

    const doc = {
        ...createDocument(),
        sourceFormat: 'elmt',
        name: 'rele.elmt',
        filePath: '/Users/usuario/Projetos/rele.elmt',
        entities: [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
    };
    const history = new History(doc);

    const editor = {
        get doc() { return history.present; },
        history,
        tabs: { render: () => {}, save: () => {} },
        log: () => {},
    };

    await COMMANDS.SAVE.run(editor);

    assert.equal(dialogOpened, false, 'Não-DXF com filePath deve poder salvar diretamente');
    assert.equal(savedPath, '/Users/usuario/Projetos/rele.elmt');
    assert.equal(history.isDirty(), false);

    delete globalThis.window;
});

test('cad.css: define regras de alto contraste para modais em tema claro', () => {
    const css = readFileSync(new URL('../src/styles/cad.css', import.meta.url), 'utf-8');

    assert.ok(css.includes('.cad-app[data-cad-theme="light"] .cad-error-modal'));
    assert.ok(css.includes('.cad-app[data-cad-theme="light"] .cad-error-title'));
    assert.ok(css.includes('.cad-app[data-cad-theme="light"] .cad-error-badge-warning'));
    assert.ok(css.includes('.cad-app[data-cad-theme="light"] .cad-license-modal'));
    assert.ok(css.includes('.cad-app[data-cad-theme="light"] .cad-license-title'));
    assert.ok(css.includes('.cad-app[data-cad-theme="light"] .cad-license-card.is-highlight'));
    assert.ok(css.includes('.cad-confirm-modal'));
});

test('TabManager.render: aba com alterações não salvas recebe is-dirty e some ao salvar', () => {
    const fakeEl = () => {
        const el = { children: [], attrs: {}, className: '', textContent: '', title: '' };
        el.setAttribute = (k, v) => { el.attrs[k] = v; };
        el.appendChild = (c) => { el.children.push(c); };
        el.addEventListener = () => {};
        return el;
    };
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: fakeEl };
    try {
        const editorMock = {
            doc: createDocument(),
            history: new History(createDocument()),
            onChange: () => {},
            selection: new Set(),
            invalidate: () => {},
            getSession: () => ({ history: new History(createDocument()), viewport: null, memory: {} }),
            setSession: () => {},
            zoomExtents: () => {},
            log: () => {},
        };
        const rootMock = { dataset: { storageScope: 'test' }, querySelectorAll: () => [], querySelector: () => null, appendChild: () => {} };
        const tabManager = new TabManager(editorMock, rootMock);
        const list = fakeEl();
        list.innerHTML = '';
        tabManager.list = list;
        const doc = { ...createDocument(), name: 'LOTE 205.dwg', filePath: '/tmp/LOTE 205.dwg' };
        const tab = tabManager.add(doc);
        tabManager.activeId = null;
        const renderedTab = () => { list.children = []; tabManager.render(); return list.children.find((c) => c.children[0].textContent === 'LOTE 205.dwg'); };

        assert.doesNotMatch(renderedTab().className, /is-dirty/);
        tab.session.history.commit('Linha', addEntities(doc, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]));
        const dirtyEl = renderedTab();
        assert.match(dirtyEl.className, /is-dirty/);
        assert.match(dirtyEl.children[1].attrs['aria-label'], /não salvas/);
        tab.session.history.markClean();
        assert.doesNotMatch(renderedTab().className, /is-dirty/);
    } finally {
        globalThis.document = prevDocument;
    }
});

function makeSaveAllManager(saveBehavior) {
    let current = null;
    const editorMock = {
        get doc() { return current?.present; },
        history: null,
        onChange: () => {},
        selection: new Set(),
        invalidate: () => {},
        getSession: () => ({ history: editorMock.history, viewport: null, memory: {} }),
        setSession: (session) => { editorMock.history = session.history; current = session.history; },
        zoomExtents: () => {},
        log: () => {},
        runCommand: async (name) => {
            assert.equal(name, 'SAVE');
            saveBehavior(editorMock.history);
        },
    };
    const rootMock = { dataset: { storageScope: 'test' }, querySelectorAll: () => [], querySelector: () => null, appendChild: () => {} };
    const tabs = new TabManager(editorMock, rootMock);
    const open = (name) => {
        const doc = { ...createDocument(), name, filePath: `/tmp/${name}` };
        const tab = tabs.add(doc);
        tab.session.history.commit('Linha', addEntities(doc, [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]));
        return tab;
    };
    return { tabs, open };
}

test('TabManager.saveAllDirty: salva todas as abas sujas e volta para a aba ativa', async () => {
    const { tabs, open } = makeSaveAllManager((history) => history.markClean());
    const a = open('a.dwg');
    const b = open('b.dwg');
    const clean = tabs.add({ ...createDocument(), name: 'limpo.dwg', filePath: '/tmp/limpo.dwg' });
    assert.equal(tabs.tabs.filter((t) => tabs.isTabDirty(t)).length, 2);

    const result = await tabs.saveAllDirty();

    assert.deepEqual(result, { saved: 2, failed: null });
    assert.equal(tabs.isTabDirty(a), false);
    assert.equal(tabs.isTabDirty(b), false);
    assert.equal(tabs.activeId, clean.id, 'Deve voltar para a aba que estava ativa');
});

test('TabManager.saveAllDirty: para na aba cujo salvamento foi cancelado', async () => {
    let calls = 0;
    const { tabs, open } = makeSaveAllManager((history) => {
        calls += 1;
        if (calls === 1) history.markClean();
    });
    open('a.dwg');
    const b = open('b.dwg');
    open('c.dwg');

    const result = await tabs.saveAllDirty();

    assert.deepEqual(result, { saved: 1, failed: 'b.dwg' });
    assert.equal(calls, 2, 'Não deve tentar salvar depois da falha');
    assert.equal(tabs.isTabDirty(b), true);
});
