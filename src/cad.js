import { bootUsage, usage } from './usage-telemetry.js';
import {FONT_FAMILIES,loadCadFonts} from './cad/fonts.js';
import {geometryFields,setGeometryField} from './cad/edit-tools.js';
import {isEntityEditable,replaceEntities} from './cad/document.js';
// Entrada do app Traço CAD.
import { Editor } from './cad/editor.js';
import { LINETYPES, LINEWEIGHTS, aciToHex, hexToAci, createDocument, History, updateEntities, ensureEntityIds } from './cad/document.js';
import { entityLength, distance, radToDeg, angleOf, setLineLength } from './cad/geometry.js';

// Ponta que fica parada ao editar o comprimento de várias linhas; vale até recarregar.
let lineLengthAnchor = 'start';
const LINE_ANCHORS = [['start', 'Início'], ['middle', 'Meio'], ['end', 'Fim']];
import { dimensionGeometry, measurementFactor } from './cad/dimensions.js';
import { OPENABLE_EXTENSIONS, iconOf, kindOf, extensionOf } from './cad/file-types.js';
import { saveWorkspace, loadWorkspace, serializeDocument, debounce, popPendingImport } from './cad/storage.js';
import { StartScreen, recordRecent, readRecentFile, forgetRecent, showOnStart } from './cad/start-screen.js';
import { showCadErrorModal, hideCadErrorModal } from './cad/error-modal.js';
import { snapIconSvg } from './cad/snaps.js';
import { LOCALES, detectLocale, getLocale, saveLocale, setLocale, t, tr, translateDom } from './cad/i18n.js';

const STANDARD_ACI = [[1, 'Vermelho'], [2, 'Amarelo'], [3, 'Verde'], [4, 'Ciano'], [5, 'Azul'], [6, 'Magenta'], [7, 'Branco']];


function setupToolbar(editor, root) {
    root.querySelectorAll('[data-cad-command]').forEach((button) => {
        button.addEventListener('click', () => {
            if (!editor.tabs?.tabs?.length) {
                editor.tabs?.add();
            }
            const name = button.dataset.cadCommand;
            const args = (button.dataset.cadArgs ?? '').split(/\s+/).filter(Boolean);
            editor.runCommand(name, args);
        });
    });
    root.querySelectorAll('[data-cad-toggle]').forEach((button) => {
        button.addEventListener('click', () => editor.toggle(button.dataset.cadToggle));
    });
    root.querySelectorAll('[data-cad-action]').forEach((button) => {
        button.addEventListener('click', () => {
            if (button.dataset.cadAction === 'layer-manager') editor.openLayerManager?.();
        });
    });
}

// ---------------------------------------------------------------------------
// Ribbon e painéis laterais

function setupRibbon(editor, root) {
    const tabs = root.querySelectorAll('[data-cad-ribbon-tab]');
    if (!tabs.length) return;
    const activate = (key) => {
        tabs.forEach((t) => {
            const on = t.dataset.cadRibbonTab === key;
            t.classList.toggle('is-active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        root.querySelectorAll('[data-cad-ribbon-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.cadRibbonPanel === key));
        try { localStorage.setItem('mvp-cad:ribbon', key); } catch (error) { /* ignora */ }
    };
    tabs.forEach((t) => t.addEventListener('click', () => activate(t.dataset.cadRibbonTab)));
    let saved = null;
    try { saved = localStorage.getItem('mvp-cad:ribbon'); } catch (error) { /* ignora */ }
    if (saved === 'desenho') saved = 'inicio';
    if (saved && root.querySelector(`[data-cad-ribbon-tab="${saved}"]`)) activate(saved);
}

function setupSplitButtons(editor, root) {
    const splits = root.querySelectorAll('[data-cad-split]');
    if (!splits.length) return;

    const closeAll = () => {
        splits.forEach((s) => {
            s.classList.remove('is-open');
            const menu = s.querySelector('.cad-ribbon-dropdown-menu');
            if (menu) menu.hidden = true;
            const toggle = s.querySelector('[data-cad-split-toggle]');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        });
    };

    const positionMenu = (split, menu) => {
        if (!split || !menu) return;
        const rect = split.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 236;
        let left = rect.left;
        if (typeof window !== 'undefined' && left + menuWidth > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - menuWidth - 8);
        }
        menu.style.position = 'fixed';
        menu.style.top = `${Math.round(rect.bottom + 2)}px`;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.zIndex = '100000';
    };

    splits.forEach((split) => {
        const toggle = split.querySelector('[data-cad-split-toggle]');
        const menu = split.querySelector('.cad-ribbon-dropdown-menu');
        const main = split.querySelector('.cad-ribbon-split-main');
        const iconSlot = main?.querySelector('[data-cad-split-icon]');
        const labelSlot = main?.querySelector('[data-cad-split-label]');

        if (toggle && menu) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasOpen = !menu.hidden;
                closeAll();
                if (!wasOpen) {
                    split.classList.add('is-open');
                    menu.hidden = false;
                    toggle.setAttribute('aria-expanded', 'true');
                    positionMenu(split, menu);
                }
            });
        }

        split.querySelectorAll('.cad-ribbon-dropdown-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAll();
                if (!editor.tabs?.tabs?.length) {
                    editor.tabs?.add();
                }
                const cmd = item.dataset.cadCommand;
                const args = (item.dataset.cadArgs ?? '').split(/\s+/).filter(Boolean);
                const label = item.dataset.cadLabel;
                const itemIcon = item.querySelector('.cad-dropdown-icon');

                if (main) {
                    main.dataset.cadCommand = cmd;
                    if (item.dataset.cadArgs) main.dataset.cadArgs = item.dataset.cadArgs;
                    else delete main.dataset.cadArgs;
                    if (label) main.title = label;
                    if (labelSlot && label) {
                        const shortName = cmd === 'CIRCLE' ? 'Círculo' : (cmd === 'ARC' ? 'Arco' : label);
                        labelSlot.textContent = shortName;
                    }
                    if (iconSlot && itemIcon) {
                        iconSlot.innerHTML = itemIcon.innerHTML;
                    }
                }

                editor.runCommand(cmd, args);
            });
        });
    });

    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('[data-cad-split]')) {
                closeAll();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAll();
            }
        });
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('resize', closeAll, { passive: true });
    }

    root.querySelectorAll('.cad-ribbon-panel').forEach((panel) => {
        panel.addEventListener('scroll', closeAll, { passive: true });
        // Roda vertical do mouse rola o ribbon para o lado quando ele não cabe na largura.
        panel.addEventListener('wheel', (event) => {
            if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            if (panel.scrollWidth <= panel.clientWidth) return;
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? panel.clientWidth : 1;
            panel.scrollLeft += event.deltaY * unit;
            event.preventDefault();
        }, { passive: false });
    });
}

function setupTheme(editor, root) {
    const mvpTheme = () => (document.documentElement.dataset.theme === 'dark' || document.body?.dataset.theme === 'dark' ? 'dark' : 'light');
    let preference = 'auto';
    try { preference = localStorage.getItem('mvp-cad:theme') || 'auto'; } catch (error) { /* ignora */ }
    const apply = () => {
        const theme = preference === 'auto' ? (root.dataset.cadThemeDefault || mvpTheme()) : preference;
        editor.setTheme(theme);
        root.querySelectorAll('[data-cad-theme-toggle]').forEach((button) => {
            button.title = theme === 'dark' ? 'Desativar dark mode' : 'Ativar dark mode';
            button.setAttribute('aria-label', button.title);
        });
        root.querySelectorAll('[data-cad-theme-toggle] .bi').forEach((icon) => { icon.className = `bi ${theme === 'dark' ? 'bi-moon' : 'bi-sun'}`; });
    };
    root.querySelectorAll('[data-cad-theme-toggle]').forEach((button) => button.addEventListener('click', () => {
        const current = editor.settings.theme;
        preference = current === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('mvp-cad:theme', preference); } catch (error) { /* ignora */ }
        apply();
    }));
    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => { if (preference === 'auto') apply(); });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    }
    apply();
}

// Idioma da interface: detectado no boot; o seletor ([data-cad-locale-select]) salva e
// recarrega, porque parte da interface é montada uma vez só.
function setupLocale(root) {
    const locale = setLocale(detectLocale({ root }));
    if (typeof document !== 'undefined') {
        document.documentElement.lang = locale;
        document.title = tr(document.title);
        translateDom(document.body || root);
    }
    root.querySelectorAll('[data-cad-locale-select]').forEach((select) => {
        select.replaceChildren(...Object.entries(LOCALES).map(([value, { label }]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.setAttribute('data-i18n-skip', '');
            return option;
        }));
        select.value = getLocale();
        select.addEventListener('change', () => {
            saveLocale(select.value);
            window.location.reload();
        });
    });
}

function setupChrome(editor, root) {
    // Ribbon recolhível (duplo clique na aba ou botão) e tela cheia.
    const ribbon = root.querySelector('[data-cad-ribbon]');
    let collapsed = false;
    try { collapsed = localStorage.getItem('mvp-cad:ribbon-collapsed') === '1'; } catch (error) { /* ignora */ }
    const applyCollapse = () => {
        ribbon?.classList.toggle('is-collapsed', collapsed);
        root.querySelectorAll('[data-cad-ribbon-collapse] .bi').forEach((icon) => { icon.className = `bi ${collapsed ? 'bi-chevron-down' : 'bi-chevron-up'}`; });
        try { localStorage.setItem('mvp-cad:ribbon-collapsed', collapsed ? '1' : '0'); } catch (error) { /* ignora */ }
        editor.resize();
    };
    root.querySelectorAll('[data-cad-ribbon-collapse]').forEach((b) => b.addEventListener('click', () => { collapsed = !collapsed; applyCollapse(); }));
    root.querySelectorAll('[data-cad-ribbon-tab]').forEach((t) => {
        t.addEventListener('dblclick', () => { collapsed = !collapsed; applyCollapse(); });
        t.addEventListener('click', () => { if (collapsed) { collapsed = false; applyCollapse(); } });
    });
    applyCollapse();

    root.querySelectorAll('[data-cad-fullscreen]').forEach((b) => b.addEventListener('click', async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await root.requestFullscreen();
        } catch (error) {
            editor.log('Tela cheia não disponível neste navegador.', 'warn');
        }
    }));
    document.addEventListener('fullscreenchange', () => {
        root.classList.toggle('is-fullscreen', document.fullscreenElement === root);
        root.querySelectorAll('[data-cad-fullscreen] .bi').forEach((icon) => { icon.className = `bi ${document.fullscreenElement === root ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}`; });
    });

    // Terminal com altura ajustável por arrasto.
    const handle = root.querySelector('[data-cad-terminal-resize]');
    const history = root.querySelector('[data-cad-terminal-history]');
    if (handle && history) {
        let saved = null;
        try { saved = Number(localStorage.getItem('mvp-cad:terminal-height')); } catch (error) { /* ignora */ }
        if (saved && saved >= 40) history.style.height = `${saved}px`;
        handle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            const startY = event.clientY;
            const startH = history.getBoundingClientRect().height;
            const move = (e) => {
                const h = Math.min(400, Math.max(40, startH - (e.clientY - startY)));
                history.style.height = `${h}px`;
                editor.resize();
            };
            const up = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                try { localStorage.setItem('mvp-cad:terminal-height', String(Math.round(history.getBoundingClientRect().height))); } catch (error) { /* ignora */ }
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
        });
    }
}

