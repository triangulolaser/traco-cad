import {FONT_FAMILIES} from './fonts.js';
import {hydrateInsert} from './blocks.js';
// Leitura e escrita de DXF ASCII (R12 / R2000) para o subconjunto suportado pelo Traço.
// Entidades: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE/VERTEX, TEXT, MTEXT, INSERT (achatado).

import { degToRad, radToDeg, rotatePoint, add, sub, scale, distance, perpendicular, normalizeAngle } from './geometry.js';
import { createLayer, DEFAULT_LAYER, BYLAYER, LINETYPES } from './document.js';
import { dimensionGeometry, formatMeasurement } from './dimensions.js';
import { HATCH_PATTERNS } from './hatch.js';

// ---------------------------------------------------------------------------
// Parser

function readPairs(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = Number(lines[i].trim());
        if (!Number.isFinite(code)) continue;
        pairs.push({ code, value: lines[i + 1].trim() });
    }
    return pairs;
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

class Cursor {
    constructor(pairs) {
        this.pairs = pairs;
        this.index = 0;
    }

    peek() {
        return this.pairs[this.index] ?? null;
    }

    next() {
        const p = this.pairs[this.index] ?? null;
        this.index += 1;
        return p;
    }

    done() {
        return this.index >= this.pairs.length;
    }
}

function collectGroup(cursor) {
    // Lê pares até o próximo código 0.
    const groups = [];
    while (!cursor.done()) {
        const p = cursor.peek();
        if (p.code === 0) break;
        groups.push(cursor.next());
    }
    return groups;
}

function first(groups, code, fallback = undefined) {
    const g = groups.find((p) => p.code === code);
    return g ? g.value : fallback;
}

/**
 * Override de estilo de cota gravado em XDATA (1001 ACAD / 1000 DSTYLE / 1002 { 1070 <código> 1040 <valor> 1002 }).
 * Usado para DIMLFAC (144) por peça, que SolidWorks e AutoCAD gravam por cota em desenhos com escala de vista.
 */
function dimStyleOverride(groups, code) {
    const start = groups.findIndex((p) => p.code === 1000 && p.value === 'DSTYLE');
    if (start < 0) return undefined;
    for (let i = start; i < groups.length - 1; i += 1) {
        if (groups[i].code === 1070 && num(groups[i].value) === code && groups[i + 1].code === 1040) return num(groups[i + 1].value);
    }
    return undefined;
}

function all(groups, code) {
    return groups.filter((p) => p.code === code).map((p) => p.value);
}

function decodeText(value) {
    return String(value ?? '')
        .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\P/g, '\n')
        .replace(/\\~/g, ' ')
        .replace(/\{\\[^;]*;/g, '')
        .replace(/\\[A-Za-z][^;]*;/g, '')
        .replace(/[{}]/g, '')
        .replace(/%%c/gi, 'Ø')
        .replace(/%%d/gi, '°')
        .replace(/%%p/gi, '±');
}

// Cor ACI do código 62: ausente ou 256 é ByLayer.
function entityColor(groups) {
    const colorRaw = first(groups, 62);
    return colorRaw === undefined || Number(colorRaw) === 256 ? BYLAYER : Number(colorRaw);
}

