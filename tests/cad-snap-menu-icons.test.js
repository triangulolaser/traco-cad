import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SNAP_MODES, SNAP_ICONS, snapIconSvg, defaultSnapSettings } from '../src/cad/snaps.js';
import { setupSnapMenu } from '../src/cad.js';

function createMockElement(tagName = 'DIV') {
    const children = [];
    const attributes = {};
    const classes = new Set();
    const listeners = new Map();
    let textContent = '';
    let innerHTML = '';

    const el = {
        tagName: tagName.toUpperCase(),
        dataset: {},
        parentNode: null,
        title: '',
        type: '',
        checked: false,
        hidden: false,
        get children() {
            return children;
        },
        get className() {
            return Array.from(classes).join(' ');
        },
        set className(c) {
            classes.clear();
            if (c) c.split(/\s+/).forEach((cls) => cls && classes.add(cls));
        },
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
        },
        setAttribute: (k, v) => { attributes[k] = String(v); },
        getAttribute: (k) => attributes[k] ?? null,
        hasAttribute: (k) => k in attributes,
        removeAttribute: (k) => { delete attributes[k]; },
        get textContent() {
            if (children.length > 0) {
                return children.map((c) => c.textContent).join('');
            }
            return textContent;
        },
        set textContent(v) {
            textContent = String(v);
            children.length = 0;
        },
        get innerHTML() {
            return innerHTML;
        },
        set innerHTML(v) {
            innerHTML = String(v);
            if (v === '') children.length = 0;
        },
        appendChild(child) {
            child.parentNode = el;
            children.push(child);
            return child;
        },
        addEventListener(event, handler) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        dispatchEvent(event) {
            const handlers = listeners.get(event.type) || [];
            handlers.forEach((h) => h(event));
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const results = [];
            function matchesSelector(child, sel) {
                if (sel.startsWith('.')) {
                    return child.classList?.contains(sel.slice(1));
                }
                if (sel.startsWith('[')) {
                    const clean = sel.slice(1, -1);
                    if (clean.includes('=')) {
                        const [attr, val] = clean.split('=');
                        const expectedVal = val.replace(/["']/g, '');
                        if (attr === 'type') return child.type === expectedVal;
                        return child.dataset?.[attr.replace('data-', '')] === expectedVal ||
                            child.getAttribute?.(attr) === expectedVal;
                    }
                    return child.hasAttribute?.(clean) || (clean.startsWith('data-') && clean.replace('data-', '') in child.dataset);
                }
                if (sel.includes('[')) {
                    const tag = sel.split('[')[0];
                    const attrPart = '[' + sel.split('[')[1];
                    return (child.tagName === tag.toUpperCase()) && matchesSelector(child, attrPart);
                }
                return child.tagName === sel.toUpperCase();
            }

            function search(node) {
                for (const child of node.children) {
                    if (matchesSelector(child, selector)) results.push(child);
                    search(child);
                }
            }
            search(this);
            return results;
        },
    };

    return el;
}

test('snaps.js define ícones vetoriais SVG para todos os 9 modos de snap', () => {
    const expectedKeys = ['end', 'mid', 'cen', 'gcen', 'int', 'qua', 'per', 'tan', 'nea'];

    assert.equal(SNAP_MODES.length, 9, 'Devem existir 9 modos de snap em SNAP_MODES');

    expectedKeys.forEach((key) => {
        assert.ok(SNAP_ICONS[key], `SNAP_ICONS deve conter ícone para '${key}'`);
        assert.match(SNAP_ICONS[key], /^<svg viewBox="0 0 16 16"/, `Ícone de '${key}' deve ser SVG 16x16`);
        assert.match(SNAP_ICONS[key], /stroke="currentColor"/, `Ícone de '${key}' deve usar stroke="currentColor"`);

        const mode = SNAP_MODES.find((m) => m.key === key);
        assert.ok(mode, `SNAP_MODES deve conter '${key}'`);
        assert.ok(mode.svg, `Modo '${key}' deve ter propriedade .svg`);
        assert.equal(mode.svg, SNAP_ICONS[key]);
    });

    // Teste de fallback
    const fallbackSvg = snapIconSvg('desconhecido');
    assert.match(fallbackSvg, /^<svg/);
});

test('setupSnapMenu monta itens com checkbox, ícone vetorial e rótulo sem os códigos de 3 letras', () => {
    const originalDocument = globalThis.document;
    globalThis.document = {
        createElement: (tag) => createMockElement(tag),
        createTextNode: (txt) => {
            const el = createMockElement('span');
            el.textContent = txt;
            return el;
        },
        addEventListener: () => {},
    };

    try {
        const root = createMockElement('DIV');
        const menuEl = createMockElement('DIV');
        menuEl.dataset.cadSnapMenu = '';
        menuEl.setAttribute('data-cad-snap-menu', '');
        root.appendChild(menuEl);

        const snapChanged = [];
        const mockEditor = {
            settings: { snaps: defaultSnapSettings() },
            snapModes: () => SNAP_MODES,
            setSnapMode: (key, val) => {
                snapChanged.push({ key, val });
                mockEditor.settings.snaps[key] = val;
            },
        };

        setupSnapMenu(mockEditor, root);

        const options = menuEl.querySelectorAll('.cad-snap-option');
        assert.equal(options.length, 9, 'Menu deve renderizar 9 opções de snap');

        SNAP_MODES.forEach((mode, index) => {
            const option = options[index];
            assert.ok(option, `Opção para ${mode.key} deve existir`);
            assert.equal(option.dataset.cadSnap, mode.key);
            assert.equal(option.title, `${mode.short} · ${mode.label}`);

            const checkbox = option.querySelector('input[type="checkbox"]');
            assert.ok(checkbox, 'Deve conter checkbox');
            assert.equal(checkbox.checked, true, 'Snap deve iniciar ativo pelo defaultSnapSettings');

            const icon = option.querySelector('.cad-snap-icon');
            assert.ok(icon, 'Deve conter elemento .cad-snap-icon');
            assert.ok(icon.innerHTML.includes('<svg'), 'Ícone deve conter markup SVG');
            assert.equal(icon.getAttribute('aria-hidden'), 'true');

            const label = option.querySelector('.cad-snap-label');
            assert.ok(label, 'Deve conter elemento .cad-snap-label');
            assert.equal(label.textContent, mode.label, 'Rótulo deve exibir apenas o nome do snap sem as 3 letras');
            assert.ok(!label.textContent.includes(mode.short), 'Rótulo não deve incluir as 3 letras (ex: END, MID)');

            // Simula clique/change no checkbox
            checkbox.checked = false;
            checkbox.dispatchEvent({ type: 'change' });
            assert.equal(snapChanged[snapChanged.length - 1].key, mode.key);
            assert.equal(snapChanged[snapChanged.length - 1].val, false);
        });
    } finally {
        globalThis.document = originalDocument;
    }
});

test('cad.css define estilos para .cad-snap-icon, .cad-snap-label e a cor temática --cad-snap-color', () => {
    const cssPath = resolve(process.cwd(), 'src/styles/cad.css');
    const css = readFileSync(cssPath, 'utf-8');

    assert.ok(css.includes('--cad-snap-color: #ffd24d;'), 'Deve definir --cad-snap-color no tema escuro');
    assert.ok(css.includes('--cad-snap-color: #d97706;'), 'Deve definir --cad-snap-color no tema claro');
    assert.ok(css.includes('.cad-snap-icon'), 'Deve conter estilos para .cad-snap-icon');
    assert.ok(css.includes('.cad-snap-label'), 'Deve conter estilos para .cad-snap-label');
    assert.ok(css.includes('color: var(--cad-snap-color'), 'Ícones devem usar a variável --cad-snap-color');
});

test('renderer.js inclui marcadores explícitos para nea (ampulheta) e nod (círculo com cruz)', () => {
    const rendererPath = resolve(process.cwd(), 'src/cad/renderer.js');
    const content = readFileSync(rendererPath, 'utf-8');

    assert.match(content, /case 'nea':/, 'Deve ter case explícito para snap "nea"');
    assert.match(content, /case 'nod':/, 'Deve ter case explícito para snap "nod"');
});