function setupPanels(editor, root) {
    const state = {};
    const apply = (name, open) => {
        const panel = root.querySelector(`[data-cad-panel="${name}"]`);
        if (!panel) return;
        panel.hidden = !open;
        state[name] = open;
        root.querySelectorAll(`[data-cad-toggle-panel="${name}"]`).forEach((b) => b.classList.toggle('is-on', open));
        try { localStorage.setItem(`mvp-cad:panel:${name}`, open ? '1' : '0'); } catch (error) { /* ignora */ }
        editor.resize();
    };
    root.querySelectorAll('[data-cad-panel]').forEach((panel) => {
        const name = panel.dataset.cadPanel;
        let saved = null;
        try { saved = localStorage.getItem(`mvp-cad:panel:${name}`); } catch (error) { /* ignora */ }
        // Padrão: painel de propriedades aberto em telas largas; navegador do laser sempre aberto quando existe.
        const defaultOpen = name === 'laser' || (name === 'properties' && window.innerWidth >= 1400);
        apply(name, saved === null ? defaultOpen : saved === '1');
    });
    root.querySelectorAll('[data-cad-toggle-panel]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.cadTogglePanel, !state[b.dataset.cadTogglePanel])));
    root.querySelectorAll('[data-cad-panel-close]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.cadPanelClose, false)));
}

// ---------------------------------------------------------------------------
// Painel de propriedades

const fmt = (n, d = 3) => {
    const s = Number(n).toFixed(d);
    return s.replace(/\.?0+$/, '') || '0';
};
const parseDecimalInput = (raw) => {
    if (raw === null || raw === undefined) return NaN;
    const str = String(raw).trim().replace(',', '.');
    if (!str) return NaN;
    return Number(str);
};
const fmtPoint = (p) => `${fmt(p.x)}, ${fmt(p.y)}`;

function entityRows(editor, e) {
    const rows = [];
    switch (e.type) {
        case 'line':
            rows.push(['Início', fmtPoint(e.start)], ['Fim', fmtPoint(e.end)], ['Comprimento', fmt(distance(e.start, e.end))], ['Ângulo', `${fmt(radToDeg(angleOf(e.start, e.end)), 2)}°`], ['ΔX / ΔY', `${fmt(e.end.x - e.start.x)} / ${fmt(e.end.y - e.start.y)}`]);
            break;
        case 'circle':
            rows.push(['Centro', fmtPoint(e.center)], ['Perímetro', fmt(2 * Math.PI * e.radius)], ['Área', fmt(Math.PI * e.radius * e.radius)]);
            break;
        case 'arc':
            rows.push(['Centro', fmtPoint(e.center)], ['Início', `${fmt(radToDeg(e.start), 2)}°`], ['Fim', `${fmt(radToDeg(e.end), 2)}°`], ['Comprimento', fmt(entityLength(e))]);
            break;
        case 'polyline':
            rows.push(['Vértices', String(e.vertices.length)], ['Fechada', e.closed ? 'Sim' : 'Não'], ['Comprimento', fmt(entityLength(e))]);
            break;
        case 'ellipse':
            rows.push(['Centro', fmtPoint(e.center)], ['Semieixo maior', fmt(Math.hypot(e.major.x, e.major.y))], ['Razão', fmt(e.ratio)], ['Perímetro ≈', fmt(entityLength(e))]);
            break;
        case 'spline':
            rows.push(['Grau', String(e.degree ?? 3)], ['Pontos de ajuste', String(e.fitPoints?.length ?? 0)], ['Pontos de controle', String(e.controlPoints?.length ?? 0)], ['Comprimento ≈', fmt(entityLength(e))]);
            break;
        case 'text':
            rows.push(['Texto', e.text], ['Posição', fmtPoint(e.position)], ['Altura', fmt(e.height)], ['Rotação', `${fmt(e.rotation ?? 0, 2)}°`]);
            break;
        case 'dimension': {
            const g = dimensionGeometry(e, editor.doc.dimStyle);
            rows.push(['Tipo', e.kind], ['Valor', g.text], ['Medida', fmt(g.measurement)], ['Altura do texto', fmt(e.textHeight ?? e.style?.textHeight ?? editor.doc.dimStyle?.textHeight ?? 2.5)]);
            break;
        }
        case 'image':
            rows.push(['Posição', fmtPoint(e.position)], ['Largura', fmt(e.width)], ['Altura', fmt(e.height)], ['Rotação', `${fmt(e.rotation ?? 0, 2)}°`]);
            break;
        default:
            break;
    }
    return rows;
}

const GEOMETRY_LABELS = { 'center.x': 'Centro X', 'center.y': 'Centro Y', 'start.x': 'Início X', 'start.y': 'Início Y', 'end.x': 'Fim X', 'end.y': 'Fim Y', 'position.x': 'Posição X', 'position.y': 'Posição Y', radius: 'Raio', diameter: 'Diâmetro', height: 'Altura', rotation: 'Rotação', ratio: 'Razão', length: 'Comprimento' };
const geometryLabel = (field) => GEOMETRY_LABELS[field.key] ?? (field.key === 'start' || field.key === 'end' ? `${field.key === 'start' ? 'Início' : 'Fim'} (°)` : field.key);

const TYPE_LABELS = { line: 'Linha', circle: 'Círculo', arc: 'Arco', polyline: 'Polilinha', ellipse: 'Elipse', spline: 'Spline', text: 'Texto', dimension: 'Cota', image: 'Imagem' };

function renderProperties(editor, root) {
    const box = root.querySelector('[data-cad-properties]');
    const title = root.querySelector('[data-cad-properties-title]');
    if (!box) return;
    if (!box._cadKeydownAttached) {
        box._cadKeydownAttached = true;
        box.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) {
                e.stopPropagation();
            }
        });
    }
    const selected = editor.entitiesById([...editor.selection]);
    const layerOptions = editor.doc.layers.map((l) => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join('');
    const section = (label) => `<div class="cad-prop-section">${escapeHtml(label)}</div>`;
    const row = (k, v) => `<div class="cad-prop-row"><span class="cad-prop-key">${escapeHtml(k)}</span><span class="cad-prop-value" title="${escapeHtml(String(v))}">${v}</span></div>`;
    if (selected.length === 0) {
        title.textContent = 'Sem seleção';
        const doc = editor.doc;
        box.innerHTML = section('Desenho')
            + row('Nome', escapeHtml(doc.name || 'Sem título.dxf'))
            + row('Unidades', doc.units === 'in' ? 'polegadas' : 'milímetros')
            + row('Entidades', String(doc.entities.length))
            + row('Layers', String(doc.layers.length))
            + row('Layer atual', escapeHtml(doc.currentLayer))
            + section('Cotas')
            + `<div class="cad-prop-row"><span class="cad-prop-key">Altura do texto</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-global-prop="dimTextHeight" value="${fmt(doc.dimStyle?.textHeight ?? 2.5)}" title="Altura padrão de texto para novas cotas"></span></div>`
            + `<div class="cad-prop-row"><span class="cad-prop-key">Tamanho da seta</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-global-prop="dimArrowSize" value="${fmt(doc.dimStyle?.arrowSize ?? 2.5)}" title="Tamanho padrão das setas das cotas"></span></div>`
            + `<div class="cad-prop-row"><span class="cad-prop-key">Escala geral</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-global-prop="dimOverallScale" value="${fmt(doc.dimStyle?.scale ?? 1)}" title="Multiplica texto e setas das novas cotas (DIMSCALE)"></span></div>`
            + row('Casas decimais', String(doc.dimStyle?.precision ?? 2))
            + section('Vista')
            + row('Escala', `${fmt(editor.viewport.scale, 3)} px/un`)
            + row('Orto / Polar', `${editor.settings.ortho ? 'ligado' : 'desligado'} / ${editor.settings.polar ? 'ligado' : 'desligado'}`);

        for (const [prop, field] of [['dimTextHeight', 'textHeight'], ['dimArrowSize', 'arrowSize'], ['dimOverallScale', 'scale']]) {
            const input = box.querySelector(`[data-global-prop="${prop}"]`);
            if (!input) continue;
            const apply = () => {
                const val = parseDecimalInput(input.value);
                if (Number.isFinite(val) && val > 0) {
                    editor.doc = { ...editor.doc, dimStyle: { ...(editor.doc.dimStyle ?? {}), [field]: val } };
                    editor.requestRender();
                } else {
                    renderProperties(editor, root);
                }
            };
            input.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                    event.preventDefault();
                    apply();
                    input.blur();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    renderProperties(editor, root);
                    input.blur();
                }
            });
            input.addEventListener('change', apply);
        }
        return;
    }

    const kinds = [...new Set(selected.map((e) => e.type))];
    title.textContent = selected.length === 1 ? (TYPE_LABELS[selected[0].type] ?? selected[0].type) : `${selected.length} objetos${kinds.length === 1 ? ` (${TYPE_LABELS[kinds[0]] ?? kinds[0]})` : ''}`;

    // 1. Layer
    const sameLayer = selected.every((e) => e.layer === selected[0].layer) ? selected[0].layer : '';

    // 2. Cor
    const normColor = (e) => (e.color === undefined || e.color === 'bylayer' ? 'bylayer' : e.color);
    const firstColor = normColor(selected[0]);
    const sameColor = selected.every((e) => String(normColor(e)) === String(firstColor)) ? firstColor : '';
    // Lista como a dos parâmetros da camada (BricsCAD): ByLayer, as 7 cores
    // ACI padrão, a cor atual quando fora delas e "Selecionar cor...".
    const colorKey = sameColor === '' ? '' : String(sameColor);
    const colorOptions = [['bylayer', 'ByLayer'], ...STANDARD_ACI.map(([n, name]) => [String(n), name])];
    if (colorKey && !colorOptions.some(([v]) => v === colorKey)) colorOptions.push([colorKey, colorKey.startsWith('#') ? colorKey.toUpperCase() : colorKey]);
    const colorSelectHtml = (colorKey === '' ? '<option value="">(varia)</option>' : '')
        + colorOptions.map(([v, label]) => `<option value="${escapeHtml(v)}" ${v === colorKey ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')
        + '<option value="__pick">Selecionar cor...</option>';
    const swatchHex = editor.colorOf(selected[0]);
    const pickerHex = swatchHex.startsWith('#') ? swatchHex : (aciToHex(sameColor) || '#ffffff');

    // 3. Tipo de linha
    const normLinetype = (e) => (!e.lineType || e.lineType === 'bylayer' ? 'bylayer' : String(e.lineType).toUpperCase());
    const firstLineType = normLinetype(selected[0]);
    const sameLineType = selected.every((e) => normLinetype(e) === firstLineType) ? firstLineType : '';

    // 4. Espessura
    const normWeight = (e) => (e.lineWeight === undefined || e.lineWeight === 'bylayer' ? 'bylayer' : Number(e.lineWeight));
    const firstWeight = normWeight(selected[0]);
    const sameWeight = selected.every((e) => normWeight(e) === firstWeight) ? firstWeight : '';

    // 5. Tamanho do texto (entidades do tipo text ou dimension)
    const textLike = selected.filter((e) => e.type === 'text' || e.type === 'dimension');
    const hasTextLike = textLike.length > 0;
    let sameTextHeight = '';
    if (hasTextLike) {
        const getTextHeight = (e) => (e.type === 'text' ? (e.height ?? 2.5) : (e.textHeight ?? e.style?.textHeight ?? editor.doc.dimStyle?.textHeight ?? 2.5));
        const firstH = getTextHeight(textLike[0]);
        sameTextHeight = textLike.every((e) => Math.abs(getTextHeight(e) - firstH) < 1e-4) ? firstH : '';
    }

    // 6. Precisão das cotas (casas decimais, como "Precisão dim" do BricsCAD)
    const dims = selected.filter((e) => e.type === 'dimension');
    const getPrecision = (e) => e.style?.precision ?? editor.doc.dimStyle?.precision ?? 2;
    const samePrecision = dims.length && dims.every((e) => getPrecision(e) === getPrecision(dims[0])) ? getPrecision(dims[0]) : '';

    let html = section('Geral')
        + `<div class="cad-prop-row"><span class="cad-prop-key">Layer</span><span class="cad-prop-value"><select data-prop="layer"><option value="">${sameLayer ? '' : '(varia)'}</option>${layerOptions}</select></span></div>`
        + `<div class="cad-prop-row"><span class="cad-prop-key">Cor</span><span class="cad-prop-value"><span class="cad-prop-swatch" style="background:${swatchHex}" title="Escolher cor"><input type="color" data-prop="color-picker" value="${pickerHex}" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;"></span><select data-prop="color">${colorSelectHtml}</select></span></div>`
        + `<div class="cad-prop-row"><span class="cad-prop-key">Tipo de linha</span><span class="cad-prop-value"><select data-prop="linetype">${sameLineType === '' ? '<option value="">(varia)</option>' : ''}<option value="bylayer" ${sameLineType === 'bylayer' ? 'selected' : ''}>ByLayer</option>${Object.keys(LINETYPES).map((lt) => `<option value="${lt}" ${sameLineType === lt ? 'selected' : ''}>${lt}</option>`).join('')}</select></span></div>`
        + `<div class="cad-prop-row"><span class="cad-prop-key">Espessura</span><span class="cad-prop-value"><select data-prop="lineweight">${sameWeight === '' ? '<option value="">(varia)</option>' : ''}<option value="bylayer" ${sameWeight === 'bylayer' ? 'selected' : ''}>ByLayer</option>${LINEWEIGHTS.map((w) => `<option value="${w}" ${sameWeight === w ? 'selected' : ''}>${w === 0 ? 'Padrão (0.00 mm)' : `${(w / 100).toFixed(2)} mm`}</option>`).join('')}</select></span></div>`;

    if (hasTextLike) {
        html += `<div class="cad-prop-row"><span class="cad-prop-key">Tam. texto</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-prop="text-height" value="${sameTextHeight !== '' ? fmt(sameTextHeight) : ''}" placeholder="${sameTextHeight !== '' ? '' : '(varia)'}" title="Altura do texto em milímetros"></span></div>`;
    }

    if (dims.length) {
        const arrowOf = (e) => e.style?.arrowSize ?? editor.doc.dimStyle?.arrowSize ?? 2.5;
        const sameArrow = dims.every((e) => Math.abs(arrowOf(e) - arrowOf(dims[0])) < 1e-4) ? arrowOf(dims[0]) : '';
        html += `<div class="cad-prop-row"><span class="cad-prop-key">Tam. seta</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-prop="dim-arrow" value="${sameArrow !== '' ? fmt(sameArrow) : ''}" placeholder="${sameArrow !== '' ? '' : '(varia)'}" title="Tamanho das setas em milímetros"></span></div>`;
        const overallOf = (e) => e.scale ?? e.style?.scale ?? editor.doc.dimStyle?.scale ?? 1;
        const sameOverall = dims.every((e) => Math.abs(overallOf(e) - overallOf(dims[0])) < 1e-6) ? overallOf(dims[0]) : '';
        html += `<div class="cad-prop-row"><span class="cad-prop-key">Escala geral</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-prop="dim-overall" value="${sameOverall !== '' ? fmt(sameOverall, 4) : ''}" placeholder="${sameOverall !== '' ? '' : '(varia)'}" title="DIMSCALE: multiplica texto e setas. Texto e seta na tela = valor × escala geral"></span></div>`;
        const options = Array.from({ length: 9 }, (_, n) => `<option value="${n}" ${samePrecision === n ? 'selected' : ''}>${n ? `0.${'0'.repeat(n)}` : '0'}</option>`).join('');
        html += `<div class="cad-prop-row"><span class="cad-prop-key">Precisão dim</span><span class="cad-prop-value"><select data-prop="dim-precision">${samePrecision === '' ? '<option value="">(varia)</option>' : ''}${options}</select></span></div>`;
    }

    if (dims.length) {
        const factorOf = (e) => measurementFactor({ ...editor.doc.dimStyle, ...(e.style ?? {}), ...(e.measurementScale !== undefined ? { measurementScale: e.measurementScale } : {}) });
        const firstF = factorOf(dims[0]);
        const sameF = dims.every((e) => Math.abs(factorOf(e) - firstF) < 1e-9) ? firstF : '';
        html += `<div class="cad-prop-row"><span class="cad-prop-key">Escala da cota</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-prop="dim-scale" value="${sameF !== '' ? fmt(sameF, 6) : ''}" placeholder="${sameF !== '' ? '' : '(varia)'}" title="Fator da medida (DIMLFAC): 5 numa vista 1:5 mostra o tamanho real"></span></div>`;
    }

    if (selected.length === 1) {
        html += section('Geometria');
        entityRows(editor, selected[0]).forEach(([k, v]) => { html += row(k, escapeHtml(String(v))); });
        const locked = !isEntityEditable(editor.doc, selected[0]);
        for (const field of geometryFields(selected[0])) html += `<div class="cad-prop-row"><label class="cad-prop-key">${escapeHtml(geometryLabel(field))}</label><span class="cad-prop-value"><input type="number" step="any" data-geometry="${escapeHtml(field.key)}" value="${field.value}" ${locked ? 'disabled' : ''}></span></div>`
            + (field.key === 'length' ? `<div class="cad-prop-row"><span class="cad-prop-key">Ponta fixa</span><span class="cad-prop-value"><select data-prop="line-anchor" title="Ponta que fica parada ao mudar o comprimento">${LINE_ANCHORS.map(([v, label]) => `<option value="${v}" ${v === lineLengthAnchor ? 'selected' : ''}>${label}</option>`).join('')}</select></span></div>` : '');
        if (['text', 'dimension'].includes(selected[0].type)) {
            const entity = selected[0];
            const style = entity.type === 'dimension' ? editor.doc.dimStyle : editor.doc.textStyle;
            html += `<div class="cad-prop-row"><label>Fonte</label><select data-font-family ${locked ? 'disabled' : ''}>${FONT_FAMILIES.map((f) => `<option ${f === (entity.fontFamily ?? style?.fontFamily ?? 'Liberation Sans') ? 'selected' : ''}>${f}</option>`).join('')}</select></div><label><input type="checkbox" data-font-bold ${locked ? 'disabled' : ''} ${(entity.bold ?? style?.bold) ? 'checked' : ''}>Negrito</label> <label><input type="checkbox" data-font-italic ${locked ? 'disabled' : ''} ${(entity.italic ?? style?.italic) ? 'checked' : ''}>Itálico</label>`;
        }
        if (selected[0].type === 'dimension') html += `<div class="cad-prop-row"><label>Texto da cota</label><input data-dim-text ${locked ? 'disabled' : ''} value="${escapeHtml(selected[0].textOverride ?? '<>')}" title="<> restaura medição automática"></div>`;
    } else {
        const total = selected.reduce((sum, e) => sum + (['line', 'arc', 'circle', 'polyline', 'ellipse', 'spline'].includes(e.type) ? entityLength(e) : 0), 0);
        if (kinds.length === 1 && kinds[0] === 'line') {
            const lengths = selected.map(entityLength);
            const same = lengths.every((l) => Math.abs(l - lengths[0]) < 1e-4);
            const locked = selected.some((e) => !isEntityEditable(editor.doc, e));
            html += section('Linhas')
                + `<div class="cad-prop-row"><span class="cad-prop-key">Comprimento</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-prop="line-length" value="${same ? fmt(lengths[0]) : ''}" placeholder="${same ? '' : 'Vários'}" title="Comprimento de cada linha selecionada" ${locked ? 'disabled' : ''}></span></div>`
                + `<div class="cad-prop-row"><span class="cad-prop-key">Ponta fixa</span><span class="cad-prop-value"><select data-prop="line-anchor" title="Ponta que fica parada ao mudar o comprimento">${LINE_ANCHORS.map(([v, label]) => `<option value="${v}" ${v === lineLengthAnchor ? 'selected' : ''}>${label}</option>`).join('')}</select></span></div>`;
        }
        if (kinds.length === 1 && kinds[0] === 'circle') {
            const radii = selected.map((e) => e.radius);
            const same = radii.every((r) => Math.abs(r - radii[0]) < 1e-4);
            const locked = selected.some((e) => !isEntityEditable(editor.doc, e));
            const field = (key, label, hint, value) => `<div class="cad-prop-row"><span class="cad-prop-key">${label}</span><span class="cad-prop-value"><input type="text" inputmode="decimal" data-prop="circle-${key}" value="${same ? fmt(value) : ''}" placeholder="${same ? '' : '*Varia*'}" title="${hint}" ${locked ? 'disabled' : ''}></span></div>`;
            html += section('Círculos') + field('radius', 'Raio', 'Raio de cada círculo selecionado', radii[0]) + field('diameter', 'Diâmetro', 'Diâmetro de cada círculo selecionado', radii[0] * 2);
        }
        html += section('Resumo') + row('Comprimento total', fmt(total));
        kinds.forEach((k) => { html += row(TYPE_LABELS[k] ?? k, String(selected.filter((e) => e.type === k).length)); });
    }
    box.innerHTML = html;

    for (const [selector, field] of [['[data-font-family]', 'fontFamily'], ['[data-font-bold]', 'bold'], ['[data-font-italic]', 'italic']]) box.querySelector(selector)?.addEventListener('change', (event) => {
        const entity = editor.doc.entities.find((x) => x.id === selected[0]?.id);
        if (!entity || !isEntityEditable(editor.doc, entity)) return;
        const value = field === 'fontFamily' ? event.target.value : event.target.checked;
        editor.commit('Fonte', replaceEntities(editor.doc, new Map([[entity.id, { ...entity, [field]: value }]])));
    });
    box.querySelectorAll('[data-geometry]').forEach((input) => input.addEventListener('change', () => {
        const entity = editor.doc.entities.find((x) => x.id === selected[0]?.id);
        if (!entity || !isEntityEditable(editor.doc, entity)) return;
        try {
            const lengthValue = Number(String(input.value).replace(',', '.'));
            if (input.dataset.geometry === 'length' && entity.type === 'line' && !(lengthValue > 0)) throw new Error('Valor deve ser positivo.');
            const next = input.dataset.geometry === 'length' && entity.type === 'line' ? setLineLength(entity, lengthValue, lineLengthAnchor) : setGeometryField(entity, input.dataset.geometry, input.value);
            editor.commit('Propriedade geométrica', replaceEntities(editor.doc, new Map([[entity.id, next]])));
        } catch (error) {
            editor.log(error.message, 'error');
            renderProperties(editor, root);
        }
    }));
    box.querySelector('[data-dim-text]')?.addEventListener('change', (event) => {
        const entity = editor.doc.entities.find((x) => x.id === selected[0]?.id);
        if (!entity || !isEntityEditable(editor.doc, entity)) return;
        const value = event.target.value;
        editor.commit('Texto da cota', replaceEntities(editor.doc, new Map([[entity.id, { ...entity, textOverride: value === '<>' ? undefined : value }]])));
    });

    // 1. Layer
    const layerSelect = box.querySelector('[data-prop="layer"]');
    if (layerSelect) {
        layerSelect.value = sameLayer;
        layerSelect.addEventListener('change', () => {
            if (!layerSelect.value) return;
            // Trocar de layer volta cor e tipo de linha para ByLayer; ajuste próprio vem depois.
            editor.commit('Layer dos objetos', updateEntities(editor.doc, [...editor.selection], (e) => ({ ...e, layer: layerSelect.value, color: 'bylayer', lineType: 'bylayer' })));
        });
    }

    // 2. Cor
    const colorInput = box.querySelector('[data-prop="color"]');
    const colorPicker = box.querySelector('[data-prop="color-picker"]');
    const swatch = box.querySelector('.cad-prop-swatch');
    if (swatch && colorPicker) {
        swatch.addEventListener('click', () => {
            try {
                if (typeof colorPicker.showPicker === 'function') colorPicker.showPicker();
                else colorPicker.click();
            } catch (e) {
                colorPicker.click();
            }
        });
        colorPicker.addEventListener('input', () => { swatch.style.background = colorPicker.value; });
        colorPicker.addEventListener('change', () => {
            const val = colorPicker.value;
            editor.commit('Cor dos objetos', updateEntities(editor.doc, [...editor.selection], (e) => ({ ...e, color: val })));
        });
    }
    if (colorInput) {
        colorInput.addEventListener('change', () => {
            const raw = colorInput.value;
            if (raw === '__pick') {
                colorInput.value = colorKey;
                swatch?.click();
                return;
            }
            if (!raw) return;
            const value = raw === 'bylayer' || raw.startsWith('#') ? raw : Number(raw);
            editor.commit('Cor dos objetos', updateEntities(editor.doc, [...editor.selection], (e) => ({ ...e, color: value })));
        });
    }

    // 3. Tipo de linha
    const linetypeSelect = box.querySelector('[data-prop="linetype"]');
    if (linetypeSelect) {
        linetypeSelect.value = sameLineType;
        linetypeSelect.addEventListener('change', () => {
            if (!linetypeSelect.value) return;
            const value = linetypeSelect.value === 'bylayer' ? 'bylayer' : linetypeSelect.value;
            editor.commit('Tipo de linha dos objetos', updateEntities(editor.doc, [...editor.selection], (e) => ({ ...e, lineType: value })));
        });
    }

    // 4. Espessura
    const weightSelect = box.querySelector('[data-prop="lineweight"]');
    if (weightSelect) {
        weightSelect.value = sameWeight === '' ? '' : String(sameWeight);
        weightSelect.addEventListener('change', () => {
            if (weightSelect.value === '') return;
            const value = weightSelect.value === 'bylayer' ? 'bylayer' : Number(weightSelect.value);
            editor.commit('Espessura dos objetos', updateEntities(editor.doc, [...editor.selection], (e) => ({ ...e, lineWeight: value })));
        });
    }

    // 5. Tamanho do texto
    const textHeightInput = box.querySelector('[data-prop="text-height"]');
    if (textHeightInput) {
        const applyTextHeight = () => {
            const val = parseDecimalInput(textHeightInput.value);
            if (!Number.isFinite(val) || val <= 0) {
                renderProperties(editor, root);
                return;
            }
            editor.commit('Tamanho do texto', updateEntities(editor.doc, [...editor.selection], (e) => {
                if (e.type === 'text') {
                    return { ...e, height: val };
                }
                if (e.type === 'dimension') {
                    return {
                        ...e,
                        textHeight: val,
                        style: { ...(e.style ?? {}), textHeight: val },
                    };
                }
                return e;
            }));
        };

        textHeightInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
                event.preventDefault();
                applyTextHeight();
                textHeightInput.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                renderProperties(editor, root);
                textHeightInput.blur();
            }
        });
        textHeightInput.addEventListener('change', applyTextHeight);
    }

    const dimArrowInput = box.querySelector('[data-prop="dim-arrow"]');
    if (dimArrowInput) {
        const applyDimArrow = () => {
            const val = parseDecimalInput(dimArrowInput.value);
            if (!Number.isFinite(val) || val <= 0) {
                renderProperties(editor, root);
                return;
            }
            editor.commit('Tamanho da seta', updateEntities(editor.doc, [...editor.selection], (e) => (e.type === 'dimension' && isEntityEditable(editor.doc, e) ? { ...e, style: { ...(e.style ?? {}), arrowSize: val } } : e)));
        };
        dimArrowInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') { event.preventDefault(); applyDimArrow(); dimArrowInput.blur(); }
            else if (event.key === 'Escape') { event.preventDefault(); renderProperties(editor, root); dimArrowInput.blur(); }
        });
        dimArrowInput.addEventListener('change', applyDimArrow);
    }

    const dimOverallInput = box.querySelector('[data-prop="dim-overall"]');
    if (dimOverallInput) {
        const applyDimOverall = () => {
            const val = parseDecimalInput(dimOverallInput.value);
            if (!Number.isFinite(val) || val <= 0) {
                renderProperties(editor, root);
                return;
            }
            editor.commit('Escala geral da cota', updateEntities(editor.doc, [...editor.selection], (e) => {
                if (e.type !== 'dimension' || !isEntityEditable(editor.doc, e)) return e;
                const { scale: _old, ...rest } = e;
                return { ...rest, style: { ...(e.style ?? {}), scale: val } };
            }));
        };
        dimOverallInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') { event.preventDefault(); applyDimOverall(); dimOverallInput.blur(); }
            else if (event.key === 'Escape') { event.preventDefault(); renderProperties(editor, root); dimOverallInput.blur(); }
        });
        dimOverallInput.addEventListener('change', applyDimOverall);
    }

    const dimScaleInput = box.querySelector('[data-prop="dim-scale"]');
    if (dimScaleInput) {
        const applyDimScale = () => {
            const val = parseDecimalInput(dimScaleInput.value);
            if (!Number.isFinite(val) || val <= 0) {
                renderProperties(editor, root);
                return;
            }
            editor.commit('Escala da cota', updateEntities(editor.doc, [...editor.selection], (e) => (e.type === 'dimension' && isEntityEditable(editor.doc, e) ? { ...e, measurementScale: val, style: { ...(e.style ?? {}), measurementScale: val } } : e)));
        };
        dimScaleInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') { event.preventDefault(); applyDimScale(); dimScaleInput.blur(); }
            else if (event.key === 'Escape') { event.preventDefault(); renderProperties(editor, root); dimScaleInput.blur(); }
        });
        dimScaleInput.addEventListener('change', applyDimScale);
    }

    // Comprimento de várias linhas
    box.querySelector('[data-prop="line-anchor"]')?.addEventListener('change', (event) => { lineLengthAnchor = event.target.value; });
    const lineLengthInput = box.querySelector('[data-prop="line-length"]');
    if (lineLengthInput) {
        const applyLineLength = () => {
            const val = parseDecimalInput(lineLengthInput.value);
            if (!Number.isFinite(val) || val <= 0) {
                renderProperties(editor, root);
                return;
            }
            editor.commit('Comprimento das linhas', updateEntities(editor.doc, [...editor.selection], (e) => (e.type === 'line' && isEntityEditable(editor.doc, e) ? setLineLength(e, val, lineLengthAnchor) : e)));
        };
        lineLengthInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
                event.preventDefault();
                applyLineLength();
                lineLengthInput.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                renderProperties(editor, root);
                lineLengthInput.blur();
            }
        });
        lineLengthInput.addEventListener('change', applyLineLength);
    }

    // Raio/diâmetro de vários círculos
    box.querySelectorAll('[data-prop="circle-radius"], [data-prop="circle-diameter"]').forEach((input) => {
        const apply = () => {
            const val = parseDecimalInput(input.value);
            if (!Number.isFinite(val) || val <= 0) {
                renderProperties(editor, root);
                return;
            }
            const radius = input.dataset.prop === 'circle-diameter' ? val / 2 : val;
            editor.commit('Raio dos círculos', updateEntities(editor.doc, [...editor.selection], (e) => (e.type === 'circle' && isEntityEditable(editor.doc, e) ? { ...e, radius } : e)));
        };
        input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
                event.preventDefault();
                apply();
                input.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                renderProperties(editor, root);
                input.blur();
            }
        });
        input.addEventListener('change', apply);
    });

    // 6. Precisão das cotas
    const precisionSelect = box.querySelector('[data-prop="dim-precision"]');
    if (precisionSelect) {
        precisionSelect.addEventListener('change', () => {
            if (precisionSelect.value === '') return;
            const value = Number(precisionSelect.value);
            editor.commit('Precisão das cotas', updateEntities(editor.doc, [...editor.selection], (e) => (e.type === 'dimension' ? { ...e, style: { ...(e.style ?? {}), precision: value } } : e)));
        });
    }
}