function parseEntity(type, groups) {
    const layer = first(groups, 8, DEFAULT_LAYER);
    const color = entityColor(groups);
    const base = { layer, color };
    const lineTypeRaw = first(groups, 6);
    if (lineTypeRaw && String(lineTypeRaw).toUpperCase() !== 'BYLAYER') {
        base.lineType = String(lineTypeRaw).toUpperCase();
    }
    const lineWeightRaw = first(groups, 370);
    if (lineWeightRaw !== undefined && num(lineWeightRaw) >= 0) {
        base.lineWeight = num(lineWeightRaw);
    }
    switch (type) {
        case 'LINE':
            return { ...base, type: 'line', start: { x: num(first(groups, 10)), y: num(first(groups, 20)) }, end: { x: num(first(groups, 11)), y: num(first(groups, 21)) } };
        case 'CIRCLE': {
            // OCS com Z negativo: o centro está espelhado em X.
            const cx = num(first(groups, 10));
            return { ...base, type: 'circle', center: { x: num(first(groups, 230, 1)) < 0 ? -cx : cx, y: num(first(groups, 20)) }, radius: num(first(groups, 40)) };
        }
        case 'ARC': {
            const extrusion = num(first(groups, 230, 1));
            let start = degToRad(num(first(groups, 50)));
            let end = degToRad(num(first(groups, 51)));
            let cx = num(first(groups, 10));
            if (extrusion < 0) {
                // OCS com Z negativo: espelha em X e inverte sentido.
                cx = -cx;
                const s = Math.PI - end;
                const e = Math.PI - start;
                start = s;
                end = e;
            }
            return { ...base, type: 'arc', center: { x: cx, y: num(first(groups, 20)) }, radius: num(first(groups, 40)), start: normalizeAngle(start), end: normalizeAngle(end) };
        }
        case 'LWPOLYLINE': {
            const flags = num(first(groups, 70, 0));
            const constWidth = num(first(groups, 43, 0));
            const vertices = [];
            let current = null;
            groups.forEach((p) => {
                if (p.code === 10) {
                    current = { x: num(p.value), y: 0, bulge: 0 };
                    vertices.push(current);
                } else if (p.code === 20 && current) current.y = num(p.value);
                else if (p.code === 42 && current) current.bulge = num(p.value);
            });
            if (num(first(groups, 230, 1)) < 0) {
                // OCS com Z negativo: espelha em X e inverte o sentido dos arcos.
                vertices.forEach((v) => { v.x = -v.x; v.bulge = -v.bulge; });
            }
            return { ...base, type: 'polyline', vertices, closed: Boolean(flags & 1), ...(constWidth > 0 ? { constantWidth: constWidth } : {}) };
        }
        case 'SOLID': {
            // SOLID guarda os cantos em Z (1, 2, 4, 3): o contorno é 10 → 11 → 13 → 12.
            const pts = [[10, 20], [11, 21], [13, 23], [12, 22]].map(([cx, cy]) => ({ x: num(first(groups, cx)), y: num(first(groups, cy)), bulge: 0 }));
            const unique = pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 1e-9 || Math.abs(p.y - pts[i - 1].y) > 1e-9);
            return { ...base, type: 'polyline', vertices: unique, closed: true };
        }
        case 'ELLIPSE': {
            const center = { x: num(first(groups, 10)), y: num(first(groups, 20)) };
            const major = { x: num(first(groups, 11)), y: num(first(groups, 21)) };
            const ratio = num(first(groups, 40, 1));
            const start = num(first(groups, 41, 0));
            const end = num(first(groups, 42, Math.PI * 2));
            const extrusion = num(first(groups, 230, 1));
            const e = { ...base, type: 'ellipse', center, major, ratio, start, end };
            if (extrusion < 0) {
                // Centro e eixo maior da ELLIPSE já vêm em WCS; só o eixo menor (N × maior) troca de lado,
                // o que equivale a percorrer o parâmetro ao contrário.
                e.start = Math.PI * 2 - end;
                e.end = Math.PI * 2 - start;
            }
            return e;
        }
        case 'SPLINE': {
            const flags = num(first(groups, 70, 8));
            const degree = num(first(groups, 71, 3));
            const knots = all(groups, 40).map(num);
            const weights = all(groups, 41).map(num);
            const controlPoints = [];
            const fitPoints = [];
            let current = null;
            groups.forEach((g) => {
                if (g.code === 10) { current = { x: num(g.value), y: 0 }; controlPoints.push(current); }
                else if (g.code === 20 && current) current.y = num(g.value);
                else if (g.code === 11) { current = { x: num(g.value), y: 0, fit: true }; fitPoints.push(current); }
                else if (g.code === 21 && current?.fit) current.y = num(g.value);
            });
            const entity = { ...base, type: 'spline', degree, closed: Boolean(flags & 1), periodic: Boolean(flags & 2) };
            if (controlPoints.length >= 2 && knots.length >= controlPoints.length + degree + 1) {
                entity.controlPoints = controlPoints.map((c) => ({ x: c.x, y: c.y }));
                entity.knots = knots;
                if (weights.length === controlPoints.length) entity.weights = weights;
            }
            if (fitPoints.length >= 2) entity.fitPoints = fitPoints.map((c) => ({ x: c.x, y: c.y }));
            if (!entity.controlPoints && !entity.fitPoints) return null;
            return entity;
        }
        case 'HATCH': {
            const solid = num(first(groups, 70, 0)) === 1;
            const name = String(first(groups, 2, solid ? 'SOLID' : 'ANSI31')).toUpperCase();
            const loops = [];
            let current = null;
            let mode = null; // 'polyline' | 'edges'
            let edge = null;
            let expectVertices = 0;
            for (let i = 0; i < groups.length; i += 1) {
                const g = groups[i];
                if (g.code === 92) {
                    const flags = num(g.value);
                    current = { vertices: [] };
                    loops.push(current);
                    mode = flags & 2 ? 'polyline' : 'edges';
                    edge = null;
                    expectVertices = 0;
                } else if (!current) {
                    continue;
                } else if (mode === 'polyline') {
                    if (g.code === 97 || g.code === 75 || g.code === 98) mode = null;
                    else if (g.code === 93) expectVertices = num(g.value);
                    else if (g.code === 10) current.vertices.push({ x: num(g.value), y: 0, bulge: 0 });
                    else if (g.code === 20 && current.vertices.length) current.vertices[current.vertices.length - 1].y = num(g.value);
                    else if (g.code === 42 && current.vertices.length) current.vertices[current.vertices.length - 1].bulge = num(g.value);
                } else if (mode === 'edges') {
                    if (g.code === 97 || g.code === 75 || g.code === 98) { edge = null; mode = null; }
                    else if (g.code === 72) { edge = { type: num(g.value) }; current.edges = current.edges ?? []; current.edges.push(edge); }
                    else if (edge) {
                        if (g.code === 10) edge.x1 = num(g.value);
                        else if (g.code === 20) edge.y1 = num(g.value);
                        else if (g.code === 11) edge.x2 = num(g.value);
                        else if (g.code === 21) edge.y2 = num(g.value);
                        else if (g.code === 40) edge.r = num(g.value);
                        else if (g.code === 50) edge.a1 = num(g.value);
                        else if (g.code === 51) edge.a2 = num(g.value);
                        else if (g.code === 73) edge.ccw = num(g.value) === 1;
                    }
                }
                void expectVertices;
            }
            // Converte laços de arestas em polilinhas com bulge (linhas e arcos; elipses/splines ignoradas).
            const converted = loops.map((loop) => {
                if (!loop.edges) return loop.vertices.length >= 2 ? { vertices: loop.vertices } : null;
                const vertices = [];
                loop.edges.forEach((e) => {
                    if (e.type === 1) vertices.push({ x: e.x1, y: e.y1, bulge: 0 });
                    else if (e.type === 2) {
                        // Arco horário (73=0): o DXF grava os ângulos espelhados; o arco real vai de -a1 a -a2 no sentido horário.
                        const a1 = degToRad(e.a1 ?? 0);
                        const a2 = degToRad(e.a2 ?? 360);
                        const ccw = e.ccw !== false;
                        let sweep = a2 - a1;
                        while (sweep <= 0) sweep += Math.PI * 2;
                        while (sweep > Math.PI * 2 + 1e-9) sweep -= Math.PI * 2;
                        const bulge = Math.tan(sweep / 4) * (ccw ? 1 : -1);
                        const sp = ccw ? a1 : -a1;
                        vertices.push({ x: e.x1 + Math.cos(sp) * e.r, y: e.y1 + Math.sin(sp) * e.r, bulge });
                    }
                });
                return vertices.length >= 2 ? { vertices } : null;
            }).filter(Boolean);
            if (converted.length === 0) return null;
            const pattern = HATCH_PATTERNS[name] ? name : solid ? 'SOLID' : 'ANSI31';
            return { ...base, type: 'hatch', loops: converted, pattern, angle: num(first(groups, 52, 45)), spacing: num(first(groups, 41, 1)) * 3, opacity: 0.35 };
        }
        case 'TEXT': {
            const height = num(first(groups, 40, 2.5));
            const text = decodeText(first(groups, 1, ''));
            const halignCode = num(first(groups, 72, 0));
            const valignCode = num(first(groups, 73, 0));

            // Especificação DXF Autodesk para TEXT:
            // Se group 72 ou 73 != 0, o ponto de inserção real da justificativa é (11, 21).
            // Se ambos forem 0, o ponto de inserção é (10, 20).
            let x = num(first(groups, 10));
            let y = num(first(groups, 20));
            const hasAlign = halignCode !== 0 || valignCode !== 0;
            if (hasAlign && first(groups, 11) !== undefined && first(groups, 21) !== undefined) {
                x = num(first(groups, 11));
                y = num(first(groups, 21));
            }

            const halignMap = { 0: 'left', 1: 'center', 2: 'right', 3: 'left', 4: 'center', 5: 'left' };
            const valignMap = { 0: 'baseline', 1: 'bottom', 2: 'middle', 3: 'top' };
            let halign = halignMap[halignCode] ?? 'left';
            let valign = valignMap[valignCode] ?? 'baseline';
            if (halignCode === 4 && valignCode === 0) {
                halign = 'center';
                valign = 'middle';
            }

            const isMulti = text.includes('\n');
            return {
                ...base,
                type: 'text',
                ...(isMulti ? { isMText: true } : {}),
                textStyleName: first(groups, 7, 'STANDARD'),
                position: { x, y },
                height,
                rotation: num(first(groups, 50, 0)),
                text,
                halign,
                valign,
            };
        }
        case 'MTEXT': {
            const height = num(first(groups, 40, 2.5));
            const rawText = all(groups, 3).join('') + (first(groups, 1) ?? '');
            const attach = num(first(groups, 71, 1)); // 1 = Top-Left (padrão MTEXT)
            const boxWidth = num(first(groups, 41, 0));

            const hasCenter = /\\pxqc;/i.test(rawText);
            const hasRight = /\\pxqr;/i.test(rawText);
            const hasLeft = /\\pxql;/i.test(rawText);

            const fontMatch = rawText.match(/\\f([^|;]+)(?:\|b(\d))?(?:\|i(\d))?/i);
            const fontFamily = fontMatch ? fontMatch[1].trim() : undefined;
            const bold = fontMatch ? fontMatch[2] === '1' : undefined;
            const italic = fontMatch ? fontMatch[3] === '1' : undefined;

            const text = decodeText(rawText);

            const halignMap = {
                1: 'left', 2: 'center', 3: 'right',
                4: 'left', 5: 'center', 6: 'right',
                7: 'left', 8: 'center', 9: 'right',
            };
            const valignMap = {
                1: 'top', 2: 'top', 3: 'top',
                4: 'middle', 5: 'middle', 6: 'middle',
                7: 'bottom', 8: 'bottom', 9: 'bottom',
            };
            let halign = halignMap[attach] ?? 'left';
            if (hasCenter) halign = 'center';
            else if (hasRight) halign = 'right';
            else if (hasLeft) halign = 'left';

            const valign = valignMap[attach] ?? 'top';

            let rotation = 0;
            if (first(groups, 11) !== undefined && first(groups, 21) !== undefined) {
                const dx = num(first(groups, 11));
                const dy = num(first(groups, 21));
                if (Math.abs(dx) > 1e-8 || Math.abs(dy) > 1e-8) {
                    rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
                }
            } else if (first(groups, 50) !== undefined) {
                const raw50 = num(first(groups, 50));
                rotation = Math.abs(raw50) > Math.PI * 2 ? raw50 : (raw50 * 180) / Math.PI;
            }

            return {
                ...base,
                type: 'text',
                isMText: true,
                textStyleName: first(groups, 7, 'STANDARD'),
                position: { x: num(first(groups, 10)), y: num(first(groups, 20)) },
                height,
                rotation,
                text,
                attachmentPoint: attach,
                halign,
                valign,
                ...(boxWidth > 0 ? { boxWidth } : {}),
                ...(fontFamily ? { fontFamily } : {}),
                ...(bold !== undefined ? { bold } : {}),
                ...(italic !== undefined ? { italic } : {}),
            };
        }
        case 'POINT': {
            return {
                ...base,
                type: 'point',
                position: { x: num(first(groups, 10, 0)), y: num(first(groups, 20, 0)) },
            };
        }
        default:
            return null;
    }
}

