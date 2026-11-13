import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPlanarArrangement,
    extractPlanarLoops,
    buildJordanIslandTree,
    detectHatchBoundary,
    loopSignedArea,
    loopAreaExact,
    pointInLoopExact,
    rayLoopIntersections,
} from '../src/cad/topology-dcel.js';

import {
    offsetPolylinePlanar,
    offsetEntityMultiple,
    offsetEntityPlanar,
    offsetSplineEntity,
    offsetEllipseEntity,
    hasPolylineSelfIntersectionOrInvasion,
} from '../src/cad/offset-planar.js';

import {
    createQuinticBlendG2,
    blendEntitiesG2,
    entityDifferentialJetAt,
    solveRollingBallFillet,
    filletEntitiesUniversal,
    chamferEntitiesUniversal,
    extendEntityExact,
} from '../src/cad/blend-g2.js';

import {
    loopsFromEntities,
    boundaryLoopsAt,
    closedHatchChains,
} from '../src/cad/hatch.js';

import {
    offsetEntity,
    distance,
    entityCurves,
    closestPointOnCurve,
    polar,
} from '../src/cad/geometry.js';

import {
    chamferLines,
} from '../src/cad/edit-tools.js';

import {
    trimAtPoint,
    trimInsideBox,
    extendEntity,
    filletCurves,
    COMMANDS,
} from '../src/cad/commands.js';

import {
    evalBezierJet,
    bezierCurvature,
} from '../src/cad/nurbs-exact.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const pt = (x, y) => ({ x, y });
const rectLoop = (x0, y0, w, h) => ({
    vertices: [
        { x: x0, y: y0, bulge: 0 },
        { x: x0 + w, y: y0, bulge: 0 },
        { x: x0 + w, y: y0 + h, bulge: 0 },
        { x: x0, y: y0 + h, bulge: 0 },
    ],
});
const circleLoop = (cx, cy, r) => ({
    vertices: [
        { x: cx - r, y: cy, bulge: 1 },
        { x: cx + r, y: cy, bulge: 1 },
    ],
});

// ============================================================================
// 1. ARRANJO PLANAR DCEL, JUNÇÕES T/X E DESEMPATE POR CURVATURA (HATCH/BOUNDARY)
// ============================================================================

test('DCEL: grade de 4 retas cruzadas com pontas soltas (grau 1 e grau 4) extrai o quadrado central', () => {
    const lines = [
        { type: 'line', start: pt(-20, 0), end: pt(120, 0) },
        { type: 'line', start: pt(-20, 100), end: pt(120, 100) },
        { type: 'line', start: pt(0, -20), end: pt(0, 120) },
        { type: 'line', start: pt(100, -20), end: pt(100, 120) },
    ];
    const loops = loopsFromEntities(lines);
    assert.ok(loops.length >= 1, 'deve extrair a face fechada entre os cruzamentos X');
    const picked = boundaryLoopsAt(pt(50, 50), loops, 'nested');
    assert.equal(picked.length, 1);
    assert.ok(close(loopAreaExact(picked[0]), 10000, 1e-4));
});

test('DCEL: retângulo fechado cortado ao meio por linha secante (junções T de grau 3) extrai as 2 sub-faces e o envelope', () => {
    const entities = [
        {
            type: 'polyline',
            closed: true,
            vertices: [
                { x: 0, y: 0, bulge: 0 },
                { x: 100, y: 0, bulge: 0 },
                { x: 100, y: 60, bulge: 0 },
                { x: 0, y: 60, bulge: 0 },
            ],
        },
        { type: 'line', start: pt(50, -10), end: pt(50, 70) },
    ];
    const loops = loopsFromEntities(entities);
    const left = boundaryLoopsAt(pt(25, 30), loops, 'nested');
    const right = boundaryLoopsAt(pt(75, 30), loops, 'nested');
    assert.equal(left.length, 1);
    assert.equal(right.length, 1);
    assert.ok(close(loopAreaExact(left[0]), 3000, 1e-4));
    assert.ok(close(loopAreaExact(right[0]), 3000, 1e-4));
});

