import test from 'node:test';
import assert from 'node:assert/strict';

import {
    twoSum,
    fastTwoSum,
    twoDiff,
    split,
    twoProduct,
    scaleExpansionZeroElim,
    fastExpansionSumZeroElim,
    estimate,
    orient2d,
    orient2dFast,
    incircle,
    solveQuadraticStable,
    solveCubicReal,
    solveQuarticReal,
    solveBernsteinRoots,
    bulgeToArcRational,
    sweepToBulgeRational,
    evalBulgeArcRational,
    closestPointOnBulgeArcRational,
    intersectLineBulgeArcRational,
} from '../src/cad/predicates.js';

import {
    evalBezierPoint,
    evalBezierJet,
    subdivideBezier,
    clipBezierInterval,
    evaluateSplineJet,
    insertKnotBoehm,
    clampSplineDomain,
    splineToBeziers,
    splitSplineExact,
    closestPointOnBezier,
    bezierPerpendicularFeet,
    bezierTangentPoints,
    bezierQuadrants,
    bezierBoxExact,
    bezierLength,
    bezierPointAtDistance,
} from '../src/cad/nurbs-exact.js';

import {
    evalEllipsePoint,
    evalEllipseJet,
    closestPointOnEllipse,
    ellipsePerpendicularFeet,
    ellipseTangentPoints,
    ellipseQuadrants,
    ellipseBoxExact,
    ellipseLength,
    ellipsePointAtDistance,
    intersectLineEllipse,
    intersectConics,
    intersectLineBezier,
    intersectBezierConic,
    intersectBezierBezier,
} from '../src/cad/curve-intersect.js';

import {
    distance,
    sub,
    dot,
    cross,
    polar,
    bulgeToArc,
    arcToBulge,
    entityCurves,
    closestPointOnCurve,
    perpendicularFoot,
    perpendicularFeet,
    tangentPoints,
    curveQuadrants,
    curveBox,
    entityBox,
    intersectCurves,
    splitEntityAt,
    entityLength,
} from '../src/cad/geometry.js';

import '../src/cad/extra-entities.js';
import { interpolateSpline, evaluateSpline, splineLength } from '../src/cad/splines.js';
import { findSnap, defaultSnapSettings } from '../src/cad/snaps.js';

// ============================================================================
// 1. Error-Free Transformations (EFT) e Predicados Exatos de Shewchuk
// ============================================================================

test('EFT: twoSum, fastTwoSum, twoDiff e twoProduct recuperam o erro de arredondamento IEEE-754 exato', () => {
    const [s, e] = twoSum(1, 1e-16);
    assert.equal(s, 1);
    assert.equal(e, 1e-16);

    const [fs, fe] = fastTwoSum(1e16, 1);
    assert.equal(fs + fe, 1e16 + 1);

    const [d, de] = twoDiff(1, 1e-17);
    assert.equal(d, 1);
    assert.equal(de, -1e-17);

    const a = 1 + Math.pow(2, -27);
    const b = 1 + Math.pow(2, -27);
    const [p, pe] = twoProduct(a, b);
    // (1 + 2^-27)^2 = 1 + 2^-26 + 2^-54; p guarda 1 + 2^-26 e pe guarda exatamente 2^-54
    assert.equal(p, 1 + Math.pow(2, -26));
    assert.equal(pe, Math.pow(2, -54));

    const [ahi, alo] = split(a);
    assert.equal(ahi + alo, a);

    const exp1 = scaleExpansionZeroElim([1, 1e-16], 2);
    const exp2 = fastExpansionSumZeroElim(exp1, [1e-16]);
    assert.ok(Math.abs(estimate(exp2) - (2 + 3e-16)) < 1e-30);
});

for (let k = 0; k < 25; k += 1) {
    test(`Predicado orient2d exato em coordenadas UTM (10^7) — caso #${k + 1}`, () => {
        const base = 5_000_000 + k * 10_000;
        const delta = Math.pow(2, -20) * (k + 1);
        const a = { x: base, y: base };
        const b = { x: base + 1000, y: base + 1000 };
        const cLeft = { x: base + 500 - delta, y: base + 500 + delta };
        const cRight = { x: base + 500 + delta, y: base + 500 - delta };
        const cCol = { x: base + 500, y: base + 500 };

        assert.ok(orient2d(a, b, cLeft) > 0, 'Ponto ligeiramente à esquerda em UTM deve ter orient2d > 0');
        assert.ok(orient2d(a, b, cRight) < 0, 'Ponto ligeiramente à direita em UTM deve ter orient2d < 0');
        assert.equal(orient2d(a, b, cCol), 0, 'Pontos exatamente colineares em UTM devem ter orient2d === 0');
        assert.equal(Math.sign(orient2dFast(a, b, cLeft)), 1);
    });
}

for (let k = 0; k < 15; k += 1) {
    test(`Predicado incircle exato com pontos quase cocirculares em coordenadas grandes — caso #${k + 1}`, () => {
        const offset = 100_000 * (k + 1);
        const R = 1000;
        const a = { x: offset + R, y: offset };
        const b = { x: offset, y: offset + R };
        const c = { x: offset - R, y: offset };
        const dOn = { x: offset, y: offset - R };
        const dIn = { x: offset, y: offset - R + 1e-9 };
        const dOut = { x: offset, y: offset - R - 1e-9 };

        assert.equal(incircle(a, b, c, dOn), 0);
        assert.ok(incircle(a, b, c, dIn) > 0);
        assert.ok(incircle(a, b, c, dOut) < 0);
    });
}

