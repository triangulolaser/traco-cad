// Comandos do esquemático (ADR 0007): SIMBOLO, LIGAR, SIMBIB e VERIFICAR.

import { addEntities, updateEntities, newId } from './document.js';
import {
    searchSymbols, getSymbolDef, libraryFromFiles, libraryFromBundle, libraryToBundle, registerLibrary, isBuiltinLibrary,
} from './schematic-library.js';
import {
    MODE_CAD, MODE_SCHEMATIC, documentMode, canSwitchMode, withMode, sheetsOf, activeSheetId, addSheet, renameSheet,
    removeSheet, setActiveSheet, sheetFrame, sheetEntityCounts,
} from './schematic-mode.js';
import { schematicBom } from './schematic-bom.js';
import {
    createSymbol, nextLabel, findPortNear, findJunctionNear, findLinkNear, splitLinkAt, routeLink, analyzeSchematic,
} from './schematic.js';

const STORAGE_KEY = 'traco:esquema:bibliotecas';
const PICK_PX = 10;

function storedBundles() {
    try {
        return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}') ?? {};
    } catch {
        return {};
    }
}

// Bibliotecas carregadas pelo SIMBIB voltam ao abrir o Traço de novo neste navegador.
export function restoreStoredLibraries() {
    const out = [];
    for (const [id, bundle] of Object.entries(storedBundles())) {
        if (isBuiltinLibrary(id)) continue;
        try {
            out.push(registerLibrary(libraryFromBundle(bundle)).id);
        } catch {
            // Biblioteca guardada que deixou de passar na conferência fica de fora até ser recarregada.
        }
    }
    return out;
}

restoreStoredLibraries();

function tolerance(e) {
    return PICK_PX / (e.viewport?.scale || 1);
}

async function chooseSymbol(e, args = []) {
    // Símbolo já escolhido na biblioteca da tela: chega como referência completa.
    const direct = args[0] ? getSymbolDef(args[0]) : null;
    if (direct) return { ref: args[0], def: direct };
    const query = (await e.getString('Símbolo (nome ou categoria; Enter lista todos)', { allowEmpty: true })) ?? '';
    const found = searchSymbols(query);
    if (!found.length) throw new Error(`Nenhum símbolo encontrado para "${query}".`);
    if (found.length === 1) return found[0];
    found.forEach((s, i) => e.log(`${i + 1}: ${s.def.nome} (${s.ref}, ${s.def.categoria})`));
    const n = await e.getNumber('Número do símbolo', { min: 1, max: found.length });
    const pick = found[Math.round(n) - 1];
    if (!pick) throw new Error('Número fora da lista.');
    return pick;
}

async function insertSymbol(e, args = []) {
    const { ref, def } = await chooseSymbol(e, args);
    const prefix = def.atributos.find((a) => a.nome === 'etiqueta')?.prefixo ?? '';
    const extra = {};
    if (def.conector) {
        // O sinal liga este conector aos outros com o mesmo nome, em qualquer folha.
        const sinal = String((await e.getString('Sinal do conector (o mesmo nome liga as folhas)')) ?? '').trim();
        if (!sinal) throw new Error('Conector sem sinal.');
        extra.sinal = sinal;
    }
    let rotation = 0;
    let espelho = false;
    e.log(`${def.nome}: Enter ou espaço gira 90°, M espelha, Esc cancela.`);
    for (;;) {
        const etiqueta = nextLabel(e.doc, prefix);
        const make = (p) => createSymbol(ref, p, { rotation, espelho, atributos: { etiqueta, ...extra }, layer: e.doc.currentLayer });
        const res = await e.getPoint('Ponto de inserção', {
            options: [{ key: 'r', label: 'Girar' }, { key: 'm', label: 'Espelhar' }],
            preview: (p) => [make(p)],
        });
        if (!res) return;
        if (res.keyword === 'm') {
            espelho = !espelho;
            continue;
        }
        if (res.enter || res.keyword === 'r') {
            rotation = (rotation + 90) % 360;
            continue;
        }
        if (!res.point) return;
        e.commit('Inserir símbolo', addEntities(e.doc, [make(res.point)]));
        e.log(`Símbolo ${etiqueta} inserido.`);
        return;
    }
}