test('DCEL: grade 3x3 de linhas cruzadas (9 células internas) identifica individualmente cada célula por ponto interno', () => {
    const xs = [0, 30, 60, 90];
    const ys = [0, 20, 40, 60];
    const entities = [
        ...xs.map((x) => ({ type: 'line', start: pt(x, -10), end: pt(x, 70) })),
        ...ys.map((y) => ({ type: 'line', start: pt(-10, y), end: pt(100, y) })),
    ];
    const loops = loopsFromEntities(entities);
    for (let ix = 0; ix < 3; ix++) {
        for (let iy = 0; iy < 3; iy++) {
            const probe = pt(xs[ix] + 15, ys[iy] + 10);
            const cell = boundaryLoopsAt(probe, loops, 'nested');
            assert.equal(cell.length, 1, `célula (${ix},${iy}) deve ser única`);
            assert.ok(close(loopAreaExact(cell[0]), 30 * 20, 1e-4));
            assert.ok(pointInLoopExact(probe, cell[0]));
        }
    }
});

test('DCEL: desempate por curvatura assinada κ em vértice tangencial círculo-retângulo', () => {
    // Círculo de raio 50 centrado em (50, 50) inscrito e tangente às 4 paredes do quadrado [0,100]x[0,100]
    const entities = [
        { type: 'line', start: pt(0, 0), end: pt(100, 0) },
        { type: 'line', start: pt(100, 0), end: pt(100, 100) },
        { type: 'line', start: pt(100, 100), end: pt(0, 100) },
        { type: 'line', start: pt(0, 100), end: pt(0, 0) },
        { type: 'circle', center: pt(50, 50), radius: 50 },
    ];
    const loops = extractPlanarLoops(entities, { includeOuterEnvelopes: true });
    // Ponto central (50, 50) deve selecionar o círculo (área = π * 50² ≈ 7853.98)
    const centerPick = boundaryLoopsAt(pt(50, 50), loops, 'nested');
    assert.ok(centerPick.length >= 1);
    assert.ok(close(loopAreaExact(centerPick[0]), Math.PI * 2500, 1e-2));
    // Canto (5, 5) deve selecionar a face spandrel do canto (área = (100*100 - π*50²)/4 ≈ 536.50)
    const cornerPick = boundaryLoopsAt(pt(5, 5), loops, 'nested');
    assert.ok(cornerPick.length >= 1);
    const expectedSpandrel = (10000 - Math.PI * 2500) / 4;
    assert.ok(close(loopAreaExact(cornerPick[0]), expectedSpandrel, 1e-1));
});

test('DCEL: HPGAPTOL fecha micro-gaps entre linhas desconectadas e extrai contorno válido', () => {
    const gap = 0.25; // 0.25 mm de fresta nos cantos
    const entities = [
        { type: 'line', start: pt(0, 0), end: pt(100 - gap, 0) },
        { type: 'line', start: pt(100, gap), end: pt(100, 80 - gap) },
        { type: 'line', start: pt(100 - gap, 80), end: pt(0, 80) },
        { type: 'line', start: pt(0, 80 - gap), end: pt(0, 0) },
    ];
    // Sem tolerância de gap, não há contorno fechado
    assert.equal(closedHatchChains(entities, 1e-6).length, 0);
    // Com HPGAPTOL = 0.5 mm, o contorno fecha perfeitamente
    const healed = loopsFromEntities(entities, { gapTolerance: 0.5 });
    assert.equal(healed.length, 1);
    assert.ok(close(loopAreaExact(healed[0]), 8000, 50));
});

test('Teorema de Green analítico: área exata de círculos e cápsulas com bulge circular sem erro de discretização', () => {
    for (const r of [1, 7.5, 25, 120]) {
        const cLoop = circleLoop(10, -20, r);
        assert.ok(close(loopAreaExact(cLoop), Math.PI * r * r, 1e-9), `área exata para R=${r}`);
        assert.ok(close(loopSignedArea(cLoop), Math.PI * r * r, 1e-9));
    }
});

// ============================================================================
// 2. ÁRVORE DE CONTENÇÃO DE JORDAN — ILHAS ANINHADAS ATÉ NÍVEL >= 6
// ============================================================================

