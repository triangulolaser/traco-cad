// Motor do esquemático (ADR 0007): símbolo com portas, ligação presa às portas, junção e redes.
//
// Entidades novas no documento:
//   symbol   { def: "<biblioteca>/<id>", position, rotation: 0|90|180|270, espelho, atributos: {nome: valor}, deslocamentos?: {nome: {x,y}} }
//   link     { from: Ponta, to: Ponta, vertices: [{x,y}] (só os intermediários), manual?, route?: 'L'|'Z', ends: [{x,y},{x,y}] }
//   junction { position }
// Ponta = { symbol, port } | { junction } | { point: {x,y} }.
// `ends` é derivado das portas (cache em memória, nunca vai para o .traco); é refeito por syncSchematic.
// A rede é calculada (analyzeSchematic), nunca gravada. A ligação não tem classe: o tipo de linha sai da rede.

import { registerEntityProvider, entityCurves, entityBox, transformEntity, distance } from './geometry.js';
import { terminalTransform } from './extra-entities.js';
import { entityOnActiveSheet, entitySheet, sheetsOf } from './schematic-mode.js';
import { getSymbolDef } from './schematic-library.js';
// O desenho dos símbolos usa hachura sólida: o provedor precisa estar registrado também fora do editor.
import './hatch.js';

export const SCHEMATIC_TYPES = new Set(['symbol', 'link', 'junction']);
export const DASHED_PORT_TYPES = new Set(['piloto', 'dreno']);

// Tipos que podem dividir a mesma rede. Fora daqui é E2. Mesma tabela nos dois sentidos.
export const PORT_COMPATIBILITY = {
    pressao: ['pressao', 'trabalho'],
    trabalho: ['trabalho', 'pressao', 'retorno'],
    retorno: ['retorno', 'trabalho', 'dreno', 'succao'],
    succao: ['succao', 'retorno'],
    dreno: ['dreno', 'retorno'],
    piloto: ['piloto'],
};

// Pares fora da tabela que não são erro, só aviso A5: piloto de contrabalanço e de retenção pilotada vem
// da linha de trabalho; piloto de descarga e de alívio vem da pressão. Continua aparecendo porque o sinal
// de carga ligado por engano na pressão é erro real.
export const PORT_WARNINGS = new Set(['piloto+pressao', 'piloto+trabalho']);

const pairKey = (a, b) => [a, b].sort((x, y) => (x === 'piloto' ? -1 : y === 'piloto' ? 1 : x.localeCompare(y))).join('+');

export function typesCompatible(a, b) {
    return Boolean(PORT_COMPATIBILITY[a]?.includes(b) && PORT_COMPATIBILITY[b]?.includes(a));
}

const DIR = { n: { x: 0, y: 1 }, s: { x: 0, y: -1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } };
const CCW = { n: 'w', w: 's', s: 'e', e: 'n' };
const COS = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN = { 0: 0, 90: 1, 180: 0, 270: -1 };

export function normalizeRotation(deg) {
    const r = Math.round((Number(deg) || 0) / 90) * 90;
    return ((r % 360) + 360) % 360;
}

function round(v) {
    return Math.round(v * 1e9) / 1e9;
}

// Local (definição) → mundo: espelho em X (troca e/w), depois rotação, depois translação.
export function symbolLocalFn(entity) {
    const rot = normalizeRotation(entity.rotation);
    const c = COS[rot];
    const s = SIN[rot];
    const m = entity.espelho ? -1 : 1;
    const o = entity.position;
    return (p) => {
        const x = p.x * m;
        return { x: round(o.x + x * c - p.y * s), y: round(o.y + x * s + p.y * c) };
    };
}

function rotateOrientation(orientation, rotation) {
    let o = orientation;
    for (let r = normalizeRotation(rotation); r > 0; r -= 90) o = CCW[o] ?? o;
    return o;
}

