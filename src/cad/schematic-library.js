// Bibliotecas de símbolos do esquemático (formato traco-simbolo v1, ADR 0007).
//
// A definição de símbolo é JSON com a geometria do próprio Traço e portas com as chaves do
// `terminal` (name, position, orientation, type, required). O documento referencia a definição
// por "<biblioteca>/<id>"; este módulo guarda as bibliotecas carregadas e resolve a referência.
// A biblioteca ISO 1219 genérica vem embutida; outras entram por arquivo (SIMBIB).

import iso1219 from './schematic-lib/iso1219.js';
import tracoLib from './schematic-lib/traco.js';

export const PORT_TYPES = ['pressao', 'retorno', 'succao', 'trabalho', 'piloto', 'dreno', 'passante'];
export const ORIENTATIONS = ['n', 's', 'e', 'w'];
export const SYMBOL_ENTITY_TYPES = ['line', 'circle', 'arc', 'polyline', 'hatch', 'text'];
export const PORT_GRID = 5;

const SLUG = /^[a-z0-9-]+$/;

function finite(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function isPoint(p) {
    return p && finite(p.x) && finite(p.y);
}

function samePoint(a, b) {
    return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

// Pontas de linha do desenho do símbolo: a porta tem de cair numa delas.
function drawingEnds(geometry) {
    const out = [];
    for (const e of geometry) {
        if (e.type === 'line' && isPoint(e.start) && isPoint(e.end)) out.push(e.start, e.end);
        else if (e.type === 'polyline' && Array.isArray(e.vertices) && e.vertices.length) out.push(e.vertices[0], e.vertices[e.vertices.length - 1]);
    }
    return out;
}

// Mesmas conferências do gerador da biblioteca. Devolve a lista de problemas (vazia = válido).
export function validateSymbol(s) {
    const errors = [];
    if (!s || typeof s !== 'object') return ['definição vazia'];
    for (const key of ['formato', 'versao', 'id', 'nome', 'categoria', 'unidade', 'geometria', 'portas', 'atributos']) {
        if (!(key in s)) errors.push(`falta ${key}`);
    }
    if (s.formato !== 'traco-simbolo' || s.versao !== 1) errors.push('formato/versão');
    if (s.id !== undefined && !SLUG.test(String(s.id))) errors.push(`id inválido: ${s.id}`);
    if (s.unidade !== undefined && s.unidade !== 'mm') errors.push('unidade diferente de mm');
    if (s.rede_global !== undefined && (typeof s.rede_global !== 'string' || !s.rede_global.trim())) errors.push('rede_global inválida');
    if (s.conector !== undefined && typeof s.conector !== 'boolean') errors.push('conector não é booleano');
    if (s.conector && (!Array.isArray(s.portas) || s.portas.length !== 1)) errors.push('conector com mais de uma porta');
    const geometry = Array.isArray(s.geometria) ? s.geometria : [];
    if (s.geometria !== undefined && !Array.isArray(s.geometria)) errors.push('geometria não é lista');
    for (const e of geometry) {
        if (!SYMBOL_ENTITY_TYPES.includes(e?.type)) errors.push(`entidade ${e?.type} fora da lista`);
    }
    const ports = Array.isArray(s.portas) ? s.portas : [];
    if (s.portas !== undefined && !Array.isArray(s.portas)) errors.push('portas não é lista');
    const names = ports.map((p) => p?.name);
    if (new Set(names).size !== names.length) errors.push('porta repetida');
    const ends = drawingEnds(geometry);
    for (const p of ports) {
        const label = p?.name ?? '?';
        if (typeof p?.name !== 'string' || !p.name) errors.push('porta sem nome');
        if (!PORT_TYPES.includes(p?.type)) errors.push(`porta ${label}: tipo ${p?.type}`);
        if (!ORIENTATIONS.includes(p?.orientation)) errors.push(`porta ${label}: orientação`);
        if (typeof p?.required !== 'boolean') errors.push(`porta ${label}: required`);
        if (p?.type === 'passante' && p?.required === false) errors.push(`porta ${label}: passante é sempre obrigatória`);
        if (!isPoint(p?.position)) {
            errors.push(`porta ${label}: posição`);
            continue;
        }
        if (p.position.x % PORT_GRID || p.position.y % PORT_GRID) errors.push(`porta ${label} fora da grade de ${PORT_GRID} mm`);
        if (!ends.some((q) => samePoint(q, p.position))) errors.push(`porta ${label} solta do desenho`);
    }
    const attrs = Array.isArray(s.atributos) ? s.atributos : [];
    if (!attrs.some((a) => a?.nome === 'etiqueta' && a.prefixo)) errors.push('sem prefixo de etiqueta');
    return errors;
}

export function validateManifest(m) {
    const errors = [];
    if (!m || m.formato !== 'traco-biblioteca' || m.versao !== 1) errors.push('manifesto: formato/versão');
    if (!m?.id || !SLUG.test(String(m.id))) errors.push('manifesto: id inválido');
    if (!m?.versao_biblioteca) errors.push('manifesto: falta versao_biblioteca');
    if (!Array.isArray(m?.simbolos)) errors.push('manifesto: simbolos não é lista');
    if (m?.rotulos !== undefined && (!m.rotulos || typeof m.rotulos !== 'object' || Array.isArray(m.rotulos)
        || Object.values(m.rotulos).some((v) => typeof v !== 'string'))) errors.push('manifesto: rotulos inválido');
    return errors;
}

// Monta a biblioteca a partir do manifesto e das definições. Erro lista todos os problemas.
export function buildLibrary(manifest, symbols) {
    const errors = validateManifest(manifest);
    const map = new Map();
    for (const s of symbols ?? []) {
        const problems = validateSymbol(s);
        problems.forEach((p) => errors.push(`${s?.id ?? '?'}: ${p}`));
        if (s?.id && map.has(s.id)) errors.push(`${s.id}: id repetido na biblioteca`);
        if (!problems.length && s?.id) map.set(s.id, Object.freeze(structuredClone(s)));
    }
    if (errors.length) {
        const error = new Error(`Biblioteca inválida: ${errors.join('; ')}`);
        error.problems = errors;
        throw error;
    }
    const library = { id: manifest.id, nome: manifest.nome ?? manifest.id, versao_biblioteca: manifest.versao_biblioteca, simbolos: map };
    // Nome de tela dos atributos (decisão 10 do formato): vale para a biblioteca inteira.
    if (manifest.rotulos && Object.keys(manifest.rotulos).length) library.rotulos = Object.freeze({ ...manifest.rotulos });
    return library;
}

// Bibliotecas que vêm com o Traço: não saem nem são substituídas pelo SIMBIB.
export const BUILTIN_LIBRARY_IDS = new Set([iso1219.manifesto.id, tracoLib.manifesto.id]);

export function isBuiltinLibrary(id) {
    return BUILTIN_LIBRARY_IDS.has(id);
}

const DEFAULT_ATTRIBUTE_LABELS = { etiqueta: 'Etiqueta', descricao: 'Descrição', codigo: 'Código', sinal: 'Sinal' };

// Nome do atributo na tela: o da biblioteca do símbolo, senão o padrão.
export function attributeLabel(ref, nome) {
    const lib = registry.get(splitRef(ref).library);
    return lib?.rotulos?.[nome] ?? DEFAULT_ATTRIBUTE_LABELS[nome] ?? nome.charAt(0).toUpperCase() + nome.slice(1);
}

const registry = new Map();

export function registerLibrary(library) {
    registry.set(library.id, library);
    return library;
}

export function unregisterLibrary(id) {
    if (BUILTIN_LIBRARY_IDS.has(id)) return false;
    return registry.delete(id);
}

export function libraries() {
    return [...registry.values()];
}

export function getLibrary(id) {
    return registry.get(id) ?? null;
}

export function splitRef(ref) {
    const text = String(ref ?? '');
    const i = text.indexOf('/');
    return i > 0 ? { library: text.slice(0, i), id: text.slice(i + 1) } : { library: '', id: text };
}

export function getSymbolDef(ref) {
    const { library, id } = splitRef(ref);
    return registry.get(library)?.simbolos.get(id) ?? null;
}

// Busca por nome, id ou categoria; sem termo devolve tudo, em ordem estável.
export function searchSymbols(query = '') {
    const words = String(query).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
    const out = [];
    for (const lib of registry.values()) {
        for (const def of lib.simbolos.values()) {
            const hay = `${lib.id}/${def.id} ${def.nome} ${def.categoria}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            if (words.every((w) => hay.includes(w))) out.push({ ref: `${lib.id}/${def.id}`, def });
        }
    }
    return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

// Arquivos de uma pasta de biblioteca: [{ name, text }]. O manifesto é o biblioteca.json.
export function libraryFromFiles(files) {
    const byName = new Map(files.map((f) => [String(f.name).split(/[\\/]/).pop(), f.text]));
    const manifestText = byName.get('biblioteca.json');
    if (!manifestText) throw new Error('Pasta sem biblioteca.json.');
    const manifest = JSON.parse(manifestText);
    const symbols = (manifest.simbolos ?? []).map((name) => {
        const text = byName.get(String(name).split(/[\\/]/).pop());
        if (text === undefined) throw new Error(`Símbolo ${name} listado no manifesto e ausente na pasta.`);
        return JSON.parse(text);
    });
    return buildLibrary(manifest, symbols);
}

// Pacote único (um JSON com manifesto e símbolos), como a biblioteca embutida e o que o SIMBIB guarda.
export function libraryFromBundle(bundle) {
    return buildLibrary(bundle?.manifesto, bundle?.simbolos);
}

export function libraryToBundle(library) {
    const { id, nome, versao_biblioteca, rotulos } = library;
    const simbolos = [...library.simbolos.values()];
    const manifesto = { formato: 'traco-biblioteca', versao: 1, id, nome, versao_biblioteca, simbolos: simbolos.map((s) => `${s.id}.json`) };
    if (rotulos) manifesto.rotulos = { ...rotulos };
    return { manifesto, simbolos };
}

export const BUILTIN_LIBRARY_ID = iso1219.manifesto.id;
export const CONNECTOR_REF = `${tracoLib.manifesto.id}/conector-pagina`;
registerLibrary(libraryFromBundle(iso1219));
registerLibrary(libraryFromBundle(tracoLib));
