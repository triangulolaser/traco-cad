// Suporte nativo a DWG (leitura e gravação) em memória via @node-projects/acad-ts.
// Não requer binários externos (dwg2dxf), QCAD ou endpoints de servidor.

import { createDocument, addEntities } from './document.js';
import { parseDxf, writeDxf } from './dxf.js';

/**
 * Converte um buffer binário DWG em texto DXF ASCII diretamente em memória.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<string>}
 */
export async function dwgToDxfText(buffer) {
    const acad = await import('@node-projects/acad-ts');
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const reader = new acad.DwgReader(u8);
    const cadDoc = reader.read();

    const chunks = [];
    const stream = {
        write(text) { chunks.push(text); },
        flush() {},
        close() {},
        dispose() {},
    };
    const writer = new acad.DxfWriter(stream, cadDoc);
    writer.write();
    return chunks.join('');
}

/**
 * Lê um buffer binário de arquivo DWG (.dwg) e retorna um documento nativo do Traço CAD.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {Object} [options]
 * @param {string} [options.name]
 * @param {string|null} [options.filePath]
 * @returns {Promise<Object>} Traço CAD Document
 */
export async function dwgToDocument(buffer, { name = 'desenho.dwg', filePath = null } = {}) {
    const dxfText = await dwgToDxfText(buffer);
    const parsed = parseDxf(dxfText, { preserveBlocks: true, preserveDimensions: true });

    // addEntities normaliza e dá id a cada entidade, como na abertura de DXF.
    return addEntities({
        ...createDocument(),
        layers: parsed.layers,
        blocks: parsed.blocks ?? {},
        entities: [],
        units: parsed.units,
        name,
        filePath: filePath || null,
        sourceFormat: 'dwg',
        ...(parsed.view ? { view: parsed.view } : {}),
    }, parsed.entities);
}

/**
 * Converte um documento do Traço CAD para binário AutoCAD DWG (.dwg).
 *
 * Passa pelo DXF completo do Traço (cotas, hachuras, splines, elipses, blocos,
 * textos e estilos) e deixa o acad-ts gravar o DWG, em vez de reescrever
 * entidade a entidade: assim o DWG nunca fica atrás do DXF.
 *
 * @param {Object} doc
 * @param {Object} [options]
 * @param {Object} [options.view]
 * @returns {Promise<Uint8Array>}
 */
export async function documentToDwg(doc, { view = doc.view } = {}) {
    const acad = await import('@node-projects/acad-ts');
    const dxfText = writeDxf(doc, { view });
    const cadDoc = new acad.DxfReader(new TextEncoder().encode(dxfText)).read();
    ensureDwgDefaults(acad, cadDoc);
    applyActiveView(acad, cadDoc, view);
    return acad.DwgWriter.writeToBuffer(cadDoc);
}

// O DxfReader do acad-ts não traz a altura do VPORT *Active; reaplica a vista.
function applyActiveView(acad, cadDoc, view) {
    if (!view?.center || !Number.isFinite(view.center.x) || !Number.isFinite(view.center.y) || !(view.height > 0)) return;
    const vp = Array.from(cadDoc.vPorts).find((v) => v.name.toLowerCase() === '*active');
    if (!vp) return;
    vp.center = new acad.XY(view.center.x, view.center.y);
    vp.viewHeight = view.height;
    if (view.aspectRatio > 0) vp.aspectRatio = view.aspectRatio;
}

// O cabeçalho DWG referencia ByLayer/ByBlock/Continuous e o layer 0; o DXF do
// Traço só declara os tipos de linha que usa.
function ensureDwgDefaults(acad, cadDoc) {
    const { LineType } = acad;
    for (const [name, make] of [
        [LineType.byLayerName, () => LineType.byLayer],
        [LineType.byBlockName, () => LineType.byBlock],
        [LineType.continuousName, () => LineType.continuous],
    ]) {
        if (!cadDoc.lineTypes.contains(name)) cadDoc.lineTypes.add(make());
    }
    // O acad-ts grava ACAD_FIELDLIST como dicionário comum e o motor ODA
    // (BricsCAD, QCAD) recusa o arquivo inteiro: "AcDbDictionary can't be cast
    // to AcDbFieldList". A lista é opcional e o Traço não usa campos.
    const root = cadDoc.rootDictionary;
    const fieldList = Array.from(root.entryNames).find((key) => key.toLowerCase() === 'acad_fieldlist');
    if (fieldList) root.remove(fieldList);
}

// Conversão legada no servidor para compatibilidade retroativa
export async function convertDwg(file, url, fetcher = globalThis.fetch) {
    if (file.size > 20 * 1024 * 1024) throw new Error('O limite para DWG é 20 MB.');
    if (!url) throw new Error('Conversão DWG não configurada.');
    const body = new FormData();
    body.append('file', file, file.name);
    const response = await fetcher(url, {
        method: 'POST', credentials: 'same-origin', body,
        headers: { Accept: 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || '' },
        signal: AbortSignal.timeout(75000),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || `Falha na conversão DWG (HTTP ${response.status}).`);
    }
    const text = await response.text();
    if (!/\bSECTION\b/.test(text) || !/\bEOF\b/.test(text)) throw new Error('O conversor não retornou um DXF válido.');
    return text;
}
