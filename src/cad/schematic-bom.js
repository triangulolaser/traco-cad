// Lista de peças do esquema (ADR 0007, E3).
//
// Peças: símbolos agrupados pela definição, pelo `codigo` e pela `descricao`; o conector de página não é peça.
// A descrição entra na chave porque a mesma peça pode ter usos diferentes (roda traseira esquerda e direita):
// juntar os dois mostrava só a descrição do primeiro. Símbolo sem descrição entra na linha descrita da mesma
// peça quando só existe uma; com mais de uma, fica na própria linha, sem descrição.
// Mangueiras: seção própria, contadas pelo `rotulo` da ligação (decisão 8 do formato). Ligação sem
// rótulo é tubo ou ligação interna e fica só no total "sem rótulo".
// Fios (decisão 13): seção própria, uma linha por ligação elétrica, com número, de/para (etiqueta.porta),
// cor, seção e comprimento do `fio` da ligação. Campo ausente sai em branco: o Traço não inventa número.
// A ligação elétrica não entra nas mangueiras nem no total "sem rótulo".

import { getSymbolDef, attributeLabel, getLibrary, splitRef } from './schematic-library.js';
import { analyzeSchematic, connectorSignal, normalizeWire } from './schematic.js';

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function attr(e, nome) {
    const v = e.atributos?.[nome];
    return v === undefined || v === null ? '' : String(v).trim();
}

const cache = new WeakMap();

export function schematicBom(doc) {
    const key = doc?.entities;
    if (!key) return { parts: [], hoses: [], wires: [], unlabeledLinks: 0, hydraulicLinks: 0 };
    if (cache.has(key)) return cache.get(key);
    const groups = new Map();
    const hoses = new Map();
    const wires = [];
    let unlabeledLinks = 0;
    let hydraulicLinks = 0;
    const { electricLinks } = analyzeSchematic(doc);
    const byId = new Map(doc.entities.map((e) => [e.id, e]));
    for (const e of doc.entities) {
        if (e.type === 'symbol') {
            const def = getSymbolDef(e.def);
            if (def?.conector) continue;
            const codigo = attr(e, 'codigo');
            const descricao = attr(e, 'descricao');
            const k = `${e.def}\u0000${codigo}\u0000${descricao}`;
            if (!groups.has(k)) groups.set(k, { ref: e.def, nome: def?.nome ?? e.def, codigo, descricao, etiquetas: [], ids: [] });
            const g = groups.get(k);
            g.ids.push(e.id);
            const etiqueta = attr(e, 'etiqueta');
            if (etiqueta) g.etiquetas.push(etiqueta);
        } else if (e.type === 'link' && electricLinks.has(e.id)) {
            const fio = normalizeWire(e.fio) ?? {};
            wires.push({
                id: e.id,
                numero: fio.numero ?? '',
                de: wireEnd(e.from, byId),
                para: wireEnd(e.to, byId),
                cor: fio.cor ?? '',
                secao_mm2: fio.secao_mm2 ?? null,
                comprimento_mm: fio.comprimento_mm ?? null,
            });
        } else if (e.type === 'link') {
            hydraulicLinks += 1;
            const rotulo = String(e.rotulo ?? '').trim();
            if (!rotulo) {
                unlabeledLinks += 1;
                continue;
            }
            if (!hoses.has(rotulo)) hoses.set(rotulo, { rotulo, ids: [] });
            hoses.get(rotulo).ids.push(e.id);
        }
    }
    for (const [k, g] of groups) {
        if (g.descricao) continue;
        const described = [...groups.values()].filter((o) => o !== g && o.descricao && o.ref === g.ref && o.codigo === g.codigo);
        if (described.length !== 1) continue;
        described[0].ids.push(...g.ids);
        described[0].etiquetas.push(...g.etiquetas);
        groups.delete(k);
    }
    const parts = [...groups.values()].map((g) => {
        g.etiquetas.sort(collator.compare);
        return { ...g, quantidade: g.ids.length };
    });
    // Ordem pela primeira etiqueta (B1, C1, C2, V1…); sem etiqueta, pelo nome.
    parts.sort((a, b) => collator.compare(a.etiquetas[0] ?? `~${a.nome}`, b.etiquetas[0] ?? `~${b.nome}`) || collator.compare(a.codigo, b.codigo));
    parts.forEach((p, i) => { p.item = i + 1; });
    const hoseList = [...hoses.values()].map((h) => ({ ...h, quantidade: h.ids.length })).sort((a, b) => collator.compare(a.rotulo, b.rotulo));
    // Ordem pelo número do fio; sem número, depois, pela ponta de origem.
    wires.sort((a, b) => (a.numero ? 0 : 1) - (b.numero ? 0 : 1) || collator.compare(a.numero, b.numero) || collator.compare(a.de, b.de) || collator.compare(a.para, b.para));
    const value = { parts, hoses: hoseList, wires, unlabeledLinks, hydraulicLinks };
    cache.set(key, value);
    return value;
}

