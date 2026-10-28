import {FONT_FAMILIES} from './fonts.js';
import {addEntities,replaceEntities,removeEntities,isEntityEditable} from './document.js';
import {sub,emptyBox,boxAddPoint,distance,polylineCurves,curveMidpoint,entityLength,sweepCCW,radToDeg,degToRad,angleOf,normalizeAngle,formatNumber} from './geometry.js';
import {stretchDocument,chamferLines,polylineChamfer,breakAtPoint,geometryFields,setGeometryField,lengthenEntity,divideEntity,measureEntity,convertEntityToPolyline,setPolylineWidth,setPolylineClosed,reversePolyline,fitPolyline,splinePolyline,decurvePolyline,joinToPolyline,createXline,createRay,xlineBisector,xlineOffsetDistance,xlineOffsetThrough} from './edit-tools.js';
import {DIMENSION_LAYER,ensureDimensionSetup} from './dimensions.js';

async function editTextStyle(e,dimension=false){
    const key=dimension?'dimStyle':'textStyle',current=e.doc[key]??{};
    e.log(FONT_FAMILIES.join(', '));
    const fontFamily=await e.getString('Família da fonte',{defaultValue:current.fontFamily??'Liberation Sans'});
    if(!FONT_FAMILIES.includes(fontFamily))throw new Error('Escolha uma família listada.');
    const bold=(await e.getKeyword('Negrito',[{key:'s',label:'Sim'},{key:'n',label:'Não'}],current.bold?'s':'n')).key==='s';
    const italic=(await e.getKeyword('Itálico',[{key:'s',label:'Sim'},{key:'n',label:'Não'}],current.italic?'s':'n')).key==='s';
    const style={...current,fontFamily,bold,italic};
    if(dimension){style.textHeight=await e.getNumber('Altura de texto',{defaultValue:current.textHeight??2.5,min:0.01});style.textGap=await e.getNumber('Folga entre texto e linha',{defaultValue:current.textGap??0.9,min:0});}
    e.commit(dimension?'Estilo das cotas':'Estilo de texto',{...e.doc,[key]:style});
}

async function peditEditVertex(e, polyline) {
    let current = e.doc.entities.find((x) => x.id === polyline.id) || polyline;
    let index = 0;
    for (;;) {
        current = e.doc.entities.find((x) => x.id === polyline.id) || current;
        const total = current.vertices.length;
        if (total === 0) break;
        if (index >= total) index = total - 1;
        const v = current.vertices[index];
        e.log(`Vértice ${index + 1} de ${total}: (${formatNumber(v.x, 4)}, ${formatNumber(v.y, 4)})${v.bulge ? ` [bulge: ${formatNumber(v.bulge, 4)}]` : ''}`);

        const opt = await e.getKeyword('Opção de vértice', [
            { key: 'n', label: 'Próximo' },
            { key: 'p', label: 'Anterior' },
            { key: 'i', label: 'Inserir' },
            { key: 'r', label: 'Remover' },
            { key: 'x', label: 'Sair' },
        ], 'n');
        if (!opt || opt.key === 'x') break;

        if (opt.key === 'n') {
            index = (index + 1) % total;
        } else if (opt.key === 'p') {
            index = (index - 1 + total) % total;
        } else if (opt.key === 'i') {
            const ptRes = await e.getPoint('Especifique a localização para o novo vértice:');
            if (ptRes.point) {
                const vertices = structuredClone(current.vertices);
                vertices.splice(index + 1, 0, { ...ptRes.point, bulge: 0 });
                const updated = { ...current, vertices };
                e.commit('Inserir vértice', replaceEntities(e.doc, new Map([[current.id, updated]])));
                index += 1;
            }
        } else if (opt.key === 'r') {
            if (total <= (current.closed ? 3 : 2)) {
                e.log('Não é possível reduzir mais esta polilinha.', 'warn');
                continue;
            }
            const vertices = structuredClone(current.vertices);
            vertices.splice(index, 1);
            if (index >= vertices.length) index = vertices.length - 1;
            const updated = { ...current, vertices };
            e.commit('Remover vértice', replaceEntities(e.doc, new Map([[current.id, updated]])));
        }
    }
}

const PURGE_EPS = 1e-9;

function isZeroLength(entity) {
    switch (entity.type) {
        case 'line': return distance(entity.start, entity.end) < PURGE_EPS;
        case 'circle':
        case 'arc': return !(entity.radius > PURGE_EPS);
        case 'polyline':
        case 'spline':
        case 'ellipse':
            try { return !(entityLength(entity) > PURGE_EPS); } catch { return false; }
        default: return false;
    }
}

const isEmptyText = (entity) => entity.type === 'text' && String(entity.text ?? '').trim() === '';

// Equivalente ao PURGE do BricsCAD: remove o que não é referenciado. Blocos usados
// são seguidos até os aninhados, e camadas só valem se usadas por algo que fica.
// Camada 0, camada atual e entidades em camada bloqueada são preservadas.
export function purgeDocument(doc, { layers = true, blocks = true, zeroLength = true, emptyText = true } = {}) {
    const removed = { layers: [], blocks: [], zeroLength: 0, emptyText: 0 };
    let entities = doc.entities;
    if (zeroLength || emptyText) {
        entities = entities.filter((x) => {
            if (!isEntityEditable(doc, x)) return true;
            if (zeroLength && isZeroLength(x)) { removed.zeroLength++; return false; }
            if (emptyText && isEmptyText(x)) { removed.emptyText++; return false; }
            return true;
        });
    }
    let blockDefs = { ...(doc.blocks ?? {}) };
    const usedBlocks = () => {
        const used = new Set();
        const visit = (list) => {
            for (const x of list) {
                if (x.type !== 'insert' || used.has(x.name)) continue;
                used.add(x.name);
                visit(blockDefs[x.name]?.entities ?? x.definition?.entities ?? []);
            }
        };
        visit(entities);
        return used;
    };
    if (blocks) {
        const used = usedBlocks();
        for (const name of Object.keys(blockDefs)) {
            if (used.has(name)) continue;
            delete blockDefs[name];
            removed.blocks.push(name);
        }
    }
    let docLayers = doc.layers;
    if (layers) {
        const used = new Set(['0', doc.currentLayer]);
        const visit = (list) => list.forEach((x) => {
            used.add(x.layer);
            if (x.type === 'insert') visit(blockDefs[x.name]?.entities ?? x.definition?.entities ?? []);
        });
        visit(entities);
        Object.values(blockDefs).forEach((b) => visit(b.entities ?? []));
        docLayers = doc.layers.filter((l) => {
            if (used.has(l.name)) return true;
            removed.layers.push(l.name);
            return false;
        });
    }
    return { doc: { ...doc, entities, layers: docLayers, ...(doc.blocks ? { blocks: blockDefs } : {}) }, removed };
}

// Parte "linhas sobrepostas" do OVERKILL do BricsCAD: linhas colineares da mesma
// camada que se sobrepõem viram uma só. Linhas que apenas se tocam na ponta ficam
// separadas, porque formam o contorno. Devolve as linhas a substituir e a remover.
// Última tolerância usada no OVERKILL, como no BricsCAD.
let overkillTolerance = 1e-3;