// ---------------------------------------------------------------------------
// Navegador de arquivos do laser



function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function setupSnapMenu(editor, root) {
    const menu = root.querySelector('[data-cad-snap-menu]');
    if (!menu) return;
    menu.innerHTML = '';
    editor.snapModes().forEach((mode) => {
        const label = document.createElement('label');
        label.className = 'cad-snap-option';
        label.dataset.cadSnap = mode.key;
        label.title = `${mode.short} · ${mode.label}`;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(editor.settings.snaps[mode.key]);
        input.addEventListener('change', () => editor.setSnapMode(mode.key, input.checked));
        label.appendChild(input);

        const icon = document.createElement('span');
        icon.className = 'cad-snap-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = mode.svg || snapIconSvg(mode.key);
        label.appendChild(icon);

        const text = document.createElement('span');
        text.className = 'cad-snap-label';
        text.textContent = mode.label;
        label.appendChild(text);

        menu.appendChild(label);
    });
    const trigger = root.querySelector('[data-cad-snap-menu-toggle]');
    trigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', (event) => {
        if (!menu.contains(event.target)) menu.hidden = true;
    });
}

// Troca de camada pela barra: com objetos selecionados, move-os para a camada
// e volta cor, tipo e espessura de linha para "ByLayer", como no BricsCAD;
// sem seleção, define a camada atual.
export function applyLayerFromToolbar(editor, name) {
    if (!editor.doc.layers.some((l) => l.name === name)) return;
    const ids = [...editor.selection].filter((id) => {
        const entity = editor.doc.entities.find((x) => x.id === id);
        return entity && isEntityEditable(editor.doc, entity);
    });
    if (!ids.length) {
        editor.setCurrentLayer(name);
        return;
    }
    editor.commit('Layer dos objetos', updateEntities(editor.doc, ids, ({ color, lineType, lineWeight, ...e }) => ({
        ...e, layer: name, color: 'bylayer',
    })));
}

