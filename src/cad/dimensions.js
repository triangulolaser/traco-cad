import {textWidth} from './fonts.js';
// Cotas: geometria de renderização, medição e escolha automática de tipo.
// Entidade: { type: 'dimension', kind: 'horizontal'|'vertical'|'aligned'|'radius'|'diameter',
//             p1, p2, linePoint, center?, radius?, textOverride? }

import {
    distance,
    sub,
    add,
    scale,
    dot,
    normalize,
    perpendicular,
    angleOf,
    radToDeg,
    midpoint,
    projectOnLine,
    normalizeAngle,
    registerEntityProvider,
    polylineCurves,
    textBox,
    polar,
    intersectLines,
    emptyBox,
    boxAddPoint,
    boxIsEmpty,
    entityBox,
    setEntityContext,
} from './geometry.js';
import { ensureLayer, layerOf } from './document.js';

export const DIMENSION_LAYER = 'dimensions';

export function defaultDimStyle() {
    return { textHeight: 2.5, arrowSize: 2.5, extOffset: 0.625, extBeyond: 1.25, textGap: 0.9, precision: 2, scale: 1, measurementScale: 1 };
}

/**
 * Fator linear da medida (DIMLFAC). Multiplica apenas o valor exibido em cotas
 * lineares e radiais; a geometria da cota continua em unidades do desenho.
 * Desenho 1:20 exportado com DIMLFAC 20 mede 65.03 no papel e mostra 1300.6.
 */
export function measurementFactor(style) {
    const factor = Number(style?.measurementScale);
    return Number.isFinite(factor) && factor !== 0 ? factor : 1;
}

/**
 * Calcula a escala proporcional de cotas (dimStyle.scale) com base no tamanho retangular máximo do conteúdo do desenho.
 * Calibração técnica: 100 mm -> escala 1.0 (texto 2.5 mm, aprox. 2.5% da peça).
 * Peça 500 mm -> escala 5.0 (texto 12.5 mm).
 * Chapa 2.000 mm -> escala 20.0 (texto 50.0 mm).
 */
export function computeAutoDimScale(maxDim) {
    if (!Number.isFinite(maxDim) || maxDim <= 0) return 1;
    const raw = maxDim / 100;
    if (raw <= 1) {
        if (raw < 0.35) return Math.max(0.2, Number(raw.toFixed(1)));
        return 1;
    }
    return Number(raw.toFixed(1));
}

/**
 * Obtém a caixa delimitadora do conteúdo do desenho (linhas, polilinhas, arcos, etc.),
 * ignorando entidades do tipo 'dimension' para não inflar a medição recursivamente.
 */
export function getDrawingContentBox(doc) {
    const box = emptyBox();
    if (!doc || !Array.isArray(doc.entities)) return box;
    const nonDim = doc.entities.filter((e) => e.type !== 'dimension');
    const targets = nonDim.length > 0 ? nonDim : doc.entities;
    targets.forEach((e) => {
        const b = entityBox(e);
        if (!boxIsEmpty(b)) {
            boxAddPoint(box, { x: b.minX, y: b.minY });
            boxAddPoint(box, { x: b.maxX, y: b.maxY });
        }
    });
    return box;
}

/**
 * Prepara o ambiente de cotagem:
 * 1. Cria automaticamente o layer 'dimensions' na cor vermelha (ACI 1 = #ff0000) caso não exista.
 * 2. Se for a primeira vez no desenho (sem cotas prévias e escala ainda em 1.0),
 *    ajusta a escala de cotas proporcionalmente ao tamanho retangular máximo do conteúdo.
 */
