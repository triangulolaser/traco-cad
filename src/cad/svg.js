// resources/js/cad/svg.js
// Vetorização e importação nativa de SVG para entidades CAD 2D editáveis.
// Suporta: line, rect, circle, ellipse, polyline, polygon, text e path com curvas Bézier e arcos.

import { createLayer, DEFAULT_LAYER } from './document.js';

export const SVG_DEFAULT_LAYER = 'SVG_GEOMETRIA';

/**
 * Detecta se a string ou os bytes se parecem com um documento SVG.
 */
export function looksLikeSvg(input) {
    if (!input) return false;
    let str;
    if (typeof input === 'string') {
        str = input.slice(0, 1000).trim();
    } else if (input instanceof Uint8Array || Array.isArray(input)) {
        str = new TextDecoder('utf-8').decode(input.slice(0, 1000)).trim();
    } else if (input.buffer) {
        str = new TextDecoder('utf-8').decode(new Uint8Array(input.buffer, 0, Math.min(1000, input.byteLength))).trim();
    } else {
        return false;
    }
    return /<svg[\s>]/i.test(str) || (/<(\?xml|!doctype)/i.test(str) && /<svg[\s>]/i.test(str));
}

/**
 * Parser simples e robusto de tags XML/SVG em puro ES6 (funciona idêntico em Node.js e Browsers).
 */
export function parseSvgDom(xml) {
    const clean = xml
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/gi, '');

    const tagRegex = /<(\/?)([a-zA-Z0-9_:-]+)((?:\s+[a-zA-Z0-9_:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
    const root = { tag: 'root', attrs: {}, children: [], text: '' };
    const stack = [root];
    let match;

    const selfClosingTags = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'image', 'use', 'stop']);

    while ((match = tagRegex.exec(clean)) !== null) {
        const [, isClosing, tagName, attrStr, isSelfClosingSlash, textNode] = match;

        if (textNode) {
            const trimmed = textNode.trim();
            if (trimmed && stack.length > 0) {
                stack[stack.length - 1].text = (stack[stack.length - 1].text + ' ' + trimmed).trim();
            }
            continue;
        }

        const tag = tagName.toLowerCase();
        if (isClosing) {
            if (stack.length > 1 && stack[stack.length - 1].tag === tag) {
                stack.pop();
            }
        } else {
            const attrs = {};
            if (attrStr) {
                const attrRe = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
                let m;
                while ((m = attrRe.exec(attrStr))) {
                    attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
                }
            }
            const node = { tag, attrs, children: [], text: '' };
            stack[stack.length - 1].children.push(node);

            const isSelf = Boolean(isSelfClosingSlash) || selfClosingTags.has(tag);
            if (!isSelf) {
                stack.push(node);
            }
        }
    }
    return root;
}

/**
 * Converte valor SVG com unidades (mm, cm, in, pt, px) para milímetros.
 */
export function parseLengthMm(val, defaultDpi = 96) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const s = String(val).trim().toLowerCase();
    const num = parseFloat(s);
    if (isNaN(num)) return 0;

    if (s.endsWith('mm')) return num;
    if (s.endsWith('cm')) return num * 10;
    if (s.endsWith('in')) return num * 25.4;
    if (s.endsWith('pt')) return num * (25.4 / 72);
    if (s.endsWith('pc')) return num * (25.4 / 6);
    if (s.endsWith('px')) return num * (25.4 / defaultDpi);
    return num; // sem unidade explícita: mantemos 1:1 relativo ao viewBox
}

/**
 * Interpreta curvas de Bézier cúbica em pontos interpolados.
 */
function flattenCubic(p0, p1, p2, p3, segments = 12) {
    const pts = [];
    for (let i = 1; i <= segments; i += 1) {
        const t = i / segments;
        const mt = 1 - t;
        pts.push({
            x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
            y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
        });
    }
    return pts;
}

/**
 * Interpreta curvas de Bézier quadrática em pontos interpolados.
 */
function flattenQuadratic(p0, p1, p2, segments = 8) {
    const pts = [];
    for (let i = 1; i <= segments; i += 1) {
        const t = i / segments;
        const mt = 1 - t;
        pts.push({
            x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
            y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
        });
    }
    return pts;
}

/**
 * Converte parâmetros de arco elíptico SVG (endpoint) para pontos discretizados.
 */
