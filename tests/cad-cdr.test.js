import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeCdr, cdrToDocument, CDR_LAYER } from '../src/cad/cdr.js';

// Construtor sintético de ZIP em memória (compatível com descompressão nativa)
function createSyntheticZip(files) {
    const encoder = new TextEncoder();
    const locals = [];
    const central = [];
    let offset = 0;

    files.forEach(({ name, data }) => {
        const nameBytes = encoder.encode(name);
        const stored = data;
        const local = new Uint8Array(30 + nameBytes.length + stored.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(8, 0, true); // Stored (sem compressão)
        lv.setUint32(18, stored.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        local.set(stored, 30 + nameBytes.length);
        locals.push(local);

        const entry = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(entry.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(20, stored.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        entry.set(nameBytes, 46);
        central.push(entry);
        offset += local.length;
    });

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + centralSize + eocd.length;
    const out = new Uint8Array(total);
    let p = 0;
    locals.forEach((l) => { out.set(l, p); p += l.length; });
    central.forEach((c) => { out.set(c, p); p += c.length; });
    out.set(eocd, p);
    return out;
}

// Cria um PNG sintético mínimo com chunk IHDR válido para extração de largura e altura
function createMockPng(width = 400, height = 300) {
    const png = new Uint8Array(33);
    // Assinatura PNG
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(png.buffer);
    // Tamanho do chunk IHDR (13 bytes)
    view.setUint32(8, 13, false);
    // 'IHDR'
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    // Largura e Altura
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    // Bit depth, color type, compression, filter, interlace
    png.set([8, 2, 0, 0, 0], 24);
    return png;
}

// Cria um BMP sintético mínimo com cabeçalho BITMAPINFOHEADER
function createMockBmp(width = 200, height = 150) {
    const bmp = new Uint8Array(54 + 64);
    bmp[0] = 0x42; // 'B'
    bmp[1] = 0x4d; // 'M'
    const view = new DataView(bmp.buffer);
    view.setUint32(2, bmp.length, true); // Tamanho do arquivo
    view.setUint32(10, 54, true); // Offset dos pixels
    view.setUint32(14, 40, true); // DIB header size
    view.setInt32(18, width, true); // Largura
    view.setInt32(22, height, true); // Altura
    view.setUint16(26, 1, true); // Color planes
    view.setUint16(28, 24, true); // Bits per pixel
    return bmp;
}

test('looksLikeCdr reconhece assinaturas modernas ZIP e legadas RIFF', () => {
    // ZIP moderno (CorelDRAW X4 a 2024+)
    const modernZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    assert.equal(looksLikeCdr(modernZip), true);

    // RIFF legado (CorelDRAW 1 a 13)
    const legacyRiff = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // 'RIFF'
        0x20, 0x00, 0x00, 0x00, // Tamanho
        0x43, 0x44, 0x52, 0x20, // 'CDR '
    ]);
    assert.equal(looksLikeCdr(legacyRiff), true);

    // Rejeições
    assert.equal(looksLikeCdr(new Uint8Array([0, 1, 2, 3])), false);
    assert.equal(looksLikeCdr(new TextEncoder().encode('<svg></svg>')), false);
    assert.equal(looksLikeCdr(null), false);
    assert.equal(looksLikeCdr(new Uint8Array(0)), false);
});

test('cdrToDocument importa contêiner ZIP moderno com thumbnail e metadados de dimensões', async () => {
    const png = createMockPng(800, 600);
    const metaXml = new TextEncoder().encode('<?xml version="1.0"?><metadata width="300mm" height="200mm" />');

    const zipBuffer = createSyntheticZip([
        { name: 'previews/thumbnail.png', data: png },
        { name: 'metadata/metadata.xml', data: metaXml },
    ]);

    const doc = await cdrToDocument(zipBuffer, { name: 'gabarito_chapa.cdr' });

    assert.equal(doc.name, 'gabarito_chapa.cdr');
    assert.equal(doc.sourceFormat, 'cdr');
    assert.equal(doc.entities.length, 1);

    const img = doc.entities[0];
    assert.equal(img.type, 'image');
    assert.equal(img.layer, CDR_LAYER);
    assert.equal(img.width, 300, 'Largura extraída dos metadados deve ser 300 mm');
    assert.equal(img.height, 200, 'Altura extraída dos metadados deve ser 200 mm');
    assert.ok(img.src.startsWith('data:image/png;base64,'));
    assert.equal(doc.stats.format, 'CorelDRAW X4+ (ZIP)');
});

test('cdrToDocument calibra dimensões por 96 DPI quando metadados XML não fornecem mm', async () => {
    const png = createMockPng(960, 480);
    const zipBuffer = createSyntheticZip([
        { name: 'previews/thumbnail.png', data: png },
    ]);

    const doc = await cdrToDocument(zipBuffer, { name: 'sem_meta.cdr' });
    const img = doc.entities[0];

    // 960 px @ 96 DPI = 10 polegadas = 254 mm
    // 480 px @ 96 DPI = 5 polegadas = 127 mm
    assert.equal(img.width, 254);
    assert.equal(img.height, 127);
});

test('cdrToDocument extrai preview de contêiner RIFF legado com chunk BMP', async () => {
    const bmp = createMockBmp(400, 300);
    // Cabeçalho RIFF CDR (12 bytes) + chunk BMP
    const riff = new Uint8Array(12 + bmp.length);
    riff.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
    new DataView(riff.buffer).setUint32(4, 4 + bmp.length, true);
    riff.set([0x43, 0x44, 0x52, 0x20], 8); // 'CDR '
    riff.set(bmp, 12);

    const doc = await cdrToDocument(riff, { name: 'logo_antigo.cdr' });
    assert.equal(doc.sourceFormat, 'cdr');
    assert.equal(doc.entities.length, 1);

    const img = doc.entities[0];
    assert.equal(img.type, 'image');
    assert.equal(img.layer, CDR_LAYER);
    assert.ok(img.src.startsWith('data:image/bmp;base64,'));
    assert.equal(doc.stats.format, 'CorelDRAW Legado (RIFF)');
});

test('cdrToDocument lança erro amigável quando contêiner CDR não possui preview gravado', async () => {
    const zipBuffer = createSyntheticZip([
        { name: 'content/document.dat', data: new Uint8Array([1, 2, 3]) },
    ]);

    await assert.rejects(
        async () => cdrToDocument(zipBuffer, { name: 'sem_preview.cdr' }),
        /Não foi possível extrair a pré-visualização do arquivo CorelDRAW/
    );
});

test('cdrToDocument rejeita buffers que não são CorelDRAW', async () => {
    await assert.rejects(
        async () => cdrToDocument(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
        /Arquivo não possui o cabeçalho de um arquivo CorelDRAW válido/
    );
});
