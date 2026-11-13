// Lista de peças do esquema (ADR 0007, E3).
//
// Peças: símbolos agrupados pela definição e pelo `codigo`; o conector de página não é peça.
// Mangueiras: seção própria, contadas pelo `rotulo` da ligação (decisão 8 do formato). Ligação sem
// rótulo é tubo ou ligação interna e fica só no total "sem rótulo".

import { getSymbolDef, attributeLabel, getLibrary, splitRef } from './schematic-library.js';

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function attr(e, nome) {
    const v = e.atributos?.[nome];
    return v === undefined || v === null ? '' : String(v).trim();
}

const cache = new WeakMap();

export function schematicBom(doc) {
    const key = doc?.entities;
    if (!key) return { parts: [], hoses: [], unlabeledLinks: 0 };
    if (cache.has(key)) return cache.get(key);
    const groups = new Map();
    const hoses = new Map();
    let unlabeledLinks = 0;
    for (const e of doc.entities) {
        if (e.type === 'symbol') {
            const def = getSymbolDef(e.def);
            if (def?.conector) continue;
            const codigo = attr(e, 'codigo');
            const k = `${e.def}\u0000${codigo}`;
            if (!groups.has(k)) groups.set(k, { ref: e.def, nome: def?.nome ?? e.def, codigo, descricao: '', etiquetas: [], ids: [] });
            const g = groups.get(k);
            g.ids.push(e.id);
            const etiqueta = attr(e, 'etiqueta');
            if (etiqueta) g.etiquetas.push(etiqueta);
            if (!g.descricao) g.descricao = attr(e, 'descricao');
        } else if (e.type === 'link') {
            const rotulo = String(e.rotulo ?? '').trim();
            if (!rotulo) {
                unlabeledLinks += 1;
                continue;
            }
            if (!hoses.has(rotulo)) hoses.set(rotulo, { rotulo, ids: [] });
            hoses.get(rotulo).ids.push(e.id);
        }
    }
    const parts = [...groups.values()].map((g) => {
        g.etiquetas.sort(collator.compare);
        return { ...g, quantidade: g.ids.length };
    });
    // Ordem pela primeira etiqueta (B1, C1, C2, V1…); sem etiqueta, pelo nome.
    parts.sort((a, b) => collator.compare(a.etiquetas[0] ?? `~${a.nome}`, b.etiquetas[0] ?? `~${b.nome}`) || collator.compare(a.codigo, b.codigo));
    parts.forEach((p, i) => { p.item = i + 1; });
    const hoseList = [...hoses.values()].map((h) => ({ ...h, quantidade: h.ids.length })).sort((a, b) => collator.compare(a.rotulo, b.rotulo));
    const value = { parts, hoses: hoseList, unlabeledLinks };
    cache.set(key, value);
    return value;
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
    rows.push([]);
    rows.push(['Mangueira', 'Quantidade']);
    for (const h of bom.hoses) rows.push([h.rotulo, h.quantidade]);
    return `\ufeff${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