// Portas da instância no mundo. O espelho reaproveita o terminalTransform (troca e/w); a rotação gira a orientação.
export function symbolPorts(entity, def = getSymbolDef(entity.def)) {
    if (!def) return [];
    const fn = symbolLocalFn(entity);
    return def.portas.map((p) => {
        const mirrored = terminalTransform({ type: 'terminal', position: p.position, orientation: p.orientation }, (q) => q, Boolean(entity.espelho));
        return {
            name: p.name,
            type: p.type,
            required: p.required,
            position: fn(p.position),
            orientation: rotateOrientation(mirrored.orientation, entity.rotation),
        };
    });
}

export function symbolPort(entity, name) {
    return symbolPorts(entity).find((p) => p.name === name) ?? null;
}

// Rótulo visível: valor gravado ou, sem valor, o prefixo seguido de '?'.
function attributeText(entity, attr) {
    const value = entity.atributos?.[attr.nome];
    if (value !== undefined && value !== null && String(value) !== '') return String(value);
    if (attr.nome === 'sinal') return '?';
    return attr.nome === 'etiqueta' && attr.prefixo ? `${attr.prefixo}?` : '';
}

const childCache = new WeakMap();

// Geometria da instância no mundo: desenho da definição + textos dos atributos visíveis.
// Texto não gira com o símbolo, para continuar legível; só o deslocamento manual é gravado.
export function symbolChildren(entity) {
    if (childCache.has(entity)) return childCache.get(entity);
    const def = getSymbolDef(entity.def);
    let out;
    if (!def) {
        const p = entity.position;
        out = [{ type: 'polyline', closed: true, vertices: [[-5, -5], [5, -5], [5, 5], [-5, 5]].map(([x, y]) => ({ x: p.x + x, y: p.y + y, bulge: 0 })), layer: entity.layer, color: entity.color }];
    } else {
        const fn = symbolLocalFn(entity);
        const mirror = Boolean(entity.espelho);
        out = def.geometria.map((g) => ({ ...transformEntity({ ...g }, fn, { mirror }), layer: entity.layer, color: entity.color }));
        for (const attr of def.atributos) {
            if (!attr.visivel || !attr.posicao) continue;
            const text = attributeText(entity, attr);
            if (!text) continue;
            const base = fn(attr.posicao);
            const off = entity.deslocamentos?.[attr.nome] ?? { x: 0, y: 0 };
            out.push({ type: 'text', position: { x: base.x + off.x, y: base.y + off.y }, height: attr.altura ?? 2.5, rotation: 0, text, layer: entity.layer, color: entity.color });
        }
    }
    childCache.set(entity, out);
    return out;
}

// Transformação genérica (MOVE, ROTATE, MIRROR, cópia): só ângulos de 90° e espelho booleano.
function symbolTransform(entity, fn, mirror) {
    const position = fn(entity.position);
    const espelho = mirror ? !entity.espelho : Boolean(entity.espelho);
    const local = symbolLocalFn(entity);
    const ex = fn(local({ x: 1, y: 0 }));
    const angle = (Math.atan2(ex.y - position.y, ex.x - position.x) * 180) / Math.PI;
    // R(rot)·M(espelho)·(1,0) aponta para ex: com espelho o eixo local X fica invertido.
    const rotation = normalizeRotation(angle - (espelho ? 180 : 0));
    const out = { ...entity, position, rotation, espelho };
    delete out._bbox;
    return out;
}

registerEntityProvider('symbol', {
    curves: (entity) => symbolChildren(entity).flatMap(entityCurves),
    extraPoints: (entity) => [
        ...symbolChildren(entity).flatMap((child) => {
            const b = entityBox(child);
            return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }];
        }),
        ...symbolPorts(entity).map((p) => p.position),
    ],
    transform: symbolTransform,
    snapPoints: (entity) => [
        ...symbolPorts(entity).map((p) => ({ mode: 'nod', point: p.position })),
        { mode: 'nod', point: entity.position },
    ],
});

// ---------------------------------------------------------------------------
// Ligação

export function linkPoints(entity) {
    const ends = entity.ends ?? [];
    const a = ends[0] ?? entity.from?.point;
    const b = ends[1] ?? entity.to?.point;
    return [a, ...(entity.vertices ?? []), b].filter(Boolean);
}