function parseEntitiesSection(cursor, stopAt, preserveDimensions = false) {
    const entities = [];
    let pendingPolyline = null;
    while (!cursor.done()) {
        const p = cursor.next();
        if (p.code !== 0) continue;
        if (p.value === stopAt) break;
        const groups = collectGroup(cursor);
        if (p.value === 'POLYLINE') {
            const flags = num(first(groups, 70, 0));
            pendingPolyline = { type: 'polyline', layer: first(groups, 8, DEFAULT_LAYER), color: entityColor(groups), vertices: [], closed: Boolean(flags & 1) };
            continue;
        }
        if (p.value === 'VERTEX' && pendingPolyline) {
            // Bit 16 = ponto de controle do quadro da spline (PEDIT Spline); só os vértices ajustados (bit 8) formam a curva.
            if (num(first(groups, 70, 0)) & 16) continue;
            pendingPolyline.vertices.push({ x: num(first(groups, 10)), y: num(first(groups, 20)), bulge: num(first(groups, 42, 0)) });
            continue;
        }
        if (p.value === 'SEQEND') {
            if (pendingPolyline) entities.push(pendingPolyline);
            pendingPolyline = null;
            continue;
        }
        if (p.value === 'DIMENSION') {
            if(preserveDimensions){
                const pt=code=>({x:num(first(groups,code)),y:num(first(groups,code+10))});
                const kind=num(first(groups,70,0))&7;
                const lfac=dimStyleOverride(groups,144);
                const measured=first(groups,42);
                const base={type:'dimension',textStyleName:first(groups,3,'STANDARD'),layer:first(groups,8,DEFAULT_LAYER),color:entityColor(groups),linePoint:pt(10),__graphicsBlock:first(groups,2,''),__measured:measured===undefined?undefined:num(measured),...(lfac===undefined?{}:{measurementScale:lfac})};
                const override=first(groups,1);if(override && override!=='<>')base.textOverride=decodeText(override);
                if((kind===0||kind===1) && first(groups,13)!==undefined && first(groups,14)!==undefined){
                    // Código 50 é a direção de medição da cota linear: 0 e 90 são os casos comuns,
                    // qualquer outro ângulo é uma cota rotacionada e mede a projeção nessa direção.
                    const angle=((num(first(groups,50,0))%180)+180)%180;
                    const straight=Math.abs(angle)<1e-6||Math.abs(angle-180)<1e-6;
                    const upright=Math.abs(angle-90)<1e-6;
                    const rotated=kind===0&&!straight&&!upright;
                    entities.push({...base,kind:kind===1?'aligned':rotated?'rotated':upright?'vertical':'horizontal',...(rotated?{rotation:angle}:{}),p1:pt(13),p2:pt(14)});continue;
                }
                if((kind===3||kind===4) && first(groups,15)!==undefined){
                    const a=pt(10),b=pt(15),center=kind===3?{x:(a.x+b.x)/2,y:(a.y+b.y)/2}:a;
                    const radius=Math.hypot(b.x-center.x,b.y-center.y);
                    entities.push({...base,kind:kind===3?'diameter':'radius',center,radius,linePoint:first(groups,11)!==undefined?pt(11):b});continue;
                }
                if(kind===5 && first(groups,15)!==undefined){entities.push({...base,kind:'angular',vertex:pt(15),p1:pt(13),p2:pt(14)});continue;}
            }

            // Cota associativa importada pela geometria do bloco anônimo (não associativa no Traço).
            const blockName = first(groups, 2, '');
            if (blockName) entities.push({ type: '__insert', name: blockName, position: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotation: 0, layer: first(groups, 8, DEFAULT_LAYER) });
            continue;
        }
        if (p.value === 'INSERT') {
            entities.push({ type: '__insert', name: first(groups, 2, ''), position: { x: num(first(groups, 10)), y: num(first(groups, 20)) }, scaleX: num(first(groups, 41, 1)), scaleY: num(first(groups, 42, 1)), rotation: num(first(groups, 50, 0)), layer: first(groups, 8, DEFAULT_LAYER) });
            continue;
        }
        if (preserveDimensions) {
            const annotation = parseAnnotation(p.value, groups);
            if (annotation) {
                entities.push(...annotation);
                continue;
            }
        }
        const entity = parseEntity(p.value, groups);
        if (entity) entities.push(entity);
    }
    return entities;
}

// Comprimento desenhado de XLINE/RAY; a entidade guarda o tipo e volta infinita no DXF.
export const CONSTRUCTION_LINE_LENGTH = 100000;

/**
 * Anotações e entidades de desenho técnico que só o CAD importa (programas de corte
 * e dobra leem o mesmo DXF para corte e não devem receber setas, textos ou linhas infinitas).
 * Devolve lista de entidades nativas ou null quando o tipo não é anotação.
 */
function parseAnnotation(type, groups) {
    const layer = first(groups, 8, DEFAULT_LAYER);
    const colorRaw = first(groups, 62);
    const base = { layer, color: colorRaw === undefined || Number(colorRaw) === 256 ? BYLAYER : Number(colorRaw) };
    switch (type) {
        case 'LEADER': {
            // Linha de chamada clássica: o texto é um MTEXT separado (código 340), já importado por conta própria.
            // Fica como marcador até o fim do parse, quando o DIMSTYLE (DIMASZ × DIMSCALE) é conhecido para a seta.
            const xs = all(groups, 10).map(num);
            const ys = all(groups, 20).map(num);
            const vertices = xs.map((x, i) => ({ x, y: ys[i] ?? 0, bulge: 0 }));
            if (vertices.length < 2) return [];
            return [{
                ...base,
                type: '__leader',
                vertices,
                arrow: num(first(groups, 71, 1)) !== 0,
                dimStyleName: first(groups, 3, 'STANDARD'),
                arrowSize: dimStyleOverride(groups, 41),
                scale: dimStyleOverride(groups, 40),
            }];
        }
        case 'MULTILEADER':
            return parseMultiLeader(base, groups);
        case 'ATTRIB': {
            if (num(first(groups, 70, 0)) & 1) return []; // invisível
            const text = parseEntity('TEXT', groups);
            if (!text || !text.text) return [];
            // ATTRIB usa 74 (e não 73) para o alinhamento vertical.
            const valign = { 1: 'bottom', 2: 'middle', 3: 'top' }[num(first(groups, 74, 0))];
            return [{ ...text, ...(valign ? { valign } : {}), attributeTag: first(groups, 2, '') }];
        }
        case 'ACAD_TABLE': {
            // A geometria da tabela vem pronta no bloco anônimo (*T…) que ela referencia.
            const name = first(groups, 2, '');
            if (!name) return [];
            return [{ type: '__insert', name, position: { x: num(first(groups, 10)), y: num(first(groups, 20)) }, scaleX: 1, scaleY: 1, rotation: 0, layer }];
        }
        case 'XLINE':
        case 'RAY': {
            const origin = { x: num(first(groups, 10)), y: num(first(groups, 20)) };
            let dx = num(first(groups, 11, 1));
            let dy = num(first(groups, 21, 0));
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            const L = CONSTRUCTION_LINE_LENGTH;
            const start = type === 'RAY' ? origin : { x: origin.x - dx * L, y: origin.y - dy * L };
            return [{
                ...base,
                type: 'line',
                start,
                end: { x: origin.x + dx * L, y: origin.y + dy * L },
                construction: type === 'RAY' ? 'ray' : 'xline',
                point: origin,
                basePoint: origin,
                unitVector: { x: dx, y: dy },
            }];
        }
        default:
            return null;
    }
}

function arrowHead(base, tip, from, size) {
    const len = Math.hypot(from.x - tip.x, from.y - tip.y) || 1;
    const ux = (from.x - tip.x) / len;
    const uy = (from.y - tip.y) / len;
    const back = { x: tip.x + ux * size, y: tip.y + uy * size };
    const half = size / 6;
    const vertices = [tip, { x: back.x - uy * half, y: back.y + ux * half }, { x: back.x + uy * half, y: back.y - ux * half }];
    return { ...base, type: 'hatch', pattern: 'SOLID', angle: 0, spacing: 1, opacity: 1, loops: [{ vertices: vertices.map((v) => ({ ...v, bulge: 0 })) }] };
}

/**
 * MULTILEADER: percorre os blocos CONTEXT_DATA{ / LEADER{ / LEADER_LINE{ em ordem,
 * porque os mesmos códigos (10, 40, 41…) mudam de sentido em cada nível.
 */
