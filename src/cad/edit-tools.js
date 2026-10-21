import { add, sub, distance, midpoint, polar, angleOf, normalizeAngle, pointInBox, entityBox, boxContains, translateEntity, intersectLines, normalize, scale, splitEntityAt, entityCurves, closestPointOnCurve, dot, sweepCCW, curveLength, entityLength, bulgeToArc, polylineCurves, rotatePoint, cross } from './geometry.js';
import { expandInsert } from './blocks.js';
import { ellipseIsFull } from './extra-entities.js';
import { interpolateSpline, sampleSpline } from './splines.js';
import { isEntityEditable } from './document.js';

export function gripsFor(e) {
    const point = (key, label = key) => e[key] ? [{ key, label, point: e[key] }] : [];
    if (e.construction === 'xline') {
        const root = e.point || e.basePoint || midpoint(e.start, e.end);
        return [{ key: 'point', label: 'Origem', point: root }];
    }
    if (e.construction === 'ray') {
        return [{ key: 'start', label: 'Origem', point: e.start }];
    }
    switch (e.type) {
        case 'line': return [...point('start', 'Início'), ...point('end', 'Fim'), { key: 'move', label: 'Mover', point: midpoint(e.start, e.end) }];
        case 'polyline': return e.vertices.map((p, i) => ({ key: `vertices.${i}`, label: `Vértice ${i + 1}`, point: p }));
        case 'spline': return (e.controlPoints ?? []).map((p, i) => ({ key: `controlPoints.${i}`, label: `Controle ${i + 1}`, point: p }));
        case 'circle': return [...point('center', 'Centro'), ...[0, 1, 2, 3].map(i => ({ key: 'radius', label: 'Raio', point: polar(e.center, i * Math.PI / 2, e.radius) }))];
        case 'arc': return [...point('center', 'Centro'), { key: 'arcStart', label: 'Início', point: polar(e.center, e.start, e.radius) }, { key: 'arcEnd', label: 'Fim', point: polar(e.center, e.end, e.radius) }];
        case 'dimension': return ['p1', 'p2', 'center', 'linePoint'].flatMap(k => point(k));
        default: return point('position', 'Posição');
    }
}
export function moveGrip(e, key, p) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Coordenada inválida.');
    if (e.construction === 'xline' && (key === 'point' || key === 'move')) {
        const root = e.point || e.basePoint || midpoint(e.start, e.end);
        return translateEntity(e, sub(p, root));
    }
    if (e.construction === 'ray' && key === 'start') {
        return translateEntity(e, sub(p, e.start));
    }
    if (key === 'move') return translateEntity(e, sub(p, midpoint(e.start, e.end)));
    if (key === 'center') return translateEntity(e, sub(p, e.center));
    if (key === 'radius') {
        const radius = distance(e.center, p);
        if (radius < 1e-9) throw new Error('Raio deve ser positivo.');
        return { ...e, radius };
    }
    if (key === 'arcStart' || key === 'arcEnd') return { ...e, [key === 'arcStart' ? 'start' : 'end']: normalizeAngle(angleOf(e.center, p)) };
    if (/^(vertices|controlPoints)\.\d+$/.test(key)) {
        const [field, raw] = key.split('.'); const i = Number(raw);
        if (!e[field]?.[i]) throw new Error('Vértice inexistente.');
        return { ...e, [field]: e[field].map((v, j) => j === i ? { ...v, ...p } : v), ...(field === 'controlPoints' ? { fitPoints: [] } : {}) };
    }
    if (!['start', 'end', 'position', 'p1', 'p2', 'linePoint'].includes(key)) throw new Error('Grip não suportado.');
    return { ...e, [key]: { ...p } };
}
export function stretchEntity(e, box, delta) {
    if (boxContains(box, entityBox(e))) return translateEntity(e, delta);
    if (e.type === 'line') return { ...e, start: pointInBox(e.start, box) ? add(e.start, delta) : e.start, end: pointInBox(e.end, box) ? add(e.end, delta) : e.end };
    if (e.type === 'polyline') return { ...e, vertices: e.vertices.map(p => pointInBox(p, box) ? { ...p, ...add(p, delta) } : p) };
    // Furos parcialmente selecionados não são deformados. Círculos inteiros movem acima.
    if (e.type === 'dimension') return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, ['p1', 'p2', 'linePoint', 'center'].includes(k) && v && pointInBox(v, box) ? add(v, delta) : v]));
    return e;
}
export function stretchDocument(doc, box, delta) {
    return { ...doc, entities: doc.entities.map(e => isEntityEditable(doc, e) ? stretchEntity(e, box, delta) : e) };
}
export function chamferLines(a, b, d1, d2) {
    if (a.type !== 'line' || b.type !== 'line' || a.id && a.id === b.id) throw new Error('Selecione duas linhas distintas.');
    if (!(d1 >= 0 && d2 >= 0 && Number.isFinite(d1) && Number.isFinite(d2))) throw new Error('Distância inválida.');
    const hit = intersectLines(a.start, a.end, b.start, b.end, false, false);
    if (!hit) throw new Error('Linhas paralelas não formam chanfro.');
    const p = hit.point ?? hit;
    const trim = (e, d) => {
        const startNear = distance(p, e.start) <= distance(p, e.end);
        const far = startNear ? e.end : e.start;
        if (d >= distance(p, far) - 1e-9) throw new Error('Chanfro ultrapassa a linha.');
        const tip = add(p, scale(normalize(sub(far, p)), d));
        return { entity: { ...e, [startNear ? 'start' : 'end']: tip }, tip };
    };
    const x = trim(a, d1), y = trim(b, d2);
    return { first: x.entity, second: y.entity, bridge: { type: 'line', start: x.tip, end: y.tip, layer: a.layer, color: a.color } };
}
export function breakAtPoint(e, p) {
    if (!['line', 'arc', 'polyline'].includes(e.type)) throw new Error('Quebra por ponto suporta linha, arco e polilinha aberta.');
    if (e.type === 'polyline') {
        if (e.closed) throw new Error('Abra a polilinha antes de quebrar por um ponto.');
        const curves = entityCurves(e);
        const nearest = curves.map((c, i) => ({ c, i, p: closestPointOnCurve(p, c) })).sort((a,b) => distance(p,a.p)-distance(p,b.p))[0];
        const parts = splitEntityAt(nearest.c.kind === 'segment' ? { type:'line', start:nearest.c.a, end:nearest.c.b } : { type:'arc', center:nearest.c.center, radius:nearest.c.radius, start:nearest.c.start, end:nearest.c.end }, [nearest.p]);
        if (parts.length !== 2) throw new Error('Escolha um ponto interno do segmento.');
        if((e.vertices[nearest.i].bulge??0)<0)parts.reverse();
        const direction=(e.vertices[nearest.i].bulge??0)<0?-1:1;
        const idx = nearest.i; const before = e.vertices.slice(0, idx + 1), after = e.vertices.slice(idx + 1);
        const bulge = c => c.type === 'arc' ? direction*Math.tan(normalizeAngle(c.end-c.start)/4) : 0;
        before[before.length-1] = {...before.at(-1), bulge:bulge(parts[0])};
        return [{...e, vertices:[...before, {...nearest.p,bulge:0}]}, {...e,id:undefined,vertices:[{...nearest.p,bulge:bulge(parts[1])},...after]}];
    }
    const curve = entityCurves(e)[0]; const at = closestPointOnCurve(p, curve);
    const parts = splitEntityAt(e, [at]);
    if (parts.length !== 2) throw new Error('Escolha um ponto interno, não uma extremidade.');
    return parts.map((x, i) => ({...e,...x,id:i === 0 ? e.id : undefined}));
}
export function geometryFields(e) {
    const fields = [];
    for (const k of ['start','end','center','position','p1','p2','vertex','linePoint','major']) if (e[k] && typeof e[k] === 'object') for (const axis of ['x','y']) fields.push({ key:`${k}.${axis}`, value:e[k][axis] });
    for (const k of ['radius','height','rotation','ratio','scaleX','scaleY']) if (typeof e[k] === 'number') fields.push({key:k,value:e[k]});
    if (['circle','arc'].includes(e.type) && typeof e.radius === 'number') fields.splice(fields.findIndex(f=>f.key==='radius')+1, 0, {key:'diameter',value:e.radius*2});
    if (e.type === 'arc') for (const k of ['start','end']) fields.push({key:k,value:e[k]*180/Math.PI,angle:true});
    if (e.type === 'line') fields.push({key:'length',value:distance(e.start,e.end)});
    if (e.type === 'polyline') e.vertices.forEach((p,i) => ['x','y','bulge'].forEach(k => fields.push({key:`vertices.${i}.${k}`,value:p[k]??0})));
    return fields;
}
export function setGeometryField(e, key, raw) {
    const field = geometryFields(e).find(f=>f.key===key); const value=Number(raw);
    if (!field || !Number.isFinite(value)) throw new Error('Propriedade inválida.');
    if (['radius','diameter','height','length','ratio'].includes(key) && value <= 0) throw new Error('Valor deve ser positivo.');
    if (key==='diameter') return {...e,radius:value/2};
    if (key==='ratio' && value>1) throw new Error('Razão da elipse deve ser até 1.');
    if (['scaleX','scaleY'].includes(key) && Math.abs(value)<1e-9) throw new Error('Escala não pode ser zero.');
    if (key==='length') return {...e,end:polar(e.start,angleOf(e.start,e.end),value)};
    const out=structuredClone(e), parts=key.split('.'); let target=out;
    for(const p of parts.slice(0,-1)) target=target[p];
    target[parts.at(-1)]=field.angle ? value*Math.PI/180 : value;
    if(out.type==='insert')expandInsert(out);
    return out;
}

