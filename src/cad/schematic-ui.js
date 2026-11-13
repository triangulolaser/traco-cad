// Interface do modo Esquemático (ADR 0007, E2a): chave CAD | Esquemático, barra própria,
// biblioteca com prévia, abas de folha e conferência ao vivo.
//
// Os elementos são criados aqui, e não no Blade, para a mesma tela valer no produto, no
// standalone e nos testes de navegador. No CAD nada disto aparece além da chave.

import { entityBox } from './geometry.js';
import { libraries, getSymbolDef, BUILTIN_LIBRARY_ID, isBuiltinLibrary, CONNECTOR_REF } from './schematic-library.js';
import { createSymbol, symbolChildren, symbolPorts } from './schematic.js';
import { entityPath } from './preview-svg.js';
import {
    MODE_CAD, MODE_SCHEMATIC, documentMode, canSwitchMode, sheetsOf, activeSheetId, sheetEntityCounts,
} from './schematic-mode.js';
import { schematicCheckList } from './schematic-check.js';
import { switchMode, goToSheet, newSheet, renameActiveSheet, removeActiveSheet } from './schematic-commands.js';

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

// Barra do Esquemático. `cmd` roda comando do Traço; `action` é tratado aqui.
export const SCHEMATIC_BAR = [
    { label: 'Arquivo', items: [
        { action: 'new', icon: 'file-earmark-plus', text: 'Novo esquema', title: 'Novo esquema em nova aba' },
        { cmd: 'OPEN', icon: 'folder2-open', text: 'Abrir', title: 'Abrir esquema .traco ou desenho do computador', small: true },
        { cmd: 'SAVE', icon: 'download', text: 'Salvar', title: 'Salvar o esquema em .traco (Ctrl+S)', small: true },
    ] },
    { label: 'Símbolos', items: [
        { cmd: 'SYMBOL', icon: 'plus-square', text: 'Inserir', title: 'Inserir símbolo pelo nome ou categoria (SIMBOLO)' },
        { action: 'library', icon: 'grid-3x3-gap', text: 'Biblioteca', title: 'Mostrar ou esconder a biblioteca de símbolos', toggle: 'library' },
        { cmd: 'SYMLIB', icon: 'box-arrow-in-down', text: 'Carregar', title: 'Carregar biblioteca de símbolos de arquivo (SIMBIB)', small: true },
    ] },
    { label: 'Ligações', items: [
        { cmd: 'CONNECT', icon: 'bezier', text: 'Ligar', title: 'Ligar porta a porta em L ou Z (LIGAR)' },
        { action: 'connector', icon: 'signpost-2', text: 'Conector', title: 'Conector de página: o mesmo sinal liga as redes entre folhas', small: true },
    ] },
    { label: 'Editar', items: [
        { cmd: 'MOVE', icon: 'arrows-move', text: 'Mover', title: 'Mover; as ligações acompanham as portas' },
        { cmd: 'ROTATE', icon: 'arrow-repeat', text: 'Girar', title: 'Girar (símbolo gira de 90 em 90°)', small: true },
        { cmd: 'MIRROR', icon: 'symmetry-vertical', text: 'Espelhar', title: 'Espelhar', small: true },
        { cmd: 'COPY', icon: 'copy', text: 'Copiar', title: 'Copiar', small: true },
        { cmd: 'ERASE', icon: 'trash3', text: 'Apagar', title: 'Apagar; ligação de símbolo apagado fica solta, em vermelho' },
    ] },
    { label: 'Identificação', items: [
        { cmd: 'TEXT', icon: 'fonts', text: 'Nota', title: 'Nota de texto no esquema' },
        { action: 'properties', icon: 'sliders', text: 'Propriedades', title: 'Propriedades do objeto selecionado', small: true },
    ] },
    { label: 'Folha', items: [
        { action: 'sheet-new', icon: 'file-earmark-plus', text: 'Nova folha', title: 'Nova folha A4' },
        { action: 'sheet-rename', icon: 'pencil', text: 'Renomear', title: 'Renomear a folha ativa', small: true },
        { action: 'sheet-remove', icon: 'x-square', text: 'Excluir', title: 'Excluir a folha ativa e o que está nela', small: true },
        { action: 'title-block', icon: 'card-text', text: 'Carimbo', title: 'Preencher o carimbo (título, desenho, revisão, desenhista, data)', small: true },
        { cmd: 'PRINT', icon: 'printer', text: 'Imprimir', title: 'Imprimir as folhas em A4 com moldura e carimbo, ou salvar em PDF' },
    ] },
    { label: 'Conferir', items: [
        { cmd: 'SCHEMACHECK', icon: 'check2-square', text: 'Verificar', title: 'Verificar o esquema e selecionar os problemas (VERIFICAR)' },
        { action: 'checklist', icon: 'list-check', text: 'Lista', title: 'Mostrar ou esconder a lista de conferência', toggle: 'checklist', small: true },
        { cmd: 'BOM', icon: 'table', text: 'Peças', title: 'Lista de peças e mangueiras (LISTAPECAS)', small: true },
    ] },
    { label: 'Sair', items: [
        { action: 'exit', icon: 'box-arrow-left', text: 'Sair do esquema', title: 'Voltar ao CAD (só com o desenho vazio; para levar o esquema ao CAD, salve em DXF)' },
    ] },
];

