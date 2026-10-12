// resources/js/cad/qet.js
// Suporte bidirecional nativo a projetos elétricos e esquemas de chicotes do QElectroTech (.qet).
// Permite importar projetos completos multifolhas, renderizar moldura/carimbo,
// símbolos elétricos posicionados/rotacionados, bornes/terminais e condutores ortogonais coloridos.

import { createDocument, addEntities } from './document.js';
import { parseXmlDom, escapeXml, generateUuid } from './elmt.js';

export const QET_LAYER_BORDER = 'QET_MOLDURA';
export const QET_LAYER_COMPONENTS = 'QET_COMPONENTES';
export const QET_LAYER_TERMINALS = 'QET_TERMINAIS';
export const QET_LAYER_CONDUCTORS = 'QET_CONDUTORES';
export const QET_LAYER_TEXTS = 'QET_TEXTOS';

/**
 * Detecta se a entrada possui a assinatura de um projeto QElectroTech (.qet).
 */
export function looksLikeQet(input) {
    if (!input) return false;
    let str = '';
    if (typeof input === 'string') {
        str = input.slice(0, 1000).trim();
    } else if (input instanceof ArrayBuffer) {
        str = new TextDecoder('utf-8').decode(new Uint8Array(input, 0, Math.min(1000, input.byteLength))).trim();
    } else if (ArrayBuffer.isView(input)) {
        str = new TextDecoder('utf-8').decode(new Uint8Array(input.buffer, input.byteOffset, Math.min(1000, input.byteLength))).trim();
    } else if (Array.isArray(input)) {
        str = new TextDecoder('utf-8').decode(new Uint8Array(input.slice(0, 1000))).trim();
    } else {
        return false;
    }
    return /<project[\s>]/i.test(str) && (
        /<diagram[\s>]/i.test(str) ||
        /<diagrams[\s>]/i.test(str) ||
        /<collection[\s>]/i.test(str) ||
        /version=["'][0-9.]+["']/i.test(str)
    );
}

/**
 * Rotaciona ponto local de acordo com o quadrante QET (0=0°, 1=90° cw, 2=180°, 3=270° cw).
 * Suporta chamada como rotateQetPoint({x, y}, ori) ou rotateQetPoint(x, y, ori).
 * Em coordenadas de tela (Y para baixo):
 * 0: (x, y)
 * 1: (-y, x)
 * 2: (-x, -y)
 * 3: (y, -x)
 */
export function rotateQetPoint(pOrX, yOrOri, maybeOri) {
    let x = 0;
    let y = 0;
    let ori = 0;
    if (typeof pOrX === 'object' && pOrX !== null) {
        x = parseFloat(pOrX.x || 0);
        y = parseFloat(pOrX.y || 0);
        ori = yOrOri;
    } else {
        x = parseFloat(pOrX || 0);
        y = parseFloat(yOrOri || 0);
        ori = maybeOri;
    }
    const q = ((parseInt(ori, 10) || 0) % 4 + 4) % 4;
    if (q === 1) return { x: -y, y: x };
    if (q === 2) return { x: -x, y: -y };
    if (q === 3) return { x: y, y: -x };
    return { x, y };
}

/**
 * Rotaciona a orientação cardeal do terminal ('n', 's', 'e', 'w') conforme a orientação do elemento (0..3).
 */
export function rotateCardinal(dir, orientation) {
    const cardOrder = ['n', 'e', 's', 'w'];
    const idx = cardOrder.indexOf((dir || 'n').toLowerCase());
    if (idx === -1) return dir;
    const steps = ((parseInt(orientation, 10) || 0) % 4 + 4) % 4;
    return cardOrder[(idx + steps) % 4];
}

/**
 * Extrai a biblioteca de símbolos embutidos (<collection>) mapeados por URI e UUID.
 */
function extractCollection(collectionNode) {
    const defsByUri = new Map();
    const defsByUuid = new Map();

    function traverse(node, currentPath) {
        if (!node) return;
        if (node.tag === 'category') {
            const catName = node.attrs.name || '';
            const nextPath = currentPath ? `${currentPath}/${catName}` : catName;
            (node.children || []).forEach((c) => traverse(c, nextPath));
        } else if (node.tag === 'element') {
            const elName = node.attrs.name || '';
            const uri = `embed://${currentPath}/${elName}`;
            const defNode = (node.children || []).find((c) => c.tag === 'definition');
            if (defNode) {
                const uuidNode = (defNode.children || []).find((c) => c.tag === 'uuid');
                const uuid = uuidNode?.attrs?.uuid;
                defsByUri.set(uri, defNode);
                if (uuid) defsByUuid.set(uuid, defNode);
            }
        }
    }

    if (collectionNode) {
        (collectionNode.children || []).forEach((c) => traverse(c, ''));
    }
    return { defsByUri, defsByUuid };
}

/**
 * Converte primitivas da definição de um elemento para entidades vetoriais instanciadas no diagrama.
 */
function instantiateDefinition(defNode, elemInst, idGen) {
    const elemX = parseFloat(elemInst.attrs.x || 0);
    const elemY = parseFloat(elemInst.attrs.y || 0);
    const orientation = parseInt(elemInst.attrs.orientation || 0, 10);

    const descNode = (defNode.children || []).find((c) => c.tag === 'description') || defNode;
    const rawChildren = descNode.children || [];

    const entities = [];
    const terminalsMap = new Map();

    // Transforma ponto local do elemento para coordenadas de diagrama QET, e então para CAD (yCAD = -yQET)
    const mapPt = (lx, ly) => {
        const rotated = rotateQetPoint({ x: parseFloat(lx || 0), y: parseFloat(ly || 0) }, orientation);
        const qetX = elemX + rotated.x;
        const qetY = elemY + rotated.y;
        return {
            x: qetX || 0,
            y: (-qetY) || 0,
        };
    };

    rawChildren.forEach((child) => {
        const a = child.attrs;
        if (child.tag === 'line') {
            const p1 = mapPt(a.x1, a.y1);
            const p2 = mapPt(a.x2, a.y2);
            entities.push({
                id: idGen('qet_line'),
                type: 'line',
                layer: QET_LAYER_COMPONENTS,
                start: p1,
                end: p2,
            });
        } else if (child.tag === 'rect') {
            const lx = parseFloat(a.x || 0);
            const ly = parseFloat(a.y || 0);
            const lw = parseFloat(a.width || 0);
            const lh = parseFloat(a.height || 0);
            const p1 = mapPt(lx, ly);
            const p2 = mapPt(lx + lw, ly);
            const p3 = mapPt(lx + lw, ly + lh);
            const p4 = mapPt(lx, ly + lh);
            entities.push({
                id: idGen('qet_rect'),
                type: 'polyline',
                layer: QET_LAYER_COMPONENTS,
                closed: true,
                vertices: [
                    { x: p1.x, y: p1.y, bulge: 0 },
                    { x: p2.x, y: p2.y, bulge: 0 },
                    { x: p3.x, y: p3.y, bulge: 0 },
                    { x: p4.x, y: p4.y, bulge: 0 },
                ],
            });
        } else if (child.tag === 'circle') {
            const lx = parseFloat(a.x || 0);
            const ly = parseFloat(a.y || 0);
            const d = parseFloat(a.diameter || 0);
            const r = d / 2;
            const center = mapPt(lx + r, ly + r);
            entities.push({
                id: idGen('qet_circ'),
                type: 'circle',
                layer: QET_LAYER_COMPONENTS,
                center,
                radius: r,
            });
        } else if (child.tag === 'ellipse') {
            const lx = parseFloat(a.x || 0);
            const ly = parseFloat(a.y || 0);
            const w = parseFloat(a.width || 0);
            const h = parseFloat(a.height || 0);
            const rx = w / 2;
            const ry = h / 2;
            const center = mapPt(lx + rx, ly + ry);
            const isHorizontal = orientation % 2 === 0;
            entities.push({
                id: idGen('qet_ellip'),
                type: 'ellipse',
                layer: QET_LAYER_COMPONENTS,
                center,
                major: { x: isHorizontal ? rx : ry, y: 0 },
                ratio: isHorizontal ? (rx > 0 ? ry / rx : 1) : (ry > 0 ? rx / ry : 1),
                radiusX: rx,
                radiusY: ry,
                start: 0,
                end: Math.PI * 2,
            });
        } else if (child.tag === 'polygon') {
            const pts = [];
            let i = 1;
            while (a[`x${i}`] !== undefined && a[`y${i}`] !== undefined) {
                const pt = mapPt(a[`x${i}`], a[`y${i}`]);
                pts.push({ x: pt.x, y: pt.y, bulge: 0 });
                i += 1;
            }
            if (pts.length >= 2) {
                entities.push({
                    id: idGen('qet_poly'),
                    type: 'polyline',
                    layer: QET_LAYER_COMPONENTS,
                    closed: true,
                    vertices: pts,
                });
            }
        } else if (child.tag === 'text') {
            const pos = mapPt(a.x, a.y);
            const size = parseFloat(a.size || 5);
            entities.push({
                id: idGen('qet_text'),
                type: 'text',
                layer: QET_LAYER_TEXTS,
                position: pos,
                text: a.text || child.text || '',
                height: size,
                rotation: 0,
            });
        } else if (child.tag === 'terminal') {
            const pos = mapPt(a.x, a.y);
            const rawOri = a.orientation || 'n';
            const termOri = rotateCardinal(rawOri, orientation);
            const defUuid = a.uuid;
            const instTerminalsNode = elemInst.children.find((c) => c.tag === 'terminals');
            const instTerminals = instTerminalsNode ? instTerminalsNode.children.filter((c) => c.tag === 'terminal') : [];
            const instTerm = instTerminals.find((t) => t.attrs.id === a.id || t.attrs.uuid === defUuid)
                || instTerminals[terminalsMap.size];
            const termUuid = instTerm?.attrs?.uuid || defUuid || generateUuid();
            const termName = a.name || instTerm?.attrs?.name || '';
            const termEntity = {
                id: idGen('qet_term'),
                type: 'point',
                layer: QET_LAYER_TERMINALS,
                position: pos,
                x: pos.x,
                y: pos.y,
                orientation: termOri,
                name: termName,
                uuid: termUuid,
                elementUuid: elemInst.attrs.uuid,
            };
            entities.push(termEntity);
            terminalsMap.set(termUuid, termEntity);
            if (defUuid) {
                terminalsMap.set(defUuid, termEntity);
            }
            if (elemInst.attrs.uuid) {
                terminalsMap.set(`${elemInst.attrs.uuid}:${termUuid}`, termEntity);
                if (defUuid) {
                    terminalsMap.set(`${elemInst.attrs.uuid}:${defUuid}`, termEntity);
                }
                if (instTerm?.attrs?.id !== undefined) {
                    terminalsMap.set(`${elemInst.attrs.uuid}:${instTerm.attrs.id}`, termEntity);
                }
            }
        }
    });

    return { entities, terminalsMap };
}

/**
 * Converte um arquivo XML de projeto QElectroTech (.qet) em um ou mais documentos CAD.
 */
export function qetToDocuments(xmlText, options = {}) {
    if (!looksLikeQet(xmlText)) {
        throw new Error('O conteúdo fornecido não é um projeto válido do QElectroTech (.qet).');
    }

    const dom = parseXmlDom(xmlText);
    const projectNode = dom.children.find((c) => c.tag === 'project');
    if (!projectNode) {
        throw new Error('Tag raiz <project> ausente no arquivo .qet.');
    }

    const projectTitle = projectNode.attrs.title || options.name?.replace(/\.qet$/i, '') || 'Projeto Elétrico';
    const projectVersion = projectNode.attrs.version || '0.100.0';

    // Extrai propriedades
    const props = {};
    const propsNode = projectNode.children.find((c) => c.tag === 'properties');
    if (propsNode) {
        propsNode.children.forEach((p) => {
            if (p.tag === 'property') {
                props[p.attrs.name || ''] = p.text || '';
            }
        });
    }

    // Extrai coleções de elementos embutidos
    const collectionNode = projectNode.children.find((c) => c.tag === 'collection');
    const { defsByUri, defsByUuid } = extractCollection(collectionNode);

    // Localiza todos os diagramas (folhas do projeto): suporta filhos diretos ou container <diagrams>
    let diagramNodes = projectNode.children.filter((c) => c.tag === 'diagram');
    if (diagramNodes.length === 0) {
        const diagramsNode = projectNode.children.find((c) => c.tag === 'diagrams');
        if (diagramsNode && diagramsNode.children) {
            diagramNodes = diagramsNode.children.filter((c) => c.tag === 'diagram');
        }
    }
    if (diagramNodes.length === 0) {
        throw new Error('O projeto .qet não contém folhas (<diagram>).');
    }

    let globalIdCounter = 1;
    const idGen = (prefix) => `${prefix}_${globalIdCounter++}`;

    const documents = diagramNodes.map((diagNode, sheetIndex) => {
        const order = parseInt(diagNode.attrs.order || sheetIndex + 1, 10);
        const diagTitle = diagNode.attrs.title || `${projectTitle} — Folha ${order}`;
        const cols = parseInt(diagNode.attrs.cols || 37, 10);
        const colsize = parseFloat(diagNode.attrs.colsize || 60);
        const rows = parseInt(diagNode.attrs.rows || 25, 10);
        const rowsize = parseFloat(diagNode.attrs.rowsize || 80);

        const totalWidth = cols * colsize;
        const totalHeight = rows * rowsize;

        const entities = [];
        const globalTerminals = new Map(); // uuid -> terminal entity

        // 1. Moldura e carimbo (Drawing Sheet Border & Grid)
        const frameEntities = [];
        // Retângulo externo da folha (Y CAD é negativo)
        frameEntities.push({
            id: idGen('frame_outer'),
            type: 'polyline',
            layer: QET_LAYER_BORDER,
            closed: true,
            vertices: [
                { x: 0, y: 0, bulge: 0 },
                { x: totalWidth, y: 0, bulge: 0 },
                { x: totalWidth, y: -totalHeight, bulge: 0 },
                { x: 0, y: -totalHeight, bulge: 0 },
            ],
        });

        // Retângulo de margem interna (10mm de recuo)
        const pad = 10;
        frameEntities.push({
            id: idGen('frame_inner'),
            type: 'polyline',
            layer: QET_LAYER_BORDER,
            closed: true,
            vertices: [
                { x: pad, y: -pad, bulge: 0 },
                { x: totalWidth - pad, y: -pad, bulge: 0 },
                { x: totalWidth - pad, y: -(totalHeight - pad), bulge: 0 },
                { x: pad, y: -(totalHeight - pad), bulge: 0 },
            ],
        });

        // Carimbo técnico (Title Block) no canto inferior direito
        const tbW = 280;
        const tbH = 70;
        const tbX = totalWidth - pad - tbW;
        const tbY = -(totalHeight - pad);
        frameEntities.push({
            id: idGen('tb_box'),
            type: 'polyline',
            layer: QET_LAYER_BORDER,
            closed: true,
            vertices: [
                { x: tbX, y: tbY, bulge: 0 },
                { x: tbX + tbW, y: tbY, bulge: 0 },
                { x: tbX + tbW, y: tbY + tbH, bulge: 0 },
                { x: tbX, y: tbY + tbH, bulge: 0 },
            ],
        });

        // Divisória do carimbo
        frameEntities.push({
            id: idGen('tb_div1'),
            type: 'line',
            layer: QET_LAYER_BORDER,
            start: { x: tbX, y: tbY + 45 },
            end: { x: tbX + tbW, y: tbY + 45 },
        });
        frameEntities.push({
            id: idGen('tb_div2'),
            type: 'line',
            layer: QET_LAYER_BORDER,
            start: { x: tbX + 180, y: tbY },
            end: { x: tbX + 180, y: tbY + 45 },
        });

        // Textos do carimbo
        frameEntities.push({
            id: idGen('tb_t1'),
            type: 'text',
            layer: QET_LAYER_TEXTS,
            position: { x: tbX + 10, y: tbY + 52 },
            text: projectTitle,
            height: 8,
            rotation: 0,
        });
        frameEntities.push({
            id: idGen('tb_t2'),
            type: 'text',
            layer: QET_LAYER_TEXTS,
            position: { x: tbX + 10, y: tbY + 25 },
            text: `Data: ${props.saveddate || new Date().toLocaleDateString('pt-BR')}`,
            height: 5,
            rotation: 0,
        });
        // Autor da folha (atributo do <diagram> ou do <inset>, como o QElectroTech grava).
        // Antes ia um nome de empresa fixo em qualquer projeto.
        const sheetInset = diagNode.children.find((c) => c.tag === 'inset');
        const sheetAuthor = diagNode.attrs.author || sheetInset?.attrs?.author || props.author || '';
        if (sheetAuthor) {
            frameEntities.push({
                id: idGen('tb_t3'),
                type: 'text',
                layer: QET_LAYER_TEXTS,
                position: { x: tbX + 10, y: tbY + 10 },
                text: sheetAuthor,
                height: 6,
                rotation: 0,
            });
        }
        frameEntities.push({
            id: idGen('tb_t4'),
            type: 'text',
            layer: QET_LAYER_TEXTS,
            position: { x: tbX + 190, y: tbY + 25 },
            text: `Folha: ${order} / ${diagramNodes.length}`,
            height: 6,
            rotation: 0,
        });

        entities.push(...frameEntities);

        // 2. Instancia componentes (<elements>)
        const elementsContainer = diagNode.children.find((c) => c.tag === 'elements');
        const elementNodes = elementsContainer ? elementsContainer.children.filter((c) => c.tag === 'element') : [];

        elementNodes.forEach((elemInst) => {
            const elType = elemInst.attrs.type || '';
            const defNode = defsByUri.get(elType) || defsByUuid.get(elemInst.attrs.uuid);
            if (defNode) {
                const { entities: compEntities, terminalsMap } = instantiateDefinition(defNode, elemInst, idGen);
                entities.push(...compEntities);
                terminalsMap.forEach((t, uuid) => globalTerminals.set(uuid, t));
            } else {
                // Símbolo genérico/fallback caso não esteja no collection
                const elemX = parseFloat(elemInst.attrs.x || 0);
                const elemY = parseFloat(elemInst.attrs.y || 0);
                const orientation = parseInt(elemInst.attrs.orientation || 0, 10);
                const name = elType.split('/').pop()?.replace(/\.elmt$/i, '') || 'Componente';
                entities.push({
                    id: idGen('fallback_rect'),
                    type: 'polyline',
                    layer: QET_LAYER_COMPONENTS,
                    closed: true,
                    vertices: [
                        { x: elemX - 20, y: -(elemY - 20), bulge: 0 },
                        { x: elemX + 20, y: -(elemY - 20), bulge: 0 },
                        { x: elemX + 20, y: -(elemY + 20), bulge: 0 },
                        { x: elemX - 20, y: -(elemY + 20), bulge: 0 },
                    ],
                });
                entities.push({
                    id: idGen('fallback_text'),
                    type: 'text',
                    layer: QET_LAYER_TEXTS,
                    position: { x: elemX - 18, y: -elemY },
                    text: name,
                    height: 4,
                    rotation: 0,
                });

                // Instancia terminais embutidos no elemento se houver
                const instTerminalsNode = elemInst.children.find((c) => c.tag === 'terminals');
                const instTerminals = instTerminalsNode ? instTerminalsNode.children.filter((c) => c.tag === 'terminal') : [];
                instTerminals.forEach((it, idx) => {
                    const rawX = parseFloat(it.attrs.x || 0);
                    const rawY = parseFloat(it.attrs.y || 0);
                    const rotated = rotateQetPoint({ x: rawX, y: rawY }, orientation);
                    const tX = elemX + rotated.x;
                    const tY = -(elemY + rotated.y);
                    const termUuid = it.attrs.uuid || generateUuid();
                    const termEntity = {
                        id: idGen('qet_term'),
                        type: 'point',
                        layer: QET_LAYER_TERMINALS,
                        x: tX,
                        y: tY,
                        position: { x: tX, y: tY },
                        name: it.attrs.name || String(it.attrs.id ?? idx),
                        uuid: termUuid,
                        elementUuid: elemInst.attrs.uuid,
                    };
                    entities.push(termEntity);
                    globalTerminals.set(termUuid, termEntity);
                    if (elemInst.attrs.uuid) {
                        globalTerminals.set(`${elemInst.attrs.uuid}:${termUuid}`, termEntity);
                        globalTerminals.set(`${elemInst.attrs.uuid}:${idx}`, termEntity);
                        if (it.attrs.id !== undefined) {
                            globalTerminals.set(`${elemInst.attrs.uuid}:${it.attrs.id}`, termEntity);
                        }
                    }
                });
            }

            // Rótulos dinâmicos (<dynamic_texts>)
            const dynNode = elemInst.children.find((c) => c.tag === 'dynamic_texts');
            if (dynNode) {
                dynNode.children.forEach((dt) => {
                    if (dt.tag === 'dynamic_elmt_text') {
                        const elemX = parseFloat(elemInst.attrs.x || 0);
                        const elemY = parseFloat(elemInst.attrs.y || 0);
                        const dx = parseFloat(dt.attrs.x || 0);
                        const dy = parseFloat(dt.attrs.y || 0);
                        const textVal = dt.text || dt.children.find((c) => c.tag === 'text')?.text || '';
                        if (textVal) {
                            entities.push({
                                id: idGen('qet_dyn_text'),
                                type: 'text',
                                layer: QET_LAYER_TEXTS,
                                position: { x: elemX + dx, y: -(elemY + dy) },
                                text: textVal.replace(/&#xd;/g, ' ').replace(/\n/g, ' '),
                                height: 5,
                                rotation: 0,
                            });
                        }
                    }
                });
            }
        });

        // 3. Constrói condutores (<conductors>)
        const conductorsContainer = diagNode.children.find((c) => c.tag === 'conductors');
        const conductorNodes = conductorsContainer ? conductorsContainer.children.filter((c) => c.tag === 'conductor') : [];

        conductorNodes.forEach((cond) => {
            const term1Uuid = cond.attrs.terminal1;
            const term2Uuid = cond.attrs.terminal2;
            const elem1Id = cond.attrs.element1;
            const elem2Id = cond.attrs.element2;

            const t1 = (elem1Id && globalTerminals.get(`${elem1Id}:${term1Uuid}`))
                || globalTerminals.get(term1Uuid);
            const t2 = (elem2Id && globalTerminals.get(`${elem2Id}:${term2Uuid}`))
                || globalTerminals.get(term2Uuid);

            const wireColor = cond.attrs.color || '#0066e2';
            const wireNum = cond.attrs.num || cond.attrs.formula || '';
            const condSize = parseFloat(cond.attrs.condsize || 2);
            const lineWeight = Math.max(25, Math.round(condSize * 18));

            let polylineVertices = [];

            // Se tem segmentos explícitos
            const segments = cond.children.filter((c) => c.tag === 'segment');
            const startX = t1 ? t1.position.x : (cond.attrs.userx ? parseFloat(cond.attrs.userx) : null);
            const startY = t1 ? t1.position.y : (cond.attrs.usery ? -parseFloat(cond.attrs.usery) : null);

            if (startX !== null && startY !== null && segments.length > 0) {
                let currX = startX;
                let currY = startY;
                polylineVertices.push({ x: currX, y: currY, bulge: 0 });

                segments.forEach((s) => {
                    const len = parseFloat(s.attrs.length || 0);
                    const isHoriz = s.attrs.orientation === 'horizontal';
                    if (isHoriz) {
                        currX += len;
                    } else {
                        // No QET vertical cresce para baixo, em CAD cresce para cima: inverte delta
                        currY -= len;
                    }
                    polylineVertices.push({ x: currX, y: currY, bulge: 0 });
                });

                if (t2) {
                    polylineVertices.push({ x: t2.position.x, y: t2.position.y, bulge: 0 });
                }
            } else if (t1 && t2) {
                // Roteamento ortogonal Manhattan via userx/usery se disponíveis
                const userX = cond.attrs.userx ? parseFloat(cond.attrs.userx) : null;
                const userY = cond.attrs.usery ? -parseFloat(cond.attrs.usery) : null;

                if (userX !== null && userY !== null) {
                    polylineVertices = [
                        { x: t1.position.x, y: t1.position.y, bulge: 0 },
                        { x: t1.position.x, y: userY, bulge: 0 },
                        { x: userX, y: userY, bulge: 0 },
                        { x: userX, y: t2.position.y, bulge: 0 },
                        { x: t2.position.x, y: t2.position.y, bulge: 0 },
                    ];
                } else {
                    const midX = (t1.position.x + t2.position.x) / 2;
                    polylineVertices = [
                        { x: t1.position.x, y: t1.position.y, bulge: 0 },
                        { x: midX, y: t1.position.y, bulge: 0 },
                        { x: midX, y: t2.position.y, bulge: 0 },
                        { x: t2.position.x, y: t2.position.y, bulge: 0 },
                    ];
                }
            }

            if (polylineVertices.length >= 2) {
                entities.push({
                    id: idGen('qet_wire'),
                    type: 'polyline',
                    layer: QET_LAYER_CONDUCTORS,
                    closed: false,
                    color: wireColor,
                    lineWeight,
                    vertices: polylineVertices,
                    wireNumber: wireNum,
                    wireText: wireNum,
                    wireColor,
                    terminal1: term1Uuid,
                    terminal2: term2Uuid,
                });

                // Rótulo identificador do circuito/fio
                if (wireNum && wireNum !== '_') {
                    const midIdx = Math.floor(polylineVertices.length / 2);
                    const labelPt = polylineVertices[midIdx];
                    entities.push({
                        id: idGen('qet_wire_label'),
                        type: 'text',
                        layer: QET_LAYER_TEXTS,
                        position: { x: labelPt.x + 2, y: labelPt.y + 3 },
                        text: wireNum,
                        height: 5,
                        color: wireColor,
                        rotation: 0,
                    });
                }
            }
        });

        // 4. Textos independentes do diagrama (<texts>)
        const textsContainer = diagNode.children.find((c) => c.tag === 'texts');
        const textNodes = textsContainer ? textsContainer.children.filter((c) => c.tag === 'text') : [];
        textNodes.forEach((tNode) => {
            const tx = parseFloat(tNode.attrs.x || 0);
            const ty = -parseFloat(tNode.attrs.y || 0);
            const tText = tNode.attrs.text || tNode.text || '';
            const tSize = parseFloat(tNode.attrs.size || 5);
            if (tText) {
                entities.push({
                    id: idGen('qet_diag_text'),
                    type: 'text',
                    layer: QET_LAYER_TEXTS,
                    position: { x: tx, y: ty },
                    x: tx,
                    y: ty,
                    text: tText,
                    height: tSize,
                    rotation: 0,
                });
            }
        });

        // Extrai inset
        const insetNode = diagNode.children.find((c) => c.tag === 'inset');
        const insetTitle = insetNode?.attrs?.title || '';

        const doc = {
            ...createDocument(),
            name: diagTitle,
            sourceFormat: 'qet',
            units: 'mm',
            layers: [
                { name: '0', color: '#ffffff', lineType: 'CONTINUOUS', lineWeight: 25, visible: true, locked: false },
                { name: QET_LAYER_BORDER, color: '#64748b', lineType: 'CONTINUOUS', lineWeight: 35, visible: true, locked: false },
                { name: QET_LAYER_COMPONENTS, color: '#e2e8f0', lineType: 'CONTINUOUS', lineWeight: 25, visible: true, locked: false },
                { name: QET_LAYER_TERMINALS, color: '#ef4444', lineType: 'CONTINUOUS', lineWeight: 35, visible: true, locked: false },
                { name: QET_LAYER_CONDUCTORS, color: '#38bdf8', lineType: 'CONTINUOUS', lineWeight: 35, visible: true, locked: false },
                { name: QET_LAYER_TEXTS, color: '#facc15', lineType: 'CONTINUOUS', lineWeight: 20, visible: true, locked: false },
            ],
            qetProject: {
                title: projectTitle,
                version: projectVersion,
            },
            qetDiagram: {
                title: diagTitle,
                insetTitle,
                width: totalWidth,
                height: totalHeight,
                order,
            },
            qetMetadata: {
                projectTitle,
                projectVersion,
                properties: props,
                sheetOrder: order,
                totalSheets: diagramNodes.length,
                cols,
                rows,
                colsize,
                rowsize,
                rawXml: xmlText,
            },
        };

        return addEntities(doc, entities);
    });

    return documents;
}

/**
 * Serializa documento CAD de volta para XML .qet (QElectroTech Project).
 */
export function documentToQet(doc, options = {}) {
    const meta = doc.qetMetadata || {};
    // Se o XML bruto original estiver salvo no metadata e não for pedido re-export total, usa-o
    if (meta.rawXml && options.preferRawXml) {
        return meta.rawXml;
    }

    const title = meta.projectTitle || doc.qetProject?.title || doc.name?.replace(/\.qet$/i, '') || 'Projeto Elétrico';
    const version = meta.projectVersion || doc.qetProject?.version || '0.100.0';
    const cols = meta.cols || 37;
    const rows = meta.rows || 25;
    const colsize = meta.colsize || 60;
    const rowsize = meta.rowsize || 80;

    const conductorsXml = [];
    const textsXml = [];

    (doc.entities || []).forEach((ent) => {
        if (ent.layer === QET_LAYER_CONDUCTORS) {
            const num = ent.wireNumber || ent.wireText || '';
            const color = ent.wireColor || ent.color || '#0066e2';
            const t1 = ent.terminal1 || generateUuid();
            const t2 = ent.terminal2 || generateUuid();
            let startX = 0;
            let startY = 0;
            let segs = '';

            if (ent.type === 'polyline' && Array.isArray(ent.vertices) && ent.vertices.length > 0) {
                startX = ent.vertices[0].x || 0;
                startY = -(ent.vertices[0].y || 0);
                for (let i = 0; i < ent.vertices.length - 1; i++) {
                    const p1 = ent.vertices[i];
                    const p2 = ent.vertices[i + 1];
                    const dx = p2.x - p1.x;
                    const dy = -(p2.y - p1.y); // Converte de volta para Y QET (para baixo)
                    if (Math.abs(dx) > 1e-4) {
                        segs += `\n            <segment orientation="horizontal" length="${dx.toFixed(2)}"/>`;
                    }
                    if (Math.abs(dy) > 1e-4) {
                        segs += `\n            <segment orientation="vertical" length="${dy.toFixed(2)}"/>`;
                    }
                }
            } else if (ent.type === 'line') {
                const x1 = ent.x1 ?? ent.start?.x ?? 0;
                const y1 = ent.y1 ?? ent.start?.y ?? 0;
                const x2 = ent.x2 ?? ent.end?.x ?? 0;
                const y2 = ent.y2 ?? ent.end?.y ?? 0;
                startX = x1;
                startY = -y1;
                const dx = x2 - x1;
                const dy = -(y2 - y1);
                if (Math.abs(dx) > 1e-4) {
                    segs += `\n            <segment orientation="horizontal" length="${dx.toFixed(2)}"/>`;
                }
                if (Math.abs(dy) > 1e-4) {
                    segs += `\n            <segment orientation="vertical" length="${dy.toFixed(2)}"/>`;
                }
            }

            conductorsXml.push(`        <conductor num="${escapeXml(num)}" formula="${escapeXml(num)}" color="${escapeXml(color)}" type="multi" userx="${startX.toFixed(2)}" usery="${startY.toFixed(2)}" terminal1="${escapeXml(t1)}" terminal2="${escapeXml(t2)}">${segs}
        </conductor>`);
        } else if (ent.layer === QET_LAYER_TEXTS) {
            const px = ent.x ?? ent.position?.x ?? 0;
            const py = -(ent.y ?? ent.position?.y ?? 0);
            const txt = ent.text || '';
            const sz = ent.height || 5;
            textsXml.push(`        <text x="${px}" y="${py}" size="${sz}" text="${escapeXml(txt)}"/>`);
        }
    });

    return `<?xml version="1.0" encoding="utf-8"?>
<project title="${escapeXml(title)}" version="${version}">
    <properties>
        <property name="saveddate" show="1">${new Date().toLocaleDateString('pt-BR')}</property>
        <property name="savedfilename" show="1">${escapeXml(title)}</property>
    </properties>
    <newdiagrams>
        <border cols="${cols}" colsize="${colsize}" rows="${rows}" rowsize="${rowsize}"/>
        <inset title="${escapeXml(title)}" folio="1/1"/>
    </newdiagrams>
    <diagram colsize="${colsize}" rowsize="${rowsize}" cols="${cols}" rows="${rows}" order="1" title="${escapeXml(title)}" version="${version}">
        <elements/>
        <conductors>
${conductorsXml.join('\n')}
        </conductors>
        <texts>
${textsXml.join('\n')}
        </texts>
    </diagram>
    <collection/>
</project>
`;
}