function flattenArc(p0, rx, ry, angleDeg, largeArc, sweep, p1) {
    if (p0.x === p1.x && p0.y === p1.y) return [];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return [p1];

    const phi = ((angleDeg % 360) * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const dx = (p0.x - p1.x) / 2;
    const dy = (p0.y - p1.y) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        const factor = Math.sqrt(lambda);
        rx *= factor;
        ry *= factor;
    }

    const sign = largeArc === sweep ? -1 : 1;
    const num = (rx * rx) * (ry * ry) - (rx * rx) * (y1p * y1p) - (ry * ry) * (x1p * x1p);
    const denom = (rx * rx) * (y1p * y1p) + (ry * ry) * (x1p * x1p);
    const coef = sign * Math.sqrt(Math.max(0, num / denom));
    const cxp = coef * ((rx * y1p) / ry);
    const cyp = coef * (-(ry * x1p) / rx);

    const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

    function vecAngle(ux, uy, vx, vy) {
        const s = (ux * vy - uy * vx) < 0 ? -1 : 1;
        const dot = ux * vx + uy * vy;
        const mag = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
        return s * Math.acos(Math.max(-1, Math.min(1, dot / (mag || 1))));
    }

    const uX = (x1p - cxp) / rx;
    const uY = (y1p - cyp) / ry;
    const vX = (-x1p - cxp) / rx;
    const vY = (-y1p - cyp) / ry;

    let theta1 = vecAngle(1, 0, uX, uY);
    let dTheta = vecAngle(uX, uY, vX, vY);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

    const segments = Math.max(8, Math.ceil(Math.abs(dTheta) / (Math.PI / 8)));
    const pts = [];
    for (let i = 1; i <= segments; i += 1) {
        const t = theta1 + (dTheta * i) / segments;
        const ex = rx * Math.cos(t);
        const ey = ry * Math.sin(t);
        pts.push({
            x: cosPhi * ex - sinPhi * ey + cx,
            y: sinPhi * ex + cosPhi * ey + cy,
        });
    }
    return pts;
}

/**
 * Interpreta string de comando SVG Path (d="...").
 */