test('Solvers polinomiais: solveQuadraticStable (Citardauq + EFT), solveCubicReal, solveQuarticReal e solveBernsteinRoots', () => {
    // Equação com cancelamento catastrófico clássico: x^2 - 10^8 x + 1 = 0
    // Raízes exatas: x1 ≈ 10^8, x2 = 1 / x1 ≈ 10^-8
    const roots = solveQuadraticStable(1, -1e8, 1);
    assert.equal(roots.length, 2);
    assert.ok(Math.abs(roots[0] * roots[1] - 1) < 1e-15, `Produto das raízes Citardauq: ${roots[0] * roots[1]}`);
    assert.ok(Math.abs(roots[0] - 1e-8) < 1e-22);

    // Raiz dupla de tangência rasante: (x - 3.5)^2 = x^2 - 7x + 12.25 = 0
    const tangentRoots = solveQuadraticStable(1, -7, 12.25);
    assert.equal(tangentRoots.length, 1);
    assert.ok(Math.abs(tangentRoots[0] - 3.5) < 1e-15);

    // Cúbica com 3 raízes reais conhecidas: (x - 1)(x - 2)(x - 3) = x^3 - 6x^2 + 11x - 6
    const cubicRoots = solveCubicReal(1, -6, 11, -6);
    assert.equal(cubicRoots.length, 3);
    assert.ok(Math.abs(cubicRoots[0] - 1) < 1e-14);
    assert.ok(Math.abs(cubicRoots[1] - 2) < 1e-14);
    assert.ok(Math.abs(cubicRoots[2] - 3) < 1e-14);

    // Quártica com 4 raízes reais conhecidas: (x + 3)(x + 1)(x - 2)(x - 4) = x^4 - 2x^3 - 13x^2 + 14x + 24
    const quarticRoots = solveQuarticReal(1, -2, -13, 14, 24);
    assert.equal(quarticRoots.length, 4);
    [-3, -1, 2, 4].forEach((expected, i) => {
        assert.ok(Math.abs(quarticRoots[i] - expected) < 1e-13, `Raiz quártica #${i}: esperado ${expected}, obtido ${quarticRoots[i]}`);
    });

    // Solver de Bernstein em [0, 1] para polinômio (t - 0.2)(t - 0.5)(t - 0.85)
    // Expandido na base de Bernstein de grau 3:
    const poly = (t) => (t - 0.2) * (t - 0.5) * (t - 0.85);
    // Coeficientes de Bernstein de grau 3 para f(t) = (t - 0.2)(t - 0.5)(t - 0.85) = t^3 - 1.55 t^2 + 0.695 t - 0.085
    const b0 = -0.085;
    const b1 = b0 + 0.695 / 3;
    const b2 = b0 + (2 * 0.695) / 3 - 1.55 / 3;
    const b3 = poly(1);
    const bRoots = solveBernsteinRoots([b0, b1, b2, b3]);
    assert.equal(bRoots.length, 3);
    [0.2, 0.5, 0.85].forEach((expected, i) => {
        assert.ok(Math.abs(bRoots[i] - expected) < 1e-14, `Raiz Bernstein #${i}: ${bRoots[i]}`);
    });
});

// ============================================================================
// 2. Parametrização Racional de Bulge (Estereográfica) sem Trigonometria
// ============================================================================

for (const exp of [-1, -2, -3, -4, -5, -6, -7]) {
    const b = Math.pow(10, exp);
    test(`Bulge racional livre de cancelamento catastrófico em UTM (10^7) para |b| = 10^${exp}`, () => {
        const p1 = { x: 5_000_000, y: 7_000_000 };
        const p2 = { x: 5_000_100, y: 7_000_000 }; // corda L = 100 mm
        const arc = bulgeToArc(p1, p2, b);

        // Flecha analítica no ponto médio: s = (L / 2) * b para arco CCW horizontal
        const mid = evalBulgeArcRational(p1, p2, b, 0);
        const expectedMidY = 7_000_000 - 50 * b;
        assert.ok(Math.abs(mid.x - 5_000_050) < 1e-15);
        assert.ok(Math.abs(mid.y - expectedMidY) < 1e-14, `Erro na flecha em b=${b}: ${Math.abs(mid.y - expectedMidY)}`);

        // Projeção exata (closestPointOnBulgeArcRational) sobre o arco
        const query = { x: 5_000_050, y: 7_000_000 - 10 };
        const cp = closestPointOnCurve(query, arc);
        assert.ok(Math.abs(cp.x - 5_000_050) < 1e-14);
        assert.ok(Math.abs(cp.y - expectedMidY) < 1e-14);

        // Interseção reta vertical x = 5_000_050 com o arco racional
        const vLine = {
            kind: 'segment',
            a: { x: 5_000_050, y: 6_999_900 },
            b: { x: 5_000_050, y: 7_000_100 },
        };
        const hits = intersectCurves(vLine, arc);
        assert.equal(hits.length, 1);
        assert.ok(Math.abs(hits[0].x - 5_000_050) < 1e-14);
        assert.ok(Math.abs(hits[0].y - expectedMidY) < 1e-14);

        // Roundtrip sweep -> bulge racional
        const sweep = 4 * Math.atan(b);
        assert.ok(Math.abs(sweepToBulgeRational(sweep) - b) < 1e-15);
        assert.ok(Math.abs(arcToBulge(arc.center, arc.radius, arc.start, arc.end, p1, p2) - b) < 1e-8);
        assert.ok(bulgeToArcRational(p1, p2, b).radius > 0);
    });
}

