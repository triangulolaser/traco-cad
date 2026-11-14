// Painel de propriedades do esquema (ADR 0007, E2b): atributos do símbolo, rótulo de mangueira
// da ligação hidráulica, fio da ligação elétrica (decisão 13) e carimbo quando nada está selecionado.
//
// O nome de tela de cada atributo vem da biblioteca do símbolo (`rotulos`); sem rótulo, o padrão.
// O Traço não escreve nome de sistema de empresa: esse nome é texto da biblioteca da empresa.

import { replaceEntities, isEntityEditable } from './document.js';
import { getSymbolDef, attributeLabel } from './schematic-library.js';
import { isSchematicDocument } from './schematic-mode.js';
import { analyzeSchematic, normalizeWire, WIRE_FIELDS } from './schematic.js';
import { TITLE_FIELDS, titleBlockOf, normalizeTitleBlock } from './schematic-sheet.js';

const PORT_TYPE_LABELS = {
    pressao: 'pressão', retorno: 'retorno', succao: 'sucção', trabalho: 'trabalho', piloto: 'piloto', dreno: 'dreno', passante: 'passante', eletrico: 'elétrico',
};

const WIRE_LABELS = [
    { key: 'numero', label: 'Número' },
    { key: 'cor', label: 'Cor' },
    { key: 'secao_mm2', label: 'Seção (mm²)', numeric: true },
    { key: 'comprimento_mm', label: 'Comprimento (mm)', numeric: true },
];

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const section = (label) => `<div class="cad-prop-section">${esc(label)}</div>`;
const row = (k, v) => `<div class="cad-prop-row"><span class="cad-prop-key">${esc(k)}</span><span class="cad-prop-value">${v}</span></div>`;
const input = (attrs, value, disabled) => `<input type="text" ${attrs} value="${esc(value)}"${disabled ? ' disabled' : ''}>`;

// Atributos editáveis: os da definição, na ordem dela, mais os gravados que a definição não tem.
export function symbolAttributeNames(entity) {
    const def = getSymbolDef(entity.def);
    const names = (def?.atributos ?? []).map((a) => a.nome);
    for (const k of Object.keys(entity.atributos ?? {})) if (!names.includes(k)) names.push(k);
    if (!names.includes('etiqueta')) names.unshift('etiqueta');
    return names;
}

function connectedPorts(doc, entity) {
    const open = new Set(analyzeSchematic(doc).unconnected.filter((p) => p.symbol === entity.id).map((p) => p.name));
    const linked = new Set();
    for (const e of doc.entities) {
        if (e.type !== 'link') continue;
        for (const end of [e.from, e.to]) if (end?.symbol === entity.id) linked.add(end.port);
    }
    return { open, linked };
}

// HTML da seção do esquema para a seleção atual, ou '' quando não se aplica.
export function schematicPropertiesHtml(doc, selected) {
    if (!isSchematicDocument(doc) && !selected.some((e) => e.type === 'symbol' || e.type === 'link')) return '';
    if (selected.length === 1 && selected[0].type === 'symbol') {
        const e = selected[0];
        const def = getSymbolDef(e.def);
        const locked = !isEntityEditable(doc, e);
        let html = section(def?.conector ? 'Conector de página' : 'Símbolo')
            + row('Símbolo', esc(def?.nome ?? `${e.def} (biblioteca não carregada)`))
            + row('Referência', `<code>${esc(e.def)}</code>`);
        for (const nome of symbolAttributeNames(e)) {
            html += row(attributeLabel(e.def, nome), input(`data-schematic-attr="${esc(nome)}"`, e.atributos?.[nome] ?? '', locked));
        }
        const { open, linked } = connectedPorts(doc, e);
        if (def?.portas?.length) {
            html += section('Portas');
            for (const p of def.portas) {
                const state = linked.has(p.name) ? 'ligada' : open.has(p.name) ? 'solta (obrigatória)' : 'livre';
                html += row(p.name, `${esc(PORT_TYPE_LABELS[p.type] ?? p.type)} · <span class="cad-port-${linked.has(p.name) ? 'ok' : open.has(p.name) ? 'open' : 'free'}">${esc(state)}</span>`);
            }
        }
        return html;
    }
    const links = selected.filter((e) => e.type === 'link');
    const electric = analyzeSchematic(doc).electricLinks;
    if (links.length && links.length === selected.length && links.every((l) => electric.has(l.id))) {
        const locked = links.some((l) => !isEntityEditable(doc, l));
        let html = section(links.length === 1 ? 'Fio' : `${links.length} fios`);
        for (const f of WIRE_LABELS) {
            const values = new Set(links.map((l) => String(normalizeWire(l.fio)?.[f.key] ?? '')));
            const value = values.size === 1 ? [...values][0] : '';
            const shown = f.numeric ? value.replace('.', ',') : value;
            html += row(f.label, input(`data-schematic-wire="${f.key}"${values.size > 1 ? ' placeholder="*Varia*"' : ''}`, shown, locked));
        }
        return html;
    }
    if (links.length && links.length === selected.length) {
        const values = new Set(links.map((l) => String(l.rotulo ?? '')));
        const value = values.size === 1 ? [...values][0] : '';
        const locked = links.some((l) => !isEntityEditable(doc, l));
        return section(links.length === 1 ? 'Ligação' : `${links.length} ligações`)
            + row('Mangueira', input(`data-schematic-hose placeholder="${values.size > 1 ? '*Varia*' : 'rótulo para a lista de peças'}"`, value, locked));
    }
    if (!selected.length && isSchematicDocument(doc)) {
        const c = titleBlockOf(doc);
        return section('Carimbo') + TITLE_FIELDS.map((f) => row(f.label, input(`data-schematic-title="${f.key}"`, c[f.key] ?? '', false))).join('');
    }
    return '';
}