export function ensureDimensionSetup(editor, referencePoints = []) {
    if (!editor || !editor.doc) return null;
    let doc = editor.doc;
    let docChanged = false;

    // 1. Layer 'dimensions' em vermelho (ACI 1)
    if (!layerOf(doc, DIMENSION_LAYER)) {
        doc = ensureLayer(doc, DIMENSION_LAYER, { color: 1 });
        docChanged = true;
    }

    // 2. Auto-escala de cotas pelo tamanho retangular máximo do conteúdo
    // Cotas importadas do DXF/DWG trazem o próprio estilo (dimStyleName); não contam como "já ajustado",
    // senão um DWG com cotas deixa a escala em 1 e a cota nova sai com texto minúsculo.
    const hasDimensions = doc.entities.some((e) => e.type === 'dimension' && !e.dimStyleName);
    const currentScale = doc.dimStyle?.scale ?? 1;

    if (!hasDimensions && currentScale === 1) {
        const box = getDrawingContentBox(doc);
        let maxDim = 0;
        if (!boxIsEmpty(box)) {
            maxDim = Math.max(box.maxX - box.minX, box.maxY - box.minY);
        } else if (referencePoints && referencePoints.length >= 2) {
            maxDim = distance(referencePoints[0], referencePoints[1]);
        }
        if (maxDim > 0) {
            const autoScale = computeAutoDimScale(maxDim);
            if (autoScale !== currentScale) {
                doc = {
                    ...doc,
                    dimStyle: {
                        ...(doc.dimStyle ?? defaultDimStyle()),
                        scale: autoScale,
                    },
                };
                docChanged = true;
                editor.log?.(`Layer 'dimensions' (vermelho) criado. Escala de cotas ajustada para ${autoScale}x (conteúdo: ${Math.round(maxDim)} mm).`);
            }
        }
    }

    if (docChanged) {
        if (editor.history) {
            editor.history.present = doc;
        }
        try {
            editor.doc = doc;
        } catch {
            // getter-only em instâncias de Editor
        }
        setEntityContext({ dimStyle: doc.dimStyle });
        editor.onChange?.(editor);
        editor.invalidate?.();
    }

    return doc;
}

// Texto sobrescrito pode carregar o marcador "<>" do AutoCAD (ex.: "%%c<>" do SolidWorks):
// o marcador vira a medição; prefixo e sufixo ficam por conta do próprio texto.
export function dimensionText(override, value, style, prefix = '', suffix = '') {
    if (override === undefined || override === null) return formatMeasurement(value, style, prefix, suffix);
    const text = String(override);
    return text.includes('<>') ? text.replaceAll('<>', formatMeasurement(value, style)) : text;
}

export function formatMeasurement(value, style, prefix = '', suffix = '') {
    const precision = style?.precision ?? 2;
    let text = Number(value).toFixed(precision);
    if (precision > 0) text = text.replace(/\.?0+$/, '');
    if (text === '-0') text = '0';
    let formatted = `${prefix}${text}${suffix}`;
    const tol = style?.tolerance;
    if (tol) {
        if (typeof tol === 'number' || tol.type === 'symmetrical') {
            const val = typeof tol === 'number' ? tol : (tol.value ?? tol.upper ?? 0);
            formatted += ` ±${val}`;
        } else if (tol.type === 'deviation') {
            const u = tol.upper >= 0 ? `+${tol.upper}` : String(tol.upper);
            const l = tol.lower > 0 ? `+${tol.lower}` : String(tol.lower);
            formatted += ` ${u}/${l}`;
        } else if (tol.type === 'limits') {
            let high = Number(value + (tol.upper ?? 0)).toFixed(precision);
            let low = Number(value + (tol.lower ?? 0)).toFixed(precision);
            if (precision > 0) {
                high = high.replace(/\.?0+$/, '');
                low = low.replace(/\.?0+$/, '');
            }
            formatted = `${prefix}${high}/${low}${suffix}`;
        }
    }
    return formatted;
}

function effectiveStyle(style, entity) {
    const base = {
        ...defaultDimStyle(),
        ...(style ?? {}),
        ...(entity?.style ?? {}),
        ...(entity?.textHeight !== undefined ? { textHeight: entity.textHeight } : {}),
        ...(entity?.fontFamily ? { fontFamily: entity.fontFamily } : {}),
        ...(entity?.bold !== undefined ? { bold: entity.bold } : {}),
        ...(entity?.italic !== undefined ? { italic: entity.italic } : {}),
        ...(entity?.tolerance !== undefined ? { tolerance: entity.tolerance } : {}),
        ...(entity?.measurementScale !== undefined ? { measurementScale: entity.measurementScale } : {}),
    };
    // DIMSCALE 0 (escala pela viewport no AutoCAD) zeraria texto e setas.
    const raw = entity?.scale ?? base.scale ?? 1;
    const s = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return {
        ...base,
        textHeight: base.textHeight * s,
        arrowSize: base.arrowSize * s,
        extOffset: base.extOffset * s,
        extBeyond: base.extBeyond * s,
        textGap: base.textGap * s,
    };
}