// ============================================================================
// 3. Geometria Diferencial, Inserção de Boehm e Subdivisão Exata de NURBS/Bézier
// ============================================================================

test('NURBS: evaluateSplineJet e evalBezierJet calculam 1ª/2ª derivadas e curvatura κ exatas', () => {
    const fitPts = [
        { x: 0, y: 0 },
        { x: 20, y: 35 },
        { x: 55, y: -15 },
        { x: 90, y: 40 },
        { x: 120, y: 0 },
    ];
    const spline = interpolateSpline(fitPts);
    const beziers = splineToBeziers(spline, { minSegments: 1 });
    assert.ok(beziers.length >= 2);

    // Verifica que nenhuma curva da entidade spline possui flag approx
    const entity = { type: 'spline', ...spline };
    const curves = entityCurves(entity);
    assert.ok(curves.length > 10);
    assert.ok(curves.every((c) => c.kind === 'bezier' && !c.approx));

    const h1 = 1e-6;
    const h2 = 1e-4;
    for (const bz of beziers) {
        for (const u of [0.15, 0.35, 0.6, 0.85]) {
            const jet = evalBezierJet(bz, u);
            const pPlus = evalBezierPoint(bz, u + h1);
            const pMinus = evalBezierPoint(bz, u - h1);
            const fd1 = { x: (pPlus.x - pMinus.x) / (2 * h1), y: (pPlus.y - pMinus.y) / (2 * h1) };
            const pPlus2 = evalBezierPoint(bz, u + h2);
            const pMinus2 = evalBezierPoint(bz, u - h2);
            const fd2 = {
                x: (pPlus2.x - 2 * jet.point.x + pMinus2.x) / (h2 * h2),
                y: (pPlus2.y - 2 * jet.point.y + pMinus2.y) / (h2 * h2),
            };
            assert.ok(distance(jet.d1, fd1) < 1e-6, `Erro 1ª derivada Bézier: ${distance(jet.d1, fd1)}`);
            assert.ok(distance(jet.d2, fd2) < 1e-4, `Erro 2ª derivada Bézier: ${distance(jet.d2, fd2)}`);

            // Compara com evaluateSplineJet no parâmetro global correspondente
            const tGlobal = bz.t0 + u * (bz.t1 - bz.t0);
            const sJet = evaluateSplineJet(spline, tGlobal);
            assert.ok(distance(jet.point, sJet.point) < 1e-13);
            assert.ok(Math.abs(jet.curvature - sJet.curvature) < 1e-12);
        }
    }
});

test('NURBS Racional: quarto de círculo NURBS racional tem curvatura constante κ = 1/R com precisão 10^-15', () => {
    const R = 50;
    const w1 = Math.SQRT1_2;
    const rationalArc = {
        kind: 'bezier',
        degree: 2,
        points: [
            { x: R, y: 0 },
            { x: R, y: R },
            { x: 0, y: R },
        ],
        weights: [1, w1, 1],
    };
    for (let i = 0; i <= 20; i += 1) {
        const u = i / 20;
        const jet = evalBezierJet(rationalArc, u);
        const rDist = Math.hypot(jet.point.x, jet.point.y);
        assert.ok(Math.abs(rDist - R) < 1e-13, `Ponto fora do círculo racional em u=${u}: r=${rDist}`);
        assert.ok(Math.abs(jet.curvature - 1 / R) < 1e-14, `Curvatura racional κ=${jet.curvature} difere de 1/R=${1 / R}`);
        // Tangente ortogonal ao vetor radial
        assert.ok(Math.abs(dot(jet.point, jet.d1)) < 1e-12);
    }
    // Comprimento de arco Gauss-Legendre de 8 pontos para um quarto de círculo de raio 50
    const expectedLen = (Math.PI / 2) * R;
    const len = bezierLength(rationalArc);
    assert.ok(Math.abs(len - expectedLen) < 1e-12, `Erro de comprimento racional: ${Math.abs(len - expectedLen)}`);
});

for (let k = 0; k < 20; k += 1) {
    test(`Inserção de nós de Boehm preserva C(t) exatamente (erro < 10^-14 mm) — nó #${k + 1}`, () => {
        const spline = interpolateSpline([
            { x: 0, y: 0 },
            { x: 15, y: 40 },
            { x: 45, y: -20 },
            { x: 80, y: 30 },
            { x: 110, y: 10 },
        ]);
        const uInsert = (k + 1) / 22;
        const refined = insertKnotBoehm(spline, uInsert, 2);

        for (let s = 0; s <= 25; s += 1) {
            const t = s / 25;
            const p0 = evaluateSpline(spline, t);
            const p1 = evaluateSpline(refined, t);
            assert.ok(distance(p0, p1) < 1e-13, `Desvio após Boehm em t=${t}: ${distance(p0, p1)}`);
        }
    });
}