export function curvePointAtDistance(curves, dist) {
    if (!curves || curves.length === 0) return null;
    let remaining = Math.max(0, dist);
    for (let i = 0; i < curves.length; i++) {
        const c = curves[i];
        const len = curveLength(c);
        const isLast = i === curves.length - 1;
        if (remaining <= len + 1e-9 || isLast) {
            if (c.kind === 'segment') {
                const t = len > 1e-12 ? Math.min(Math.max(remaining / len, 0), 1) : 0;
                const point = {
                    x: c.a.x + (c.b.x - c.a.x) * t,
                    y: c.a.y + (c.b.y - c.a.y) * t,
                };
                const angle = angleOf(c.a, c.b);
                return { point, angle };
            }
            if (c.kind === 'circle') {
                const ang = remaining / c.radius;
                const point = polar(c.center, ang, c.radius);
                const angle = normalizeAngle(ang + Math.PI / 2);
                return { point, angle };
            }
            if (c.kind === 'arc') {
                let ang, angle;
                if (c.bulge && c.bulge < 0) {
                    ang = normalizeAngle(c.end - remaining / c.radius);
                    angle = normalizeAngle(ang - Math.PI / 2);
                } else {
                    ang = normalizeAngle(c.start + remaining / c.radius);
                    angle = normalizeAngle(ang + Math.PI / 2);
                }
                const point = polar(c.center, ang, c.radius);
                return { point, angle };
            }
        }
        remaining -= len;
    }
    return null;
}