// Ponto clicado → ponta da ligação: porta, junção, meio de ligação (vira junção) ou ponto livre.
function pickEnd(e, point) {
    const tol = tolerance(e);
    const port = findPortNear(e.doc, point, tol);
    if (port) return { end: { symbol: port.symbol.id, port: port.port.name }, point: port.port.position, orientation: port.port.orientation, label: `${port.symbol.atributos?.etiqueta ?? port.symbol.id}.${port.port.name}` };
    const junction = findJunctionNear(e.doc, point, tol);
    if (junction) return { end: { junction: junction.junction.id }, point: junction.junction.position, orientation: null };
    const onLink = findLinkNear(e.doc, point, tol);
    if (onLink) return { end: null, split: onLink, point: onLink.point, orientation: null };
    return { end: { point: { x: point.x, y: point.y } }, point: { x: point.x, y: point.y }, orientation: null, free: true };
}

function sameEnd(a, b) {
    return Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);
}

async function connect(e) {
    const first = await e.getPoint('Porta de origem');
    if (!first?.point) return;
    const a = pickEnd(e, first.point);
    if (a.free) e.log('Origem fora de porta: a ponta fica livre.', 'warn');
    let route = null;
    for (;;) {
        const res = await e.getPoint('Porta de destino', {
            reference: a.point,
            options: [{ key: 'l', label: 'L' }, { key: 'z', label: 'Z' }],
            preview: (cursor) => {
                const hover = findPortNear(e.doc, cursor, tolerance(e));
                const b = hover ? hover.port.position : cursor;
                const ob = hover ? hover.port.orientation : null;
                return [{ type: 'link', id: '__preview', from: { point: a.point }, to: { point: b }, ends: [a.point, b], vertices: routeLink(a.point, a.orientation, b, ob, route) }];
            },
        });
        if (!res) return;
        if (res.keyword === 'l' || res.keyword === 'z') {
            route = res.keyword.toUpperCase();
            continue;
        }
        if (!res.point) return;
        const b = pickEnd(e, res.point);
        if (sameEnd(a.end, b.end)) throw new Error('Origem e destino são a mesma porta.');
        let doc = e.doc;
        const added = [];
        const resolveSplit = (side) => {
            if (!side.split) return side.end;
            const junctionId = newId();
            const { first: kept, second, junction } = splitLinkAt(side.split.link, side.split.segment, side.split.point, junctionId, newId());
            doc = updateEntities(doc, [side.split.link.id], () => kept);
            added.push(second, junction);
            return { junction: junctionId };
        };
        const from = resolveSplit(a);
        const to = resolveSplit(b);
        if (b.free) e.log('Destino fora de porta: a ponta fica livre.', 'warn');
        const link = { type: 'link', from, to, layer: e.doc.currentLayer };
        if (route) link.route = route;
        added.push(link);
        e.commit('Ligar', addEntities(doc, added));
        e.log(b.label && a.label ? `Ligado ${a.label} a ${b.label}.` : 'Ligação criada.');
        return;
    }
}

async function loadLibrary(e) {
    const files = await e.pickFiles('.json');
    if (!files.length) return;
    const texts = await Promise.all(files.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })));
    let library;
    if (texts.length === 1) {
        const data = JSON.parse(texts[0].text);
        library = data?.manifesto ? libraryFromBundle(data) : libraryFromFiles(texts);
    } else {
        library = libraryFromFiles(texts);
    }
    if (isBuiltinLibrary(library.id)) throw new Error('A biblioteca embutida não pode ser substituída.');
    registerLibrary(library);
    try {
        const all = storedBundles();
        all[library.id] = libraryToBundle(library);
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        e.log('Biblioteca carregada só nesta sessão: o navegador recusou guardar.', 'warn');
    }
    e.log(`Biblioteca ${library.nome} (${library.id} ${library.versao_biblioteca}) carregada: ${library.simbolos.size} símbolo(s).`);
    e.invalidate?.();
}