// Camada mostrada na barra: a dos objetos selecionados quando todos estão na
// mesma; '' quando divergem; a atual quando não há seleção.
export function toolbarLayerName(editor) {
    if (!editor.selection.size) return editor.doc.currentLayer;
    const names = new Set(editor.doc.entities.filter((e) => editor.selection.has(e.id)).map((e) => e.layer));
    return names.size === 1 ? [...names][0] : '';
}

function setupLayerDropdown(editor, select) {
    const control = select.closest('.cad-layer-control') ?? select.parentElement;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cad-layer-dropdown-toggle';
    toggle.dataset.cadLayerDropdown = '';
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.innerHTML = '<span class="cad-layer-dropdown-swatch"></span><span class="cad-layer-dropdown-name" data-i18n-skip></span><i class="bi bi-chevron-down"></i>';
    const list = document.createElement('div');
    list.className = 'cad-layer-dropdown-list';
    list.dataset.cadLayerDropdownList = '';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    select.hidden = true;
    select.after(toggle, list);
    control.querySelector('[data-cad-layer-swatch]')?.setAttribute('hidden', '');

    const close = () => { list.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        list.hidden = !list.hidden;
        toggle.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
        if (!list.hidden) renderLayerDropdown(editor, list.parentElement);
    });
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
        event.stopPropagation();
        const row = event.target.closest('[data-layer]');
        if (!row) return;
        const layer = editor.doc.layers.find((l) => l.name === row.dataset.layer);
        if (!layer) return;
        const action = event.target.closest('[data-layer-action]')?.dataset.layerAction;
        if (action === 'visible') editor.layerUpdate(layer.name, { visible: !layer.visible });
        else if (action === 'locked') editor.layerUpdate(layer.name, { locked: !layer.locked });
        else {
            applyLayerFromToolbar(editor, layer.name);
            close();
        }
        if (!list.hidden) renderLayerDropdown(editor, list.parentElement);
    });
    document.addEventListener('click', (event) => {
        if (!list.contains(event.target) && event.target !== toggle) close();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !list.hidden) close();
    });
}