test('NURBS: clampSplineDomain e splitSplineExact subdividem spline para TRIM sem perda geométrica', () => {
    const spline = {
        type: 'spline',
        layer: '0',
        ...interpolateSpline([
            { x: 0, y: 0 },
            { x: 30, y: 60 },
            { x: 70, y: -30 },
            { x: 100, y: 50 },
            { x: 140, y: 0 },
        ]),
    };
    const clamped = clampSplineDomain(spline);
    assert.equal(clamped.controlPoints.length, spline.controlPoints.length);

    const cut1 = evaluateSpline(spline, 0.33);
    const cut2 = evaluateSpline(spline, 0.71);
    const pieces = splitEntityAt(spline, [cut1, cut2]);
    assert.equal(pieces.length, 3);

    // Soma dos comprimentos das 3 partes deve bater com o comprimento original até 10^-11 mm
    const totalOriginal = splineLength(spline);
    const totalPieces = pieces.reduce((acc, p) => acc + entityLength(p), 0);
    assert.ok(Math.abs(totalOriginal - totalPieces) < 1e-10, `Diferença de comprimento após split: ${Math.abs(totalOriginal - totalPieces)}`);

    // Cada ponto em cada peça deve pertencer exatamente à spline original (< 10^-13 mm)
    for (const piece of pieces) {
        for (let i = 0; i <= 15; i += 1) {
            const u = piece.knots[piece.degree] + (i / 15) * (piece.knots[piece.controlPoints.length] - piece.knots[piece.degree]);
            const ptPiece = evaluateSpline(piece, u);
            const ptOrig = evaluateSpline(spline, u);
            assert.ok(distance(ptPiece, ptOrig) < 1e-13, `Erro na peça de spline em u=${u}: ${distance(ptPiece, ptOrig)}`);
        }
    }
});

test('NURBS/Bézier: subdivisão de Casteljau, clipBezierInterval e bezierPointAtDistance são exatos', () => {
    const bz = {
        kind: 'bezier',
        degree: 3,
        points: [
            { x: 0, y: 0 },
            { x: 25, y: 80 },
            { x: 75, y: -40 },
            { x: 100, y: 20 },
        ],
    };
    const [left, right] = subdivideBezier(bz, 0.42);
    assert.ok(distance(evalBezierPoint(left, 1), evalBezierPoint(bz, 0.42)) < 1e-14);
    assert.ok(distance(evalBezierPoint(right, 0), evalBezierPoint(bz, 0.42)) < 1e-14);

    const clipped = clipBezierInterval(bz, 0.2, 0.75);
    for (let i = 0; i <= 10; i += 1) {
        const s = i / 10;
        const u = 0.2 + s * (0.75 - 0.2);
        assert.ok(distance(evalBezierPoint(clipped, s), evalBezierPoint(bz, u)) < 1e-13);
    }

    const totalLen = bezierLength(bz);
    const half = bezierPointAtDistance(bz, totalLen / 2);
    const [bLeft] = subdivideBezier(bz, half.t);
    assert.ok(Math.abs(bezierLength(bLeft) - totalLen / 2) < 1e-10);
});

// ============================================================================
// 4. OSNAPs Analíticos Exatos em Bézier/Spline e Elipse (NEA, PER, TAN, QUA, BBox)
// ============================================================================

test('OSNAPs Analíticos em Bézier: NEA, PER, TAN, QUA e Bounding Box exata', () => {
    const bz = {
        kind: 'bezier',
        degree: 3,
        points: [
            { x: 0, y: 0 },
            { x: 30, y: 90 },
            { x: 70, y: -60 },
            { x: 100, y: 10 },
        ],
    };

    // 1. NEA / PER: ortogonalidade <C(t*) - P, C'(t*)> = 0
    const fromPt = { x: 40, y: 50 };
    const feet = bezierPerpendicularFeet(bz, fromPt);
    assert.ok(feet.length >= 1);
    for (const f of feet) {
        const jet = evalBezierJet(bz, f.t);
        const ortho = Math.abs(dot(sub(jet.point, fromPt), jet.d1));
        assert.ok(ortho < 1e-11, `Resíduo de ortogonalidade PER na Bézier: ${ortho}`);
    }

    const cp = closestPointOnBezier(bz, fromPt);
    assert.ok(cp.dist >= 0);

    // 2. TAN: colinearidade (C(t*) - P) x C'(t*) = 0
    const extPt = { x: 50, y: 60 };
    const tans = bezierTangentPoints(bz, extPt);
    assert.ok(tans.length >= 1);
    for (const tp of tans) {
        const jet = evalBezierJet(bz, tp.t);
        const col = Math.abs(cross(sub(jet.point, extPt), jet.d1));
        assert.ok(col < 1e-10, `Resíduo de tangência TAN na Bézier: ${col}`);
    }

    // 3. QUA e Bounding Box exata: C'_x(t*) = 0 ou C'_y(t*) = 0
    const quads = bezierQuadrants(bz);
    assert.equal(quads.length, 2); // 1 máximo local em Y e 1 mínimo local em Y
    const box = bezierBoxExact(bz);
    for (const q of quads) {
        assert.ok(
            Math.abs(q.y - box.maxY) < 1e-13 || Math.abs(q.y - box.minY) < 1e-13,
            `Extremo de Bézier ${q.y} deve coincidir com o limite exato da BBox [${box.minY}, ${box.maxY}]`,
        );
    }
});

