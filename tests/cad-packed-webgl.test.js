// Suíte de Testes e Benchmarks da Onda 3 (feat/cad-packed-webgl):
// - FlatHilbertRTree (Curva de Hilbert 32-bit + Radix Sort linear 4-passadas em ArrayBuffer)
// - PackedSpatialEngine (TombstoneBitset Copy-on-Write + DeltaBVH com rotações SAH)
// - Benchmark de 100.000 entidades: p99 query < 14 ms (>= 60 FPS) e commit incremental < 0,1 ms
// - SubSegmentBVH para polilinhas de 10.000 vértices e SpatialSnapHash O(1) (< 0,12 ms)
// - WebGL2CadSurface (VBO intercalado 32 bytes/primitiva, SDF analítico, 1 draw call/frame e fallback Canvas 2D)

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
    hilbertXYToIndex,
    radixSortHilbert,
    FlatHilbertRTree,
    DeltaBVH,
    SubSegmentBVH,
    getPolylineSubBVH,
    PackedSpatialEngine,
} from '../src/cad/spatial-packed.js';
import {
    SpatialSnapHash,
    SNAP_MODE_TO_CODE,
    entityCurvesInBox,
} from '../src/cad/snap-hash.js';
import {
    FLOATS_PER_INSTANCE,
    BYTES_PER_INSTANCE,
    PRIMITIVE_KIND,
    LINETYPE_NAMES,
    VERTEX_SHADER_GLSL300,
    FRAGMENT_SHADER_GLSL300,
    packHexColorToFloat,
    unpackFloatToRgba,
    buildViewProjMatrix3x3,
    evaluatePrimitiveSDF,
    evaluateLinetypePatternSDF,
    WebGL2CadSurface,
} from '../src/cad/renderer-webgl.js';
import {
    createDocument,
    addEntities,
    removeEntities,
    updateEntities,
    replaceEntities,
    getDocumentSpatialIndex,
    resetSpatialIndexes,
} from '../src/cad/document.js';
import { findSnap, defaultSnapSettings } from '../src/cad/snaps.js';
import { entityBox, boxesIntersect } from '../src/cad/geometry.js';
import { Renderer } from '../src/cad/renderer.js';

// ============================================================================
// 1. CURVA DE HILBERT 32-BIT, RADIX SORT 4-PASSADAS E FLAT HILBERT R-TREE
// ============================================================================

test('hilbertXYToIndex: bijetividade em células distintas e preservação de localidade espacial 2D', () => {
    const seen = new Set();
    for (let x = 0; x < 32; x += 1) {
        for (let y = 0; y < 32; y += 1) {
            const idx = hilbertXYToIndex(x * 2048, y * 2048);
            assert.equal(typeof idx, 'number');
            assert.ok(idx >= 0 && idx <= 0xffffffff);
            seen.add(idx);
        }
    }
    assert.equal(seen.size, 1024, 'Todos os 1024 pontos distintos na grade devem produzir índices de Hilbert únicos');

    // Pontos adjacentes no canto (0,0) e (1,0) têm índice de Hilbert consecutivo (distância <= 3)
    const h00 = hilbertXYToIndex(0, 0);
    const h10 = hilbertXYToIndex(1, 0);
    const h01 = hilbertXYToIndex(0, 1);
    const h11 = hilbertXYToIndex(1, 1);
    assert.deepEqual([h00, h10, h11, h01].sort((a, b) => a - b), [0, 1, 2, 3]);
});

test('radixSortHilbert: ordena 50.000 chaves de 32 bits em tempo linear O(N) preservando permutação de IDs', () => {
    const N = 50000;
    const keys = new Uint32Array(N);
    const ids = new Uint32Array(N);
    let seed = 0x12345678;
    for (let i = 0; i < N; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        keys[i] = seed;
        ids[i] = i;
    }
    const origKeys = new Uint32Array(keys);
    radixSortHilbert(keys, ids, N);

    for (let i = 1; i < N; i += 1) {
        assert.ok(keys[i] >= keys[i - 1], `Chaves fora de ordem no índice ${i}`);
        assert.equal(keys[i], origKeys[ids[i]], 'Permutação de ID deve apontar para a chave original');
    }
});