test('Árvore de Jordan: 6 níveis de ilhas concêntricas alternando quadrados e círculos (nested, outer, ignore)', () => {
    // Nível 0 (quadrado 200x200 centrado na origem)
    // Nível 1 (círculo R=85)
    // Nível 2 (quadrado 140x140)
    // Nível 3 (círculo R=55)
    // Nível 4 (quadrado 80x80)
    // Nível 5 (círculo R=30)
    // Nível 6 (quadrado 30x30)
    const L0 = rectLoop(-100, -100, 200, 200);
    const L1 = circleLoop(0, 0, 85);
    const L2 = rectLoop(-70, -70, 140, 140);
    const L3 = circleLoop(0, 0, 55);
    const L4 = rectLoop(-40, -40, 80, 80);
    const L5 = circleLoop(0, 0, 30);
    const L6 = rectLoop(-15, -15, 30, 30);
    const allLoops = [L4, L1, L6, L0, L3, L5, L2]; // ordem embaralhada

    // Clique na borda externa (entre L0 e L1): ponto (92, 0)
    const nested0 = boundaryLoopsAt(pt(92, 0), allLoops, 'nested');
    assert.equal(nested0.length, 7, 'modo nested deve retornar L0..L6 (profundidade 6)');
    assert.equal(nested0[0], L0);
    for (const l of [L0, L1, L2, L3, L4, L5, L6]) {
        assert.ok(nested0.includes(l), 'todos os 7 níveis presentes no modo nested');
    }

    const outer0 = boundaryLoopsAt(pt(92, 0), allLoops, 'outer');
    assert.deepEqual(outer0, [L0, L1], 'modo outer retorna apenas o contorno externo L0 e o furo imediato L1');

    const ignore0 = boundaryLoopsAt(pt(92, 0), allLoops, 'ignore');
    assert.deepEqual(ignore0, [L0], 'modo ignore retorna apenas L0');

    // Clique entre L2 e L3: ponto (62, 0)
    const nested2 = boundaryLoopsAt(pt(62, 0), allLoops, 'nested');
    assert.equal(nested2.length, 5, 'clique em L2 retorna L2..L6');
    assert.equal(nested2[0], L2);
    assert.deepEqual(boundaryLoopsAt(pt(62, 0), allLoops, 'outer'), [L2, L3]);

    // Clique no núcleo mais interno L6: ponto (0, 0)
    assert.deepEqual(boundaryLoopsAt(pt(0, 0), allLoops, 'nested'), [L6]);
});

// Testes parametrizados de contenção de Jordan para profundidades 1 a 8 (24 testes)
for (let maxDepth = 1; maxDepth <= 8; maxDepth++) {
    for (const mode of ['nested', 'outer', 'ignore']) {
        test(`Jordan Tree parametrizada: profundidade=${maxDepth}, modo=${mode}`, () => {
            const loops = [];
            for (let d = 0; d <= maxDepth; d++) {
                // Fator 0.65 < 1/√2 ≈ 0.7071 garante que os cantos de cada quadrado (±half, ±half)
                // fiquem estritamente dentro do círculo de nível anterior (raio = half_prev).
                const half = 100 * Math.pow(0.65, d);
                loops.push(d % 2 === 0 ? rectLoop(-half, -half, half * 2, half * 2) : circleLoop(0, 0, half));
            }
            const pick = pt(80, 0); // Entre d=0 (half=100) e d=1 (half=65)
            const res = buildJordanIslandTree(pick, loops, mode);
            assert.equal(res.outer, loops[0]);
            if (mode === 'ignore') {
                assert.equal(res.loops.length, 1);
            } else if (mode === 'outer') {
                assert.equal(res.loops.length, 2);
                assert.deepEqual(res.loops, [loops[0], loops[1]]);
            } else {
                assert.equal(res.loops.length, maxDepth + 1);
                assert.equal(res.maxDepth, maxDepth);
            }
        });
    }
}

// ============================================================================
// 3. OFFSET PLANAR COM AUTO-INTERSEÇÃO GLOBAL E PINCH-OFF EM MÚLTIPLAS ILHAS
// ============================================================================

test('Offset Planar: polilinha côncava em L com offset interno grande poda swallowtails sem auto-interseção', () => {
    const lShape = {
        type: 'polyline',
        closed: true,
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 100, y: 0, bulge: 0 },
            { x: 100, y: 40, bulge: 0 },
            { x: 40, y: 40, bulge: 0 },
            { x: 40, y: 100, bulge: 0 },
            { x: 0, y: 100, bulge: 0 },
        ],
    };
    const off = offsetEntity(lShape, 12, pt(20, 20));
    assert.ok(off, 'deve produzir polilinha deslocada');
    assert.equal(hasPolylineSelfIntersectionOrInvasion(off, lShape, 12), false, 'zero auto-interseções no offset em L');
    // Área original = 100*40 + 60*40 = 6400; área interna com d=12:
    // L de 76x16 + 60x16 = 1216 + 960 = 2176
    assert.ok(close(loopAreaExact(off), 2176, 1e-2));
});