export function lengthenEntity(entity, pickPoint, mode, value) {
    if (!['line', 'arc', 'polyline'].includes(entity.type) || (entity.type === 'polyline' && entity.closed)) {
        throw new Error('Comando suporta apenas linhas, arcos e polilinhas abertas.');
    }

    if (entity.type === 'line') {
        const currentLen = distance(entity.start, entity.end);
        if (currentLen < 1e-12) throw new Error('Segmento de comprimento zero.');

        const dStart = distance(pickPoint, entity.start);
        const dEnd = distance(pickPoint, entity.end);
        const modifyEnd = dEnd <= dStart;

        let targetLen;
        if (mode === 'delta') {
            targetLen = currentLen + value;
        } else if (mode === 'percent') {
            if (value <= 0) throw new Error('Porcentagem deve ser maior que zero.');
            targetLen = currentLen * (value / 100);
        } else if (mode === 'total') {
            if (value <= 0) throw new Error('Comprimento total deve ser maior que zero.');
            targetLen = value;
        } else if (mode === 'dynamic') {
            const anchor = modifyEnd ? entity.start : entity.end;
            const u = normalize(sub(modifyEnd ? entity.end : entity.start, anchor));
            const proj = dot(sub(value, anchor), u);
            targetLen = proj;
        } else {
            throw new Error(`Modo de alongamento desconhecido: ${mode}`);
        }

        if (targetLen <= 1e-9) throw new Error('Comprimento resultante deve ser maior que zero.');

        if (modifyEnd) {
            const u = normalize(sub(entity.end, entity.start));
            return { ...entity, end: add(entity.start, scale(u, targetLen)) };
        } else {
            const u = normalize(sub(entity.start, entity.end));
            return { ...entity, start: add(entity.end, scale(u, targetLen)) };
        }
    }

    if (entity.type === 'arc') {
        if (entity.radius < 1e-12) throw new Error('Arco com raio inválido.');
        const sweep = sweepCCW(entity.start, entity.end);
        if (sweep < 1e-12) throw new Error('Arco de comprimento zero.');

        const pStart = polar(entity.center, entity.start, entity.radius);
        const pEnd = polar(entity.center, entity.end, entity.radius);
        const dStart = distance(pickPoint, pStart);
        const dEnd = distance(pickPoint, pEnd);
        const modifyEnd = dEnd <= dStart;

        let newSweep;
        if (mode === 'delta') {
            newSweep = sweep + value / entity.radius;
        } else if (mode === 'percent') {
            if (value <= 0) throw new Error('Porcentagem deve ser maior que zero.');
            newSweep = sweep * (value / 100);
        } else if (mode === 'total') {
            if (value <= 0) throw new Error('Comprimento total deve ser maior que zero.');
            newSweep = value / entity.radius;
        } else if (mode === 'dynamic') {
            const ang = angleOf(entity.center, value);
            newSweep = modifyEnd ? sweepCCW(entity.start, ang) : sweepCCW(ang, entity.end);
        } else {
            throw new Error(`Modo de alongamento desconhecido: ${mode}`);
        }

        if (newSweep <= 1e-9 || newSweep >= Math.PI * 2) {
            throw new Error('Comprimento do arco inválido (deve ser entre 0 e 360°).');
        }

        if (modifyEnd) {
            return { ...entity, end: normalizeAngle(entity.start + newSweep) };
        } else {
            return { ...entity, start: normalizeAngle(entity.end - newSweep) };
        }
    }

    if (entity.type === 'polyline') {
        if (entity.vertices.length < 2) throw new Error('Polilinha precisa de pelo menos 2 vértices.');
        const totalLen = entityLength(entity);
        if (totalLen < 1e-12) throw new Error('Polilinha de comprimento zero.');

        const vertices = structuredClone(entity.vertices);
        const dStart = distance(pickPoint, vertices[0]);
        const dEnd = distance(pickPoint, vertices[vertices.length - 1]);
        const modifyEnd = dEnd <= dStart;

        let deltaSeg;
        if (mode === 'delta') {
            deltaSeg = value;
        } else if (mode === 'percent') {
            if (value <= 0) throw new Error('Porcentagem deve ser maior que zero.');
            deltaSeg = totalLen * (value / 100) - totalLen;
        } else if (mode === 'total') {
            if (value <= 0) throw new Error('Comprimento total deve ser maior que zero.');
            deltaSeg = value - totalLen;
        } else if (mode === 'dynamic') {
            if (modifyEnd) {
                const last = vertices[vertices.length - 1];
                const prev = vertices[vertices.length - 2];
                const u = normalize(sub(last, prev));
                deltaSeg = dot(sub(value, last), u);
            } else {
                const first = vertices[0];
                const next = vertices[1];
                const u = normalize(sub(first, next));
                deltaSeg = dot(sub(value, first), u);
            }
        } else {
            throw new Error(`Modo de alongamento desconhecido: ${mode}`);
        }

        if (totalLen + deltaSeg <= 1e-9) {
            throw new Error('Comprimento resultante deve ser maior que zero.');
        }

        if (modifyEnd) {
            const idx = vertices.length - 2;
            const vA = vertices[idx];
            const vB = vertices[idx + 1];
            const b = vA.bulge || 0;
            if (b === 0) {
                const segLen = distance(vA, vB);
                const newLen = segLen + deltaSeg;
                if (newLen <= 1e-9) throw new Error('Comprimento do segmento resultante menor ou igual a zero.');
                const u = normalize(sub(vB, vA));
                const newB = add(vA, scale(u, newLen));
                vertices[idx + 1] = { ...vB, x: newB.x, y: newB.y };
            } else {
                const arc = bulgeToArc(vA, vB, b);
                const sweep = sweepCCW(arc.start, arc.end);
                const deltaSweep = deltaSeg / arc.radius;
                const newSweep = sweep + deltaSweep;
                if (newSweep <= 1e-9 || newSweep >= Math.PI * 2) {
                    throw new Error('Comprimento de arco resultante inválido.');
                }
                const newBulge = Math.tan(newSweep / 4) * Math.sign(b);
                vA.bulge = newBulge;
                if (b > 0) {
                    const newEnd = normalizeAngle(arc.start + newSweep);
                    const newPt = polar(arc.center, newEnd, arc.radius);
                    vertices[idx + 1] = { ...vB, x: newPt.x, y: newPt.y };
                } else {
                    const newStart = normalizeAngle(arc.end - newSweep);
                    const newPt = polar(arc.center, newStart, arc.radius);
                    vertices[idx + 1] = { ...vB, x: newPt.x, y: newPt.y };
                }
            }
        } else {
            const vA = vertices[0];
            const vB = vertices[1];
            const b = vA.bulge || 0;
            if (b === 0) {
                const segLen = distance(vA, vB);
                const newLen = segLen + deltaSeg;
                if (newLen <= 1e-9) throw new Error('Comprimento do segmento resultante menor ou igual a zero.');
                const u = normalize(sub(vA, vB));
                const newA = add(vB, scale(u, newLen));
                vertices[0] = { ...vA, x: newA.x, y: newA.y };
            } else {
                const arc = bulgeToArc(vA, vB, b);
                const sweep = sweepCCW(arc.start, arc.end);
                const deltaSweep = deltaSeg / arc.radius;
                const newSweep = sweep + deltaSweep;
                if (newSweep <= 1e-9 || newSweep >= Math.PI * 2) {
                    throw new Error('Comprimento de arco resultante inválido.');
                }
                const newBulge = Math.tan(newSweep / 4) * Math.sign(b);
                vA.bulge = newBulge;
                if (b > 0) {
                    const newStart = normalizeAngle(arc.end - newSweep);
                    const newPt = polar(arc.center, newStart, arc.radius);
                    vertices[0] = { ...vA, x: newPt.x, y: newPt.y, bulge: newBulge };
                } else {
                    const newEnd = normalizeAngle(arc.start + newSweep);
                    const newPt = polar(arc.center, newEnd, arc.radius);
                    vertices[0] = { ...vA, x: newPt.x, y: newPt.y, bulge: newBulge };
                }
            }
        }

        return { ...entity, vertices };
    }

    throw new Error('Tipo de entidade não suportado.');
}

