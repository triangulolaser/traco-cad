// Modos de trabalho do Traço (ADR 0007, E2a): CAD e Esquemático, e as folhas do esquema.
//
// O modo é do documento e fica gravado no .traco (`modo: "esquema"`); DXF e DWG abrem sempre no CAD.
// A chave só troca de modo com o desenho vazio: um esquema com símbolos não vira CAD (não há estado
// intermediário que faça sentido para as ligações); o caminho para o CAD é exportar em DXF.
//
// Folha é atributo da entidade (`sheet`). A folha ativa é estado de vista do documento
// (`currentSheet`, trocada sem registro no desfazer, como o layer atual); entidades das outras
// folhas ficam fora do desenho, da seleção e dos snaps.

export const MODE_CAD = 'cad';
export const MODE_SCHEMATIC = 'esquema';

// Folha A4 deitada, em mm, com o canto inferior esquerdo na origem.
export const SHEET_FORMATS = { A4: { width: 297, height: 210 } };

// Comandos que só aparecem no modo Esquemático (barra e autocompletar). No CAD continuam
// funcionando pelo terminal digitando o nome inteiro.
export const SCHEMATIC_ONLY_COMMANDS = new Set(['SYMBOL', 'CONNECT', 'SYMLIB', 'SCHEMACHECK', 'SHEET', 'BOM']);

export function documentMode(doc) {
    return doc?.mode === MODE_SCHEMATIC ? MODE_SCHEMATIC : MODE_CAD;
}

export function isSchematicDocument(doc) {
    return documentMode(doc) === MODE_SCHEMATIC;
}

export function canSwitchMode(doc) {
    return !doc?.entities?.length;
}

export function defaultSheet(n = 1) {
    return { id: `F${n}`, nome: `Folha ${n}`, formato: 'A4' };
}

// Documento vazio passa para o modo pedido. Recusa com desenho: devolve null.
export function withMode(doc, mode) {
    if (documentMode(doc) === mode) return doc;
    if (!canSwitchMode(doc)) return null;
    if (mode === MODE_SCHEMATIC) {
        const sheet = defaultSheet(1);
        // Nome padrão acompanha o formato que o modo salva.
        const name = doc.name && /\.dxf$/i.test(doc.name) && !doc.filePath ? doc.name.replace(/\.dxf$/i, '.traco') : doc.name;
        return { ...doc, name, mode: MODE_SCHEMATIC, sheets: [sheet], currentSheet: sheet.id };
    }
    const { mode: _m, sheets: _s, currentSheet: _c, carimbo: _t, ...rest } = doc;
    if (rest.name && /\.traco$/i.test(rest.name) && !rest.filePath && rest.sourceFormat !== 'traco') rest.name = rest.name.replace(/\.traco$/i, '.dxf');
    return rest;
}

export function sheetsOf(doc) {
    return isSchematicDocument(doc) && Array.isArray(doc.sheets) && doc.sheets.length ? doc.sheets : [];
}

export function activeSheetId(doc) {
    const sheets = sheetsOf(doc);
    if (!sheets.length) return null;
    return sheets.some((s) => s.id === doc.currentSheet) ? doc.currentSheet : sheets[0].id;
}

// Folha da entidade; sem campo, é a primeira (esquema da E1, antes das folhas).
export function entitySheet(doc, entity) {
    const sheets = sheetsOf(doc);
    if (!sheets.length) return null;
    return entity?.sheet && sheets.some((s) => s.id === entity.sheet) ? entity.sheet : sheets[0].id;
}

export function entityOnActiveSheet(doc, entity) {
    const sheets = doc?.sheets;
    if (doc?.mode !== MODE_SCHEMATIC || !Array.isArray(sheets) || sheets.length < 2) return true;
    return entitySheet(doc, entity) === activeSheetId(doc);
}

// Documento normalizado ao abrir: modo esquema sempre tem ao menos uma folha válida.
export function normalizeSchematicDocument(doc) {
    if (!isSchematicDocument(doc)) return doc;
    let sheets = Array.isArray(doc.sheets) ? doc.sheets.filter((s) => s && s.id) : [];
    const seen = new Set();
    sheets = sheets.filter((s) => (seen.has(String(s.id)) ? false : seen.add(String(s.id))))
        .map((s, i) => ({ id: String(s.id), nome: String(s.nome || `Folha ${i + 1}`), formato: SHEET_FORMATS[s.formato] ? s.formato : 'A4' }));
    if (!sheets.length) sheets = [defaultSheet(1)];
    const currentSheet = sheets.some((s) => s.id === doc.currentSheet) ? doc.currentSheet : sheets[0].id;
    return { ...doc, sheets, currentSheet };
}

function nextSheetNumber(sheets) {
    let n = sheets.length + 1;
    const ids = new Set(sheets.map((s) => s.id));
    while (ids.has(`F${n}`)) n += 1;
    return n;
}

export function addSheet(doc, nome = null) {
    const sheets = sheetsOf(doc);
    if (!sheets.length) throw new Error('Folhas só existem no modo Esquemático.');
    const n = nextSheetNumber(sheets);
    const sheet = { ...defaultSheet(n), nome: nome?.trim() || `Folha ${n}` };
    return { doc: { ...doc, sheets: [...sheets, sheet], currentSheet: sheet.id }, sheet };
}

export function renameSheet(doc, id, nome) {
    const name = String(nome ?? '').trim();
    if (!name) throw new Error('Nome da folha vazio.');
    const sheets = sheetsOf(doc);
    if (!sheets.some((s) => s.id === id)) throw new Error(`Folha ${id} não existe.`);
    return { ...doc, sheets: sheets.map((s) => (s.id === id ? { ...s, nome: name } : s)) };
}

// Excluir folha leva junto o que está nela. A última folha não sai.
export function removeSheet(doc, id) {
    const sheets = sheetsOf(doc);
    if (sheets.length < 2) throw new Error('O esquema precisa de ao menos uma folha.');
    if (!sheets.some((s) => s.id === id)) throw new Error(`Folha ${id} não existe.`);
    const rest = sheets.filter((s) => s.id !== id);
    const entities = doc.entities.filter((e) => entitySheet(doc, e) !== id);
    // Entidades sem campo eram da primeira folha; ao excluir a primeira, as restantes ganham o campo.
    const first = rest[0].id;
    const stamped = entities.map((e) => (e.sheet && rest.some((s) => s.id === e.sheet) ? e : { ...e, sheet: first }));
    const currentSheet = doc.currentSheet === id ? first : doc.currentSheet;
    return { ...doc, sheets: rest, currentSheet, entities: stamped };
}

export function setActiveSheet(doc, id) {
    if (!sheetsOf(doc).some((s) => s.id === id)) return doc;
    if (doc.currentSheet === id) return doc;
    return { ...doc, currentSheet: id };
}

export function sheetEntityCounts(doc) {
    const counts = new Map(sheetsOf(doc).map((s) => [s.id, 0]));
    for (const e of doc.entities ?? []) {
        const s = entitySheet(doc, e);
        if (counts.has(s)) counts.set(s, counts.get(s) + 1);
    }
    return counts;
}

export function sheetFrame(doc) {
    const sheet = sheetsOf(doc).find((s) => s.id === activeSheetId(doc));
    if (!sheet) return null;
    const f = SHEET_FORMATS[sheet.formato] ?? SHEET_FORMATS.A4;
    return { minX: 0, minY: 0, maxX: f.width, maxY: f.height, sheet };
}