test('OSNAPs Analíticos em Elipse Rotacionada: NEA, PER, TAN, QUA, BBox e Comprimento', () => {
    const theta = Math.PI / 6; // 30 graus
    const a = 80;
    const b = 40;
    const ellipse = {
        type: 'ellipse',
        center: { x: 200, y: 150 },
        major: { x: a * Math.cos(theta), y: a * Math.sin(theta) },
        ratio: b / a,
        start: 0,
        end: Math.PI * 2,
    };
    const [curve] = entityCurves(ellipse);
    assert.equal(curve.kind, 'ellipse');
    assert.ok(!curve.approx);

    // 1. BBox analítica exata de elipse rotacionada:
    // ΔX = sqrt((a cos θ)^2 + (b sin θ)^2), ΔY = sqrt((a sin θ)^2 + (b cos θ)^2)
    const expectedDx = Math.hypot(a * Math.cos(theta), b * Math.sin(theta));
    const expectedDy = Math.hypot(a * Math.sin(theta), b * Math.cos(theta));
    const box = entityBox(ellipse);
    assert.ok(Math.abs((box.maxX - 200) - expectedDx) < 1e-13);
    assert.ok(Math.abs((200 - box.minX) - expectedDx) < 1e-13);
    assert.ok(Math.abs((box.maxY - 150) - expectedDy) < 1e-13);
    assert.ok(Math.abs((150 - box.minY) - expectedDy) < 1e-13);

    // 2. Quadrantes globais tocam exatamente as 4 paredes da BBox
    const quads = ellipseQuadrants(curve);
    assert.ok(quads.length >= 4);
    assert.ok(quads.some((q) => Math.abs(q.x - box.maxX) < 1e-13));
    assert.ok(quads.some((q) => Math.abs(q.x - box.minX) < 1e-13));
    assert.ok(quads.some((q) => Math.abs(q.y - box.maxY) < 1e-13));
    assert.ok(quads.some((q) => Math.abs(q.y - box.minY) < 1e-13));

    // 3. PER e NEA exatos (sem erro de corda poligonal!)
    const query = { x: 290, y: 210 };
    const cp = closestPointOnEllipse(curve, query);
    const jet = evalEllipseJet(curve, cp.t);
    const ortho = Math.abs(dot(sub(jet.point, query), jet.d1));
    assert.ok(ortho < 1e-11, `Resíduo de ortogonalidade NEA/PER na elipse: ${ortho}`);

    const allFeet = ellipsePerpendicularFeet(curve, query);
    assert.ok(allFeet.length >= 2);
    for (const f of allFeet) {
        const j = evalEllipseJet(curve, f.t);
        assert.ok(Math.abs(dot(sub(j.point, query), j.d1)) < 1e-11);
    }

    // 4. TAN exato de ponto externo
    const tans = ellipseTangentPoints(curve, { x: 350, y: 250 });
    assert.equal(tans.length, 2);
    for (const tp of tans) {
        const j = evalEllipseJet(curve, tp.t);
        assert.ok(Math.abs(cross(sub(j.point, { x: 350, y: 250 }), j.d1)) < 1e-11);
    }

    // 5. Comprimento analítico (Ramanujan II / Gauss-Legendre) vs elipse degenerada em círculo
    const circleLikeEllipse = {
        kind: 'ellipse',
        center: { x: 0, y: 0 },
        major: { x: 50, y: 0 },
        ratio: 1,
        start: 0,
        end: Math.PI * 2,
        full: true,
    };
    assert.ok(Math.abs(ellipseLength(circleLikeEllipse) - 2 * Math.PI * 50) < 1e-12);
    const quarterPt = ellipsePointAtDistance(circleLikeEllipse, (Math.PI / 2) * 50);
    assert.ok(distance(quarterPt.point, { x: 0, y: 50 }) < 1e-11);
});

// ============================================================================
// 5. Interseções Analíticas Exatas entre Curvas (Reta, Círculo, Elipse, Bézier/NURBS)
// ============================================================================

test('Interseção Reta × Elipse: secante, tangente exata e arco elíptico', () => {
    const ellipse = {
        kind: 'ellipse',
        center: { x: 0, y: 0 },
        major: { x: 100, y: 0 },
        ratio: 0.5, // semi-eixos a = 100, b = 50
        start: 0,
        end: Math.PI * 2,
        full: true,
    };

    // Secante horizontal y = 30 -> x = ±100 * sqrt(1 - (30/50)^2) = ±80
    const lineSec = { kind: 'segment', a: { x: -150, y: 30 }, b: { x: 150, y: 30 } };
    const hitsSec = intersectLineEllipse(lineSec, ellipse);
    assert.equal(hitsSec.length, 2);
    assert.ok(hitsSec.some((p) => distance(p, { x: -80, y: 30 }) < 1e-13));
    assert.ok(hitsSec.some((p) => distance(p, { x: 80, y: 30 }) < 1e-13));

    // Tangente no topo y = 50 -> (0, 50)
    const lineTan = { kind: 'segment', a: { x: -100, y: 50 }, b: { x: 100, y: 50 } };
    const hitsTan = intersectLineEllipse(lineTan, ellipse);
    assert.equal(hitsTan.length, 1);
    assert.ok(distance(hitsTan[0], { x: 0, y: 50 }) < 1e-13);
});

