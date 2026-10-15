// Leitor nativo de DWG R11/R12 (AC1009), que o acad-ts não abre.
// O formato é alinhado em bytes e sem compressão: cabeçalho com endereços das seções, tabelas de
// registros de tamanho fixo e entidades em sequência, cada uma com o próprio tamanho. O resultado
// vira um DXF mínimo e segue pelo mesmo parseDxf do restante do Traço.

const DEG = 180 / Math.PI;

// Tipos de entidade do R11/R12.
const LINE = 1, POINT = 2, CIRCLE = 3, TEXT = 7, ARC = 8, TRACE = 9, SOLID = 11, BLOCK = 12, ENDBLK = 13,
    INSERT = 14, ATTRIB = 16, POLYLINE = 19, VERTEX = 20, LINE3D = 21, FACE3D = 22, DIMENSION = 23;

// Bits do byte de flags comum.
const HAS_COLOR = 1, HAS_LTYPE = 2, HAS_ELEVATION = 4, HAS_THICKNESS = 8, HAS_HANDLE = 32, IN_PAPER = 64;
// Bits do byte extra (presente com IN_PAPER).
const HAS_EED = 2, HAS_VIEWPORT = 4;

class Reader {
    constructor(u8) {
        this.u8 = u8;
        this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        this.decoder = new TextDecoder('windows-1252');
        this.pos = 0;
    }
    u8at(at) { return this.u8[at]; }
    u16at(at) { return this.view.getUint16(at, true); }
    i16at(at) { return this.view.getInt16(at, true); }
    u32at(at) { return this.view.getUint32(at, true); }
    rc() { return this.u8[this.pos++]; }
    skip(n) { this.pos += n; }
    rs() { const v = this.u16at(this.pos); this.pos += 2; return v; }
    rd() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
    p2() { return { x: this.rd(), y: this.rd(), z: 0 }; }
    p3() { return { x: this.rd(), y: this.rd(), z: this.rd() }; }
    tv() {
        const length = this.rs();
        const text = this.name(this.pos, length);
        this.pos += length;
        return text;
    }
    name(at, length) {
        const raw = this.u8.subarray(at, at + length);
        const end = raw.indexOf(0);
        return this.decoder.decode(end < 0 ? raw : raw.subarray(0, end));
    }
}

/** Registros de uma tabela: descritor no cabeçalho com RS tamanho, RS quantidade, RS flags, RL endereço. */
function tableRecords(r, descriptor) {
    const size = r.u16at(descriptor);
    const count = r.u16at(descriptor + 2);
    const address = r.u32at(descriptor + 6);
    if (size < 33 || !count || address + size * count > r.u8.byteLength) return [];
    return Array.from({ length: count }, (_, i) => address + i * size);
}

/** Registro: RC flag, nome em 32 bytes, RS uso; depois os campos da tabela. */
function readTables(r) {
    const lineTypes = tableRecords(r, 0x4a).map((at) => r.name(at + 1, 32));
    const styles = tableRecords(r, 0x40).map((at) => r.name(at + 1, 32));
    const layers = tableRecords(r, 0x36).map((at) => {
        const color = r.i16at(at + 35);
        return {
            name: r.name(at + 1, 32),
            color: Math.abs(color) || 7,
            off: color < 0,
            frozen: Boolean(r.u8at(at) & 1),
            lineType: lineTypes[r.i16at(at + 37)] || 'CONTINUOUS',
        };
    });
    const blocks = tableRecords(r, 0x2c).map((at) => ({
        name: r.name(at + 1, 32),
        offset: r.u32at(at + 35) & 0x3fffffff,
    }));
    return { layers, lineTypes, styles, blocks };
}