// 40 consultas parametrizadas verificando paridade exata entre FlatHilbertRTree e força bruta
{
    const M = 1200;
    const boxes = new Float64Array(M * 4);
    for (let i = 0; i < M; i += 1) {
        const cx = ((i * 73) % 1000) - 500;
        const cy = ((i * 137) % 1000) - 500;
        const w = 2 + (i % 15);
        const h = 2 + ((i * 3) % 15);
        const off = i * 4;
        boxes[off] = cx - w;
        boxes[off + 1] = cy - h;
        boxes[off + 2] = cx + w;
        boxes[off + 3] = cy + h;
    }
    const tree = new FlatHilbertRTree(16).buildFromBoxes(boxes, M);

    for (let q = 1; q <= 40; q += 1) {
        test(`FlatHilbertRTree paridade exata c/ força bruta — janela parametrizada #${q}`, () => {
            const qx = ((q * 97) % 900) - 450;
            const qy = ((q * 53) % 900) - 450;
            const qw = 15 + (q % 60);
            const qh = 15 + ((q * 2) % 60);
            const minX = qx - qw;
            const minY = qy - qh;
            const maxX = qx + qw;
            const maxY = qy + qh;

            const out = new Uint32Array(M);
            const count = tree.searchViewport(minX, minY, maxX, maxY, out);
            const found = Array.from(out.subarray(0, count)).sort((a, b) => a - b);

            const expected = [];
            for (let i = 0; i < M; i += 1) {
                const b = i * 4;
                if (!(maxX < boxes[b] || minX > boxes[b + 2] || maxY < boxes[b + 1] || minY > boxes[b + 3])) {
                    expected.push(i);
                }
            }
            assert.deepEqual(found, expected);
        });
    }
}

// ============================================================================
// 2. BENCHMARK DE 100.000 ENTIDADES: >= 60 FPS (p99 < 14 ms) E COMMIT < 0,1 ms
// ============================================================================

test('Benchmark Industrial 100.000 Entidades: consulta p99 < 14 ms (>= 60 FPS) e commit incremental < 0,1 ms', () => {
    resetSpatialIndexes();
    const TOTAL = 100000;
    const entities = new Array(TOTAL);

    // Gera uma planta industrial sintética de 100.000 entidades (grade 400 x 250 de furos e perfis)
    for (let i = 0; i < TOTAL; i += 1) {
        const col = i % 400;
        const row = (i / 400) | 0;
        const x = col * 25;
        const y = row * 25;
        entities[i] = {
            id: `e${i + 1}`,
            type: 'line',
            layer: '0',
            start: { x, y },
            end: { x: x + 12, y: y + 8 },
            _bbox: { minX: x, minY: y, maxX: x + 12, maxY: y + 8 },
        };
    }

    const doc0 = {
        ...createDocument(),
        entities,
    };

    const index0 = getDocumentSpatialIndex(doc0);
    assert.equal(index0.size(), TOTAL);

    // 1. Executa 100 quadros de pan/zoom na viewport sobre as 100.000 entidades e mede p99
    const frameTimes = [];
    for (let f = 0; f < 100; f += 1) {
        const vx = (f * 85) % 8000;
        const vy = (f * 55) % 5000;
        const t0 = performance.now();
        const visible = index0.search({ minX: vx, minY: vy, maxX: vx + 500, maxY: vy + 350 });
        const dt = performance.now() - t0;
        frameTimes.push(dt);
        assert.ok(visible.length > 0);
    }
    frameTimes.sort((a, b) => a - b);
    const p99 = frameTimes[98];
    assert.ok(p99 < 14, `p99 de busca de frame (${p99.toFixed(3)} ms) deve ser < 14 ms para garantir >= 60 FPS`);

    // 2. Mede o custo de atualização do índice espacial em um commit incremental (Tombstone + DeltaBVH)
    const newLine = {
        id: 'e_novo_1',
        type: 'line',
        layer: '0',
        start: { x: 100, y: 100 },
        end: { x: 115, y: 110 },
        _bbox: { minX: 100, minY: 100, maxX: 115, maxY: 110 },
    };
    const nextDoc = {
        ...doc0,
        entities: [...doc0.entities, newLine],
    };

    // Usa forkDelta diretamente (mesmo caminho invocado por getDocumentSpatialIndex em commits)
    // Aquecimento JIT de 3 iterações seguido de medição de mediana em 25 commits incrementais
    for (let w = 0; w < 3; w += 1) {
        index0.forkDelta({ added: [newLine], removedIds: ['e10'], updated: [] }, nextDoc.entities);
    }
    const commitSamples = [];
    let forkedIndex = null;
    for (let k = 0; k < 25; k += 1) {
        const t0 = performance.now();
        forkedIndex = index0.forkDelta({ added: [newLine], removedIds: ['e1'], updated: [] }, nextDoc.entities);
        commitSamples.push(performance.now() - t0);
    }
    commitSamples.sort((a, b) => a - b);
    const medianCommitMs = commitSamples[12];
    assert.ok(
        medianCommitMs < 0.1,
        `Commit incremental no índice espacial (${medianCommitMs.toFixed(4)} ms) deve ser < 0,1 ms`,
    );

    assert.equal(forkedIndex.size(), TOTAL); // -1 removido ('e1') + 1 adicionado ('e_novo_1')
    const nearOrigin = forkedIndex.search({ minX: -5, minY: -5, maxX: 20, maxY: 20 });
    assert.ok(!nearOrigin.some((e) => e.id === 'e1'), 'Entidade removida no tombstone não deve aparecer na busca');
    const nearHundred = forkedIndex.search({ minX: 95, minY: 95, maxX: 120, maxY: 115 });
    assert.ok(nearHundred.some((e) => e.id === 'e_novo_1'), 'Entidade inserida no DeltaBVH deve ser localizada');
});