function renderLayerDropdown(editor, root) {
    const toggle = root.querySelector('[data-cad-layer-dropdown]');
    const list = root.querySelector('[data-cad-layer-dropdown-list]');
    if (!toggle || !list) return;
    const shown = toolbarLayerName(editor);
    const layer = editor.doc.layers.find((l) => l.name === shown);
    toggle.querySelector('.cad-layer-dropdown-swatch').style.background = layer ? editor.layerColor(layer) : 'transparent';
    toggle.querySelector('.cad-layer-dropdown-name').textContent = shown || t('*VÁRIOS*');
    toggle.title = t(editor.selection.size ? 'Camada dos objetos selecionados' : 'Camada atual');
    if (list.hidden) return;
    list.innerHTML = editor.doc.layers.map((l) => `
        <div class="cad-layer-dropdown-row${l.name === shown ? ' is-current' : ''}" role="option" data-layer="${escapeHtml(l.name)}" aria-selected="${l.name === shown}">
            <button type="button" class="cad-layer-dropdown-icon${l.visible ? ' is-on' : ''}" data-layer-action="visible" title="${l.visible ? 'Desligar' : 'Ligar'}"><i class="bi bi-lightbulb${l.visible ? '-fill' : ''}"></i></button>
            <button type="button" class="cad-layer-dropdown-icon" data-layer-action="locked" title="${l.locked ? 'Destravar' : 'Travar'}"><i class="bi bi-${l.locked ? 'lock-fill' : 'unlock'}"></i></button>
            <span class="cad-layer-dropdown-swatch" style="background:${editor.layerColor(l)}"></span>
            <span class="cad-layer-dropdown-name" data-i18n-skip>${escapeHtml(l.name)}</span>
        </div>`).join('');
}

function setupLayerSelect(editor, root) {
    const select = root.querySelector('[data-cad-layer-select]');
    if (!select) return;
    select.addEventListener('change', () => applyLayerFromToolbar(editor, select.value));
    setupLayerDropdown(editor, select);
    const button = root.querySelector('[data-cad-layer-new]');
    button?.addEventListener('click', () => editor.runCommand('LAYNEW'));
    const visibility = root.querySelector('[data-cad-layer-visibility]');
    visibility?.addEventListener('click', () => {
        const layer = editor.doc.layers.find((l) => l.name === editor.doc.currentLayer);
        if (!layer) return;
        editor.runCommand(layer.visible ? 'LAYOFF' : 'LAYON', [layer.name]);
    });
}

function setupLayerManager(editor, root) {
    const modal = root.querySelector('[data-cad-layer-manager]');
    if (!modal) return;
    const rows = modal.querySelector('[data-cad-layer-rows]');
    const open = () => {
        renderLayerRows(editor, rows);
        modal.hidden = false;
    };
    const close = () => { modal.hidden = true; editor.terminal.focus(); };
    editor.openLayerManager = open;
    root.querySelector('[data-cad-layer-manager-open]')?.addEventListener('click', open);
    modal.querySelector('[data-cad-layer-manager-close]')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    modal.querySelector('[data-cad-layer-manager-add]')?.addEventListener('click', () => {
        let index = editor.doc.layers.length;
        let name = `LAYER${index}`;
        while (editor.doc.layers.some((l) => l.name === name)) { index += 1; name = `LAYER${index}`; }
        editor.layerCreate(name);
        renderLayerRows(editor, rows);
    });
    editor.onLayersChanged = () => { if (!modal.hidden) renderLayerRows(editor, rows); };
}

function renderLayerRows(editor, rows) {
    const doc = editor.doc;
    const counts = {};
    doc.entities.forEach((e) => { counts[e.layer] = (counts[e.layer] ?? 0) + 1; });
    rows.innerHTML = '';
    doc.layers.forEach((layer) => {
        const tr = document.createElement('tr');
        if (layer.name === doc.currentLayer) tr.classList.add('is-current');
        const isHex = typeof layer.color === 'string' && layer.color.startsWith('#');
        const hex = aciToHex(layer.color);
        tr.innerHTML = `
            <td><input type="radio" name="cad-current-layer" ${layer.name === doc.currentLayer ? 'checked' : ''} aria-label="Layer atual"></td>
            <td><input type="text" value="${escapeHtml(layer.name)}" ${layer.name === '0' ? 'readonly' : ''} aria-label="Nome"></td>
            <td><input type="color" value="${hex}" aria-label="Cor"><input type="text" class="cad-aci" value="${isHex ? '' : layer.color}" placeholder="ACI" aria-label="Índice ACI"></td>
            <td><select aria-label="Tipo de linha">${Object.keys(LINETYPES).map((lt) => `<option value="${lt}" ${lt === (layer.lineType ?? 'CONTINUOUS') ? 'selected' : ''}>${lt}</option>`).join('')}</select></td>
            <td><select aria-label="Espessura">${LINEWEIGHTS.map((w) => `<option value="${w}" ${w === (layer.lineWeight ?? 0) ? 'selected' : ''}>${w === 0 ? 'Padrão' : `${(w / 100).toFixed(2)} mm`}</option>`).join('')}</select></td>
            <td><input type="checkbox" ${layer.visible ? 'checked' : ''} aria-label="Visível"></td>
            <td><input type="checkbox" ${layer.locked ? 'checked' : ''} aria-label="Travado"></td>
            <td>${counts[layer.name] ?? 0}</td>
            <td>${layer.name === '0' ? '' : '<button type="button" class="cad-btn" title="Excluir (objetos vão para 0)"><i class="bi bi-trash"></i></button>'}</td>`;
        const [radio, nameInput] = [tr.querySelector('input[type="radio"]'), tr.querySelector('input[type="text"]')];
        const colorInput = tr.querySelector('input[type="color"]');
        const aciInput = tr.querySelector('.cad-aci');
        const [lineTypeSelect, weightSelect] = tr.querySelectorAll('select');
        const [visibleBox, lockedBox] = tr.querySelectorAll('input[type="checkbox"]');
        radio.addEventListener('change', () => { editor.setCurrentLayer(layer.name); renderLayerRows(editor, rows); });
        nameInput.addEventListener('change', () => {
            if (!editor.layerRename(layer.name, nameInput.value)) nameInput.value = layer.name;
            renderLayerRows(editor, rows);
        });
        colorInput.addEventListener('change', () => { editor.layerUpdate(layer.name, { color: colorInput.value }); renderLayerRows(editor, rows); });
        aciInput.addEventListener('change', () => {
            const n = Number(aciInput.value);
            if (Number.isInteger(n) && n >= 1 && n <= 255) editor.layerUpdate(layer.name, { color: n });
            renderLayerRows(editor, rows);
        });
        lineTypeSelect.addEventListener('change', () => editor.layerUpdate(layer.name, { lineType: lineTypeSelect.value }));
        weightSelect.addEventListener('change', () => editor.layerUpdate(layer.name, { lineWeight: Number(weightSelect.value) }));
        visibleBox.addEventListener('change', () => editor.layerUpdate(layer.name, { visible: visibleBox.checked }));
        lockedBox.addEventListener('change', () => editor.layerUpdate(layer.name, { locked: lockedBox.checked }));
        tr.querySelector('button')?.addEventListener('click', () => { editor.layerDelete(layer.name); renderLayerRows(editor, rows); });
        rows.appendChild(tr);
    });
    void hexToAci;
}

// ---------------------------------------------------------------------------
// Abas e persistência local

