// Arquivo nativo do esquemático (.traco, ADR 0007): JSON com chaves ordenadas e 2 espaços.
//
// Determinístico: o mesmo documento gera sempre o mesmo texto. Só vai para o arquivo o que não é
// derivado: pontas das ligações e traçado automático saem das portas ao abrir; ligação com vértice
// manual grava os vértices. Assim, mover um símbolo muda só a posição dele no diff.

import { createDocument, ensureEntityIds } from './document.js';
import { getSymbolDef, getLibrary, splitRef } from './schematic-library.js';
import { syncSchematic, SCHEMATIC_TYPES, normalizeWire } from './schematic.js';
import { MODE_CAD, MODE_SCHEMATIC, isSchematicDocument, entitySheet, sheetsOf, normalizeSchematicDocument } from './schematic-mode.js';
import { normalizeTitleBlock } from './schematic-sheet.js';

export const TRACO_FORMAT = 'traco-esquema';
export const TRACO_VERSION = 1;

// Coordenadas do esquema em 0,0001 mm: tira o ruído de ponto flutuante sem mexer no desenho.
function coord(v) {
    const r = Math.round(v * 1e4) / 1e4;
    return Object.is(r, -0) ? 0 : r;
}

function point(p) {
    return { x: coord(p.x), y: coord(p.y) };
}

function end(e) {
    if (e?.symbol !== undefined) return { porta: e.port, simbolo: e.symbol };
    if (e?.junction !== undefined) return { juncao: e.junction };
    return { ponto: point(e?.point ?? { x: 0, y: 0 }) };
}

function readEnd(e) {
    if (e?.simbolo !== undefined) return { symbol: String(e.simbolo), port: String(e.porta) };
    if (e?.juncao !== undefined) return { junction: String(e.juncao) };
    return { point: { x: Number(e?.ponto?.x) || 0, y: Number(e?.ponto?.y) || 0 } };
}

// Campos internos (cache) nunca vão para o arquivo.
function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) {
            if (k.startsWith('_') || value[k] === undefined) continue;
            out[k] = clean(value[k]);
        }
        return out;
    }
    if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
    return value;
}

function common(e, sheetOf) {
    const out = { id: e.id, camada: e.layer ?? '0' };
    if (e.color !== undefined && e.color !== 'bylayer') out.cor = e.color;
    const folha = sheetOf(e);
    if (folha) out.folha = folha;
    return out;
}

export function documentToTraco(doc) {
    const simbolos = [];
    const juncoes = [];
    const ligacoes = [];
    const anotacoes = [];
    const used = new Map();
    const present = new Set(doc.entities.filter((e) => e.type === 'symbol' || e.type === 'junction').map((e) => e.id));
    // Modo e folhas (E2a). Documento CAD com símbolo (inserido pelo terminal) grava `modo: "cad"`
    // e não tem folhas; reabre no CAD.
    const schematic = isSchematicDocument(doc);
    const sheetOf = (e) => (schematic ? entitySheet(doc, e) : null);
    const missing = (x) => (x?.symbol !== undefined ? !present.has(x.symbol) : x?.junction !== undefined ? !present.has(x.junction) : false);
    for (const e of doc.entities) {
        if (e.type === 'symbol') {
            const { library } = splitRef(e.def);
            const lib = getLibrary(library);
            used.set(library, lib?.versao_biblioteca ?? null);
            const s = { ...common(e, sheetOf), def: e.def, posicao: point(e.position), rotacao: e.rotation ?? 0, espelho: Boolean(e.espelho), atributos: { ...(e.atributos ?? {}) } };
            const offsets = Object.entries(e.deslocamentos ?? {}).filter(([, v]) => v && (v.x || v.y));
            if (offsets.length) s.deslocamentos = Object.fromEntries(offsets.map(([k, v]) => [k, point(v)]));
            simbolos.push(s);
        } else if (e.type === 'junction') {
            juncoes.push({ ...common(e, sheetOf), posicao: point(e.position) });
        } else if (e.type === 'link') {
            const l = { ...common(e, sheetOf), de: end(e.from), para: end(e.to) };
            if (e.manual && (e.vertices ?? []).length) l.vertices = e.vertices.map(point);
            if (e.route) l.tracado = e.route;
            if (String(e.rotulo ?? '').trim()) l.rotulo = String(e.rotulo).trim();
            const fio = normalizeWire(e.fio);
            if (fio) l.fio = fio;
            // Pontas são derivadas das portas. Só a ligação solta (símbolo ou junção apagados) grava
            // onde estava, para reabrir no lugar.
            if (e.ends?.length === 2 && (missing(e.from) || missing(e.to))) l.pontas = e.ends.map(point);
            ligacoes.push(l);
        } else {
            const { ends, sheet, ...rest } = e;
            if (schematic) rest.sheet = entitySheet(doc, e);
            anotacoes.push(rest);
        }
    }
    const out = {
        formato: TRACO_FORMAT,
        versao: TRACO_VERSION,
        modo: schematic ? MODE_SCHEMATIC : MODE_CAD,
        unidade: doc.units ?? 'mm',
        bibliotecas: [...used].sort(([a], [b]) => a.localeCompare(b)).map(([id, versao]) => ({ id, versao_biblioteca: versao })),
        camadas: doc.layers ?? [],
        camada_atual: doc.currentLayer ?? '0',
        estilo_cota: doc.dimStyle ?? null,
        ...(schematic ? { folhas: sheetsOf(doc).map((f) => ({ formato: f.formato ?? 'A4', id: f.id, nome: f.nome })) } : {}),
        ...(schematic && Object.keys(normalizeTitleBlock(doc.carimbo)).length ? { carimbo: normalizeTitleBlock(doc.carimbo) } : {}),
        simbolos,
        juncoes,
        ligacoes,
        anotacoes,
    };
    return `${JSON.stringify(clean(out), null, 2)}\n`;
}