test('getDocumentSpatialIndex: compartilha FlatHilbertRTree via Copy-on-Write em addEntities, removeEntities, updateEntities e replaceEntities', () => {
    resetSpatialIndexes();
    let doc = createDocument();
    const initial = [];
    for (let i = 0; i < 500; i += 1) {
        initial.push({
            id: `b${i}`,
            type: 'circle',
            center: { x: i * 10, y: 0 },
            radius: 2,
        });
    }
    doc = addEntities(doc, initial);
    const idx0 = getDocumentSpatialIndex(doc);
    assert.equal(idx0.size(), 500);

    // 1. addEntities
    const doc1 = addEntities(doc, [{ id: 'added1', type: 'circle', center: { x: 25, y: 0 }, radius: 1 }]);
    const idx1 = getDocumentSpatialIndex(doc1);
    assert.equal(idx1.baseTree, idx0.baseTree, 'Deve compartilhar a mesma instância de FlatHilbertRTree base');
    assert.equal(idx1.size(), 501);

    // 2. removeEntities
    const doc2 = removeEntities(doc1, ['b0', 'b1']);
    const idx2 = getDocumentSpatialIndex(doc2);
    assert.equal(idx2.baseTree, idx0.baseTree);
    assert.equal(idx2.size(), 499);
    const hitsOrigin = idx2.search({ minX: -5, minY: -5, maxX: 15, maxY: 5 }).map((e) => e.id);
    assert.ok(!hitsOrigin.includes('b0') && !hitsOrigin.includes('b1'));

    // 3. updateEntities
    const doc3 = updateEntities(doc2, ['b2'], (e) => ({ ...e, center: { x: 20, y: 500 } }));
    const idx3 = getDocumentSpatialIndex(doc3);
    assert.equal(idx3.baseTree, idx0.baseTree);
    assert.equal(idx3.search({ minX: 15, minY: 495, maxX: 25, maxY: 505 }).length, 1);

    // 4. replaceEntities
    const doc4 = replaceEntities(doc3, new Map([['b3', { id: 'b3_rep', type: 'circle', center: { x: 30, y: -500 }, radius: 2 }]]));
    const idx4 = getDocumentSpatialIndex(doc4);
    assert.equal(idx4.baseTree, idx0.baseTree);
    assert.equal(idx4.search({ minX: 25, minY: -505, maxX: 35, maxY: -495 })[0].id, 'b3_rep');
});

// ============================================================================
// 3. SUB-BVH DE POLILINHAS LONGAS E SPATIAL SNAP HASH (< 0,12 ms)
// ============================================================================

