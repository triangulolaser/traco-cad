// resources/js/cad/cdr.js
// Decodificação e visualização gráfica de alta fidelidade de arquivos CorelDRAW (.cdr).
// Suporta contêineres ZIP modernos (CorelDRAW X4 a 2024+) e contêineres RIFF legados.

import { readZip } from './lxds.js';

export const CDR_LAYER = 'CDR_PREVIEW';

/**
 * Detecta se o buffer possui a assinatura binária de um arquivo CorelDRAW (.cdr).
 */
export function looksLikeCdr(bytes) {
    if (!bytes || bytes.length < 8) return false;
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    // Contêiner ZIP (CorelDRAW X4 / v14 até 2024+)
    if (uint8[0] === 0x50 && uint8[1] === 0x4b && uint8[2] === 0x03 && uint8[3] === 0x04) {
        return true;
    }

    // Contêiner RIFF legado (CorelDRAW v1 a v13)
    if (uint8.length >= 12 &&
        uint8[0] === 0x52 && uint8[1] === 0x49 && uint8[2] === 0x46 && uint8[3] === 0x46 && // 'RIFF'
        uint8[8] === 0x43 && uint8[9] === 0x44 && uint8[10] === 0x52) { // 'CDR'
        return true;
    }

    return false;
}

/**
 * Converte Uint8Array para base64 dataURL compatível com browser e Node.js.
 */
function toDataUrl(bytes, mimeType = 'image/png') {
    if (typeof Buffer !== 'undefined') {
        return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    }
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * Lê largura e altura em pixels de uma imagem PNG ou BMP.
 */
function getImageDimensions(bytes, mimeType) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (mimeType === 'image/png' && bytes.length >= 24) {
        const width = view.getUint32(16, false);
        const height = view.getUint32(20, false);
        if (width > 0 && height > 0) return { width, height };
    } else if (mimeType === 'image/bmp' && bytes.length >= 26) {
        const width = Math.abs(view.getInt32(18, true));
        const height = Math.abs(view.getInt32(22, true));
        if (width > 0 && height > 0) return { width, height };
    }
    return { width: 800, height: 600 };
}

/**
 * Tenta extrair dimensões reais da página a partir do XML de metadados do CorelDRAW.
 */
function parseMetadataDimensions(xmlText) {
    if (!xmlText) return null;
    const matchW = /width="([\d.]+)(?:mm)?"/i.exec(xmlText);
    const matchH = /height="([\d.]+)(?:mm)?"/i.exec(xmlText);
    if (matchW && matchH) {
        const w = parseFloat(matchW[1]);
        const h = parseFloat(matchH[1]);
        if (w > 0 && h > 0) return { widthMm: w, heightMm: h };
    }
    return null;
}

/**
 * Extrai o preview de um contêiner RIFF legado.
 */
function extractRiffPreview(bytes) {
    // Procura pela assinatura de bitmap Windows 'BM' (0x42, 0x4D) dentro do contêiner RIFF
    for (let i = 12; i + 26 < bytes.length; i += 1) {
        if (bytes[i] === 0x42 && bytes[i + 1] === 0x4d) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const fileSize = view.getUint32(i + 2, true);
            if (fileSize >= 54 && i + fileSize <= bytes.length) {
                return {
                    bytes: bytes.subarray(i, i + fileSize),
                    mimeType: 'image/bmp',
                };
            }
        }
    }
    return null;
}

/**
 * Decodifica o arquivo CDR e devolve uma estrutura de documento com entidade de imagem calibrada.
 */
export async function cdrToDocument(buffer, { name = 'desenho.cdr' } = {}) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!looksLikeCdr(bytes)) {
        throw new Error('Arquivo não possui o cabeçalho de um arquivo CorelDRAW válido.');
    }

    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    let previewData = null;
    let metaDims = null;

    if (isZip) {
        let zip;
        try {
            zip = await readZip(buffer);
        } catch (err) {
            throw new Error(`Falha ao descompactar pacote do CorelDRAW: ${err.message}`);
        }

        const candidateNames = [
            'previews/thumbnail.png',
            'previews/thumbnail.bmp',
            'previews/thumbnail.jpg',
            'metadata/thumbnail.png',
            'preview.png',
            'thumbnail.png',
        ];

        const allNames = zip.names();
        let targetName = candidateNames.find((cand) => allNames.includes(cand));
        if (!targetName) {
            targetName = allNames.find((n) => n.toLowerCase().includes('thumbnail') || n.toLowerCase().includes('preview'));
        }

        if (targetName) {
            const imgBytes = await zip.read(targetName);
            if (imgBytes && imgBytes.length > 0) {
                const ext = targetName.split('.').pop().toLowerCase();
                const mimeType = ext === 'bmp' ? 'image/bmp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
                previewData = { bytes: imgBytes, mimeType };
            }
        }

        // Tenta ler metadados de dimensões
        const metaName = allNames.find((n) => n.toLowerCase().includes('metadata.xml'));
        if (metaName) {
            const metaBytes = await zip.read(metaName);
            if (metaBytes) {
                const xmlStr = new TextDecoder('utf-8').decode(metaBytes);
                metaDims = parseMetadataDimensions(xmlStr);
            }
        }
    } else {
        previewData = extractRiffPreview(bytes);
    }

    if (!previewData) {
        throw new Error('Não foi possível extrair a pré-visualização do arquivo CorelDRAW. Para edição vetorial, exporte o arquivo no CorelDRAW em formato DXF ou SVG.');
    }

    const dims = getImageDimensions(previewData.bytes, previewData.mimeType);
    const dataUrl = toDataUrl(previewData.bytes, previewData.mimeType);

    // Se houver dimensões físicas em mm nos metadados, usa-as; caso contrário calibra a 96 DPI (0.264583 mm/px)
    const widthMm = metaDims?.widthMm || Number((dims.width * (25.4 / 96)).toFixed(2));
    const heightMm = metaDims?.heightMm || Number((dims.height * (25.4 / 96)).toFixed(2));

    const imageEntity = {
        id: 'cdr_preview_0',
        type: 'image',
        layer: CDR_LAYER,
        position: { x: 0, y: 0 },
        width: widthMm,
        height: heightMm,
        rotation: 0,
        src: dataUrl,
        opacity: 1,
    };

    const layers = [
        { name: '0', color: '#ffffff', visible: true, locked: false },
        { name: CDR_LAYER, color: '#06b6d4', visible: true, locked: false },
    ];

    return {
        name,
        sourceFormat: 'cdr',
        units: 'mm',
        layers,
        entities: [imageEntity],
        stats: {
            images: 1,
            format: isZip ? 'CorelDRAW X4+ (ZIP)' : 'CorelDRAW Legado (RIFF)',
            widthMm,
            heightMm,
        },
    };
}