function readEntity(r, at, tables) {
    const type = r.u8at(at);
    const flag = r.u8at(at + 1);
    r.pos = at + 4;
    const layerIndex = r.rs();
    const opts = r.rs();
    let extra = 0;
    if (flag & IN_PAPER) extra = r.rc();
    if (extra & HAS_EED) r.skip(r.rs());
    const e = {
        layer: tables.layers[layerIndex]?.name ?? '0',
        color: flag & HAS_COLOR ? r.rc() : 256, // sem cor própria = ByLayer
        paper: Boolean(flag & IN_PAPER),
    };
    if (flag & HAS_LTYPE) e.lineType = tables.lineTypes[r.rs()];
    // LINE, POINT e as entidades 3D marcam com este bit que as coordenadas vêm sem Z, sem gravar elevação.
    if (flag & HAS_ELEVATION && ![LINE, POINT, LINE3D, FACE3D].includes(type)) e.elevation = r.rd();
    if (flag & HAS_THICKNESS) r.rd();
    if (flag & HAS_HANDLE) r.skip(r.rc());
    if (extra & HAS_VIEWPORT) r.rs();
    const flat = Boolean(flag & HAS_ELEVATION);
    const z = e.elevation ?? 0;
    switch (type) {
        case LINE:
        case LINE3D:
            e.type = 'LINE';
            e.start = flat ? r.p2() : r.p3();
            e.end = flat ? r.p2() : r.p3();
            if (opts & 1) e.extrusion = r.p3();
            return e;
        case POINT:
            e.type = 'POINT';
            e.position = flat ? r.p2() : r.p3();
            if (opts & 1) e.extrusion = r.p3();
            return e;
        case CIRCLE:
        case ARC:
            e.type = type === CIRCLE ? 'CIRCLE' : 'ARC';
            e.center = { ...r.p2(), z };
            e.radius = r.rd();
            if (type === ARC) {
                e.startAngle = r.rd();
                e.endAngle = r.rd();
            }
            if (opts & 1) e.extrusion = r.p3();
            if (opts & 2) e.center.z = r.rd();
            return e;
        case TEXT:
        case ATTRIB: {
            e.type = 'TEXT';
            e.position = { ...r.p2(), z };
            e.height = r.rd();
            e.text = r.tv();
            let bit = 1;
            if (type === ATTRIB) {
                r.tv(); // etiqueta
                if (r.rc() & 1) return null; // atributo invisível
                bit = 2; // no ATTRIB os opcionais começam um bit acima
            }
            if (opts & bit) e.rotation = r.rd();
            if (opts & (bit << 1)) e.widthFactor = r.rd();
            if (opts & (bit << 2)) r.rd(); // inclinação
            if (opts & (bit << 3)) e.style = tables.styles[r.rc()];
            if (opts & (bit << 4)) r.rc(); // espelhamento
            if (opts & (bit << 5)) e.halign = r.rc();
            if (opts & (bit << 6)) e.alignment = { ...r.p2(), z };
            if (opts & (bit << 7)) e.extrusion = r.p3();
            if (opts & (bit << 8)) e.valign = r.rc();
            return e;
        }
        case TRACE:
        case SOLID:
            e.type = 'SOLID';
            e.corners = [r.p2(), r.p2(), r.p2(), r.p2()].map((p) => ({ ...p, z }));
            if (opts & 1) e.extrusion = r.p3();
            return e;
        case BLOCK:
            e.type = 'BLOCK';
            e.basePoint = r.p2();
            if (opts & 2) r.tv(); // caminho de xref
            if (opts & 4) e.name = r.tv();
            return e;
        case ENDBLK:
            e.type = 'ENDBLK';
            return e;
        case INSERT:
            e.type = 'INSERT';
            e.name = tables.blocks[r.rs()]?.name;
            e.position = { ...r.p2(), z };
            e.scaleX = opts & 1 ? r.rd() : 1;
            e.scaleY = opts & 2 ? r.rd() : 1;
            e.rotation = opts & 4 ? r.rd() : 0;
            if (opts & 8) r.rd(); // escala Z
            e.columns = opts & 16 ? r.rs() : 1;
            e.rows = opts & 32 ? r.rs() : 1;
            e.columnSpacing = opts & 64 ? r.rd() : 0;
            e.rowSpacing = opts & 128 ? r.rd() : 0;
            if (opts & 256) e.extrusion = r.p3();
            return e;
        case DIMENSION:
            // A cota vale pelo bloco anônimo que o AutoCAD já desenhou, em coordenadas do desenho.
            e.type = 'INSERT';
            e.name = tables.blocks[r.rs()]?.name;
            e.position = { x: 0, y: 0, z: 0 };
            e.scaleX = e.scaleY = 1;
            e.rotation = 0;
            e.columns = e.rows = 1;
            return e;
        case POLYLINE:
            e.type = 'POLYLINE';
            e.flag = opts & 1 ? r.rc() : 0;
            if (opts & 2) r.rd();
            if (opts & 4) r.rd();
            if (opts & 8) e.extrusion = r.p3();
            e.vertices = [];
            return e;
        case VERTEX:
            e.type = 'VERTEX';
            e.point = { ...r.p2(), z };
            if (opts & 1) r.rd();
            if (opts & 2) r.rd();
            e.bulge = opts & 4 ? r.rd() : 0;
            return e;
        default:
            return null; // 3DFACE, SHAPE, VIEWPORT, ATTDEF, SEQEND...
    }
}