export function parseSvgPath(d) {
    if (!d) return [];
    const tokens = d.match(/[a-df-z]|[\-+]?(?:\d*\.\d+|\d+)(?:[eE][\-+]?\d+)?/gi) || [];
    let idx = 0;
    let cursor = { x: 0, y: 0 };
    let startPoint = { x: 0, y: 0 };
    let lastControl = null;
    let lastCmd = null;
    const subpaths = [];
    let currentPath = null;

    function nextNum() {
        if (idx >= tokens.length) return 0;
        const val = parseFloat(tokens[idx++]);
        return isNaN(val) ? 0 : val;
    }

    while (idx < tokens.length) {
        const token = tokens[idx++];
        if (!/^[a-df-z]$/i.test(token)) continue;
        const cmd = token;
        const isRel = cmd === cmd.toLowerCase();
        const upper = cmd.toUpperCase();

        if (upper === 'M') {
            const x = nextNum() + (isRel ? cursor.x : 0);
            const y = nextNum() + (isRel ? cursor.y : 0);
            cursor = { x, y };
            startPoint = { x, y };
            currentPath = { points: [{ x, y }], closed: false };
            subpaths.push(currentPath);
            lastControl = null;
            lastCmd = 'M';

            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                const lx = nextNum() + (isRel ? cursor.x : 0);
                const ly = nextNum() + (isRel ? cursor.y : 0);
                cursor = { x: lx, y: ly };
                currentPath.points.push({ x: lx, y: ly });
            }
        } else if (upper === 'L') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                const x = nextNum() + (isRel ? cursor.x : 0);
                const y = nextNum() + (isRel ? cursor.y : 0);
                cursor = { x, y };
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                currentPath.points.push({ x, y });
                lastControl = null;
            }
            lastCmd = 'L';
        } else if (upper === 'H') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                const x = nextNum() + (isRel ? cursor.x : 0);
                cursor = { x, y: cursor.y };
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                currentPath.points.push({ ...cursor });
                lastControl = null;
            }
            lastCmd = 'H';
        } else if (upper === 'V') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                const y = nextNum() + (isRel ? cursor.y : 0);
                cursor = { x: cursor.x, y };
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                currentPath.points.push({ ...cursor });
                lastControl = null;
            }
            lastCmd = 'V';
        } else if (upper === 'C') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                const x1 = nextNum() + (isRel ? cursor.x : 0);
                const y1 = nextNum() + (isRel ? cursor.y : 0);
                const x2 = nextNum() + (isRel ? cursor.x : 0);
                const y2 = nextNum() + (isRel ? cursor.y : 0);
                const x = nextNum() + (isRel ? cursor.x : 0);
                const y = nextNum() + (isRel ? cursor.y : 0);
                const target = { x, y };
                const sampled = flattenCubic(cursor, { x: x1, y: y1 }, { x: x2, y: y2 }, target);
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                sampled.forEach((p) => currentPath.points.push(p));
                cursor = target;
                lastControl = { x: x2, y: y2 };
            }
            lastCmd = 'C';
        } else if (upper === 'S') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                let x1 = cursor.x;
                let y1 = cursor.y;
                if (['C', 'S'].includes(lastCmd) && lastControl) {
                    x1 = 2 * cursor.x - lastControl.x;
                    y1 = 2 * cursor.y - lastControl.y;
                }
                const x2 = nextNum() + (isRel ? cursor.x : 0);
                const y2 = nextNum() + (isRel ? cursor.y : 0);
                const x = nextNum() + (isRel ? cursor.x : 0);
                const y = nextNum() + (isRel ? cursor.y : 0);
                const target = { x, y };
                const sampled = flattenCubic(cursor, { x: x1, y: y1 }, { x: x2, y: y2 }, target);
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                sampled.forEach((p) => currentPath.points.push(p));
                cursor = target;
                lastControl = { x: x2, y: y2 };
                lastCmd = 'S';
            }
        } else if (upper === 'Q') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                const x1 = nextNum() + (isRel ? cursor.x : 0);
                const y1 = nextNum() + (isRel ? cursor.y : 0);
                const x = nextNum() + (isRel ? cursor.x : 0);
                const y = nextNum() + (isRel ? cursor.y : 0);
                const target = { x, y };
                const sampled = flattenQuadratic(cursor, { x: x1, y: y1 }, target);
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                sampled.forEach((p) => currentPath.points.push(p));
                cursor = target;
                lastControl = { x: x1, y: y1 };
            }
            lastCmd = 'Q';
        } else if (upper === 'T') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                let x1 = cursor.x;
                let y1 = cursor.y;
                if (['Q', 'T'].includes(lastCmd) && lastControl) {
                    x1 = 2 * cursor.x - lastControl.x;
                    y1 = 2 * cursor.y - lastControl.y;
                }
                const x = nextNum() + (isRel ? cursor.x : 0);
                const y = nextNum() + (isRel ? cursor.y : 0);
                const target = { x, y };
                const sampled = flattenQuadratic(cursor, { x: x1, y: y1 }, target);
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                sampled.forEach((p) => currentPath.points.push(p));
                cursor = target;
                lastControl = { x: x1, y: y1 };
                lastCmd = 'T';
            }
        } else if (upper === 'A') {
            while (idx < tokens.length && !/^[a-df-z]$/i.test(tokens[idx])) {
                const rx = nextNum();
                const ry = nextNum();
                const rot = nextNum();
                const largeArc = nextNum() !== 0;
                const sweep = nextNum() !== 0;
                const x = nextNum() + (isRel ? cursor.x : 0);
                const y = nextNum() + (isRel ? cursor.y : 0);
                const target = { x, y };
                const sampled = flattenArc(cursor, rx, ry, rot, largeArc, sweep, target);
                if (!currentPath) { currentPath = { points: [cursor], closed: false }; subpaths.push(currentPath); }
                sampled.forEach((p) => currentPath.points.push(p));
                cursor = target;
                lastControl = null;
            }
            lastCmd = 'A';
        } else if (upper === 'Z') {
            if (currentPath) {
                currentPath.closed = true;
                currentPath.points.push({ ...startPoint });
                cursor = { ...startPoint };
            }
            lastControl = null;
            lastCmd = 'Z';
        }
    }
    return subpaths;
}

/**
 * Interpreta string points="x1,y1 x2,y2 ..." para polyline/polygon.
 */
function parsePointsString(pointsStr) {
    if (!pointsStr) return [];
    const nums = pointsStr.trim().split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
        pts.push({ x: nums[i], y: nums[i + 1] });
    }
    return pts;
}

/**
 * Converte um documento SVG para entidades CAD 2D editáveis.
 */
