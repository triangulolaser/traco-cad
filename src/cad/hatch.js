// Hachuras e preenchimentos: entidade { type: 'hatch', loops: [{ vertices: [{x,y,bulge}] }], pattern, angle (graus), scale, opacity }
// Padrões no formato .pat (ISO, mm): cada família de linhas tem ângulo, origem, deslocamento
// entre linhas (dx ao longo, dy na perpendicular) e traços (positivo = traço, negativo = vão,
// 0 = ponto). Escala e ângulo da entidade valem como no AutoCAD/BricsCAD: ANSI31 com ângulo 0
// tem linhas a 45° e escala 1 dá 3,175 mm entre linhas, tudo ancorado na origem do desenho.
// Hachuras antigas (sem `scale`) guardavam ângulo absoluto e `spacing`; `upgradeHatch` converte.

import { registerEntityProvider, polylineCurves, entityCurves, curveBox, emptyBox, boxAddPoint, distance, sweepCCW, polar, rotatePoint, degToRad } from './geometry.js';
import { ellipseSamples, ellipseIsFull, ensureSplineGeometry } from './extra-entities.js';
import { sampleSpline } from './splines.js';

const IN = 25.4;
const pat = (rows) => rows.map(([angle, x, y, dx, dy, ...dashes]) => ({ angle, x: x * IN, y: y * IN, dx: dx * IN, dy: dy * IN, dashes: dashes.map((d) => d * IN) }));
const R2 = Math.SQRT2;
// SAND do Traço: chapa piso (xadrez). Traços alternados a +45° e -45° em xadrez, passo de 1/8".
const SAND_STEP = 0.125;
const SAND_LUG = 0.6 * SAND_STEP * R2;
const sandLug = SAND_LUG / (2 * R2);

export const HATCH_PATTERNS = {
    SOLID: { label: 'Sólido', description: 'Preenchimento sólido', lines: [] },
    ANSI31: { label: 'ANSI31', description: 'Ferro, tijolo e uso geral (linhas a 45°)', lines: pat([[45, 0, 0, 0, 0.125]]) },
    ANSI32: { label: 'ANSI32', description: 'Aço', lines: pat([[45, 0, 0, 0, 0.375], [45, 0.176776695, 0, 0, 0.375]]) },
    ANSI33: { label: 'ANSI33', description: 'Bronze, latão e cobre', lines: pat([[45, 0, 0, 0, 0.25], [45, 0.176776695, 0, 0, 0.25, 0.125, -0.0625]]) },
    ANSI34: { label: 'ANSI34', description: 'Plástico e borracha', lines: pat([[45, 0, 0, 0, 0.75], [45, 0.176776695, 0, 0, 0.75], [45, 0.353553391, 0, 0, 0.75], [45, 0.530330086, 0, 0, 0.75]]) },
    ANSI35: { label: 'ANSI35', description: 'Material refratário', lines: pat([[45, 0, 0, 0, 0.25], [45, 0.176776695, 0, 0, 0.25, 0.3125, -0.0625, 0, -0.0625]]) },
    ANSI36: { label: 'ANSI36', description: 'Mármore, ardósia e vidro', lines: pat([[45, 0, 0, 0.21875, 0.125, 0.3125, -0.0625, 0, -0.0625]]) },
    ANSI37: { label: 'ANSI37', description: 'Chumbo, zinco e magnésio (cruzado)', lines: pat([[45, 0, 0, 0, 0.125], [135, 0, 0, 0, 0.125]]) },
    ANSI38: { label: 'ANSI38', description: 'Alumínio', lines: pat([[45, 0, 0, 0, 0.125], [135, 0, 0, 0.25, 0.125, 0.3125, -0.1875]]) },
    SAND: {
        label: 'SAND',
        description: 'Chapa piso (xadrez)',
        lines: pat([
            [45, -sandLug, -sandLug, 0, SAND_STEP * R2, SAND_LUG, -(SAND_STEP * R2 - SAND_LUG)],
            [135, SAND_STEP + sandLug, -sandLug, 0, SAND_STEP * R2, SAND_LUG, -(SAND_STEP * R2 - SAND_LUG)],
        ]),
    },
    ANGLE: { label: 'ANGLE', description: 'Cantoneiras', lines: pat([[0, 0, 0, 0, 0.275, 0.2, -0.075], [90, 0, 0, 0, 0.275, 0.2, -0.075]]) },
    STEEL: { label: 'STEEL', description: 'Aço (linhas duplas)', lines: pat([[45, 0, 0, 0, 0.125], [45, 0, 0.0625, 0, 0.125]]) },
    NET: { label: 'NET', description: 'Grade horizontal e vertical', lines: pat([[0, 0, 0, 0, 0.125], [90, 0, 0, 0, 0.125]]) },
    LINE: { label: 'LINE', description: 'Linhas horizontais', lines: pat([[0, 0, 0, 0, 0.125]]) },
    DASH: { label: 'DASH', description: 'Linhas tracejadas', lines: pat([[0, 0, 0, 0.125, 0.125, 0.125, -0.125]]) },
    BRICK: { label: 'BRICK', description: 'Tijolos', lines: pat([[0, 0, 0, 0, 0.25], [90, 0, 0, 0, 0.5, 0.25, -0.25], [90, 0.25, 0, 0, 0.5, -0.25, 0.25]]) },
    DOTS: { label: 'DOTS', description: 'Pontos', lines: pat([[0, 0, 0, 0.03125, 0.0625, 0, -0.0625]]) },
};

