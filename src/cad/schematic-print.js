// Impressão do esquema por folha (ADR 0007, E2b): uma página A4 deitada por folha, em escala 1:1,
// com moldura, carimbo e referência cruzada dos conectores; opcionalmente, as páginas da lista
// de peças no fim, com o mesmo carimbo. A guia tracejada do papel na tela não sai.

import { entitySvg, escapeXml, printFontCss } from './print.js';
import { layerOf, entityColor } from './document.js';
import { loadCadFonts } from './fonts.js';
import { SHEET_FORMATS, sheetsOf, entitySheet, activeSheetId } from './schematic-mode.js';
import { sheetDecorations, FRAME_MARGIN, TITLE_BLOCK } from './schematic-sheet.js';
import { symbolChildren, analyzeSchematic, linkPoints, JUNCTION_RADIUS, connectorReferenceTexts } from './schematic.js';
import { schematicBom, bomCodeLabel, bomCsv, bomSections, formatWireNumber } from './schematic-bom.js';

const n = (x) => Number(Number(x).toFixed(4));
const PAGE = SHEET_FORMATS.A4;

// Branco (cor 7) no papel vira preto, como em qualquer plotagem.
function ink(e, doc, mono) {
    if (mono) return '#000000';
    const c = String(entityColor(e, doc)).toLowerCase();
    return c === '#ffffff' || c === '#fff' ? '#000000' : c;
}

function svgOf(e, doc, mono) {
    const color = ink(e, doc, mono);
    return entitySvg({ ...e, color }, doc, 1, false);
}

function linkSvg(e, doc, an, mono) {
    const pts = linkPoints(e);
    if (pts.length < 2) return '';
    const loose = an.loose.has(e.id);
    const color = !mono && loose ? '#ef4444' : ink(e, doc, mono);
    const dashed = an.linkLineType.get(e.id) === 'DASHED';
    const width = (e.lineWeight ?? layerOf(doc, e.layer)?.lineWeight ?? 25) / 100 || 0.25;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('');
    return `<path d="${d}" fill="none" stroke="${escapeXml(color)}" stroke-width="${n(width)}" stroke-linejoin="round" stroke-linecap="round"${dashed ? ' stroke-dasharray="3 1.5"' : ''}/>`;
}

function pageSvg(body, decorations, doc) {
    const frame = decorations.map((e) => svgOf(e, doc, true)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width}mm" height="${PAGE.height}mm" viewBox="0 0 ${PAGE.width} ${PAGE.height}"><rect width="100%" height="100%" fill="white"/><g transform="translate(0 ${PAGE.height}) scale(1 -1)">${body}${frame}</g></svg>`;
}

// Uma folha do esquema. `page` = { number, total } numera a folha no conjunto impresso.
export function sheetPrintSvg(doc, sheetId, { monochrome = true, page = null } = {}) {
    const an = analyzeSchematic(doc);
    const onSheet = (e) => entitySheet(doc, e) === sheetId;
    const parts = [];
    for (const e of doc.entities) {
        if (!onSheet(e) || layerOf(doc, e.layer)?.visible === false) continue;
        if (e.type === 'symbol') parts.push(symbolChildren(e).map((c) => svgOf(c, doc, monochrome)).join(''));
        else if (e.type === 'link') parts.push(linkSvg(e, doc, an, monochrome));
        else if (e.type === 'junction') parts.push(`<circle cx="${n(e.position.x)}" cy="${n(e.position.y)}" r="${JUNCTION_RADIUS}" fill="${escapeXml(ink(e, doc, monochrome))}" stroke="none"/>`);
        else parts.push(svgOf(e, doc, monochrome));
    }
    for (const t of connectorReferenceTexts(doc, onSheet)) parts.push(svgOf(t, doc, monochrome));
    return pageSvg(parts.join(''), sheetDecorations(doc, sheetId, page), doc);
}