function barButton(item) {
    const attrs = item.cmd ? `data-cad-schematic-cmd="${item.cmd}"` : `data-cad-schematic-action="${item.action}"`;
    return `<button type="button" class="cad-ribbon-button${item.small ? ' is-small' : ''}" ${attrs} title="${esc(item.title)}"${item.toggle ? ' aria-pressed="true"' : ''}><i class="bi bi-${item.icon}"></i><span>${esc(item.text)}</span></button>`;
}

export function schematicBarHtml() {
    return SCHEMATIC_BAR.map((g) => `<div class="cad-ribbon-group"><div class="cad-ribbon-group-items">${g.items.map(barButton).join('')}</div><div class="cad-ribbon-group-label">${esc(g.label)}</div></div>`).join('');
}

// Miniatura do símbolo: geometria da definição na posição neutra, com as portas em destaque.
export function symbolPreviewSvg(ref, { size = 56 } = {}) {
    const def = getSymbolDef(ref);
    if (!def) return '';
    const inst = createSymbol(ref, { x: 0, y: 0 }, { atributos: { etiqueta: '' } });
    const children = symbolChildren(inst).filter((c) => c.type !== 'text');
    const ports = symbolPorts(inst, def);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const c of children) {
        const b = entityBox(c);
        if (!Number.isFinite(b.minX)) continue;
        box.minX = Math.min(box.minX, b.minX); box.minY = Math.min(box.minY, b.minY);
        box.maxX = Math.max(box.maxX, b.maxX); box.maxY = Math.max(box.maxY, b.maxY);
    }
    for (const p of ports) {
        box.minX = Math.min(box.minX, p.position.x); box.minY = Math.min(box.minY, p.position.y);
        box.maxX = Math.max(box.maxX, p.position.x); box.maxY = Math.max(box.maxY, p.position.y);
    }
    if (!Number.isFinite(box.minX)) return '';
    const w = Math.max(box.maxX - box.minX, 1);
    const h = Math.max(box.maxY - box.minY, 1);
    const pad = Math.max(w, h) * 0.08 + 1;
    const vb = `${fmt(box.minX - pad)} ${fmt(-box.maxY - pad)} ${fmt(w + 2 * pad)} ${fmt(h + 2 * pad)}`;
    const stroke = Math.max(w, h) / size * 1.3;
    const paths = children.map(entityPath).filter(Boolean).join('');
    const dots = ports.map((p) => `<circle cx="${fmt(p.position.x)}" cy="${fmt(p.position.y)}" r="${fmt(stroke * 1.6)}"/>`).join('');
    return `<svg class="cad-symbol-preview" viewBox="${vb}" width="${size}" height="${size}" aria-hidden="true"><g transform="scale(1,-1)"><path d="${paths}" fill="none" stroke="currentColor" stroke-width="${fmt(stroke)}" stroke-linecap="round" stroke-linejoin="round"/><g class="cad-symbol-preview-ports">${dots}</g></g></svg>`;
}

