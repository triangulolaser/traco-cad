// Tela Início do Traço (no estilo do lançador do BricsCAD): aparece quando não há aba aberta.
// "Começar" cria desenho em branco ou a partir de um recente usado como modelo; "Arquivos recentes"
// mostra miniatura, nome, data e tamanho. Tudo fica no navegador/app: metadados e miniatura em
// localStorage; na web, sem caminho em disco, os bytes do arquivo vão para o IndexedDB para reabrir.

import { entitiesPreviewSvg } from './preview-svg.js';
import { tr } from './i18n.js';

export const RECENTS_KEY = 'traco:recents';
export const SHOW_ON_START_KEY = 'traco:start-screen';
export const RECENTS_LIMIT = 12;
const THUMB_MAX_CHARS = 60000;
const BYTES_MAX = 8 * 1024 * 1024;
const DB_NAME = 'traco-recents';
const STORE = 'files';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function recentKey(entry) {
    return (entry.filePath || `web:${entry.name}`).toLowerCase();
}

// Mais recente primeiro, sem repetir o mesmo arquivo; preserva a miniatura antiga se a nova faltar.
export function upsertRecent(list, entry, limit = RECENTS_LIMIT) {
    const key = recentKey(entry);
    const previous = list.find((item) => recentKey(item) === key);
    const merged = { ...previous, ...entry, thumb: entry.thumb || previous?.thumb || null, id: previous?.id || entry.id || key };
    return [merged, ...list.filter((item) => recentKey(item) !== key)].slice(0, limit);
}

export function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function formatWhen(timestamp, now = Date.now()) {
    const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const diff = Math.round((day(now) - day(timestamp)) / 86400000);
    if (diff <= 0) return tr('Hoje');
    if (diff === 1) return tr('Ontem');
    return new Date(timestamp).toLocaleDateString('pt-BR');
}

export function loadRecents(storage = globalThis.localStorage) {
    try {
        const list = JSON.parse(storage?.getItem(RECENTS_KEY) || '[]');
        return Array.isArray(list) ? list.filter((item) => item && item.name) : [];
    } catch {
        return [];
    }
}

function saveRecents(list, storage = globalThis.localStorage) {
    try {
        storage?.setItem(RECENTS_KEY, JSON.stringify(list));
    } catch {
        // Cota estourada: tenta de novo sem miniaturas.
        try { storage?.setItem(RECENTS_KEY, JSON.stringify(list.map((item) => ({ ...item, thumb: null })))); } catch { /* sem armazenamento */ }
    }
}

export function showOnStart(storage = globalThis.localStorage) {
    try { return storage?.getItem(SHOW_ON_START_KEY) !== 'off'; } catch { return true; }
}

export function setShowOnStart(value, storage = globalThis.localStorage) {
    try { storage?.setItem(SHOW_ON_START_KEY, value ? 'on' : 'off'); } catch { /* sem armazenamento */ }
}

export function thumbnailFor(doc) {
    try {
        const { svg } = entitiesPreviewSvg(doc?.entities || [], { width: 320, maxHeight: 240 });
        return svg.length <= THUMB_MAX_CHARS ? svg : null;
    } catch {
        return null;
    }
}

function openDb() {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function idb(mode, fn) {
    const db = await openDb();
    if (!db) return null;
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req?.result ?? null);
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        return null;
    } finally {
        db.close();
    }
}

// Registra abertura/gravação. `file` (opcional) guarda os bytes na web, onde não há caminho para reler.
export async function recordRecent(doc, { file = null, size = null } = {}) {
    if (!doc?.name || !(doc.entities?.length > 0)) return null;
    const entry = {
        name: doc.name,
        filePath: doc.filePath || null,
        size: size ?? file?.size ?? null,
        openedAt: Date.now(),
        thumb: thumbnailFor(doc),
    };
    const list = upsertRecent(loadRecents(), entry);
    saveRecents(list);
    if (!entry.filePath && file && file.size <= BYTES_MAX) {
        const bytes = await file.arrayBuffer();
        await idb('readwrite', (store) => store.put({ name: file.name, type: file.type, bytes }, list[0].id));
    }
    return list[0];
}

export function forgetRecent(id) {
    saveRecents(loadRecents().filter((item) => item.id !== id));
    idb('readwrite', (store) => store.delete(id));
}

