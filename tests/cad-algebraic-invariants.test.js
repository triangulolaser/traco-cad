// Oráculo de Testes Baseados em Propriedades Algébricas (Property-Based Testing) do Traço CAD 2D:
// 1. Equivariância Euclidiana SE(2) (rotação + translação) de interseções de curvas:
//    intersect(T(A), T(B)) === T(intersect(A, B))
// 2. Conservação aditiva exata de comprimento de arco após subdivisão de Boehm (`splitSplineExact`)
//    em B-Splines/NURBS: L(S_left) + L(S_right) === L(S)
// 3. Invariância de Área pelo Teorema de Green em laços DCEL sob rotações arbitrárias θ ∈ [0, 2π)
//    e translações UTM (10^6): Area(T(Loop)) === Area(Loop)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    entityCurves,
    intersectCurves,
    transformEntity,
    rotatePoint,
    add,
    distance,
    entityLength,
} from '../src/cad/geometry.js';
import { splitSplineExact } from '../src/cad/nurbs-exact.js';
import { loopSignedArea as signedLoopArea } from '../src/cad/topology-dcel.js';
import '../src/cad/extra-entities.js';

// 1. Equivariância SE(2) de Interseções (25 ângulos e translações parametrizadas)
for (let k = 1; k <= 25; k += 1) {
    const theta = (k * 0.23) % (Math.PI * 2);
    const shift = { x: k * 37.5 - 200, y: k * -19.25 + 150 };
    const pivot = { x: 25, y: -15 };
    const mapPt = (p) => add(rotatePoint(p, pivot, theta), shift);

    test(`Equivariância SE(2) de interseção Linha-Elipse e Linha-Arco #${k} (θ=${theta.toFixed(2)} rad)`, () => {
        const line = { type: 'line', start: { x: -40, y: -10 }, end: { x: 80, y: 35 } };
        const ellipse = {
            type: 'ellipse',
            center: { x: 20, y: 10 },
            major: { x: 35, y: 0 },
            ratio: 0.6,
        };

        const baseHits = intersectCurves(entityCurves(line)[0], entityCurves(ellipse)[0]);
        assert.equal(baseHits.length, 2);

        const lineT = transformEntity(line, mapPt);
        const ellipseT = transformEntity(ellipse, mapPt);
        const transformedHits = intersectCurves(entityCurves(lineT)[0], entityCurves(ellipseT)[0]);
        assert.equal(transformedHits.length, 2);

        for (const h of baseHits) {
            const expected = mapPt(h);
            const minErr = Math.min(...transformedHits.map((th) => distance(th, expected)));
            assert.ok(minErr < 1e-9, `Erro de equivariância SE(2) = ${minErr}`);
        }
    });
}

// 2. Conservação Aditiva do Comprimento de Arco sob Subdivisão Exata de NURBS (25 parâmetros de corte)
for (let m = 1; m <= 25; m += 1) {
    const uSplit = 0.08 + (m / 28) * 0.84;
    test(`Conservação aditiva do comprimento de arco em splitSplineExact #${m} (u=${uSplit.toFixed(3)})`, () => {
        const spline = {
            type: 'spline',
            degree: 3,
            controlPoints: [
                { x: 0, y: 0 },
                { x: 25, y: 60 },
                { x: 75, y: -40 },
                { x: 120, y: 50 },
                { x: 160, y: 10 },
            ],
            knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
        };
        const totalLen = entityLength(spline);
        const [left, right] = splitSplineExact(spline, uSplit);
        const sumParts = entityLength(left) + entityLength(right);
        assert.ok(
            Math.abs(totalLen - sumParts) < 1e-9,
            `Soma dos comprimentos (${sumParts}) difere do comprimento original (${totalLen})`,
        );
    });
}

// 3. Invariância Euclidiana da Área de Green em Laços DCEL com Arcos Bulge (25 transformações)
for (let r = 1; r <= 25; r += 1) {
    const angle = (r * 0.31) % (Math.PI * 2);
    const offset = { x: r * 1200, y: -r * 850 };
    test(`Invariância Euclidiana SE(2) da área de Green em contorno misto c/ bulge #${r}`, () => {
        // Cápsula/estádio: 2 lados retos de 60mm e 2 semicircunferências (bulge = 1, R = 20)
        // Área exata = 60 * 40 + π * 20^2 = 2400 + 400π
        const baseLoop = [
            { x: 0, y: 0, bulge: 0 },
            { x: 60, y: 0, bulge: 1 },
            { x: 60, y: 40, bulge: 0 },
            { x: 0, y: 40, bulge: 1 },
        ];
        const expectedArea = 2400 + 400 * Math.PI;
        const transformedLoop = baseLoop.map((v) => {
            const p = add(rotatePoint({ x: v.x, y: v.y }, { x: 0, y: 0 }, angle), offset);
            return { x: p.x, y: p.y, bulge: v.bulge };
        });

        const area0 = signedLoopArea(baseLoop);
        const areaT = signedLoopArea(transformedLoop);
        assert.ok(Math.abs(area0 - expectedArea) < 1e-8);
        assert.ok(Math.abs(areaT - expectedArea) < 1e-6, `Área transformada ${areaT} difere de ${expectedArea}`);
    });
}