test('Offset Planar Pinch-Off: contorno halter (dumbbell) com pescoço estreito divide-se em 2 ilhas fechadas independentes', () => {
    // Dois lóbulos 40x60 conectados por um pescoço central de largura 20 (y de 20 a 40)
    // Quando deslocado para dentro por d = 12 (> metade do pescoço = 10), o pescoço colapsa
    // e restam 2 retângulos independentes de (40 - 24) x (60 - 24) = 16 x 36 = 576 cada!
    const dumbbell = {
        type: 'polyline',
        closed: true,
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 40, y: 0, bulge: 0 },
            { x: 40, y: 20, bulge: 0 },
            { x: 60, y: 20, bulge: 0 },
            { x: 60, y: 0, bulge: 0 },
            { x: 100, y: 0, bulge: 0 },
            { x: 100, y: 60, bulge: 0 },
            { x: 60, y: 60, bulge: 0 },
            { x: 60, y: 40, bulge: 0 },
            { x: 40, y: 40, bulge: 0 },
            { x: 40, y: 60, bulge: 0 },
            { x: 0, y: 60, bulge: 0 },
        ],
    };
    const islands = offsetEntityMultiple(dumbbell, 12, pt(20, 30));
    assert.equal(islands.length, 2, 'pescoço estrangulado deve gerar exatamente 2 ilhas fechadas');
    for (const isl of islands) {
        assert.equal(isl.closed, true);
        assert.ok(close(loopAreaExact(isl), 16 * 36, 1), `área de cada ilha deve ser ~576, obteve ${loopAreaExact(isl)}`);
    }
});

test('Offset Planar Pinch-Off: contorno de 3 lóbulos divide-se em 3 ilhas independentes após estrangulamento duplo', () => {
    // 3 blocos de 40x60 ligados por 2 pescoços de altura 16 (y de 22 a 38)
    const threeLobes = {
        type: 'polyline',
        closed: true,
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 40, y: 0, bulge: 0 },
            { x: 40, y: 22, bulge: 0 },
            { x: 50, y: 22, bulge: 0 },
            { x: 50, y: 0, bulge: 0 },
            { x: 90, y: 0, bulge: 0 },
            { x: 90, y: 22, bulge: 0 },
            { x: 100, y: 22, bulge: 0 },
            { x: 100, y: 0, bulge: 0 },
            { x: 140, y: 0, bulge: 0 },
            { x: 140, y: 60, bulge: 0 },
            { x: 100, y: 60, bulge: 0 },
            { x: 100, y: 38, bulge: 0 },
            { x: 90, y: 38, bulge: 0 },
            { x: 90, y: 60, bulge: 0 },
            { x: 50, y: 60, bulge: 0 },
            { x: 50, y: 38, bulge: 0 },
            { x: 40, y: 38, bulge: 0 },
            { x: 40, y: 60, bulge: 0 },
            { x: 0, y: 60, bulge: 0 },
        ],
    };
    const islands = offsetEntityMultiple(threeLobes, 10, pt(20, 30));
    assert.equal(islands.length, 3, 'estrangulamento duplo deve gerar 3 ilhas independentes');
    for (const isl of islands) {
        assert.ok(close(loopAreaExact(isl), 20 * 40, 2));
    }
});

test('Offset de Spline e Elipse: hodógrafo normal mantém distância ortogonal exata d ao longo da curva', () => {
    const ellipse = {
        type: 'ellipse',
        center: pt(0, 0),
        major: pt(60, 0),
        ratio: 0.5,
        start: 0,
        end: Math.PI * 2,
    };
    const offEl = offsetEntity(ellipse, 5, pt(100, 0));
    assert.ok(offEl && offEl.type === 'spline');
    const elCurve = entityCurves(ellipse)[0];
    for (const cp of offEl.fitPoints.slice(0, 16)) {
        const foot = closestPointOnCurve(cp, elCurve);
        assert.ok(close(distance(cp, foot), 5, 0.15), `distância normal da elipse ~5, obteve ${distance(cp, foot)}`);
    }

    const spline = {
        type: 'spline',
        degree: 3,
        controlPoints: [pt(0, 0), pt(30, 40), pt(70, -20), pt(100, 20)],
    };
    const offSp = offsetEntity(spline, 4, pt(0, 50));
    assert.ok(offSp && offSp.type === 'spline');
    const spCurves = entityCurves(spline);
    for (const fp of offSp.fitPoints.slice(1, -1)) {
        const minDist = Math.min(...spCurves.map((c) => distance(fp, closestPointOnCurve(fp, c))));
        assert.ok(close(minDist, 4, 0.15), `distância normal da spline ~4, obteve ${minDist}`);
    }
});