// Devolve um File pronto para editor.openFile, ou null se o arquivo não estiver mais acessível.
export async function readRecentFile(entry) {
    const bridge = typeof window !== 'undefined' ? window.desktopBridge : null;
    if (entry.filePath && bridge) {
        try {
            const bytes = typeof bridge.readFileBinary === 'function'
                ? await bridge.readFileBinary(entry.filePath)
                : new TextEncoder().encode(await bridge.readFileText(entry.filePath));
            const file = new File([new Uint8Array(bytes)], entry.name, { type: /\.dwg$/i.test(entry.name) ? 'image/vnd.dwg' : 'application/octet-stream' });
            file.filePath = entry.filePath;
            return file;
        } catch {
            return null;
        }
    }
    const stored = await idb('readonly', (store) => store.get(entry.id));
    if (!stored?.bytes) return null;
    return new File([stored.bytes], stored.name || entry.name, { type: stored.type || 'application/octet-stream' });
}

const FILE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 6h16l10 10v26H12z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M28 6v10h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

export class StartScreen {
    constructor(root, { onNew, onOpen, onOpenRecent, onTemplate }) {
        this.root = root;
        this.handlers = { onNew, onOpen, onOpenRecent, onTemplate };
        this.el = document.createElement('section');
        this.el.className = 'cad-start';
        this.el.setAttribute('data-cad-start', '');
        this.el.setAttribute('aria-label', tr('Início'));
        (root.querySelector('.cad-workspace') || root).appendChild(this.el);
        this.el.addEventListener('click', (event) => this.onClick(event));
        this.el.addEventListener('change', (event) => {
            if (event.target.matches('[data-start-show]')) setShowOnStart(event.target.checked);
        });
    }

    render() {
        const recents = loadRecents();
        const now = Date.now();
        const templates = recents.map((item, i) => `<option value="${i}">${escapeHtml(item.name)}</option>`).join('');
        const cards = recents.map((item, i) => `
            <button type="button" class="cad-start-card" data-start-recent="${i}" title="${escapeHtml(item.filePath || item.name)}">
                <span class="cad-start-thumb">${item.thumb || `<span class="cad-start-thumb-icon">${FILE_ICON}</span>`}</span>
                <span class="cad-start-name">${escapeHtml(item.name)}</span>
                <span class="cad-start-meta"><span>${escapeHtml(formatWhen(item.openedAt, now))}</span><span>${escapeHtml(formatSize(item.size))}</span></span>
            </button>`).join('');
        this.el.innerHTML = `
            <div class="cad-start-inner">
                <div class="cad-start-col">
                    <div class="cad-start-brand"><i class="bi bi-vector-pen"></i> Traço <small>CAD 2D · TRLS</small></div>
                    <h2 class="cad-start-title">${tr('Começar')}</h2>
                    <div class="cad-start-new">
                        <button type="button" class="cad-start-new-btn" data-start-new><i class="bi bi-plus-circle"></i><span>${tr('Novo desenho')}</span></button>
                        <label class="cad-start-template"><span>${tr('Modelo')}</span>
                            <select data-start-template><option value="">${tr('Em branco (mm)')}</option>${templates}</select>
                        </label>
                    </div>
                    <button type="button" class="cad-start-open" data-start-open><i class="bi bi-folder2-open"></i> ${tr('Abrir desenho')}</button>
                </div>
                <div class="cad-start-recents">
                    <h2 class="cad-start-title">${tr('Arquivos recentes')}</h2>
                    ${cards ? `<div class="cad-start-grid">${cards}</div>` : `<p class="cad-start-empty">${tr('Nenhum arquivo aberto ainda. Os desenhos abertos ou salvos no Traço aparecem aqui.')}</p>`}
                </div>
            </div>
            <label class="cad-start-show"><input type="checkbox" data-start-show ${showOnStart() ? 'checked' : ''}> ${tr('Mostrar ao iniciar')}</label>`;
        this.recents = recents;
    }

    async onClick(event) {
        const target = event.target.closest('button');
        if (!target) return;
        if (target.matches('[data-start-new]')) {
            const index = this.el.querySelector('[data-start-template]')?.value;
            const template = index !== '' && index != null ? this.recents[Number(index)] : null;
            if (template) await this.handlers.onTemplate?.(template);
            else this.handlers.onNew?.();
        } else if (target.matches('[data-start-open]')) {
            this.handlers.onOpen?.();
        } else if (target.matches('[data-start-recent]')) {
            await this.handlers.onOpenRecent?.(this.recents[Number(target.dataset.startRecent)]);
        }
    }
}