function linkTransform(entity, fn) {
    const out = { ...entity, vertices: (entity.vertices ?? []).map(fn) };
    if (entity.ends) out.ends = entity.ends.map(fn);
    if (entity.from?.point) out.from = { point: fn(entity.from.point) };
    if (entity.to?.point) out.to = { point: fn(entity.to.point) };
    if ((entity.vertices ?? []).length) out.manual = true;
    delete out._bbox;
    return out;
}

registerEntityProvider('link', {
    curves: (entity) => {
        const pts = linkPoints(entity);
        const out = [];
        for (let i = 0; i + 1 < pts.length; i += 1) out.push({ kind: 'segment', a: pts[i], b: pts[i + 1] });
        return out;
    },
    extraPoints: (entity) => linkPoints(entity),
    transform: linkTransform,
    snapPoints: (entity) => linkPoints(entity).map((p) => ({ mode: 'end', point: p })),
});

registerEntityProvider('junction', {
    curves: (entity) => [{ kind: 'circle', center: entity.position, radius: JUNCTION_RADIUS }],
    extraPoints: (entity) => [entity.position],
    transform: (entity, fn) => {
        const out = { ...entity, position: fn(entity.position) };
        delete out._bbox;
        return out;
    },
    snapPoints: (entity) => [{ mode: 'nod', point: entity.position }],
});

export const JUNCTION_RADIUS = 0.75;

// ---------------------------------------------------------------------------
// Roteamento ortogonal: só L ou Z, sem desvio de obstáculo.

function horizontal(orientation) {
    return orientation === 'e' || orientation === 'w';
}

// a/b: pontos; oa/ob: orientação da saída (n/s/e/w) ou null (junção, ponta livre).
// route: 'L' ou 'Z' força a forma; sem preferência, L quando as saídas são cruzadas, Z quando paralelas.
export function routeLink(a, oa, b, ob, route = null) {
    if (Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9) return [];
    const ha = oa ? horizontal(oa) : (ob ? !horizontal(ob) : true);
    const hb = ob ? horizontal(ob) : !ha;
    const shape = route ?? (ha === hb ? 'Z' : 'L');
    if (shape === 'L') return ha ? [{ x: b.x, y: a.y }] : [{ x: a.x, y: b.y }];
    if (ha) {
        const mx = round((a.x + b.x) / 2);
        return [{ x: mx, y: a.y }, { x: mx, y: b.y }];
    }
    const my = round((a.y + b.y) / 2);
    return [{ x: a.x, y: my }, { x: b.x, y: my }];
}

// Ponta → { point, orientation, missing }.
export function resolveEnd(end, index) {
    if (end?.symbol !== undefined) {
        const sym = index.symbols.get(end.symbol);
        const port = sym ? symbolPort(sym, end.port) : null;
        return port ? { point: port.position, orientation: port.orientation, missing: false } : { point: null, orientation: null, missing: true };
    }
    if (end?.junction !== undefined) {
        const j = index.junctions.get(end.junction);
        return j ? { point: j.position, orientation: null, missing: false } : { point: null, orientation: null, missing: true };
    }
    if (end?.point) return { point: end.point, orientation: null, missing: false };
    return { point: null, orientation: null, missing: true };
}

function indexDoc(doc) {
    const symbols = new Map();
    const junctions = new Map();
    for (const e of doc.entities) {
        if (e.type === 'symbol') symbols.set(e.id, e);
        else if (e.type === 'junction') junctions.set(e.id, e);
    }
    return { symbols, junctions };
}