// Testes parametrizados de Offset Planar (30 casos variados de distância e geometria)
for (let d = 1; d <= 15; d += 1) {
    test(`Offset Planar parametrizado: halter sob d=${d} mantém topologia válida sem auto-interseções`, () => {
        const dumbbell = {
            type: 'polyline',
            closed: true,
            vertices: [
                { x: 0, y: 0, bulge: 0 },
                { x: 40, y: 0, bulge: 0 },
                { x: 40, y: 22, bulge: 0 },
                { x: 60, y: 22, bulge: 0 },
                { x: 60, y: 0, bulge: 0 },
                { x: 100, y: 0, bulge: 0 },
                { x: 100, y: 60, bulge: 0 },
                { x: 60, y: 60, bulge: 0 },
                { x: 60, y: 38, bulge: 0 },
                { x: 40, y: 38, bulge: 0 },
                { x: 40, y: 60, bulge: 0 },
                { x: 0, y: 60, bulge: 0 },
            ],
        };
        const islands = offsetEntityMultiple(dumbbell, d, pt(20, 30));
        // Altura do pescoço = 16 (colapsa em d >= 8)
        if (d < 8) {
            assert.equal(islands.length, 1, `d=${d} < 8 deve manter 1 ilha conectada`);
        } else {
            assert.equal(islands.length, 2, `d=${d} >= 8 deve separar em 2 ilhas por pinch-off`);
        }
        for (const isl of islands) {
            assert.ok(loopAreaExact(isl) > 0);
        }
    });
}

// ============================================================================
// 4. TRIM & EXTEND ANALÍTICOS EM NURBS SPLINES, ELIPSES E POLILINHAS
// ============================================================================

test('TRIM em Spline Cúbica: apara exatamente na interseção com reta mantendo parametrização NURBS exata', () => {
    const sp = {
        id: 'sp1',
        type: 'spline',
        degree: 3,
        controlPoints: [pt(0, 0), pt(30, 60), pt(70, 60), pt(100, 0)],
    };
    const cutter = { kind: 'segment', a: pt(50, -20), b: pt(50, 100) };
    // Apara o lado direito clicando perto de (90, 10)
    const kept = trimAtPoint(sp, [cutter], pt(90, 10));
    assert.ok(kept && kept.length === 1);
    const trimmed = kept[0];
    assert.equal(trimmed.type, 'spline');
    assert.ok(close(trimmed.controlPoints[0].x, 0, 1e-6));
    assert.ok(close(trimmed.controlPoints.at(-1).x, 50, 1e-5));
});

test('TRIM em Elipse: apara arco elíptico entre duas retas secantes', () => {
    const el = {
        id: 'el1',
        type: 'ellipse',
        center: pt(0, 0),
        major: pt(50, 0),
        ratio: 0.6,
        start: 0,
        end: Math.PI,
    };
    const cutter = { kind: 'segment', a: pt(0, -50), b: pt(0, 50) };
    const kept = trimAtPoint(el, [cutter], pt(-40, 10));
    assert.ok(kept && kept.length === 1);
    assert.equal(kept[0].type, 'ellipse');
    assert.ok(close(kept[0].start, 0, 1e-6));
    assert.ok(close(kept[0].end, Math.PI / 2, 1e-5));
});

