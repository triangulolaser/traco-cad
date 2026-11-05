// Matriz (ARRAY): gera as cópias a partir de parâmetros e guarda a matriz associativa como um
// INSERT com `array`. As origens ficam nas primeiras `sourceCount` entidades da definição, as
// cópias depois. Os parâmetros ficam no sistema local do bloco: mover, girar, escalar ou espelhar
// a matriz não invalida nada, e editar só refaz a definição.

import { add, sub, scale, distance, degToRad, polar, rotatePoint, entityBox, translateEntity, rotateEntity, emptyBox, boxAddPoint, boxIsEmpty } from './geometry.js';

export const ARRAY_XDATA_APP = 'TRACO_ARRAY';
// Teto de entidades na matriz: acima disso a tela deixa de responder durante a pré-visualização.
export const MAX_ARRAY_ENTITIES = 20000;

export const ARRAY_MODE_LABELS = { r: 'Retangular', p: 'Polar', l: 'Linear' };
export const ARRAY_TITLES = { r: 'Matriz retangular', p: 'Matriz polar', l: 'Matriz linear' };

const MODE_KEYS = {
    r: ['rows', 'cols', 'rowSpacing', 'colSpacing'],
    p: ['count', 'fill', 'rotate', 'center'],
    l: ['count', 'distance', 'angle'],
};

// Campos editáveis por tipo, usados na janela de criação e no painel de propriedades.
export const ARRAY_FIELDS = {
    r: [
        { key: 'rows', label: 'Linhas', kind: 'int' },
        { key: 'cols', label: 'Colunas', kind: 'int' },
        { key: 'rowSpacing', label: 'Dist. entre linhas', kind: 'number' },
        { key: 'colSpacing', label: 'Dist. entre colunas', kind: 'number' },
    ],
    p: [
        { key: 'count', label: 'Itens', kind: 'int' },
        { key: 'fill', label: 'Ângulo a preencher', kind: 'number' },
        { key: 'centerX', label: 'Centro X', kind: 'number' },
        { key: 'centerY', label: 'Centro Y', kind: 'number' },
        { key: 'rotate', label: 'Rotacionar os itens', kind: 'bool' },
    ],
    l: [
        { key: 'count', label: 'Itens', kind: 'int' },
        { key: 'distance', label: 'Distância entre itens', kind: 'number' },
        { key: 'angle', label: 'Ângulo', kind: 'number' },
    ],
};

export const ARRAY_DIRECTIONS = [
    { value: 'ccw', label: 'Sentido anti-horário' },
    { value: 'cw', label: 'Sentido horário' },
];

// O painel mostra a matriz pronta: raio, diâmetro e ângulo entre itens só existem depois de criada.
export const ARRAY_PROPERTY_FIELDS = {
    ...ARRAY_FIELDS,
    p: [
        { key: 'direction', label: 'Direção', kind: 'select', options: ARRAY_DIRECTIONS },
        { key: 'radius', label: 'Raio', kind: 'number' },
        { key: 'diameter', label: 'Diâmetro', kind: 'number' },
        ...ARRAY_FIELDS.p.filter((field) => field.key === 'count'),
        { key: 'angleBetween', label: 'Ângulo entre itens', kind: 'number' },
        ...ARRAY_FIELDS.p.filter((field) => field.key !== 'count'),
    ],
};

export function arrayItemCount(params) {
    if (params.mode === 'r') return params.rows * params.cols;
    return params.count;
}

export function arrayEntityCount(params, sourceCount) {
    return arrayItemCount(params) * sourceCount;
}

