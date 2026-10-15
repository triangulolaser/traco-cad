// Cotagem automática de peça: dimensões gerais, cadeia de posições de furos, diâmetros e raios únicos.
// Peça = existe um contorno fechado que envolve todo o resto; furos são os círculos dentro dele.
// Desenho solto (sem esse contorno) recebe só as gerais, diâmetros e raios. As gerais saem dos
// pontos extremos da geometria, nunca de cantos vazios do retângulo envolvente.

import { entityBox, emptyBox, boxAddPoint, boxIsEmpty, sweepCCW, entityCurves, curveEndpoints, curveQuadrants, polylineCurves, curveBox, polar } from './geometry.js';
import { loopsFromEntities } from './hatch.js';
import { pointInPolygon } from './edit-tools.js';

const round = (v, decimals = 3) => Number(v.toFixed(decimals));

// entities: entidades da peça (sem cotas/hachuras/imagens). Retorna entidades 'dimension'.
export function autoDimensionPart(entities, { dimStyle = null, layer = 'dimensions' } = {}) {
    const parts = entities.filter((e) => !['dimension', 'hatch', 'image', 'text'].includes(e.type));
    if (parts.length === 0) return [];
    const box = emptyBox();
    parts.forEach((e) => {
        const b = entityBox(e);
        if (!boxIsEmpty(b)) {
            boxAddPoint(box, { x: b.minX, y: b.minY });
            boxAddPoint(box, { x: b.maxX, y: b.maxY });
        }
    });
    if (boxIsEmpty(box)) return [];
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    const textHeight = (dimStyle?.textHeight ?? 2.5) * (dimStyle?.scale ?? 1);
    const gap = Math.max(textHeight * 3.2, Math.min(width, height) * 0.08, 6);
    const out = [];
    const dim = (d) => out.push({ type: 'dimension', layer, ...d });

    const tol = Math.max(width, height) * 1e-6 + 1e-9;
    const keys = keyPoints(parts);
    const pick = (better) => keys.reduce((best, p) => (best === null || better(p, best) ? p : best), null);
    const left = pick((p, b) => p.x < b.x - tol || (Math.abs(p.x - b.x) <= tol && p.y < b.y));
    const right = pick((p, b) => p.x > b.x + tol || (Math.abs(p.x - b.x) <= tol && p.y < b.y));
    const bottom = pick((p, b) => p.y < b.y - tol || (Math.abs(p.y - b.y) <= tol && p.x > b.x));
    const top = pick((p, b) => p.y > b.y + tol || (Math.abs(p.y - b.y) <= tol && p.x > b.x));

    // Furos: círculos inteiros (não os de perfuração CNC) dentro do contorno externo da peça.
    const allCircles = parts.filter((e) => e.type === 'circle' && !e.cnc);
    const outer = outerContour(parts, box, tol);
    const circles = outer === undefined
        ? allCircles
        : outer === null
            ? []
            : allCircles.filter((c) => !sameBox(entityBox(c), box, tol) && pointInPolygon(c.center, outer));
    const uniqueXs = uniqueSorted(circles.map((c) => c.center.x));
    const uniqueYs = uniqueSorted(circles.map((c) => c.center.y));

    // Cadeia horizontal de posições de furos (abaixo), fechada nas duas bordas para somar a geral.
    // A linha de extensão sai do furo mais próximo da linha de cota, para não atravessar a peça.
    let rowOffset = 1;
    if (circles.length > 0) {
        const interiorX = uniqueXs.filter((x) => x > box.minX + 1e-6 && x < box.maxX - 1e-6);
        if (interiorX.length > 0) {
            const chainX = [left.x, ...interiorX, right.x];
            const y = box.minY - gap * rowOffset;
            const refY = (x, i) => {
                const hits = circles.filter((c) => Math.abs(c.center.x - x) < 1e-6);
                if (hits.length) return Math.min(...hits.map((c) => c.center.y));
                return i === 0 ? left.y : right.y;
            };
            for (let i = 0; i + 1 < chainX.length; i += 1) {
                dim({ kind: 'horizontal', p1: { x: chainX[i], y: refY(chainX[i], i) }, p2: { x: chainX[i + 1], y: refY(chainX[i + 1], i + 1) }, linePoint: { x: (chainX[i] + chainX[i + 1]) / 2, y } });
            }
            rowOffset += 1;
        }
    }
    // Dimensão geral horizontal (abaixo, mais afastada).
    dim({ kind: 'horizontal', p1: left, p2: right, linePoint: { x: (box.minX + box.maxX) / 2, y: box.minY - gap * rowOffset } });

    // Cadeia vertical de posições de furos (à direita) e dimensão geral vertical.
    let colOffset = 1;
    if (circles.length > 0) {
        const interiorY = uniqueYs.filter((y) => y > box.minY + 1e-6 && y < box.maxY - 1e-6);
        if (interiorY.length > 0) {
            const chainY = [bottom.y, ...interiorY, top.y];
            const x = box.maxX + gap * colOffset;
            const refX = (y, i) => {
                const hits = circles.filter((c) => Math.abs(c.center.y - y) < 1e-6);
                if (hits.length) return Math.max(...hits.map((c) => c.center.x));
                return i === 0 ? bottom.x : top.x;
            };
            for (let i = 0; i + 1 < chainY.length; i += 1) {
                dim({ kind: 'vertical', p1: { x: refX(chainY[i], i), y: chainY[i] }, p2: { x: refX(chainY[i + 1], i + 1), y: chainY[i + 1] }, linePoint: { x, y: (chainY[i] + chainY[i + 1]) / 2 } });
            }
            colOffset += 1;
        }
    }
    dim({ kind: 'vertical', p1: bottom, p2: top, linePoint: { x: box.maxX + gap * colOffset, y: (box.minY + box.maxY) / 2 } });

    // Diâmetros: um por valor único, no furo mais à esquerda/embaixo, texto para fora a 45°.
    // Fora de peça, cada círculo solto também recebe o seu diâmetro.
    const seenDiameters = new Set();
    (outer === null ? allCircles : circles)
        .slice()
        .sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y)
        .forEach((c) => {
            const key = round(c.radius * 2);
            if (seenDiameters.has(key)) return;
            seenDiameters.add(key);
            const count = (outer === null ? allCircles : circles).filter((o) => round(o.radius * 2) === key).length;
            // Chamada a 45° para fora do centro da peça, para o texto não cair sobre a geometria.
            const sx = c.center.x < (box.minX + box.maxX) / 2 ? -1 : 1;
            const sy = c.center.y < (box.minY + box.maxY) / 2 ? -1 : 1;
            const reach = c.radius + textHeight * 3;
            const linePoint = { x: c.center.x + sx * reach, y: c.center.y + sy * reach };
            dim({ kind: 'diameter', center: c.center, radius: c.radius, linePoint, textOverride: count > 1 ? `${count}x Ø${formatNum(key)}` : undefined });
        });

    // Raios: um por valor único entre arcos (concordâncias), texto para fora do arco.
    const seenRadii = new Set();
    parts.filter((e) => e.type === 'arc' && !e.cnc).forEach((a) => {
        const key = round(a.radius);
        if (seenRadii.has(key)) return;
        seenRadii.add(key);
        const mid = a.start + sweepCCW(a.start, a.end) / 2;
        const linePoint = { x: a.center.x + Math.cos(mid) * (a.radius + textHeight * 4), y: a.center.y + Math.sin(mid) * (a.radius + textHeight * 4) };
        dim({ kind: 'radius', center: a.center, radius: a.radius, linePoint });
    });

    return out;
}