export const HATCH_DEFAULTS = { pattern: 'ANSI31', angle: 0, scale: 1 };

// Hachura no modelo atual (padrão + ângulo + escala). As antigas guardavam o ângulo das
// linhas e o espaçamento; a conversão reproduz exatamente o desenho anterior.
export function upgradeHatch(entity) {
    if (!entity || entity.type !== 'hatch' || entity.scale !== undefined || entity.definition) return entity;
    const { spacing, ...rest } = entity;
    const angle = entity.angle ?? 45;
    const step = spacing > 0 ? spacing : 3;
    if (entity.pattern === 'SOLID') return { ...rest, angle: 0, scale: 1 };
    if (entity.pattern === 'DOTS') {
        return { ...rest, pattern: 'DOTS', angle: 0, scale: 1, definition: [{ angle, x: 0, y: 0, dx: 0, dy: step, dashes: [0, -step] }], definitionAngle: 0, definitionScale: 1 };
    }
    const pattern = entity.pattern === 'ANSI37' ? 'ANSI37' : 'ANSI31';
    return { ...rest, pattern, angle: angle - 45, scale: step / 3.175 };
}

// Famílias de linhas já em coordenadas do desenho: ângulo (rad), origem, dx/dy e traços em unidades.
export function hatchFamilies(input) {
    const entity = upgradeHatch(input);
    if (!entity || entity.pattern === 'SOLID') return [];
    const base = entity.definition ?? (HATCH_PATTERNS[entity.pattern] ?? HATCH_PATTERNS.ANSI31).lines;
    const scale = Number.isFinite(entity.scale) && entity.scale > 0 ? entity.scale : 1;
    const s = entity.definition ? scale / (entity.definitionScale || 1) : scale;
    const rot = degToRad((entity.angle ?? 0) - (entity.definition ? entity.definitionAngle ?? 0 : 0));
    return base.map((f) => ({
        angle: degToRad(f.angle) + rot,
        origin: rotatePoint({ x: f.x * s, y: f.y * s }, { x: 0, y: 0 }, rot),
        dx: f.dx * s,
        dy: f.dy * s,
        dashes: (f.dashes ?? []).map((d) => d * s),
    }));
}