function parseMultiLeader(base, groups) {
    const out = [];
    let depth = 0;
    let text = null;
    let textPos = null;
    let textHeight = 2.5;
    let arrowSize = 2.5;
    let scale = 1;
    let leader = null;
    let line = null;
    const leaders = [];
    for (let i = 0; i < groups.length; i += 1) {
        const { code, value } = groups[i];
        const next = groups[i + 1];
        if (code === 300 && value === 'CONTEXT_DATA{') { depth = 1; continue; }
        if (code === 302 && value === 'LEADER{') { depth = 2; leader = { lines: [], landing: null, dogleg: null, doglegLength: 0 }; leaders.push(leader); continue; }
        if (code === 304 && value === 'LEADER_LINE{') { depth = 3; line = []; leader?.lines.push(line); continue; }
        if (code === 305 && depth === 3) { depth = 2; line = null; continue; }
        if (code === 303 && depth === 2) { depth = 1; leader = null; continue; }
        if (code === 301 && depth === 1) { depth = 0; continue; }
        if (depth === 1) {
            if (code === 40) scale = num(value) || 1;
            else if (code === 41) textHeight = num(value);
            else if (code === 140) arrowSize = num(value);
            else if (code === 304) text = decodeText(value);
            else if (code === 12 && next?.code === 22) textPos = { x: num(value), y: num(next.value) };
        } else if (depth === 2 && leader) {
            if (code === 10 && next?.code === 20) leader.landing = { x: num(value), y: num(next.value) };
            else if (code === 11 && next?.code === 21) leader.dogleg = { x: num(value), y: num(next.value) };
            else if (code === 40) leader.doglegLength = num(value);
        } else if (depth === 3 && line && code === 10 && next?.code === 20) {
            line.push({ x: num(value), y: num(next.value) });
        }
    }
    for (const l of leaders) {
        const tail = [];
        if (l.landing) tail.push(l.landing);
        if (l.landing && l.dogleg && l.doglegLength > 0) {
            tail.push({ x: l.landing.x + l.dogleg.x * l.doglegLength, y: l.landing.y + l.dogleg.y * l.doglegLength });
        }
        for (const pts of l.lines) {
            const vertices = [...pts, ...tail];
            if (vertices.length < 2) continue;
            out.push({ ...base, type: 'polyline', closed: false, vertices: vertices.map((v) => ({ ...v, bulge: 0 })) });
            out.push(arrowHead(base, vertices[0], vertices[1], arrowSize * scale));
        }
    }
    if (text && textPos) {
        out.push({ ...base, type: 'text', isMText: text.includes('\n'), position: textPos, height: textHeight * scale, rotation: 0, text, halign: 'left', valign: 'top' });
    }
    return out;
}

function parseBlocks(cursor, preserveDimensions = false) {
    const blocks = new Map();
    while (!cursor.done()) {
        const p = cursor.next();
        if (p.code !== 0) continue;
        if (p.value === 'ENDSEC') break;
        if (p.value !== 'BLOCK') continue;
        const groups = collectGroup(cursor);
        const name = first(groups, 2, '');
        const basePoint = { x: num(first(groups, 10)), y: num(first(groups, 20)) };
        const entities = parseEntitiesSection(cursor, 'ENDBLK', preserveDimensions);
        collectGroup(cursor);
        if (!name || /^\*(?:Model_Space|Paper_Space)/i.test(name)) continue;
        blocks.set(name, { basePoint, entities });
    }
    return blocks;
}

function parseTables(cursor) {
    const layers = [];
    layers.textStyles={};
    layers.dimStyles={};
    layers.textStyleHandles={};
    while (!cursor.done()) {
        const p = cursor.next();
        if (p.code !== 0) continue;
        if (p.value === 'ENDSEC') break;
        if(p.value==='STYLE'){
            const g=collectGroup(cursor),name=first(g,2),family=first(g,1000),flags=num(first(g,1071,0));
            const file=String(first(g,3,'')).toLowerCase();
            // Arquivos TrueType do Windows: timesbd.ttf, arialbi.ttf, couri.ttf...
            const winStyle=/^(?:arial|times|cour)(bd|bi|i)\.ttf$/.exec(file)?.[1];
            const inferred=family??(file.includes('arial')?'Arial':file.includes('times')?'Times New Roman':file.includes('cour')?'Courier New':file.includes('serif')?'Liberation Serif':file.includes('mono')?'Liberation Mono':'Liberation Sans');
            layers.textStyles[name]={fontFamily:FONT_FAMILIES.includes(inferred)?inferred:'Liberation Sans',bold:Boolean(flags&0x2000000)||file.includes('bold')||winStyle==='bd'||winStyle==='bi',italic:Boolean(flags&0x1000000)||file.includes('italic')||winStyle==='i'||winStyle==='bi'};layers.textStyleHandles[first(g,5)]=layers.textStyles[name];continue;
        }
        if(p.value==='DIMSTYLE'){
            const g=collectGroup(cursor);const lfac=first(g,144);layers.dimStyles[first(g,2)]={scale:num(first(g,40,1)),arrowSize:num(first(g,41,2.5)),textHeight:num(first(g,140,2.5)),textGap:num(first(g,147,0.9)),extOffset:num(first(g,42,0.625)),extBeyond:num(first(g,44,1.25)),precision:num(first(g,271,2)),fontHandle:first(g,340),...(lfac===undefined?{}:{measurementScale:num(lfac)})};continue;
        }
        if (p.value === 'VPORT') {
            const g = collectGroup(cursor);
            const name = first(g, 2);
            if (name && name.toUpperCase() === '*ACTIVE') {
                const cx = first(g, 12);
                const cy = first(g, 22);
                const h = first(g, 40);
                const aspect = first(g, 41);
                if (cx !== undefined && cy !== undefined && h !== undefined && num(h) > 0) {
                    layers.vportActive = {
                        center: { x: num(cx), y: num(cy) },
                        height: num(h),
                        aspectRatio: aspect !== undefined && num(aspect) > 0 ? num(aspect) : 1,
                    };
                }
            }
            continue;
        }
        if (p.value !== 'LAYER') continue;
        const groups = collectGroup(cursor);
        const name = first(groups, 2);
        if (!name) continue;
        const color = num(first(groups, 62, 7));
        const flags = num(first(groups, 70, 0));
        const trueColor = first(groups, 420);
        const lineWeight = num(first(groups, 370, 0));
        const hex = trueColor !== undefined ? `#${(num(trueColor) & 0xffffff).toString(16).padStart(6, '0')}` : null;
        layers.push(createLayer(name, { color: hex ?? (Math.abs(color) || 7), visible: color >= 0, locked: Boolean(flags & 4), lineType: String(first(groups, 6, 'CONTINUOUS')).toUpperCase(), lineWeight: lineWeight > 0 ? lineWeight : 0 }));
    }
    return layers;
}

function transformBlockEntity(entity, insert, block) {
    const rot = degToRad(insert.rotation);
    const fn = (p) => {
        const local = { x: (p.x - block.basePoint.x) * insert.scaleX, y: (p.y - block.basePoint.y) * insert.scaleY };
        const rotated = rotatePoint(local, { x: 0, y: 0 }, rot);
        return add(rotated, insert.position);
    };
    const uniform = Math.abs(Math.abs(insert.scaleX) - Math.abs(insert.scaleY)) < 1e-9;
    const factor = Math.abs(insert.scaleX);
    const e = { ...entity, layer: entity.layer === DEFAULT_LAYER ? insert.layer : entity.layer };
    switch (entity.type) {
        case 'line':
            return { ...e, start: fn(entity.start), end: fn(entity.end) };
        case 'circle':
            return { ...e, center: fn(entity.center), radius: entity.radius * factor };
        case 'arc': {
            const mirrored = insert.scaleX * insert.scaleY < 0;
            let start = entity.start + rot;
            let end = entity.end + rot;
            if (mirrored) {
                start = Math.PI - entity.end + rot;
                end = Math.PI - entity.start + rot;
            }
            return { ...e, center: fn(entity.center), radius: entity.radius * factor, start: normalizeAngle(start), end: normalizeAngle(end) };
        }
        case 'polyline':
            return { ...e, vertices: entity.vertices.map((v) => ({ ...fn(v), bulge: uniform ? (insert.scaleX * insert.scaleY < 0 ? -v.bulge : v.bulge) : 0 })) };
        case 'spline': {
            const transformed = { ...e };
            if (entity.controlPoints) transformed.controlPoints = entity.controlPoints.map(fn);
            if (entity.fitPoints) transformed.fitPoints = entity.fitPoints.map(fn);
            return transformed;
        }
        case 'ellipse': {
            const center = fn(entity.center);
            const majorEnd = fn(add(entity.center, entity.major));
            const minorEnd = fn(add(entity.center, scale(perpendicular(entity.major), entity.ratio)));
            const major = sub(majorEnd, center);
            const majorLen = Math.hypot(major.x, major.y);
            const minorLen = distance(minorEnd, center);
            return { ...e, center, major, ratio: majorLen > 0 ? minorLen / majorLen : entity.ratio };
        }
        case 'text':
            return { ...e, position: fn(entity.position), height: entity.height * factor, rotation: entity.rotation + insert.rotation };
        default:
            return null;
    }
}

function flattenInserts(entities, blocks, depth = 0) {
    const out = [];
    entities.forEach((entity) => {
        if (entity.type !== '__insert') {
            out.push(entity);
            return;
        }
        const block = blocks.get(entity.name);
        if (!block || depth > 8) return;
        const nested = flattenInserts(block.entities, blocks, depth + 1);
        nested.forEach((child) => {
            const t = transformBlockEntity(child, entity, block);
            if (t) out.push(t);
        });
    });
    return out;
}