class TabManager {
    constructor(editor, root) {
        this.editor = editor;
        this.root = root;
        this.list = root.querySelector('[data-cad-tabs-list]');
        this.status = root.querySelector('[data-cad-save-status]');
        this.scope = root.dataset.storageScope || 'default';
        this.tabs = [];
        this.activeId = null;
        this.nextId = 1;
        this.save = debounce(() => this.persist(), 800);
        this.contextMenu = null;
        this.contextTabId = null;
        root.querySelector('[data-cad-tab-add]')?.addEventListener('click', () => this.add());
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('beforeunload', () => this.save.flush());
        }
        this.setupGlobalListeners();
    }

    async init() {
        const saved = await loadWorkspace(this.scope);
        if (saved && Array.isArray(saved.tabs)) {
            if (saved.tabs.length > 0) {
                saved.tabs.forEach((t) => {
                    const doc = ensureEntityIds({ ...createDocument(), ...t.doc });
                    this.tabs.push({ id: this.nextId++, session: { history: new History(doc), viewport: t.viewport ?? null, memory: {} } });
                });
                const index = Math.min(Math.max(saved.activeIndex ?? 0, 0), this.tabs.length - 1);
                this.activate(this.tabs[index].id, { restoreView: true });
                this.editor.log(`${this.tabs.length} desenho(s) restaurado(s) do armazenamento local.`, 'info');
            } else {
                this.tabs = [];
                this.activeId = null;
            }
        } else {
            // A aba inicial adota o documento já carregado no editor se não houver workspace prévio salvo.
            this.tabs.push({ id: this.nextId++, session: this.editor.getSession() });
            this.activeId = this.tabs[0].id;
        }
        this.render();
        refreshUi(this.editor, this.root);
    }

    current() {
        return this.tabs.find((t) => t.id === this.activeId) ?? null;
    }

    getTabDoc(tab) {
        if (!tab) return null;
        return tab.id === this.activeId && this.editor?.doc ? this.editor.doc : tab.session?.history?.present ?? null;
    }

    getTabName(tab) {
        const doc = this.getTabDoc(tab);
        return (doc?.name || '').trim();
    }

    findExistingTab({ documentId, revisionId, sourceAttachmentId, anexoId, anexoUrl, name, filePath } = {}) {
        const cleanExt = (n) => (n || '').replace(/\.[^.]+$/, '').toLowerCase().trim();
        const normName = (n) => (n || '').toLowerCase().trim();
        // Windows não diferencia maiúsculas nem barras; demais sistemas comparam exato.
        const normPath = (p) => {
            const v = String(p || '').trim();
            return /^[a-z]:[\\/]|^\\\\/i.test(v) ? v.replace(/\//g, '\\').toLowerCase() : v;
        };
        const targetPath = filePath ? normPath(filePath) : '';

        for (const tab of this.tabs) {
            const doc = this.getTabDoc(tab);
            const hasEntities = Boolean(doc?.entities?.length);

            // 0. Verificação por caminho em disco
            if (targetPath && doc?.filePath && normPath(doc.filePath) === targetPath) {
                return tab;
            }

            // 1. Verificação por Document ID e Revision ID do sistema web
            if (documentId && tab.server?.documentId === documentId) {
                if (!revisionId || tab.server?.revisionId === revisionId) {
                    return tab;
                }
            }

            // 2. Verificação por Attachment ID / Source Attachment (não bloqueia se for aba vazia 'Sem título.dxf')
            if (sourceAttachmentId && (tab.server?.sourceAttachmentId === sourceAttachmentId || tab.server?.anexoId === sourceAttachmentId)) {
                if (hasEntities || (this.getTabName(tab) && this.getTabName(tab) !== 'Sem título.dxf')) {
                    return tab;
                }
            }
            if (anexoId && (tab.server?.anexoId === anexoId || tab.server?.sourceAttachmentId === anexoId)) {
                if (hasEntities || (this.getTabName(tab) && this.getTabName(tab) !== 'Sem título.dxf')) {
                    return tab;
                }
            }

            // 3. Verificação por Anexo URL
            if (anexoUrl && tab.server?.anexoUrl === anexoUrl) {
                if (hasEntities || (this.getTabName(tab) && this.getTabName(tab) !== 'Sem título.dxf')) {
                    return tab;
                }
            }

            // 4. Verificação por Nome do Arquivo. Arquivo aberto do disco é identificado
            // só pelo caminho: mesmo nome em outra pasta ou com outra extensão é outro arquivo.
            if (!targetPath && name && name !== 'Sem título.dxf') {
                const tabName = this.getTabName(tab);
                if (tabName && tabName !== 'Sem título.dxf') {
                    if (normName(tabName) === normName(name)) {
                        return tab;
                    }
                    if (cleanExt(tabName) && cleanExt(tabName) === cleanExt(name)) {
                        const tabExt = (tabName.split('.').pop() || '').toLowerCase();
                        const targetExt = (name.split('.').pop() || '').toLowerCase();
                        const cadExts = ['dxf', 'dwg', 'lxds', 'cdr', 'svg', 'qet', 'elmt'];
                        if (cadExts.includes(tabExt) && cadExts.includes(targetExt)) {
                            return tab;
                        }
                    }
                }
            }
        }
        return null;
    }

    activateOrAdd(doc = createDocument(), { server = null, name = null, switchReason = null } = {}) {
        const targetName = name || doc?.name || null;
        const existing = this.findExistingTab({
            documentId: server?.documentId,
            revisionId: server?.revisionId,
            sourceAttachmentId: server?.sourceAttachmentId,
            anexoId: server?.anexoId,
            anexoUrl: server?.anexoUrl,
            name: targetName,
        });

        if (existing) {
            this.activate(existing.id);
            const openName = this.getTabName(existing) || targetName || 'Desenho';
            const reason = switchReason || `O arquivo "${openName}" já está aberto em uma aba. Alternando para a aba existente.`;
            if (this.editor?.log) this.editor.log(reason, 'info');
            return { tab: existing, isNew: false };
        }

        const curr = this.current();
        if (curr && !curr.server && !this.isTabDirty(curr) && (this.getTabDoc(curr)?.entities?.length ?? 0) === 0 && (this.getTabName(curr) === 'Sem título.dxf' || !this.getTabName(curr))) {
            this.editor.loadDocument(doc);
            if (doc.view && this.editor?.viewport?.setView) {
                this.editor.viewport.setView(doc.view);
                this.editor.invalidate();
            }
            if (server) curr.server = server;
            this.render();
            this.save();
            return { tab: curr, isNew: false };
        }

        const tab = this.add(doc);
        if (server) tab.server = server;
        this.save();
        return { tab, isNew: true };
    }

    add(doc = createDocument()) {
        this.syncCurrent();
        let initialViewport = null;
        if (doc.view && this.editor?.viewport) {
            const vp = this.editor.viewport;
            const h = vp.height > 0 ? vp.height : 600;
            const w = vp.width > 0 ? vp.width : 800;
            if (doc.view.height > 0 && doc.view.center && Number.isFinite(doc.view.center.x) && Number.isFinite(doc.view.center.y)) {
                const scale = Math.min(vp.maxScale, Math.max(vp.minScale, h / doc.view.height));
                const originX = w / 2 - doc.view.center.x * scale;
                const originY = h / 2 + doc.view.center.y * scale;
                initialViewport = { scale, originX, originY };
            }
        }
        const tab = { id: this.nextId++, session: { history: new History(doc), viewport: initialViewport, memory: {} } };
        this.tabs.push(tab);
        this.activate(tab.id);
        return tab;
    }

    syncCurrent() {
        const tab = this.current();
        if (tab) tab.session = this.editor.getSession();
    }

    activate(id, { restoreView = true } = {}) {
        this.closeContextMenu();
        if (id === this.activeId && this.tabs.length > 0 && this.editor.history === this.current()?.session.history) return;
        this.syncCurrent();
        const tab = this.tabs.find((t) => t.id === id);
        if (!tab) return;
        this.activeId = id;
        this.editor.setSession({ history: tab.session.history, viewport: restoreView ? tab.session.viewport : null, memory: tab.session.memory });
        if (!tab.session.viewport) this.editor.zoomExtents();
        this.render();
        this.save();
    }

    isTabDirty(tab) {
        if (!tab?.session?.history) return false;
        const history = tab.session.history;
        const doc = tab.id === this.activeId && this.editor?.doc ? this.editor.doc : history.present;
        const name = (doc?.name || '').trim();
        const isUntitled = !name || name.toLowerCase() === 'sem título.dxf' || name.toLowerCase() === 'sem titulo.dxf';
        if (typeof history.isDirty === 'function') {
            if (history.isDirty()) return true;
        } else if (history.canUndo()) {
            return true;
        }
        if (isUntitled && !doc?.filePath && (doc?.entities?.length ?? 0) > 0) return true;
        return false;
    }

    // Salva, aba por aba, tudo o que tem alteração pendente (o mesmo SAVE do Ctrl+S).
    // Para na primeira aba que continuar suja (diálogo cancelado ou falha de gravação)
    // e devolve o nome dela, para quem chamou não seguir adiante achando que salvou.
    async saveAllDirty() {
        this.syncCurrent();
        const originalId = this.activeId;
        const dirty = this.tabs.filter((tab) => this.isTabDirty(tab));
        let saved = 0;
        for (const tab of dirty) {
            this.activate(tab.id);
            await this.editor.runCommand('SAVE');
            this.syncCurrent();
            if (this.isTabDirty(tab)) {
                return { saved, failed: this.getTabName(tab) || 'Sem título' };
            }
            saved += 1;
        }
        if (originalId && this.tabs.some((t) => t.id === originalId)) this.activate(originalId);
        this.save.flush?.();
        return { saved, failed: null };
    }

    close(id) {
        const index = this.tabs.findIndex((t) => t.id === id);
        if (index < 0) return;
        const tab = this.tabs[index];
        const nextNeighbor = this.tabs[index + 1] || this.tabs[index - 1] || null;
        this.closeTabs([tab], nextNeighbor?.id ?? null);
    }

    closeOthers(targetId) {
        const others = this.tabs.filter((t) => t.id !== targetId);
        this.closeTabs(others, targetId);
    }

    closeToTheRight(targetId) {
        const index = this.tabs.findIndex((t) => t.id === targetId);
        if (index < 0) return;
        const rightTabs = this.tabs.slice(index + 1);
        this.closeTabs(rightTabs, targetId);
    }

    closeToTheLeft(targetId) {
        const index = this.tabs.findIndex((t) => t.id === targetId);
        if (index <= 0) return;
        const leftTabs = this.tabs.slice(0, index);
        this.closeTabs(leftTabs, targetId);
    }

    closeAll() {
        this.closeTabs([...this.tabs]);
    }

    duplicate(targetId) {
        this.syncCurrent();
        const tab = this.tabs.find((t) => t.id === targetId);
        if (!tab) return null;
        const currentDoc = tab.id === this.activeId ? this.editor.doc : tab.session.history.present;
        const clonedDoc = JSON.parse(JSON.stringify(serializeDocument(currentDoc)));
        const baseName = currentDoc.name || 'Sem título.dxf';
        const dotIndex = baseName.lastIndexOf('.');
        const namePart = dotIndex > 0 ? baseName.substring(0, dotIndex) : baseName;
        const extPart = dotIndex > 0 ? baseName.substring(dotIndex) : '.dxf';
        clonedDoc.name = `${namePart} (cópia)${extPart}`;
        return this.add(clonedDoc);
    }

    rename(targetId) {
        const tab = this.tabs.find((t) => t.id === targetId);
        if (!tab) return;
        const doc = tab.id === this.activeId ? this.editor.doc : tab.session.history.present;
        const name = (typeof window !== 'undefined' && typeof window.prompt === 'function')
            ? (window.prompt(tr('Nome do desenho'), doc.name || '') || '').trim()
            : '';
        if (name) {
            if (tab.id === this.activeId) this.editor.setDocumentName(name);
            else tab.session.history.replace({ ...doc, name });
            this.render();
            this.save();
        }
    }

    // Fechamento pelos atalhos (Ctrl+W, Ctrl+F4) e pelo X da janela do desktop: cada aba suja
    // pergunta Salvar / Não salvar / Cancelar. Cancelar, ou um SAVE que não limpou a aba,
    // interrompe tudo e devolve false sem fechar nada além do que já foi decidido.
    async requestClose(tabsToClose, targetActiveId = null) {
        this.closeContextMenu();
        this.syncCurrent();
        const decided = [];
        for (const tab of tabsToClose) {
            if (!this.tabs.includes(tab)) continue;
            if (this.isTabDirty(tab)) {
                this.activate(tab.id);
                const choice = await askSaveBeforeClose(this.root, this.getTabDoc(tab)?.name || 'Sem título.dxf');
                if (choice === 'cancel') return false;
                if (choice === 'save') {
                    await this.editor.runCommand('SAVE');
                    this.syncCurrent();
                    if (this.isTabDirty(tab)) return false;
                }
            }
            decided.push(tab);
        }
        if (decided.length) this.closeTabs(decided, targetActiveId, { force: true });
        return true;
    }

    // Ctrl+Tab vai para o próximo desenho e Ctrl+Shift+Tab para o anterior, dando a volta nas pontas.
    cycle(step = 1) {
        if (this.tabs.length < 2) return false;
        const index = Math.max(this.tabs.findIndex((t) => t.id === this.activeId), 0);
        const next = this.tabs[(index + step + this.tabs.length) % this.tabs.length];
        this.activate(next.id);
        return true;
    }

    async closeCurrent() {
        const tab = this.current();
        if (!tab) return false;
        const index = this.tabs.indexOf(tab);
        const neighbor = this.tabs[index + 1] || this.tabs[index - 1] || null;
        return this.requestClose([tab], neighbor?.id ?? null);
    }

    // Ctrl+F4: fecha o Traço inteiro. No desktop fecha a janela; no navegador só dá para
    // fechar as abas do desenho (o navegador não deixa a página fechar a si mesma).
    async requestQuit() {
        if (!(await this.requestClose([...this.tabs]))) return false;
        this.save.flush?.();
        const bridge = typeof window !== 'undefined' ? window.desktopBridge : null;
        if (bridge?.closeWindow) await bridge.closeWindow();
        return true;
    }

    closeTabs(tabsToClose, targetActiveId = null, { force = false } = {}) {
        if (!tabsToClose || tabsToClose.length === 0) return;
        this.closeContextMenu();
        this.syncCurrent();

        const toRemove = [];
        for (const tab of tabsToClose) {
            const doc = tab.id === this.activeId ? this.editor.doc : tab.session.history.present;
            const name = doc?.name || 'desenho';
            if (!force && this.isTabDirty(tab)) {
                if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ && this.root) {
                    showTabCloseConfirmModal(this.root, name, () => {
                        this.closeTabs([tab], targetActiveId, { force: true });
                    });
                    continue;
                }
                if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    if (!window.confirm(tr(`Fechar "${name}"? O conteúdo desta aba será descartado.`))) {
                        continue;
                    }
                }
            }
            toRemove.push(tab.id);
        }

        if (toRemove.length === 0) return;
        const removeSet = new Set(toRemove);
        const remainingTabs = this.tabs.filter((t) => !removeSet.has(t.id));

        if (remainingTabs.length === 0) {
            this.tabs = [];
            this.activeId = null;
            this.editor.selection?.clear?.();
            this.editor.terminal?.clear?.();
            this.editor.setSession?.({ history: new History(createDocument()), viewport: null, memory: {} });
            this.editor.render?.();
            this.render();
            this.save();
            refreshUi(this.editor, this.root);
            return;
        }

        this.tabs = remainingTabs;

        if (removeSet.has(this.activeId)) {
            const nextTab = (targetActiveId && this.tabs.find((t) => t.id === targetActiveId)) || this.tabs[this.tabs.length - 1];
            this.activeId = null;
            this.activate(nextTab.id);
        } else {
            // Fechar uma aba inativa costuma apontar para a própria aba ativa; activate() sai cedo
            // nesse caso e a barra ficava com a aba fechada desenhada até o próximo clique.
            if (targetActiveId && targetActiveId !== this.activeId && this.tabs.some((t) => t.id === targetActiveId)) {
                this.activate(targetActiveId);
            } else {
                this.render();
                this.save();
            }
        }
    }

    getOrCreateContextMenu() {
        if (this.contextMenu) return this.contextMenu;
        let menu = this.root.querySelector('[data-cad-tab-context-menu]');
        if (!menu && typeof document !== 'undefined') {
            menu = document.createElement('div');
            menu.className = 'cad-tab-context-menu';
            menu.setAttribute('data-cad-tab-context-menu', '');
            menu.setAttribute('hidden', '');
            menu.innerHTML = `
                <button type="button" class="cad-tab-context-item" data-action="close"><i class="bi bi-x-lg"></i><span>Fechar aba</span></button>
                <button type="button" class="cad-tab-context-item" data-action="close-others"><i class="bi bi-x-circle"></i><span>Fechar outras abas</span></button>
                <button type="button" class="cad-tab-context-item" data-action="close-right"><i class="bi bi-arrow-right"></i><span>Fechar abas à direita</span></button>
                <button type="button" class="cad-tab-context-item" data-action="close-left"><i class="bi bi-arrow-left"></i><span>Fechar abas à esquerda</span></button>
                <button type="button" class="cad-tab-context-item" data-action="close-all"><i class="bi bi-trash3"></i><span>Fechar todas as abas</span></button>
                <div class="cad-tab-context-separator"></div>
                <button type="button" class="cad-tab-context-item" data-action="duplicate"><i class="bi bi-copy"></i><span>Duplicar aba</span></button>
                <button type="button" class="cad-tab-context-item" data-action="rename"><i class="bi bi-pencil"></i><span>Renomear...</span></button>
                <div class="cad-tab-context-separator"></div>
                <button type="button" class="cad-tab-context-item" data-action="new"><i class="bi bi-plus-lg"></i><span>Nova aba</span></button>
            `;
            this.root.appendChild(menu);
        }

        if (menu) {
            menu.querySelectorAll('[data-action]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const tabId = this.contextTabId;
                    this.closeContextMenu();
                    if (action === 'new') {
                        this.add();
                    } else if (tabId != null) {
                        if (action === 'close') this.close(tabId);
                        else if (action === 'close-others') this.closeOthers(tabId);
                        else if (action === 'close-right') this.closeToTheRight(tabId);
                        else if (action === 'close-left') this.closeToTheLeft(tabId);
                        else if (action === 'close-all') this.closeAll();
                        else if (action === 'duplicate') this.duplicate(tabId);
                        else if (action === 'rename') this.rename(tabId);
                    }
                });
            });
        }

        this.contextMenu = menu;
        return menu;
    }

    showContextMenu(event, tabId) {
        if (!event) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        this.closeContextMenu();
        this.contextTabId = tabId;

        const menu = this.getOrCreateContextMenu();
        if (!menu) return;

        const index = this.tabs.findIndex((t) => t.id === tabId);
        const isOnlyOne = this.tabs.length <= 1;
        const isLastOnRight = index < 0 || index === this.tabs.length - 1;
        const isFirstOnLeft = index <= 0;

        const closeOthersBtn = menu.querySelector('[data-action="close-others"]');
        if (closeOthersBtn) closeOthersBtn.disabled = isOnlyOne;

        const closeRightBtn = menu.querySelector('[data-action="close-right"]');
        if (closeRightBtn) closeRightBtn.disabled = isLastOnRight;

        const closeLeftBtn = menu.querySelector('[data-action="close-left"]');
        if (closeLeftBtn) closeLeftBtn.disabled = isFirstOnLeft;

        menu.removeAttribute('hidden');
        menu.style.visibility = 'hidden';

        const menuRect = (typeof menu.getBoundingClientRect === 'function')
            ? menu.getBoundingClientRect()
            : { width: 190, height: 220 };
        const menuWidth = menuRect.width || 190;
        const menuHeight = menuRect.height || 220;

        const winWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1024;
        const winHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 768;

        let left = event.clientX != null ? event.clientX : 0;
        let top = event.clientY != null ? event.clientY : 0;

        if (left + menuWidth > winWidth) {
            left = Math.max(10, winWidth - menuWidth - 10);
        }
        if (top + menuHeight > winHeight) {
            top = Math.max(10, winHeight - menuHeight - 10);
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        menu.style.visibility = 'visible';
    }

    closeContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.setAttribute('hidden', '');
            this.contextMenu.style.visibility = 'hidden';
        }
        this.contextTabId = null;
    }

    setupGlobalListeners() {
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('pointerdown', (e) => {
                if (this.contextMenu && !this.contextMenu.hasAttribute('hidden')) {
                    if (typeof this.contextMenu.contains === 'function' && !this.contextMenu.contains(e.target)) {
                        this.closeContextMenu();
                    }
                }
            });
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this.closeContextMenu();
            });
            window.addEventListener('resize', () => this.closeContextMenu());
        }
        this.list?.addEventListener('scroll', () => this.closeContextMenu(), { passive: true });
    }

    render() {
        if (!this.list) return;
        this.list.innerHTML = '';
        this.tabs.forEach((tab) => {
            const el = document.createElement('div');
            const dirty = this.isTabDirty(tab);
            el.className = `cad-tab${tab.id === this.activeId ? ' is-active' : ''}${dirty ? ' is-dirty' : ''}`;
            el.setAttribute('role', 'tab');
            el.setAttribute('aria-selected', tab.id === this.activeId ? 'true' : 'false');
            const doc = tab.id === this.activeId ? this.editor.doc : tab.session.history.present;
            const title = document.createElement('span');
            title.className = 'cad-tab-title';
            title.textContent = doc.name || 'Sem título.dxf';
            title.title = [title.textContent, `${doc.entities.length} entidades${dirty ? ' · alterações não salvas' : ''}`].join(String.fromCharCode(10));
            el.title = title.title;
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'cad-tab-close';
            closeBtn.setAttribute('aria-label', dirty ? 'Fechar aba (alterações não salvas)' : 'Fechar aba');
            closeBtn.textContent = '×';
            closeBtn.addEventListener('click', (event) => { event.stopPropagation(); this.close(tab.id); });
            el.appendChild(title);
            el.appendChild(closeBtn);
            el.addEventListener('click', () => this.activate(tab.id));
            el.addEventListener('contextmenu', (event) => {
                this.showContextMenu(event, tab.id);
            });
            el.addEventListener('dblclick', () => {
                this.rename(tab.id);
            });
            this.list.appendChild(el);
        });
        refreshUi(this.editor, this.root);
    }

    async persist() {
        this.syncCurrent();
        const payload = {
            version: 1,
            savedAt: Date.now(),
            activeIndex: this.tabs.findIndex((t) => t.id === this.activeId),
            tabs: this.tabs.map((t) => ({ doc: serializeDocument(t.session.history.present), viewport: t.session.viewport })),
        };
        const where = await saveWorkspace(this.scope, payload);
        usage(where ? 'save_success' : 'save_failure');
        if (this.status) {
            const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            this.status.textContent = where ? `salvo localmente ${time}` : 'sem armazenamento local';
        }
    }
}