// Abre o .traco. Devolve { doc, warnings }: biblioteca ou símbolo ausente não impede abrir
// (a instância aparece como quadrado até a biblioteca ser carregada).
export function tracoToDocument(text, { name = 'esquema.traco' } = {}) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`Arquivo .traco ilegível: ${error.message}`);
    }
    if (data?.formato !== TRACO_FORMAT) throw new Error('Não é um arquivo de esquema do Traço.');
    if (data.versao !== TRACO_VERSION) throw new Error(`Versão ${data.versao} do .traco não suportada.`);
    const warnings = [];
    const base = createDocument();
    const entities = [];
    for (const lib of data.bibliotecas ?? []) {
        const loaded = getLibrary(lib.id);
        if (!loaded) warnings.push(`Biblioteca ${lib.id} não carregada.`);
        else if (lib.versao_biblioteca && loaded.versao_biblioteca !== lib.versao_biblioteca) warnings.push(`Biblioteca ${lib.id}: arquivo usa ${lib.versao_biblioteca}, carregada ${loaded.versao_biblioteca}.`);
    }
    // Sem `modo` é esquema da E1 (o formato só existia para esquema); `modo: "cad"` reabre no CAD.
    const schematic = data.modo !== MODE_CAD;
    const tail = (e) => {
        const out = { id: String(e.id), layer: e.camada ?? '0' };
        if (e.cor !== undefined) out.color = e.cor;
        if (schematic && e.folha !== undefined) out.sheet = String(e.folha);
        return out;
    };
    for (const s of data.simbolos ?? []) {
        if (!getSymbolDef(s.def)) warnings.push(`Símbolo ${s.def} ausente nas bibliotecas carregadas.`);
        const e = { type: 'symbol', ...tail(s), def: s.def, position: { x: s.posicao.x, y: s.posicao.y }, rotation: s.rotacao ?? 0, espelho: Boolean(s.espelho), atributos: { ...(s.atributos ?? {}) } };
        if (s.deslocamentos) e.deslocamentos = structuredClone(s.deslocamentos);
        entities.push(e);
    }
    for (const j of data.juncoes ?? []) entities.push({ type: 'junction', ...tail(j), position: { x: j.posicao.x, y: j.posicao.y } });
    for (const l of data.ligacoes ?? []) {
        const e = { type: 'link', ...tail(l), from: readEnd(l.de), to: readEnd(l.para) };
        if (l.vertices?.length) {
            e.vertices = l.vertices.map((v) => ({ x: v.x, y: v.y }));
            e.manual = true;
        }
        if (l.tracado) e.route = l.tracado;
        if (l.rotulo) e.rotulo = String(l.rotulo);
        const fio = normalizeWire(l.fio);
        if (fio) e.fio = fio;
        if (l.pontas?.length === 2) e.ends = l.pontas.map((p) => ({ x: p.x, y: p.y }));
        entities.push(e);
    }
    for (const a of data.anotacoes ?? []) {
        if (SCHEMATIC_TYPES.has(a?.type)) continue;
        const copy = structuredClone(a);
        if (!schematic) delete copy.sheet;
        entities.push(copy);
    }
    // Ordem do documento: anotações primeiro (ficam por baixo), depois ligações, junções e símbolos.
    const order = { link: 1, junction: 2, symbol: 3 };
    entities.sort((a, b) => (order[a.type] ?? 0) - (order[b.type] ?? 0));
    // Ligações sem `ends` gravado ganham o traçado agora; as com `ends` são refeitas contra as portas.
    const withoutCache = entities.map((e) => (e.type === 'link' && !e.manual ? { ...e, vertices: undefined } : e));
    let doc = {
        ...base,
        name,
        sourceFormat: 'traco',
        units: data.unidade ?? 'mm',
        layers: Array.isArray(data.camadas) && data.camadas.length ? data.camadas : base.layers,
        currentLayer: data.camada_atual ?? base.currentLayer,
        dimStyle: data.estilo_cota ?? base.dimStyle,
        entities: withoutCache,
    };
    if (schematic) {
        doc.mode = MODE_SCHEMATIC;
        doc.sheets = Array.isArray(data.folhas) ? data.folhas : [];
        const carimbo = normalizeTitleBlock(data.carimbo);
        if (Object.keys(carimbo).length) doc.carimbo = carimbo;
        doc = normalizeSchematicDocument(doc);
        const valid = new Set(doc.sheets.map((f) => f.id));
        const unknown = doc.entities.filter((e) => e.sheet && !valid.has(e.sheet));
        if (unknown.length) warnings.push(`${unknown.length} objeto(s) em folha inexistente foram para ${doc.sheets[0].nome}.`);
        doc.entities = doc.entities.map((e) => (e.sheet && valid.has(e.sheet) ? e : { ...e, sheet: doc.sheets[0].id }));
    }
    doc = ensureEntityIds(doc);
    doc = syncSchematic(doc);
    return { doc, warnings };
}