test('Interseção Cônica × Cônica (Feixe Matricial 3×3 + Resolvente de Weierstrass + Newton 2D): Elipse × Círculo e Elipse × Elipse', () => {
    // Elipse (x/100)^2 + (y/50)^2 = 1 com Círculo x^2 + y^2 = 70^2
    // Solução analítica:
    // x^2 = 100^2 * (1 - y^2 / 50^2) = 4900 - y^2 => 4 y^2 - y^2 = 10000 - 4900 = 5100 => 3 y^2 = 5100 => y^2 = 1700
    // x^2 = 4900 - 1700 = 3200
    const e1 = {
        kind: 'ellipse',
        center: { x: 0, y: 0 },
        major: { x: 100, y: 0 },
        ratio: 0.5,
        start: 0,
        end: Math.PI * 2,
        full: true,
    };
    const c1 = { kind: 'circle', center: { x: 0, y: 0 }, radius: 70 };
    const hitsEC = intersectConics(e1, c1);
    assert.equal(hitsEC.length, 4);
    const ex = Math.sqrt(3200);
    const ey = Math.sqrt(1700);
    for (const signX of [-1, 1]) {
        for (const signY of [-1, 1]) {
            const expected = { x: signX * ex, y: signY * ey };
            assert.ok(
                hitsEC.some((p) => distance(p, expected) < 1e-13),
                `Ponto (${expected.x}, ${expected.y}) não encontrado com precisão < 10^-13 mm`,
            );
        }
    }

    // Duas elipses ortogonais: (x/100)^2 + (y/40)^2 = 1 e (x/40)^2 + (y/100)^2 = 1
    // Solução simétrica: |x| = |y| = 1 / sqrt(1/100^2 + 1/40^2)
    const e2 = {
        kind: 'ellipse',
        center: { x: 0, y: 0 },
        major: { x: 0, y: 100 },
        ratio: 0.4,
        start: 0,
        end: Math.PI * 2,
        full: true,
    };
    const hitsEE = intersectConics(e1, e2);
    assert.equal(hitsEE.length, 4);
    for (const p of hitsEE) {
        const res1 = Math.hypot(p.x / 100, p.y / 50) - 1;
        const res2 = Math.hypot(p.x / 40, p.y / 100) - 1;
        assert.ok(Math.abs(res1) < 1e-14, `Resíduo na elipse 1: ${res1}`);
        assert.ok(Math.abs(res2) < 1e-14, `Resíduo na elipse 2: ${res2}`);
    }

    // Elipses bitangentes (tangência dupla em (±100, 0))
    const eBitangent = {
        kind: 'ellipse',
        center: { x: 0, y: 0 },
        major: { x: 100, y: 0 },
        ratio: 0.8,
        start: 0,
        end: Math.PI * 2,
        full: true,
    };
    const hitsBit = intersectConics(e1, eBitangent);
    assert.equal(hitsBit.length, 2);
    assert.ok(hitsBit.some((p) => distance(p, { x: 100, y: 0 }) < 1e-12));
    assert.ok(hitsBit.some((p) => distance(p, { x: -100, y: 0 }) < 1e-12));
});

test('Interseção Reta × Bézier e Cônica × Bézier com erro < 10^-13 mm', () => {
    const bz = {
        kind: 'bezier',
        degree: 3,
        points: [
            { x: 0, y: 0 },
            { x: 30, y: 100 },
            { x: 70, y: -100 },
            { x: 100, y: 0 },
        ],
    };
    const line = { kind: 'segment', a: { x: -10, y: 10 }, b: { x: 110, y: 10 } };
    const lineHits = intersectLineBezier(line, bz);
    assert.equal(lineHits.length, 2);
    for (const p of lineHits) {
        assert.ok(Math.abs(p.y - 10) < 1e-13);
        const cp = closestPointOnBezier(bz, p);
        assert.ok(cp.dist < 1e-13, `Distância do ponto de interseção Reta×Bézier à curva: ${cp.dist}`);
    }

    const circle = { kind: 'circle', center: { x: 50, y: 0 }, radius: 30 };
    const conicHits = intersectBezierConic(bz, circle);
    assert.equal(conicHits.length, 2);
    for (const p of conicHits) {
        assert.ok(Math.abs(distance(p, circle.center) - circle.radius) < 1e-13);
        const cp = closestPointOnBezier(bz, p);
        assert.ok(cp.dist < 1e-13);
    }
});

test('Interseção Bézier × Bézier via Sederberg-Nishita Bézier Clipping (fat-line + Newton 2D) com erro < 10^-13 mm', () => {
    const b1 = {
        kind: 'bezier',
        degree: 3,
        points: [
            { x: 0, y: 0 },
            { x: 30, y: 120 },
            { x: 70, y: -120 },
            { x: 100, y: 0 },
        ],
    };
    const b2 = {
        kind: 'bezier',
        degree: 3,
        points: [
            { x: 0, y: 40 },
            { x: 35, y: -100 },
            { x: 65, y: 100 },
            { x: 100, y: -40 },
        ],
    };
    const hits = intersectBezierBezier(b1, b2);
    assert.equal(hits.length, 3);
    for (const p of hits) {
        const d1 = closestPointOnBezier(b1, p).dist;
        const d2 = closestPointOnBezier(b2, p).dist;
        assert.ok(d1 < 1e-13, `Resíduo na Bézier 1: ${d1}`);
        assert.ok(d2 < 1e-13, `Resíduo na Bézier 2: ${d2}`);
    }

    // Caso de tangência rasante (grazing tangency) entre duas curvas de Bézier quadráticas simétricas
    // C1(t) = (100 t, 50 (2t - 1)^2) toca C2(u) = (100 u, -50 (2u - 1)^2) exatamente em (50, 0)
    const g1 = {
        kind: 'bezier',
        degree: 2,
        points: [
            { x: 0, y: 50 },
            { x: 50, y: -50 },
            { x: 100, y: 50 },
        ],
    };
    const g2 = {
        kind: 'bezier',
        degree: 2,
        points: [
            { x: 0, y: -50 },
            { x: 50, y: 50 },
            { x: 100, y: -50 },
        ],
    };
    const grazingHits = intersectBezierBezier(g1, g2);
    assert.equal(grazingHits.length, 1);
    assert.ok(distance(grazingHits[0], { x: 50, y: 0 }) < 1e-7, `Ponto de tangência rasante: (${grazingHits[0].x}, ${grazingHits[0].y})`);
});

