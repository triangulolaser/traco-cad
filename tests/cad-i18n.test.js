import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { detectLocale, setLocale, tr, t, translateDom } from '../src/cad/i18n.js';
import { formatOptions, matchKeyword } from '../src/cad/input.js';
import en from '../src/cad/locales/en.js';
import es from '../src/cad/locales/es.js';

const YES_NO = [{ key: 's', label: 'Sim' }, { key: 'n', label: 'Não' }];

test('detectLocale: salvo > data-cad-locale > sistema; Node fica em português', () => {
    const storage = (v) => ({ getItem: () => v });
    const nav = (language) => ({ language, languages: [language], userAgent: 'Mozilla/5.0' });
    assert.equal(detectLocale({ storage: storage('es'), root: { dataset: { cadLocale: 'pt-BR' } }, navigatorLike: nav('en-US') }), 'es');
    assert.equal(detectLocale({ storage: storage(null), root: { dataset: { cadLocale: 'pt-BR' } }, navigatorLike: nav('en-US') }), 'pt-BR');
    assert.equal(detectLocale({ storage: storage(null), navigatorLike: nav('es-AR') }), 'es');
    assert.equal(detectLocale({ storage: storage(null), navigatorLike: nav('pt-PT') }), 'pt-BR');
    assert.equal(detectLocale({ storage: storage(null), navigatorLike: nav('de-DE') }), 'en');
    assert.equal(detectLocale({ storage: storage(null), navigatorLike: { language: 'en-US', userAgent: 'Node.js/24' } }), 'pt-BR');
});

test('tr: texto exato, mensagem com valores e português intacto', () => {
    try {
        setLocale('pt-BR');
        assert.equal(tr('Cancelar'), 'Cancelar');
        setLocale('en');
        assert.equal(tr('Cancelar'), 'Cancel');
        assert.equal(tr('  Cancelar \n'), '  Cancel \n', 'preserva espaços em volta');
        assert.equal(tr('Aberto peça.dxf: 16 entidades, 5 layers.'), 'Opened peça.dxf: 16 entities, 5 layers.');
        assert.equal(tr('nome-de-camada-qualquer'), 'nome-de-camada-qualquer');
        setLocale('es');
        assert.equal(tr('Especifique o raio do círculo:'), 'Especifique el radio del círculo:');
        assert.equal(t('Cota {0}: {1}', null), 'Cota {0}: {1}');
    } finally {
        setLocale('pt-BR');
    }
});

test('opções de comando: rótulo traduzido, tecla própria e o original continua aceito', () => {
    try {
        setLocale('pt-BR');
        assert.equal(formatOptions(YES_NO), ' [Sim/Não]');
        setLocale('en');
        assert.equal(formatOptions(YES_NO), ' [Yes/No]');
        assert.equal(matchKeyword('y', YES_NO)?.key, 's');
        assert.equal(matchKeyword('yes', YES_NO)?.key, 's');
        assert.equal(matchKeyword('no', YES_NO)?.key, 'n');
        assert.equal(matchKeyword('s', YES_NO)?.key, 's', 'tecla original segue valendo');
        setLocale('es');
        assert.equal(formatOptions(YES_NO), ' [Sí/No]');
        assert.equal(matchKeyword('sí', YES_NO)?.key, 's');
    } finally {
        setLocale('pt-BR');
    }
});

// DOM mínimo: o suficiente para translateDom (texto, atributos e trechos ignorados).
function el(attrs = {}, children = [], { skip = false } = {}) {
    const node = {
        nodeType: 1, attrs: { ...attrs }, childNodes: [], parentElement: null,
        getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
        setAttribute(name, value) { this.attrs[name] = value; },
        closest() { let n = this; while (n) { if (n.skip) return n; n = n.parentElement; } return null; },
        skip,
    };
    children.forEach((c) => { c.parentElement = node; node.childNodes.push(c); });
    return node;
}
const text = (value) => ({ nodeType: 3, nodeValue: value, parentElement: null });

test('translateDom: textos e atributos da interface; conteúdo do usuário fica', () => {
    const label = text('Camadas');
    const user = text('Camadas');
    const button = el({ title: 'Desfazer (Cmd+Z / Ctrl+Z)' }, [label]);
    const userArea = el({}, [user], { skip: true });
    const root = el({}, [button, userArea]);
    try {
        setLocale('es');
        translateDom(root, { observe: false });
        assert.equal(label.nodeValue, 'Capas');
        assert.equal(button.attrs.title, 'Deshacer (Cmd+Z / Ctrl+Z)');
        assert.equal(user.nodeValue, 'Camadas', 'trecho marcado com data-i18n-skip não muda');
    } finally {
        setLocale('pt-BR');
    }
});