function check(e) {
    const an = analyzeSchematic(e.doc);
    const name = (id) => {
        const s = e.doc.entities.find((x) => x.id === id);
        return s?.type === 'symbol' ? (s.atributos?.etiqueta || getSymbolDef(s.def)?.nome || id) : id;
    };
    if (an.loose.size) e.log(`${an.loose.size} ligação(ões) solta(s), em vermelho.`, 'warn');
    if (!an.problems.length) {
        e.log(`Esquema sem erros: ${an.nets.length} rede(s).`);
        return;
    }
    for (const p of an.problems) {
        if (p.code === 'E1') e.log(`E1 porta obrigatória sem ligação: ${name(p.ids[0])}.${p.port}`, 'error');
        else if (p.code === 'A6') e.log(p.sinal ? `A6 conector de página sem par: sinal ${p.sinal} (${name(p.ids[0])})` : `A6 conector de página sem sinal: ${name(p.ids[0])}`, 'warn');
        else if (p.code === 'A5') e.log(`A5 piloto ligado a linha de potência, confirmar: ${p.types.join(' + ')} (${p.ids.map(name).join(', ')})`, 'warn');
        else e.log(`E2 tipos incompatíveis na rede: ${p.types.join(' + ')} (${p.ids.map(name).join(', ')})`, 'error');
    }
    if (an.problems.every((p) => p.code === 'A5' || p.code === 'A6')) e.log(`Esquema sem erros: ${an.nets.length} rede(s).`);
    e.selection = new Set(an.problems.flatMap((p) => p.ids));
    e.invalidate?.();
    e.onChange?.(e);
}

// ---------------------------------------------------------------------------
// Modo e folhas

// Enquadra a folha ativa com uma margem.
export function zoomToSheet(e) {
    const f = sheetFrame(e.doc);
    if (!f) return;
    const m = 10;
    e.zoomToBox?.({ minX: f.minX - m, minY: f.minY - m, maxX: f.maxX + m, maxY: f.maxY + m });
}

// Troca de modo só com o desenho vazio. Devolve true se trocou (ou já estava no modo).
export function switchMode(e, mode) {
    if (documentMode(e.doc) === mode) return true;
    if (!canSwitchMode(e.doc)) {
        e.log(mode === MODE_CAD
            ? 'Esquema com objetos não volta para o CAD. Para levar o esquema ao CAD, salve em DXF (os símbolos viram geometria) e abra o DXF.'
            : 'A troca para o Esquemático só vale em desenho novo ou vazio. Abra uma aba nova.', 'warn');
        return false;
    }
    if (e.running) e.cancel?.();
    e.commit(mode === MODE_SCHEMATIC ? 'Modo Esquemático' : 'Modo CAD', withMode(e.doc, mode));
    e.selection?.clear?.();
    e.log(mode === MODE_SCHEMATIC ? 'Modo Esquemático: folha A4, biblioteca de símbolos e conferência ao vivo.' : 'Modo CAD.');
    if (mode === MODE_SCHEMATIC) zoomToSheet(e);
    e.invalidate?.();
    e.onChange?.(e);
    return true;
}

// Folha ativa é estado de vista: troca sem entrar no desfazer.
export function goToSheet(e, id) {
    const next = setActiveSheet(e.doc, id);
    if (next === e.doc) return false;
    e.history.replace(next);
    e.selection?.clear?.();
    zoomToSheet(e);
    e.invalidate?.();
    e.onChange?.(e);
    return true;
}

export function newSheet(e, nome = null) {
    const { doc, sheet } = addSheet(e.doc, nome);
    e.commit('Nova folha', doc);
    e.selection?.clear?.();
    zoomToSheet(e);
    e.log(`${sheet.nome} criada.`);
    e.invalidate?.();
    e.onChange?.(e);
    return sheet;
}

export function renameActiveSheet(e, nome) {
    e.commit('Renomear folha', renameSheet(e.doc, activeSheetId(e.doc), nome));
    e.onChange?.(e);
}