function arrowAt(tip, direction, size) {
    // Triângulo preenchido com a ponta em `tip`, apontando na direção `direction` (normalizada).
    const back = sub(tip, scale(direction, size));
    const n = perpendicular(direction);
    return [tip, add(back, scale(n, size / 6)), sub(back, scale(n, size / 6))];
}

function readableAngle(angle) {
    // Texto de cota é lido da esquerda para a direita ou de baixo para cima.
    let a = normalizeAngle(angle);
    if (a > Math.PI / 2 + 1e-9 && a <= (3 * Math.PI) / 2 + 1e-9) a += Math.PI;
    return normalizeAngle(a);
}

function textEntityAt(center, angle, text, style, id) {
    const width=textWidth({text,height:style.textHeight,fontFamily:style.fontFamily,bold:style.bold,italic:style.italic});
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const position = sub(center, scale(dir, width / 2));
    return { type: 'text', fontFamily:style.fontFamily,bold:style.bold,italic:style.italic, position, height: style.textHeight, rotation: radToDeg(angle), text, id: id ? `${id}-text` : undefined };
}

function linearGeometry(entity, style) {
    const { p1, p2, linePoint } = entity;
    let dir;
    let measurement;
    if (entity.kind === 'horizontal') {
        dir = { x: 1, y: 0 };
        measurement = Math.abs(p2.x - p1.x);
    } else if (entity.kind === 'vertical') {
        dir = { x: 0, y: 1 };
        measurement = Math.abs(p2.y - p1.y);
    } else if (entity.kind === 'rotated') {
        // Cota rotacionada: mede a projeção dos pontos na direção declarada, não em X nem em Y.
        const angle = ((entity.rotation ?? 0) * Math.PI) / 180;
        dir = { x: Math.cos(angle), y: Math.sin(angle) };
        measurement = Math.abs(dot(sub(p2, p1), dir));
    } else {
        dir = normalize(sub(p2, p1));
        if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };
        measurement = distance(p1, p2);
    }
    const n = perpendicular(dir);
    // A linha de cota passa por linePoint e é paralela a dir: cada ponto é projetado nela ao longo de n.
    const offsetOf = (p) => dot(sub(linePoint, p), n);
    const d1 = add(p1, scale(n, offsetOf(p1)));
    const d2 = add(p2, scale(n, offsetOf(p2)));
    const ext = (origin, target) => {
        const offset = offsetOf(origin);
        const sign = offset >= 0 ? 1 : -1;
        const gapStart = add(origin, scale(n, sign * style.extOffset));
        const beyond = add(target, scale(n, sign * style.extBeyond));
        return Math.abs(offset) > style.extOffset ? { a: gapStart, b: beyond } : null;
    };
    const segments = [{ a: d1, b: d2 }];
    const e1 = ext(p1, d1);
    const e2 = ext(p2, d2);
    if (e1) segments.push(e1);
    if (e2) segments.push(e2);
    const along = normalize(sub(d2, d1));
    const lineDir = along.x === 0 && along.y === 0 ? dir : along;
    const arrows = [];
    const inside = measurement >= style.arrowSize * 3;
    if (inside) {
        arrows.push(arrowAt(d1, scale(lineDir, -1), style.arrowSize));
        arrows.push(arrowAt(d2, lineDir, style.arrowSize));
    } else {
        arrows.push(arrowAt(d1, lineDir, style.arrowSize));
        arrows.push(arrowAt(d2, scale(lineDir, -1), style.arrowSize));
        segments.push({ a: sub(d1, scale(lineDir, style.arrowSize * 2)), b: d1 });
        segments.push({ a: d2, b: add(d2, scale(lineDir, style.arrowSize * 2)) });
    }
    const text = dimensionText(entity.textOverride, measurement * measurementFactor(style), style, entity.prefix ?? '', entity.suffix ?? '');
    const angle = readableAngle(angleOf(d1, d2));
    const textNormal = perpendicular({ x: Math.cos(angle), y: Math.sin(angle) });
    const width = textWidth({ text, height: style.textHeight, fontFamily: style.fontFamily, bold: style.bold, italic: style.italic });
    let textCenter;
    const offLine = entity.textPosition ? dot(sub(entity.textPosition, d1), textNormal) : 0;
    if (entity.textPosition && style.textAbove && Math.abs(offLine) < style.textHeight / 2) {
        // DIMTAD=1 (SolidWorks/BricsCAD): o código 11 vem sobre a linha de cota; o texto fica acima dela.
        textCenter = add(sub(entity.textPosition, scale(textNormal, offLine)), scale(textNormal, style.textGap));
    } else if (entity.textPosition) {
        // Código 11 é o meio do texto; a base fica meia altura abaixo.
        textCenter = sub(entity.textPosition, scale(textNormal, style.textHeight / 2));
    } else if (width + style.arrowSize * 2 > measurement) {
        // Como no BricsCAD: texto que não cabe entre as linhas de chamada sai para fora, depois da segunda.
        const outward = dot(sub(d2, d1), lineDir) >= 0 ? lineDir : scale(lineDir, -1);
        const reach = (inside ? 0 : style.arrowSize * 2) + style.textGap + width / 2;
        textCenter = add(add(d2, scale(outward, reach)), scale(textNormal, style.textGap));
        segments.push({ a: d2, b: add(d2, scale(outward, reach + width / 2)) });
    } else {
        textCenter = add(midpoint(d1, d2), scale(textNormal, style.textGap));
    }
    if (entity.textPosition) {
        // Linha de cota prolongada até o texto deslocado, como o CAD de origem desenha.
        const t = dot(sub(entity.textPosition, d1), lineDir);
        const len = dot(sub(d2, d1), lineDir);
        if (t > len) segments.push({ a: d2, b: add(d1, scale(lineDir, t + width / 2)) });
        else if (t < 0) segments.push({ a: d1, b: add(d1, scale(lineDir, t - width / 2)) });
    }
    return { segments, arrows, texts: [textEntityAt(textCenter, angle, text, style, entity.id)], measurement, text };
}