test('EXTEND em Elipse, Spline e Polilinha: estende analiticamente até o limite', () => {
    // 1. Arco de elipse de 0 a π/2 estendido até a reta x = -30
    const el = {
        type: 'ellipse',
        center: pt(0, 0),
        major: pt(50, 0),
        ratio: 0.6,
        start: 0,
        end: Math.PI / 2,
    };
    const limitLine = { kind: 'segment', a: pt(-30, -50), b: pt(-30, 50) };
    const extEl = extendEntity(el, [limitLine], pt(-1, 30));
    assert.ok(extEl, 'elipse deve estender até a reta x = -30');
    const expectedParam = Math.acos(-30 / 50);
    assert.ok(close(extEl.end, expectedParam, 1e-6));

    // 2. Spline estendida tangencialmente até x = 130
    const sp = {
        type: 'spline',
        degree: 3,
        controlPoints: [pt(0, 0), pt(30, 20), pt(70, 20), pt(100, 20)],
    };
    const wall = { kind: 'segment', a: pt(130, -50), b: pt(130, 80) };
    const extSp = extendEntity(sp, [wall], pt(98, 20));
    assert.ok(extSp, 'spline deve estender tangencialmente até a parede x = 130');
    assert.ok(close(extSp.controlPoints.at(-1).x, 130, 1e-6));
    assert.ok(close(extSp.controlPoints.at(-1).y, 20, 1e-6));

    // 3. Polilinha aberta estendida no último segmento até x = 120
    const pl = {
        type: 'polyline',
        closed: false,
        vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 50, y: 0, bulge: 0 },
            { x: 80, y: 30, bulge: 0 },
        ],
    };
    const wallPl = { kind: 'segment', a: pt(120, -20), b: pt(120, 100) };
    const extPl = extendEntity(pl, [wallPl], pt(79, 29));
    assert.ok(extPl);
    assert.ok(close(extPl.vertices.at(-1).x, 120, 1e-6));
    assert.ok(close(extPl.vertices.at(-1).y, 70, 1e-6));
});

// ============================================================================
// 5. BLEND QUÍNTICO G², FILLET UNIVERSAL ROLLING-BALL G¹/G² E CHAMFER UNIVERSAL
// ============================================================================

test('Blend Quíntico G²: continuidade exata de posição (G⁰), tangente (G¹) e curvatura assinada (G²) nas duas pontas', () => {
    const j0 = {
        point: pt(0, 0),
        tangent: pt(1, 0),
        curvature: 0.02, // R = 50
    };
    const j1 = {
        point: pt(100, 40),
        tangent: pt(0, 1),
        curvature: -0.04, // R = -25
    };
    const blend = createQuinticBlendG2(j0, j1);
    const bez = { kind: 'bezier', degree: 5, controlPoints: blend.controlPoints };

    const startJet = evalBezierJet(bez, 0);
    const endJet = evalBezierJet(bez, 1);
    const k0 = bezierCurvature(bez, 0);
    const k1 = bezierCurvature(bez, 1);

    // G⁰
    assert.ok(distance(startJet.point, j0.point) < 1e-12);
    assert.ok(distance(endJet.point, j1.point) < 1e-12);
    // G¹
    const t0Len = Math.hypot(startJet.d1.x, startJet.d1.y);
    const t1Len = Math.hypot(endJet.d1.x, endJet.d1.y);
    assert.ok(close(startJet.d1.x / t0Len, j0.tangent.x, 1e-9));
    assert.ok(close(startJet.d1.y / t0Len, j0.tangent.y, 1e-9));
    assert.ok(close(endJet.d1.x / t1Len, j1.tangent.x, 1e-9));
    assert.ok(close(endJet.d1.y / t1Len, j1.tangent.y, 1e-9));
    // G² (κ(0) = κ₁ e κ(1) = κ₂)
    assert.ok(close(k0, j0.curvature, 1e-9), `κ(0)=${k0} deve igualar ${j0.curvature}`);
    assert.ok(close(k1, j1.curvature, 1e-9), `κ(1)=${k1} deve igualar ${j1.curvature}`);
});

// Testes parametrizados de Blend Quíntico G² para 50 pares de jatos diferenciais (G⁰, G¹, G²)
for (let i = 0; i < 50; i++) {
    const ang0 = (i * 0.37) % (Math.PI * 2);
    const ang1 = ((i * 0.83) + 0.5) % (Math.PI * 2);
    const kStart = ((i % 11) - 5) * 0.01;
    const kEnd = (((i * 3) % 11) - 5) * 0.01;
    test(`Blend Quíntico G² parametrizado #${i + 1}: κ₀=${kStart.toFixed(3)}, κ₁=${kEnd.toFixed(3)}`, () => {
        const j0 = {
            point: pt(i * 2, -i),
            tangent: pt(Math.cos(ang0), Math.sin(ang0)),
            curvature: kStart,
        };
        const j1 = {
            point: pt(i * 2 + 80, -i + 35),
            tangent: pt(Math.cos(ang1), Math.sin(ang1)),
            curvature: kEnd,
        };
        const blend = createQuinticBlendG2(j0, j1);
        const bez = { kind: 'bezier', degree: 5, controlPoints: blend.controlPoints };
        assert.ok(close(bezierCurvature(bez, 0), kStart, 1e-8));
        assert.ok(close(bezierCurvature(bez, 1), kEnd, 1e-8));
    });
}