// Linhas da tabela da lista de peças, já com cabeçalhos de seção.
function bomRows(doc) {
    const bom = schematicBom(doc);
    const rows = [{ kind: 'title', text: 'Lista de peças' }, { kind: 'head', cells: ['Item', 'Etiquetas', 'Qtd.', 'Peça', 'Descrição', bomCodeLabel(doc)] }];
    if (!bom.parts.length) rows.push({ kind: 'note', text: 'Nenhuma peça no esquema.' });
    for (const p of bom.parts) rows.push({ kind: 'row', cells: [p.item, p.etiquetas.join(', '), p.quantidade, p.nome, p.descricao, p.codigo] });
    const show = bomSections(bom);
    if (show.hoses) {
        rows.push({ kind: 'title', text: 'Mangueiras' }, { kind: 'head', cells: ['Rótulo', 'Qtd.'] });
        if (!bom.hoses.length) rows.push({ kind: 'note', text: 'Nenhuma ligação com rótulo de mangueira.' });
        for (const h of bom.hoses) rows.push({ kind: 'hose', cells: [h.rotulo, h.quantidade] });
        if (bom.unlabeledLinks) rows.push({ kind: 'note', text: `${bom.unlabeledLinks} ligação(ões) sem rótulo de mangueira.` });
    }
    if (show.wires) {
        rows.push({ kind: 'title', text: 'Fios' }, { kind: 'wirehead', cells: ['Fio', 'De', 'Para', 'Cor', 'mm²', 'Compr. (mm)'] });
        for (const w of bom.wires) rows.push({ kind: 'wire', cells: [w.numero, w.de, w.para, w.cor, formatWireNumber(w.secao_mm2), formatWireNumber(w.comprimento_mm)] });
    }
    return rows;
}

const ROW_H = 6;
const TABLE_TOP = PAGE.height - FRAME_MARGIN.top - 6;
// Acima do carimbo, para a tabela nunca passar por cima dele.
const TABLE_BOTTOM = FRAME_MARGIN.bottom + TITLE_BLOCK.height + 4;
const COLS = [12, 46, 12, 72, 68, 50];
const HOSE_COLS = [100, 12];
const WIRE_COLS = [24, 66, 66, 40, 22, 30];