// Tela Início: mostrada sem abas. Abrir/salvar alimenta a lista de recentes.
function setupStartScreen(editor, root, tabs) {
    const openFile = editor.openFile.bind(editor);
    editor.openFile = async (file, options = {}) => {
        const result = await openFile(file, options);
        if (file && editor.doc?.entities?.length) recordRecent(editor.doc, { file }).catch(() => {});
        return result;
    };
    editor.onDocumentSaved = (size) => recordRecent(editor.doc, { size }).catch(() => {});
    const openRecent = async (entry) => {
        const file = await readRecentFile(entry);
        if (!file) {
            forgetRecent(entry.id);
            editor.log(t('"{0}" não está mais acessível e saiu da lista de recentes.', { 0: entry.name }), 'warn');
            refreshUi(editor, root);
            return false;
        }
        await editor.openFile(file, { filePath: entry.filePath || null });
        return true;
    };
    editor.startScreen = new StartScreen(root, {
        onNew: () => editor.runCommand('NEW'),
        onOpen: () => editor.runCommand('OPEN'),
        onOpenRecent: openRecent,
        onTemplate: async (entry) => {
            if (!(await openRecent(entry))) return;
            // O recente vira modelo: mesma geometria, sem vínculo com o arquivo original.
            const base = entry.name.replace(/\.[^.]+$/, '');
            editor.setDocumentName(t('{0} (novo).dxf', { 0: base }), null);
            tabs.render();
            tabs.save();
        },
    });
}