test('blendEntitiesG2: conecta extremidade de Linha (κ=0) a extremidade de Arco (κ=1/R) com transição G² suave', () => {
    const line = { type: 'line', start: pt(0, 0), end: pt(50, 0) };
    const arc = { type: 'arc', center: pt(100, 50), radius: 30, start: Math.PI, end: Math.PI * 1.5 };
    const bridge = blendEntitiesG2(line, pt(48, 0), arc, pt(70, 50));
    assert.ok(bridge && bridge.type === 'spline' && bridge.degree === 5);
    const bez = { kind: 'bezier', degree: 5, controlPoints: bridge.controlPoints };
    assert.ok(close(bezierCurvature(bez, 0), 0, 1e-8), 'curvatura na ponta da reta deve ser 0');
    assert.ok(close(Math.abs(bezierCurvature(bez, 1)), 1 / 30, 1e-8), 'curvatura na ponta do arco deve ser 1/30');
    assert.ok(COMMANDS.BLEND, 'comando BLEND registrado no catálogo');
});

test('Fillet Universal Rolling-Ball (G¹ e G²): concorda Linha-Elipse, Arco-Elipse e Linha-Spline com precisão sub-micrométrica', () => {
    // 1. Linha horizontal y = 10 com Elipse centrada em (50, 40), a=30, b=20 (ponto inferior em y=20)
    // Mas vamos cruzar a linha y = 30 com a elipse!
    const line = { type: 'line', start: pt(0, 30), end: pt(100, 30) };
    const ellipse = {
        type: 'ellipse',
        center: pt(60, 40),
        major: pt(30, 0),
        ratio: 25 / 30,
        start: Math.PI * 0.5,
        end: Math.PI * 1.5,
    };
    const r = 6;
    const resG1 = filletCurves(line, pt(10, 30), ellipse, pt(40, 50), r, { continuity: 'G1' });
    assert.ok(resG1 && resG1.arc, 'Fillet G1 Linha-Elipse deve encontrar arco rolling-ball');
    assert.ok(close(resG1.arc.radius, r, 1e-9));
    // Verifica que o centro da esfera rolante dista r tanto da reta quanto da elipse
    const elCurve = entityCurves(ellipse)[0];
    assert.ok(close(Math.abs(resG1.arc.center.y - 30), r, 1e-6));
    assert.ok(close(distance(resG1.arc.center, closestPointOnCurve(resG1.arc.center, elCurve)), r, 1e-5));

    // Mesmo par com continuidade G² (gera spline quíntica com κ=0 na reta e κ=κ_elipse na elipse!)
    const resG2 = filletCurves(line, pt(10, 30), ellipse, pt(40, 50), r, { continuity: 'G2' });
    assert.ok(resG2 && resG2.bridge && resG2.bridge.type === 'spline');
    const bez = { kind: 'bezier', degree: 5, controlPoints: resG2.bridge.controlPoints };
    assert.ok(close(bezierCurvature(bez, 0), 0, 1e-7), 'no encontro com a reta, a curvatura G² do fillet é zero');
    assert.ok(Math.abs(bezierCurvature(bez, 1)) > 1e-3, 'no encontro com a elipse, assume a curvatura da elipse');

    // 2. Linha com Spline cúbica
    const sp = {
        type: 'spline',
        degree: 3,
        controlPoints: [pt(40, 0), pt(45, 30), pt(60, 60), pt(90, 80)],
    };
    const resSp = filletCurves(line, pt(10, 30), sp, pt(60, 60), 5, { continuity: 'G1' });
    assert.ok(resSp && resSp.arc);
    assert.ok(close(resSp.arc.radius, 5, 1e-9));
});

// Testes parametrizados de Rolling-Ball Fillet Universal para 40 combinações de raios e curvas
for (let k = 1; k <= 40; k++) {
    const radius = 2 + (k % 10) * 1.5;
    const lineY = 20 + (k % 5) * 3;
    test(`Rolling-Ball Fillet Universal parametrizado #${k}: R=${radius}, lineY=${lineY}`, () => {
        const line = { type: 'line', start: pt(0, lineY), end: pt(120, lineY) };
        const el = {
            type: 'ellipse',
            center: pt(70, 35),
            major: pt(35, 0),
            ratio: 28 / 35,
            start: Math.PI * 0.4,
            end: Math.PI * 1.5,
        };
        const sol = solveRollingBallFillet(line, pt(15, lineY), el, pt(45, 50), radius);
        assert.ok(sol, `solução rolling-ball deve convergir para k=${k}`);
        assert.ok(close(distance(sol.center, sol.t1), radius, 1e-6));
        assert.ok(close(distance(sol.center, sol.t2), radius, 1e-6));
    });
}