// Pontos reais da geometria: extremidades, vértices e quadrantes dentro de cada arco.
function keyPoints(parts) {
    const out = [];
    parts.forEach((e) => {
        let curves = [];
        try {
            curves = entityCurves(e);
        } catch {
            curves = [];
        }
        curves.forEach((c) => out.push(...curveEndpoints(c), ...curveQuadrants(c)));
        if (curves.length === 0) {
            const b = entityBox(e);
            if (!boxIsEmpty(b)) out.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
        }
    });
    return out.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map((p) => ({ x: p.x, y: p.y }));
}

// Polígono do laço fechado que ocupa todo o retângulo envolvente (o contorno da peça).
// null = desenho sem contorno externo; undefined = complexo demais para montar os laços.
function outerContour(parts, box, tol) {
    let loops;
    try {
        loops = loopsFromEntities(parts.filter((e) => e.type !== 'point'));
    } catch {
        return undefined;
    }
    for (const loop of loops) {
        const curves = polylineCurves(loop.vertices, true);
        const loopBox = emptyBox();
        curves.forEach((c) => {
            const b = curveBox(c);
            if (!boxIsEmpty(b)) {
                boxAddPoint(loopBox, { x: b.minX, y: b.minY });
                boxAddPoint(loopBox, { x: b.maxX, y: b.maxY });
            }
        });
        if (!sameBox(loopBox, box, tol * 10)) continue;
        const polygon = [];
        curves.forEach((c) => {
            if (c.kind === 'segment') {
                polygon.push(c.a);
                return;
            }
            // O arco do bulge negativo vem com início e fim trocados; amostra no sentido do laço.
            const sweep = sweepCCW(c.start, c.end) || Math.PI * 2;
            const from = loop.vertices[c.index];
            const first = polar(c.center, c.start, c.radius);
            const forward = Math.hypot(first.x - from.x, first.y - from.y) <= Math.hypot(polar(c.center, c.end, c.radius).x - from.x, polar(c.center, c.end, c.radius).y - from.y);
            for (let i = 0; i < 24; i += 1) polygon.push(polar(c.center, forward ? c.start + (sweep * i) / 24 : c.end - (sweep * i) / 24, c.radius));
        });
        return polygon;
    }
    return null;
}

function sameBox(a, b, tol) {
    return Math.abs(a.minX - b.minX) <= tol && Math.abs(a.minY - b.minY) <= tol && Math.abs(a.maxX - b.maxX) <= tol && Math.abs(a.maxY - b.maxY) <= tol;
}

function uniqueSorted(values, tol = 1e-6) {
    const sorted = values.slice().sort((a, b) => a - b);
    const out = [];
    sorted.forEach((v) => {
        if (out.length === 0 || Math.abs(out[out.length - 1] - v) > tol) out.push(v);
    });
    return out;
}

function formatNum(v) {
    return String(round(v, 2)).replace(/\.0+$/, '');
}