export function svgToEntities(svgText, { name = 'desenho.svg', defaultLayer = SVG_DEFAULT_LAYER } = {}) {
    const dom = parseSvgDom(svgText);
    const svgNode = dom.children.find((c) => c.tag === 'svg') || dom.children[0];
    if (!svgNode) throw new Error('Documento SVG inválido: elemento <svg> não encontrado.');

    // Metadados do SVG
    let viewBox = null;
    if (svgNode.attrs.viewbox) {
        const vb = svgNode.attrs.viewbox.trim().split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
        if (vb.length === 4) viewBox = { minX: vb[0], minY: vb[1], width: vb[2], height: vb[3] };
    }
    const svgWidth = parseLengthMm(svgNode.attrs.width) || viewBox?.width || 0;
    const svgHeight = parseLengthMm(svgNode.attrs.height) || viewBox?.height || 0;

    const layersMap = new Map();
    layersMap.set('0', { name: '0', color: '#ffffff', visible: true, locked: false });

    function getOrCreateLayer(layerName, strokeColor) {
        const cleanName = String(layerName || defaultLayer).trim().replace(/[\\/:*?"<>|]/g, '_');
        if (!layersMap.has(cleanName)) {
            layersMap.set(cleanName, {
                name: cleanName,
                color: strokeColor && strokeColor !== 'none' ? strokeColor : '#38bdf8',
                visible: true,
                locked: false,
            });
        }
        return cleanName;
    }

    const rawEntities = [];
    let entityIdCounter = 0;
    function nextId() {
        return `svg_${++entityIdCounter}`;
    }

    function traverse(node, currentLayer, currentStroke) {
        let activeLayer = currentLayer;
        let activeStroke = node.attrs.stroke || currentStroke;

        if (node.tag === 'g') {
            if (node.attrs.id) {
                activeLayer = getOrCreateLayer(node.attrs.id, activeStroke);
            }
        }

        const stroke = node.attrs.stroke || activeStroke;
        const layer = activeLayer || getOrCreateLayer(defaultLayer, stroke);

        if (node.tag === 'line') {
            const x1 = parseFloat(node.attrs.x1 || 0);
            const y1 = parseFloat(node.attrs.y1 || 0);
            const x2 = parseFloat(node.attrs.x2 || 0);
            const y2 = parseFloat(node.attrs.y2 || 0);
            rawEntities.push({
                id: nextId(),
                type: 'line',
                layer,
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
            });
        } else if (node.tag === 'circle') {
            const cx = parseFloat(node.attrs.cx || 0);
            const cy = parseFloat(node.attrs.cy || 0);
            const r = parseFloat(node.attrs.r || 0);
            if (r > 0) {
                rawEntities.push({
                    id: nextId(),
                    type: 'circle',
                    layer,
                    center: { x: cx, y: cy },
                    radius: r,
                });
            }
        } else if (node.tag === 'ellipse') {
            const cx = parseFloat(node.attrs.cx || 0);
            const cy = parseFloat(node.attrs.cy || 0);
            const rx = parseFloat(node.attrs.rx || 0);
            const ry = parseFloat(node.attrs.ry || 0);
            if (rx > 0 && ry > 0) {
                rawEntities.push({
                    id: nextId(),
                    type: 'ellipse',
                    layer,
                    center: { x: cx, y: cy },
                    major: { x: rx, y: 0 },
                    ratio: ry / rx,
                    start: 0,
                    end: Math.PI * 2,
                });
            }
        } else if (node.tag === 'rect') {
            const x = parseFloat(node.attrs.x || 0);
            const y = parseFloat(node.attrs.y || 0);
            const w = parseFloat(node.attrs.width || 0);
            const h = parseFloat(node.attrs.height || 0);
            const rx = parseFloat(node.attrs.rx || 0);
            const ry = parseFloat(node.attrs.ry || rx);

            if (w > 0 && h > 0) {
                if (rx > 0 && ry > 0) {
                    // Retângulo com cantos arredondados
                    const r = Math.min(rx, w / 2, h / 2);
                    const verts = [
                        { x: x + r, y: y, bulge: 0 },
                        { x: x + w - r, y: y, bulge: -Math.tan(Math.PI / 8) },
                        { x: x + w, y: y + r, bulge: 0 },
                        { x: x + w, y: y + h - r, bulge: -Math.tan(Math.PI / 8) },
                        { x: x + w - r, y: y + h, bulge: 0 },
                        { x: x + r, y: y + h, bulge: -Math.tan(Math.PI / 8) },
                        { x: x, y: y + h - r, bulge: 0 },
                        { x: x, y: y + r, bulge: -Math.tan(Math.PI / 8) },
                    ];
                    rawEntities.push({
                        id: nextId(),
                        type: 'polyline',
                        layer,
                        closed: true,
                        vertices: verts,
                    });
                } else {
                    rawEntities.push({
                        id: nextId(),
                        type: 'polyline',
                        layer,
                        closed: true,
                        vertices: [
                            { x: x, y: y, bulge: 0 },
                            { x: x + w, y: y, bulge: 0 },
                            { x: x + w, y: y + h, bulge: 0 },
                            { x: x, y: y + h, bulge: 0 },
                        ],
                    });
                }
            }
        } else if (node.tag === 'polyline' || node.tag === 'polygon') {
            const pts = parsePointsString(node.attrs.points);
            if (pts.length >= 2) {
                rawEntities.push({
                    id: nextId(),
                    type: 'polyline',
                    layer,
                    closed: node.tag === 'polygon',
                    vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
                });
            }
        } else if (node.tag === 'text') {
            const x = parseFloat(node.attrs.x || 0);
            const y = parseFloat(node.attrs.y || 0);
            const textContent = (node.text || '').trim();
            const fontSize = parseFloat(node.attrs['font-size'] || 12);
            if (textContent) {
                rawEntities.push({
                    id: nextId(),
                    type: 'text',
                    layer,
                    position: { x, y },
                    text: textContent,
                    height: fontSize,
                });
            }
        } else if (node.tag === 'path') {
            const subpaths = parseSvgPath(node.attrs.d);
            subpaths.forEach((sp) => {
                let pts = sp.points.filter((p, i) => i === 0 || Math.hypot(p.x - sp.points[i - 1].x, p.y - sp.points[i - 1].y) > 1e-6);
                if (pts.length < 2) return;
                if (sp.closed && pts.length > 2) {
                    const first = pts[0];
                    const last = pts[pts.length - 1];
                    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-5) {
                        pts.pop();
                    }
                }
                if (pts.length === 2 && !sp.closed) {
                    rawEntities.push({
                        id: nextId(),
                        type: 'line',
                        layer,
                        start: pts[0],
                        end: pts[1],
                    });
                } else {
                    rawEntities.push({
                        id: nextId(),
                        type: 'polyline',
                        layer,
                        closed: sp.closed,
                        vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
                    });
                }
            });
        }

        for (const child of node.children) {
            traverse(child, activeLayer, activeStroke);
        }
    }

    traverse(svgNode, null, null);

    if (rawEntities.length === 0) {
        throw new Error('Nenhuma entidade vetorial reconhecida no arquivo SVG.');
    }

    // Calcula os limites para inversão correta do eixo Y (SVG Y cresce para baixo -> CAD Y cresce para cima)
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;

    function accountPoint(x, y) {
        if (!isNaN(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
        if (!isNaN(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }

    rawEntities.forEach((e) => {
        if (e.type === 'line') {
            accountPoint(e.start.x, e.start.y);
            accountPoint(e.end.x, e.end.y);
        } else if (e.type === 'circle') {
            accountPoint(e.center.x - e.radius, e.center.y - e.radius);
            accountPoint(e.center.x + e.radius, e.center.y + e.radius);
        } else if (e.type === 'ellipse') {
            accountPoint(e.center.x, e.center.y);
        } else if (e.type === 'polyline') {
            e.vertices.forEach((v) => accountPoint(v.x, v.y));
        } else if (e.type === 'text') {
            accountPoint(e.position.x, e.position.y);
        }
    });

    const heightRef = viewBox?.height || (maxY - minY > 0 ? maxY : 0);
    const flipY = (y) => (heightRef ? heightRef - y : -y);

    const entities = rawEntities.map((e) => {
        if (e.type === 'line') {
            return {
                ...e,
                start: { x: e.start.x, y: flipY(e.start.y) },
                end: { x: e.end.x, y: flipY(e.end.y) },
            };
        }
        if (e.type === 'circle') {
            return {
                ...e,
                center: { x: e.center.x, y: flipY(e.center.y) },
            };
        }
        if (e.type === 'ellipse') {
            return {
                ...e,
                center: { x: e.center.x, y: flipY(e.center.y) },
            };
        }
        if (e.type === 'polyline') {
            return {
                ...e,
                vertices: e.vertices.map((v) => ({
                    ...v,
                    y: flipY(v.y),
                    bulge: v.bulge ? -v.bulge : 0, // Inverter o sentido do bulge ao espelhar Y
                })),
            };
        }
        if (e.type === 'text') {
            return {
                ...e,
                position: { x: e.position.x, y: flipY(e.position.y) },
            };
        }
        return e;
    });

    const counts = {
        lines: entities.filter((e) => e.type === 'line').length,
        circles: entities.filter((e) => e.type === 'circle').length,
        ellipses: entities.filter((e) => e.type === 'ellipse').length,
        polylines: entities.filter((e) => e.type === 'polyline').length,
        texts: entities.filter((e) => e.type === 'text').length,
    };

    return {
        name,
        units: 'mm',
        layers: [...layersMap.values()],
        entities,
        stats: counts,
        bounds: { minX, minY: flipY(maxY), maxX, maxY: flipY(minY) },
    };
}
