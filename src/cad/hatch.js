// Hachuras e preenchimentos: entidade { type: 'hatch', loops: [{ vertices: [{x,y,bulge}] }], pattern, angle (graus), spacing, opacity }
// Padrões: SOLID (preenchimento), ANSI31 (linhas paralelas), ANSI37 (cruzado), DOTS (pontos em grade).

import { registerEntityProvider, polylineCurves, entityCurves, curveBox, emptyBox, boxAddPoint, distance, sweepCCW, polar, rotatePoint, degToRad } from './geometry.js';
import { ellipseSamples, ellipseIsFull, ensureSplineGeometry } from './extra-entities.js';
import { sampleSpline } from './splines.js';

export const HATCH_PATTERNS = {
    SOLID: { label: 'Sólido', lines: [] },
    ANSI31: { label: 'Linhas 45°', lines: [{ angle: 0 }] },
    ANSI37: { label: 'Cruzado', lines: [{ angle: 0 }, { angle: 90 }] },
    DOTS: { label: 'Pontos', lines: [{ angle: 0, dots: true }] },
};

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

function transformHatch(entity, fn, mirror) {
    const scaleRef = distance(fn({ x: 0, y: 0 }), fn({ x: 1, y: 0 }));
    const a = fn({ x: 0, y: 0 });
    const b = fn({ x: 1, y: 0 });
    const rotated = Math.atan2(b.y - a.y, b.x - a.x);
    return {
        ...entity,
        loops: entity.loops.map((loop) => ({ vertices: loop.vertices.map((v) => ({ ...fn(v), bulge: mirror ? -(v.bulge ?? 0) : (v.bulge ?? 0) })) })),
        spacing: (entity.spacing ?? 3) * (scaleRef > 0 ? scaleRef : 1),
        angle: mirror ? -(entity.angle ?? 45) : (entity.angle ?? 45) + (rotated * 180) / Math.PI,
    };
}

registerEntityProvider('hatch', {
    curves: (entity) => hatchCurves(entity),
    extraPoints: () => [],
    transform: transformHatch,
    snapPoints: () => [],
});

// Segmentos das linhas do padrão recortados pelos laços (paridade de cruzamentos), em coordenadas de mundo.
// Usado pela exportação e por testes; o renderer usa clip do canvas para desempenho.
export function patternSegments(entity, maxLines = 4000) {
    const pattern = HATCH_PATTERNS[entity.pattern] ?? HATCH_PATTERNS.ANSI31;
    if (pattern.lines.length === 0) return [];
    const box = hatchBox(entity);
    if (!Number.isFinite(box.minX)) return [];
    const spacing = Math.max(entity.spacing ?? 3, 1e-3);
    const corners = [
        { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY },
    ];
    const curves = hatchCurves(entity);
    const out = [];
    pattern.lines.forEach((line) => {
        const angle = degToRad((entity.angle ?? 45) + line.angle);
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const normal = { x: -dir.y, y: dir.x };
        // Padrão ancorado na origem do desenho, como no AutoCAD: as linhas ficam em
        // múltiplos de `spacing` medidos na normal, então hachuras vizinhas casam.
        const along = corners.map((p) => p.x * dir.x + p.y * dir.y);
        const across = corners.map((p) => p.x * normal.x + p.y * normal.y);
        const from = Math.min(...along) - spacing;
        const to = Math.max(...along) + spacing;
        const range=hatchLineRange(Math.min(...across),Math.max(...across),spacing,maxLines);
        for(let step=0;step<range.count;step++){
            const offset=(range.first+step)*spacing;
            const p0 = { x: normal.x * offset + dir.x * from, y: normal.y * offset + dir.y * from };
            const p1 = { x: normal.x * offset + dir.x * to, y: normal.y * offset + dir.y * to };
            const ts = [];
            curves.forEach((c) => {
                if (c.kind === 'segment') {
                    const hit = segmentParam(p0, p1, c.a, c.b);
                    if (hit !== null) ts.push(hit);
                } else {
                    arcParams(p0, p1, c).forEach((t) => ts.push(t));
                }
            });
            ts.sort((a, b) => a - b);
            for (let k = 0; k + 1 < ts.length; k += 2) {
                const a = { x: p0.x + (p1.x - p0.x) * ts[k], y: p0.y + (p1.y - p0.y) * ts[k] };
                const b = { x: p0.x + (p1.x - p0.x) * ts[k + 1], y: p0.y + (p1.y - p0.y) * ts[k + 1] };
                if (distance(a, b) > 1e-6) out.push({ a, b });
            }
        }
    });
    return out;
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

export function rotateHatchAngle(entity, angleRad) {
    return { ...entity, angle: (entity.angle ?? 45) + (angleRad * 180) / Math.PI };
}

export { rotatePoint, entityCurves };