/** Percorre uma seção de entidades; cada uma traz o próprio tamanho em bytes. */
function readEntities(r, start, end, tables) {
    const out = [];
    let polyline = null;
    for (let at = start; at + 4 <= end;) {
        const type = r.u8at(at);
        const size = r.u16at(at + 2);
        if (size < 4 || at + size > end) break;
        // Tipo com o bit alto ligado = entidade apagada.
        const e = type < 128 ? readEntity(r, at, tables) : null;
        if (e?.type === 'VERTEX') {
            polyline?.vertices.push({ ...e.point, bulge: e.bulge });
        } else if (type === 17) { // SEQEND
            polyline = null;
        } else if (e) {
            if (e.type === 'POLYLINE') polyline = e;
            out.push(e);
        }
        at += size;
    }
    return out;
}

/** Lê um DWG AC1009: layers, blocos e entidades do espaço modelo. */
export function readR12(u8) {
    const r = new Reader(u8);
    if (u8.byteLength < 0x60 || r.name(0, 6) !== 'AC1009') throw new Error('Não foi possível ler este DWG R12.');
    const tables = readTables(r);
    const entitiesStart = r.u32at(0x14);
    const entitiesEnd = Math.min(r.u32at(0x18), u8.byteLength);
    const blocksStart = r.u32at(0x1c);
    const blocksEnd = Math.min(blocksStart + (r.u32at(0x20) & 0x3fffffff), u8.byteLength);
    const extrasStart = r.u32at(0x24);
    const extrasEnd = Math.min(extrasStart + (r.u32at(0x28) & 0x3fffffff), u8.byteLength);

    const entities = [
        ...readEntities(r, entitiesStart, entitiesEnd, tables),
        ...(extrasStart ? readEntities(r, extrasStart, extrasEnd, tables) : []),
    ].filter((e) => !e.paper);

    // Seção de blocos: BLOCK … ENDBLK. Sem nome gravado no BLOCK, o nome vem da tabela pelo deslocamento.
    const byOffset = new Map(tables.blocks.map((b) => [b.offset, b.name]));
    const blocks = [];
    let current = null;
    for (const e of readEntitiesWithOffsets(r, blocksStart, blocksEnd, tables)) {
        if (e.type === 'BLOCK') {
            current = { name: e.name || byOffset.get(e.offset) || '', basePoint: e.basePoint, entities: [] };
            blocks.push(current);
        } else if (e.type === 'ENDBLK') {
            current = null;
        } else if (current) {
            current.entities.push(e);
        }
    }
    return { layers: tables.layers, blocks: blocks.filter((b) => b.name), entities };
}

function readEntitiesWithOffsets(r, start, end, tables) {
    if (!start || end <= start) return [];
    const out = readEntities(r, start, end, tables);
    // O deslocamento de cada BLOCK é relativo ao início da seção; a tabela de blocos usa o mesmo.
    let at = start;
    let i = 0;
    while (at + 4 <= end && i < out.length) {
        const type = r.u8at(at);
        const size = r.u16at(at + 2);
        if (size < 4) break;
        if (type === BLOCK) {
            while (i < out.length && out[i].type !== 'BLOCK') i += 1;
            if (i < out.length) out[i++].offset = at - start;
        }
        at += size;
    }
    return out;
}

function fmt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : '0';
}

class DxfOut {
    constructor() { this.lines = []; }
    pair(code, value) { this.lines.push(String(code), typeof value === 'number' ? fmt(value) : String(value ?? '')); }
    point(base, p) {
        this.pair(base, p?.x ?? 0);
        this.pair(base + 10, p?.y ?? 0);
        this.pair(base + 20, p?.z ?? 0);
    }
    common(type, e) {
        this.pair(0, type);
        this.pair(8, e.layer || '0');
        if (e.lineType && !/^bylayer$/i.test(e.lineType)) this.pair(6, e.lineType);
        this.pair(62, e.color);
    }
    extrusion(e) {
        const d = e.extrusion;
        // (0,0,0) ou +Z: sem extrusão.
        if (!d || (Math.abs(d.x) < 1e-12 && Math.abs(d.y) < 1e-12 && d.z >= 0)) return;
        this.point(210, d);
    }
    text() { return this.lines.join('\n') + '\n'; }
}

