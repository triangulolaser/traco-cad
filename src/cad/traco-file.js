// Arquivo nativo do Traço (.traco): JSON com chaves ordenadas e 2 espaços.
//
// Determinístico: o mesmo documento gera sempre o mesmo texto. Hoje serve para salvar desenho com
// imagem embutida (versão 2, `imagens`). O formato nasceu no módulo esquemático (ADR 0007), retirado
// em 19/11/2026 (ADR 0008): o cabeçalho e as listas vazias de símbolos, junções e ligações continuam
// sendo gravados para o arquivo abrir também nas versões desktop que ainda têm o esquemático.

import { packNativeImages, unpackNativeImages } from './native-images.js';
import { createDocument, ensureEntityIds } from './document.js';

export const TRACO_FORMAT = 'traco-esquema';
export const TRACO_VERSION = 1;
const MODE_CAD = 'cad';
// Tipos que só existiam no esquemático; não há mais como desenhá-los nem editá-los.
const SCHEMATIC_TYPES = new Set(['symbol', 'link', 'junction']);

export const SCHEMATIC_REMOVED_MESSAGE = 'Este arquivo .traco é um esquema (símbolos e ligações). O módulo esquemático foi retirado do Traço; use um software de esquemas.';

// Campos internos (cache) nunca vão para o arquivo.
function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) {
            if (k.startsWith('_') || value[k] === undefined) continue;
            out[k] = clean(value[k]);
        }
        return out;
    }
    if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
    return value;
}

export function documentToTraco(doc) {
    const anotacoes = [];
    for (const e of doc.entities) {
        if (SCHEMATIC_TYPES.has(e.type)) continue;
        const { ends, sheet, ...rest } = e;
        anotacoes.push(rest);
    }
    const out = {
        formato: TRACO_FORMAT,
        versao: TRACO_VERSION,
        modo: MODE_CAD,
        unidade: doc.units ?? 'mm',
        bibliotecas: [],
        camadas: doc.layers ?? [],
        camada_atual: doc.currentLayer ?? '0',
        blocos: doc.blocks ?? {},
        vista: doc.view ?? null,
        estilo_cota: doc.dimStyle ?? null,
        simbolos: [],
        juncoes: [],
        ligacoes: [],
        anotacoes,
    };
    const packed = packNativeImages(clean(out));
    const payload = Object.keys(packed.images).length
        ? { ...packed.value, versao: 2, imagens: packed.images } : packed.value;
    return `${JSON.stringify(payload, null, 2)}\n`;
}

export function isSchematicTraco(data) {
    return Boolean((data?.simbolos ?? []).length || (data?.ligacoes ?? []).length || (data?.juncoes ?? []).length
        || (data?.anotacoes ?? []).some((a) => SCHEMATIC_TYPES.has(a?.type)));
}

// Abre o .traco. Devolve { doc, warnings }. Esquema salvo pelo módulo retirado é recusado com
// mensagem clara, em vez de abrir sem símbolos e perder as ligações ao salvar de novo.
export function tracoToDocument(text, { name = 'desenho.traco' } = {}) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`Arquivo .traco ilegível: ${error.message}`);
    }
    if (data?.formato !== TRACO_FORMAT) throw new Error('Não é um arquivo do Traço.');
    if (![TRACO_VERSION, 2].includes(data.versao)) throw new Error(`Versão ${data.versao} do .traco não suportada.`);
    if (data.versao === 2) {
        const { imagens, ...rest } = data;
        data = unpackNativeImages(rest, imagens);
    }
    if (isSchematicTraco(data)) throw new Error(SCHEMATIC_REMOVED_MESSAGE);
    const warnings = [];
    if (data.modo !== MODE_CAD) warnings.push('Arquivo criado no modo Esquemático, que foi retirado; aberto como desenho CAD.');
    const base = createDocument();
    const entities = (data.anotacoes ?? []).map((a) => {
        const copy = structuredClone(a);
        delete copy.sheet;
        return copy;
    });
    let doc = {
        ...base,
        name,
        sourceFormat: 'traco',
        units: data.unidade ?? 'mm',
        layers: Array.isArray(data.camadas) && data.camadas.length ? data.camadas : base.layers,
        currentLayer: data.camada_atual ?? base.currentLayer,
        blocks: data.blocos ?? {},
        ...(data.vista ? { view: data.vista } : {}),
        dimStyle: data.estilo_cota ?? base.dimStyle,
        entities,
    };
    doc = ensureEntityIds(doc);
    return { doc, warnings };
}
