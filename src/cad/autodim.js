// Cotagem automática de peça: dimensões gerais, cadeia de posições de furos, diâmetros e raios únicos.

import { entityBox, emptyBox, boxAddPoint, boxIsEmpty, sweepCCW } from './geometry.js';

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

    // Furos: círculos inteiros (não os de perfuração CNC).
    const circles = parts.filter((e) => e.type === 'circle' && !e.cnc);
    const uniqueXs = uniqueSorted(circles.map((c) => c.center.x));
    const uniqueYs = uniqueSorted(circles.map((c) => c.center.y));

    // Cadeia horizontal de posições de furos (abaixo), fechada nas duas bordas para somar a geral.
    // A linha de extensão sai do furo mais próximo da linha de cota, para não atravessar a peça.
    let rowOffset = 1;
    if (circles.length > 0) {
        const interiorX = uniqueXs.filter((x) => x > box.minX + 1e-6 && x < box.maxX - 1e-6);
        if (interiorX.length > 0) {
            const chainX = [box.minX, ...interiorX, box.maxX];
            const y = box.minY - gap * rowOffset;
            const refY = (x) => {
                const hits = circles.filter((c) => Math.abs(c.center.x - x) < 1e-6);
                return hits.length ? Math.min(...hits.map((c) => c.center.y)) : box.minY;
            };
            for (let i = 0; i + 1 < chainX.length; i += 1) {
                dim({ kind: 'horizontal', p1: { x: chainX[i], y: refY(chainX[i]) }, p2: { x: chainX[i + 1], y: refY(chainX[i + 1]) }, linePoint: { x: (chainX[i] + chainX[i + 1]) / 2, y } });
            }
            rowOffset += 1;
        }
    }
    // Dimensão geral horizontal (abaixo, mais afastada).
    dim({ kind: 'horizontal', p1: { x: box.minX, y: box.minY }, p2: { x: box.maxX, y: box.minY }, linePoint: { x: (box.minX + box.maxX) / 2, y: box.minY - gap * rowOffset } });

    // Cadeia vertical de posições de furos (à direita) e dimensão geral vertical.
    let colOffset = 1;
    if (circles.length > 0) {
        const interiorY = uniqueYs.filter((y) => y > box.minY + 1e-6 && y < box.maxY - 1e-6);
        if (interiorY.length > 0) {
            const chainY = [box.minY, ...interiorY, box.maxY];
            const x = box.maxX + gap * colOffset;
            const refX = (y) => {
                const hits = circles.filter((c) => Math.abs(c.center.y - y) < 1e-6);
                return hits.length ? Math.max(...hits.map((c) => c.center.x)) : box.maxX;
            };
            for (let i = 0; i + 1 < chainY.length; i += 1) {
                dim({ kind: 'vertical', p1: { x: refX(chainY[i]), y: chainY[i] }, p2: { x: refX(chainY[i + 1]), y: chainY[i + 1] }, linePoint: { x, y: (chainY[i] + chainY[i + 1]) / 2 } });
            }
            colOffset += 1;
        }
    }
    dim({ kind: 'vertical', p1: { x: box.maxX, y: box.minY }, p2: { x: box.maxX, y: box.maxY }, linePoint: { x: box.maxX + gap * colOffset, y: (box.minY + box.maxY) / 2 } });

    // Diâmetros: um por valor único, no furo mais à esquerda/embaixo, texto para fora a 45°.
    const seenDiameters = new Set();
    circles
        .slice()
        .sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y)
        .forEach((c) => {
            const key = round(c.radius * 2);
            if (seenDiameters.has(key)) return;
            seenDiameters.add(key);
            const count = circles.filter((o) => round(o.radius * 2) === key).length;
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