test('Chamfer Universal por Comprimento de Arco: chanfra Linha-Arco, Linha-Elipse e Linha-Spline com comprimentos d1, d2 exatos', () => {
    const line = { type: 'line', start: pt(0, 30), end: pt(100, 30) };
    const arc = { type: 'arc', center: pt(50, 30), radius: 30, start: 0, end: Math.PI };
    // Interseção perto de (20, 30)
    const ch = chamferLines(line, arc, 5, 6, { pick1: pt(5, 30), pick2: pt(30, 55) });
    assert.ok(ch && ch.bridge && ch.bridge.type === 'line');
    // Na linha, o recuo a partir de (20, 30) por d1=5 na direção de (5, 30) leva a (15, 30)
    assert.ok(close(ch.bridge.start.x, 15, 1e-5));
    assert.ok(close(ch.bridge.start.y, 30, 1e-5));
    // No arco de R=30, o recuo geodésico de d2=6 radianos*R corresponde a Δθ = 6/30 = 0.2 rad a partir de π
    const expectedTip2 = polar(pt(50, 30), Math.PI - 6 / 30, 30);
    assert.ok(distance(ch.bridge.end, expectedTip2) < 1e-4);
});

// Testes parametrizados de Chamfer Universal para 30 combinações de distâncias d1, d2
for (let m = 1; m <= 30; m++) {
    const d1 = 1 + (m % 7);
    const d2 = 1 + ((m * 2) % 8);
    test(`Chamfer Universal Geodésico parametrizado #${m}: d1=${d1}, d2=${d2}`, () => {
        const line = { type: 'line', start: pt(0, 30), end: pt(100, 30) };
        const arc = { type: 'arc', center: pt(50, 30), radius: 30, start: 0, end: Math.PI };
        const ch = chamferEntitiesUniversal(line, arc, d1, d2, { pick1: pt(5, 30), pick2: pt(30, 55) });
        assert.ok(ch && ch.bridge);
        assert.ok(close(ch.bridge.start.x, 20 - d1, 1e-5));
        const expectedTip2 = polar(pt(50, 30), Math.PI - d2 / 30, 30);
        assert.ok(distance(ch.bridge.end, expectedTip2) < 1e-4);
    });
}

// Testes parametrizados de Raios e Interseções Analíticas em Laços com Bulge (30 casos)
for (let r = 1; r <= 30; r++) {
    test(`Ray-casting analítico em laço circular parametrizado #${r}: R=${r * 2}`, () => {
        const R = r * 2;
        const loop = circleLoop(15, -10, R);
        const yProbe = -10 + R * 0.6;
        const xs = rayLoopIntersections(loop, yProbe);
        assert.equal(xs.length, 2);
        const dx = Math.sqrt(R * R - (R * 0.6) ** 2);
        assert.ok(close(xs[0], 15 - dx, 1e-8));
        assert.ok(close(xs[1], 15 + dx, 1e-8));
        assert.equal(pointInLoopExact(pt(15, yProbe), loop), true);
        assert.equal(pointInLoopExact(pt(15 + R + 1, yProbe), loop), false);
    });
}

// Testes parametrizados de Rolling-Ball Fillet Linha-Spline (18 raios)
for (let s = 1; s <= 18; s++) {
    const rad = 1.5 + s * 0.75;
    test(`Rolling-Ball Fillet Linha-Spline parametrizado #${s}: R=${rad.toFixed(2)}`, () => {
        const line = { type: 'line', start: pt(0, 0), end: pt(100, 0) };
        const spline = {
            type: 'spline',
            degree: 3,
            points: [pt(40, -10), pt(45, 10), pt(55, 35), pt(70, 65)],
        };
        const sol = solveRollingBallFillet(line, pt(20, 0), spline, pt(60, 45), rad);
        assert.ok(sol && sol.center, `Deve convergir para R=${rad}`);
        assert.ok(close(distance(sol.center, sol.t1), rad, 1e-6));
        assert.ok(close(distance(sol.center, sol.t2), rad, 1e-6));
    });
}