// Ponta do fio na lista: etiqueta.porta do símbolo; conector de página mostra o sinal; junção e ponta
// livre aparecem como tal (o fio continua na outra ligação da junção).
function wireEnd(end, byId) {
    if (end?.symbol !== undefined) {
        const sym = byId.get(end.symbol);
        if (!sym) return '';
        const def = getSymbolDef(sym.def);
        if (def?.conector) return `→ ${connectorSignal(sym) || '?'}`;
        return `${attr(sym, 'etiqueta') || splitRef(sym.def).id}.${end.port}`;
    }
    if (end?.junction !== undefined) return 'junção';
    return 'solta';
}

// Seções que a lista mostra: fios só com ligação elétrica; mangueiras com ligação hidráulica ou
// quando não há fio nenhum (esquema vazio continua mostrando a seção de mangueiras).
export function bomSections(bom) {
    return { hoses: bom.hydraulicLinks > 0 || bom.hoses.length > 0 || !bom.wires.length, wires: bom.wires.length > 0 };
}

export function formatWireNumber(v) {
    return v === null || v === undefined ? '' : String(v).replace('.', ',');
}

// Cabeçalho da coluna de código: o rótulo próprio das bibliotecas usadas, quando só há um
// (símbolo da ISO embutida no esquema da empresa leva o código da empresa); senão, o padrão.
export function bomCodeLabel(doc) {
    const custom = new Set();
    for (const p of schematicBom(doc).parts) {
        const label = getLibrary(splitRef(p.ref).library)?.rotulos?.codigo;
        if (label) custom.add(label);
    }
    return custom.size === 1 ? [...custom][0] : attributeLabel('', 'codigo');
}

const QUOTE = String.fromCharCode(34);
const NEEDS_QUOTE = new RegExp(`[;${QUOTE}\\r\\n]`);

function csvCell(v) {
    const s = String(v ?? '');
    return NEEDS_QUOTE.test(s) ? QUOTE + s.split(QUOTE).join(QUOTE + QUOTE) + QUOTE : s;
}

// CSV com ponto e vírgula (abre direto no Excel em português), seções separadas por linha vazia.
export function bomCsv(doc, { codeLabel = bomCodeLabel(doc) } = {}) {
    const bom = schematicBom(doc);
    const rows = [['Item', 'Etiquetas', 'Quantidade', 'Peça', 'Descrição', codeLabel, 'Símbolo']];
    for (const p of bom.parts) rows.push([p.item, p.etiquetas.join(', '), p.quantidade, p.nome, p.descricao, p.codigo, p.ref]);
    const show = bomSections(bom);
    if (show.hoses) {
        rows.push([]);
        rows.push(['Mangueira', 'Quantidade']);
        for (const h of bom.hoses) rows.push([h.rotulo, h.quantidade]);
    }
    if (show.wires) {
        rows.push([]);
        rows.push(['Fio', 'De', 'Para', 'Cor', 'Seção (mm²)', 'Comprimento (mm)']);
        for (const w of bom.wires) rows.push([w.numero, w.de, w.para, w.cor, formatWireNumber(w.secao_mm2), formatWireNumber(w.comprimento_mm)]);
    }
    return `\ufeff${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