/** Devolve a mensagem de erro dos parâmetros, ou null quando a matriz pode ser gerada. */
export function arrayParamsError(params, sourceCount = 1) {
    const isCount = (n, min) => Number.isInteger(n) && n >= min;
    if (params.mode === 'r') {
        if (!isCount(params.rows, 1) || !isCount(params.cols, 1)) return 'Linhas e colunas devem ser números inteiros ≥ 1.';
        if (params.rows * params.cols < 2) return 'A matriz precisa de mais de um item.';
        if (!Number.isFinite(params.rowSpacing) || !Number.isFinite(params.colSpacing)) return 'Informe as distâncias entre linhas e colunas.';
        if ((params.rows > 1 && params.rowSpacing === 0) || (params.cols > 1 && params.colSpacing === 0)) return 'Distância zero sobrepõe os itens.';
    } else if (params.mode === 'p') {
        if (!isCount(params.count, 2)) return 'Informe ao menos 2 itens, em número inteiro.';
        if (!Number.isFinite(params.fill) || params.fill === 0 || Math.abs(params.fill) > 360) return 'O ângulo a preencher deve estar entre -360° e 360°, diferente de zero.';
        if (!Number.isFinite(params.center?.x) || !Number.isFinite(params.center?.y)) return 'Indique o centro da matriz.';
    } else if (params.mode === 'l') {
        if (!isCount(params.count, 2)) return 'Informe ao menos 2 itens, em número inteiro.';
        if (!Number.isFinite(params.distance) || params.distance === 0) return 'A distância entre itens deve ser diferente de zero.';
        if (!Number.isFinite(params.angle)) return 'Informe o ângulo.';
    } else {
        return 'Tipo de matriz desconhecido.';
    }
    if (arrayEntityCount(params, sourceCount) > MAX_ARRAY_ENTITIES) return `A matriz passaria de ${MAX_ARRAY_ENTITIES} entidades.`;
    return null;
}

// Passo em graus, com o sinal do sentido: 360° fecha o círculo, os demais ângulos incluem as duas pontas.
function polarStep(params) {
    const full = Math.abs(Math.abs(params.fill) - 360) < 1e-9;
    return params.fill / (full ? params.count : params.count - 1);
}

function sourcesBox(sources) {
    const box = emptyBox();
    sources.forEach((entity) => {
        const b = entityBox(entity);
        if (boxIsEmpty(b)) return;
        boxAddPoint(box, { x: b.minX, y: b.minY });
        boxAddPoint(box, { x: b.maxX, y: b.maxY });
    });
    return box;
}