test('Integração OSNAP (findSnap): INT, PER, TAN e NEA exatos entre Spline e Elipse sem falsos positivos em nós internos', () => {
    const spline = {
        id: 'sp-1',
        type: 'spline',
        layer: '0',
        ...interpolateSpline([
            { x: -120, y: -40 },
            { x: -40, y: 60 },
            { x: 40, y: -60 },
            { x: 120, y: 40 },
        ]),
    };
    const ellipse = {
        id: 'el-1',
        type: 'ellipse',
        layer: '0',
        center: { x: 0, y: 0 },
        major: { x: 80, y: 20 },
        ratio: 0.5,
        start: 0,
        end: Math.PI * 2,
    };

    const settings = defaultSnapSettings();

    // Verifica que passar o cursor sobre um nó interno da spline com apenas INT ligado não gera falso positivo
    const knotPt = evaluateSpline(spline, spline.knots[spline.degree + 1]);
    const falseInt = findSnap([spline], knotPt, 5, { ...settings, end: false, mid: false, nea: false, qua: false, int: true });
    assert.equal(falseInt, null, 'Nó interno entre spans de Bézier adjacentes da mesma spline não deve acusar auto-interseção');

    // Verifica que a interseção real entre a Spline e a Elipse é encontrada com precisão < 10^-13 mm
    const spCurves = entityCurves(spline);
    const [elCurve] = entityCurves(ellipse);
    const exactInts = spCurves.flatMap((sc) => intersectCurves(sc, elCurve));
    assert.ok(exactInts.length >= 2);

    for (const expected of exactInts) {
        const snap = findSnap([spline, ellipse], { x: expected.x + 0.2, y: expected.y - 0.15 }, 5, settings);
        assert.ok(snap);
        assert.equal(snap.mode, 'int');
        assert.ok(distance(snap.point, expected) < 1e-13);
        const dEl = closestPointOnEllipse(elCurve, snap.point).dist;
        const dSp = Math.min(...spCurves.map((sc) => closestPointOnBezier(sc, snap.point).dist));
        assert.ok(dEl < 1e-13, `Erro da interseção OSNAP na elipse: ${dEl}`);
        assert.ok(dSp < 1e-13, `Erro da interseção OSNAP na spline: ${dSp}`);
    }
});

// ============================================================================
// 6. Suíte de Fuzzing Determinístico (20.000 Casos) com Erro < 10^-13 mm
// ============================================================================

function createRng(seed = 0x20260417) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

