// resources/js/cad/elmt.js
// Suporte bidirecional nativo a elementos e símbolos elétricos do QElectroTech (.elmt).
// Permite importar conectores, relés, sensores e controladores de bibliotecas QElectroTech,
// editar geometria e terminais elétricos no Traço CAD e exportar XML .elmt em conformidade.

import { createDocument, addEntities } from './document.js';

export const ELMT_DEFAULT_LAYER = 'ELMT_GEOMETRIA';
export const ELMT_TERMINAL_LAYER = 'TERMINAIS';

/**
 * Gera um UUID v4 estável para elementos e terminais.
 */
export function generateUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `{${crypto.randomUUID()}}`;
    }
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return `{${s4()}${s4()}-${s4()}-4${s4().substr(0, 3)}-${s4()}-${s4()}${s4()}${s4()}}`;
}

/**
 * Detecta se a string ou bytes possuem o cabeçalho de um elemento QElectroTech (.elmt).
 */
export function looksLikeElmt(input) {
    if (!input) return false;
    let str = '';
    if (typeof input === 'string') {
        str = input.slice(0, 500).trim();
    } else if (input instanceof ArrayBuffer) {
        str = new TextDecoder('utf-8').decode(new Uint8Array(input, 0, Math.min(500, input.byteLength))).trim();
    } else if (ArrayBuffer.isView(input)) {
        str = new TextDecoder('utf-8').decode(new Uint8Array(input.buffer, input.byteOffset, Math.min(500, input.byteLength))).trim();
    } else if (Array.isArray(input)) {
        str = new TextDecoder('utf-8').decode(new Uint8Array(input.slice(0, 500))).trim();
    } else {
        return false;
    }
    return /<definition[\s>]/i.test(str) && /type=["']element["']/i.test(str);
}

/**
 * Parser simples de XML para ambiente Node.js e Navegadores.
 */
export function parseXmlDom(xml) {
    const clean = xml
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/gi, '');

    const tagRegex = /<(\/?)([a-zA-Z0-9_:-]+)((?:\s+[a-zA-Z0-9_:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
    const root = { tag: 'root', attrs: {}, children: [], text: '' };
    const stack = [root];
    let match;

    const selfClosingTags = new Set([
        'rect', 'line', 'circle', 'ellipse', 'arc', 'polygon',
        'terminal', 'uuid', 'elementinformations'
    ]);

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
 * Converte arquivo XML QElectroTech (.elmt) em documento CAD.
 */
export function elmtToDocument(xmlText, options = {}) {
    if (!looksLikeElmt(xmlText)) {
        throw new Error('O conteúdo fornecido não é um elemento válido do QElectroTech (.elmt).');
    }

    const dom = parseXmlDom(xmlText);
    const defNode = dom.children.find((c) => c.tag === 'definition');
    if (!defNode) {
        throw new Error('Tag raiz <definition> ausente no arquivo .elmt.');
    }

    const width = parseFloat(defNode.attrs.width || 100);
    const height = parseFloat(defNode.attrs.height || 100);
    const hotspot_x = parseFloat(defNode.attrs.hotspot_x || width / 2);
    const hotspot_y = parseFloat(defNode.attrs.hotspot_y || height / 2);
    const version = defNode.attrs.version || '0.80';
    const link_type = defNode.attrs.link_type || 'simple';

    // Procura metadados: uuid, names, informations
    let uuid = generateUuid();
    const names = {};
    let informations = '';

    const uuidNode = defNode.children.find((c) => c.tag === 'uuid');
    if (uuidNode && uuidNode.attrs.uuid) {
        uuid = uuidNode.attrs.uuid;
    }

    const namesNode = defNode.children.find((c) => c.tag === 'names');
    if (namesNode) {
        namesNode.children.forEach((nc) => {
            if (nc.tag === 'name') {
                const lang = nc.attrs.lang || 'default';
                names[lang] = nc.text || nc.attrs.text || '';
            }
        });
    }

    const infoNode = defNode.children.find((c) => c.tag === 'informations');
    if (infoNode) {
        informations = infoNode.text || '';
    }

    const descNode = defNode.children.find((c) => c.tag === 'description');
    const rawChildren = descNode ? descNode.children : defNode.children;

    let idCounter = 1;
    const nextId = (prefix) => `${prefix}_elmt_${idCounter++}`;
    const entities = [];

    // Conversão de coordenadas:
    // No QET, o ponto (0, 0) é o hotspot de inserção e Y cresce para baixo.
    // No CAD, mantemos o hotspot em (0, 0) e invertemos Y (yCAD = -yQET).
    const toCadY = (y) => (-parseFloat(y || 0)) || 0;
    const toCadX = (x) => parseFloat(x || 0) || 0;

    rawChildren.forEach((node) => {
        const attrs = node.attrs;

        if (node.tag === 'line') {
            const x1 = toCadX(attrs.x1);
            const y1 = toCadY(attrs.y1);
            const x2 = toCadX(attrs.x2);
            const y2 = toCadY(attrs.y2);
            entities.push({
                id: nextId('line'),
                type: 'line',
                layer: ELMT_DEFAULT_LAYER,
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
            });
        } else if (node.tag === 'rect') {
            const x = toCadX(attrs.x);
            const y = parseFloat(attrs.y || 0);
            const w = parseFloat(attrs.width || 0);
            const h = parseFloat(attrs.height || 0);
            const rx = parseFloat(attrs.rx || 0);
            const ry = parseFloat(attrs.ry || rx);

            const minX = x;
            const maxX = x + w;
            const cadTopY = -y || 0;
            const cadBottomY = -(y + h) || 0;

            if (rx > 0 || ry > 0) {
                const r = Math.min(rx, w / 2, h / 2);
                const b = 0.41421356; // tan(90/4)
                entities.push({
                    id: nextId('rect'),
                    type: 'polyline',
                    layer: ELMT_DEFAULT_LAYER,
                    closed: true,
                    vertices: [
                        { x: minX + r, y: cadBottomY, bulge: 0 },
                        { x: maxX - r, y: cadBottomY, bulge: b },
                        { x: maxX, y: cadBottomY + r, bulge: 0 },
                        { x: maxX, y: cadTopY - r, bulge: b },
                        { x: maxX - r, y: cadTopY, bulge: 0 },
                        { x: minX + r, y: cadTopY, bulge: b },
                        { x: minX, y: cadTopY - r, bulge: 0 },
                        { x: minX, y: cadBottomY + r, bulge: b },
                    ],
                });
            } else {
                entities.push({
                    id: nextId('rect'),
                    type: 'polyline',
                    layer: ELMT_DEFAULT_LAYER,
                    closed: true,
                    vertices: [
                        { x: minX, y: cadBottomY, bulge: 0 },
                        { x: maxX, y: cadBottomY, bulge: 0 },
                        { x: maxX, y: cadTopY, bulge: 0 },
                        { x: minX, y: cadTopY, bulge: 0 },
                    ],
                });
            }
        } else if (node.tag === 'circle') {
            const x = parseFloat(attrs.x || 0);
            const y = parseFloat(attrs.y || 0);
            const d = parseFloat(attrs.diameter || 0);
            const r = d / 2;
            entities.push({
                id: nextId('circle'),
                type: 'circle',
                layer: ELMT_DEFAULT_LAYER,
                center: { x: (x + r) || 0, y: (-(y + r)) || 0 },
                radius: r,
            });
        } else if (node.tag === 'ellipse') {
            const x = parseFloat(attrs.x || 0);
            const y = parseFloat(attrs.y || 0);
            const w = parseFloat(attrs.width || 0);
            const h = parseFloat(attrs.height || 0);
            const rx = w / 2;
            const ry = h / 2;
            entities.push({
                id: nextId('ellipse'),
                type: 'ellipse',
                layer: ELMT_DEFAULT_LAYER,
                center: { x: (x + rx) || 0, y: (-(y + ry)) || 0 },
                major: { x: rx, y: 0 },
                ratio: rx > 0 ? ry / rx : 1,
                radiusX: rx,
                radiusY: ry,
                start: 0,
                end: Math.PI * 2,
            });
        } else if (node.tag === 'polygon') {
            const pts = [];
            let i = 1;
            while (attrs[`x${i}`] !== undefined && attrs[`y${i}`] !== undefined) {
                pts.push({
                    x: toCadX(attrs[`x${i}`]),
                    y: toCadY(attrs[`y${i}`]),
                    bulge: 0,
                });
                i += 1;
            }
            if (pts.length >= 2) {
                entities.push({
                    id: nextId('poly'),
                    type: 'polyline',
                    layer: ELMT_DEFAULT_LAYER,
                    closed: true,
                    vertices: pts,
                });
            }
        } else if (node.tag === 'text' || node.tag === 'input') {
            const x = toCadX(attrs.x);
            const y = toCadY(attrs.y);
            const textVal = attrs.text || node.text || '';
            const size = parseFloat(attrs.size || 5);
            const rotation = parseFloat(attrs.rotation || 0);
            entities.push({
                id: nextId('text'),
                type: 'text',
                layer: ELMT_DEFAULT_LAYER,
                position: { x, y },
                text: textVal,
                height: size,
                rotation: -rotation,
            });
        } else if (node.tag === 'terminal') {
            const x = toCadX(attrs.x);
            const y = toCadY(attrs.y);
            const orientation = (attrs.orientation || 'n').toLowerCase();
            const name = attrs.name || '';
            const termType = attrs.type || 'Generic';
            const termUuid = attrs.uuid || generateUuid();
            entities.push({
                id: nextId('term'),
                type: 'terminal',
                layer: ELMT_TERMINAL_LAYER,
                position: { x, y },
                orientation,
                name,
                terminalType: termType,
                uuid: termUuid,
            });
        }
    });

    const docName = options.name || names.pt || names.en || names.default || 'elemento.elmt';

    const doc = {
        ...createDocument(),
        name: docName,
        sourceFormat: 'elmt',
        units: 'mm',
        layers: [
            { name: '0', color: '#ffffff', lineType: 'CONTINUOUS', lineWeight: 25, visible: true, locked: false },
            { name: ELMT_DEFAULT_LAYER, color: '#e2e8f0', lineType: 'CONTINUOUS', lineWeight: 25, visible: true, locked: false },
            { name: ELMT_TERMINAL_LAYER, color: '#ef4444', lineType: 'CONTINUOUS', lineWeight: 35, visible: true, locked: false },
        ],
        elmtMetadata: {
            uuid,
            names,
            informations,
            width,
            height,
            hotspot_x,
            hotspot_y,
            version,
            link_type,
        },
    };

    return addEntities(doc, entities);
}

/**
 * Escapa strings para formato XML seguro.
 */
export function escapeXml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Serializa documento CAD de volta para XML .elmt (QElectroTech).
 */
export function documentToElmt(doc, options = {}) {
    const meta = doc.elmtMetadata || {};
    const entities = doc.entities || [];

    // Calcula os limites para definir width, height, hotspot_x e hotspot_y
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    entities.forEach((e) => {
        if (e.type === 'line') {
            minX = Math.min(minX, e.start.x, e.end.x);
            maxX = Math.max(maxX, e.start.x, e.end.x);
            minY = Math.min(minY, e.start.y, e.end.y);
            maxY = Math.max(maxY, e.start.y, e.end.y);
        } else if (e.type === 'circle') {
            minX = Math.min(minX, e.center.x - e.radius);
            maxX = Math.max(maxX, e.center.x + e.radius);
            minY = Math.min(minY, e.center.y - e.radius);
            maxY = Math.max(maxY, e.center.y + e.radius);
        } else if (e.type === 'ellipse') {
            const rx = e.radiusX || (e.major ? Math.hypot(e.major.x, e.major.y) : 10);
            const ry = e.radiusY || (e.ratio ? rx * e.ratio : 10);
            minX = Math.min(minX, e.center.x - rx);
            maxX = Math.max(maxX, e.center.x + rx);
            minY = Math.min(minY, e.center.y - ry);
            maxY = Math.max(maxY, e.center.y + ry);
        } else if (e.type === 'polyline') {
            (e.vertices || []).forEach((v) => {
                minX = Math.min(minX, v.x);
                maxX = Math.max(maxX, v.x);
                minY = Math.min(minY, v.y);
                maxY = Math.max(maxY, v.y);
            });
        } else if (e.type === 'terminal' || e.type === 'text') {
            const p = e.position || { x: 0, y: 0 };
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
    });

    if (!isFinite(minX)) {
        minX = -50; maxX = 50; minY = -50; maxY = 50;
    }

    // Coordenadas QET:
    // qetY = -cadY.
    // O ponto (0, 0) em CAD corresponde ao hotspot de inserção em QET.
    const qetMinX = minX;
    const qetMaxX = maxX;
    const qetMinY = -maxY;
    const qetMaxY = -minY;

    const width = meta.width || Math.ceil(qetMaxX - qetMinX + 20);
    const height = meta.height || Math.ceil(qetMaxY - qetMinY + 20);
    const hotspot_x = meta.hotspot_x || Math.round(-qetMinX + 10);
    const hotspot_y = meta.hotspot_y || Math.round(-qetMinY + 10);
    const version = meta.version || '0.200.1';
    const link_type = meta.link_type || 'simple';
    const uuid = meta.uuid || generateUuid();

    const namePt = meta.names?.pt || doc.name?.replace(/\.elmt$/i, '') || 'Elemento';
    const nameEn = meta.names?.en || meta.names?.pt || doc.name?.replace(/\.elmt$/i, '') || 'Element';
    const informations = meta.informations || 'Criado e editado via Traço CAD';

    const descLines = [];

    entities.forEach((e) => {
        if (e.type === 'line') {
            const x1 = e.start.x.toFixed(2);
            const y1 = (-e.start.y).toFixed(2);
            const x2 = e.end.x.toFixed(2);
            const y2 = (-e.end.y).toFixed(2);
            descLines.push(`        <line antialias="false" end1="none" end2="none" length1="1.5" length2="1.5" style="line-style:normal;line-weight:normal;filling:none;color:black" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
        } else if (e.type === 'circle') {
            const d = (e.radius * 2).toFixed(2);
            const x = (e.center.x - e.radius).toFixed(2);
            const y = (-e.center.y - e.radius).toFixed(2);
            descLines.push(`        <circle antialias="true" diameter="${d}" style="line-style:normal;line-weight:normal;filling:none;color:black" x="${x}" y="${y}"/>`);
        } else if (e.type === 'ellipse') {
            const rx = e.radiusX || (e.major ? Math.hypot(e.major.x, e.major.y) : 10);
            const ry = e.radiusY || (e.ratio ? rx * e.ratio : 10);
            const w = (rx * 2).toFixed(2);
            const h = (ry * 2).toFixed(2);
            const x = (e.center.x - rx).toFixed(2);
            const y = (-e.center.y - ry).toFixed(2);
            descLines.push(`        <ellipse antialias="true" width="${w}" height="${h}" style="line-style:normal;line-weight:normal;filling:none;color:black" x="${x}" y="${y}"/>`);
        } else if (e.type === 'polyline') {
            const v = e.vertices || [];
            // Verifica se é retângulo alinhado
            if (e.closed && v.length === 4 && (v[0].bulge ?? 0) === 0 && (v[1].bulge ?? 0) === 0) {
                const xs = v.map((p) => p.x);
                const ys = v.map((p) => p.y);
                const rMinX = Math.min(...xs);
                const rMaxX = Math.max(...xs);
                const rMinY = Math.min(...ys);
                const rMaxY = Math.max(...ys);
                const w = (rMaxX - rMinX).toFixed(2);
                const h = (rMaxY - rMinY).toFixed(2);
                const qetX = rMinX.toFixed(2);
                const qetY = (-rMaxY).toFixed(2);
                descLines.push(`        <rect antialias="true" height="${h}" width="${w}" style="line-style:normal;line-weight:normal;filling:none;color:black" x="${qetX}" y="${qetY}"/>`);
            } else {
                const attrs = v.map((p, idx) => `x${idx + 1}="${p.x.toFixed(2)}" y${idx + 1}="${(-p.y).toFixed(2)}"`).join(' ');
                descLines.push(`        <polygon antialias="true" style="line-style:normal;line-weight:normal;filling:none;color:black" ${attrs}/>`);
            }
        } else if (e.type === 'text') {
            const x = e.position.x.toFixed(2);
            const y = (-e.position.y).toFixed(2);
            const size = (e.height || 5).toFixed(1);
            const rot = (-(e.rotation || 0)).toFixed(0);
            descLines.push(`        <text color="#000000" font="Liberation Sans,${size},-1,0,50,0,0,0,0,0,Regular" rotation="${rot}" text="${escapeXml(e.text)}" x="${x}" y="${y}"/>`);
        } else if (e.type === 'terminal') {
            const x = e.position.x.toFixed(2);
            const y = (-e.position.y).toFixed(2);
            const ori = (e.orientation || 'n').toLowerCase();
            const termType = e.terminalType || 'Generic';
            const termUuid = e.uuid || generateUuid();
            const name = escapeXml(e.name || '');
            descLines.push(`        <terminal name="${name}" orientation="${ori}" type="${termType}" uuid="${termUuid}" x="${x}" y="${y}"/>`);
        }
    });

    return `<?xml version="1.0" encoding="utf-8"?>
<definition height="${height}" hotspot_x="${hotspot_x}" hotspot_y="${hotspot_y}" link_type="${link_type}" type="element" version="${version}" width="${width}">
    <uuid uuid="${uuid}"/>
    <names>
        <name lang="pt">${escapeXml(namePt)}</name>
        <name lang="en">${escapeXml(nameEn)}</name>
    </names>
    <elementInformations/>
    <informations>${escapeXml(informations)}</informations>
    <description>
${descLines.join('\n')}
    </description>
</definition>
`;
}