export function divideEntity(entity, segments, { block = null, align = true } = {}) {
    if (!['line', 'arc', 'circle', 'polyline', 'ellipse', 'spline'].includes(entity.type)) {
        throw new Error('Tipo de entidade não suportado para divisão.');
    }
    const count = Math.floor(segments);
    if (!(count >= 2)) throw new Error('O número de segmentos deve ser pelo menos 2.');

    const curves = entityCurves(entity);
    const totalLen = curves.reduce((sum, c) => sum + curveLength(c), 0);
    if (totalLen < 1e-12) throw new Error('Objeto de comprimento zero.');

    const isClosed = Boolean(entity.closed || entity.type === 'circle' || (entity.type === 'ellipse' && ellipseIsFull(entity)));
    const out = [];

    const startK = isClosed ? 0 : 1;
    const endK = isClosed ? count - 1 : count - 1;

    for (let k = startK; k <= endK; k++) {
        const dist = (k * totalLen) / count;
        const res = curvePointAtDistance(curves, dist);
        if (!res) continue;
        const layer = entity.layer || '0';
        if (block) {
            out.push({
                type: 'insert',
                name: block,
                position: res.point,
                rotation: align ? (res.angle * 180) / Math.PI : 0,
                scaleX: 1,
                scaleY: 1,
                layer,
            });
        } else {
            out.push({
                type: 'point',
                position: res.point,
                layer,
            });
        }
    }

    return out;
}

export function measureEntity(entity, segmentLength, pickPoint, { block = null, align = true } = {}) {
    if (!['line', 'arc', 'circle', 'polyline', 'ellipse', 'spline'].includes(entity.type)) {
        throw new Error('Tipo de entidade não suportado para medição.');
    }
    if (!(segmentLength > 1e-9)) throw new Error('O comprimento do segmento deve ser maior que zero.');

    const curves = entityCurves(entity);
    const totalLen = curves.reduce((sum, c) => sum + curveLength(c), 0);
    if (totalLen < 1e-12) throw new Error('Objeto de comprimento zero.');
    if (segmentLength >= totalLen) return [];

    const isClosed = Boolean(entity.closed || entity.type === 'circle' || (entity.type === 'ellipse' && ellipseIsFull(entity)));

    let reverse = false;
    if (!isClosed && pickPoint && curves.length > 0) {
        const cFirst = curves[0];
        const pStart = cFirst.kind === 'segment' ? cFirst.a : polar(cFirst.center, cFirst.start, cFirst.radius);
        const cLast = curves[curves.length - 1];
        const pEnd = cLast.kind === 'segment' ? cLast.b : polar(cLast.center, cLast.end, cLast.radius);
        if (distance(pickPoint, pEnd) < distance(pickPoint, pStart)) {
            reverse = true;
        }
    }

    const out = [];
    for (let d = segmentLength; d < totalLen - 1e-7; d += segmentLength) {
        const queryDist = reverse ? totalLen - d : d;
        const res = curvePointAtDistance(curves, queryDist);
        if (!res) continue;
        const angle = reverse ? normalizeAngle(res.angle + Math.PI) : res.angle;
        const layer = entity.layer || '0';
        if (block) {
            out.push({
                type: 'insert',
                name: block,
                position: res.point,
                rotation: align ? (angle * 180) / Math.PI : 0,
                scaleX: 1,
                scaleY: 1,
                layer,
            });
        } else {
            out.push({
                type: 'point',
                position: res.point,
                layer,
            });
        }
    }

    return out;
}

export function convertEntityToPolyline(entity) {
    if (entity.type === 'polyline') return structuredClone(entity);
    const base = {
        id: entity.id,
        type: 'polyline',
        layer: entity.layer || '0',
        color: entity.color,
        lineType: entity.lineType,
        lineWeight: entity.lineWeight,
        closed: false,
    };
    if (entity.type === 'line') {
        return {
            ...base,
            vertices: [
                { x: entity.start.x, y: entity.start.y, bulge: 0 },
                { x: entity.end.x, y: entity.end.y, bulge: 0 },
            ],
        };
    }
    if (entity.type === 'arc') {
        const sweep = sweepCCW(entity.start, entity.end);
        const b = Math.tan(sweep / 4);
        const pStart = polar(entity.center, entity.start, entity.radius);
        const pEnd = polar(entity.center, entity.end, entity.radius);
        return {
            ...base,
            vertices: [
                { x: pStart.x, y: pStart.y, bulge: b },
                { x: pEnd.x, y: pEnd.y, bulge: 0 },
            ],
        };
    }
    throw new Error('Tipo de entidade não conversível em polilinha.');
}

export function setPolylineWidth(entity, width) {
    const val = Number(width);
    if (isNaN(val) || val < 0) throw new Error('A largura deve ser um número não negativo.');
    return {
        ...entity,
        constantWidth: val > 0 ? val : undefined,
    };
}