function radialGeometry(entity, style) {
    const { center, radius, linePoint } = entity;
    const dirToText = normalize(sub(linePoint, center));
    const dir = dirToText.x === 0 && dirToText.y === 0 ? { x: 1, y: 0 } : dirToText;
    const onCircle = add(center, scale(dir, radius));
    const outside = distance(linePoint, center) > radius;
    const segments = [];
    const arrows = [];
    const isDiameter = entity.kind === 'diameter';
    const prefix = entity.prefix ?? (isDiameter ? 'Ø' : 'R');
    const suffix = entity.suffix ?? '';
    const measurement = isDiameter ? radius * 2 : radius;
    const text = dimensionText(entity.textOverride, measurement * measurementFactor(style), style, prefix, suffix);
    const angle = readableAngle(angleOf(center, linePoint));
    if (isDiameter) {
        const opposite = sub(center, scale(dir, radius));
        segments.push({ a: opposite, b: outside ? linePoint : onCircle });
        arrows.push(arrowAt(onCircle, dir, style.arrowSize));
        arrows.push(arrowAt(opposite, scale(dir, -1), style.arrowSize));
    } else {
        segments.push({ a: center, b: outside ? linePoint : onCircle });
        arrows.push(arrowAt(onCircle, dir, style.arrowSize));
    }
    const textNormal = perpendicular({ x: Math.cos(angle), y: Math.sin(angle) });
    const anchor = outside ? linePoint : midpoint(center, onCircle);
    const textCenter = add(anchor, scale(textNormal, style.textGap));
    if (outside) {
        // Pequena linha de chamada horizontal no fim, como no BricsCAD.
        const width=textWidth({text,height:style.textHeight,fontFamily:style.fontFamily,bold:style.bold,italic:style.italic});
        const landing = add(linePoint, { x: dir.x >= 0 ? width : -width, y: 0 });
        segments.push({ a: linePoint, b: landing });
        const landingCenter = midpoint(linePoint, landing);
        return { segments, arrows, texts: [textEntityAt(add(landingCenter, { x: 0, y: style.textGap }), 0, text, style, entity.id)], measurement, text };
    }
    return { segments, arrows, texts: [textEntityAt(textCenter, angle, text, style, entity.id)], measurement, text };
}