// Cobertura: todo texto da interface tem inglês e espanhol. Mesma regra usada para
// montar os dicionários; texto novo sem tradução quebra este teste.
const ACCENT = /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/;
const PT_WORDS = new Set(('de do da dos das para com sem não nao uma um ao à às por pelo pela em no na nos nas que o a os as e ou se seu sua já ja mais menos '
    + 'selecione clique escolha informe digite ponto pontos arquivo arquivos camada camadas cota cotas linha linhas aba abas desenho desenhos entidade entidades '
    + 'objeto objetos comando comandos inicial final centro raio ângulo angulo comprimento altura largura distância distancia salvar abrir fechar cancelar novo nova '
    + 'importar exportar copiar colar mover girar espelhar escalar aparar estender editar desfazer refazer bloco blocos texto textos cor tipo espessura nenhum '
    + 'nenhuma erro falha página pagina folha').split(' '));

function looksPortuguese(s) {
    if (s.length < 2 || !/[A-Za-zÀ-ú]/.test(s)) return false;
    if (/^[\w.-]+\.(js|css|dxf|dwg|svg|png)$|^[#.[]|^\w+:\w+|^https?:|^data-|^bi |^cad-|^[a-z]+(-[a-z0-9]+)+$|^[a-z]+[A-Z]\w*$|^[A-Z_0-9]+$|^[a-z_]+$/.test(s)) return false;
    if (s.includes('{') && s.includes('}') && /[;:]\s*\w+\s*[;}]/.test(s) && !/\{\d+\}/.test(s)) return false;
    // Fragmentos de código de template string aninhada e caminhos SVG não são texto.
    if (/\$\{|\?\?|=>|^: ''|^[AMe]\{\d|\{\d+\}[a-z]\{\d/.test(s)) return false;
    if (ACCENT.test(s)) return true;
    return (s.toLowerCase().match(/[a-zà-ú]+/g) || []).some((w) => PT_WORDS.has(w));
}

function fragments(s) {
    const out = [];
    const pieces = /<[^>]+>/.test(s)
        ? [...[...s.matchAll(/(?:title|placeholder|aria-label|alt|data-tooltip|data-label)="([^"]*)"/g)].map((m) => m[1]), ...s.split(/<[^>]+>/)]
        : [s];
    for (const p of pieces) {
        const v = p.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
        if (looksPortuguese(v)) out.push(v);
    }
    return out;
}

function templateToKey(body) {
    let i = 0;
    let out = '';
    let depth = 0;
    for (let k = 0; k < body.length; k++) {
        if (depth === 0 && body[k] === '$' && body[k + 1] === '{') { out += `{${i++}}`; depth = 1; k++; continue; }
        if (depth > 0) { if (body[k] === '{') depth++; else if (body[k] === '}') depth--; continue; }
        out += body[k];
    }
    return out;
}

function collectKeys() {
    const keys = new Set();
    const cadDir = new URL('../src/cad/', import.meta.url);
    const files = [new URL('../src/cad.js', import.meta.url)];
    for (const name of readdirSync(cadDir)) if (name.endsWith('.js') && name !== 'i18n.js') files.push(new URL(name, cadDir));
    for (const file of files) {
        const src = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
            const raw = m[1] ?? m[2] ?? templateToKey(m[3]);
            raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').split('\n').forEach((line) => fragments(line).forEach((k) => keys.add(k)));
        }
    }
    const html = new URL('../index.html', import.meta.url);
    if (existsSync(html)) {
        const src = readFileSync(html, 'utf8');
        const all = [...src.matchAll(/>([^<>]+)</g)].map((m) => m[1]).concat([...src.matchAll(/(?:title|placeholder|aria-label|alt|data-tooltip|data-label)="([^"]*)"/g)].map((m) => m[1]));
        for (const s of all) {
            const v = s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
            if (v.length >= 2 && /[A-Za-zÀ-ú]{2}/.test(v) && !/^[A-Z0-9 /+.-]{1,12}$/.test(v)) keys.add(v);
        }
    }
    return keys;
}

test('todo texto da interface tem tradução em inglês e espanhol', () => {
    const keys = collectKeys();
    assert.ok(keys.size > 900, `poucas chaves encontradas (${keys.size}); a extração quebrou?`);
    const missingEn = [...keys].filter((k) => !(k in en));
    const missingEs = [...keys].filter((k) => !(k in es));
    assert.deepEqual(missingEn, [], `sem inglês: ${missingEn.slice(0, 20).join(' | ')}`);
    assert.deepEqual(missingEs, [], `sem espanhol: ${missingEs.slice(0, 20).join(' | ')}`);
});