function normalize(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Seções da biblioteca: a ISO embutida primeiro, depois as carregadas pelo SIMBIB.
export function librarySections(query = '') {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    const sections = [];
    const rank = (lib) => (lib.id === BUILTIN_LIBRARY_ID ? 0 : isBuiltinLibrary(lib.id) ? 1 : 2);
    const libs = libraries().slice().sort((a, b) => rank(a) - rank(b) || a.nome.localeCompare(b.nome));
    for (const lib of libs) {
        const symbols = [...lib.simbolos.values()]
            .filter((def) => {
                const hay = normalize(`${def.id} ${def.nome} ${def.categoria}`);
                return words.every((w) => hay.includes(w));
            })
            .sort((a, b) => (a.categoria ?? '').localeCompare(b.categoria ?? '') || a.nome.localeCompare(b.nome))
            .map((def) => ({ ref: `${lib.id}/${def.id}`, nome: def.nome, categoria: def.categoria }));
        sections.push({ id: lib.id, nome: lib.nome, versao: lib.versao_biblioteca, builtin: isBuiltinLibrary(lib.id), symbols });
    }
    return sections;
}

function create(doc, html) {
    const t = doc.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

export function setupSchematicUi(editor, root) {
    if (!root?.querySelector) return null;
    const doc = root.ownerDocument;
    const state = { library: true, checklist: true, query: '', libKey: '', sheetKey: '', checkKey: '' };

    // Chave CAD | Esquemático: na linha das abas do ribbon, logo depois da marca.
    const ribbon = root.querySelector('[data-cad-ribbon]');
    const tabsRow = ribbon?.querySelector('.cad-ribbon-tabs');
    const toggle = create(doc, `<div class="cad-mode-switch" role="group" aria-label="Modo de trabalho" data-cad-mode-switch>
        <button type="button" data-cad-mode="${MODE_CAD}" aria-pressed="true">CAD</button>
        <button type="button" data-cad-mode="${MODE_SCHEMATIC}" aria-pressed="false">Esquemático</button>
    </div>`);
    const brand = tabsRow?.querySelector('.cad-brand');
    if (brand) brand.after(toggle);
    else if (tabsRow) tabsRow.prepend(toggle);
    else root.prepend(toggle);

    // Barra própria do Esquemático, no lugar dos painéis do ribbon.
    const bar = create(doc, `<div class="cad-ribbon-panel cad-schematic-bar" data-cad-schematic-bar role="toolbar" aria-label="Ferramentas do esquema">${schematicBarHtml()}</div>`);
    if (ribbon) ribbon.append(bar);
    else toggle.after(bar);

    // Biblioteca à esquerda do desenho.
    const stage = root.querySelector('[data-cad-stage]');
    const library = create(doc, `<aside class="cad-panel cad-panel-left cad-schematic-library" data-cad-schematic-library aria-label="Biblioteca de símbolos">
        <header class="cad-panel-header"><span><i class="bi bi-grid-3x3-gap"></i> Símbolos</span>
            <div class="cad-panel-header-actions"><button type="button" class="cad-btn cad-btn-icon" data-cad-schematic-action="library" title="Fechar"><i class="bi bi-x-lg"></i></button></div></header>
        <div class="cad-panel-search"><i class="bi bi-search"></i><input type="search" data-cad-symbol-search placeholder="Buscar símbolo…" aria-label="Buscar símbolo" autocomplete="off"></div>
        <div class="cad-symbol-sections" data-cad-symbol-sections></div>
        <footer class="cad-panel-footer">Clique no símbolo para inserir</footer>
    </aside>`);
    if (stage) stage.before(library);

    // Abas de folha e conferência embaixo do desenho.
    const bottom = create(doc, `<div class="cad-schematic-bottom" data-cad-schematic-bottom>
        <div class="cad-sheet-tabs" role="tablist" aria-label="Folhas do esquema" data-cad-sheet-tabs></div>
        <div class="cad-check-panel" data-cad-check-panel>
            <div class="cad-check-header" data-cad-check-summary></div>
            <ul class="cad-check-list" data-cad-check-list></ul>
        </div>
    </div>`);
    if (stage) {
        // Dentro do workspace (coluna do desenho) quando existe; senão logo depois do palco.
        stage.after(bottom);
    }

    const sectionsBox = library.querySelector('[data-cad-symbol-sections]');
    const sheetTabs = bottom.querySelector('[data-cad-sheet-tabs]');
    const checkSummary = bottom.querySelector('[data-cad-check-summary]');
    const checkList = bottom.querySelector('[data-cad-check-list]');
    const checkPanel = bottom.querySelector('[data-cad-check-panel]');

    const hasDoc = () => Boolean(editor.doc) && (!editor.tabs || editor.tabs.tabs?.length);

    const nameOf = (id) => {
        const s = editor.doc.entities.find((x) => x.id === id);
        if (s?.type === 'symbol') return s.atributos?.etiqueta || getSymbolDef(s.def)?.nome || id;
        if (s?.type === 'link') return 'ligação';
        return id;
    };

    const run = (name, args = []) => {
        if (!hasDoc()) editor.tabs?.add();
        editor.runCommand(name, args);
    };

    const zoomToIds = (ids) => {
        const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const e of editor.doc.entities) {
            if (!ids.includes(e.id)) continue;
            const b = entityBox(e);
            if (!Number.isFinite(b.minX)) continue;
            box.minX = Math.min(box.minX, b.minX); box.minY = Math.min(box.minY, b.minY);
            box.maxX = Math.max(box.maxX, b.maxX); box.maxY = Math.max(box.maxY, b.maxY);
        }
        if (!Number.isFinite(box.minX)) return;
        const m = Math.max(box.maxX - box.minX, box.maxY - box.minY, 20) * 0.6;
        editor.zoomToBox?.({ minX: box.minX - m, minY: box.minY - m, maxX: box.maxX + m, maxY: box.maxY + m });
    };

    function newSchematic() {
        if (editor.tabs && editor.doc?.entities?.length) editor.tabs.add();
        else if (!hasDoc()) editor.tabs?.add();
        switchMode(editor, MODE_SCHEMATIC);
    }

    function action(name) {
        if (name === 'new') return newSchematic();
        if (name === 'library') { state.library = !state.library; return refresh(); }
        if (name === 'checklist') { state.checklist = !state.checklist; return refresh(); }
        if (name === 'properties') {
            root.querySelector('[data-cad-toggle-panel="properties"]')?.click();
            return undefined;
        }
        if (name === 'exit') return switchMode(editor, MODE_CAD);
        if (name === 'connector') return run('SYMBOL', [CONNECTOR_REF]);
        if (name === 'title-block') {
            // Carimbo é editado no painel com nada selecionado.
            editor.selection = new Set();
            editor.onChange?.(editor);
            const panel = root.querySelector('[data-cad-panel="properties"]');
            if (panel && (panel.hidden || panel.classList.contains('is-hidden') || getComputedStyle(panel).display === 'none')) root.querySelector('[data-cad-toggle-panel="properties"]')?.click();
            root.querySelector('[data-schematic-title="titulo"]')?.focus();
            return undefined;
        }
        try {
            if (name === 'sheet-new') return newSheet(editor);
            if (name === 'sheet-rename') {
                const sheet = sheetsOf(editor.doc).find((s) => s.id === activeSheetId(editor.doc));
                const nome = globalThis.prompt?.('Nome da folha', sheet?.nome ?? '');
                if (nome) renameActiveSheet(editor, nome);
                return undefined;
            }
            if (name === 'sheet-remove') {
                const id = activeSheetId(editor.doc);
                const count = sheetEntityCounts(editor.doc).get(id) ?? 0;
                const sheet = sheetsOf(editor.doc).find((s) => s.id === id);
                if (count && globalThis.confirm && !globalThis.confirm(`Excluir ${sheet?.nome} com ${count} objeto(s)? Ctrl+Z desfaz.`)) return undefined;
                return removeActiveSheet(editor);
            }
        } catch (error) {
            editor.log(error.message, 'error');
        }
        return undefined;
    }

    root.addEventListener('click', (event) => {
        const target = event.target.closest?.('[data-cad-mode],[data-cad-schematic-cmd],[data-cad-schematic-action],[data-cad-symbol],[data-cad-sheet],[data-cad-check-item]');
        if (!target || !root.contains(target)) return;
        if (target.dataset.cadMode) {
            const want = target.dataset.cadMode;
            if (want === MODE_SCHEMATIC && !hasDoc()) editor.tabs?.add();
            switchMode(editor, want);
        } else if (target.dataset.cadSchematicCmd) {
            run(target.dataset.cadSchematicCmd);
        } else if (target.dataset.cadSchematicAction) {
            action(target.dataset.cadSchematicAction);
        } else if (target.dataset.cadSymbol) {
            run('SYMBOL', [target.dataset.cadSymbol]);
        } else if (target.dataset.cadSheet) {
            goToSheet(editor, target.dataset.cadSheet);
        } else if (target.dataset.cadCheckItem !== undefined) {
            const item = state.items?.[Number(target.dataset.cadCheckItem)];
            if (!item) return;
            if (item.sheet && item.sheet !== activeSheetId(editor.doc)) goToSheet(editor, item.sheet);
            editor.selection = new Set(item.ids);
            zoomToIds(item.ids);
            editor.invalidate?.();
            editor.onChange?.(editor);
        }
    });
    root.addEventListener('dblclick', (event) => {
        const tab = event.target.closest?.('[data-cad-sheet]');
        if (!tab) return;
        goToSheet(editor, tab.dataset.cadSheet);
        action('sheet-rename');
    });
    library.querySelector('[data-cad-symbol-search]')?.addEventListener('input', (event) => {
        state.query = event.target.value;
        renderLibrary(true);
    });

    function renderLibrary(force = false) {
        const sections = librarySections(state.query);
        const key = `${state.query}|${sections.map((s) => `${s.id}@${s.versao}:${s.symbols.length}`).join(',')}`;
        if (!force && key === state.libKey) return;
        state.libKey = key;
        const builtin = sections.filter((s) => s.builtin);
        const loaded = sections.filter((s) => !s.builtin);
        const list = (s) => (s.symbols.length
            ? `<div class="cad-symbol-grid">${s.symbols.map((sym) => `<button type="button" class="cad-symbol-card" data-cad-symbol="${esc(sym.ref)}" title="${esc(`${sym.nome} · ${sym.categoria ?? ''} (${sym.ref})`)}">${symbolPreviewSvg(sym.ref)}<span>${esc(sym.nome)}</span></button>`).join('')}</div>`
            : '<p class="cad-symbol-empty">Nenhum símbolo com esse termo.</p>');
        const section = (s, label) => `<section class="cad-symbol-section" data-cad-library="${esc(s.id)}"><h4>${esc(label ?? s.nome)} <small>${esc(s.versao ?? '')}</small></h4>${list(s)}</section>`;
        sectionsBox.innerHTML = [
            '<div class="cad-symbol-group-title">Embutida</div>',
            ...builtin.map((s) => section(s)),
            '<div class="cad-symbol-group-title">Bibliotecas carregadas</div>',
            ...(loaded.length ? loaded.map((s) => section(s)) : ['<p class="cad-symbol-empty">Nenhuma. Use Carregar (SIMBIB) para abrir a biblioteca da empresa.</p>']),
        ].join('');
    }

    function renderSheets() {
        const sheets = sheetsOf(editor.doc);
        const active = activeSheetId(editor.doc);
        const counts = sheetEntityCounts(editor.doc);
        const key = `${active}|${sheets.map((s) => `${s.id}:${s.nome}:${counts.get(s.id)}`).join(',')}`;
        if (key === state.sheetKey) return;
        state.sheetKey = key;
        sheetTabs.innerHTML = `${sheets.map((s) => `<button type="button" class="cad-sheet-tab${s.id === active ? ' is-active' : ''}" role="tab" aria-selected="${s.id === active}" data-cad-sheet="${esc(s.id)}" title="${esc(`${s.nome} · ${s.formato} · ${counts.get(s.id) ?? 0} objeto(s); duplo clique renomeia`)}">${esc(s.nome)}</button>`).join('')}<button type="button" class="cad-sheet-add" data-cad-schematic-action="sheet-new" title="Nova folha A4"><i class="bi bi-plus-lg"></i></button>`;
    }

    function renderChecklist() {
        const result = schematicCheckList(editor.doc, nameOf);
        const active = activeSheetId(editor.doc);
        const sheetName = new Map(sheetsOf(editor.doc).map((s) => [s.id, s.nome]));
        const key = `${active}|${result.items.map((i) => `${i.code}${i.text}${i.sheet}`).join('|')}|${result.nets}`;
        if (key === state.checkKey) return;
        state.checkKey = key;
        state.items = result.items;
        const parts = [];
        parts.push(result.errors ? `<b class="is-error">${result.errors} erro(s)</b>` : '<b class="is-ok">Sem erros</b>');
        if (result.warnings) parts.push(`<b class="is-warn">${result.warnings} aviso(s)</b>`);
        parts.push(`<span>${result.nets} rede(s)</span>`);
        checkSummary.innerHTML = `<i class="bi bi-list-check"></i> Conferência ${parts.join(' · ')}`;
        checkList.innerHTML = result.items.map((item, i) => {
            const other = item.sheet && item.sheet !== active ? ` <small>(${esc(sheetName.get(item.sheet) ?? item.sheet)})</small>` : '';
            return `<li><button type="button" class="cad-check-item is-${item.level}" data-cad-check-item="${i}"><span class="cad-check-code">${esc(item.code)}</span><span>${esc(item.text)}</span>${other}</button></li>`;
        }).join('');
    }

    function refresh() {
        const mode = hasDoc() ? documentMode(editor.doc) : MODE_CAD;
        root.dataset.cadMode = mode;
        const switchable = hasDoc() ? canSwitchMode(editor.doc) : true;
        toggle.querySelectorAll('[data-cad-mode]').forEach((b) => {
            const on = b.dataset.cadMode === mode;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.disabled = !on && !switchable;
            b.title = on ? (mode === MODE_SCHEMATIC ? 'Modo Esquemático' : 'Modo CAD')
                : (switchable ? `Trocar para o modo ${b.textContent.trim()}` : (mode === MODE_SCHEMATIC
                    ? 'Esquema com objetos não volta para o CAD: salve em DXF para levar ao CAD'
                    : 'A troca de modo só vale em desenho novo ou vazio'));
        });
        const schematic = mode === MODE_SCHEMATIC;
        bar.hidden = !schematic;
        library.hidden = !schematic || !state.library;
        bottom.hidden = !schematic;
        checkPanel.hidden = !state.checklist;
        bar.querySelectorAll('[data-cad-schematic-action="library"]').forEach((b) => b.setAttribute('aria-pressed', String(state.library)));
        bar.querySelectorAll('[data-cad-schematic-action="checklist"]').forEach((b) => b.setAttribute('aria-pressed', String(state.checklist)));
        if (!schematic) return;
        const sheets = sheetsOf(editor.doc);
        bar.querySelector('[data-cad-schematic-action="sheet-remove"]')?.toggleAttribute('disabled', sheets.length < 2);
        renderLibrary();
        renderSheets();
        if (state.checklist) renderChecklist();
    }

    refresh();
    return { refresh, toggle, bar, library, bottom, state, librarySections };
}