/**
 * Cota angular entre duas linhas: as retas formam quatro setores. Devolve p1/p2
 * espelhados pelo vértice quando preciso, para que o setor convexo entre eles
 * contenha o cursor (o setor apontado é o cotado, como no AutoCAD).
 */
export function resolveAngularQuadrant(vertex, p1, p2, cursor) {
    const d1 = sub(p1, vertex);
    const d2 = sub(p2, vertex);
    const c = sub(cursor, vertex);
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    if (Math.hypot(c.x, c.y) < 1e-9) return { p1, p2 };
    for (const s1 of [1, -1]) {
        for (const s2 of [1, -1]) {
            const a = scale(d1, s1);
            const b = scale(d2, s2);
            const ab = cross(a, b);
            if (Math.abs(ab) < 1e-12) continue;
            if (cross(a, c) * ab >= 0 && cross(c, b) * ab >= 0) {
                return { p1: add(vertex, a), p2: add(vertex, b) };
            }
        }
    }
    return { p1, p2 };
}

function angularGeometry(entity, style) {
    const { p1, p2, linePoint } = entity;
    const vertex=entity.vertex??entity.center;
    const angle1 = normalizeAngle(angleOf(vertex, p1));
    const angle2 = normalizeAngle(angleOf(vertex, p2));
    const radius = Math.max(distance(vertex, linePoint), style.arrowSize * 2);
    const angleP = normalizeAngle(angleOf(vertex, linePoint));

    const sweep12 = normalizeAngle(angle2 - angle1);
    const sweepP1 = normalizeAngle(angleP - angle1);

    let startAngle;
    let endAngle;
    let sweep;

    // Setor travado (cota entre duas linhas): arrastar só muda o raio, nunca o quadrante.
    if (entity.sectorLocked ? sweep12 <= Math.PI : sweepP1 <= sweep12) {
        startAngle = angle1;
        endAngle = angle2;
        sweep = sweep12;
    } else {
        startAngle = angle2;
        endAngle = angle1;
        sweep = normalizeAngle(angle1 - angle2);
    }

    const measurement = radToDeg(sweep);
    const text = dimensionText(entity.textOverride, measurement, style, entity.prefix ?? '', entity.suffix ?? '°');

    const segments = [];
    const arrows = [];
    const arcs = [];

    // Setor travado: o cursor no setor oposto pelo vértice leva a cota para lá (mesmo ângulo);
    // fora dos dois, o texto acompanha o cursor e o arco se estende até ele.
    let oppositeSide = false;
    let textAt = null;
    let extraArc = null;
    if (entity.sectorLocked && normalizeAngle(angleP - startAngle) > sweep) {
        if (normalizeAngle(angleP - startAngle - Math.PI) <= sweep) {
            oppositeSide = true;
            startAngle = normalizeAngle(startAngle + Math.PI);
            endAngle = normalizeAngle(endAngle + Math.PI);
        } else {
            textAt = angleP;
            const fromEnd = normalizeAngle(angleP - endAngle);
            const toStart = normalizeAngle(startAngle - angleP);
            const over = Math.min(Math.PI / 36, style.arrowSize / radius);
            if (fromEnd <= toStart) extraArc = ({ center: vertex, radius, startAngle: endAngle, endAngle: normalizeAngle(angleP + over), ccw: true });
            else extraArc = ({ center: vertex, radius, startAngle: normalizeAngle(angleP - over), endAngle: startAngle, ccw: true });
        }
    }

    arcs.push({
        center: vertex,
        radius,
        startAngle,
        endAngle,
        ccw: true,
    });
    if (extraArc) arcs.push(extraArc);

    const arcLen = radius * sweep;
    const inside = arcLen >= style.arrowSize * 3;

    const pStart = {
        x: vertex.x + radius * Math.cos(startAngle),
        y: vertex.y + radius * Math.sin(startAngle),
    };
    const pEnd = {
        x: vertex.x + radius * Math.cos(endAngle),
        y: vertex.y + radius * Math.sin(endAngle),
    };

    const tStart = { x: -Math.sin(startAngle), y: Math.cos(startAngle) };
    const tEnd = { x: -Math.sin(endAngle), y: Math.cos(endAngle) };

    if (inside) {
        arrows.push(arrowAt(pStart, tStart, style.arrowSize));
        arrows.push(arrowAt(pEnd, scale(tEnd, -1), style.arrowSize));
    } else {
        arrows.push(arrowAt(pStart, scale(tStart, -1), style.arrowSize));
        arrows.push(arrowAt(pEnd, tEnd, style.arrowSize));
    }

    // Quando o setor começa em p2, as distâncias trocam junto com os ângulos.
    const swapped = startAngle !== angle1;
    const d1 = oppositeSide ? 0 : distance(vertex, swapped ? p2 : p1);
    const dir1 = { x: Math.cos(startAngle), y: Math.sin(startAngle) };
    if (radius > d1 + style.extOffset) {
        segments.push({
            a: add(vertex, scale(dir1, Math.max(d1, style.extOffset))),
            b: add(vertex, scale(dir1, radius + style.extBeyond)),
        });
    }

    const d2 = oppositeSide ? 0 : distance(vertex, swapped ? p1 : p2);
    const dir2 = { x: Math.cos(endAngle), y: Math.sin(endAngle) };
    if (radius > d2 + style.extOffset) {
        segments.push({
            a: add(vertex, scale(dir2, Math.max(d2, style.extOffset))),
            b: add(vertex, scale(dir2, radius + style.extBeyond)),
        });
    }

    const midAngle = textAt ?? normalizeAngle(startAngle + sweep / 2);
    const textNormal = { x: Math.cos(midAngle), y: Math.sin(midAngle) };
    const tangentAngle = normalizeAngle(midAngle + Math.PI / 2);
    const textAngle = readableAngle(tangentAngle);
    // Texto sempre por dentro do arco (lado do vértice); se a leitura virou, a base encosta no arco.
    const up = { x: -Math.sin(textAngle), y: Math.cos(textAngle) };
    const flipped = up.x * textNormal.x + up.y * textNormal.y < 0;
    const textCenter = add(vertex, scale(textNormal, radius - style.textGap - (flipped ? 0 : style.textHeight)));

    return {
        segments,
        arcs,
        arrows,
        texts: [textEntityAt(textCenter, textAngle, text, style, entity.id)],
        measurement,
        text,
    };
}