export function setPolylineClosed(entity, closed) {
    const isClosed = Boolean(closed);
    if (Boolean(entity.closed) === isClosed) return structuredClone(entity);
    const vertices = structuredClone(entity.vertices);
    if (!isClosed && vertices.length > 0) {
        vertices[vertices.length - 1].bulge = 0;
    }
    return {
        ...entity,
        closed: isClosed,
        vertices,
    };
}

export function reversePolyline(entity) {
    const n = entity.vertices.length;
    if (n < 2) return structuredClone(entity);
    const newVertices = [];
    for (let i = 0; i < n; i++) {
        const origIdx = n - 1 - i;
        const v = entity.vertices[origIdx];
        let prevIdx = origIdx - 1;
        if (prevIdx < 0) {
            prevIdx = entity.closed ? n - 1 : -1;
        }
        const origBulge = prevIdx >= 0 ? (entity.vertices[prevIdx].bulge || 0) : 0;
        newVertices.push({
            ...v,
            bulge: origBulge ? -origBulge : 0,
        });
    }
    return {
        ...entity,
        vertices: newVertices,
    };
}

export function fitPolyline(entity) {
    const vertices = structuredClone(entity.vertices);
    const n = vertices.length;
    if (n < 3) return structuredClone(entity);
    const closed = Boolean(entity.closed);

    const tangents = [];
    for (let i = 0; i < n; i++) {
        if (!closed && i === 0) {
            tangents.push(angleOf(vertices[0], vertices[1]));
        } else if (!closed && i === n - 1) {
            tangents.push(angleOf(vertices[n - 2], vertices[n - 1]));
        } else {
            const prev = (i - 1 + n) % n;
            const next = (i + 1) % n;
            const a1 = angleOf(vertices[prev], vertices[i]);
            const a2 = angleOf(vertices[i], vertices[next]);
            let diff = a2 - a1;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            tangents.push(normalizeAngle(a1 + diff / 2));
        }
    }

    const segmentsCount = closed ? n : n - 1;
    for (let i = 0; i < segmentsCount; i++) {
        const next = (i + 1) % n;
        const chordAngle = angleOf(vertices[i], vertices[next]);
        let delta = chordAngle - tangents[i];
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        delta = Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, delta));
        vertices[i].bulge = Math.tan(delta / 2);
    }
    if (!closed) {
        vertices[n - 1].bulge = 0;
    }

    return {
        ...entity,
        controlVertices: entity.controlVertices ?? entity.vertices.map((v) => ({ ...v })),
        vertices,
    };
}

export function splinePolyline(entity) {
    const points = entity.vertices.map((v) => ({ x: v.x, y: v.y }));
    const closed = Boolean(entity.closed);
    const spline = interpolateSpline(points, { closed });
    if (!spline) return structuredClone(entity);
    const sampled = sampleSpline(spline, 8);
    if (sampled.length < 2) return structuredClone(entity);
    if (closed && sampled.length > 2) {
        sampled.pop();
    }
    return {
        ...entity,
        controlVertices: entity.controlVertices ?? entity.vertices.map((v) => ({ ...v })),
        vertices: sampled.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
    };
}

export function decurvePolyline(entity) {
    if (entity.controlVertices) {
        const { controlVertices, ...rest } = entity;
        return {
            ...rest,
            vertices: controlVertices.map((v) => ({ ...v, bulge: 0 })),
        };
    }
    return {
        ...entity,
        vertices: entity.vertices.map((v) => ({ ...v, bulge: 0 })),
    };
}

export function joinToPolyline(targetPolyline, candidateEntities, tol = 1e-6) {
    if (targetPolyline.closed) return { polyline: targetPolyline, joinedIds: [] };

    const initialCurves = polylineCurves(targetPolyline.vertices, false).map((c) => ({ ...c }));
    if (initialCurves.length === 0) return { polyline: targetPolyline, joinedIds: [] };

    const getCurvePoints = (c) => {
        let a = c.a;
        let b = c.b;
        if (!a || !b) {
            a = polar(c.center, c.start, c.radius);
            b = polar(c.center, c.end, c.radius);
        }
        return c.reversed ? [b, a] : [a, b];
    };

    const reverseCurve = (c) => ({
        ...c,
        reversed: !c.reversed,
    });

    let chain = initialCurves.map((c) => {
        const [a, b] = getCurvePoints(c);
        return { ...c, a, b, reversed: false };
    });

    let pool = candidateEntities
        .filter((e) => e.id !== targetPolyline.id && ['line', 'arc', 'polyline'].includes(e.type))
        .map((e) => {
            let curves;
            if (e.type === 'line') {
                curves = [{ kind: 'segment', a: e.start, b: e.end, reversed: false }];
            } else if (e.type === 'arc') {
                const a = polar(e.center, e.start, e.radius);
                const b = polar(e.center, e.end, e.radius);
                curves = [{ kind: 'arc', center: e.center, radius: e.radius, start: e.start, end: e.end, a, b, reversed: false }];
            } else {
                curves = polylineCurves(e.vertices, e.closed).map((c) => {
                    const [a, b] = getCurvePoints(c);
                    return { ...c, a, b, reversed: false };
                });
            }
            return { entity: e, curves };
        });

    const joinedIds = [];
    let guard = 0;

    while (pool.length > 0 && guard < 1000) {
        guard += 1;
        const headStart = chain[0].reversed ? chain[0].b : chain[0].a;
        const tailEnd = chain[chain.length - 1].reversed ? chain[chain.length - 1].a : chain[chain.length - 1].b;

        if (distance(headStart, tailEnd) < tol && chain.length >= 2) {
            break;
        }

        let matched = false;
        for (let i = 0; i < pool.length; i++) {
            const cand = pool[i];
            const candCurves = cand.curves;
            if (candCurves.length === 0) continue;

            const cFirst = candCurves[0];
            const cLast = candCurves[candCurves.length - 1];
            const candStart = cFirst.reversed ? cFirst.b : cFirst.a;
            const candEnd = cLast.reversed ? cLast.a : cLast.b;

            // 1. Início do candidato conecta no fim do tail
            if (distance(candStart, tailEnd) < tol) {
                chain.push(...candCurves);
                joinedIds.push(cand.entity.id);
                pool.splice(i, 1);
                matched = true;
                break;
            }
            // 2. Fim do candidato conecta no fim do tail (inverte ordem e sentido de candCurves)
            if (distance(candEnd, tailEnd) < tol) {
                const reversed = [...candCurves].reverse().map(reverseCurve);
                chain.push(...reversed);
                joinedIds.push(cand.entity.id);
                pool.splice(i, 1);
                matched = true;
                break;
            }
            // 3. Fim do candidato conecta no início do head
            if (distance(candEnd, headStart) < tol) {
                chain.unshift(...candCurves);
                joinedIds.push(cand.entity.id);
                pool.splice(i, 1);
                matched = true;
                break;
            }
            // 4. Início do candidato conecta no início do head (inverte ordem e sentido de candCurves)
            if (distance(candStart, headStart) < tol) {
                const reversed = [...candCurves].reverse().map(reverseCurve);
                chain.unshift(...reversed);
                joinedIds.push(cand.entity.id);
                pool.splice(i, 1);
                matched = true;
                break;
            }
        }

        if (!matched) break;
    }

    if (joinedIds.length === 0) {
        return { polyline: targetPolyline, joinedIds: [] };
    }

    const vertices = [];
    chain.forEach((c) => {
        const startPt = c.reversed ? c.b : c.a;
        if (c.kind === 'segment') {
            vertices.push({ x: startPt.x, y: startPt.y, bulge: 0 });
        } else {
            const sweep = sweepCCW(c.start, c.end);
            const bulge = c.bulge !== undefined
                ? (c.reversed ? -c.bulge : c.bulge)
                : Math.tan(sweep / 4) * (c.reversed ? -1 : 1);
            vertices.push({ x: startPt.x, y: startPt.y, bulge });
        }
    });

    const lastCurve = chain[chain.length - 1];
    const lastEnd = lastCurve.reversed ? lastCurve.a : lastCurve.b;
    const firstPt = vertices[0];
    const isClosed = distance(lastEnd, firstPt) < tol;
    if (!isClosed) {
        vertices.push({ x: lastEnd.x, y: lastEnd.y, bulge: 0 });
    }

    return {
        polyline: {
            ...targetPolyline,
            vertices,
            closed: isClosed,
        },
        joinedIds,
    };
}

