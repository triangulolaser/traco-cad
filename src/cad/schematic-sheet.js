// Moldura e carimbo das folhas do esquema (ADR 0007, E2b).
//
// O carimbo é dado do documento (`carimbo` no .traco); a moldura e o desenho do carimbo são
// derivados, nunca gravados: saem iguais na tela e na impressão, e mudar o título não mexe nas
// entidades. Folha A4 deitada, com margem de arquivamento de 20 mm à esquerda e 10 mm nas outras.

import { SHEET_FORMATS, sheetsOf } from './schematic-mode.js';

export const TITLE_FIELDS = [
    { key: 'empresa', label: 'Empresa' },
    { key: 'titulo', label: 'Título' },
    { key: 'numero', label: 'Desenho nº' },
    { key: 'revisao', label: 'Revisão' },
    { key: 'autor', label: 'Desenhista' },
    { key: 'data', label: 'Data' },
];

export const FRAME_MARGIN = { left: 20, right: 10, top: 10, bottom: 10 };
export const TITLE_BLOCK = { width: 140, height: 36 };

// Só os campos conhecidos, como texto; campo vazio não vai para o arquivo.
export function normalizeTitleBlock(value) {
    const out = {};
    for (const { key } of TITLE_FIELDS) {
        const v = value?.[key];
        if (v === undefined || v === null) continue;
        const text = String(v).trim();
        if (text) out[key] = text;
    }
    return out;
}

export function titleBlockOf(doc) {
    return normalizeTitleBlock(doc?.carimbo);
}

const line = (x1, y1, x2, y2) => ({ type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
const text = (x, y, value, height) => ({ type: 'text', position: { x, y }, height, rotation: 0, text: String(value) });

// Corta o texto que não cabe na célula (largura média do caractere ≈ 0,6 da altura).
function fit(value, width, height) {
    const s = String(value ?? '');
    const max = Math.max(1, Math.floor(width / (height * 0.6)));
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Entidades da moldura e do carimbo de uma folha, em coordenadas da folha.
// `page` = { number, total, nome } permite usar o mesmo carimbo na página da lista de peças.
export function sheetDecorations(doc, sheetId, page = null) {
    const sheets = sheetsOf(doc);
    const index = sheets.findIndex((s) => s.id === sheetId);
    const sheet = sheets[index];
    if (!sheet && !page) return [];
    const f = SHEET_FORMATS[sheet?.formato] ?? SHEET_FORMATS.A4;
    const number = page?.number ?? index + 1;
    const total = page?.total ?? sheets.length;
    const nome = page?.nome ?? sheet.nome;
    const c = titleBlockOf(doc);
    const m = FRAME_MARGIN;
    const x0 = m.left;
    const y0 = m.bottom;
    const x1 = f.width - m.right;
    const y1 = f.height - m.top;
    const out = [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)];
    // Carimbo no canto inferior direito.
    const bx = x1 - TITLE_BLOCK.width;
    const by = y0;
    const top = y0 + TITLE_BLOCK.height;
    out.push(line(bx, by, bx, top), line(bx, top, x1, top));
    // Linhas: empresa (38–46), título (28–38), folha (20–28), células (10–20).
    const rows = [by + 10, by + 18, by + 28];
    for (const y of rows) out.push(line(bx, y, x1, y));
    const cells = [
        { x: bx, w: 44, label: 'Desenho nº', value: c.numero ?? '' },
        { x: bx + 44, w: 16, label: 'Rev.', value: c.revisao ?? '' },
        { x: bx + 60, w: 22, label: 'Folha', value: `${number}/${total}` },
        { x: bx + 82, w: 34, label: 'Desenhista', value: c.autor ?? '' },
        { x: bx + 116, w: 24, label: 'Data', value: c.data ?? '' },
    ];
    for (const cell of cells.slice(1)) out.push(line(cell.x, by, cell.x, by + 10));
    const label = 1.6;
    const value = 2.5;
    for (const cell of cells) {
        out.push(text(cell.x + 1, by + 10 - 1 - label, cell.label, label));
        if (cell.value) out.push(text(cell.x + 1, by + 1.5, fit(cell.value, cell.w - 2, value), value));
    }
    out.push(text(bx + 1, by + 18 - 1 - label, 'Folha', label));
    out.push(text(bx + 1, by + 11.5, fit(nome, TITLE_BLOCK.width - 2, value), value));
    out.push(text(bx + 1, by + 28 - 1 - label, 'Título', label));
    if (c.titulo) out.push(text(bx + 1, by + 19.5, fit(c.titulo, TITLE_BLOCK.width - 2, 3.5), 3.5));
    if (c.empresa) out.push(text(bx + 1, by + 29.5, fit(c.empresa, TITLE_BLOCK.width - 24, 3.5), 3.5));
    out.push(text(x1 - 20, by + 29.5, `${sheet?.formato ?? 'A4'}`, value));
    return out.map((e, i) => ({ ...e, id: `__sheet:${i}`, layer: '0' }));
}

// Retângulo do carimbo na folha (coordenadas da folha).
export function titleBlockBox(doc, sheetId) {
    const sheet = sheetsOf(doc).find((s) => s.id === sheetId);
    if (!sheet) return null;
    const f = SHEET_FORMATS[sheet.formato] ?? SHEET_FORMATS.A4;
    const maxX = f.width - FRAME_MARGIN.right;
    return { minX: maxX - TITLE_BLOCK.width, minY: FRAME_MARGIN.bottom, maxX, maxY: FRAME_MARGIN.bottom + TITLE_BLOCK.height };
}

// Área útil para o desenho: dentro da moldura, fora do carimbo.
export function sheetDrawingArea(doc, sheetId) {
    const sheet = sheetsOf(doc).find((s) => s.id === sheetId);
    if (!sheet) return null;
    const f = SHEET_FORMATS[sheet.formato] ?? SHEET_FORMATS.A4;
    return { minX: FRAME_MARGIN.left, minY: FRAME_MARGIN.bottom, maxX: f.width - FRAME_MARGIN.right, maxY: f.height - FRAME_MARGIN.top };
}