export function mergeOverlappingLines(lines, tol = 1e-3) {
    const groups = [];
    for (const line of lines) {
        const len = distance(line.start, line.end);
        if (len <= tol) continue;
        let ux = (line.end.x - line.start.x) / len, uy = (line.end.y - line.start.y) / len;
        if (ux < -1e-12 || (Math.abs(ux) <= 1e-12 && uy < 0)) { ux = -ux; uy = -uy; }
        const offset = line.start.x * uy - line.start.y * ux;
        const group = groups.find(g => g.layer === line.layer
            && Math.abs(g.ux * uy - g.uy * ux) * Math.max(g.reach, len) <= tol
            && Math.abs(line.start.x * g.uy - line.start.y * g.ux - g.offset) <= tol
            && Math.abs(line.end.x * g.uy - line.end.y * g.ux - g.offset) <= tol);
        const t = p => p.x * (group ?? { ux }).ux + p.y * (group ?? { uy }).uy;
        const item = { line, a: Math.min(t(line.start), t(line.end)), b: Math.max(t(line.start), t(line.end)) };
        if (group) { group.items.push(item); group.reach = Math.max(group.reach, len); }
        else groups.push({ layer: line.layer, ux, uy, offset, reach: len, items: [item] });
    }
    const replacements = new Map(), removed = new Set();
    for (const g of groups) {
        if (g.items.length < 2) continue;
        g.items.sort((p, q) => p.a - q.a);
        const runs = [];
        for (const item of g.items) {
            const run = runs[runs.length - 1];
            if (run && item.a < run.b - tol) { run.items.push(item); run.b = Math.max(run.b, item.b); }
            else runs.push({ a: item.a, b: item.b, items: [item] });
        }
        for (const run of runs) {
            if (run.items.length < 2) continue;
            const keep = run.items.reduce((m, x) => (x.b - x.a > m.b - m.a ? x : m)).line;
            const at = v => ({ x: g.ux * v + g.uy * g.offset, y: g.uy * v - g.ux * g.offset });
            const forward = (keep.end.x - keep.start.x) * g.ux + (keep.end.y - keep.start.y) * g.uy >= 0;
            replacements.set(keep.id, { ...keep, start: at(forward ? run.a : run.b), end: at(forward ? run.b : run.a) });
            run.items.forEach(x => { if (x.line !== keep) removed.add(x.line.id); });
        }
    }
    return { replacements, removed };
}

// Desfaz o pincel num objeto: as propriedades que o MATCHPROP copia voltam ao valor anterior; a geometria fica a atual.
const BRUSH_KEYS=['layer','color','lineType','lineWeight','textHeight','style','height','fontFamily','bold','italic','arrowSize','scale','tolerance'];
function restoreProperties(current,original){
    const next={...current};
    for(const key of BRUSH_KEYS){
        if(key in original)next[key]=structuredClone(original[key]);
        else delete next[key];
    }
    return next;
}

// Pincel do MATCHPROP: aplica as propriedades da referência a um destino.
function matchProperties(e,source,target0){
    const target={
        ...target0,
        layer:source.layer,
        color:source.color,
        lineType:source.lineType,
        lineWeight:source.lineWeight,
    };
    if (target0.type === 'dimension') {
        const textHeight = source.type === 'dimension'
            ? (source.textHeight ?? source.style?.textHeight ?? e.doc.dimStyle?.textHeight ?? 2.5)
            : (source.type === 'text' ? (source.height ?? 2.5) : undefined);
        if (textHeight !== undefined) {
            target.textHeight = textHeight;
            target.style = {
                ...(target.style ?? {}),
                ...(source.type === 'dimension' ? (source.style ?? {}) : {}),
                textHeight,
            };
        }
        if (source.fontFamily !== undefined) target.fontFamily = source.fontFamily;
        if (source.bold !== undefined) target.bold = source.bold;
        if (source.italic !== undefined) target.italic = source.italic;
        if (source.type === 'dimension') {
            if (source.arrowSize !== undefined) target.arrowSize = source.arrowSize;
            if (source.scale !== undefined) target.scale = source.scale;
            if (source.tolerance !== undefined) target.tolerance = structuredClone(source.tolerance);
        }
    } else if (target0.type === 'text') {
        const textHeight = source.type === 'text'
            ? (source.height ?? 2.5)
            : (source.type === 'dimension' ? (source.textHeight ?? source.style?.textHeight ?? e.doc.dimStyle?.textHeight ?? 2.5) : undefined);
        if (textHeight !== undefined) target.height = textHeight;
        if (source.fontFamily !== undefined) target.fontFamily = source.fontFamily;
        if (source.bold !== undefined) target.bold = source.bold;
        if (source.italic !== undefined) target.italic = source.italic;
    }
    return target;
}