function leaderGeometry(e,style){
    const text=e.textOverride??'';
    return {segments:[{a:e.p1,b:e.p2},{a:e.p2,b:e.linePoint}],arrows:[arrowAt(e.p1,normalize(sub(e.p1,e.p2)),style.arrowSize)],texts:[{type:'text',position:add(e.linePoint,{x:0,y:style.textGap}),height:style.textHeight,rotation:0,text,fontFamily:style.fontFamily,bold:style.bold,italic:style.italic}],measurement:0,text};
}

export function dimensionGeometry(entity, style) {
    const s = effectiveStyle(style, entity);
    if(entity.kind==='leader')return leaderGeometry(entity,s);
    if (entity.kind === 'angular') return angularGeometry(entity, s);
    if (entity.kind === 'radius' || entity.kind === 'diameter') return radialGeometry(entity, s);
    return linearGeometry(entity, s);
}

export function dimensionCurves(entity, style) {
    const g = dimensionGeometry(entity, style);
    const curves = g.segments.map((seg) => ({ kind: 'segment', a: seg.a, b: seg.b }));
    if (g.arcs) {
        g.arcs.forEach((arc) => {
            curves.push({
                kind: 'arc',
                center: arc.center,
                radius: arc.radius,
                start: arc.startAngle,
                end: arc.endAngle,
                startAngle: arc.startAngle,
                endAngle: arc.endAngle,
                ccw: arc.ccw ?? true,
            });
        });
    }
    g.arrows.forEach((tri) => {
        for (let i = 0; i < 3; i += 1) curves.push({ kind: 'segment', a: tri[i], b: tri[(i + 1) % 3] });
    });
    return curves;
}