// Menor distância entre linhas do padrão (para decidir quando a hachura vira mancha na tela).
export function hatchDensity(entity) {
    const families = hatchFamilies(entity);
    return families.length ? Math.min(...families.map((f) => Math.abs(f.dy))) : Infinity;
}

const MAX_PATTERN_PIECES = 400000;

// Percorre as retas de cada família que cruzam a caixa e os traços de cada reta dentro de [from, to].
// emit(kind, family, p0, dir, t0, t1): kind 'line' (reta inteira), 'dash' ou 'dot'. Retorna false se estourou o orçamento.
export function forEachPatternPiece(families, box, emit, { maxLines = 6000, maxPieces = MAX_PATTERN_PIECES } = {}) {
    if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) return true;
    const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }];
    let pieces = 0;
    for (const f of families) {
        if (!(Math.abs(f.dy) > 1e-9) || ![f.angle, f.origin.x, f.origin.y, f.dx, f.dy].every(Number.isFinite)) continue;
        const dir = { x: Math.cos(f.angle), y: Math.sin(f.angle) };
        const normal = { x: -dir.y, y: dir.x };
        const sign = f.dy < 0 ? -1 : 1;
        // A reta m fica a m·|dy| da origem na normal; com dy negativo o índice da família é -m.
        const across = corners.map((p) => (p.x - f.origin.x) * normal.x + (p.y - f.origin.y) * normal.y);
        const range = hatchLineRange(Math.min(...across), Math.max(...across), Math.abs(f.dy), maxLines);
        const period = f.dashes.reduce((a, d) => a + Math.abs(d), 0);
        const dashed = f.dashes.length > 0 && period > 1e-9;
        for (let step = 0; step < range.count; step++) {
            const k = (range.first + step) * sign;
            const p0 = { x: f.origin.x + dir.x * k * f.dx + normal.x * k * f.dy, y: f.origin.y + dir.y * k * f.dx + normal.y * k * f.dy };
            const along = corners.map((p) => (p.x - p0.x) * dir.x + (p.y - p0.y) * dir.y);
            const from = Math.min(...along);
            const to = Math.max(...along);
            if (!dashed) {
                if (++pieces > maxPieces) return false;
                emit('line', f, p0, dir, from, to);
                continue;
            }
            if ((to - from) / period * f.dashes.length + pieces > maxPieces) return false;
            let t = Math.floor(from / period) * period;
            for (let guard = 0; t < to && guard < 1e6; guard++) {
                for (const d of f.dashes) {
                    const len = Math.abs(d);
                    if (d === 0) { if (t >= from && t <= to) { pieces++; emit('dot', f, p0, dir, t, t); } }
                    else if (d > 0) { const a = Math.max(t, from), b = Math.min(t + len, to); if (b > a) { pieces++; emit('dash', f, p0, dir, a, b); } }
                    t += len;
                }
            }
        }
    }
    return true;
}

// Converte entidades fechadas (ou cadeia fechada de linhas/arcos) em laços de hachura.
export const MAX_HATCH_EDGES=20000;