export const CONSTRUCTION_LINE_LENGTH = 100000;

export function createXline(point, dirOrAngle, options = {}) {
    let dir;
    if (typeof dirOrAngle === 'number') {
        dir = { x: Math.cos(dirOrAngle), y: Math.sin(dirOrAngle) };
    } else {
        const len = Math.hypot(dirOrAngle.x, dirOrAngle.y);
        if (len < 1e-12) dir = { x: 1, y: 0 };
        else dir = { x: dirOrAngle.x / len, y: dirOrAngle.y / len };
    }
    const L = options.length ?? CONSTRUCTION_LINE_LENGTH;
    const pt = { x: point.x, y: point.y };
    return {
        type: 'line',
        construction: 'xline',
        point: pt,
        basePoint: pt,
        unitVector: { x: dir.x, y: dir.y },
        start: { x: pt.x - dir.x * L, y: pt.y - dir.y * L },
        end: { x: pt.x + dir.x * L, y: pt.y + dir.y * L },
        layer: options.layer || '0',
        color: options.color,
        lineType: options.lineType,
        lineWeight: options.lineWeight,
    };
}

export function createRay(point, dirOrAngle, options = {}) {
    let dir;
    if (typeof dirOrAngle === 'number') {
        dir = { x: Math.cos(dirOrAngle), y: Math.sin(dirOrAngle) };
    } else {
        const len = Math.hypot(dirOrAngle.x, dirOrAngle.y);
        if (len < 1e-12) dir = { x: 1, y: 0 };
        else dir = { x: dirOrAngle.x / len, y: dirOrAngle.y / len };
    }
    const L = options.length ?? CONSTRUCTION_LINE_LENGTH;
    const pt = { x: point.x, y: point.y };
    return {
        type: 'line',
        construction: 'ray',
        point: pt,
        basePoint: pt,
        unitVector: { x: dir.x, y: dir.y },
        start: pt,
        end: { x: pt.x + dir.x * L, y: pt.y + dir.y * L },
        layer: options.layer || '0',
        color: options.color,
        lineType: options.lineType,
        lineWeight: options.lineWeight,
    };
}

export function xlineBisector(vertex, p1, p2, options = {}) {
    const a1 = angleOf(vertex, p1);
    const a2 = angleOf(vertex, p2);
    const sweep = sweepCCW(a1, a2);
    const bisAngle = normalizeAngle(a1 + sweep / 2);
    const dir = { x: Math.cos(bisAngle), y: Math.sin(bisAngle) };
    return createXline(vertex, dir, options);
}

export function xlineOffsetDistance(entity, offsetDist, sidePoint, options = {}) {
    let p1 = entity.start;
    let p2 = entity.end;
    if (!p1 || !p2) {
        if (entity.point && entity.unitVector) {
            p1 = entity.point;
            p2 = add(entity.point, entity.unitVector);
        } else {
            throw new Error('Entidade não possui pontos para cálculo de deslocamento.');
        }
    }
    const d = sub(p2, p1);
    const len = Math.hypot(d.x, d.y);
    if (len < 1e-12) throw new Error('Comprimento de linha zero.');
    const u = { x: d.x / len, y: d.y / len };
    const n = { x: -u.y, y: u.x };
    const toSide = sub(sidePoint, p1);
    const sideDot = dot(toSide, n);
    const sign = sideDot >= 0 ? 1 : -1;
    const base = entity.point ?? p1;
    const offsetPoint = {
        x: base.x + sign * offsetDist * n.x,
        y: base.y + sign * offsetDist * n.y,
    };
    return createXline(offsetPoint, u, options);
}