/** Valor numérico do texto já renderizado pelo CAD de origem, ignorando prefixo/sufixo (Ø, R, mm) e decimal por vírgula. */
function numericTextValue(text) {
    const match = String(text ?? '').replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return undefined;
    const value = Number(match[0].replace(',', '.'));
    return Number.isFinite(value) ? value : undefined;
}

/**
 * Resolve o fator linear da cota (DIMLFAC) na ordem override da entidade > DIMSTYLE > $DIMLFAC do cabeçalho
 * e, quando o arquivo não declara fator algum, adota o texto do bloco anônimo da cota se ele divergir da medida.
 * Desenhos de vista em escala (SolidWorks 1:20, por exemplo) trazem a geometria reduzida e o valor real na anotação.
 */
function resolveMeasurementScale(header, dimStyles, blocks) {
    const headerFactor = Number.isFinite(header.dimlfac) && header.dimlfac !== 0 ? header.dimlfac : undefined;
    const blockText = (name) => {
        const block = name ? blocks.get(name) : null;
        if (!block) return undefined;
        const text = block.entities.find((e) => (e.type === 'text' || e.type === 'mtext') && String(e.text ?? '').trim() !== '');
        return text ? String(text.text) : undefined;
    };
    return (entity) => {
        if (entity.type !== 'dimension') return entity;
        const { __graphicsBlock: graphics, __measured: stated, ...dimension } = entity;
        const styleFactor = dimStyles[entity.textStyleName]?.measurementScale;
        const factor = [entity.measurementScale, styleFactor, headerFactor].find((f) => Number.isFinite(f) && f !== 0);
        const scaled = factor === undefined || factor === 1 ? dimension : { ...dimension, measurementScale: factor };
        if (scaled.textOverride !== undefined) return scaled;
        // Rede de segurança: o arquivo diz quanto a cota mede (código 42) e o bloco anônimo diz como ela
        // aparecia. Se a medição recalculada discordar, o desenho de origem ganha — nunca mostrar um número
        // inventado por um construto que o Traço ainda não modela.
        const shownText = blockText(graphics);
        const shown = numericTextValue(shownText);
        const source = Number.isFinite(stated) && stated > 0 ? stated : shown;
        if (source === undefined) return scaled;
        const geometry = dimensionGeometry(scaled, scaled.style ?? {});
        const computed = geometry.measurement * (factor ?? 1);
        if (!Number.isFinite(computed) || Math.abs(source - computed) <= Math.max(1e-6, Math.abs(source) * 1e-4)) return scaled;
        return { ...scaled, textOverride: shownText ?? formatMeasurement(source, scaled.style ?? {}) };
    };
}

function resolveLeader(entity, dimStyles = {}) {
    if (entity.type !== '__leader') return [entity];
    const { vertices, arrow, dimStyleName, arrowSize, scale, ...base } = entity;
    const out = [{ ...base, type: 'polyline', vertices, closed: false }];
    const style = dimStyles[dimStyleName] ?? dimStyles.STANDARD ?? {};
    const factor = (scale ?? style.scale ?? 1) || 1;
    const size = (arrowSize ?? style.arrowSize ?? 2.5) * factor;
    const [tip, next] = vertices;
    const len = Math.hypot(next.x - tip.x, next.y - tip.y);
    // Seta cheia padrão do AutoCAD (comprimento DIMASZ, largura DIMASZ/3), igual à do MULTILEADER.
    if (arrow && size > 0 && len > 1e-9) out.push(arrowHead(base, tip, next, size));
    return out;
}

export function parseDxf(text, { preserveBlocks = false, preserveDimensions = false } = {}) {
    const cursor = new Cursor(readPairs(text));
    let layers = [];
    let blocks = new Map();
    let entities = [];
    const header = {};
    while (!cursor.done()) {
        const p = cursor.next();
        if (p.code !== 0 || p.value !== 'SECTION') continue;
        const nameGroup = cursor.next();
        const section = nameGroup?.value;
        if (section === 'HEADER') {
            let key = null;
            while (!cursor.done()) {
                const g = cursor.peek();
                if (g.code === 0 && g.value === 'ENDSEC') { cursor.next(); break; }
                cursor.next();
                if (g.code === 9) key = g.value;
                else if (key === '$INSUNITS' && g.code === 70) header.insunits = num(g.value);
                else if (key === '$DIMLFAC' && g.code === 40) header.dimlfac = num(g.value);
                else if (key === '$VIEWCTR' && g.code === 10) header.viewCtrX = num(g.value);
                else if (key === '$VIEWCTR' && g.code === 20) header.viewCtrY = num(g.value);
                else if (key === '$VIEWSIZE' && g.code === 40) header.viewSize = num(g.value);
            }
            if (header.viewCtrX !== undefined && header.viewCtrY !== undefined && Number.isFinite(header.viewSize) && header.viewSize > 0) {
                header.view = {
                    center: { x: header.viewCtrX, y: header.viewCtrY },
                    height: header.viewSize,
                };
            }
        } else if (section === 'TABLES') layers = parseTables(cursor);
        else if (section === 'BLOCKS') blocks = parseBlocks(cursor, preserveDimensions);
        else if (section === 'ENTITIES') entities = parseEntitiesSection(cursor, 'ENDSEC', preserveDimensions);
    }
    const styles=layers.textStyles??{};
    const applyStyles=items=>items.map(e=>{
        const ds=e.type==='dimension'?layers.dimStyles?.[e.textStyleName]:null;
        return {...e,...(styles[e.textStyleName]??(ds?layers.textStyleHandles?.[ds.fontHandle]:{})??{}),...(ds?{style:ds}:{})};
    });
    entities=applyStyles(entities);
    for(const b of blocks.values())b.entities=applyStyles(b.entities);
    entities=entities.flatMap(e=>resolveLeader(e,layers.dimStyles));
    for(const b of blocks.values())b.entities=b.entities.flatMap(e=>resolveLeader(e,layers.dimStyles));
    const resolveMeasurement=resolveMeasurementScale(header,layers.dimStyles??{},blocks);
    entities=entities.map(resolveMeasurement);
    for(const b of blocks.values())b.entities=b.entities.map(resolveMeasurement);
    const blockDefinitions=Object.fromEntries(blocks);
    if(preserveBlocks) entities=entities.map(e=>e.type==='__insert'?hydrateInsert(e,blockDefinitions):e);
    else entities = flattenInserts(entities, blocks);
    const references=new Set([...entities,...Object.values(blockDefinitions).flatMap(b=>b.entities)].filter(e=>e.type==='insert'||e.type==='__insert').map(e=>e.name));
    for(const name of Object.keys(blockDefinitions))if(name.startsWith('*DTRACO')&&!references.has(name))delete blockDefinitions[name];
    const layerNames = new Set(layers.map((l) => l.name));
    entities.forEach((e) => {
        if (!layerNames.has(e.layer)) {
            layers.push(createLayer(e.layer));
            layerNames.add(e.layer);
        }
    });
    if (!layerNames.has(DEFAULT_LAYER)) layers.unshift(createLayer(DEFAULT_LAYER));

    let resolvedView = null;
    if (header.view) {
        resolvedView = {
            ...header.view,
            aspectRatio: layers.vportActive?.aspectRatio ?? 1,
        };
    } else if (layers.vportActive) {
        const isDefaultDummy = layers.vportActive.center.x === 0 && layers.vportActive.center.y === 0 && Math.abs(layers.vportActive.height - 100) < 1e-4;
        if (!isDefaultDummy || entities.length === 0) {
            resolvedView = layers.vportActive;
        }
    }

    return {
        layers,
        entities,
        blocks: preserveBlocks ? blockDefinitions : {},
        units: header.insunits === 1 ? 'in' : 'mm',
        ...(resolvedView ? { view: resolvedView } : {}),
    };
}

// ---------------------------------------------------------------------------
// Writer (AC1015 / R2000, ASCII)

function pair(code, value) {
    let clean = value;
    if (typeof clean === 'string' && /[\r\n]/.test(clean)) {
        clean = clean.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
    }
    return `${code}\n${clean}\n`;
}

function fmt(n) {
    if (!Number.isFinite(n)) return '0';
    const s = Number(n).toFixed(6);
    return s.replace(/\.?0+$/, '') || '0';
}

