import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { lxdsToEntities, readZip, parseGeometry, looksLikeLxds } from '../src/cad/lxds.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// --------------------------------------------------------------------------- ZIP sintético

function zipOf(files, { deflate = false } = {}) {
    const encoder = new TextEncoder();
    const locals = [];
    const central = [];
    let offset = 0;
    files.forEach(({ name, data }) => {
        const nameBytes = encoder.encode(name);
        const stored = deflate ? new Uint8Array(deflateRawSync(Buffer.from(data))) : data;
        const local = new Uint8Array(30 + nameBytes.length + stored.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(8, deflate ? 8 : 0, true);
        lv.setUint32(18, stored.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        local.set(stored, 30 + nameBytes.length);
        locals.push(local);

        const entry = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(entry.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(10, deflate ? 8 : 0, true);
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

// --------------------------------------------------------------------------- Geometry2D sintético

class Writer {
    constructor() { this.bytes = []; }
    get length() { return this.bytes.length; }
    u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.bytes.push(...b); return this; }
    f64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.bytes.push(...b); return this; }
    zeros(n) { for (let i = 0; i < n; i += 1) this.bytes.push(0); return this; }
    str(text) {
        this.bytes.push(0x53, 0x00, text.length & 0xff, (text.length >> 8) & 0xff);
        [...text].forEach((c) => this.bytes.push(c.charCodeAt(0)));
        while (this.bytes.length % 4) this.bytes.push(0);
        return this;
    }
    raw(other) { this.bytes.push(...other.bytes); return this; }
    toUint8Array() { return new Uint8Array(this.bytes); }
}

function shapeRecord(className, body) {
    const sub = new Writer().u32(0xc1c1c1c1).u32(1).u32(body.length + 16).u32(0).str(className).raw(body).u32(0xc0c0c0c0);
    const inner = new Writer().str(`TGks${className}`).raw(sub).u32(0xd0d0d0d0);
    return new Writer().u32(0xd1d1d1d1).u32(0).u32(inner.length).u32(0).raw(inner);
}

function geometryOf(records) {
    const head = new Writer().u32(0x504d4342).u32(0).u32(1).u32(0).zeros(4096 - 16);
    const addresses = [];
    let cursor = head.length;
    const body = new Writer();
    records.forEach((r) => { addresses.push(cursor); body.raw(r); cursor += r.length; });
    return { bytes: new Writer().raw(head).raw(body).toUint8Array(), addresses };
}

const POINT = 0x00020010;

function lineBody(a, b) {
    return new Writer().u32(POINT).f64(a[0]).f64(a[1]).u32(POINT).f64(b[0]).f64(b[1]);
}

function circleBody(center, radius) {
    return new Writer().zeros(4).u32(POINT).f64(center[0]).f64(center[1]).f64(radius).zeros(4).f64(Math.PI / 4);
}

function polylineBody(vertices, closed) {
    const w = new Writer().zeros(8).u32(closed ? 1 : 0).u32(vertices.length);
    vertices.forEach((v, i) => w.u32(i + 1).f64(v[0]).f64(v[1]).f64(v[2] ?? 0).zeros(4));
    return w;
}

function lxdsOf({ deflate = false } = {}) {
    const records = [
        shapeRecord('Line', lineBody([0, 0], [100, 0])),
        shapeRecord('Circle', circleBody([50, 40], 8)),
        shapeRecord('LwPolyline', polylineBody([[0, 0, 0], [100, 0, 0], [100, 60, 0.5], [0, 60, 0]], true)),
    ];
    const { bytes, addresses } = geometryOf(records);
    const encoder = new TextEncoder();
    const shapesXml = `<?xml version="1.0" encoding="utf-8"?>
<Shapes2D>
\t<Line Handle="1" LayerName="DESENHO" GeoAddr="${addresses[0]}"/>
\t<Circle Handle="2" LayerName="DESENHO" GeoAddr="${addresses[1]}"/>
\t<LwPolyline Handle="3" LayerName="CORTE" GeoAddr="${addresses[2]}"/>
</Shapes2D>`;
    const modelXml = `<?xml version="1.0" encoding="utf-8"?>
<Model2D Handle="13" Name="Primary Doc">
\t<ExtMin X="0" Y="0"/>
\t<ExtMax X="100" Y="60"/>
</Model2D>`;
    const layersXml = `<?xml version="1.0" encoding="utf-8"?>
<Layers Handle="5">
\t<Layer Handle="1" Name="DESENHO" Color="16711680"/>
\t<Layer Handle="2" Name="CORTE" Color="65280"/>
</Layers>`;
    const infoXml = `<?xml version="1.0" encoding="utf-8"?>
<PackData><Application AppName="CypCut" AppVer="6.3.765.10"/></PackData>`;
    return zipOf([
        { name: 'info.xml', data: encoder.encode(infoXml) },
        { name: 'Model2D/content.xml', data: encoder.encode(modelXml) },
        { name: 'Layers/content.xml', data: encoder.encode(layersXml) },
        { name: 'Shapes2D/content.xml', data: encoder.encode(shapesXml) },
        { name: 'Geometry2D/data.bin', data: bytes },
    ], { deflate });
}

function polyBezierBody(curves) {
    const w = new Writer().zeros(16).u32(curves.length);
    curves.forEach((pts, i) => {
        w.u32(i + 1);
        pts.forEach((pt) => {
            w.u32(POINT).f64(pt[0]).f64(pt[1]);
        });
        w.u32(0);
    });
    return w;
}

function flyCutLxdsOf() {
    const bezierCurves = [
        [[30, 20], [35, 20], [35, 30], [30, 30]],
    ];
    const records = [
        shapeRecord('PolyBezier', polyBezierBody(bezierCurves)),
    ];
    const { bytes, addresses } = geometryOf(records);
    const encoder = new TextEncoder();
    const shapesXml = `<?xml version="1.0" encoding="utf-8"?>
<Shapes2D>
\t<ScanLines Handle="1" LayerName="GRADE" ChannelPort="1">
\t\t<Line X0="0" Y0="20" X1="30" Y1="20"/>
\t</ScanLines>
\t<PolyBezier Handle="2" LayerName="GRADE" GeoAddr="${addresses[0]}"/>
</Shapes2D>`;
    const blocksXml = `<?xml version="1.0" encoding="utf-8"?>
<Blocks>
\t<Block Handle="100" Name="FlyGroup1" Flags="256">
\t\t<Shapes>
\t\t\t<Shape Class="ScanLines" Handle="1"/>
\t\t\t<Shape Class="PolyBezier" Handle="2"/>
\t\t</Shapes>
\t</Block>
</Blocks>`;
    const modelXml = `<?xml version="1.0" encoding="utf-8"?>
<Model2D Handle="13" Name="Primary Doc">
\t<ExtMin X="100" Y="220"/>
\t<ExtMax X="135" Y="230"/>
\t<Shapes>
\t\t<Shape Class="Insert" Handle="200">
\t\t\t<InsertPoint X="100" Y="200"/>
\t\t\t<BlockName>FlyGroup1</BlockName>
\t\t\t<XScale>1</XScale>
\t\t\t<YScale>1</YScale>
\t\t</Shape>
\t</Shapes>
</Model2D>`;
    const layersXml = `<?xml version="1.0" encoding="utf-8"?>
<Layers Handle="5">
\t<Layer Handle="1" Name="GRADE" Color="65280"/>
</Layers>`;
    return zipOf([
        { name: 'Model2D/content.xml', data: encoder.encode(modelXml) },
        { name: 'Blocks/content.xml', data: encoder.encode(blocksXml) },
        { name: 'Layers/content.xml', data: encoder.encode(layersXml) },
        { name: 'Shapes2D/content.xml', data: encoder.encode(shapesXml) },
        { name: 'Geometry2D/data.bin', data: bytes },
    ]);
}

// --------------------------------------------------------------------------- testes

test('reconhece .lxds pela assinatura de ZIP', () => {
    assert.ok(looksLikeLxds(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])));
    assert.ok(!looksLikeLxds(new Uint8Array([0x30, 0x0a, 0x53, 0x45])));
});

test('lê o ZIP com entradas armazenadas e comprimidas', async () => {
    for (const deflate of [false, true]) {
        const zip = await readZip(lxdsOf({ deflate }).buffer);
        assert.ok(zip.names().includes('Geometry2D/data.bin'), `entrada ausente (deflate=${deflate})`);
        const info = new TextDecoder().decode(await zip.read('info.xml'));
        assert.match(info, /CypCut/);
    }
});

test('converte linha, círculo e polilinha fechada com bulge', async () => {
    const r = await lxdsToEntities(lxdsOf().buffer, { name: 'peça.lxds' });
    assert.equal(r.name, 'peça.dxf');
    assert.equal(r.application, 'CypCut 6.3.765.10');
    assert.deepEqual(r.stats, { lines: 1, circles: 1, polylines: 1, arcs: 1 });

    const line = r.entities.find((e) => e.type === 'line');
    assert.ok(close(line.start.x, 0) && close(line.end.x, 100) && line.layer === 'DESENHO');

    const circle = r.entities.find((e) => e.type === 'circle');
    assert.ok(close(circle.center.x, 50) && close(circle.center.y, 40) && close(circle.radius, 8));

    const poly = r.entities.find((e) => e.type === 'polyline');
    assert.equal(poly.closed, true, 'flags & 1 deve marcar a polilinha como fechada');
    assert.equal(poly.vertices.length, 4);
    assert.ok(close(poly.vertices[2].bulge, 0.5), 'bulge preservado no vértice certo');
    assert.equal(poly.layer, 'CORTE');

    // Layers declarados no arquivo viram layers do documento.
    assert.deepEqual(r.layers.map((l) => l.name).sort(), ['0', 'CORTE', 'DESENHO']);
});

test('geometria reconstruída bate com os extents declarados pelo arquivo', async () => {
    const r = await lxdsToEntities(lxdsOf().buffer, { name: 'peça.lxds' });
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    r.entities.forEach((e) => {
        if (e.type === 'line') { add(e.start.x, e.start.y); add(e.end.x, e.end.y); }
        else if (e.type === 'circle') { add(e.center.x - e.radius, e.center.y - e.radius); add(e.center.x + e.radius, e.center.y + e.radius); }
        else e.vertices.forEach((v) => add(v.x, v.y));
    });
    assert.ok(close(minX, r.extents.minX) && close(minY, r.extents.minY), 'canto inferior bate');
    assert.ok(close(maxX, r.extents.maxX) && close(maxY, r.extents.maxY), 'canto superior bate');
});

test('recusa arquivo fora do formato com mensagem clara', async () => {
    await assert.rejects(
        () => lxdsToEntities(new TextEncoder().encode('isto não é um zip').buffer),
        /não é um ZIP válido/,
    );
    const quebrado = lxdsOf();
    // Estraga o magic BCMP do Geometry2D mantendo o ZIP íntegro.
    const alvo = quebrado.indexOf(0x42);
    quebrado[quebrado.indexOf(0x4d, alvo)] = 0x00;
    await assert.rejects(() => lxdsToEntities(quebrado.buffer), /BCMP|Geometry2D/);
});

test('converte ScanLines inline, PolyBezier binário e resolve Inserts de blocos aplicando translação', async () => {
    const r = await lxdsToEntities(flyCutLxdsOf().buffer, { name: 'grade_flycut.lxds' });
    assert.equal(r.name, 'grade_flycut.dxf');
    assert.equal(r.entities.length, 2, 'espera 1 linha de ScanLines e 1 polilinha de PolyBezier');

    // A linha do ScanLines foi transladada por (X+100, Y+200)
    const line = r.entities.find((e) => e.type === 'line');
    assert.ok(line, 'linha de ScanLines deve ser gerada');
    assert.ok(close(line.start.x, 100) && close(line.start.y, 220), `início transladado correto: (${line.start.x}, ${line.start.y})`);
    assert.ok(close(line.end.x, 130) && close(line.end.y, 220), `fim transladado correto: (${line.end.x}, ${line.end.y})`);
    assert.equal(line.layer, 'GRADE');

    // A curva de PolyBezier foi aproximada por segmentos de polilinha e transladada
    const poly = r.entities.find((e) => e.type === 'polyline');
    assert.ok(poly, 'polilinha de PolyBezier deve ser gerada');
    assert.equal(poly.closed, false);
    assert.ok(poly.vertices.length >= 4);
    // Ponto inicial: (30 + 100, 20 + 200) = (130, 220)
    assert.ok(close(poly.vertices[0].x, 130) && close(poly.vertices[0].y, 220));
    // Ponto final: (30 + 100, 30 + 200) = (130, 230)
    const last = poly.vertices[poly.vertices.length - 1];
    assert.ok(close(last.x, 130) && close(last.y, 230));
    assert.equal(poly.layer, 'GRADE');
});