export function xlineOffsetThrough(entity, throughPoint, options = {}) {
    let p1 = entity.start;
    let p2 = entity.end;
    if (!p1 || !p2) {
        if (entity.point && entity.unitVector) {
            p1 = entity.point;
            p2 = add(entity.point, entity.unitVector);
        } else {
            throw new Error('Entidade não possui pontos para cálculo de deslocamento.');
        }
    }
    const d = sub(p2, p1);
    const len = Math.hypot(d.x, d.y);
    if (len < 1e-12) throw new Error('Comprimento de linha zero.');
    const u = { x: d.x / len, y: d.y / len };
    return createXline(throughPoint, u, options);
}

export function createRectangleEntity(a, b, { fillet = 0, chamfer1 = 0, chamfer2 = 0, width = 0, rotation = 0, layer = undefined } = {}) {
    const rotRad = (rotation * Math.PI) / 180;
    const bLoc = rotRad !== 0 ? rotatePoint(b, a, -rotRad) : b;
    const w = bLoc.x - a.x;
    const h = bLoc.y - a.y;
    const absW = Math.abs(w);
    const absH = Math.abs(h);
    const sx = w >= 0 ? 1 : -1;
    const sy = h >= 0 ? 1 : -1;

    let vertices = [];

    if (fillet > 0 && absW > 1e-4 && absH > 1e-4) {
        const r = Math.min(fillet, absW / 2, absH / 2);
        const bulge = (Math.SQRT2 - 1) * (sx * sy > 0 ? 1 : -1);

        const c0_entry = { x: a.x, y: a.y + r * sy };
        const c0_exit = { x: a.x + r * sx, y: a.y };

        const c1_entry = { x: a.x + (absW - r) * sx, y: a.y };
        const c1_exit = { x: a.x + absW * sx, y: a.y + r * sy };

        const c2_entry = { x: a.x + absW * sx, y: a.y + (absH - r) * sy };
        const c2_exit = { x: a.x + (absW - r) * sx, y: a.y + absH * sy };

        const c3_entry = { x: a.x + r * sx, y: a.y + absH * sy };
        const c3_exit = { x: a.x, y: a.y + (absH - r) * sy };

        vertices = [
            { ...c0_exit, bulge: 0 },
            { ...c1_entry, bulge },
            { ...c1_exit, bulge: 0 },
            { ...c2_entry, bulge },
            { ...c2_exit, bulge: 0 },
            { ...c3_entry, bulge },
            { ...c3_exit, bulge: 0 },
            { ...c0_entry, bulge },
        ];
    } else if ((chamfer1 > 0 || chamfer2 > 0) && absW > 1e-4 && absH > 1e-4) {
        const c1 = Math.min(chamfer1 || chamfer2, absW / 2);
        const c2 = Math.min(chamfer2 || chamfer1, absH / 2);

        const v0 = { x: a.x + c1 * sx, y: a.y };
        const v1 = { x: a.x + (absW - c1) * sx, y: a.y };
        const v2 = { x: a.x + absW * sx, y: a.y + c2 * sy };
        const v3 = { x: a.x + absW * sx, y: a.y + (absH - c2) * sy };
        const v4 = { x: a.x + (absW - c1) * sx, y: a.y + absH * sy };
        const v5 = { x: a.x + c1 * sx, y: a.y + absH * sy };
        const v6 = { x: a.x, y: a.y + (absH - c2) * sy };
        const v7 = { x: a.x, y: a.y + c2 * sy };

        vertices = [v0, v1, v2, v3, v4, v5, v6, v7].map((p) => ({ ...p, bulge: 0 }));
    } else {
        const c0 = { x: a.x, y: a.y };
        const c1 = { x: a.x + w, y: a.y };
        const c2 = { x: a.x + w, y: a.y + h };
        const c3 = { x: a.x, y: a.y + h };
        vertices = [c0, c1, c2, c3].map((p) => ({ ...p, bulge: 0 }));
    }

    if (rotRad !== 0) {
        vertices = vertices.map((v) => ({
            ...rotatePoint(v, a, rotRad),
            bulge: v.bulge,
        }));
    }

    return {
        type: 'polyline',
        closed: true,
        vertices,
        ...(width > 0 ? { constantWidth: width } : {}),
        ...(layer ? { layer } : {}),
    };
}

export function polylineFillet(entity, radius) {
    if (entity.type !== 'polyline' || !Array.isArray(entity.vertices) || entity.vertices.length < 3 || radius <= 0) {
        return entity;
    }
    const verts = entity.vertices;
    const n = verts.length;
    const closed = Boolean(entity.closed);
    const newVerts = [];

    const count = closed ? n : n - 2;
    const startIdx = closed ? 0 : 1;

    for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) {
            newVerts.push({ ...verts[i] });
            continue;
        }

        const prevIdx = (i - 1 + n) % n;
        const nextIdx = (i + 1) % n;
        const prev = verts[prevIdx];
        const curr = verts[i];
        const next = verts[nextIdx];

        if (Math.abs(prev.bulge ?? 0) > 1e-4 || Math.abs(curr.bulge ?? 0) > 1e-4) {
            newVerts.push({ ...curr });
            continue;
        }

        const v1 = sub(prev, curr);
        const v2 = sub(next, curr);
        const l1 = Math.hypot(v1.x, v1.y);
        const l2 = Math.hypot(v2.x, v2.y);
        if (l1 < 1e-6 || l2 < 1e-6) {
            newVerts.push({ ...curr });
            continue;
        }

        const u1 = { x: v1.x / l1, y: v1.y / l1 };
        const u2 = { x: v2.x / l2, y: v2.y / l2 };
        const d = dot(u1, u2);
        if (Math.abs(d) > 0.9999) {
            newVerts.push({ ...curr });
            continue;
        }

        const angle = Math.acos(Math.max(-1, Math.min(1, d)));
        const halfAngle = angle / 2;
        const tanHalf = Math.tan(halfAngle);
        if (tanHalf < 1e-4) {
            newVerts.push({ ...curr });
            continue;
        }

        const t = radius / tanHalf;
        if (t > l1 * 0.49 || t > l2 * 0.49) {
            newVerts.push({ ...curr });
            continue;
        }

        const p1 = add(curr, scale(u1, t));
        const p2 = add(curr, scale(u2, t));
        const sweep = Math.PI - angle;
        // u1 aponta para trás (curr→prev): a curva é à esquerda quando cross(u1, u2) < 0.
        const bulgeSign = cross(u1, u2) < 0 ? 1 : -1;
        const bulge = bulgeSign * Math.tan(sweep / 4);

        newVerts.push({ ...p1, bulge });
        newVerts.push({ ...p2, bulge: 0 });
    }

    return { ...entity, vertices: newVerts };
}