function encodeText(text) {
    return String(text ?? '').replace(/Ø/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p');
}

function encodeSingleLineText(text) {
    return encodeText(text)
        .replace(/\r\n/g, ' ')
        .replace(/[\r\n]/g, ' ')
        .trim();
}

function encodeMText(text) {
    return encodeText(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '\\P');
}

let handle = 0x100;
function nextHandle() {
    handle += 1;
    return handle.toString(16).toUpperCase();
}

function entityHeader(type, entity, subclass) {
    let out = pair(0, type) + pair(5, nextHandle()) + pair(100, 'AcDbEntity') + pair(8, entity.layer ?? DEFAULT_LAYER);
    if (entity.color !== undefined && entity.color !== BYLAYER) {
        if (typeof entity.color === 'number') out += pair(62, entity.color);
        else out += pair(62, 7) + pair(420, parseInt(String(entity.color).replace('#', ''), 16) || 0);
    }
    if (entity.lineType && entity.lineType !== 'bylayer') out += pair(6, String(entity.lineType).toUpperCase());
    if (entity.lineWeight) out += pair(370, entity.lineWeight);
    if (subclass) out += pair(100, subclass);
    return out;
}

function writeDimensionGraphics(entity, dimStyle) {
    // Exportada explodida (linhas, setas como SOLID e TEXT) para renderizar em qualquer leitor.
    const g = dimensionGeometry(entity, dimStyle);
    const base = { layer: entity.layer, color: entity.color };
    let out = '';
    g.segments.forEach((seg) => {
        out += writeEntity({ ...base, type: 'line', start: seg.a, end: seg.b });
    });
    if (g.arcs) {
        g.arcs.forEach((arc) => {
            out += writeEntity({
                ...base,
                type: 'arc',
                center: arc.center,
                radius: arc.radius,
                start: arc.startAngle,
                end: arc.endAngle,
            });
        });
    }
    g.arrows.forEach((tri) => {
        out += entityHeader('SOLID', base, 'AcDbTrace')
            + pair(10, fmt(tri[0].x)) + pair(20, fmt(tri[0].y)) + pair(30, 0)
            + pair(11, fmt(tri[1].x)) + pair(21, fmt(tri[1].y)) + pair(31, 0)
            + pair(12, fmt(tri[2].x)) + pair(22, fmt(tri[2].y)) + pair(32, 0)
            + pair(13, fmt(tri[2].x)) + pair(23, fmt(tri[2].y)) + pair(33, 0);
    });
    g.texts.forEach((t) => {
        out += writeEntity({ ...base, type: 'text', position: t.position, height: t.height, rotation: t.rotation, text: t.text });
    });
    return out;
}

let dimensionBlocks=new Map();
let outputStyles=new Map();
let outputDimensionStyles=new Map();
const styleKey=e=>`${e?.fontFamily??'Liberation Sans'}|${e?.bold?1:0}|${e?.italic?1:0}`;
const styleName=e=>outputStyles.get(styleKey(e))?.name??'STANDARD';
function writeDimension(entity,dimStyle){
    if(entity.kind==='leader')return writeDimensionGraphics(entity,dimStyle);
    const name=dimensionBlocks.get(entity);
    if(!name)return writeDimensionGraphics(entity,dimStyle);
    const pt=(code,p)=>pair(code,fmt(p.x))+pair(code+10,fmt(p.y))+pair(code+20,0);
    const code={horizontal:0,vertical:0,rotated:0,aligned:1,diameter:3,radius:4,angular:5}[entity.kind]??1;
    let point=entity.linePoint;
    if(code===4)point=entity.center;
    if(code===3)point={x:entity.center.x-entity.radius,y:entity.center.y};
    let out=entityHeader('DIMENSION',entity,'AcDbDimension')+pair(2,name)+pt(10,point)+pt(11,entity.linePoint)+pair(70,32+code)+pair(1,encodeText(entity.textOverride??'<>'))+pair(3,outputDimensionStyles.get(entity)?.name??styleName({...dimStyle,...entity.style,...entity}));
    if(code===0||code===1){out+=pair(100,'AcDbAlignedDimension')+pt(13,entity.p1)+pt(14,entity.p2);if(code===0)out+=pair(100,'AcDbRotatedDimension')+pair(50,entity.kind==='vertical'?90:entity.kind==='rotated'?fmt(entity.rotation??0):0);}
    if(code===3||code===4)out+=pair(100,code===3?'AcDbDiametricDimension':'AcDbRadialDimension')+pt(15,{x:entity.center.x+entity.radius,y:entity.center.y})+pair(40,0);
    if(code===5)out+=pair(100,'AcDb3PointAngularDimension')+pt(13,entity.p1)+pt(14,entity.p2)+pt(15,entity.vertex??entity.center);
    return out;
}
function writeBlock(name,definition,dimStyle,graphics=null){
    return entityHeader('BLOCK',{layer:'0'},'AcDbBlockBegin')+pair(2,name)+pair(70,name.startsWith('*')?1:0)+pair(10,fmt(definition.basePoint.x))+pair(20,fmt(definition.basePoint.y))+pair(30,0)+pair(3,name)+pair(1,'')+(graphics??definition.entities.map(e=>writeEntity(e,dimStyle)).join(''))+entityHeader('ENDBLK',{layer:'0'},'AcDbBlockEnd');
}

function writeEntity(entity, dimStyle) {
    switch (entity.type) {
        case '__insert':
        case 'insert': return entityHeader('INSERT',entity,'AcDbBlockReference')+pair(2,entity.name)+pair(10,fmt(entity.position.x))+pair(20,fmt(entity.position.y))+pair(30,0)+pair(41,fmt(entity.scaleX??1))+pair(42,fmt(entity.scaleY??1))+pair(43,1)+pair(50,fmt(entity.rotation??0));
        case 'dimension':
            return writeDimension(entity, dimStyle);
        case 'line':
            if (entity.construction === 'xline' || entity.construction === 'ray') {
                // Volta como linha infinita; a origem é o ponto base (XLINE/RAY), início (RAY) ou o ponto médio.
                const dx = entity.end.x - entity.start.x;
                const dy = entity.end.y - entity.start.y;
                const len = Math.hypot(dx, dy) || 1;
                const origin = entity.construction === 'ray'
                    ? (entity.point ?? entity.basePoint ?? entity.start)
                    : (entity.point ?? entity.basePoint ?? { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 });
                const kind = entity.construction === 'ray' ? 'RAY' : 'XLINE';
                return entityHeader(kind, entity, kind === 'RAY' ? 'AcDbRay' : 'AcDbXline') + pair(10, fmt(origin.x)) + pair(20, fmt(origin.y)) + pair(30, 0) + pair(11, fmt(dx / len)) + pair(21, fmt(dy / len)) + pair(31, 0);
            }
            return entityHeader('LINE', entity, 'AcDbLine') + pair(10, fmt(entity.start.x)) + pair(20, fmt(entity.start.y)) + pair(30, 0) + pair(11, fmt(entity.end.x)) + pair(21, fmt(entity.end.y)) + pair(31, 0);
        case 'xline':
        case 'ray': {
            const kind = entity.type === 'ray' || entity.construction === 'ray' ? 'RAY' : 'XLINE';
            let dx, dy, origin;
            if (entity.unitVector) {
                dx = entity.unitVector.x;
                dy = entity.unitVector.y;
                origin = entity.point ?? entity.basePoint ?? entity.start ?? { x: 0, y: 0 };
            } else if (entity.start && entity.end) {
                dx = entity.end.x - entity.start.x;
                dy = entity.end.y - entity.start.y;
                origin = kind === 'RAY' ? entity.start : (entity.point ?? entity.basePoint ?? { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 });
            } else {
                dx = 1; dy = 0;
                origin = entity.point ?? entity.basePoint ?? { x: 0, y: 0 };
            }
            const len = Math.hypot(dx, dy) || 1;
            return entityHeader(kind, entity, kind === 'RAY' ? 'AcDbRay' : 'AcDbXline') + pair(10, fmt(origin.x)) + pair(20, fmt(origin.y)) + pair(30, 0) + pair(11, fmt(dx / len)) + pair(21, fmt(dy / len)) + pair(31, 0);
        }
        case 'circle':
            return entityHeader('CIRCLE', entity, 'AcDbCircle') + pair(10, fmt(entity.center.x)) + pair(20, fmt(entity.center.y)) + pair(30, 0) + pair(40, fmt(entity.radius));
        case 'arc':
            return entityHeader('ARC', entity, 'AcDbCircle') + pair(10, fmt(entity.center.x)) + pair(20, fmt(entity.center.y)) + pair(30, 0) + pair(40, fmt(entity.radius)) + pair(100, 'AcDbArc') + pair(50, fmt(radToDeg(entity.start))) + pair(51, fmt(radToDeg(entity.end)));
        case 'polyline': {
            let out = entityHeader('LWPOLYLINE', entity, 'AcDbPolyline') + pair(90, entity.vertices.length) + pair(70, entity.closed ? 1 : 0) + (entity.constantWidth > 0 ? pair(43, fmt(entity.constantWidth)) : '');
            entity.vertices.forEach((v) => {
                out += pair(10, fmt(v.x)) + pair(20, fmt(v.y));
                if (v.bulge) out += pair(42, fmt(v.bulge));
            });
            return out;
        }
        case 'point':
            return entityHeader('POINT', entity, 'AcDbPoint') + pair(10, fmt(entity.position.x)) + pair(20, fmt(entity.position.y)) + pair(30, 0);
        case 'ellipse':
            return entityHeader('ELLIPSE', entity, 'AcDbEllipse') + pair(10, fmt(entity.center.x)) + pair(20, fmt(entity.center.y)) + pair(30, 0) + pair(11, fmt(entity.major.x)) + pair(21, fmt(entity.major.y)) + pair(31, 0) + pair(40, fmt(entity.ratio)) + pair(41, fmt(entity.start ?? 0)) + pair(42, fmt(entity.end ?? Math.PI * 2));
        case 'spline': {
            const cps = entity.controlPoints ?? [];
            const knots = entity.knots ?? [];
            const fits = entity.fitPoints ?? [];
            let out = entityHeader('SPLINE', entity, 'AcDbSpline') + pair(70, (entity.closed ? 1 : 0) | (entity.periodic ? 2 : 0) | 8) + pair(71, entity.degree ?? 3) + pair(72, knots.length) + pair(73, cps.length) + pair(74, fits.length);
            knots.forEach((k) => { out += pair(40, fmt(k)); });
            cps.forEach((c) => { out += pair(10, fmt(c.x)) + pair(20, fmt(c.y)) + pair(30, 0); });
            fits.forEach((c) => { out += pair(11, fmt(c.x)) + pair(21, fmt(c.y)) + pair(31, 0); });
            return out;
        }
        case 'image':
            return '';
        case 'hatch': {
            const solid = entity.pattern === 'SOLID';
            const pattern = HATCH_PATTERNS[entity.pattern] ?? HATCH_PATTERNS.ANSI31;
            let out = entityHeader('HATCH', entity, 'AcDbHatch') + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(210, 0) + pair(220, 0) + pair(230, 1)
                + pair(2, solid ? 'SOLID' : entity.pattern) + pair(70, solid ? 1 : 0) + pair(71, 0) + pair(91, entity.loops.length);
            entity.loops.forEach((loop) => {
                out += pair(92, 3) + pair(72, loop.vertices.some((v) => v.bulge) ? 1 : 0) + pair(73, 1) + pair(93, loop.vertices.length);
                loop.vertices.forEach((v) => {
                    out += pair(10, fmt(v.x)) + pair(20, fmt(v.y));
                    if (loop.vertices.some((q) => q.bulge)) out += pair(42, fmt(v.bulge ?? 0));
                });
                out += pair(97, 0);
            });
            out += pair(75, 0) + pair(76, 1);
            if (!solid) {
                const spacing = entity.spacing ?? 3;
                out += pair(52, fmt(entity.angle ?? 45)) + pair(41, fmt(spacing / 3)) + pair(77, pattern.lines.length > 1 ? 1 : 0) + pair(78, pattern.lines.length);
                pattern.lines.forEach((line) => {
                    const a = degToRad((entity.angle ?? 45) + line.angle);
                    out += pair(53, fmt((entity.angle ?? 45) + line.angle)) + pair(43, 0) + pair(44, 0) + pair(45, fmt(-Math.sin(a) * spacing)) + pair(46, fmt(Math.cos(a) * spacing)) + pair(79, 0);
                });
            }
            out += pair(98, 0);
            return out;
        }
        case 'text': {
            const rawText = String(entity.text ?? '');
            const hasNewlines = /[\r\n]/.test(rawText.trim());
            const isMText = Boolean(entity.isMText || (entity.boxWidth && entity.boxWidth > 0) || hasNewlines);

            if (isMText) {
                const attachMap = {
                    'top-left': 1, 'top-center': 2, 'top-right': 3,
                    'middle-left': 4, 'middle-center': 5, 'middle-right': 6,
                    'bottom-left': 7, 'bottom-center': 8, 'bottom-right': 9,
                    'baseline-left': 7, 'baseline-center': 8, 'baseline-right': 9,
                };
                const key = `${entity.valign || 'top'}-${entity.halign || 'left'}`;
                const attach = entity.attachmentPoint || attachMap[key] || 1;
                const prefix = entity.halign === 'center' ? '\\pxqc;' : (entity.halign === 'right' ? '\\pxqr;' : '');
                const encoded = prefix + encodeMText(rawText);
                let out = entityHeader('MTEXT', entity, 'AcDbMText')
                    + pair(10, fmt(entity.position.x))
                    + pair(20, fmt(entity.position.y))
                    + pair(30, 0)
                    + pair(40, fmt(entity.height))
                    + (entity.boxWidth && entity.boxWidth > 0 ? pair(41, fmt(entity.boxWidth)) : '')
                    + pair(71, attach)
                    + pair(72, 5)
                    + pair(1, encoded)
                    + pair(7, styleName(entity))
                    + pair(50, fmt(entity.rotation ?? 0));
                return out;
            }
            const halignMap = { left: 0, center: 1, right: 2, aligned: 3, middle: 4, fit: 5 };
            const valignMap = { baseline: 0, bottom: 1, middle: 2, top: 3 };
            const h = halignMap[entity.halign] ?? 0;
            const v = valignMap[entity.valign] ?? 0;
            let out = entityHeader('TEXT', entity, 'AcDbText')
                + pair(10, fmt(entity.position.x))
                + pair(20, fmt(entity.position.y))
                + pair(30, 0)
                + pair(40, fmt(entity.height))
                + pair(1, encodeSingleLineText(rawText))
                + pair(7, styleName(entity))
                + pair(50, fmt(entity.rotation ?? 0));
            if (h !== 0 || v !== 0) {
                out += pair(11, fmt(entity.position.x)) + pair(21, fmt(entity.position.y)) + pair(31, 0);
                out += pair(72, h);
                out += pair(73, v);
            }
            out += pair(100, 'AcDbText');
            return out;
        }
        default:
            return '';
    }
}

export function writeDxf(doc, { view = doc.view } = {}) {
    handle = 0x100;
    const definitions = {};
    for (const [name, def] of Object.entries(doc.blocks ?? {})) {
        if (!name || /^\*(?:Model_Space|Paper_Space)/i.test(name)) continue;
        definitions[name] = def;
    }
    doc.entities.filter(e => e.type === 'insert' && e.definition).forEach(e => {
        if (e.name && !/^\*(?:Model_Space|Paper_Space)/i.test(e.name)) {
            definitions[e.name] = e.definition;
        }
    });

    outputStyles = new Map();
    const defaultKey = styleKey(doc.dimStyle ?? {});
    outputStyles.set(defaultKey, { ...(doc.dimStyle ?? {}), name: 'STANDARD' });
    const all = [...doc.entities, ...Object.values(definitions).flatMap(b => b.entities)];
    for (const e of all.filter(e => e.type === 'text' || e.type === 'dimension').map(e => e.type === 'dimension' ? { ...doc.dimStyle, ...e.style, ...e } : e)) {
        const key = styleKey(e);
        if (!outputStyles.has(key)) outputStyles.set(key, { ...e, name: `TRACO_FONT_${outputStyles.size}` });
    }

    outputDimensionStyles = new Map();
    outputDimensionStyles.set('STANDARD', { name: 'STANDARD', style: doc.dimStyle ?? {} });
    all.filter(e => e.type === 'dimension').forEach((e, i) => {
        outputDimensionStyles.set(e, {
            name: `TRACO_DIM_${i + 1}`,
            style: {
                ...doc.dimStyle,
                ...e.style,
                ...(e.fontFamily ? { fontFamily: e.fontFamily } : {}),
                ...(e.bold !== undefined ? { bold: e.bold } : {}),
                ...(e.italic !== undefined ? { italic: e.italic } : {}),
            }
        });
    });

    dimensionBlocks = new Map();
    [...doc.entities, ...Object.values(definitions).flatMap(b => b.entities)].filter(e => e.type === 'dimension' && e.kind !== 'leader').forEach((e, i) => {
        let name = `*DTRACO${i + 1}`;
        while (Object.hasOwn(definitions, name) || [...dimensionBlocks.values()].includes(name)) name += 'N';
        dimensionBlocks.set(e, name);
    });

    let out = '';
    out += pair(0, 'SECTION') + pair(2, 'HEADER');
    out += pair(9, '$ACADVER') + pair(1, 'AC1015');
    out += pair(9, '$INSUNITS') + pair(70, doc.units === 'in' ? 1 : 4);
    if (doc.insBase) out += pair(9, '$INSBASE') + pair(10, fmt(doc.insBase.x)) + pair(20, fmt(doc.insBase.y)) + pair(30, 0);
    out += pair(9, '$TEXTSTYLE') + pair(7, 'STANDARD');
    out += pair(9, '$DIMSTYLE') + pair(2, 'STANDARD');
    if (view && Number.isFinite(view.center?.x) && Number.isFinite(view.center?.y) && Number.isFinite(view.height) && view.height > 0) {
        out += pair(9, '$VIEWCTR') + pair(10, fmt(view.center.x)) + pair(20, fmt(view.center.y)) + pair(30, 0);
        out += pair(9, '$VIEWSIZE') + pair(40, fmt(view.height));
        out += pair(9, '$VIEWDIR') + pair(10, 0) + pair(20, 0) + pair(30, 1);
    }
    out += pair(9, '$HANDSEED') + pair(5, 'FFFF');
    out += pair(0, 'ENDSEC');

    out += pair(0, 'SECTION') + pair(2, 'TABLES');

    const viewCenter = view && Number.isFinite(view.center?.x) && Number.isFinite(view.center?.y) ? view.center : { x: 0, y: 0 };
    const viewHeight = view && Number.isFinite(view.height) && view.height > 0 ? view.height : 100;
    const viewAspect = view && Number.isFinite(view.aspectRatio) && view.aspectRatio > 0 ? view.aspectRatio : 1;

    // 1. VPORT
    out += pair(0, 'TABLE') + pair(2, 'VPORT') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTable') + pair(70, 1)
        + pair(0, 'VPORT') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbViewportTableRecord')
        + pair(2, '*ACTIVE') + pair(70, 0)
        + pair(10, 0) + pair(20, 0)
        + pair(11, 1) + pair(21, 1)
        + pair(12, fmt(viewCenter.x)) + pair(22, fmt(viewCenter.y))
        + pair(13, 0) + pair(23, 0)
        + pair(14, 10) + pair(24, 10)
        + pair(15, 10) + pair(25, 10)
        + pair(16, 0) + pair(17, 0)
        + pair(40, fmt(viewHeight)) + pair(41, fmt(viewAspect))
        + pair(0, 'ENDTAB');

    // 2. LTYPE
    const ltypes = Object.entries(LINETYPES);
    out += pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTable') + pair(70, ltypes.length);
    ltypes.forEach(([name, def]) => {
        const total = def.pattern.reduce((sum, v) => sum + Math.abs(v), 0);
        out += pair(0, 'LTYPE') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbLinetypeTableRecord') + pair(2, name) + pair(70, 0) + pair(3, def.description) + pair(72, 65) + pair(73, def.pattern.length) + pair(40, fmt(total));
        def.pattern.forEach((v) => { out += pair(49, fmt(v)) + pair(74, 0); });
    });
    out += pair(0, 'ENDTAB');

    // 3. LAYER
    out += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTable') + pair(70, doc.layers.length);
    doc.layers.forEach((layer) => {
        const isHex = typeof layer.color === 'string' && layer.color.startsWith('#');
        const aci = isHex ? 7 : Number(layer.color) || 7;
        const color = layer.visible ? aci : -Math.abs(aci);
        out += pair(0, 'LAYER') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbLayerTableRecord') + pair(2, layer.name) + pair(70, layer.locked ? 4 : 0) + pair(62, color);
        if (isHex) out += pair(420, parseInt(layer.color.slice(1), 16) || 0);
        out += pair(6, layer.lineType ?? 'CONTINUOUS') + pair(370, layer.lineWeight ?? 0);
    });
    out += pair(0, 'ENDTAB');

    // 4. STYLE
    out += pair(0, 'TABLE') + pair(2, 'STYLE') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTable') + pair(70, outputStyles.size);
    for (const st of outputStyles.values()) {
        st.handle = nextHandle();
        const family = st.fontFamily ?? 'Liberation Sans';
        const filenames = { 'Arial': 'arial', 'Times New Roman': 'times', 'Courier New': 'cour', 'Verdana': 'verdana', 'Georgia': 'georgia', 'Trebuchet MS': 'trebuc' };
        const file = family.startsWith('Liberation ')
            ? family.replaceAll(' ', '') + '-' + (st.bold && st.italic ? 'BoldItalic' : st.bold ? 'Bold' : st.italic ? 'Italic' : 'Regular') + '.ttf'
            : (filenames[family] ?? 'arial') + (st.bold && st.italic ? 'bi' : st.bold ? 'bd' : st.italic ? 'i' : '') + '.ttf';
        out += pair(0, 'STYLE') + pair(5, st.handle) + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbTextStyleTableRecord') + pair(2, st.name) + pair(70, 0) + pair(40, 0) + pair(41, 1) + pair(50, 0) + pair(71, 0) + pair(42, 2.5) + pair(3, file) + pair(4, '') + pair(1001, 'ACAD') + pair(1000, family) + pair(1071, (st.bold ? 0x2000000 : 0) | (st.italic ? 0x1000000 : 0));
    }
    out += pair(0, 'ENDTAB');

    // 5. APPID
    out += pair(0, 'TABLE') + pair(2, 'APPID') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTable') + pair(70, 1)
        + pair(0, 'APPID') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbRegAppTableRecord')
        + pair(2, 'ACAD') + pair(70, 0) + pair(0, 'ENDTAB');

    // 6. DIMSTYLE
    out += pair(0, 'TABLE') + pair(2, 'DIMSTYLE') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTable') + pair(70, outputDimensionStyles.size) + pair(100, 'AcDbDimStyleTable');
    for (const entry of outputDimensionStyles.values()) {
        const st = entry.style;
        const font = outputStyles.get(styleKey(st));
        out += pair(0, 'DIMSTYLE') + pair(105, nextHandle()) + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbDimStyleTableRecord')
            + pair(2, entry.name) + pair(70, 0)
            + pair(40, st.scale ?? 1) + pair(41, st.arrowSize ?? 2.5) + pair(42, st.extOffset ?? 0.625) + pair(44, st.extBeyond ?? 1.25)
            + pair(140, st.textHeight ?? 2.5) + pair(144, st.measurementScale ?? 1) + pair(147, st.textGap ?? 0.9)
            + pair(271, st.precision ?? 2) + pair(340, font?.handle ?? [...outputStyles.values()][0].handle);
    }
    out += pair(0, 'ENDTAB');

    // 7. BLOCK_RECORD
    const allBlockNames = ['*Model_Space', '*Paper_Space', ...Object.keys(definitions), ...dimensionBlocks.values()];
    out += pair(0, 'TABLE') + pair(2, 'BLOCK_RECORD') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTable') + pair(70, allBlockNames.length);
    for (const bName of allBlockNames) {
        out += pair(0, 'BLOCK_RECORD') + pair(5, nextHandle()) + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbBlockTableRecord') + pair(2, bName);
    }
    out += pair(0, 'ENDTAB');
    out += pair(0, 'ENDSEC');

    // BLOCKS Section
    out += pair(0, 'SECTION') + pair(2, 'BLOCKS');
    // Definition for *Model_Space
    out += pair(0, 'BLOCK') + pair(5, nextHandle()) + pair(100, 'AcDbEntity') + pair(8, '0') + pair(100, 'AcDbBlockBegin') + pair(2, '*Model_Space') + pair(70, 0) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(3, '*Model_Space') + pair(1, '')
        + pair(0, 'ENDBLK') + pair(5, nextHandle()) + pair(100, 'AcDbEntity') + pair(8, '0') + pair(100, 'AcDbBlockEnd');
    // Definition for *Paper_Space
    out += pair(0, 'BLOCK') + pair(5, nextHandle()) + pair(100, 'AcDbEntity') + pair(67, 1) + pair(8, '0') + pair(100, 'AcDbBlockBegin') + pair(2, '*Paper_Space') + pair(70, 0) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(3, '*Paper_Space') + pair(1, '')
        + pair(0, 'ENDBLK') + pair(5, nextHandle()) + pair(100, 'AcDbEntity') + pair(8, '0') + pair(100, 'AcDbBlockEnd');
    // User and dimension blocks
    Object.entries(definitions).forEach(([name, def]) => { out += writeBlock(name, def, doc.dimStyle); });
    for (const [dimension, name] of dimensionBlocks) {
        out += writeBlock(name, { basePoint: { x: 0, y: 0 } }, doc.dimStyle, writeDimensionGraphics(dimension, doc.dimStyle));
    }
    out += pair(0, 'ENDSEC');

    // ENTITIES Section
    out += pair(0, 'SECTION') + pair(2, 'ENTITIES');
    doc.entities.forEach((entity) => {
        out += writeEntity(entity, doc.dimStyle);
    });
    out += pair(0, 'ENDSEC');

    // OBJECTS Section
    out += pair(0, 'SECTION') + pair(2, 'OBJECTS') + pair(0, 'ENDSEC');
    out += pair(0, 'EOF');
    return out;
}