function fitText(value, width, height) {
    const s = String(value ?? '');
    const max = Math.max(1, Math.floor(width / (height * 0.55)));
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function bomPageCount(doc) {
    const per = Math.floor((TABLE_TOP - TABLE_BOTTOM) / ROW_H);
    return Math.max(1, Math.ceil(bomRows(doc).length / per));
}

// Páginas da lista de peças. A tabela é desenhada em SVG direto (Y para baixo), por cima da moldura.
export function bomPrintSvgs(doc, { firstNumber = 1, total = null } = {}) {
    const rows = bomRows(doc);
    const per = Math.floor((TABLE_TOP - TABLE_BOTTOM) / ROW_H);
    const pages = [];
    for (let i = 0; i < rows.length; i += per) pages.push(rows.slice(i, i + per));
    const count = pages.length;
    const all = total ?? firstNumber - 1 + count;
    const x0 = FRAME_MARGIN.left + 3;
    return pages.map((chunk, p) => {
        let y = PAGE.height - TABLE_TOP;
        const out = [];
        for (const row of chunk) {
            const base = y + ROW_H - 1.8;
            if (row.kind === 'title') out.push(`<text x="${x0}" y="${n(base)}" font-size="4.2" font-weight="700">${escapeXml(row.text)}</text>`);
            else if (row.kind === 'note') out.push(`<text x="${x0}" y="${n(base)}" font-size="3" font-style="italic">${escapeXml(row.text)}</text>`);
            else {
                const wire = row.kind === 'wire' || row.kind === 'wirehead';
                const head = row.kind === 'head' || row.kind === 'wirehead';
                const cols = wire ? WIRE_COLS : row.cells.length === 2 ? HOSE_COLS : COLS;
                let x = x0;
                row.cells.forEach((cell, i) => {
                    out.push(`<text x="${n(x)}" y="${n(base)}" font-size="3"${head ? ' font-weight="700"' : ''}>${escapeXml(fitText(cell, cols[i] - 2, 3))}</text>`);
                    x += cols[i];
                });
                const w = cols.reduce((a, b) => a + b, 0);
                out.push(`<path d="M${x0 - 1} ${n(y + ROW_H)}h${w}" stroke="black" stroke-width="${head ? 0.35 : 0.1}"/>`);
            }
            y += ROW_H;
        }
        const frame = pageSvg('', sheetDecorations(doc, null, { number: firstNumber + p, total: all, nome: count > 1 ? `Lista de peças (${p + 1}/${count})` : 'Lista de peças' }), doc);
        return frame.replace('</svg>', `<g font-family="Liberation Sans,Arial,sans-serif" fill="black">${out.join('')}</g></svg>`);
    });
}

// Páginas impressas: folhas (todas ou só a ativa) e, se pedido, a lista de peças.
export function schematicPrintPages(doc, { sheets = 'all', bom = false, monochrome = true } = {}) {
    const all = sheetsOf(doc);
    const chosen = sheets === 'active' ? all.filter((s) => s.id === activeSheetId(doc)) : all;
    const bomPages = bom ? bomPageCount(doc) : 0;
    const total = all.length + bomPages;
    const pages = chosen.map((s) => sheetPrintSvg(doc, s.id, { monochrome, page: { number: all.indexOf(s) + 1, total } }));
    if (bom) pages.push(...bomPrintSvgs(doc, { firstNumber: all.length + 1, total }));
    return pages;
}

export function printPagesHtml(pages, title = 'Traço — esquema') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>${printFontCss()}@page{size:${PAGE.width}mm ${PAGE.height}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;break-after:page;page-break-after:always}svg:last-of-type{break-after:auto;page-break-after:auto}@media screen{body{background:#666}svg{margin:8px auto;box-shadow:0 1px 6px #0006}}@media print{button,p{display:none}}</style></head><body><button onclick="window.print()">Imprimir / salvar PDF</button><p>Imprimir em 100%, sem cabeçalhos e rodapés.</p>${pages.join('')}</body></html>`;
}

function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBomCsv(editor) {
    const base = String(editor.doc.name || 'esquema').replace(/\.[^.]+$/, '');
    download(`${base}-lista-de-pecas.csv`, bomCsv(editor.doc), 'text/csv;charset=utf-8');
}

export async function openSchematicPrintDialog(editor, { bom = false } = {}) {
    await loadCadFonts();
    const dialog = document.createElement('dialog');
    dialog.className = 'cad-print-dialog';
    dialog.innerHTML = `<form method="dialog"><h3>Imprimir esquema / PDF</h3>
        <label>Folhas <select name="sheets"><option value="all">Todas</option><option value="active">Só a folha ativa</option></select></label>
        <label><input name="bom" type="checkbox"${bom ? ' checked' : ''}>Incluir lista de peças no fim</label>
        <label><input name="monochrome" type="checkbox" checked>Preto e branco</label>
        <p>A4 deitada em escala 1:1, com moldura e carimbo. Na impressão, use tamanho real / 100%, sem cabeçalhos nem margens adicionais. Para PDF, escolha Salvar como PDF.</p>
        <p data-print-error role="alert"></p><div data-print-preview class="cad-schematic-print-preview"></div>
        <button type="button" data-print>Imprimir / PDF</button><button type="button" data-csv>Lista em CSV</button><button value="cancel">Fechar</button></form>`;
    const options = () => ({
        sheets: dialog.querySelector('[name=sheets]').value,
        bom: dialog.querySelector('[name=bom]').checked,
        monochrome: dialog.querySelector('[name=monochrome]').checked,
    });
    const preview = () => {
        try {
            const pages = schematicPrintPages(editor.doc, options());
            dialog.querySelector('[data-print-preview]').innerHTML = pages.join('');
            dialog.querySelector('[data-print-error]').textContent = `${pages.length} página(s).`;
            return pages;
        } catch (err) {
            dialog.querySelector('[data-print-error]').textContent = err.message;
            return null;
        }
    };
    dialog.querySelectorAll('select,input').forEach((x) => x.addEventListener('change', preview));
    dialog.querySelector('[data-csv]').onclick = () => downloadBomCsv(editor);
    dialog.querySelector('[data-print]').onclick = () => {
        const pages = preview();
        if (!pages) return;
        const w = window.open('', '_blank');
        if (!w) {
            dialog.querySelector('[data-print-error]').textContent = 'Permita a abertura da janela de impressão.';
            return;
        }
        w.document.write(printPagesHtml(pages, editor.doc.name));
        w.document.close();
    };
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    preview();
    return dialog;
}

// Lista de peças na tela: tabelas, CSV e atalho para imprimir com a lista.
export function openBomDialog(editor) {
    const bom = schematicBom(editor.doc);
    const code = bomCodeLabel(editor.doc);
    const dialog = document.createElement('dialog');
    dialog.className = 'cad-print-dialog cad-bom-dialog';
    const parts = bom.parts.length
        ? `<table class="cad-bom-table"><thead><tr><th>Item</th><th>Etiquetas</th><th>Qtd.</th><th>Peça</th><th>Descrição</th><th>${escapeXml(code)}</th></tr></thead><tbody>${bom.parts.map((p) => `<tr data-bom-ids="${escapeXml(p.ids.join(' '))}"><td>${p.item}</td><td>${escapeXml(p.etiquetas.join(', '))}</td><td>${p.quantidade}</td><td>${escapeXml(p.nome)}</td><td>${escapeXml(p.descricao)}</td><td>${escapeXml(p.codigo)}</td></tr>`).join('')}</tbody></table>`
        : '<p>Nenhuma peça no esquema.</p>';
    const hoses = bom.hoses.length
        ? `<table class="cad-bom-table"><thead><tr><th>Mangueira</th><th>Qtd.</th></tr></thead><tbody>${bom.hoses.map((h) => `<tr data-bom-ids="${escapeXml(h.ids.join(' '))}"><td>${escapeXml(h.rotulo)}</td><td>${h.quantidade}</td></tr>`).join('')}</tbody></table>`
        : '<p>Nenhuma ligação com rótulo de mangueira. Selecione a ligação e preencha Mangueira no painel.</p>';
    const show = bomSections(bom);
    const wires = `<table class="cad-bom-table"><thead><tr><th>Fio</th><th>De</th><th>Para</th><th>Cor</th><th>Seção (mm²)</th><th>Comprimento (mm)</th></tr></thead><tbody>${bom.wires.map((w) => `<tr data-bom-ids="${escapeXml(w.id)}"><td>${escapeXml(w.numero)}</td><td>${escapeXml(w.de)}</td><td>${escapeXml(w.para)}</td><td>${escapeXml(w.cor)}</td><td>${escapeXml(formatWireNumber(w.secao_mm2))}</td><td>${escapeXml(formatWireNumber(w.comprimento_mm))}</td></tr>`).join('')}</tbody></table>`;
    const hoseSection = show.hoses ? `<h4>Mangueiras</h4>${hoses}${bom.unlabeledLinks ? `<p>${bom.unlabeledLinks} ligação(ões) sem rótulo de mangueira.</p>` : ''}` : '';
    const wireSection = show.wires ? `<h4>Fios</h4>${wires}` : '';
    dialog.innerHTML = `<form method="dialog"><h3>Lista de peças</h3>${parts}${hoseSection}${wireSection}<p>Clique numa linha para selecionar as peças no desenho.</p><button type="button" data-csv>Baixar CSV</button><button type="button" data-print>Imprimir com o esquema</button><button value="cancel">Fechar</button></form>`;
    dialog.querySelector('[data-csv]').onclick = () => downloadBomCsv(editor);
    dialog.querySelector('[data-print]').onclick = () => {
        dialog.close();
        openSchematicPrintDialog(editor, { bom: true });
    };
    dialog.addEventListener('click', (event) => {
        const tr = event.target.closest?.('[data-bom-ids]');
        if (!tr) return;
        editor.selection = new Set(tr.dataset.bomIds.split(' ').filter(Boolean));
        editor.invalidate?.();
        editor.onChange?.(editor);
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}
