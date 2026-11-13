// Lista de conferência ao vivo do modo Esquemático (E1, E2, A5 e ligações soltas), por folha.

import { analyzeSchematic } from './schematic.js';
import { entitySheet, sheetsOf } from './schematic-mode.js';
import { entityBox } from './geometry.js';
import { titleBlockBox } from './schematic-sheet.js';

// Itens prontos para a tela, com a folha de cada problema.
// O analyzeSchematic guarda o resultado pelo array de entidades, então a lista sai do cache
// enquanto o desenho não muda.
const checkCache = new WeakMap();

export function schematicCheckList(doc, nameOf = (id) => id) {
    const key = doc?.entities;
    if (!key) return { items: [], errors: 0, warnings: 0, loose: 0, nets: 0 };
    const cached = checkCache.get(key);
    if (cached && cached.sheets === doc.sheets) return cached.value;
    const an = analyzeSchematic(doc);
    const byId = new Map(doc.entities.map((e) => [e.id, e]));
    const items = an.problems.map((p) => {
        const names = p.ids.map(nameOf);
        const sheet = entitySheet(doc, byId.get(p.ids[0]));
        if (p.code === 'E1') return { code: 'E1', level: 'error', ids: p.ids, sheet, text: `Porta obrigatória sem ligação: ${names[0]}.${p.port}` };
        if (p.code === 'A6') return { code: 'A6', level: 'warn', ids: p.ids, sheet, text: p.sinal ? `Conector de página sem par: sinal ${p.sinal} só aparece em ${names[0]}` : `Conector de página sem sinal: ${names[0]}` };
        if (p.code === 'A5') return { code: 'A5', level: 'warn', ids: p.ids, sheet, text: `Piloto em linha de potência, confirmar: ${p.types.join(' + ')} (${names.join(', ')})` };
        return { code: p.code, level: 'error', ids: p.ids, sheet, text: `Tipos incompatíveis na rede: ${p.types.join(' + ')} (${names.join(', ')})` };
    });
    if (an.loose.size) {
        const ids = [...an.loose];
        items.push({ code: 'LS', level: 'warn', ids, sheet: entitySheet(doc, byId.get(ids[0])), text: `${ids.length} ligação(ões) solta(s), em vermelho` });
    }
    // A7: objeto por cima do carimbo; no papel, o carimbo fica ilegível.
    const boxes = new Map(sheetsOf(doc).map((s) => [s.id, titleBlockBox(doc, s.id)]));
    const over = new Map();
    for (const e of doc.entities) {
        const tb = boxes.get(entitySheet(doc, e));
        if (!tb) continue;
        const b = entityBox(e);
        if (!Number.isFinite(b.minX) || b.maxX <= tb.minX || b.minX >= tb.maxX || b.maxY <= tb.minY || b.minY >= tb.maxY) continue;
        const sheet = entitySheet(doc, e);
        if (!over.has(sheet)) over.set(sheet, []);
        over.get(sheet).push(e.id);
    }
    for (const [sheet, ids] of over) {
        items.push({ code: 'A7', level: 'warn', ids, sheet, text: `${ids.length} objeto(s) sobre o carimbo: ${ids.map(nameOf).join(', ')}` });
    }
    const value = {
        items,
        errors: items.filter((i) => i.level === 'error').length,
        warnings: items.filter((i) => i.level === 'warn').length,
        loose: an.loose.size,
        nets: an.nets.length,
    };
    checkCache.set(key, { sheets: doc.sheets, value });
    return value;
}