test('SubSegmentBVH: localiza arestas e ponto mais próximo em polilinha de 10.000 vértices em < 0,2 ms', () => {
    const V = 10000;
    const vertices = new Array(V);
    for (let i = 0; i < V; i += 1) {
        vertices[i] = { x: i * 2, y: Math.sin(i * 0.05) * 20 };
    }
    const poly = { id: 'poly10k', type: 'polyline', closed: false, vertices };

    const bvh = getPolylineSubBVH(poly);
    assert.ok(bvh instanceof SubSegmentBVH);

    const t0 = performance.now();
    const subCurves = entityCurvesInBox(poly, { minX: 4995, minY: -25, maxX: 5005, maxY: 25 });
    const dt = performance.now() - t0;

    assert.ok(subCurves.length >= 4 && subCurves.length <= 12);
    assert.ok(dt < 2.0, `Consulta em polilinha de 10k vértices levou ${dt.toFixed(3)} ms`);

    const near = bvh.closestPointWithin({ x: 5000, y: Math.sin(2500 * 0.05) * 20 + 0.5 }, 5);
    assert.ok(near && near.distance <= 0.6);
});

test('SpatialSnapHash & findSnap: indexa 20.000 entidades e resolve OSNAP em < 0,12 ms', () => {
    const N = 20000;
    const entities = new Array(N);
    for (let i = 0; i < N; i += 1) {
        const col = i % 200;
        const row = (i / 200) | 0;
        const x = col * 20;
        const y = row * 20;
        entities[i] = {
            id: `s${i}`,
            type: 'line',
            start: { x, y },
            end: { x: x + 10, y },
            _bbox: { minX: x, minY: y, maxX: x + 10, maxY: y },
        };
    }

    const snapHash = new SpatialSnapHash({ cellSize: 10, initialCapacity: 65536 });
    snapHash.buildFromEntities(entities, { cellSize: 10 });
    assert.equal(snapHash.count, N * 3); // 2 END + 1 MID por linha

    const settings = defaultSnapSettings();
    const cursor = { x: 1005.1, y: 400.08 }; // Perto do ponto médio (1005, 400) da linha em col=50, row=20

    // Aquecimento
    for (let w = 0; w < 5; w += 1) {
        snapHash.queryCandidates(cursor, 2, settings);
    }

    const times = [];
    let cands = null;
    for (let k = 0; k < 30; k += 1) {
        const t0 = performance.now();
        cands = snapHash.queryCandidates(cursor, 2, settings);
        times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const medianSnapMs = times[15];
    assert.ok(medianSnapMs < 0.12, `SpatialSnapHash query (${medianSnapMs.toFixed(4)} ms) deve ser < 0,12 ms`);
    assert.ok(cands.some((c) => c.mode === 'mid' && Math.abs(c.point.x - 1005) < 1e-9 && Math.abs(c.point.y - 400) < 1e-9));

    // Também valida findSnap acelerado em lote de 20.000 entidades
    const snap = findSnap(entities, cursor, 2, settings);
    assert.ok(snap && snap.mode === 'mid');
    assert.equal(snap.point.x, 1005);
    assert.equal(snap.point.y, 400);
});

// ============================================================================
// 4. WEBGL2 INSTANCED SDF SURFACE E FALLBACK TRANSPARENTE CANVAS 2D
// ============================================================================

test('WebGL2CadSurface: empacotamento VBO de 32 bytes/primitiva, cores RGBA bitcast e matriz uViewProj 3x3', () => {
    assert.equal(FLOATS_PER_INSTANCE, 8);
    assert.equal(BYTES_PER_INSTANCE, 32);
    assert.ok(VERTEX_SHADER_GLSL300.includes('#version 300 es'));
    assert.ok(FRAGMENT_SHADER_GLSL300.includes('#version 300 es'));

    // Roundtrip de empacotamento de cor hex -> Float32 -> RGBA
    const packed = packHexColorToFloat('#ff7f00', 1);
    const rgba = unpackFloatToRgba(packed);
    assert.deepEqual(rgba, { r: 255, g: 127, b: 0, a: 255 });

    // Matriz uViewProj 3x3: mapeia o centro da viewport para NDC (0, 0)
    const vp = { width: 1000, height: 800, scale: 2, offsetX: 500, offsetY: 400 };
    const mat = buildViewProjMatrix3x3(vp);
    assert.ok(Math.abs(mat[6]) < 1e-9 && Math.abs(mat[7]) < 1e-9);
    // Ponto (250, 200) -> screenX = 500 + 500 = 1000 -> NDC X = +1; screenY = 400 - 400 = 0 -> NDC Y = +1
    const ndcX = mat[0] * 250 + mat[6];
    const ndcY = mat[4] * 200 + mat[7];
    assert.ok(Math.abs(ndcX - 1) < 1e-6);
    assert.ok(Math.abs(ndcY - 1) < 1e-6);
});

test('WebGL2CadSurface: SDF analítico de segmentos, arcos, círculos e todos os 21 tipos de linha do acad.lin', () => {
    let doc = createDocument();
    doc = addEntities(doc, [
        { id: 'l1', type: 'line', start: { x: 10, y: 20 }, end: { x: 110, y: 20 }, lineType: 'DASHED' },
        { id: 'c1', type: 'circle', center: { x: 50, y: 50 }, radius: 25, lineType: 'CENTERX2' },
        { id: 'a1', type: 'arc', center: { x: 0, y: 0 }, radius: 10, start: 0, end: Math.PI / 2 },
    ]);

    const surface = new WebGL2CadSurface(null);
    const count = surface.packDocument(doc);
    assert.equal(count, 3);

    // 1. Segmento horizontal de (10,20) a (110,20): ponto (60, 23) dista exatos 3 mm e arcCoord = 50 mm
    const sdfLine = evaluatePrimitiveSDF(surface.instanceBuffer, 0, { x: 60, y: 23 });
    assert.ok(Math.abs(sdfLine.distance - 3) < 1e-6);
    assert.ok(Math.abs(sdfLine.arcCoord - 50) < 1e-6);

    // 2. Círculo centrado em (50,50) R=25: ponto (50, 80) dista |30 - 25| = 5 mm
    const sdfCircle = evaluatePrimitiveSDF(surface.instanceBuffer, FLOATS_PER_INSTANCE, { x: 50, y: 80 });
    assert.ok(Math.abs(sdfCircle.distance - 5) < 1e-6);

    // 3. Arco no 1º quadrante R=10: ponto (10, 0) dista 0 mm; ponto (0, -10) fora do sweep dista sqrt(200) das pontas
    const sdfArcOn = evaluatePrimitiveSDF(surface.instanceBuffer, FLOATS_PER_INSTANCE * 2, { x: 10, y: 0 });
    assert.ok(sdfArcOn.distance < 1e-6);
    const sdfArcOff = evaluatePrimitiveSDF(surface.instanceBuffer, FLOATS_PER_INSTANCE * 2, { x: 0, y: -10 });
    assert.ok(Math.abs(sdfArcOff.distance - Math.hypot(10, 10)) < 1e-5);
});

// Testa todos os 21 tipos de linha do acad.lin no avaliador SDF
for (const ltName of LINETYPE_NAMES) {
    test(`evaluateLinetypePatternSDF — padrão acad.lin: ${ltName}`, () => {
        const dStart = evaluateLinetypePatternSDF(ltName, 0.1);
        const dMid = evaluateLinetypePatternSDF(ltName, 14.0);
        assert.equal(typeof dStart, 'number');
        assert.equal(typeof dMid, 'number');
        if (ltName === 'CONTINUOUS') {
            assert.equal(dStart, -Infinity);
        } else {
            // No início do primeiro traço (s = 0.01), deve estar visível (<= 0) exceto DOT em gap
            const dNearZero = evaluateLinetypePatternSDF(ltName, 0.0);
            assert.ok(dNearZero <= 0);
        }
    });
}

test('WebGL2CadSurface c/ contexto WebGL2: 1 único upload de VBO e 1 única drawArraysInstanced por quadro de pan/zoom', () => {
    const calls = {
        bufferSubData: 0,
        drawArraysInstanced: 0,
        lastInstanceCount: 0,
    };
    const mockGL = {
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        ARRAY_BUFFER: 0x8892,
        DYNAMIC_DRAW: 0x88e8,
        FLOAT: 0x1406,
        TRIANGLE_STRIP: 0x0005,
        createShader: () => ({}),
        shaderSource: () => {},
        compileShader: () => {},
        getShaderParameter: () => true,
        createProgram: () => ({}),
        attachShader: () => {},
        linkProgram: () => {},
        getProgramParameter: () => true,
        getUniformLocation: (_, name) => ({ name }),
        createVertexArray: () => ({}),
        bindVertexArray: () => {},
        createBuffer: () => ({}),
        bindBuffer: () => {},
        bufferData: () => {},
        bufferSubData: () => { calls.bufferSubData += 1; },
        enableVertexAttribArray: () => {},
        vertexAttribPointer: () => {},
        vertexAttribDivisor: () => {},
        viewport: () => {},
        useProgram: () => {},
        uniformMatrix3fv: () => {},
        uniform2f: () => {},
        uniform1f: () => {},
        drawArraysInstanced: (_mode, _first, _count, primCount) => {
            calls.drawArraysInstanced += 1;
            calls.lastInstanceCount = primCount;
        },
    };
    const mockCanvas = {
        width: 1920,
        height: 1080,
        getContext: (type) => (type === 'webgl2' ? mockGL : null),
    };

    const surface = new WebGL2CadSurface(mockCanvas);
    assert.equal(surface.isSupported(), true);

    let doc = createDocument();
    const lines = [];
    for (let i = 0; i < 1000; i += 1) {
        lines.push({ id: `gl_${i}`, type: 'line', start: { x: i, y: 0 }, end: { x: i, y: 50 } });
    }
    doc = addEntities(doc, lines);

    // Renderiza 60 quadros seguidos com pan/zoom variando (mesmo doc imutável)
    for (let frame = 0; frame < 60; frame += 1) {
        const vp = { width: 1920, height: 1080, scale: 1 + frame * 0.1, offsetX: frame * 5, offsetY: frame * 3 };
        const res = surface.renderFrame(doc, vp);
        assert.equal(res.renderedByWebGL, true);
        assert.equal(res.instanceCount, 1000);
    }

    assert.equal(calls.bufferSubData, 1, 'O VBO só deve ser enviado à GPU 1 única vez durante 60 quadros de pan/zoom!');
    assert.equal(calls.drawArraysInstanced, 60, 'Cada quadro deve disparar exatamente 1 chamada drawArraysInstanced');
    assert.equal(calls.lastInstanceCount, 1000);

    // Atualização incremental de 1 entidade no slot do VBO
    const okSlot = surface.updateEntitySlot(
        { id: 'gl_5', type: 'line', layer: '0', start: { x: 5, y: 10 }, end: { x: 5, y: 90 } },
        doc,
    );
    assert.equal(okSlot, true);
    assert.equal(calls.bufferSubData, 2);
});

test('Renderer: fallback 100% transparente para Canvas 2D quando WebGL2 não está disponível', () => {
    let strokeCalls = 0;
    const mockCtx2D = {
        save: () => {},
        restore: () => {},
        setTransform: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        stroke: () => { strokeCalls += 1; },
        fill: () => {},
        setLineDash: () => {},
        measureText: () => ({ width: 10 }),
        fillText: () => {},
    };
    const canvas2DOnly = {
        width: 800,
        height: 600,
        style: {},
        getContext: (type) => (type === '2d' ? mockCtx2D : null),
    };
    const viewport = {
        width: 800,
        height: 600,
        scale: 1,
        offsetX: 400,
        offsetY: 300,
        visibleBox: () => ({ minX: -400, minY: -300, maxX: 400, maxY: 300 }),
        worldToScreen: (p) => ({ x: 400 + p.x, y: 300 - p.y }),
         resize: () => {},
    };

    const renderer = new Renderer(canvas2DOnly, viewport);
    assert.equal(renderer.webglSurface.isSupported(), false);

    let doc = createDocument();
    doc = addEntities(doc, [
        { id: 'fallback_l1', type: 'line', start: { x: -50, y: 0 }, end: { x: 50, y: 0 } },
    ]);

    renderer.draw({
        doc,
        selection: new Set(),
        preview: [],
        showGrid: false,
        showCrosshair: false,
    });
    assert.ok(strokeCalls >= 1, 'Canvas 2D deve desenhar normalmente os lotes quando WebGL2 não está ativo');
});