function writeEntity(out, e, blockNames) {
    switch (e.type) {
        case 'LINE':
            out.common('LINE', e);
            out.point(10, e.start);
            out.point(11, e.end);
            break;
        case 'POINT':
            out.common('POINT', e);
            out.point(10, e.position);
            break;
        case 'CIRCLE':
        case 'ARC':
            out.common(e.type, e);
            out.point(10, e.center);
            out.pair(40, e.radius);
            if (e.type === 'ARC') {
                out.pair(50, e.startAngle * DEG);
                out.pair(51, e.endAngle * DEG);
            }
            break;
        case 'TEXT':
            out.common('TEXT', e);
            out.point(10, e.position);
            out.pair(40, e.height);
            out.pair(1, e.text);
            if (e.rotation) out.pair(50, e.rotation * DEG);
            if (e.widthFactor && e.widthFactor !== 1) out.pair(41, e.widthFactor);
            if (e.style) out.pair(7, e.style);
            if (e.halign || e.valign) {
                out.pair(72, e.halign || 0);
                out.point(11, e.alignment ?? e.position);
                out.pair(73, e.valign || 0);
            }
            break;
        case 'SOLID':
            out.common('SOLID', e);
            e.corners.forEach((p, i) => out.point(10 + i, p));
            break;
        case 'POLYLINE':
            if (!e.vertices.length || (e.flag & (16 | 64))) return; // malhas não são contorno 2D
            out.common('POLYLINE', e);
            out.pair(66, 1);
            out.point(10, { x: 0, y: 0, z: e.elevation ?? 0 });
            out.pair(70, e.flag & (1 | 8));
            out.extrusion(e);
            for (const v of e.vertices) {
                out.common('VERTEX', e);
                out.point(10, v);
                if (v.bulge) out.pair(42, v.bulge);
            }
            out.pair(0, 'SEQEND');
            out.pair(8, e.layer || '0');
            return;
        case 'INSERT': {
            if (!e.name || !blockNames.has(e.name)) return;
            // MINSERT: uma inserção por célula da matriz, no sistema girado do bloco.
            const cos = Math.cos(e.rotation);
            const sin = Math.sin(e.rotation);
            for (let row = 0; row < Math.max(1, e.rows); row += 1) {
                for (let col = 0; col < Math.max(1, e.columns); col += 1) {
                    const dx = col * e.columnSpacing;
                    const dy = row * e.rowSpacing;
                    out.common('INSERT', e);
                    out.pair(2, e.name);
                    out.point(10, { x: e.position.x + dx * cos - dy * sin, y: e.position.y + dx * sin + dy * cos, z: e.position.z });
                    if (e.scaleX !== 1) out.pair(41, e.scaleX);
                    if (e.scaleY !== 1) out.pair(42, e.scaleY);
                    if (e.rotation) out.pair(50, e.rotation * DEG);
                    out.extrusion(e);
                }
            }
            return;
        }
        default:
            return;
    }
    out.extrusion(e);
}

/** Documento R12 lido → DXF ASCII com layers, blocos e entidades do espaço modelo. */
export function r12ToDxf({ layers, blocks, entities }) {
    const out = new DxfOut();
    out.pair(0, 'SECTION');
    out.pair(2, 'HEADER');
    out.pair(9, '$ACADVER');
    out.pair(1, 'AC1009');
    out.pair(0, 'ENDSEC');

    out.pair(0, 'SECTION');
    out.pair(2, 'TABLES');
    out.pair(0, 'TABLE');
    out.pair(2, 'LAYER');
    const seen = new Set();
    for (const layer of layers) {
        const key = layer.name.toUpperCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.pair(0, 'LAYER');
        out.pair(2, layer.name);
        out.pair(70, layer.frozen ? 1 : 0);
        out.pair(62, layer.off || layer.frozen ? -layer.color : layer.color);
        out.pair(6, layer.lineType);
    }
    out.pair(0, 'ENDTAB');
    out.pair(0, 'ENDSEC');

    const blockNames = new Set(blocks.map((b) => b.name));
    out.pair(0, 'SECTION');
    out.pair(2, 'BLOCKS');
    for (const block of blocks) {
        if (/^\*(?:model|paper)_space/i.test(block.name)) continue;
        out.pair(0, 'BLOCK');
        out.pair(8, '0');
        out.pair(2, block.name);
        out.pair(70, 0);
        out.point(10, block.basePoint);
        for (const e of block.entities) writeEntity(out, e, blockNames);
        out.pair(0, 'ENDBLK');
        out.pair(8, '0');
    }
    out.pair(0, 'ENDSEC');

    out.pair(0, 'SECTION');
    out.pair(2, 'ENTITIES');
    for (const e of entities) writeEntity(out, e, blockNames);
    out.pair(0, 'ENDSEC');
    out.pair(0, 'EOF');
    return out.text();
}

/** Lê um DWG R12 e devolve o DXF equivalente. */
export function r12DwgToDxfText(u8) {
    return r12ToDxf(readR12(u8));
}
