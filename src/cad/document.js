import { SpatialIndex } from './spatial-index.js';
import { entityBox } from './geometry.js';

// Documento do CAD: entidades, layers e histórico de undo/redo.
// O estado é tratado como imutável: cada commit gera um novo snapshot.

export const DEFAULT_LAYER = '0';
export const BYLAYER = 'bylayer';

// Cores ACI (AutoCAD Color Index) usadas nos layers e no DXF.
export const ACI_COLORS = {
    1: '#ff0000',
    2: '#ffff00',
    3: '#00ff00',
    4: '#00ffff',
    5: '#0000ff',
    6: '#ff00ff',
    7: '#ffffff',
    8: '#808080',
    9: '#c0c0c0',
    30: '#ff7f00',
    40: '#ffbf00',
    50: '#bfff00',
    90: '#00ff7f',
    150: '#007fff',
    170: '#5f00ff',
    210: '#ff00bf',
};

export function aciToHex(index) {
    if (typeof index === 'string') return index.startsWith('#') ? index : ACI_COLORS[Number(index)] ?? '#ffffff';
    return ACI_COLORS[index] ?? '#ffffff';
}

// Tipos de linha suportados no render e no DXF (padrões em unidades de desenho, escaláveis).
export const LINETYPES = {
    CONTINUOUS: { description: 'Solid line', pattern: [] },
    DASHED: { description: 'Dashed __ __ __', pattern: [12, -6] },
    HIDDEN: { description: 'Hidden __ __', pattern: [6, -3] },
    CENTER: { description: 'Center ____ _ ____', pattern: [30, -6, 6, -6] },
    DOT: { description: 'Dot . . . .', pattern: [0, -6] },
    DASHDOT: { description: 'Dash dot __ . __ .', pattern: [12, -6, 0, -6] },
    PHANTOM: { description: 'Phantom ____ _ _ ____', pattern: [30, -6, 6, -6, 6, -6] },
};

// Espessuras (centésimos de mm, como o código 370 do DXF). 0 = padrão.
export const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

export function hexToAci(hex) {
    const entry = Object.entries(ACI_COLORS).find(([, value]) => value.toLowerCase() === String(hex).toLowerCase());
    return entry ? Number(entry[0]) : 7;
}

let nextId = 1;
export function newId() {
    nextId += 1;
    return `e${nextId}`;
}

export function createLayer(name, { color = 7, visible = true, locked = false, lineType = 'CONTINUOUS', lineWeight = 0 } = {}) {
    return { name, color, visible, locked, lineType, lineWeight };
}

export function renameLayer(doc, oldName, newName) {
    const target = String(newName ?? '').trim();
    if (!target || target === oldName) return doc;
    if (layerOf(doc, target)) return doc;
    return {
        ...doc,
        layers: doc.layers.map((l) => (l.name === oldName ? { ...l, name: target } : l)),
        entities: doc.entities.map((e) => (e.layer === oldName ? { ...e, layer: target } : e)),
        currentLayer: doc.currentLayer === oldName ? target : doc.currentLayer,
    };
}

export function deleteLayer(doc, name) {
    if (name === DEFAULT_LAYER || !layerOf(doc, name)) return doc;
    return {
        ...doc,
        layers: doc.layers.filter((l) => l.name !== name),
        entities: doc.entities.map((e) => (e.layer === name ? { ...e, layer: DEFAULT_LAYER } : e)),
        currentLayer: doc.currentLayer === name ? DEFAULT_LAYER : doc.currentLayer,
    };
}

export function createDocument() {
    return {
        entities: [],
        layers: [createLayer(DEFAULT_LAYER)],
        currentLayer: DEFAULT_LAYER,
        units: 'mm',
        name: 'Sem título.dxf',
        dimStyle: { textHeight: 2.5, arrowSize: 2.5, extOffset: 0.625, extBeyond: 1.25, textGap: 0.9, precision: 2, scale: 1 },
    };
}

export function normalizeEntity(entity, currentLayer = DEFAULT_LAYER) {
    const e = { ...entity };
    delete e._bbox;
    delete e._sampledPts;
    if (!e.id) e.id = newId();
    if (!e.layer) e.layer = currentLayer;
    if (e.color === undefined) e.color = BYLAYER;
    if (e.type === 'polyline') {
        e.vertices = e.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge ?? 0 }));
        e.closed = Boolean(e.closed);
    }
    if (e.type === 'dimension') {
        e.kind = e.kind ?? 'aligned';
    }
    if (e.type === 'text') {
        e.height = e.height ?? 2.5;
        e.rotation = e.rotation ?? 0;
        e.text = String(e.text ?? '');
    }
    return e;
}

export function entityColor(entity, doc) {
    if (entity.color && entity.color !== BYLAYER) return typeof entity.color === 'number' ? aciToHex(entity.color) : entity.color;
    const layer = doc.layers.find((l) => l.name === entity.layer);
    return aciToHex(layer?.color ?? 7);
}

export function layerOf(doc, name) {
    return doc.layers.find((l) => l.name === name) ?? null;
}

export function ensureLayer(doc, name, options = {}) {
    if (layerOf(doc, name)) return doc;
    return { ...doc, layers: [...doc.layers, createLayer(name, options)] };
}

export function visibleEntities(doc) {
    const hidden = new Set(doc.layers.filter((l) => !l.visible).map((l) => l.name));
    return doc.entities.filter((e) => !hidden.has(e.layer));
}