export function polylineChamfer(entity, d1, d2) {
    if (entity.type !== 'polyline' || !Array.isArray(entity.vertices) || entity.vertices.length < 3 || d1 <= 0 || d2 <= 0) {
        return entity;
    }
    const verts = entity.vertices;
    const n = verts.length;
    const closed = Boolean(entity.closed);
    const newVerts = [];

    for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) {
            newVerts.push({ ...verts[i] });
            continue;
        }

        const prevIdx = (i - 1 + n) % n;
        const nextIdx = (i + 1) % n;
        const prev = verts[prevIdx];
        const curr = verts[i];
        const next = verts[nextIdx];

        if (Math.abs(prev.bulge ?? 0) > 1e-4 || Math.abs(curr.bulge ?? 0) > 1e-4) {
            newVerts.push({ ...curr });
            continue;
        }

        const v1 = sub(prev, curr);
        const v2 = sub(next, curr);
        const l1 = Math.hypot(v1.x, v1.y);
        const l2 = Math.hypot(v2.x, v2.y);
        if (l1 < 1e-6 || l2 < 1e-6 || d1 > l1 * 0.49 || d2 > l2 * 0.49) {
            newVerts.push({ ...curr });
            continue;
        }

        const u1 = { x: v1.x / l1, y: v1.y / l1 };
        const u2 = { x: v2.x / l2, y: v2.y / l2 };

        const p1 = add(curr, scale(u1, d1));
        const p2 = add(curr, scale(u2, d2));

        newVerts.push({ ...p1, bulge: 0 });
        newVerts.push({ ...p2, bulge: 0 });
    }

    return { ...entity, vertices: newVerts };
}

export function createRevcloudFromEntity(entity, arcLength = 15, reverse = false) {
    const rawBulge = 0.52; // Arco de aprox. 110 graus
    const bulge = reverse ? -rawBulge : rawBulge;

    if (entity.type === 'circle') {
        const center = entity.center;
        const r = entity.radius;
        const perimeter = 2 * Math.PI * r;
        const count = Math.max(4, Math.round(perimeter / arcLength));
        const vertices = [];
        for (let i = 0; i < count; i++) {
            const angle = (i * 2 * Math.PI) / count;
            vertices.push({ ...polar(center, angle, r), bulge });
        }
        return {
            type: 'polyline',
            closed: true,
            vertices,
            layer: entity.layer,
        };
    }

    if (entity.type === 'polyline') {
        const curves = polylineCurves(entity.vertices, entity.closed);
        const vertices = [];
        curves.forEach((c) => {
            const len = c.kind === 'segment' ? distance(c.a, c.b) : (c.radius * sweepCCW(c.start, c.end));
            const steps = Math.max(1, Math.round(len / arcLength));
            for (let s = 0; s < steps; s++) {
                const t = s / steps;
                let pt;
                if (c.kind === 'segment') {
                    pt = add(c.a, scale(sub(c.b, c.a), t));
                } else {
                    const ang = c.start + sweepCCW(c.start, c.end) * t;
                    pt = polar(c.center, ang, c.radius);
                }
                vertices.push({ ...pt, bulge });
            }
        });
        if (vertices.length >= 3) {
            return {
                type: 'polyline',
                closed: true,
                vertices,
                layer: entity.layer,
            };
        }
    }

    return null;
}

export function distanceToEntity(p, entity) {
    if (!entity) return Infinity;
    const curves = entityCurves(entity);
    if (!curves.length) return Infinity;
    let minDist = Infinity;
    for (const c of curves) {
        const closest = closestPointOnCurve(p, c);
        const d = distance(p, closest);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

export function polygonAreaAndPerimeter(points) {
    if (!points || points.length < 3) return { area: 0, perimeter: 0 };
    let area = 0;
    let perimeter = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        area += a.x * b.y - b.x * a.y;
        perimeter += distance(a, b);
    }
    return {
        area: Math.abs(area) / 2,
        perimeter,
    };
}

export function polylineArea(entity) {
    const v = entity.vertices;
    if (!v || v.length < 2) return 0;
    let area = 0;
    for (let i = 0; i < v.length; i += 1) {
        const a = v[i];
        const b = v[(i + 1) % v.length];
        area += a.x * b.y - b.x * a.y;
        if (a.bulge) {
            const arcSeg = bulgeToArc(a, b, a.bulge);
            const sweep = sweepCCW(arcSeg.start, arcSeg.end);
            const segmentArea = (arcSeg.radius ** 2 / 2) * (sweep - Math.sin(sweep));
            area += 2 * segmentArea * Math.sign(a.bulge);
        }
    }
    return area / 2;
}

export function getEntityAreaAndPerimeter(entity) {
    if (!entity) return null;
    if (entity.type === 'circle') {
        return {
            area: Math.PI * entity.radius ** 2,
            perimeter: 2 * Math.PI * entity.radius,
        };
    }
    if (entity.type === 'polyline' && entity.closed) {
        return {
            area: Math.abs(polylineArea(entity)),
            perimeter: entityLength(entity),
        };
    }
    if (entity.type === 'ellipse') {
        const a = Math.hypot(entity.major.x, entity.major.y);
        const b = a * entity.ratio;
        const h = ((a - b) ** 2) / ((a + b) ** 2);
        const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
        return {
            area: Math.PI * a * b,
            perimeter,
        };
    }
    return null;
}

export function pointInPolygon(p, vertices) {
    if (!p || !vertices || vertices.length < 3) return false;
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, yi = vertices[i].y;
        const xj = vertices[j].x, yj = vertices[j].y;
        const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