function samePoint(a, b) {
    return Boolean(a && b) && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

// Mantém ortogonal o primeiro (ou último) trecho de uma ligação com vértices manuais quando a ponta anda.
function keepOrthogonal(vertex, oldEnd, newEnd) {
    if (!oldEnd) return vertex;
    if (Math.abs(vertex.y - oldEnd.y) < 1e-9) return { x: vertex.x, y: newEnd.y };
    if (Math.abs(vertex.x - oldEnd.x) < 1e-9) return { x: newEnd.x, y: vertex.y };
    return vertex;
}

// Refaz as pontas e o traçado das ligações cujas portas mudaram. Devolve o mesmo doc se nada mudou.
// Ponta ausente (símbolo apagado) guarda a última posição: a ligação fica solta, em vermelho.
export function syncSchematic(doc) {
    if (!doc?.entities?.some((e) => e.type === 'link')) return doc;
    const index = indexDoc(doc);
    let changed = false;
    const entities = doc.entities.map((e) => {
        if (e.type !== 'link') return e;
        const ra = resolveEnd(e.from, index);
        const rb = resolveEnd(e.to, index);
        const old = e.ends ?? [];
        const a = ra.point ?? old[0] ?? null;
        const b = rb.point ?? old[1] ?? null;
        if (!a || !b) return e;
        if (samePoint(a, old[0]) && samePoint(b, old[1]) && e.vertices) return e;
        let vertices;
        if (e.manual && (e.vertices ?? []).length) {
            vertices = e.vertices.map((v) => ({ ...v }));
            vertices[0] = keepOrthogonal(vertices[0], old[0], a);
            const last = vertices.length - 1;
            vertices[last] = keepOrthogonal(vertices[last], old[1], b);
        } else {
            vertices = routeLink(a, ra.orientation, b, rb.orientation, e.route ?? null);
        }
        changed = true;
        const next = { ...e, ends: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], vertices };
        delete next._bbox;
        return next;
    });
    return changed ? { ...doc, entities } : doc;
}

// ---------------------------------------------------------------------------
// Redes e verificações

class UnionFind {
    constructor() {
        this.parent = new Map();
    }

    find(k) {
        if (!this.parent.has(k)) this.parent.set(k, k);
        let r = k;
        while (this.parent.get(r) !== r) r = this.parent.get(r);
        let c = k;
        while (this.parent.get(c) !== r) {
            const n = this.parent.get(c);
            this.parent.set(c, r);
            c = n;
        }
        return r;
    }

