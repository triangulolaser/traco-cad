// Interpretação de entrada do terminal de comandos.
// Aceita: "10,20" absoluto; "@5,3" relativo; "@10<45" polar relativo; "10<45" polar absoluto;
// número puro (distância na direção do cursor, tratado pelo comando); palavras-chave.

import { degToRad, polar, add } from './geometry.js';
import { tr } from './i18n.js';

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const RE_ABS = new RegExp(`^(${NUMBER})\\s*,\\s*(${NUMBER})$`);
const RE_REL = new RegExp(`^@\\s*(${NUMBER})\\s*,\\s*(${NUMBER})$`);
const RE_POLAR_REL = new RegExp(`^@\\s*(${NUMBER})\\s*<\\s*(${NUMBER})$`);
const RE_POLAR_ABS = new RegExp(`^(${NUMBER})\\s*<\\s*(${NUMBER})$`);
const RE_NUMBER = new RegExp(`^(${NUMBER})$`);

function num(text) {
    return Number(String(text).replace(',', '.'));
}

// Normaliza vírgula decimal quando o usuário digita "10,5" querendo 10.5?
// Não: no CAD a vírgula separa X de Y. Ponto decimal é obrigatório.

// dynamic: com ponto de referência ativo, "x,y" e "d<a" são relativos (entrada dinâmica);
// "#x,y" força absoluto; "@" continua relativo.
export function parsePointInput(text, { last = null, dynamic = false } = {}) {
    let raw = String(text ?? '').trim();
    if (!raw) return null;
    let forceAbsolute = false;
    if (raw.startsWith('#')) {
        forceAbsolute = true;
        raw = raw.slice(1).trim();
    }
    const relativeByDefault = dynamic && last && !forceAbsolute;
    let m;
    if ((m = RE_REL.exec(raw))) {
        if (!last) return { error: 'Não há ponto anterior para coordenada relativa.' };
        return { point: add(last, { x: num(m[1]), y: num(m[2]) }), relative: true };
    }
    if ((m = RE_POLAR_REL.exec(raw))) {
        if (!last) return { error: 'Não há ponto anterior para coordenada polar.' };
        return { point: polar(last, degToRad(num(m[2])), num(m[1])), relative: true };
    }
    if ((m = RE_ABS.exec(raw))) {
        const p = { x: num(m[1]), y: num(m[2]) };
        return relativeByDefault ? { point: add(last, p), relative: true } : { point: p, relative: false };
    }
    if ((m = RE_POLAR_ABS.exec(raw))) {
        const origin = relativeByDefault ? last : { x: 0, y: 0 };
        return { point: polar(origin, degToRad(num(m[2])), num(m[1])), relative: Boolean(relativeByDefault) };
    }
    return null;
}

export function parseNumberInput(text) {
    const raw = String(text ?? '').trim().replace(',', '.');
    const m = RE_NUMBER.exec(raw);
    if (!m) return null;
    const value = Number(m[1]);
    return Number.isFinite(value) ? value : null;
}

// Palavra-chave de opção: "C" casa com "Close"/"Centro" quando a opção define a letra em maiúsculas.
export function matchKeyword(text, options) {
    const raw = String(text ?? '').trim().toLowerCase();
    if (!raw) return null;
    for (const option of options) {
        const key = option.key.toLowerCase();
        const label = option.label.toLowerCase();
        if (raw === key || raw === label || (raw.length > 1 && label.startsWith(raw))) return option;
    }
    // Interface em outro idioma: aceita o rótulo traduzido e a letra destacada nele.
    const keys = shownKeys(options);
    for (let i = 0; i < options.length; i++) {
        const shown = tr(options[i].label);
        if (shown === options[i].label) continue;
        const label = shown.toLowerCase();
        if (raw === label || (raw.length > 1 && label.startsWith(raw)) || raw === keys[i].toLowerCase()) return options[i];
    }
    return null;
}

// Tecla de cada opção no idioma da interface: a inicial do rótulo traduzido; se outra
// opção já usa essa letra, a primeira letra livre do rótulo. Sem tradução, a tecla original.
function shownKeys(options) {
    const used = new Set();
    return options.map((option) => {
        const shown = tr(option.label);
        if (shown === option.label) {
            used.add(option.key.toLowerCase());
            return option.key;
        }
        const letters = [...shown.toLowerCase()].filter((c) => /[a-zà-ú0-9]/.test(c));
        const pick = letters.find((c) => !used.has(c)) ?? option.key.toLowerCase();
        used.add(pick);
        return pick;
    });
}

export function formatOptions(options) {
    if (!options || options.length === 0) return '';
    const keys = shownKeys(options);
    return ` [${options.map((o, i) => highlightKey(o, keys[i])).join('/')}]`;
}

function highlightKey(option, shownKey = option.key) {
    const label = tr(option.label);
    const key = shownKey;
    const idx = label.toLowerCase().indexOf(key.toLowerCase());
    if (idx < 0) return `${label}(${key.toUpperCase()})`;
    return `${label.slice(0, idx)}${label.slice(idx, idx + key.length).toUpperCase()}${label.slice(idx + key.length)}`;
}

// Tokeniza a linha do terminal: primeiro token é o comando, o restante são argumentos crus.
export function splitCommandLine(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return { name: '', args: [] };
    const parts = raw.split(/\s+/);
    return { name: parts[0].toUpperCase(), args: parts.slice(1) };
}