export function editableEntities(doc) {
    const blocked = new Set(doc.layers.filter((l) => !l.visible || l.locked).map((l) => l.name));
    return doc.entities.filter((e) => !blocked.has(e.layer));
}

export function isEntityEditable(doc, entity) {
    const layer = layerOf(doc, entity.layer);
    return !layer || (layer.visible && !layer.locked);
}

// Histórico linear de estados. `present` é o documento atual.
export class History {
    constructor(initial) {
        this.past = [];
        this.future = [];
        this.present = initial;
        this.limit = 200;
        this.cleanPastLength = 0;
    }

    commit(label, next) {
        if (next === this.present) return this.present;
        this.past.push({ label, doc: this.present });
        if (this.past.length > this.limit) {
            this.past.shift();
            if (this.cleanPastLength !== null && this.cleanPastLength > 0) {
                this.cleanPastLength--;
            }
        }
        this.future = [];
        this.present = next;
        return next;
    }

    replace(next) {
        // Ajuste sem registro (por exemplo, seleção de layer atual).
        this.present = next;
        return next;
    }

    markClean() {
        this.cleanPastLength = this.past.length;
    }

    isDirty() {
        if (this.cleanPastLength !== null && this.cleanPastLength !== undefined) {
            return this.past.length !== this.cleanPastLength;
        }
        return this.past.length > 0;
    }

    canUndo() {
        return this.past.length > 0;
    }

    canRedo() {
        return this.future.length > 0;
    }

    undo() {
        if (!this.canUndo()) return null;
        const entry = this.past.pop();
        this.future.push({ label: entry.label, doc: this.present });
        this.present = entry.doc;
        return entry.label;
    }

    redo() {
        if (!this.canRedo()) return null;
        const entry = this.future.pop();
        this.past.push({ label: entry.label, doc: this.present });
        this.present = entry.doc;
        return entry.label;
    }

    reset(doc) {
        this.past = [];
        this.future = [];
        this.present = doc;
        this.cleanPastLength = 0;
    }
}

// Seleção, explode e edição localizam entidades por id: sem id (DWG importado antes desta correção)
// ou com id repetido, selecionar uma selecionava todas e explodir trocava o desenho inteiro pelo bloco.
export function ensureEntityIds(doc) {
    if (!Array.isArray(doc?.entities)) return doc;
    // O contador reinicia a cada carga da página; sem reservar os ids restaurados, a próxima entidade criada repetiria e2, e3…
    doc.entities.forEach((e) => {
        const n = /^e(\d+)$/.exec(e.id ?? '')?.[1];
        if (n) nextId = Math.max(nextId, Number(n));
    });
    const seen = new Set();
    let changed = false;
    const entities = doc.entities.map((e) => {
        if (e.id && !seen.has(e.id)) { seen.add(e.id); return e; }
        changed = true;
        const id = newId();
        seen.add(id);
        return { ...e, id };
    });
    return changed ? { ...doc, entities } : doc;
}

// Operações puras sobre o documento. Cada uma retorna um novo documento.
export function addEntities(doc, entities) {
    const normalized = entities.map((e) => normalizeEntity(e, doc.currentLayer));
    return { ...doc, entities: [...doc.entities, ...normalized] };
}

export function removeEntities(doc, ids) {
    const set = new Set(ids);
    return { ...doc, entities: doc.entities.filter((e) => !set.has(e.id)) };
}

export function replaceEntities(doc, replacements) {
    // replacements: Map<id, entity|entity[]|null>
    const out = [];
    doc.entities.forEach((e) => {
        if (!replacements.has(e.id)) {
            out.push(e);
            return;
        }
        const value = replacements.get(e.id);
        if (value === null || value === undefined) return;
        const list = Array.isArray(value) ? value : [value];
        list.forEach((item, index) => {
            out.push(normalizeEntity({ ...item, id: index === 0 && item.id ? item.id : (index === 0 ? e.id : undefined) }, doc.currentLayer));
        });
    });
    return { ...doc, entities: out };
}

export function updateEntities(doc, ids, fn) {
    const set = new Set(ids);
    return { ...doc, entities: doc.entities.map((e) => (set.has(e.id) ? normalizeEntity(fn(e), doc.currentLayer) : e)) };
}

export function setCurrentLayer(doc, name) {
    const withLayer = ensureLayer(doc, name);
    return { ...withLayer, currentLayer: name };
}

export function updateLayer(doc, name, changes) {
    return { ...doc, layers: doc.layers.map((l) => (l.name === name ? { ...l, ...changes } : l)) };
}

export function findEntity(doc, id) {
    return doc.entities.find((e) => e.id === id) ?? null;
}

export function documentStats(doc) {
    const byType = {};
    doc.entities.forEach((e) => {
        byType[e.type] = (byType[e.type] ?? 0) + 1;
    });
    return { total: doc.entities.length, byType, layers: doc.layers.length };
}

// Cache fraco de SpatialIndex associado a cada snapshot imutável do documento
const spatialIndexCache = new WeakMap();

export function getDocumentSpatialIndex(doc) {
    if (!doc) return null;
    let index = spatialIndexCache.get(doc);
    if (!index) {
        index = new SpatialIndex({ getBBox: entityBox });
        index.load(doc.entities);
        spatialIndexCache.set(doc, index);
    }
    return index;
}