    union(a, b) {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
}

const portKey = (symbolId, port) => `p:${symbolId}:${port}`;

function endKey(end, linkId, side) {
    if (end?.symbol !== undefined) return portKey(end.symbol, end.port);
    if (end?.junction !== undefined) return `j:${end.junction}`;
    return `f:${linkId}:${side}`;
}

const analysisCache = new WeakMap();

// Redes, tipo efetivo (com herança pelas peças passantes), tipo de linha de cada ligação e problemas.
// problems: E1 porta obrigatória solta; E2 tipos incompatíveis na rede (ou através de peça passante);
// A5 piloto ligado a linha de potência (aviso). Redes e E2 são locais: a `rede_global` (tanque) só junta
// as redes na lista `nets`, senão sucção num tanque e dreno em outro acusariam E2.
// Ligação com ponta ausente não é erro: entra em `loose` e é desenhada em vermelho.
export function analyzeSchematic(doc) {
    const key = doc?.entities;
    if (!key) return emptyAnalysis();
    if (analysisCache.has(key)) return analysisCache.get(key);
    const index = indexDoc(doc);
    const uf = new UnionFind();
    const ports = [];
    const passanteSides = [];
    const globalPorts = new Map();
    const globalKeys = new Set();
    // Conector de página: todos com o mesmo sinal são uma rede só, em qualquer folha.
    const signals = new Map();
    for (const sym of index.symbols.values()) {
        const def = getSymbolDef(sym.def);
        if (!def) continue;
        const world = symbolPorts(sym, def);
        if (def.conector) {
            const sinal = connectorSignal(sym);
            if (!signals.has(sinal)) signals.set(sinal, []);
            for (const p of world) {
                const k = portKey(sym.id, p.name);
                uf.find(k);
                ports.push({ key: k, symbol: sym.id, ...p });
                signals.get(sinal).push({ symbol: sym.id, key: k, position: p.position });
            }
            continue;
        }
        const sides = [];
        for (const p of world) {
            const k = portKey(sym.id, p.name);
            uf.find(k);
            ports.push({ key: k, symbol: sym.id, ...p });
            if (def.rede_global) {
                if (!globalPorts.has(def.rede_global)) globalPorts.set(def.rede_global, []);
                globalPorts.get(def.rede_global).push(k);
                globalKeys.add(k);
            }
            if (p.type === 'passante') sides.push(k);
        }
        if (sides.length) passanteSides.push({ symbol: sym.id, sides });
    }
    const connected = new Set();
    const loose = new Set();
    const links = [];
    for (const e of doc.entities) {
        if (e.type === 'link') {
            const ka = endKey(e.from, e.id, 0);
            const kb = endKey(e.to, e.id, 1);
            uf.union(`l:${e.id}`, ka);
            uf.union(`l:${e.id}`, kb);
            connected.add(ka);
            connected.add(kb);
            if (resolveEnd(e.from, index).missing || resolveEnd(e.to, index).missing) loose.add(e.id);
            links.push(e);
        } else if (e.type === 'junction') {
            uf.find(`j:${e.id}`);
        }
    }
    for (const [sinal, members] of signals) {
        if (!sinal) continue;
        for (let i = 1; i < members.length; i += 1) uf.union(members[0].key, members[i].key);
    }
    // Tipos próprios de cada rede (passante não conta).
    const own = new Map();
    const ensure = (root) => {
        if (!own.has(root)) own.set(root, new Set());
        return own.get(root);
    };
    // Tipo de linha: a porta do tanque não conta, então dreno até o tanque sai tracejado.
    const lineOwn = new Map();
    for (const p of ports) {
        const root = uf.find(p.key);
        const set = ensure(root);
        if (!lineOwn.has(root)) lineOwn.set(root, new Set());
        if (p.type === 'passante') continue;
        set.add(p.type);
        if (!globalKeys.has(p.key)) lineOwn.get(root).add(p.type);
    }
    // Herança: rede sem tipo próprio herda o tipo do outro lado da peça passante, até estabilizar.
    const effective = new Map([...own].map(([k, v]) => [k, new Set(v)]));
    for (let guard = 0, grew = true; grew && guard < 1000; guard += 1) {
        grew = false;
        for (const { sides } of passanteSides) {
            const roots = sides.map((k) => uf.find(k));
            for (const r of roots) {
                if (own.get(r)?.size) continue;
                const target = effective.get(r);
                for (const other of roots) {
                    if (other === r) continue;
                    for (const t of effective.get(other) ?? []) {
                        if (!target.has(t)) {
                            target.add(t);
                            grew = true;
                        }
                    }
                }
            }
        }
    }
    const lineTypeOf = (root) => {
        const mine = lineOwn.get(root);
        const types = [...(mine?.size ? mine : own.get(root)?.size ? [] : effective.get(root) ?? [])];
        return types.length && types.every((t) => DASHED_PORT_TYPES.has(t)) ? 'DASHED' : 'CONTINUOUS';
    };
    const linkLineType = new Map();
    const linkNet = new Map();
    for (const e of links) {
        const root = uf.find(`l:${e.id}`);
        linkNet.set(e.id, root);
        linkLineType.set(e.id, lineTypeOf(root));
    }
    const problems = [];
    // Primeiro par de erro; sem erro, primeiro par de aviso.
    const incompatible = (types) => {
        const list = [...types].sort();
        let warn = null;
        for (let i = 0; i < list.length; i += 1) {
            for (let j = i + 1; j < list.length; j += 1) {
                if (typesCompatible(list[i], list[j])) continue;
                if (!PORT_WARNINGS.has(pairKey(list[i], list[j]))) return { code: 'E2', types: [list[i], list[j]] };
                warn ??= { code: 'A5', types: [list[i], list[j]] };
            }
        }
        return warn;
    };
    const portsByRoot = new Map();
    for (const p of ports) {
        const r = uf.find(p.key);
        if (!portsByRoot.has(r)) portsByRoot.set(r, []);
        portsByRoot.get(r).push(p);
    }
    for (const [root, types] of [...effective].sort(([a], [b]) => a.localeCompare(b))) {
        const found = incompatible(types);
        if (!found) continue;
        const members = portsByRoot.get(root) ?? [];
        problems.push({
            code: found.code,
            net: root,
            types: found.types,
            ids: [...new Set([...members.map((p) => p.symbol), ...links.filter((l) => linkNet.get(l.id) === root).map((l) => l.id)])],
            point: members[0]?.position ?? null,
        });
    }
    for (const { symbol, sides } of passanteSides) {
        const union = new Set(sides.flatMap((k) => [...(effective.get(uf.find(k)) ?? [])]));
        const found = incompatible(union);
        const roots = new Set(sides.map((k) => uf.find(k)));
        if (!found || roots.size < 2) continue;
        if (problems.some((p) => p.ids.includes(symbol) && roots.has(p.net) && (p.code === 'E2' || p.code === found.code))) continue;
        problems.push({ code: found.code, net: null, types: found.types, ids: [symbol], point: index.symbols.get(symbol)?.position ?? null });
    }
    // A6: conector sem nome de sinal ou sem par (o sinal só aparece nele).
    for (const [sinal, members] of [...signals].sort(([a], [b]) => a.localeCompare(b))) {
        if (sinal && members.length > 1) continue;
        for (const m of members) problems.push({ code: 'A6', sinal, ids: [m.symbol], point: m.position });
    }
    const unconnected = [];
    for (const p of ports) {
        if (!p.required || connected.has(p.key)) continue;
        unconnected.push(p);
        problems.push({ code: 'E1', port: p.name, ids: [p.symbol], point: p.position });
    }
    // Lista de redes: aqui sim a rede global junta as redes locais (todos os tanques são uma rede só).
    const listUf = new UnionFind();
    for (const [name, keys] of globalPorts) for (const k of keys) listUf.union(uf.find(k), `g:${name}`);
    const groups = new Map();
    for (const root of [...new Set([...portsByRoot.keys(), ...linkNet.values()])].sort()) {
        const g = listUf.find(root);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(root);
    }
    const nets = [...groups.values()].map((roots) => {
        const types = new Set(roots.flatMap((r) => [...(effective.get(r) ?? [])]));
        return {
            id: roots[0],
            ports: roots.flatMap((r) => (portsByRoot.get(r) ?? []).map((p) => ({ symbol: p.symbol, port: p.name, type: p.type }))),
            types: [...types].sort(),
            lineType: roots.length === 1 ? lineTypeOf(roots[0]) : 'CONTINUOUS',
        };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const result = { nets, linkLineType, linkNet, loose, unconnected, problems };
    analysisCache.set(key, result);
    return result;
}

function emptyAnalysis() {
    return { nets: [], linkLineType: new Map(), linkNet: new Map(), loose: new Set(), unconnected: [], problems: [] };
}

export function connectorSignal(entity) {
    return String(entity?.atributos?.sinal ?? '').trim();
}

export function isConnector(entity) {
    return entity?.type === 'symbol' && Boolean(getSymbolDef(entity.def)?.conector);
}

// Referência cruzada do conector de página: números das outras folhas com o mesmo sinal.
// Derivada, nunca gravada. Map(id do conector → [números de folha]).
export function connectorReferences(doc) {
    const sheets = sheetsOf(doc);
    const number = new Map(sheets.map((s, i) => [s.id, i + 1]));
    const bySignal = new Map();
    for (const e of doc?.entities ?? []) {
        if (!isConnector(e)) continue;
        const sinal = connectorSignal(e);
        if (!sinal) continue;
        if (!bySignal.has(sinal)) bySignal.set(sinal, []);
        bySignal.get(sinal).push(e);
    }
    const out = new Map();
    for (const members of bySignal.values()) {
        for (const e of members) {
            const own = entitySheet(doc, e);
            const others = [...new Set(members.filter((m) => m !== e).map((m) => number.get(entitySheet(doc, m))).filter((n) => n && number.get(own) !== n))].sort((a, b) => a - b);
            out.set(e.id, others);
        }
    }
    return out;
}

// Texto da referência cruzada, depois da ponta da bandeira, sem girar.
export function connectorReferenceTexts(doc, filter = () => true) {
    const refs = connectorReferences(doc);
    const out = [];
    for (const e of doc?.entities ?? []) {
        const list = refs.get(e.id);
        if (!list?.length || !filter(e)) continue;
        const fn = symbolLocalFn(e);
        const tip = fn({ x: 21.5, y: 0 });
        const tail = fn({ x: 0, y: 0 });
        const text = `fl. ${list.join(', ')}`;
        const height = 2.5;
        // Bandeira para a esquerda: o texto termina antes da ponta.
        const width = text.length * height * 0.6;
        const x = tip.x < tail.x - 1e-9 ? tip.x - width : tip.x;
        const y = Math.abs(tip.y - tail.y) > 1e-9 ? tip.y + (tip.y > tail.y ? 1 : -1 - height) : tip.y - height / 2;
        out.push({ type: 'text', id: `__ref:${e.id}`, position: { x, y }, height, rotation: 0, text, layer: e.layer, color: e.color });
    }
    return out;
}

// Porta mais próxima de um ponto, dentro da tolerância (unidades do desenho).
export function findPortNear(doc, point, tolerance) {
    let best = null;
    for (const e of doc.entities) {
        if (e.type !== 'symbol' || !entityOnActiveSheet(doc, e)) continue;
        for (const p of symbolPorts(e)) {
            const d = distance(p.position, point);
            if (d <= tolerance && (!best || d < best.distance)) best = { symbol: e, port: p, distance: d };
        }
    }
    return best;
}

export function findJunctionNear(doc, point, tolerance) {
    let best = null;
    for (const e of doc.entities) {
        if (e.type !== 'junction' || !entityOnActiveSheet(doc, e)) continue;
        const d = distance(e.position, point);
        if (d <= tolerance && (!best || d < best.distance)) best = { junction: e, distance: d };
    }
    return best;
}

// Ponto de uma ligação mais próximo do cursor (para criar junção no meio dela).
export function findLinkNear(doc, point, tolerance) {
    let best = null;
    for (const e of doc.entities) {
        if (e.type !== 'link' || !entityOnActiveSheet(doc, e)) continue;
        const pts = linkPoints(e);
        for (let i = 0; i + 1 < pts.length; i += 1) {
            const a = pts[i];
            const b = pts[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0;
            const q = { x: round(a.x + t * dx), y: round(a.y + t * dy) };
            const d = distance(q, point);
            if (d <= tolerance && (!best || d < best.distance)) best = { link: e, segment: i, point: q, distance: d };
        }
    }
    return best;
}

// Divide a ligação no ponto (sobre o trecho `segment`), criando a junção. Devolve as entidades novas.
export function splitLinkAt(link, segment, point, junctionId, newLinkId) {
    const verts = link.vertices ?? [];
    const before = verts.slice(0, segment);
    const after = verts.slice(segment);
    const first = { ...link, to: { junction: junctionId }, vertices: before, manual: true, ends: [link.ends?.[0], point].filter(Boolean) };
    const second = { ...link, id: newLinkId, from: { junction: junctionId }, vertices: after, manual: true, ends: [point, link.ends?.[1]].filter(Boolean) };
    delete first._bbox;
    delete second._bbox;
    return { first, second, junction: { type: 'junction', id: junctionId, position: point, layer: link.layer, color: link.color } };
}

// Próxima etiqueta livre com o prefixo (V1, V2…).
export function nextLabel(doc, prefix) {
    let n = 0;
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    // Etiqueta é única no esquema inteiro, não por folha.
    for (const e of doc.entities) {
        if (e.type !== 'symbol') continue;
        const m = re.exec(String(e.atributos?.etiqueta ?? ''));
        if (m) n = Math.max(n, Number(m[1]));
    }
    return `${prefix}${n + 1}`;
}

export function createSymbol(ref, position, { rotation = 0, espelho = false, atributos = {}, layer } = {}) {
    if (!getSymbolDef(ref)) throw new Error(`Símbolo ${ref} não está em nenhuma biblioteca carregada.`);
    const out = { type: 'symbol', def: ref, position: { x: position.x, y: position.y }, rotation: normalizeRotation(rotation), espelho: Boolean(espelho), atributos: { ...atributos } };
    if (layer) out.layer = layer;
    return out;
}