function sourcesCenter(sources) {
    const box = sourcesBox(sources);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** Cópias da matriz, sem as origens. A primeira posição é a própria origem e não é gerada. */
export function arrayCopies(sources, params) {
    const clone = (entity) => ({ ...entity, id: undefined });
    const out = [];
    if (params.mode === 'r') {
        for (let r = 0; r < params.rows; r += 1) {
            for (let c = 0; c < params.cols; c += 1) {
                if (r === 0 && c === 0) continue;
                const delta = { x: c * params.colSpacing, y: r * params.rowSpacing };
                sources.forEach((e) => out.push(clone(translateEntity(e, delta))));
            }
        }
    } else if (params.mode === 'p') {
        const step = degToRad(polarStep(params));
        // Sem rotação o conjunto anda inteiro: um ponto de referência comum mantém a forma dele.
        const base = sourcesCenter(sources);
        for (let i = 1; i < params.count; i += 1) {
            const angle = step * i;
            const delta = sub(rotatePoint(base, params.center, angle), base);
            sources.forEach((e) => out.push(clone(params.rotate ? rotateEntity(e, params.center, angle) : translateEntity(e, delta))));
        }
    } else {
        const delta = polar({ x: 0, y: 0 }, degToRad(params.angle), params.distance);
        for (let i = 1; i < params.count; i += 1) sources.forEach((e) => out.push(clone(translateEntity(e, scale(delta, i)))));
    }
    return out;
}

// Só o que vale para o tipo: o XDATA tem limite de 255 caracteres por string.
function compactParams(params, sourceCount) {
    const out = { mode: params.mode, sourceCount };
    MODE_KEYS[params.mode].forEach((key) => { out[key] = params[key]; });
    return out;
}

function newArrayName() {
    return `MATRIZ_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function buildDefinition(sources, params, basePoint) {
    const clean = sources.map((e) => ({ ...e, id: undefined }));
    return { basePoint: { ...basePoint }, entities: [...clean, ...arrayCopies(clean, params)] };
}

/** Matriz associativa no lugar das origens, sem deslocar nada no desenho. */
export function createArrayInsert(sources, params) {
    const error = arrayParamsError(params, sources.length);
    if (error) throw new Error(error);
    const box = sourcesBox(sources);
    const basePoint = { x: box.minX, y: box.minY };
    const layers = new Set(sources.map((e) => e.layer));
    return {
        type: 'insert',
        name: newArrayName(),
        definition: buildDefinition(sources, params, basePoint),
        position: { ...basePoint },
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        // Layer '0' faz os filhos manterem cada um o seu layer quando as origens variam.
        layer: layers.size === 1 ? sources[0].layer : '0',
        color: 'bylayer',
        array: compactParams(params, sources.length),
    };
}

export const isArrayInsert = (entity) => entity?.type === 'insert' && Boolean(entity.array);

function insertFrame(insert) {
    const k = Math.abs(insert.scaleX ?? 1);
    const ky = Math.abs(insert.scaleY ?? 1);
    const flip = (insert.scaleX ?? 1) * (insert.scaleY ?? 1) < 0 ? -1 : 1;
    const base = insert.definition.basePoint;
    const rotation = insert.rotation ?? 0;
    const sx = insert.scaleX ?? 1;
    const sy = insert.scaleY ?? 1;
    const toWorld = (p) => add(insert.position, rotatePoint({ x: (p.x - base.x) * sx, y: (p.y - base.y) * sy }, { x: 0, y: 0 }, degToRad(rotation)));
    const toLocal = (p) => {
        const q = rotatePoint(sub(p, insert.position), { x: 0, y: 0 }, -degToRad(rotation));
        return { x: q.x / sx + base.x, y: q.y / sy + base.y };
    };
    return { k, ky, flip, rotation, toWorld, toLocal };
}

/** Valores como o usuário os vê: em coordenadas do desenho, já com a escala e a rotação da matriz. */
export function arrayFieldValues(insert) {
    const params = insert.array;
    const { k, ky, flip, rotation, toWorld } = insertFrame(insert);
    if (params.mode === 'r') return { rows: params.rows, cols: params.cols, rowSpacing: params.rowSpacing * ky, colSpacing: params.colSpacing * k };
    if (params.mode === 'l') return { count: params.count, distance: params.distance * k, angle: rotation + flip * params.angle };
    const center = toWorld(params.center);
    const sources = insert.definition.entities.slice(0, params.sourceCount);
    const radius = distance(center, toWorld(sourcesCenter(sources)));
    const fill = params.fill * flip;
    return {
        direction: fill < 0 ? 'cw' : 'ccw',
        radius,
        diameter: radius * 2,
        count: params.count,
        angleBetween: Math.abs(polarStep(params)),
        fill,
        centerX: center.x,
        centerY: center.y,
        rotate: params.rotate,
    };
}

// O centro fica parado e a origem anda na reta que passa por ele; as cópias acompanham ao refazer.
function sourcesAtRadius(sources, params, toWorld, radius) {
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('O raio deve ser maior que zero.');
    const base = sourcesCenter(sources);
    const current = distance(toWorld(params.center), toWorld(base));
    if (current < 1e-9) throw new Error('A origem está sobre o centro: mude o centro antes de alterar o raio.');
    const delta = scale(sub(base, params.center), radius / current - 1);
    return sources.map((entity) => translateEntity(entity, delta));
}

function fillForStep(params, step) {
    if (!Number.isFinite(step) || step <= 0) throw new Error('O ângulo entre itens deve ser maior que zero.');
    const sign = params.fill < 0 ? -1 : 1;
    if (Math.abs(step * params.count - 360) < 1e-6) return 360 * sign;
    const fill = step * (params.count - 1);
    if (fill > 360) throw new Error('Com esse ângulo entre itens a matriz passaria de 360°.');
    return fill * sign;
}

/** Refaz a matriz com um valor alterado do painel. Lança erro quando o valor é inválido. */
export function updateArrayField(insert, key, value) {
    const params = { ...insert.array };
    const { k, ky, flip, rotation, toLocal, toWorld } = insertFrame(insert);
    let sources = insert.definition.entities.slice(0, params.sourceCount);
    if (key === 'radius' || key === 'diameter') sources = sourcesAtRadius(sources, params, toWorld, key === 'diameter' ? value / 2 : value);
    else if (key === 'angleBetween') params.fill = fillForStep(params, value);
    else if (key === 'direction') params.fill = Math.abs(params.fill) * flip * (value === 'cw' ? -1 : 1);
    else if (['rows', 'cols', 'count', 'rotate'].includes(key)) params[key] = value;
    else if (key === 'rowSpacing') params.rowSpacing = value / ky;
    else if (key === 'colSpacing' || key === 'distance') params[key] = value / k;
    else if (key === 'fill') params.fill = value * flip;
    else if (key === 'angle') params.angle = (value - rotation) * flip;
    else if (key === 'centerX' || key === 'centerY') {
        const world = toWorld(params.center);
        params.center = toLocal({ ...world, [key === 'centerX' ? 'x' : 'y']: value });
    } else throw new Error(`Campo de matriz desconhecido: ${key}.`);
    const sourceCount = params.sourceCount;
    const error = arrayParamsError(params, sourceCount);
    if (error) throw new Error(error);
    // Nome novo: cópias da mesma matriz dividem o bloco e não podem mudar junto.
    return {
        ...insert,
        name: newArrayName(),
        definition: buildDefinition(sources, params, insert.definition.basePoint),
        array: compactParams(params, sourceCount),
    };
}

export function arrayXdata(insert) {
    return JSON.stringify(insert.array);
}

/** Lê o XDATA ao importar. Sem conferir com a definição, editar depois apagaria geometria. */
export function arrayFromXdata(text, definitionSize) {
    let params;
    try {
        params = JSON.parse(text);
    } catch {
        return null;
    }
    if (!params || !Number.isInteger(params.sourceCount) || params.sourceCount < 1) return null;
    if (arrayParamsError(params, params.sourceCount)) return null;
    if (arrayEntityCount(params, params.sourceCount) !== definitionSize) return null;
    return params;
}

export function arrayDefaults(memory, sources) {
    const box = sourcesBox(sources);
    const spaced = (size) => (Number.isFinite(size) && size > 0 ? Math.ceil(size * 1.5) : 50);
    const width = spaced(box.maxX - box.minX);
    const height = spaced(box.maxY - box.minY);
    return {
        mode: memory.arrayMode ?? 'r',
        rows: memory.arrayRows ?? 2,
        cols: memory.arrayCols ?? 2,
        rowSpacing: memory.arrayRowSpacing ?? height,
        colSpacing: memory.arrayColSpacing ?? width,
        count: memory.arrayCount ?? 4,
        fill: memory.arrayFill ?? 360,
        rotate: memory.arrayRotate ?? true,
        center: null,
        distance: memory.arrayDistance ?? width,
        angle: memory.arrayAngle ?? 0,
        associative: memory.arrayAssociative ?? true,
    };
}

export function rememberArray(memory, params) {
    Object.assign(memory, {
        arrayMode: params.mode,
        arrayRows: params.rows,
        arrayCols: params.cols,
        arrayRowSpacing: params.rowSpacing,
        arrayColSpacing: params.colSpacing,
        arrayCount: params.count,
        arrayFill: params.fill,
        arrayRotate: params.rotate,
        arrayDistance: params.distance,
        arrayAngle: params.angle,
        arrayAssociative: params.associative,
    });
}