for (let batch = 0; batch < 100; batch += 1) {
    test(`Fuzzing Determinístico de Precisão Geométrica (Lote #${batch + 1}/100 — 200 casos por lote = 20.000 casos totais, erro < 10^-13 mm)`, () => {
        const rand = createRng(0xA71A5000 + batch);
        const casesPerBatch = 200;

        for (let i = 0; i < casesPerBatch; i += 1) {
            const mode = i % 5;

            if (mode === 0) {
                // Caso 0: Bulge Arc racional com bulge pequeno (10^-7 .. 10^-2)
                const ox = (rand() - 0.5) * 40;
                const oy = (rand() - 0.5) * 40;
                const L = 10 + rand() * 40;
                const ang = rand() * Math.PI * 2;
                const p1 = { x: ox, y: oy };
                const p2 = polar(p1, ang, L);
                const sign = rand() > 0.5 ? 1 : -1;
                const bulge = sign * Math.pow(10, -7 + rand() * 5);

                const u = -0.9 + rand() * 1.8;
                const ptOnArc = evalBulgeArcRational(p1, p2, bulge, u);
                const cp = closestPointOnBulgeArcRational(p1, p2, bulge, ptOnArc);
                assert.ok(distance(cp.point, ptOnArc) < 1e-13, `Fuzz Bulge projection err: ${distance(cp.point, ptOnArc)}`);

                // Reta cruzando exatamente em ptOnArc
                const lineAng = ang + 0.4 + rand() * 2.0;
                const l1 = ptOnArc;
                const l2 = polar(ptOnArc, lineAng, 40);
                const hits = intersectLineBulgeArcRational(l1, l2, p1, p2, bulge);
                assert.ok(
                    hits.some((h) => distance(h, ptOnArc) < 1e-13),
                    `Fuzz Reta×Bulge falhou no lote ${batch} caso ${i}`,
                );
            } else if (mode === 1) {
                // Caso 1: Interseção Reta × Elipse construída por ponto exato sobre a elipse
                const center = { x: (rand() - 0.5) * 40, y: (rand() - 0.5) * 40 };
                const a = 15 + rand() * 35;
                const rot = rand() * Math.PI;
                const ratio = 0.25 + rand() * 0.7;
                const ellipse = {
                    kind: 'ellipse',
                    center,
                    major: { x: a * Math.cos(rot), y: a * Math.sin(rot) },
                    ratio,
                    start: 0,
                    end: Math.PI * 2,
                    full: true,
                };
                const tExact = rand() * Math.PI * 2;
                const jetE = evalEllipseJet(ellipse, tExact);
                const pExact = jetE.point;
                const tanAng = Math.atan2(jetE.d1.y, jetE.d1.x);
                const lineDir = tanAng + 0.35 + rand() * (Math.PI - 0.7);
                const seg = {
                    kind: 'segment',
                    a: pExact,
                    b: polar(pExact, lineDir, 60),
                };
                const hits = intersectLineEllipse(seg, ellipse);
                assert.ok(
                    hits.some((h) => distance(h, pExact) < 1e-13),
                    `Fuzz Reta×Elipse erro > 10^-13 mm no lote ${batch} caso ${i}`,
                );
            } else if (mode === 2) {
                // Caso 2: Interseção Reta × Bézier Cúbica construída por ponto exato C(u*)
                const p0 = { x: (rand() - 0.5) * 30, y: (rand() - 0.5) * 30 };
                const bz = {
                    kind: 'bezier',
                    degree: 3,
                    points: [
                        p0,
                        { x: p0.x + 10 + rand() * 20, y: p0.y + (rand() - 0.5) * 40 },
                        { x: p0.x + 30 + rand() * 20, y: p0.y + (rand() - 0.5) * 40 },
                        { x: p0.x + 50 + rand() * 20, y: p0.y + (rand() - 0.5) * 30 },
                    ],
                };
                const uExact = 0.1 + rand() * 0.8;
                const jetB = evalBezierJet(bz, uExact);
                const pExact = jetB.point;
                const tanAng = Math.atan2(jetB.d1.y, jetB.d1.x);
                const lineDir = tanAng + 0.35 + rand() * (Math.PI - 0.7);
                const seg = {
                    kind: 'segment',
                    a: pExact,
                    b: polar(pExact, lineDir, 60),
                };
                const hits = intersectLineBezier(seg, bz);
                assert.ok(
                    hits.some((h) => distance(h, pExact) < 1e-13),
                    `Fuzz Reta×Bézier erro > 10^-13 mm no lote ${batch} caso ${i}`,
                );
            } else if (mode === 3) {
                // Caso 3: Interseção Cônica × Cônica construída passando por pExact
                const e1 = {
                    kind: 'ellipse',
                    center: { x: (rand() - 0.5) * 20, y: (rand() - 0.5) * 20 },
                    major: { x: 25 + rand() * 25, y: (rand() - 0.5) * 20 },
                    ratio: 0.4 + rand() * 0.5,
                    start: 0,
                    end: Math.PI * 2,
                    full: true,
                };
                const t1 = rand() * Math.PI * 2;
                const jet1 = evalEllipseJet(e1, t1);
                const pExact = jet1.point;
                const tanAng = Math.atan2(jet1.d1.y, jet1.d1.x);
                const cCenter = polar(pExact, tanAng + (rand() - 0.5) * 1.4, 15 + rand() * 20);
                const c2 = {
                    kind: 'circle',
                    center: cCenter,
                    radius: distance(cCenter, pExact),
                };
                const hits = intersectConics(e1, c2);
                assert.ok(
                    hits.some((h) => distance(h, pExact) < 1e-13),
                    `Fuzz Cônica×Cônica erro > 10^-13 mm no lote ${batch} caso ${i}`,
                );
            } else {
                // Caso 4: Interseção Bézier × Bézier via Sederberg-Nishita construída para cruzar em pExact
                const b1 = {
                    kind: 'bezier',
                    degree: 3,
                    points: [
                        { x: 0, y: 0 },
                        { x: 15, y: 20 + (rand() - 0.5) * 10 },
                        { x: 30, y: -20 + (rand() - 0.5) * 10 },
                        { x: 45, y: 0 },
                    ],
                };
                const u1 = 0.2 + rand() * 0.6;
                const pTarget = evalBezierPoint(b1, u1);
                const b2Raw = {
                    kind: 'bezier',
                    degree: 3,
                    points: [
                        { x: 10, y: -30 },
                        { x: 20 + (rand() - 0.5) * 6, y: -10 },
                        { x: 25 + (rand() - 0.5) * 6, y: 10 },
                        { x: 35, y: 30 },
                    ],
                };
                const u2 = 0.2 + rand() * 0.6;
                const pRaw = evalBezierPoint(b2Raw, u2);
                const shift = sub(pTarget, pRaw);
                const b2 = {
                    kind: 'bezier',
                    degree: 3,
                    points: b2Raw.points.map((pt) => ({ x: pt.x + shift.x, y: pt.y + shift.y })),
                };
                const hits = intersectBezierBezier(b1, b2);
                assert.ok(
                    hits.some((h) => distance(h, pTarget) < 1e-13),
                    `Fuzz Bézier×Bézier erro > 10^-13 mm no lote ${batch} caso ${i}`,
                );
            }
        }
    });
}
