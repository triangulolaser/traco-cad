import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeSvg, svgToEntities } from '../src/cad/svg.js';

test('looksLikeSvg identifica SVG válido e descarta outros formatos', () => {
    assert.equal(looksLikeSvg('<svg width="100" height="100"></svg>'), true);
    assert.equal(looksLikeSvg('<?xml version="1.0"?><svg viewBox="0 0 100 100"><g/></svg>'), true);
    assert.equal(looksLikeSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg></svg>'), true);
    assert.equal(looksLikeSvg(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), true);

    assert.equal(looksLikeSvg('SECTION\n2\nHEADER\n0\nENDSEC'), false);
    assert.equal(looksLikeSvg('G21\nG90\nG00 X0 Y0'), false);
    assert.equal(looksLikeSvg('PK\x03\x04'), false);
    assert.equal(looksLikeSvg(''), false);
    assert.equal(looksLikeSvg(null), false);
});

test('svgToEntities importa primitivas básicas (line, circle, ellipse, rect, text)', () => {
    const svg = `
    <svg width="400" height="300" viewBox="0 0 400 300">
        <line x1="10" y1="20" x2="110" y2="120" stroke="#ff0000" />
        <circle cx="200" cy="150" r="40" />
        <ellipse cx="300" cy="100" rx="50" ry="30" />
        <rect x="20" y="200" width="80" height="60" />
        <text x="200" y="50" font-size="16">Corte Laser 2026</text>
    </svg>`;

    const res = svgToEntities(svg);
    assert.ok(res.entities.length >= 5, `Esperava pelo menos 5 entidades, obteve ${res.entities.length}`);

    const line = res.entities.find((e) => e.type === 'line');
    assert.ok(line, 'Linha deve existir');
    assert.equal(line.start.x, 10);
    // Y invertido no CAD: (viewBox.height - y) -> 300 - 20 = 280
    assert.equal(line.start.y, 280);
    assert.equal(line.end.x, 110);
    assert.equal(line.end.y, 180);

    const circle = res.entities.find((e) => e.type === 'circle');
    assert.ok(circle, 'Círculo deve existir');
    assert.equal(circle.center.x, 200);
    assert.equal(circle.center.y, 150); // 300 - 150 = 150
    assert.equal(circle.radius, 40);

    const ellipse = res.entities.find((e) => e.type === 'ellipse');
    assert.ok(ellipse, 'Elipse deve existir');
    assert.equal(ellipse.center.x, 300);
    assert.equal(ellipse.major.x, 50);
    assert.equal(ellipse.ratio, 30 / 50);

    const rect = res.entities.find((e) => e.type === 'polyline' && e.closed && e.vertices.length === 4);
    assert.ok(rect, 'Retângulo deve ser convertido em polilinha fechada de 4 vértices');

    const text = res.entities.find((e) => e.type === 'text');
    assert.ok(text, 'Texto deve existir');
    assert.equal(text.text, 'Corte Laser 2026');
});

test('svgToEntities converte rect com cantos arredondados (rx, ry) em polilinha com bulge', () => {
    const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200">
        <rect x="10" y="10" width="100" height="80" rx="10" ry="10" />
    </svg>`;

    const res = svgToEntities(svg);
    const roundedRect = res.entities.find((e) => e.type === 'polyline' && e.closed);
    assert.ok(roundedRect, 'Retângulo com cantos arredondados deve virar polilinha');
    assert.equal(roundedRect.vertices.length, 8, 'Deve conter 8 vértices (4 arestas lineares + 4 arcos de concordância)');
    const hasBulge = roundedRect.vertices.some((v) => v.bulge && Math.abs(v.bulge) > 0);
    assert.ok(hasBulge, 'Os vértices dos cantos devem possuir bulge para arcos exatos');
});

test('svgToEntities processa caminhos <path> com comandos M, L, H, V, Z', () => {
    const svg = `
    <svg width="200" height="200">
        <path d="M 10 10 L 50 10 V 80 H 10 Z" />
    </svg>`;

    const res = svgToEntities(svg);
    const poly = res.entities.find((e) => e.type === 'polyline');
    assert.ok(poly, 'Caminho linear fechado deve virar polilinha fechada');
    assert.equal(poly.closed, true);
    assert.equal(poly.vertices.length, 4);
});

test('svgToEntities aproxima curvas Bézier cúbicas e quadráticas em segmentos lineares', () => {
    const svg = `
    <svg width="300" height="300">
        <!-- Bézier Cúbica: M start C cp1 cp2 end -->
        <path d="M 0 0 C 10 50, 40 50, 50 0" />
        <!-- Bézier Quadrática: M start Q cp end -->
        <path d="M 100 0 Q 150 100 200 0" />
    </svg>`;

    const res = svgToEntities(svg);
    assert.ok(res.entities.length >= 2, 'Deve gerar polilinhas para as curvas Bézier');
    res.entities.forEach((e) => {
        assert.equal(e.type, 'polyline');
        assert.ok(e.vertices.length > 2, 'Curva Bézier deve ser discretizada com múltiplos vértices suaves');
    });
});

test('svgToEntities converte arcos elípticos SVG (comando A) com aproximação suave', () => {
    const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200">
        <!-- Arco circular de 90 graus de (50, 50) para (100, 100) com raio 50 -->
        <path d="M 50 50 A 50 50 0 0 1 100 100" />
    </svg>`;

    const res = svgToEntities(svg);
    const poly = res.entities.find((e) => e.type === 'polyline');
    assert.ok(poly, 'Arco deve gerar polilinha');
    assert.ok(poly.vertices.length >= 8, 'Deve conter múltiplos vértices aproximando o arco');
    assert.equal(poly.vertices[0].x, 50);
    assert.equal(poly.vertices[poly.vertices.length - 1].x, 100);
});

test('svgToEntities agrupa layers a partir de tags <g id="..."> e preserva cores', () => {
    const svg = `
    <svg width="500" height="500">
        <g id="CORTE_EXTERNO" stroke="#00ff00">
            <line x1="0" y1="0" x2="100" y2="0" />
            <line x1="100" y1="0" x2="100" y2="100" />
        </g>
        <g id="FUROS_INTERNOS" stroke="#ff0000">
            <circle cx="50" cy="50" r="10" />
        </g>
    </svg>`;

    const res = svgToEntities(svg);
    const layerNames = res.layers.map((l) => l.name);
    assert.ok(layerNames.includes('CORTE_EXTERNO'), 'Deve conter layer CORTE_EXTERNO');
    assert.ok(layerNames.includes('FUROS_INTERNOS'), 'Deve conter layer FUROS_INTERNOS');

    const lines = res.entities.filter((e) => e.layer === 'CORTE_EXTERNO');
    assert.equal(lines.length, 2);
    const circle = res.entities.find((e) => e.layer === 'FUROS_INTERNOS');
    assert.ok(circle);
});

test('svgToEntities suporta polígonos e polilinhas SVG', () => {
    const svg = `
    <svg width="300" height="300">
        <polygon points="10,10 100,10 100,100 10,100" />
        <polyline points="20,20 60,80 120,40" />
    </svg>`;

    const res = svgToEntities(svg);
    assert.equal(res.entities.length, 2);
    const polygon = res.entities.find((e) => e.closed);
    assert.ok(polygon, 'Polygon deve ser polilinha fechada');
    const polyline = res.entities.find((e) => !e.closed);
    assert.ok(polyline, 'Polyline deve ser polilinha aberta');
});