// Liga os campos ao editor. Cada mudança é um commit (entra no desfazer e na colaboração).
export function bindSchematicProperties(editor, box) {
    const stop = (el) => el.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            el.blur();
        }
    });
    box.querySelectorAll('[data-schematic-attr]').forEach((el) => {
        stop(el);
        el.addEventListener('change', () => {
            const id = [...editor.selection][0];
            const entity = editor.doc.entities.find((x) => x.id === id);
            if (!entity || entity.type !== 'symbol' || !isEntityEditable(editor.doc, entity)) return;
            const nome = el.dataset.schematicAttr;
            const value = el.value.trim();
            if (String(entity.atributos?.[nome] ?? '') === value) return;
            if (nome === 'etiqueta' && value && editor.doc.entities.some((x) => x.type === 'symbol' && x.id !== id && String(x.atributos?.etiqueta ?? '') === value)) {
                editor.log(`Etiqueta ${value} já existe no esquema.`, 'warn');
            }
            const atributos = { ...(entity.atributos ?? {}) };
            if (value) atributos[nome] = value;
            else delete atributos[nome];
            editor.commit('Atributo do símbolo', replaceEntities(editor.doc, new Map([[id, { ...entity, atributos }]])));
        });
    });
    box.querySelectorAll('[data-schematic-hose]').forEach((el) => {
        stop(el);
        el.addEventListener('change', () => {
            const value = el.value.trim();
            const updates = new Map();
            for (const id of editor.selection) {
                const e = editor.doc.entities.find((x) => x.id === id);
                if (e?.type !== 'link' || !isEntityEditable(editor.doc, e)) continue;
                const next = { ...e };
                if (value) next.rotulo = value;
                else delete next.rotulo;
                updates.set(id, next);
            }
            if (updates.size) editor.commit('Rótulo de mangueira', replaceEntities(editor.doc, updates));
        });
    });
    box.querySelectorAll('[data-schematic-wire]').forEach((el) => {
        stop(el);
        el.addEventListener('change', () => {
            const field = el.dataset.schematicWire;
            if (!WIRE_FIELDS.includes(field)) return;
            const updates = new Map();
            for (const id of editor.selection) {
                const e = editor.doc.entities.find((x) => x.id === id);
                if (e?.type !== 'link' || !isEntityEditable(editor.doc, e)) continue;
                const fio = normalizeWire({ ...(e.fio ?? {}), [field]: el.value });
                if (JSON.stringify(fio) === JSON.stringify(normalizeWire(e.fio))) continue;
                const next = { ...e };
                if (fio) next.fio = fio;
                else delete next.fio;
                updates.set(id, next);
            }
            if (updates.size) editor.commit('Fio da ligação', replaceEntities(editor.doc, updates));
        });
    });
    box.querySelectorAll('[data-schematic-title]').forEach((el) => {
        stop(el);
        el.addEventListener('change', () => {
            const carimbo = normalizeTitleBlock({ ...titleBlockOf(editor.doc), [el.dataset.schematicTitle]: el.value });
            if (JSON.stringify(carimbo) === JSON.stringify(titleBlockOf(editor.doc))) return;
            editor.commit('Carimbo', { ...editor.doc, carimbo });
        });
    });
}