export function removeActiveSheet(e) {
    const id = activeSheetId(e.doc);
    const nome = sheetsOf(e.doc).find((s) => s.id === id)?.nome ?? id;
    const count = sheetEntityCounts(e.doc).get(id) ?? 0;
    e.commit('Excluir folha', removeSheet(e.doc, id));
    e.selection?.clear?.();
    e.log(count ? `${nome} excluída com ${count} objeto(s). Ctrl+Z desfaz.` : `${nome} excluída.`);
    zoomToSheet(e);
    e.invalidate?.();
    e.onChange?.(e);
}

async function modeCommand(e, args = []) {
    let want = String(args[0] ?? '').toLowerCase();
    if (!want) {
        want = await e.getKeyword('Modo', [{ key: 'c', label: 'CAD' }, { key: 'e', label: 'Esquemático' }], documentMode(e.doc) === MODE_CAD ? 'e' : 'c');
    }
    switchMode(e, want.startsWith('e') ? MODE_SCHEMATIC : MODE_CAD);
}

async function sheetCommand(e, args = []) {
    if (!sheetsOf(e.doc).length) throw new Error('Folhas só existem no modo Esquemático (comando MODO).');
    const list = () => sheetsOf(e.doc).map((s, i) => `${i + 1}${s.id === activeSheetId(e.doc) ? '*' : ''}: ${s.nome}`).join('  ');
    e.log(`Folhas: ${list()}`);
    let answer = args.length ? args.join(' ') : await e.getString('Folha: número ou nome para ir, N nova, R renomear, X excluir', { allowEmpty: true });
    answer = String(answer ?? '').trim();
    if (!answer) return;
    const key = answer.toLowerCase();
    if (key === 'n') {
        newSheet(e);
        return;
    }
    if (key === 'r') {
        const nome = await e.getString('Novo nome da folha');
        renameActiveSheet(e, nome);
        return;
    }
    if (key === 'x') {
        removeActiveSheet(e);
        return;
    }
    const sheets = sheetsOf(e.doc);
    const byNumber = /^\d+$/.test(answer) ? sheets[Number(answer) - 1] : null;
    const target = byNumber ?? sheets.find((s) => s.nome.toLowerCase() === key || s.id.toLowerCase() === key);
    if (!target) throw new Error(`Folha "${answer}" não existe.`);
    goToSheet(e, target.id);
}

async function bomCommand(e) {
    const bom = schematicBom(e.doc);
    const pieces = bom.parts.reduce((sum, p) => sum + p.quantidade, 0);
    const hoses = bom.hoses.reduce((sum, h) => sum + h.quantidade, 0);
    e.log(`Lista de peças: ${bom.parts.length} item(ns), ${pieces} peça(s), ${hoses} mangueira(s).`);
    if (typeof document === 'undefined') return;
    const { openBomDialog } = await import('./schematic-print.js');
    openBomDialog(e);
}

export const SCHEMATIC_COMMANDS = {
    BOM: { aliases: ['LISTAPECAS'], description: 'Lista de peças do esquema, com as mangueiras, em tela, CSV ou impressa', run: bomCommand },
    MODE: { aliases: ['MODO'], description: 'Trocar entre os modos CAD e Esquemático (só com o desenho vazio)', run: modeCommand },
    SHEET: { aliases: ['FOLHA'], description: 'Folhas do esquema: ir para outra, criar, renomear ou excluir', run: sheetCommand },
    SYMBOL: { aliases: ['SIMBOLO', 'SB'], description: 'Inserir símbolo de esquema da biblioteca', run: insertSymbol },
    CONNECT: { aliases: ['LIGAR', 'LG'], description: 'Ligar duas portas de símbolos com traçado em L ou Z', run: connect },
    SYMLIB: { aliases: ['SIMBIB'], description: 'Carregar biblioteca de símbolos de esquema (pasta ou pacote JSON)', run: loadLibrary },
    SCHEMACHECK: { aliases: ['VERIFICAR'], description: 'Verificar o esquema: portas obrigatórias soltas, tipos incompatíveis e pilotos em linha de potência', run: check },
};