export function transformDimension(entity, fn, mirror) {
    const e = { ...entity };
    ['p1', 'p2', 'linePoint', 'center', 'vertex', 'textPosition'].forEach((key) => {
        if (entity[key]) e[key] = fn(entity[key]);
    });
    if (entity.radius !== undefined && entity.center) {
        e.radius = distance(e.center, fn(add(entity.center, { x: entity.radius, y: 0 })));
    }
    if (entity.kind === 'horizontal' || entity.kind === 'vertical') {
        // Rotação de 90° troca o tipo; outras rotações viram alinhada.
        const before = angleOf(entity.p1, entity.p2);
        const after = angleOf(e.p1, e.p2);
        // Ângulo entre −π e π: numa translação a diferença é ±1e-15, e normalizar −1e-15 dava ~2π (virava alinhada).
        const delta = Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)));
        const quarter = Math.abs(delta - Math.PI / 2) < 1e-6;
        const straight = delta < 1e-6 || Math.abs(delta - Math.PI) < 1e-6;
        if (quarter) e.kind = entity.kind === 'horizontal' ? 'vertical' : 'horizontal';
        else if (!straight && !mirror) e.kind = 'aligned';
    }
    if (entity.kind === 'rotated' && !mirror) {
        // A direção de medição acompanha a rotação aplicada à geometria.
        const delta = normalizeAngle(angleOf(e.p1, e.p2) - angleOf(entity.p1, entity.p2));
        e.rotation = (((entity.rotation ?? 0) + radToDeg(delta)) % 180 + 180) % 180;
    }
    void mirror;
    return e;
}

// Escolha automática do tipo linear a partir da posição da linha de cota.
export function chooseLinearKind(p1, p2, linePoint) {
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    if (dy < 1e-9) return 'horizontal';
    if (dx < 1e-9) return 'vertical';
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    const insideX = linePoint.x >= minX && linePoint.x <= maxX;
    const insideY = linePoint.y >= minY && linePoint.y <= maxY;
    if (insideX && !insideY) return 'horizontal';
    if (insideY && !insideX) return 'vertical';
    return 'aligned';
}

// Cota automática a partir de uma entidade e do ponto clicado.
export function autoDimensionFor(entity, pickPoint) {
    switch (entity.type) {
        case 'line':
            return { kind: 'aligned', p1: entity.start, p2: entity.end, auto: 'linear' };
        case 'circle':
            return { kind: 'diameter', center: entity.center, radius: entity.radius };
        case 'arc':
            return { kind: 'radius', center: entity.center, radius: entity.radius };
        case 'polyline': {
            const curves = polylineSegments(entity);
            let best = null;
            curves.forEach((c) => {
                const d = c.kind === 'segment'
                    ? distance(pickPoint, projectClamped(pickPoint, c.a, c.b))
                    : Math.abs(distance(pickPoint, c.center) - c.radius);
                if (!best || d < best.d) best = { c, d };
            });
            if (!best) return null;
            if (best.c.kind === 'segment') return { kind: 'aligned', p1: best.c.a, p2: best.c.b, auto: 'linear' };
            return { kind: 'radius', center: best.c.center, radius: best.c.radius };
        }
        default:
            return null;
    }
}

function projectClamped(p, a, b) {
    const { point, t } = projectOnLine(p, a, b);
    if (t <= 0) return a;
    if (t >= 1) return b;
    return point;
}

function polylineSegments(entity) {
    return polylineCurves(entity.vertices, entity.closed);
}

registerEntityProvider('dimension', {
    curves: (entity, context) => dimensionCurves(entity, context?.dimStyle),
    extraPoints: (entity, context) => dimensionGeometry(entity, context?.dimStyle).texts.flatMap(textBox),
    transform: transformDimension,
});