export const EDIT_COMMANDS = {
    TEXTEDIT:{aliases:['DDEDIT','ED','EDITARTEXTO'],description:'Editar conteúdo e propriedades do texto',async run(e){
        let target=null;
        if(e.selection.size===1){
            const id=Array.from(e.selection)[0];
            const ent=e.doc.entities.find(x=>x.id===id);
            if(ent&&ent.type==='text')target=ent;
        }
        if(!target){
            const hit=await e.getEntity('Selecione o texto para editar:',{filter:x=>x.type==='text'});
            if(hit)target=hit.entity;
        }
        if(target){
            e.openTextEditor(target);
        }
    }},
    TEXTSTYLE:{aliases:['ESTILOTEXTO'],description:'Fonte padrão dos novos textos',run:e=>editTextStyle(e)},
    DIMSTYLE:{aliases:['ESTILOCOTA'],description:'Fonte, altura e afastamento das cotas',run:e=>editTextStyle(e,true)},
    VERTEX:{aliases:['VERTICE'],description:'Editar vértice: inserir ponto intermediário ou remover',async run(e){
        const hit=await e.getEntity('Polilinha',{filter:x=>x.type==='polyline'});if(!hit)return;
        if(!isEntityEditable(e.doc,hit.entity))throw new Error('Layer bloqueado.');
        const entity=hit.entity;
        const option=await e.getKeyword('Operação',[{key:'i',label:'Inserir'},{key:'r',label:'Remover'}],'i');
        const index=(await e.getNumber('Número do vértice (1 = primeiro)',{min:1,max:entity.vertices.length}))-1;
        if(!Number.isInteger(index)||!entity.vertices[index])throw new Error('Vértice inválido.');
        const vertices=structuredClone(entity.vertices);
        if(option.key==='i'){
            const curve=polylineCurves(vertices,entity.closed)[index];if(!curve)throw new Error('Último vértice sem segmento seguinte.');
            const mid=curveMidpoint(curve);const bulge=vertices[index].bulge??0;
            const half=bulge?Math.tan(Math.atan(bulge)/2):0;
            vertices[index].bulge=half;vertices.splice(index+1,0,{...mid,bulge:half});
        }else{
            if(vertices.length<=(entity.closed?3:2))throw new Error('Não é possível reduzir mais esta polilinha.');
            const prev=(index-1+vertices.length)%vertices.length;
            if(vertices[index].bulge||vertices[prev].bulge)throw new Error('Remoção junto a arco exige converter os segmentos em linhas primeiro.');
            vertices.splice(index,1);
        }
        e.commit('Editar vértice',replaceEntities(e.doc,new Map([[entity.id,{...entity,vertices}]])));
    }},
    PEDIT: {
        aliases: ['PE', 'EDITARP'],
        description: 'Editar polilinhas: Unir, Largura, Ajustar, Spline, Inverter, Fechar/Abrir',
        async run(e) {
            let selectedEnts = [];
            if (e.selection && e.selection.size > 0) {
                selectedEnts = e.entitiesById(Array.from(e.selection));
            }

            let polyline;
            let multiple = false;

            if (selectedEnts.length === 1 && ['polyline', 'line', 'arc'].includes(selectedEnts[0].type)) {
                polyline = selectedEnts[0];
            } else if (selectedEnts.length > 1) {
                const filtered = selectedEnts.filter((x) => ['polyline', 'line', 'arc'].includes(x.type));
                if (filtered.length > 0) {
                    multiple = true;
                    selectedEnts = filtered;
                }
            }

            if (!polyline && !multiple) {
                const hit = await e.getEntity('PEDIT: Selecione a polilinha ou [Múltiplo]:', {
                    options: [{ key: 'm', label: 'Múltiplo' }],
                    filter: (x) => ['polyline', 'line', 'arc'].includes(x.type),
                });
                if (!hit) return;
                if (hit.keyword === 'm') {
                    multiple = true;
                    const ids = await e.getSelection('Selecione objetos:');
                    selectedEnts = e.entitiesById(ids).filter((x) => ['polyline', 'line', 'arc'].includes(x.type));
                    if (selectedEnts.length === 0) return e.log('Nenhum objeto selecionado.', 'warn');
                } else {
                    polyline = hit.entity;
                }
            }

            if (!multiple) {
                if (!isEntityEditable(e.doc, polyline)) throw new Error('Layer bloqueado.');
                if (polyline.type === 'line' || polyline.type === 'arc') {
                    const ans = await e.getKeyword('O objeto selecionado não é uma polilinha. Transformar em polilinha?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 's');
                    if (ans.key !== 's') return;
                    const converted = convertEntityToPolyline(polyline);
                    e.commit('Converter para polilinha', replaceEntities(e.doc, new Map([[polyline.id, converted]])));
                    polyline = converted;
                }

                while (true) {
                    const current = e.doc.entities.find((x) => x.id === polyline.id);
                    if (!current) break;
                    polyline = current;

                    const isClosed = Boolean(polyline.closed);
                    const options = [
                        isClosed ? { key: 'o', label: 'Abrir' } : { key: 'c', label: 'Fechar' },
                        { key: 'j', label: 'Unir' },
                        { key: 'w', label: 'Largura' },
                        { key: 'f', label: 'Ajustar' },
                        { key: 's', label: 'Spline' },
                        { key: 'd', label: 'Decurvar' },
                        { key: 'r', label: 'Inverter' },
                        { key: 'e', label: 'Editar vértice' },
                        { key: 'u', label: 'Desfazer' },
                        { key: 'x', label: 'Sair' },
                    ];

                    const res = await e.request('keyword', 'Informe uma opção', {
                        options,
                        defaultValue: 'Sair',
                        allowEnter: true,
                    });
                    if (!res || !res.option || res.option.key === 'x') break;

                    const key = res.option.key;
                    if (key === 'c') {
                        const updated = setPolylineClosed(polyline, true);
                        e.commit('Fechar polilinha', replaceEntities(e.doc, new Map([[polyline.id, updated]])));
                        e.log('Polilinha fechada.');
                    } else if (key === 'o') {
                        const updated = setPolylineClosed(polyline, false);
                        e.commit('Abrir polilinha', replaceEntities(e.doc, new Map([[polyline.id, updated]])));
                        e.log('Polilinha aberta.');
                    } else if (key === 'j') {
                        const ids = await e.getSelection('Selecione objetos para unir:');
                        const candidates = e.entitiesById(ids).filter((x) => x.id !== polyline.id && ['line', 'arc', 'polyline'].includes(x.type));
                        const joinRes = joinToPolyline(polyline, candidates);
                        if (joinRes.joinedIds.length > 0) {
                            let doc = removeEntities(e.doc, joinRes.joinedIds);
                            doc = replaceEntities(doc, new Map([[polyline.id, joinRes.polyline]]));
                            e.commit('Unir à polilinha', doc);
                            e.log(`${joinRes.joinedIds.length} segmento(s) unido(s) à polilinha.`);
                            polyline = joinRes.polyline;
                        } else {
                            e.log('Nenhum objeto conectado encontrado.', 'warn');
                        }
                    } else if (key === 'w') {
                        const width = await e.getNumber('Especifique nova largura para todos os segmentos', {
                            defaultValue: polyline.constantWidth ?? 0,
                            min: 0,
                        });
                        const updated = setPolylineWidth(polyline, width);
                        e.commit('Largura da polilinha', replaceEntities(e.doc, new Map([[polyline.id, updated]])));
                        e.log(`Largura definida para ${width}.`);
                    } else if (key === 'f') {
                        const updated = fitPolyline(polyline);
                        e.commit('Ajustar polilinha', replaceEntities(e.doc, new Map([[polyline.id, updated]])));
                        e.log('Polilinha ajustada com arcos suaves.');
                    } else if (key === 's') {
                        const updated = splinePolyline(polyline);
                        e.commit('Spline polilinha', replaceEntities(e.doc, new Map([[polyline.id, updated]])));
                        e.log('Polilinha suavizada por Spline.');
                    } else if (key === 'd') {
                        const updated = decurvePolyline(polyline);
                        e.commit('Decurvar polilinha', replaceEntities(e.doc, new Map([[polyline.id, updated]])));
                        e.log('Curvatura removida.');
                    } else if (key === 'r') {
                        const updated = reversePolyline(polyline);
                        e.commit('Inverter polilinha', replaceEntities(e.doc, new Map([[polyline.id, updated]])));
                        e.log('Sentido da polilinha invertido.');
                    } else if (key === 'e') {
                        await peditEditVertex(e, polyline);
                    } else if (key === 'u') {
                        e.undo();
                    }
                }
            } else {
                // Modo Múltiplo
                const nonPoly = selectedEnts.filter((x) => x.type === 'line' || x.type === 'arc');
                if (nonPoly.length > 0) {
                    const ans = await e.getKeyword('Converter linhas e arcos em polilinhas?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 's');
                    if (ans.key === 's') {
                        const replacements = new Map();
                        selectedEnts = selectedEnts.map((ent) => {
                            if (ent.type === 'line' || ent.type === 'arc') {
                                const p = convertEntityToPolyline(ent);
                                replacements.set(ent.id, p);
                                return p;
                            }
                            return ent;
                        });
                        e.commit('Converter em polilinhas', replaceEntities(e.doc, replacements));
                    }
                }

                while (true) {
                    const options = [
                        { key: 'c', label: 'Fechar' },
                        { key: 'o', label: 'Abrir' },
                        { key: 'j', label: 'Unir' },
                        { key: 'w', label: 'Largura' },
                        { key: 'f', label: 'Ajustar' },
                        { key: 's', label: 'Spline' },
                        { key: 'd', label: 'Decurvar' },
                        { key: 'r', label: 'Inverter' },
                        { key: 'u', label: 'Desfazer' },
                        { key: 'x', label: 'Sair' },
                    ];
                    const res = await e.request('keyword', 'Informe uma opção para múltiplas polilinhas', {
                        options,
                        defaultValue: 'Sair',
                        allowEnter: true,
                    });
                    if (!res || !res.option || res.option.key === 'x') break;

                    const key = res.option.key;
                    const currentList = selectedEnts.map((s) => e.doc.entities.find((x) => x.id === s.id)).filter(Boolean);
                    if (currentList.length === 0) break;

                    if (key === 'c' || key === 'o') {
                        const closed = key === 'c';
                        const replacements = new Map(currentList.map((p) => [p.id, setPolylineClosed(p, closed)]));
                        e.commit(closed ? 'Fechar polilinhas' : 'Abrir polilinhas', replaceEntities(e.doc, replacements));
                        e.log(`${currentList.length} polilinha(s) ${closed ? 'fechada(s)' : 'aberta(s)'}.`);
                    } else if (key === 'w') {
                        const width = await e.getNumber('Especifique nova largura para todos os segmentos', { defaultValue: 0, min: 0 });
                        const replacements = new Map(currentList.map((p) => [p.id, setPolylineWidth(p, width)]));
                        e.commit('Largura de polilinhas', replaceEntities(e.doc, replacements));
                        e.log(`Largura definida para ${width} em ${currentList.length} polilinha(s).`);
                    } else if (key === 'f') {
                        const replacements = new Map(currentList.map((p) => [p.id, fitPolyline(p)]));
                        e.commit('Ajustar polilinhas', replaceEntities(e.doc, replacements));
                    } else if (key === 's') {
                        const replacements = new Map(currentList.map((p) => [p.id, splinePolyline(p)]));
                        e.commit('Spline em polilinhas', replaceEntities(e.doc, replacements));
                    } else if (key === 'd') {
                        const replacements = new Map(currentList.map((p) => [p.id, decurvePolyline(p)]));
                        e.commit('Decurvar polilinhas', replaceEntities(e.doc, replacements));
                    } else if (key === 'r') {
                        const replacements = new Map(currentList.map((p) => [p.id, reversePolyline(p)]));
                        e.commit('Inverter polilinhas', replaceEntities(e.doc, replacements));
                    } else if (key === 'j') {
                        let pool = [...currentList];
                        const toRemove = [];
                        const toReplace = new Map();
                        while (pool.length > 0) {
                            let base = pool.shift();
                            let others = [...pool];
                            const joinRes = joinToPolyline(base, others);
                            if (joinRes.joinedIds.length > 0) {
                                toRemove.push(...joinRes.joinedIds);
                                pool = pool.filter((p) => !joinRes.joinedIds.includes(p.id));
                                base = joinRes.polyline;
                            }
                            toReplace.set(base.id, base);
                        }
                        if (toRemove.length > 0) {
                            let doc = removeEntities(e.doc, toRemove);
                            doc = replaceEntities(doc, toReplace);
                            e.commit('Unir polilinhas', doc);
                            e.log(`${toRemove.length} objeto(s) incorporado(s) em polilinhas unidas.`);
                            selectedEnts = Array.from(toReplace.values());
                        } else {
                            e.log('Nenhum objeto com extremidades coincidentes para unir.', 'warn');
                        }
                    } else if (key === 'u') {
                        e.undo();
                    }
                }
            }
        },
    },
    STRETCH:{aliases:['S','ESTICAR'],description:'Esticar vértices dentro de uma região',async run(e){
        const a=(await e.getPoint('Primeiro canto da região a esticar')).point;
        const b=(await e.getPoint('Segundo canto da região',{reference:a})).point;
        const box=emptyBox();boxAddPoint(box,a);boxAddPoint(box,b);
        const base=(await e.getPoint('Ponto base do deslocamento')).point;
        const target=(await e.getPoint('Destino',{reference:base})).point;
        e.commit('Esticar região',stretchDocument(e.doc,box,sub(target,base)));
    }},
    CHAMFER:{aliases:['CHA','CHANFRO'],description:'Chanfro entre duas linhas por distâncias ou em polilinha',async run(e){
        e.memory = e.memory ?? {};
        let d1 = e.memory.chamfer1 ?? e.memory.chamfer ?? 5;
        let d2 = e.memory.chamfer2 ?? d1;
        let multiple = false;
        const fmtNum = (n) => typeof n === 'number' ? n.toFixed(2) : String(n);

        for (;;) {
            const options = [
                { key: 'd', label: 'Distância' },
                { key: 'a', label: 'Ângulo' },
                { key: 'p', label: 'PoliLinha' },
                { key: 'm', label: 'Múltiplo' },
                { key: 'u', label: 'Desfazer' },
            ];
            const first = await e.getEntity(`Selecione a primeira linha (d1=${fmtNum(d1)}, d2=${fmtNum(d2)}) ou [Distância/Ângulo/PoliLinha/Múltiplo/Desfazer]:`, {
                options,
                filter: (x) => x.type === 'line' || x.type === 'polyline',
            });
            if (!first) return;

            if (first.keyword === 'd') {
                d1 = await e.getNumber('Primeira distância do chanfro', { defaultValue: d1, min: 0 });
                d2 = await e.getNumber('Segunda distância do chanfro', { defaultValue: d1, min: 0 });
                e.memory.chamfer1 = d1;
                e.memory.chamfer2 = d2;
                e.memory.chamfer = d1;
                continue;
            }

            if (first.keyword === 'a') {
                d1 = await e.getNumber('Comprimento do chanfro na primeira linha', { defaultValue: d1, min: 0 });
                const angDeg = await e.getNumber('Ângulo do chanfro na primeira linha', { defaultValue: 45, min: 0.01 });
                d2 = d1 * Math.tan((angDeg * Math.PI) / 180);
                e.memory.chamfer1 = d1;
                e.memory.chamfer2 = d2;
                e.memory.chamfer = d1;
                continue;
            }

            if (first.keyword === 'm') {
                multiple = true;
                e.log('Modo múltiplo ativado.');
                continue;
            }

            if (first.keyword === 'u') {
                e.runCommand('UNDO');
                continue;
            }

            if (first.keyword === 'p') {
                const pickPline = await e.getEntity('Selecione a polilinha 2D:', {
                    filter: (x) => x.type === 'polyline',
                });
                if (!pickPline) continue;
                if (!isEntityEditable(e.doc, pickPline.entity)) throw new Error('Layer bloqueado.');
                const modified = polylineChamfer(pickPline.entity, d1, d2);
                e.commit('Chanfro na polilinha', replaceEntities(e.doc, new Map([[pickPline.entity.id, modified]])));
                if (!multiple) return;
                continue;
            }

            if (first.entity?.type === 'polyline') {
                if (!isEntityEditable(e.doc, first.entity)) throw new Error('Layer bloqueado.');
                const modified = polylineChamfer(first.entity, d1, d2);
                e.commit('Chanfro na polilinha', replaceEntities(e.doc, new Map([[first.entity.id, modified]])));
                if (!multiple) return;
                continue;
            }

            const second = await e.getEntity('Selecione a segunda linha:', {
                filter: (x) => x.type === 'line' && x.id !== first.entity.id,
            });
            if (!second) {
                if (multiple) continue;
                return;
            }

            if (!isEntityEditable(e.doc, first.entity) || !isEntityEditable(e.doc, second.entity)) {
                throw new Error('Layer bloqueado.');
            }

            const c = chamferLines(first.entity, second.entity, d1, d2);
            e.memory.chamfer1 = d1;
            e.memory.chamfer2 = d2;
            e.memory.chamfer = d1;

            e.commit('Chanfro', addEntities(replaceEntities(e.doc, new Map([[first.entity.id, c.first], [second.entity.id, c.second]])), [c.bridge]));
            if (!multiple) return;
        }
    }},
    BREAK:{aliases:['BR','BREAKATPOINT','QUEBRAR'],description:'Quebrar linha, arco ou polilinha aberta em um ponto',async run(e){
        const hit=await e.getEntity('Entidade a quebrar',{filter:x=>['line','arc','polyline'].includes(x.type)});if(!hit)return;
        const p=(await e.getPoint('Ponto da quebra')).point;
        if(!isEntityEditable(e.doc,hit.entity))throw new Error('Layer bloqueado.');
        e.commit('Quebrar',replaceEntities(e.doc,new Map([[hit.entity.id,breakAtPoint(hit.entity,p)]])));
    }},
    LENGTHEN: {
        aliases: ['LEN', 'ALONGAR'],
        description: 'Alterar o comprimento de objetos e o ângulo incluído de arcos',
        async run(e) {
            let mode = 'delta';
            let delta = e.memory.lengthenDelta ?? 10;
            let percent = e.memory.lengthenPercent ?? 100;
            let total = e.memory.lengthenTotal ?? 100;

            const options = [
                { key: 'de', label: 'DElta' },
                { key: 'p', label: 'Percent' },
                { key: 't', label: 'Total' },
                { key: 'dy', label: 'DYnamic' },
            ];

            for (;;) {
                const res = await e.getEntity('Selecione um objeto ou', {
                    options,
                    defaultValue: 'DElta',
                    allowEnter: true,
                    filter: (x) => ['line', 'arc', 'polyline'].includes(x.type) && !x.closed,
                });
                if (!res) return;
                if (res.keyword) {
                    if (res.keyword === 'de') {
                        delta = await e.getNumber('Informe o comprimento delta', { defaultValue: delta });
                        e.memory.lengthenDelta = delta;
                        mode = 'delta';
                        break;
                    } else if (res.keyword === 'p') {
                        percent = await e.getNumber('Informe a porcentagem do comprimento', { defaultValue: percent, min: 0.0001 });
                        e.memory.lengthenPercent = percent;
                        mode = 'percent';
                        break;
                    } else if (res.keyword === 't') {
                        total = await e.getNumber('Informe o comprimento total', { defaultValue: total, min: 0.0001 });
                        e.memory.lengthenTotal = total;
                        mode = 'total';
                        break;
                    } else if (res.keyword === 'dy') {
                        mode = 'dynamic';
                        break;
                    }
                } else if (res.entity) {
                    const len = entityLength(res.entity);
                    if (res.entity.type === 'arc') {
                        const sweep = sweepCCW(res.entity.start, res.entity.end);
                        e.log(`Comprimento atual: ${formatNumber(len, 4)}, ângulo incluído: ${formatNumber(radToDeg(sweep), 2)}°`);
                    } else {
                        e.log(`Comprimento atual: ${formatNumber(len, 4)}`);
                    }
                } else {
                    mode = 'delta';
                    delta = await e.getNumber('Informe o comprimento delta', { defaultValue: delta });
                    e.memory.lengthenDelta = delta;
                    break;
                }
            }

            if (mode === 'dynamic') {
                for (;;) {
                    const hit = await e.getEntity('Selecione um objeto para alterar (Enter para encerrar):', {
                        allowEnter: true,
                        filter: (x) => ['line', 'arc', 'polyline'].includes(x.type) && !x.closed,
                    });
                    if (!hit) break;
                    if (!isEntityEditable(e.doc, hit.entity)) throw new Error('Layer bloqueado.');
                    const target = await e.getPoint('Especifique o novo ponto final', {
                        reference: hit.point,
                        preview: (cursor) => {
                            try {
                                return [lengthenEntity(hit.entity, hit.point, 'dynamic', cursor)];
                            } catch {
                                return [];
                            }
                        },
                    });
                    if (!target.point) break;
                    const updated = lengthenEntity(hit.entity, hit.point, 'dynamic', target.point);
                    e.commit('Alongar dinâmico', replaceEntities(e.doc, new Map([[hit.entity.id, updated]])));
                }
            } else {
                const val = mode === 'delta' ? delta : mode === 'percent' ? percent : total;
                for (;;) {
                    const hit = await e.getEntity('Selecione um objeto para alterar ou [Desfazer]:', {
                        allowEnter: true,
                        options: [{ key: 'u', label: 'Desfazer' }],
                        filter: (x) => ['line', 'arc', 'polyline'].includes(x.type) && !x.closed,
                    });
                    if (!hit) break;
                    if (hit.keyword === 'u') {
                        e.undo();
                        continue;
                    }
                    if (!isEntityEditable(e.doc, hit.entity)) throw new Error('Layer bloqueado.');
                    const updated = lengthenEntity(hit.entity, hit.point, mode, val);
                    e.commit(`Alongar (${mode})`, replaceEntities(e.doc, new Map([[hit.entity.id, updated]])));
                }
            }
        },
    },
    DIVIDE: {
        aliases: ['DIV', 'DIVIDIR'],
        description: 'Dividir objeto em segmentos iguais inserindo pontos ou blocos',
        async run(e) {
            const hit = await e.getEntity('Selecione objeto para dividir:', {
                filter: (x) => ['line', 'arc', 'circle', 'polyline', 'ellipse', 'spline'].includes(x.type),
            });
            if (!hit) return;
            if (!isEntityEditable(e.doc, hit.entity)) throw new Error('Layer bloqueado.');

            const res = await e.request('pointOrEntity', 'Informe o número de segmentos ou [Bloco]', {
                options: [{ key: 'b', label: 'Bloco' }],
                allowNumber: true,
            });
            if (!res) return;

            let block = null;
            let align = true;
            let count;

            if (res.keyword === 'b') {
                block = await e.getString('Nome do bloco a inserir');
                if (!block) return;
                const optAlign = await e.getKeyword('Alinhar bloco com objeto?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 's');
                align = optAlign.key === 's';
                count = Math.floor(await e.getNumber('Informe o número de segmentos', { min: 2 }));
            } else if (res.number !== undefined) {
                count = Math.floor(res.number);
            } else {
                return;
            }

            if (!(count >= 2)) throw new Error('O número de segmentos deve ser pelo menos 2.');
            const created = divideEntity(hit.entity, count, { block, align });
            e.commit('Dividir', addEntities(e.doc, created));
            e.log(`${created.length} objeto(s) inserido(s).`);
        },
    },
    MEASURE: {
        aliases: ['ME', 'MEDIR'],
        description: 'Medir objeto e inserir pontos ou blocos em intervalos regulares',
        async run(e) {
            const hit = await e.getEntity('Selecione objeto para medir:', {
                filter: (x) => ['line', 'arc', 'circle', 'polyline', 'ellipse', 'spline'].includes(x.type),
            });
            if (!hit) return;
            if (!isEntityEditable(e.doc, hit.entity)) throw new Error('Layer bloqueado.');

            const res = await e.request('pointOrEntity', 'Informe o comprimento do segmento ou [Bloco]', {
                options: [{ key: 'b', label: 'Bloco' }],
                allowNumber: true,
                defaultValue: e.memory.measureLength ?? 10,
            });
            if (!res) return;

            let block = null;
            let align = true;
            let length;

            if (res.keyword === 'b') {
                block = await e.getString('Nome do bloco a inserir');
                if (!block) return;
                const optAlign = await e.getKeyword('Alinhar bloco com objeto?', [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }], 's');
                align = optAlign.key === 's';
                length = await e.getNumber('Informe o comprimento do segmento', { defaultValue: e.memory.measureLength ?? 10, min: 0.0001 });
            } else if (res.number !== undefined) {
                length = res.number;
            } else {
                return;
            }

            if (!(length > 0)) throw new Error('Comprimento do segmento deve ser maior que zero.');
            e.memory.measureLength = length;
            const created = measureEntity(hit.entity, length, hit.point, { block, align });
            if (created.length === 0) {
                e.log('Comprimento do segmento excede o tamanho do objeto.', 'warn');
                return;
            }
            e.commit('Medir', addEntities(e.doc, created));
            e.log(`${created.length} objeto(s) inserido(s).`);
        },
    },
    RAY: {
        aliases: ['RAIO'],
        description: 'Linha semi-infinita de construção a partir de um ponto',
        async run(e) {
            const first = await e.getPoint('Ponto inicial do raio:');
            if (!first || !first.point) return;
            const start = first.point;
            let count = 0;
            while (true) {
                const res = await e.getPoint('Ponto através:', {
                    reference: start,
                    allowEnter: true,
                    preview: (cursor) => {
                        const d = sub(cursor, start);
                        if (Math.hypot(d.x, d.y) < 1e-6) return [];
                        return [createRay(start, d, { layer: e.doc.currentLayer })];
                    },
                });
                if (!res || res.enter || !res.point) break;
                const d = sub(res.point, start);
                if (Math.hypot(d.x, d.y) < 1e-6) {
                    e.log('Ponto coincidente com o ponto inicial.', 'warn');
                    continue;
                }
                const ray = createRay(start, d, { layer: e.doc.currentLayer });
                e.commit('Raio', addEntities(e.doc, [ray]));
                count++;
            }
            if (count > 0) e.log(`${count} raio(s) criado(s).`);
        },
    },
    XLINE: {
        aliases: ['XL', 'LINHAC', 'LINHACONSTR'],
        description: 'Linha infinita de construção',
        async run(e, args = []) {
            const options = [
                { key: 'h', label: 'Horizontal' },
                { key: 'v', label: 'Vertical' },
                { key: 'a', label: 'Ângulo' },
                { key: 'b', label: 'Bissetriz' },
                { key: 'd', label: 'Deslocamento' },
            ];

            let mode = null;
            if (args && args.length > 0) {
                const arg0 = String(args[0]).toLowerCase();
                if (['h', 'hor', 'horizontal'].includes(arg0)) mode = 'h';
                else if (['v', 'ver', 'vertical'].includes(arg0)) mode = 'v';
                else if (['a', 'ang', 'angulo', 'ângulo'].includes(arg0)) mode = 'a';
                else if (['b', 'bis', 'bissetriz'].includes(arg0)) mode = 'b';
                else if (['d', 'o', 'des', 'deslocamento', 'offset'].includes(arg0)) mode = 'd';
            }

            let firstPoint = null;
            if (!mode) {
                const first = await e.getPoint('Especifique um ponto ou [Horizontal/Vertical/Ângulo/Bissetriz/Deslocamento]:', {
                    options,
                    allowEnter: true,
                });
                if (!first || first.enter) return;
                if (first.keyword) {
                    mode = first.keyword === 'o' ? 'd' : first.keyword;
                } else if (first.point) {
                    firstPoint = first.point;
                }
            }

            // 1. Horizontal
            if (mode === 'h') {
                let count = 0;
                while (true) {
                    const ptRes = await e.getPoint('Especifique o ponto através:', {
                        allowEnter: true,
                        preview: (cursor) => [createXline(cursor, { x: 1, y: 0 }, { layer: e.doc.currentLayer })],
                    });
                    if (!ptRes || ptRes.enter || !ptRes.point) break;
                    const xl = createXline(ptRes.point, { x: 1, y: 0 }, { layer: e.doc.currentLayer });
                    e.commit('Linha de construção (horizontal)', addEntities(e.doc, [xl]));
                    count++;
                }
                if (count > 0) e.log(`${count} linha(s) de construção criada(s).`);
                return;
            }

            // 2. Vertical
            if (mode === 'v') {
                let count = 0;
                while (true) {
                    const ptRes = await e.getPoint('Especifique o ponto através:', {
                        allowEnter: true,
                        preview: (cursor) => [createXline(cursor, { x: 0, y: 1 }, { layer: e.doc.currentLayer })],
                    });
                    if (!ptRes || ptRes.enter || !ptRes.point) break;
                    const xl = createXline(ptRes.point, { x: 0, y: 1 }, { layer: e.doc.currentLayer });
                    e.commit('Linha de construção (vertical)', addEntities(e.doc, [xl]));
                    count++;
                }
                if (count > 0) e.log(`${count} linha(s) de construção criada(s).`);
                return;
            }

            // 3. Ângulo
            if (mode === 'a') {
                const angOpt = await e.request('pointOrEntity', 'Informe o ângulo da linha de construção (0-360) ou [Referência]:', {
                    options: [{ key: 'r', label: 'Referência' }],
                    allowNumber: true,
                });
                if (!angOpt) return;

                let radAngle = 0;
                if (angOpt.keyword === 'r') {
                    const refHit = await e.getEntity('Selecione um objeto de linha:', {
                        filter: (x) => ['line', 'xline', 'ray'].includes(x.type) || Boolean(x.construction),
                    });
                    if (!refHit) return;
                    let baseAngle = 0;
                    if (refHit.entity.start && refHit.entity.end) {
                        baseAngle = angleOf(refHit.entity.start, refHit.entity.end);
                    }
                    const relDeg = await e.getNumber('Informe o ângulo em relação à linha', { defaultValue: 0 });
                    radAngle = normalizeAngle(baseAngle + degToRad(relDeg));
                } else if (angOpt.number !== undefined) {
                    radAngle = normalizeAngle(degToRad(angOpt.number));
                } else if (angOpt.point) {
                    radAngle = normalizeAngle(angleOf({ x: 0, y: 0 }, angOpt.point));
                } else {
                    return;
                }

                const dir = { x: Math.cos(radAngle), y: Math.sin(radAngle) };
                let count = 0;
                while (true) {
                    const ptRes = await e.getPoint('Especifique o ponto através:', {
                        allowEnter: true,
                        preview: (cursor) => [createXline(cursor, dir, { layer: e.doc.currentLayer })],
                    });
                    if (!ptRes || ptRes.enter || !ptRes.point) break;
                    const xl = createXline(ptRes.point, dir, { layer: e.doc.currentLayer });
                    e.commit('Linha de construção (ângulo)', addEntities(e.doc, [xl]));
                    count++;
                }
                if (count > 0) e.log(`${count} linha(s) de construção criada(s).`);
                return;
            }

            // 4. Bissetriz
            if (mode === 'b') {
                const vertRes = await e.getPoint('Especifique o ponto do vértice do ângulo:');
                if (!vertRes || !vertRes.point) return;
                const vertex = vertRes.point;

                const p1Res = await e.getPoint('Especifique o ponto inicial do ângulo:', {
                    reference: vertex,
                    preview: (cursor) => [{ type: 'line', start: vertex, end: cursor }],
                });
                if (!p1Res || !p1Res.point) return;
                const p1 = p1Res.point;

                let count = 0;
                while (true) {
                    const p2Res = await e.getPoint('Especifique o ponto final do ângulo:', {
                        reference: vertex,
                        allowEnter: true,
                        preview: (cursor) => {
                            if (distance(vertex, cursor) < 1e-6) return [];
                            return [
                                { type: 'line', start: vertex, end: cursor },
                                xlineBisector(vertex, p1, cursor, { layer: e.doc.currentLayer }),
                            ];
                        },
                    });
                    if (!p2Res || p2Res.enter || !p2Res.point) break;
                    const p2 = p2Res.point;
                    if (distance(vertex, p2) < 1e-6) {
                        e.log('Ponto coincidente com o vértice.', 'warn');
                        continue;
                    }
                    const xl = xlineBisector(vertex, p1, p2, { layer: e.doc.currentLayer });
                    e.commit('Linha de construção (bissetriz)', addEntities(e.doc, [xl]));
                    count++;
                }
                if (count > 0) e.log(`${count} linha(s) de construção criada(s).`);
                return;
            }

            // 5. Deslocamento
            if (mode === 'd') {
                const offReq = await e.request('pointOrEntity', 'Especifique a distância de deslocamento ou [Através]:', {
                    options: [{ key: 't', label: 'Através' }],
                    allowNumber: true,
                    defaultValue: e.memory.xlineOffsetDistance ?? 10,
                });
                if (!offReq) return;

                if (offReq.keyword === 't') {
                    while (true) {
                        const hit = await e.getEntity('Selecione objeto de linha para deslocar:', {
                            filter: (x) => ['line', 'xline', 'ray'].includes(x.type) || Boolean(x.construction),
                        });
                        if (!hit) break;
                        const through = await e.getPoint('Ponto através:', {
                            allowEnter: true,
                        });
                        if (!through || through.enter || !through.point) break;
                        const xl = xlineOffsetThrough(hit.entity, through.point, { layer: e.doc.currentLayer });
                        e.commit('Linha de construção (deslocamento)', addEntities(e.doc, [xl]));
                        e.log('Linha de construção criada.');
                    }
                    return;
                }

                let offsetDist = offReq.number;
                if (offsetDist === undefined && offReq.point) {
                    offsetDist = distance({ x: 0, y: 0 }, offReq.point);
                }
                if (!(offsetDist > 0)) {
                    e.log('Distância de deslocamento deve ser maior que zero.', 'warn');
                    return;
                }
                e.memory.xlineOffsetDistance = offsetDist;

                while (true) {
                    const hit = await e.getEntity('Selecione objeto de linha para deslocar:', {
                        filter: (x) => ['line', 'xline', 'ray'].includes(x.type) || Boolean(x.construction),
                    });
                    if (!hit) break;
                    const side = await e.getPoint('Especifique o lado para deslocamento:', {
                        allowEnter: true,
                    });
                    if (!side || side.enter || !side.point) break;
                    const xl = xlineOffsetDistance(hit.entity, offsetDist, side.point, { layer: e.doc.currentLayer });
                    e.commit('Linha de construção (deslocamento)', addEntities(e.doc, [xl]));
                    e.log('Linha de construção criada.');
                }
                return;
            }

            // 6. Modo padrão: Dois pontos (passando por firstPoint e múltiplos pontos através)
            if (firstPoint) {
                const p0 = firstPoint;
                let count = 0;
                while (true) {
                    const ptRes = await e.getPoint('Ponto através:', {
                        reference: p0,
                        allowEnter: true,
                        preview: (cursor) => {
                            const d = sub(cursor, p0);
                            if (Math.hypot(d.x, d.y) < 1e-6) return [];
                            return [createXline(p0, d, { layer: e.doc.currentLayer })];
                        },
                    });
                    if (!ptRes || ptRes.enter || !ptRes.point) break;
                    const d = sub(ptRes.point, p0);
                    if (Math.hypot(d.x, d.y) < 1e-6) {
                        e.log('Ponto coincidente com o ponto de inserção.', 'warn');
                        continue;
                    }
                    const xl = createXline(p0, d, { layer: e.doc.currentLayer });
                    e.commit('Linha de construção', addEntities(e.doc, [xl]));
                    count++;
                }
                if (count > 0) e.log(`${count} linha(s) de construção criada(s).`);
            }
        },
    },
    MATCHPROP:{aliases:['MA','COPIARPROP'],description:'Copiar layer, cor, tipo, espessura e propriedades de texto/cota',async run(e){
        // Com um objeto já selecionado (como no BricsCAD), ele é a referência e o comando vai direto ao pincel.
        const pre=e.selection?.size===1?e.doc.entities.find(x=>e.selection.has(x.id)):null;
        const src=pre?{entity:pre}:await e.getEntity('Objeto de referência');if(!src)return;
        const source=structuredClone(src.entity);
        e.canvas.classList.add('cad-property-brush');
        // Estado de cada destino antes do pincel: com Shift, clique ou caixa devolve o objeto a ele.
        const originals=new Map();
        try {
            for(;;){
                // Clique num destino ou caixa de seleção (esquerda→direita janela, direita→esquerda crossing).
                const pick=await e.getEntityOrWindow('Pincel: clique no destino ou arraste uma caixa; Shift desfaz; Enter/Esc encerra',{allowEnter:true,directional:true});
                if(!pick)break;
                const picked=pick.entities??[pick.entity];
                const targets=picked.filter((x)=>!(pick.entities&&x.id===src.entity.id)&&isEntityEditable(e.doc,x));
                if(!targets.length){e.log(pick.entities?'Nenhum destino editável na caixa.':'Destino em layer bloqueado ou oculto.');continue;}
                if(pick.shift){
                    // Só volta quem o pincel mudou nesta execução; o resto da caixa fica como está.
                    const restore=targets.filter((x)=>originals.has(x.id));
                    if(!restore.length){e.log('Nada a desfazer nos objetos escolhidos.');continue;}
                    e.commit('Desfazer cópia de propriedades',replaceEntities(e.doc,new Map(restore.map((x)=>[x.id,restoreProperties(x,originals.get(x.id))]))));
                    restore.forEach((x)=>originals.delete(x.id));
                    e.log(`Propriedades originais devolvidas a ${restore.length} objeto(s).`);
                    continue;
                }
                targets.forEach((x)=>{if(!originals.has(x.id))originals.set(x.id,structuredClone(x));});
                e.commit('Copiar propriedades',replaceEntities(e.doc,new Map(targets.map((x)=>[x.id,matchProperties(e,source,x)]))));
                // Na colaboração o commit troca ids locais por globais: o original segue o objeto.
                for(const [from,to] of e.lastRenamedIds??[]){if(originals.has(from)){originals.set(to,originals.get(from));originals.delete(from);}}
                if(pick.entities)e.log(`Propriedades copiadas para ${targets.length} objeto(s).`);
            }
        } finally {e.canvas.classList.remove('cad-property-brush');}
    }},
    PROPERTIES:{aliases:['PROP','PROPRIEDADES'],description:'Editar propriedade geométrica numericamente',async run(e){
        const hit=await e.getEntity('Objeto para editar');if(!hit)return;
        const fields=geometryFields(hit.entity);e.log(fields.map(f=>`${f.key}=${f.value}`).join('; '));
        const key=await e.getString('Nome da propriedade');const value=await e.getNumber('Novo valor');
        if(!isEntityEditable(e.doc,hit.entity))throw new Error('Layer bloqueado.');
        e.commit('Editar geometria',replaceEntities(e.doc,new Map([[hit.entity.id,setGeometryField(hit.entity,key,value)]])));
    }},
    LEADER:{aliases:['LE','CHAMADA'],description:'Linha de chamada com seta e texto',async run(e){
        ensureDimensionSetup(e);
        const p1=(await e.getPoint('Ponta da seta')).point;
        const p2=(await e.getPoint('Cotovelo',{reference:p1})).point;
        const linePoint=(await e.getPoint('Posição do texto',{reference:p2})).point;
        const textOverride=await e.getString('Texto da chamada');
        e.commit('Chamada',addEntities(e.doc,[{type:'dimension',kind:'leader',layer:DIMENSION_LAYER,p1,p2,linePoint,textOverride}]));
    }},
    DIMTEXT:{aliases:['TEXTODACOTA'],description:'Editar texto da cota; <> restaura a medição',async run(e){
        const hit=await e.getEntity('Cota',{filter:x=>x.type==='dimension'});if(!hit)return;
        const text=await e.getString('Texto (<> para automático)',{defaultValue:hit.entity.textOverride??'<>'});
        if(!isEntityEditable(e.doc,hit.entity))throw new Error('Layer bloqueado.');
        e.commit('Texto da cota',replaceEntities(e.doc,new Map([[hit.entity.id,{...hit.entity,textOverride:text==='<>'?undefined:text}]])));
    }},
    OVERKILL: {
        aliases: ['ELIMINARDUPLICATAS', 'LIMPARGEOMETRIA'],
        description: 'Eliminar linhas, arcos e entidades sobrepostas ou duplicadas',
        async run(e) {
            const targets = e.selection.size > 0
                ? e.doc.entities.filter(x => e.selection.has(x.id))
                : e.doc.entities;
            const EPS = await e.getNumber('Tolerância (mm)', { defaultValue: overkillTolerance, min: 0 });
            overkillTolerance = EPS;
            const duplicateIds = new Set();
            const arePtsEqual = (p1, p2) => Math.abs(p1.x - p2.x) <= EPS && Math.abs(p1.y - p2.y) <= EPS;

            for (let i = 0; i < targets.length; i++) {
                const a = targets[i];
                if (duplicateIds.has(a.id) || !isEntityEditable(e.doc, a)) continue;
                for (let j = i + 1; j < targets.length; j++) {
                    const b = targets[j];
                    if (duplicateIds.has(b.id) || !isEntityEditable(e.doc, b)) continue;
                    if (a.type !== b.type || a.layer !== b.layer) continue;

                    let isDup = false;
                    if (a.type === 'line') {
                        isDup = (arePtsEqual(a.start, b.start) && arePtsEqual(a.end, b.end))
                             || (arePtsEqual(a.start, b.end) && arePtsEqual(a.end, b.start));
                    } else if (a.type === 'circle') {
                        isDup = arePtsEqual(a.center, b.center) && Math.abs(a.radius - b.radius) <= EPS;
                    } else if (a.type === 'arc') {
                        isDup = arePtsEqual(a.center, b.center)
                             && Math.abs(a.radius - b.radius) <= EPS
                             && Math.abs(a.start - b.start) <= EPS
                             && Math.abs(a.end - b.end) <= EPS;
                    } else if (a.type === 'text') {
                        isDup = arePtsEqual(a.position, b.position) && a.text === b.text && Math.abs((a.height ?? 2.5) - (b.height ?? 2.5)) <= EPS;
                    }

                    if (isDup) {
                        duplicateIds.add(b.id);
                    }
                }
            }

            const lines = targets.filter(x => x.type === 'line' && !duplicateIds.has(x.id) && isEntityEditable(e.doc, x));
            const { replacements, removed } = mergeOverlappingLines(lines, EPS);
            if (duplicateIds.size === 0 && removed.size === 0) {
                e.log('Nenhum objeto duplicado encontrado.');
                return;
            }
            const gone = new Set([...duplicateIds, ...removed]);
            e.commit('Eliminar duplicatas', replaceEntities(removeEntities(e.doc, gone), replacements));
            if (duplicateIds.size) e.log(`${duplicateIds.size} objeto(s) duplicado(s) eliminado(s).`);
            if (removed.size) e.log(`${removed.size} linha(s) sobreposta(s) unida(s) em ${replacements.size}.`);
        },
    },
    PURGE: {
        aliases: ['LIMPAR', 'EXPURGAR', 'LIMPEZA', 'PU'],
        description: 'Limpeza: eliminar camadas e blocos não utilizados, geometria de comprimento zero e textos vazios',
        async run(e) {
            const choice = await e.getKeyword('Limpar', [
                { key: 't', label: 'Tudo' },
                { key: 'c', label: 'Camadas' },
                { key: 'b', label: 'Blocos' },
                { key: 'g', label: 'Geometria de comprimento zero' },
                { key: 'v', label: 'Textos vazios' },
            ], 't');
            const all = choice?.key === 't';
            const options = {
                layers: all || choice?.key === 'c',
                blocks: all || choice?.key === 'b',
                zeroLength: all || choice?.key === 'g',
                emptyText: all || choice?.key === 'v',
            };
            const { doc, removed } = purgeDocument(e.doc, options);
            const parts = [
                removed.layers.length && `${removed.layers.length} camada(s)`,
                removed.blocks.length && `${removed.blocks.length} bloco(s)`,
                removed.zeroLength && `${removed.zeroLength} objeto(s) de comprimento zero`,
                removed.emptyText && `${removed.emptyText} texto(s) vazio(s)`,
            ].filter(Boolean);
            if (parts.length === 0) {
                e.log('Nada para limpar.');
                return;
            }
            e.commit('Limpeza', doc);
            e.log(`Limpeza: ${parts.join(', ')} eliminado(s).`);
            if (removed.layers.length) e.log(`Camadas: ${removed.layers.join(', ')}`);
            if (removed.blocks.length) e.log(`Blocos: ${removed.blocks.join(', ')}`);
        },
    },
};
