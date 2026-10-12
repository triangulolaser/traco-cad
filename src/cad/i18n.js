// Idioma da interface do Traço. O código continua escrito em português: a chave de
// cada tradução é o próprio texto original, e "{0}", "{1}"... marcam os trechos
// variáveis de mensagens montadas com template string. A tradução acontece na saída
// (terminal, prompts, opções, HTML da interface e rótulos desenhados no canvas), sem
// espalhar t() pelas centenas de mensagens do motor. Em pt-BR nada é alterado.
import en from './locales/en.js';
import es from './locales/es.js';

export const SOURCE_LOCALE = 'pt-BR';
export const LOCALES = {
    'pt-BR': { label: 'Português', dict: null },
    en: { label: 'English', dict: en },
    es: { label: 'Español', dict: es },
};
export const LOCALE_STORAGE_KEY = 'mvp-cad:locale';

let current = SOURCE_LOCALE;
const compiled = new Map(); // locale -> { exact: Map, patterns: [{ re, keys, out }] }
const cache = new Map(); // locale -> Map(texto original -> traduzido)

export function normalizeLocale(value) {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return null;
    if (v.startsWith('pt')) return 'pt-BR';
    if (v.startsWith('es')) return 'es';
    if (v.startsWith('en')) return 'en';
    return null;
}

/** Configuração salva > data-cad-locale do root > idioma do sistema (pt, es; resto inglês). */
export function detectLocale({ root = null, storage = globalThis.localStorage, navigatorLike = globalThis.navigator } = {}) {
    let saved = null;
    try { saved = storage?.getItem?.(LOCALE_STORAGE_KEY); } catch { /* sem armazenamento */ }
    const fromSaved = normalizeLocale(saved);
    if (fromSaved) return fromSaved;
    const fromRoot = normalizeLocale(root?.dataset?.cadLocale);
    if (fromRoot) return fromRoot;
    // Sem navegador (testes em Node) fica no idioma do código.
    if (!navigatorLike || /node\.js/i.test(navigatorLike.userAgent || '')) return SOURCE_LOCALE;
    const langs = navigatorLike?.languages?.length ? navigatorLike.languages : [navigatorLike?.language];
    for (const lang of langs || []) {
        const n = normalizeLocale(lang);
        if (n) return n;
    }
    return 'en';
}

export function getLocale() {
    return current;
}

export function setLocale(locale) {
    current = LOCALES[locale] ? locale : SOURCE_LOCALE;
    return current;
}

export function saveLocale(locale, storage = globalThis.localStorage) {
    try { storage?.setItem?.(LOCALE_STORAGE_KEY, locale); } catch { /* sem armazenamento */ }
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(locale) {
    if (compiled.has(locale)) return compiled.get(locale);
    const dict = LOCALES[locale]?.dict || {};
    const exact = new Map();
    const patterns = [];
    for (const [key, out] of Object.entries(dict)) {
        if (!/\{\d+\}/.test(key)) {
            exact.set(key, out);
            continue;
        }
        const keys = [];
        const source = key.split(/(\{\d+\})/).map((part) => {
            const m = /^\{(\d+)\}$/.exec(part);
            if (m) {
                keys.push(m[1]);
                return '([\\s\\S]*?)';
            }
            return escapeRe(part);
        }).join('');
        // Quanto mais texto fixo, mais específico: testado antes.
        patterns.push({ re: new RegExp(`^${source}$`), keys, out, weight: key.replace(/\{\d+\}/g, '').length });
    }
    patterns.sort((a, b) => b.weight - a.weight);
    const entry = { exact, patterns };
    compiled.set(locale, entry);
    return entry;
}

function translateCore(text, locale) {
    const { exact, patterns } = compile(locale);
    const hit = exact.get(text);
    if (hit !== undefined) return hit;
    for (const p of patterns) {
        const m = p.re.exec(text);
        if (!m) continue;
        const values = {};
        p.keys.forEach((k, i) => { values[k] = m[i + 1]; });
        // O que veio de fora (nome de arquivo, camada) não é traduzido; trechos que são
        // textos da interface montados dentro da mensagem, sim.
        return p.out.replace(/\{(\d+)\}/g, (_, k) => {
            const v = values[k] ?? '';
            return exact.get(v.trim()) !== undefined ? v.replace(v.trim(), exact.get(v.trim())) : v;
        });
    }
    return null;
}

/** Traduz um texto da interface para o idioma atual; devolve o original se não houver tradução. */
export function tr(text, locale = current) {
    if (locale === SOURCE_LOCALE || text == null) return text;
    const raw = String(text);
    const trimmed = raw.trim();
    if (!trimmed || !/[A-Za-zÀ-ú]/.test(trimmed)) return raw;
    let byLocale = cache.get(locale);
    if (!byLocale) {
        byLocale = new Map();
        cache.set(locale, byLocale);
    }
    if (byLocale.has(raw)) return byLocale.get(raw);
    const core = translateCore(trimmed.replace(/\s+/g, ' '), locale);
    const out = core == null ? raw : raw.replace(trimmed, core);
    if (byLocale.size > 5000) byLocale.clear();
    byLocale.set(raw, out);
    return out;
}

/** Igual a tr(), com valores nomeados: t('{n} item(ns)', { n: 3 }). */
export function t(key, vars = null) {
    let out = tr(key);
    if (vars) out = String(out).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return out;
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tooltip', 'data-label', 'alt'];
const SKIP = 'script, style, textarea, input, select option[data-cad-layer-option], [data-i18n-skip], [contenteditable="true"]';

function shouldSkip(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !el || !!el.closest?.(SKIP);
}

const lastOut = new WeakMap(); // nó -> último texto que escrevemos (evita retraduzir o já traduzido)

function translateNode(node) {
    if (node.nodeType === 3) {
        const value = node.nodeValue;
        if (lastOut.get(node) === value || shouldSkip(node)) return;
        const out = tr(value);
        if (out !== value) node.nodeValue = out;
        lastOut.set(node, out);
        return;
    }
    if (node.nodeType !== 1 || shouldSkip(node)) return;
    for (const name of ATTRS) {
        const value = node.getAttribute?.(name);
        if (value == null) continue;
        const out = tr(value);
        if (out !== value) node.setAttribute(name, out);
    }
    for (const child of node.childNodes) translateNode(child);
}

/** Traduz o HTML da interface e acompanha o que for criado depois (painéis, modais, terminal). */
export function translateDom(root, { observe = true } = {}) {
    if (!root || current === SOURCE_LOCALE) return null;
    translateNode(root);
    if (!observe || typeof MutationObserver === 'undefined') return null;
    const observer = new MutationObserver((records) => {
        for (const r of records) {
            if (r.type === 'characterData') translateNode(r.target);
            else if (r.type === 'attributes') translateNode(r.target);
            else r.addedNodes.forEach((n) => translateNode(n));
        }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    return observer;
}