// Endpoint graph: unlike greedy JOIN, shuffled contours do not require O(n²) scans.
export function closedHatchChains(entities,tolerance=1e-6){
    const curves=entities.flatMap(e=>entityCurves(e));
    if(curves.length>MAX_HATCH_EDGES)throw new Error(`Hachura limitada a ${MAX_HATCH_EDGES} segmentos por operação; divida a seleção.`);
    const cells=new Map(),nodes=[];
    const nodeFor=p=>{
        if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('Contorno com coordenadas inválidas.');
        const x=Math.floor(p.x/tolerance),y=Math.floor(p.y/tolerance);
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const node of cells.get(`${x+dx}:${y+dy}`)??[])if(distance(node.point,p)<tolerance)return node;
        const node={point:p,edges:[]};nodes.push(node);const key=`${x}:${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(node);return node;
    };
    const edges=curves.map(c=>{
        const a=nodeFor(c.kind==='segment'?c.a:polar(c.center,c.start,c.radius));
        const b=nodeFor(c.kind==='segment'?c.b:polar(c.center,c.end,c.radius));
        const edge={curve:c,a,b,used:false};a.edges.push(edge);b.edges.push(edge);return edge;
    });
    const loops=[];
    for(const seed of edges){
        if(seed.used)continue;
        const component=[],queue=[seed.a],visited=new Set();
        for(let q=0;q<queue.length;q++){const node=queue[q];if(visited.has(node))continue;visited.add(node);component.push(node);for(const edge of node.edges){if(!visited.has(edge.a))queue.push(edge.a);if(!visited.has(edge.b))queue.push(edge.b);}}
        if(component.some(n=>n.edges.length!==2)){for(const n of component)for(const e of n.edges)e.used=true;continue;}
        const vertices=[];let current=seed.a,edge=seed;
        do{
            const forward=edge.a===current,c=edge.curve;
            vertices.push({...current.point,bulge:c.kind==='segment'?0:Math.tan(sweepCCW(c.start,c.end)/4)*(forward?1:-1)});
            edge.used=true;current=forward?edge.b:edge.a;edge=current.edges.find(e=>!e.used);
        }while(edge && vertices.length<=MAX_HATCH_EDGES);
        if(current===seed.a && vertices.length>=2)loops.push({vertices});
    }
    return loops;
}

// Always iterate a small counter, never a potentially non-incrementable DXF coordinate index.
export function hatchLineRange(min,max,spacing,maxLines=6000){
    if(![min,max,spacing,maxLines].every(Number.isFinite)||spacing<=0||max<min)return {first:0,count:0};
    const first=Math.ceil(min/spacing),last=Math.floor(max/spacing);
    if(!Number.isFinite(first)||!Number.isFinite(last))return {first:0,count:0};
    return {first,count:Math.max(0,Math.min(Math.floor(maxLines)+1,6001,last-first+1))};
}

export function loopsFromEntities(entities) {
    const complexity=entities.reduce((n,e)=>n+(e.type==='polyline'?e.vertices.length:e.type==='hatch'?e.loops.reduce((a,l)=>a+l.vertices.length,0):e.type==='spline'?(e.controlPoints?.length??e.fitPoints?.length??0)*16:2),0);
    if(complexity>MAX_HATCH_EDGES)throw new Error(`Contorno muito complexo para uma hachura (${complexity} segmentos estimados). Divida a seleção.`);
    const loops = [];
    const chainable = [];
    entities.forEach((e) => {
        switch (e.type) {
            case 'polyline':
                if (e.closed && e.vertices.length >= 2) loops.push({ vertices: e.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge ?? 0 })) });
                else chainable.push(e);
                break;
            case 'circle':
                loops.push({ vertices: [{ x: e.center.x - e.radius, y: e.center.y, bulge: 1 }, { x: e.center.x + e.radius, y: e.center.y, bulge: 1 }] });
                break;
            case 'ellipse':
                if (ellipseIsFull(e)) {
                    const pts = ellipseSamples(e, 96);
                    pts.pop();
                    loops.push({ vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })) });
                }
                break;
            case 'spline': {
                const sp = ensureSplineGeometry(e);
                const pts = sampleSpline(sp, 16);
                if (pts.length > 2 && (e.closed || distance(pts[0], pts[pts.length - 1]) < 1e-6)) {
                    pts.pop();
                    loops.push({ vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })) });
                }
                break;
            }
            case 'line':
            case 'arc':
                chainable.push(e);
                break;
            case 'hatch':
                e.loops.forEach((l) => loops.push({ vertices: l.vertices.map((v) => ({ ...v })) }));
                break;
            default:
                break;
        }
    });
    if (chainable.length >= 2) {
        loops.push(...closedHatchChains(chainable));
    }
    return loops;
}

function loopCurves(loop) {
    return polylineCurves(loop.vertices, true).map((c) => ({ ...c, approx: true }));
}

export function hatchCurves(entity) {
    return entity.loops.flatMap((loop) => loopCurves(loop));
}

export function hatchBox(entity) {
    const box = emptyBox();
    hatchCurves(entity).forEach((c) => {
        const b = curveBox(c);
        boxAddPoint(box, { x: b.minX, y: b.minY });
        boxAddPoint(box, { x: b.maxX, y: b.maxY });
    });
    return box;
}

function transformHatch(input, fn, mirror) {
    const entity = upgradeHatch(input);
    const a = fn({ x: 0, y: 0 });
    const b = fn({ x: 1, y: 0 });
    const scaleRef = distance(a, b);
    const k = scaleRef > 0 ? scaleRef : 1;
    const rotated = Math.atan2(b.y - a.y, b.x - a.x);
    const loops = entity.loops.map((loop) => ({ vertices: loop.vertices.map((v) => ({ ...fn(v), bulge: mirror ? -(v.bulge ?? 0) : (v.bulge ?? 0) })) }));
    if (!mirror) return { ...entity, loops, scale: (entity.scale ?? 1) * k, angle: (entity.angle ?? 0) + (rotated * 180) / Math.PI };
    // Espelho: o padrão espelhado nem sempre é o mesmo padrão girado, então vira definição própria.
    const linear = (p) => { const q = fn(p); return { x: q.x - a.x, y: q.y - a.y }; };
    const definition = hatchFamilies(entity).map((f) => {
        const d = linear({ x: Math.cos(f.angle), y: Math.sin(f.angle) });
        return { angle: (Math.atan2(d.y, d.x) * 180) / Math.PI, ...linear(f.origin), dx: f.dx * k, dy: -f.dy * k, dashes: f.dashes.map((x) => x * k) };
    });
    return { ...entity, loops, angle: 0, scale: 1, definition, definitionAngle: 0, definitionScale: 1 };
}

registerEntityProvider('hatch', {
    curves: (entity) => hatchCurves(entity),
    extraPoints: () => [],
    transform: transformHatch,
    snapPoints: () => [],
});

// Geometria do padrão recortada pelos laços (paridade de cruzamentos), em coordenadas de mundo.
// Usada pela impressão, exportação e testes; o renderer usa clip do canvas para desempenho.
export function patternGeometry(entity, { maxLines = 4000, maxPieces = MAX_PATTERN_PIECES } = {}) {
    const families = hatchFamilies(entity);
    const segments = [];
    const dots = [];
    if (families.length === 0) return { segments, dots, complete: true };
    const box = hatchBox(entity);
    if (!Number.isFinite(box.minX)) return { segments, dots, complete: true };
    const curves = hatchCurves(entity);
    let lastLine = null;
    let inside = [];
    const insideOf = (p0, dir, from, to) => {
        const key = `${p0.x}:${p0.y}:${dir.x}:${dir.y}`;
        if (lastLine === key) return inside;
        lastLine = key;
        const a = { x: p0.x + dir.x * from, y: p0.y + dir.y * from };
        const b = { x: p0.x + dir.x * to, y: p0.y + dir.y * to };
        const ts = [];
        curves.forEach((c) => {
            if (c.kind === 'segment') {
                const hit = segmentParam(a, b, c.a, c.b);
                if (hit !== null) ts.push(hit);
            } else arcParams(a, b, c).forEach((t) => ts.push(t));
        });
        ts.sort((x, y) => x - y);
        inside = [];
        for (let k = 0; k + 1 < ts.length; k += 2) inside.push([from + (to - from) * ts[k], from + (to - from) * ts[k + 1]]);
        return inside;
    };
    // A caixa inteira da hachura define o trecho de cada reta usado nas interseções.
    const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }];
    const span = (p0, dir) => { const along = corners.map((p) => (p.x - p0.x) * dir.x + (p.y - p0.y) * dir.y); return [Math.min(...along) - 1, Math.max(...along) + 1]; };
    const point = (p0, dir, t) => ({ x: p0.x + dir.x * t, y: p0.y + dir.y * t });
    const complete = forEachPatternPiece(families, box, (kind, f, p0, dir, t0, t1) => {
        const [from, to] = span(p0, dir);
        for (const [a, b] of insideOf(p0, dir, from, to)) {
            if (kind === 'dot') { if (t0 >= a && t0 <= b) dots.push(point(p0, dir, t0)); continue; }
            const lo = Math.max(a, t0), hi = Math.min(b, t1);
            if (hi - lo > 1e-6) segments.push({ a: point(p0, dir, lo), b: point(p0, dir, hi) });
        }
    }, { maxLines, maxPieces });
    return { segments, dots, complete };
}

export function patternSegments(entity, maxLines = 4000) {
    return patternGeometry(entity, { maxLines }).segments;
}

function segmentParam(p0, p1, a, b) {
    const r = { x: p1.x - p0.x, y: p1.y - p0.y };
    const s = { x: b.x - a.x, y: b.y - a.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-12) return null;
    const qp = { x: a.x - p0.x, y: a.y - p0.y };
    const t = (qp.x * s.y - qp.y * s.x) / denom;
    const u = (qp.x * r.y - qp.y * r.x) / denom;
    if (u < 0 || u >= 1) return null; // meio-aberto evita contar o vértice duas vezes
    return t;
}

function arcParams(p0, p1, c) {
    const d = { x: p1.x - p0.x, y: p1.y - p0.y };
    const f = { x: p0.x - c.center.x, y: p0.y - c.center.y };
    const A = d.x * d.x + d.y * d.y;
    const B = 2 * (f.x * d.x + f.y * d.y);
    const C = f.x * f.x + f.y * f.y - c.radius * c.radius;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A < 1e-12) return [];
    const sq = Math.sqrt(disc);
    const out = [];
    [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].forEach((t) => {
        const p = { x: p0.x + d.x * t, y: p0.y + d.y * t };
        const ang = Math.atan2(p.y - c.center.y, p.x - c.center.x);
        if (c.kind === 'circle' || withinArc(ang, c.start, c.end)) out.push(t);
    });
    return out;
}

function withinArc(angle, start, end) {
    const sweep = sweepCCW(start, end);
    let rel = angle - start;
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;
    return rel <= sweep + 1e-9;
}

// Caminho do canvas para os laços (arcos via bulge).
export function hatchPath(entity, worldToScreen, ctxPath) {
    entity.loops.forEach((loop) => {
        const curves = polylineCurves(loop.vertices, true);
        curves.forEach((c, i) => {
            if (c.kind === 'segment') {
                const a = worldToScreen(c.a);
                const b = worldToScreen(c.b);
                if (i === 0) ctxPath.moveTo(a.x, a.y);
                ctxPath.lineTo(b.x, b.y);
            } else {
                const center = worldToScreen(c.center);
                const r = distance(worldToScreen(c.center), worldToScreen(polar(c.center, 0, c.radius)));
                const startPoint = worldToScreen(polar(c.center, c.start, c.radius));
                if (i === 0) ctxPath.moveTo(startPoint.x, startPoint.y);
                // Sentido de percurso do laço: bulge positivo = anti-horário no mundo = horário na tela.
                const vertex = loop.vertices[c.index ?? i];
                const ccwWorld = (vertex?.bulge ?? 0) > 0;
                if (ccwWorld) ctxPath.arc(center.x, center.y, r, -c.start, -c.end, true);
                else ctxPath.arc(center.x, center.y, r, -c.end, -c.start, false);
            }
        });
        ctxPath.closePath();
    });
}

export function rotateHatchAngle(input, angleRad) {
    const entity = upgradeHatch(input);
    return { ...entity, angle: (entity.angle ?? 0) + (angleRad * 180) / Math.PI };
}

export { rotatePoint, entityCurves };

// Polígono do laço com os arcos amostrados (para área e ponto interno).
export function loopPolygon(loop, arcSteps = 24) {
    const out = [];
    polylineCurves(loop.vertices, true).forEach((c) => {
        if (c.kind === 'segment') { out.push(c.a); return; }
        const vertex = loop.vertices[c.index];
        const ccw = (vertex?.bulge ?? 0) >= 0;
        const sweep = sweepCCW(c.start, c.end);
        const n = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * arcSteps));
        for (let i = 0; i < n; i++) {
            const t = i / n;
            out.push(polar(c.center, ccw ? c.start + sweep * t : c.end - sweep * t, c.radius));
        }
    });
    return out;
}

export function polygonArea(points) {
    let a = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    return Math.abs(a) / 2;
}

export function pointInPolygonPoints(p, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// "Escolha pontos internos" do BricsCAD: o menor contorno fechado em volta do ponto e as ilhas
// dentro dele. islands: 'nested' (aninhado, par/ímpar), 'outer' (só as ilhas externas) ou 'ignore'.
export function boundaryLoopsAt(point, loops, islands = 'nested') {
    const shapes = loops.map((loop) => {
        const poly = loopPolygon(loop);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        poly.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        return { loop, poly, area: polygonArea(poly), box: { minX, minY, maxX, maxY } };
    }).filter((s) => s.poly.length >= 3 && s.area > 1e-9);
    const contains = (s, p) => p.x >= s.box.minX && p.x <= s.box.maxX && p.y >= s.box.minY && p.y <= s.box.maxY && pointInPolygonPoints(p, s.poly);
    const outer = shapes.filter((s) => contains(s, point)).sort((a, b) => a.area - b.area)[0];
    if (!outer) return [];
    if (islands === 'ignore') return [outer.loop];
    const inside = (s, host) => s !== host && s.area < host.area && s.poly.every((p, i) => i % 4 !== 0 || contains(host, p));
    let candidates = shapes.filter((s) => inside(s, outer) && !contains(s, point));
    // Contornos repetidos (polilinha sobre polilinha) contariam duas vezes no par/ímpar.
    const seen = new Set([loopKey(outer.loop)]);
    candidates = candidates.filter((s) => { const key = loopKey(s.loop); if (seen.has(key)) return false; seen.add(key); return true; });
    if (islands === 'outer') candidates = candidates.filter((s) => !candidates.some((h) => inside(s, h)));
    return [outer.loop, ...candidates.map((s) => s.loop)];
}

export function loopKey(loop) {
    const pts = loop.vertices.map((v) => `${v.x.toFixed(6)},${v.y.toFixed(6)},${(v.bulge ?? 0).toFixed(6)}`);
    return [...pts].sort().join(';');
}

// Alteração vinda das Propriedades: padrão da biblioteca descarta a definição do arquivo.
export function setHatchProps(input, changes) {
    const entity = upgradeHatch(input);
    if (!entity || entity.type !== 'hatch') return input;
    const next = { ...entity };
    if (changes.pattern !== undefined && changes.pattern !== entity.pattern) {
        if (!HATCH_PATTERNS[changes.pattern]) throw new Error(`Padrão desconhecido: ${changes.pattern}.`);
        next.pattern = changes.pattern;
        delete next.definition; delete next.definitionAngle; delete next.definitionScale;
    }
    if (changes.scale !== undefined) {
        if (!(Number.isFinite(changes.scale) && changes.scale > 0)) throw new Error('A escala da hachura deve ser maior que zero.');
        next.scale = changes.scale;
    }
    if (changes.angle !== undefined) {
        if (!Number.isFinite(changes.angle)) throw new Error('Ângulo inválido.');
        next.angle = changes.angle;
    }
    return next;
}
