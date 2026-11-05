// Leitura de DXF binário: traduz os pares código/valor para o texto DXF que o parser já entende.
// Formato: sentinela de 22 bytes, depois código de grupo (2 bytes; 1 byte em R12 e anteriores,
// com 255 como escape para 2 bytes) e valor com tipo definido pela faixa do código.

const SENTINEL = [...new TextEncoder().encode('AutoCAD Binary DXF'), 13, 10, 26, 0];
// Quebra de linha dentro de um valor desalinharia os pares do texto gerado.
const LINE_BREAKS = /[\r\n]+/g;
const CODE_PAGE_LABELS = { 932: 'shift_jis', 950: 'big5' };

function valueType(code) {
    if (code >= 0 && code <= 9) return 'string';
    if (code >= 10 && code <= 59) return 'double';
    if (code >= 60 && code <= 79) return 'int16';
    if (code >= 90 && code <= 99) return 'int32';
    if (code === 100 || code === 101 || code === 102 || code === 105) return 'string';
    if (code >= 110 && code <= 149) return 'double';
    if (code >= 160 && code <= 169) return 'int64';
    if (code >= 170 && code <= 179) return 'int16';
    if (code >= 210 && code <= 239) return 'double';
    if (code >= 270 && code <= 289) return 'int16';
    if (code >= 290 && code <= 299) return 'bool';
    if (code >= 300 && code <= 309) return 'string';
    if (code >= 310 && code <= 319) return 'chunk';
    if (code >= 320 && code <= 369) return 'string';
    if (code >= 370 && code <= 389) return 'int16';
    if (code >= 390 && code <= 399) return 'string';
    if (code >= 400 && code <= 409) return 'int16';
    if (code >= 410 && code <= 419) return 'string';
    if (code >= 420 && code <= 429) return 'int32';
    if (code >= 430 && code <= 439) return 'string';
    if (code >= 440 && code <= 459) return 'int32';
    if (code >= 460 && code <= 469) return 'double';
    if (code >= 470 && code <= 481) return 'string';
    if (code === 999) return 'string';
    if (code === 1004) return 'chunk';
    if (code >= 1000 && code <= 1009) return 'string';
    if (code >= 1010 && code <= 1059) return 'double';
    if (code >= 1060 && code <= 1070) return 'int16';
    if (code === 1071) return 'int32';
    return null;
}

export function isBinaryDxf(bytes) {
    if (bytes.length < SENTINEL.length) return false;
    for (let i = 0; i < SENTINEL.length; i += 1) {
        if (bytes[i] !== SENTINEL[i]) return false;
    }
    return true;
}

function decoderForCodePage(name) {
    const page = Number(/^ANSI_(\d+)$/i.exec(name)?.[1]);
    try {
        return new TextDecoder(CODE_PAGE_LABELS[page] ?? `windows-${page}`);
    } catch {
        return new TextDecoder('windows-1252');
    }
}

export function binaryDxfToText(bytes) {
    if (!isBinaryDxf(bytes)) throw new Error('Arquivo não é DXF binário.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = bytes.length;
    let offset = SENTINEL.length;
    // O primeiro par é sempre 0/SECTION: nos dois bytes do código, o segundo também é zero.
    const wideCodes = bytes[offset + 1] === 0;
    // Nomes das variáveis do cabeçalho são ASCII; a codificação real vem de $ACADVER e $DWGCODEPAGE.
    let decoder = new TextDecoder('windows-1252');
    let unicode = false;
    let headerVariable = null;

    const need = (count) => {
        if (offset + count > size) throw new Error(`DXF binário truncado no byte ${offset}.`);
    };
    const readCode = () => {
        if (wideCodes) {
            need(2);
            offset += 2;
            return view.getInt16(offset - 2, true);
        }
        need(1);
        offset += 1;
        if (bytes[offset - 1] !== 255) return bytes[offset - 1];
        need(2);
        offset += 2;
        return view.getInt16(offset - 2, true);
    };
    const readers = {
        string() {
            const end = bytes.indexOf(0, offset);
            if (end < 0) throw new Error(`DXF binário truncado no byte ${offset}.`);
            const value = decoder.decode(bytes.subarray(offset, end)).replace(LINE_BREAKS, ' ');
            offset = end + 1;
            return value;
        },
        double() { need(8); offset += 8; return String(view.getFloat64(offset - 8, true)); },
        int16() { need(2); offset += 2; return String(view.getInt16(offset - 2, true)); },
        int32() { need(4); offset += 4; return String(view.getInt32(offset - 4, true)); },
        int64() { need(8); offset += 8; return String(view.getBigInt64(offset - 8, true)); },
        bool() { need(1); offset += 1; return String(bytes[offset - 1]); },
        chunk() {
            need(1);
            const length = bytes[offset];
            offset += 1;
            need(length);
            const hex = Array.from(bytes.subarray(offset, offset + length), (b) => b.toString(16).padStart(2, '0'));
            offset += length;
            return hex.join('').toUpperCase();
        },
    };

    const lines = [];
    while (offset < size) {
        const codeOffset = offset;
        const code = readCode();
        const type = valueType(code);
        if (!type) throw new Error(`Código de grupo ${code} desconhecido no byte ${codeOffset} do DXF binário.`);
        const value = readers[type]();
        lines.push(String(code), value);
        if (code === 0 && value === 'EOF') break;
        if (code === 0) headerVariable = null;
        else if (code === 9) headerVariable = value;
        else if (headerVariable === '$ACADVER' && code === 1 && value >= 'AC1021') {
            // A partir do AutoCAD 2007 os textos do DXF são sempre UTF-8, seja qual for $DWGCODEPAGE.
            decoder = new TextDecoder('utf-8');
            unicode = true;
        } else if (headerVariable === '$DWGCODEPAGE' && code === 3 && !unicode) {
            decoder = decoderForCodePage(value);
        }
    }
    return `${lines.join('\n')}\n`;
}

// Devolve o texto DXF de um File, em qualquer um dos dois formatos.
export async function readDxfFile(file) {
    if (typeof file.arrayBuffer !== 'function') return file.text();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return isBinaryDxf(bytes) ? binaryDxfToText(bytes) : new TextDecoder('utf-8').decode(bytes);
}