// Com "Mostrar ao iniciar", a aba em branco da abertura dá lugar à tela Início.
function closeBlankLaunchTab(tabs) {
    if (!showOnStart() || tabs.tabs.length !== 1) return;
    const tab = tabs.current();
    const doc = tabs.getTabDoc(tab);
    if (tab.server || doc?.filePath || (doc?.entities?.length ?? 0) > 0 || tabs.isTabDirty(tab)) return;
    tabs.closeTabs([tab], null, { force: true });
}

function askSaveBeforeClose(root, docName) {
    const name = String(docName ?? 'desenho');
    if (!root || typeof document === 'undefined') {
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') return Promise.resolve('discard');
        if (window.confirm(t('Salvar as alterações em "{name}"?', { name }))) return Promise.resolve('save');
        return Promise.resolve(window.confirm(t('Fechar "{name}" sem salvar?', { name })) ? 'discard' : 'cancel');
    }
    root.querySelectorAll('[data-cad-confirm-modal]').forEach((el) => el.remove());
    const cleanName = name.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
    const overlay = document.createElement('div');
    overlay.className = 'cad-error-overlay';
    overlay.setAttribute('data-cad-confirm-modal', '');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
        <div class="cad-error-modal cad-confirm-modal" role="document">
            <div class="cad-error-header">
                <div class="cad-error-badge cad-error-badge-warning">
                    <i class="bi bi-exclamation-triangle-fill"></i>
                    <span>${tr('Alterações não salvas')}</span>
                </div>
                <h2 class="cad-error-title" style="margin-top: 8px; font-size: 16px;">${t('Salvar as alterações em "{name}"?', { name: cleanName })}</h2>
            </div>
            <div class="cad-error-footer" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px;">
                <button type="button" class="cad-btn cad-btn-secondary" data-cad-confirm-action="cancel">${tr('Cancelar')}</button>
                <button type="button" class="cad-btn cad-btn-secondary" data-cad-confirm-action="discard">${tr('Não salvar')}</button>
                <button type="button" class="cad-btn cad-btn-primary" data-cad-confirm-action="save">${tr('Salvar')}</button>
            </div>
        </div>
    `;
    return new Promise((resolve) => {
        const finish = (choice) => {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
            resolve(choice);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish('cancel'); }
        };
        overlay.querySelectorAll('[data-cad-confirm-action]').forEach((button) => {
            button.addEventListener('click', () => finish(button.dataset.cadConfirmAction));
        });
        document.addEventListener('keydown', onKey, true);
        root.appendChild(overlay);
        overlay.querySelector('[data-cad-confirm-action="save"]')?.focus?.();
    });
}

function showTabCloseConfirmModal(root, docName, onConfirm) {
    if (!root) {
        if (typeof onConfirm === 'function') onConfirm();
        return;
    }
    const existing = root.querySelectorAll('[data-cad-confirm-modal]');
    existing.forEach((el) => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'cad-error-overlay';
    overlay.setAttribute('data-cad-confirm-modal', '');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    const cleanName = String(docName ?? 'desenho').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    overlay.innerHTML = `
        <div class="cad-error-modal cad-confirm-modal" role="document">
            <div class="cad-error-header">
                <div class="cad-error-badge cad-error-badge-warning">
                    <i class="bi bi-exclamation-triangle-fill"></i>
                    <span>Alterações não salvas</span>
                </div>
                <h2 class="cad-error-title" style="margin-top: 8px; font-size: 16px;">Fechar "${cleanName}"?</h2>
            </div>
            <div class="cad-error-body" style="text-align: center; margin: 12px 0 16px;">
                <p class="cad-error-message">Esta aba possui alterações não salvas. O conteúdo modificado será descartado.</p>
            </div>
            <div class="cad-error-footer" style="display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" class="cad-btn cad-btn-secondary" data-cad-confirm-action="cancel">Cancelar</button>
                <button type="button" class="cad-btn cad-btn-primary" data-cad-confirm-action="discard" style="background: #dc2626; border-color: #dc2626; color: #fff;">Descartar e Fechar</button>
            </div>
        </div>
    `;
    const dismiss = () => { overlay.remove(); };
    overlay.querySelector('[data-cad-confirm-action="cancel"]')?.addEventListener('click', dismiss);
    overlay.querySelector('[data-cad-confirm-action="discard"]')?.addEventListener('click', () => {
        dismiss();
        if (typeof onConfirm === 'function') onConfirm();
    });
    root.appendChild(overlay);
}

function refreshUi(editor, root) {
    if (!root) return;
    const hasTabs = Boolean(editor.tabs?.tabs?.length);
    if (root.classList) {
        if (typeof root.classList.toggle === 'function') {
            root.classList.toggle('is-empty', !hasTabs);
        } else if (!hasTabs) {
            root.classList.add?.('is-empty');
        } else {
            root.classList.remove?.('is-empty');
        }
    }

    const title = root.querySelector('[data-cad-doc-name]');
    const count = root.querySelector('[data-cad-entity-count]');
    const coords = root.querySelector('[data-cad-coords]');
    const undoButton = root.querySelector('[data-cad-command="UNDO"]');
    const redoButton = root.querySelector('[data-cad-command="REDO"]');

    if (!hasTabs) {
        editor.startScreen?.render();
        if (title) title.textContent = '';
        if (count) count.textContent = '';
        if (coords) coords.textContent = '';
        if (undoButton) undoButton.disabled = true;
        if (redoButton) redoButton.disabled = true;
        return;
    }

    const select = root.querySelector('[data-cad-layer-select]');
    if (select) {
        const current = editor.doc.currentLayer;
        const options = editor.doc.layers.map((layer) => {
            const swatch = layer.visible ? '●' : '○';
            return `<option value="${escapeHtml(layer.name)}" ${layer.name === current ? 'selected' : ''} style="color:${editor.layerColor(layer)}">${swatch} ${escapeHtml(layer.name)}${layer.locked ? ' 🔒' : ''}</option>`;
        });
        select.innerHTML = options.join('');
        const layer = editor.doc.layers.find((l) => l.name === current);
        const swatch = root.querySelector('[data-cad-layer-swatch]');
        if (swatch && layer) swatch.style.background = editor.layerColor(layer);
        renderLayerDropdown(editor, select.parentElement);
    }
    root.querySelectorAll('[data-cad-toggle]').forEach((button) => {
        const key = button.dataset.cadToggle;
        button.classList.toggle('is-on', Boolean(editor.settings[key]));
        button.setAttribute('aria-pressed', editor.settings[key] ? 'true' : 'false');
    });
    if (title) title.textContent = editor.doc.name || 'Sem título.dxf';
    if (count) count.textContent = `${editor.doc.entities.length} obj · ${editor.selection.size} sel`;
    if (undoButton) undoButton.disabled = !editor.history.canUndo();
    if (redoButton) redoButton.disabled = !editor.history.canRedo();
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function handlePendingOrUrlImport(editor, tabs = null) {
    if (!editor) return;

    const pending = popPendingImport();
    if (pending?.text) {
        const name = pending.name || 'desenho.dxf';
        const kind = pending.kind || kindOf(name);
        if (!['dxf', 'svg', 'elmt', 'qet'].includes(kind) || kindOf(name) !== kind) {
            editor.log('Formato não suportado pelo CAD.', 'warn');
            cleanupImportUrl();
            return;
        }
        if (tabs && typeof tabs.findExistingTab === 'function') {
            const existingTab = tabs.findExistingTab({ name });
            if (existingTab) {
                tabs.activate(existingTab.id);
                editor.log(`O arquivo "${name}" já está aberto em uma aba. Alternando para a aba existente.`, 'info');
                cleanupImportUrl();
                return;
            }
        }
        if (tabs && editor.doc?.entities?.length > 0) {
            tabs.add();
        }
        if (kind === 'svg') {
            await editor.importSvgText(pending.text, name);
        } else if (kind === 'elmt') {
            await editor.importElmtText(pending.text, name);
        } else if (kind === 'qet') {
            await editor.importQetText(pending.text, name);
        } else {
            await editor.importDxfText(pending.text, name);
        }
        editor.log(`Arquivo "${name}" aberto no Traço.`, 'info');
        cleanupImportUrl();
        return;
    }

    cleanupImportUrl();
}

export function cleanupImportUrl() {
    try {
        if (typeof window === 'undefined' || !window.location) return;
        const cleanUrl = new URL(window.location.href);
        const toDelete = ['anexo_url', 'anexo_id', 'anexo', 'attachment', 'anexo_name', 'nome', 'name', 'url', 'zip_extract'];
        let changed = false;
        toDelete.forEach((param) => {
            if (cleanUrl.searchParams.has(param)) {
                cleanUrl.searchParams.delete(param);
                changed = true;
            }
        });
        if (changed) {
            const title = typeof document !== 'undefined' ? document.title : '';
            window.history.replaceState({}, title, cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));
        }
    } catch {}
}

async function initCad(root) {
    if (!root) return null;

    bootUsage();
    setupLocale(root);
    let tabs = null;
    const editor = new Editor(root, {
        onChange: (e) => {
            refreshUi(e, root);
            renderProperties(e, root);
            e.onLayersChanged?.();
            tabs?.render();
            tabs?.save();
        },
    });
    setupToolbar(editor, root);
    setupRibbon(editor, root);
    setupSplitButtons(editor, root);
    setupTheme(editor, root);
    setupChrome(editor, root);
    setupSnapMenu(editor, root);
    setupLayerSelect(editor, root);
    setupLayerManager(editor, root);
    setupPanels(editor, root);
    refreshUi(editor, root);
    window.tracoCad = editor;
    if (root.querySelector('[data-cad-tabs]')) {
        try {
            tabs = new TabManager(editor, root);
            editor.tabs = tabs;
            setupStartScreen(editor, root, tabs);
            tabs.init().then(async () => {
                refreshUi(editor, root);
                await handlePendingOrUrlImport(editor, tabs);
                closeBlankLaunchTab(tabs);
            }).catch((error) => {
                console.error('Falha ao restaurar abas', error);
                editor.log(`Armazenamento local indisponível: ${error.message}`, 'warn');
                handlePendingOrUrlImport(editor, tabs);
            });
        } catch (error) {
            console.error('Falha ao iniciar abas', error);
            editor.bootError = error;
            handlePendingOrUrlImport(editor, null);
        }
        editor.onDropFile = async (file) => {
            // Arquivo solto: abre em nova aba quando o desenho atual tem conteúdo.
            if (editor.doc.entities.length > 0) tabs.add();
            return false;
        };
    } else {
        handlePendingOrUrlImport(editor, null);
    }
    return { locked: false, editor, tabs };
}

function boot() {
    const root = document.querySelector('[data-cad-app]');
    if (root) initCad(root);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}

if (typeof window !== 'undefined') {
    loadCadFonts().then(()=>window.tracoCad?.invalidate()).catch(()=>{});
}

export { TabManager, initCad, boot };

