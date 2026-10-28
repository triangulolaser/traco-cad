import { usage } from '../usage-telemetry.js';
// Editor: liga documento, viewport, renderer, terminal e comandos.
// Implementa a máquina de prompts (ponto, seleção, número, texto, palavra-chave).

import { Viewport } from './viewport.js';
import { Renderer } from './renderer.js';
import { Terminal } from './terminal.js';
import { History, createDocument, addEntities, removeEntities, updateEntities, editableEntities, visibleEntities, entityColor, layerOf, isEntityEditable, aciToHex, getDocumentSpatialIndex, ensureEntityIds } from './document.js';
import { findSnap, findCenterHints, findOverrideSnap, parseSnapOverride, SNAP_OVERRIDE_PROMPTS, applyOrtho, applyPolar, applyAngleLock, findSoftAxis, defaultSnapSettings, SNAP_MODES } from './snaps.js';
import { findTrackingSnap, mergeSnaps, trackingPointFromSnap, addTrackingPoint } from './tracking.js';
import { parsePointInput, parseNumberInput, matchKeyword, formatOptions, splitCommandLine } from './input.js';
import { tr } from './i18n.js';
import { COMMANDS, resolveCommand, suggestCommands, CancelError, autoDimSpec, lineDynSpec } from './commands.js';
import { parseDxf } from './dxf.js';
import { kindOf } from './file-types.js';
import { showCadErrorModal, hideCadErrorModal } from './error-modal.js';
import { openInlineTextEditor, updateInlineTextEditor, inlineTextEntityId } from './text-editor.js';
import { lxdsToEntities, looksLikeLxds, LXDS_TRAVEL_LAYER, LXDS_LEAD_LAYER } from './lxds.js';
import { dimensionGeometry } from './dimensions.js';
import { getEntityGrips, applyGripMove, findGripAt, gripsVisible, dimensionTextCenterSnap } from './grips.js';
import './extra-entities.js';
import './hatch.js';
import { renameLayer, deleteLayer, updateLayer, ensureLayer } from './document.js';
import { loadCadSettings, saveCadSettings } from './storage.js';
import {
    entityCurves,
    setEntityContext,
    distanceToCurve,
    entityBox,
    boxContains,
    curveIntersectsBox,
    emptyBox,
    boxAddPoint,
    boxIsEmpty,
    pointInBox,
    textBox,
    distance,
    angleOf,
    radToDeg,
    formatNumber,
} from './geometry.js';

const PICK_PIXELS = 6;
const SNAP_PIXELS = 10;
const DRAG_PIXELS = 4;
// Tolerância de um clique "parado": tremor da mão até aqui não vira arrasto da janela de seleção.
const CLICK_PIXELS = 10;

// Zoom da roda proporcional ao deslocamento: um clique de mouse (100 px) dá 1,15x;
// o trackpad manda dezenas de eventos pequenos e tem de somar o mesmo tanto, não 1,15x cada.
const ZOOM_PER_NOTCH = 1.15;
const WHEEL_PIXELS_PER_NOTCH = 100;
const WHEEL_MAX_NOTCHES = 2;

export function wheelZoomFactor(event) {
    // deltaMode: 0 = pixels, 1 = linhas (Firefox manda 3 por clique), 2 = páginas.
    const perUnit = event.deltaMode === 1 ? WHEEL_PIXELS_PER_NOTCH / 3 : event.deltaMode === 2 ? 4 * WHEEL_PIXELS_PER_NOTCH : 1;
    const notches = (event.deltaY * perUnit) / WHEEL_PIXELS_PER_NOTCH;
    const clamped = Math.max(-WHEEL_MAX_NOTCHES, Math.min(WHEEL_MAX_NOTCHES, notches));
    return ZOOM_PER_NOTCH ** -clamped;
}

// Campo da entrada dinâmica é centrado no ponto (translate -50%); preso dentro da área visível
// para não sumir quando a peça passa da tela.
export function clampDynFieldPosition(screen, stageWidth, stageHeight, fieldWidth = 64, fieldHeight = 20, margin = 4) {
    if (!(stageWidth > 0) || !(stageHeight > 0)) return screen;
    const halfW = fieldWidth / 2 + margin;
    const halfH = fieldHeight / 2 + margin;
    const clamp = (v, min, max) => (min > max ? (min + max) / 2 : Math.max(min, Math.min(max, v)));
    return { x: clamp(screen.x, halfW, stageWidth - halfW), y: clamp(screen.y, halfH, stageHeight - halfH) };
}

// Mira como no BricsCAD: sem comando, cruz + quadrado; pedindo objeto (TRIM, EXTEND, seleção), só o quadrado;
// pedindo ponto ou valor, só a cruz; pickCursor força o quadrado (Dimensão pede a linha primeiro).
const PICK_MODES = new Set(['entity', 'entityOrWindow', 'selection']);
function crosshairMode(pending) {
    if (!pending) return 'select';
    if (pending.pickCursor) return 'pick';
    return PICK_MODES.has(pending.mode) ? 'pick' : 'point';
}

// Alternar a seleção é com Ctrl (Cmd no Mac); Shift fica para ortho e para TRIM↔EXTEND.
const toggleKey = (event) => event.ctrlKey || event.metaKey;


// Comandos que criam objetos novos: recebem a cor, o tipo de linha e a espessura
// escolhidos no painel Propriedades antes de desenhar (CECOLOR/CELTYPE/CELWEIGHT).
// Edições (COPY, OFFSET, MIRROR...) preservam as propriedades da origem.
export const DRAW_COMMANDS = new Set([
    'POINT', 'DONUT', 'LINE', 'CIRCLE', 'ARC', 'PLINE', 'RECTANG', 'REVCLOUD', 'TEXT', 'POLYGON', 'ELLIPSE', 'SPLINE',
    'BOUNDARY', 'HATCH', 'RAY', 'XLINE', 'LEADER', 'AI_CIRCTAN',
    'DIM', 'DIMENSION', 'DIMLINEAR', 'DIMHORIZONTAL', 'DIMVERTICAL', 'DIMALIGNED', 'DIMBASELINE', 'DIMCONTINUE',
    'DIMCENTER', 'DIMANGULAR', 'DIMRADIUS', 'DIMDIAMETER',
]);

const isByLayer = (value) => value === undefined || value === null || value === 'bylayer';

// Aplica as propriedades de desenho às entidades que não têm valor próprio.
export function withDrawProps(entity, props) {
    if (!props) return entity;
    let next = entity;
    for (const field of ['color', 'lineType', 'lineWeight']) {
        if (!isByLayer(props[field]) && isByLayer(entity[field])) next = { ...next, [field]: props[field] };
    }
    return next;
}

export class Editor {
    constructor(root, options = {}) {
        this.root = root;
        this.canvas = root.querySelector('[data-cad-canvas]');
        this.stage = root.querySelector('[data-cad-stage]');
        this.terminal = new Terminal(root.querySelector('[data-cad-terminal]'));
        this.viewport = new Viewport();
        this.renderer = new Renderer(this.canvas, this.viewport);
        this.renderer.onImageReady = () => this.invalidate();
        this.openLayerManager = options.openLayerManager ?? null;
        this.history = new History(createDocument());
        setEntityContext({ dimStyle: this.history.present.dimStyle });
        this.selection = new Set();
        this.preview = [];
        this.pending = null;
        this.running = null;
        this.drawProps = { color: 'bylayer', lineType: 'bylayer', lineWeight: 'bylayer' };
        this.lastCommand = null;
        this.cursorScreen = null;
        this.cursorWorld = null;
        this.snap = null;
        this.centerHint = null;
        this.hover = null;
        this.hoverGrip = null;
        this.activeGrip = null;
        this.gripOriginalEntity = null;
        this.window = null;
        this.rubber = null;
        this.lastPoint = null;
        this.memory = {};
        this.zoomStack = [];
        this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        const savedSettings = loadCadSettings(this.storage);
        const defaultSettings = {
            ortho: false,
            softAxis: true,
            polar: false,
            polarIncrement: 45,
            osnap: true,
            otrack: true,
            grid: true,
            theme: 'dark',
            snaps: defaultSnapSettings(),
        };
        this.settings = {
            ...defaultSettings,
            ...(savedSettings || {}),
            snaps: {
                ...defaultSettings.snaps,
                ...(savedSettings?.snaps || {}),
            },
        };
        this.tracking = [];
        this.trackingLines = [];
        this.dwell = { key: null, timer: null };
        this.collabBridge = options.collabBridge || null;
        this.collabProvider = options.collabProvider || null;
        this.collaborators = [];
        this.dirty = true;
        this.onChange = options.onChange ?? (() => {});
        this.fileInput = root.querySelector('[data-cad-file-input]');
        this.bindEvents();
        this.resize();
        this.terminal.setPrompt('Comando:');
        this.terminal.log('Traço CAD. Digite um comando (HELP lista todos). F3 snaps, F7 grade, F8 orto, F10 polar, F11 rastreio.', 'info');
        this.terminal.log('Após o primeiro ponto, "x,y" e "d<a" são relativos ao ponto anterior; use "#x,y" para absoluto.', 'info');
        this.terminal.focus();
        this.loop();
    }

    // ------------------------------------------------------------------ estado

    get doc() {
        return this.history.present;
    }

    get drawing() {
        return Boolean(this.running && DRAW_COMMANDS.has(this.running));
    }

    setDrawProp(field, value) {
        this.drawProps = { ...this.drawProps, [field]: value };
        this.invalidate();
        this.onChange(this);
    }

    applyDrawProps(doc) {
        if (!this.drawing || !doc?.entities) return doc;
        const before = new Set(this.doc.entities.map((e) => e.id));
        let changed = false;
        const entities = doc.entities.map((e) => {
            if (before.has(e.id)) return e;
            const next = withDrawProps(e, this.drawProps);
            if (next !== e) changed = true;
            return next;
        });
        return changed ? { ...doc, entities } : doc;
    }

    commit(label, doc) {
        doc = this.applyDrawProps(doc);
        this.history.commit(label, doc);
        usage('edit');
        setEntityContext({ dimStyle: doc.dimStyle });
        this.selection = new Set([...this.selection].filter((id) => doc.entities.some((e) => e.id === id)));
        // Comandos que guardam ids entre passos (MATCHPROP) consultam a troca feita por este commit.
        this.lastRenamedIds = null;
        if (this.collabBridge) {
            // A ponte troca ids locais (e1, e2…) por ids globais; a seleção acompanha.
            const renamed = this.collabBridge.commitLocalDocument(doc);
            if (renamed?.size) this.selection = new Set([...this.selection].map((id) => renamed.get(id) ?? id));
            this.lastRenamedIds = renamed?.size ? renamed : null;
        }
        if (this.collabProvider) {
            this.collabProvider.updateLocalAwareness({ selection: Array.from(this.selection) });
        }
        this.invalidate();
        this.onChange(this);
        return doc;
    }

    undo() {
        const label = this.history.undo();
        setEntityContext({ dimStyle: this.doc.dimStyle });
        this.selection.clear();
        this.invalidate();
        this.onChange(this);
        return label;
    }

    redo() {
        const label = this.history.redo();
        setEntityContext({ dimStyle: this.doc.dimStyle });
        this.selection.clear();
        this.invalidate();
        this.onChange(this);
        return label;
    }

    loadDocument(doc) {
        if (this.pending) this.cancel();
        doc = ensureEntityIds(doc);
        // Depois de fechar todas as abas, o workspace permanece vazio. Uma
        // importação precisa de uma aba real; só trocar o history mantém canvas
        // e terminal ocultos por is-empty e deixa o desenho fora da persistência.
        if (this.tabs && !this.tabs.current()) {
            this.tabs.add(doc);
            return;
        }
        this.history.reset(doc);
        setEntityContext({ dimStyle: doc.dimStyle });
        this.selection.clear();
        this.invalidate();
        this.onChange(this);
    }

    /**
     * Guarda o arquivo de origem da aba atual como o importador o leu.
     * Fica fora do documento e da persistência: serve ao relatório de problema, que precisa
     * do arquivo original, não da reexportação do Traço — ela já perderia o que falhou na leitura.
     */
    setSourceFile(name, text) {
        const source = { name, text: String(text) };
        const tab = this.tabs?.current?.();
        if (tab) tab.source = source;
        else this.sourceFile = source;
    }

    currentSourceFile() {
        const tab = this.tabs?.current?.();
        return (tab ? tab.source : this.sourceFile) ?? null;
    }

    // ---------------------------------------------------------------- abas
    getSession() {
        return {
            history: this.history,
            viewport: { scale: this.viewport.scale, originX: this.viewport.originX, originY: this.viewport.originY },
            memory: this.memory,
        };
    }

    setSession(session) {
        if (this.pending) this.cancel();
        // Caixa de seleção, grip arrastado e prévias pertencem à aba que se deixa;
        // sem limpar, o segundo clique completaria a caixa no desenho da outra aba.
        if (this.activeGrip) this.cancelGripDrag();
        this.window = null;
        this.rubber = null;
        this.snap = null;
        this.hover = null;
        this.hoverGrip = null;
        this.preview = [];
        this.history = session.history;
        if (session.viewport) Object.assign(this.viewport, session.viewport);
        this.selection = new Set();
        this.zoomStack = [];
        setEntityContext({ dimStyle: this.doc.dimStyle });
        this.invalidate();
        this.onChange(this);
    }

    setDocumentName(name, filePath = undefined) {
        const next = { ...this.doc, name };
        if (filePath !== undefined) next.filePath = filePath;
        this.history.replace(next);
        this.onChange(this);
    }

    setCurrentLayer(name) {
        if (!layerOf(this.doc, name)) return;
        this.history.replace({ ...this.doc, currentLayer: name });
        this.onChange(this);
    }

    // Operações do gerenciador de layers (cada uma entra no histórico).
    layerUpdate(name, changes) {
        this.commit('Layer', updateLayer(this.doc, name, changes));
    }

    layerRename(oldName, newName) {
        const next = renameLayer(this.doc, oldName, newName);
        if (next === this.doc) return false;
        this.commit('Renomear layer', next);
        return true;
    }

    layerDelete(name) {
        const next = deleteLayer(this.doc, name);
        if (next === this.doc) return false;
        this.commit('Excluir layer', next);
        return true;
    }

    layerCreate(name, options = {}) {
        const next = ensureLayer(this.doc, name, options);
        if (next === this.doc) return false;
        this.commit('Novo layer', { ...next, currentLayer: name });
        return true;
    }

    entitiesById(ids) {
        const set = new Set(ids);
        return this.doc.entities.filter((e) => set.has(e.id));
    }

    selectedEntities() {
        if (!this.selection || this.selection.size === 0) return [];
        return this.entitiesById(this.selection);
    }

    clearSelection() {
        if (this.activeGrip) this.cancelGripDrag();
        this.hoverGrip = null;
        this.selection.clear();
        this.invalidate();
        this.onChange(this);
    }

    selectAll() {
        this.selection = new Set(editableEntities(this.doc).map((e) => e.id));
        this.log(`${this.selection.size} objeto(s) selecionado(s).`);
        this.invalidate();
        this.onChange(this);
    }

    saveSettings() {
        saveCadSettings(this.settings, this.storage);
    }

    toggle(key) {
        this.settings[key] = !this.settings[key];
        this.log(`${key.toUpperCase()} ${this.settings[key] ? 'ligado' : 'desligado'}.`);
        if (key === 'ortho' && this.settings.ortho) this.settings.polar = false;
        if (key === 'polar' && this.settings.polar) this.settings.ortho = false;
        if (key === 'otrack' && !this.settings.otrack) this.clearTracking();
        this.updateSnap();
        this.saveSettings();
        this.invalidate();
        this.onChange(this);
    }

    setSnapMode(mode, value) {
        this.settings.snaps[mode] = value;
        this.saveSettings();
        this.invalidate();
        this.onChange(this);
    }

    log(text, kind = 'info') {
        this.terminal.log(text, kind);
    }

    showError(options) {
        return showCadErrorModal(this.root, options);
    }

    hideError() {
        return hideCadErrorModal(this.root);
    }

    invalidate() {
        this.dirty = true;
    }

    // ------------------------------------------------------------------ render

    loop() {
        if (typeof requestAnimationFrame !== 'function') return;
        const frame = () => {
            // Guarda contra layout tardio (CSS carregado depois do JS, painéis ocultos, tela cheia):
            // se o palco mudou de tamanho sem o observer avisar, redimensiona o canvas.
            const rect = this.stage.getBoundingClientRect();
            const w = Math.max(200, Math.floor(rect.width));
            const h = Math.max(200, Math.floor(rect.height));
            if (w !== this.viewport.width || h !== this.viewport.height) this.resize();
            // Erro num quadro não pode matar o laço: sem o próximo requestAnimationFrame a tela congela.
            try {
                if (this.dirty) {
                    this.dirty = false;
                    this.render();
                }
            } catch (error) {
                console.error(error);
            } finally {
                requestAnimationFrame(frame);
            }
        };
        requestAnimationFrame(frame);
    }

    setTheme(name) {
        const theme = name === 'light' ? 'light' : 'dark';
        this.settings.theme = theme;
        this.renderer.setTheme(theme);
        this.root.dataset.cadTheme = theme;
        this.saveSettings();
        this.invalidate();
        this.onChange(this);
    }

    setCollaborators(list) {
        this.collaborators = Array.isArray(list) ? list : [];
        this.invalidate();
    }

    applyRemoteDocument(nextDoc) {
        if (!nextDoc) return;
        this.history.replace(nextDoc);
        const existingIds = new Set((nextDoc.entities || []).map((e) => e.id));
        this.selection = new Set([...this.selection].filter((id) => existingIds.has(id)));
        this.invalidate();
        this.onChange(this);
    }

    render() {
        let preview = this.pending?.preview && this.cursorWorld ? safePreview(this.pending.preview, this.effectiveCursor()) : this.preview;
        if (this.drawing) preview = preview.map((e) => (e.dimGuide ? e : withDrawProps(e, this.drawProps)));
        // Cota provisória (vermelha) da entrada dinâmica junto ao que está sendo desenhado.
        if (this.dyn?.spec.guides && this.cursorWorld) preview = [...preview, ...safePreview(this.dyn.spec.guides, this.effectiveCursor())];
        const rubber = this.activeGrip ? this.rubber : (this.pending?.reference && this.cursorWorld && ['point', 'pointOrEntity'].includes(this.pending.mode) ? { from: this.pending.reference, to: this.effectiveCursor() } : null);
        this.renderer.draw({
            doc: this.doc,
            dimStyle: this.doc.dimStyle,
            selection: this.selection,
            preview,
            rubber,
            snap: this.snap,
            centerHint: this.centerHint && ['point', 'pointOrEntity'].includes(this.pending?.mode) && this.snap?.point !== this.centerHint.point ? this.centerHint.point : null,
            // A mira acompanha o mouse; ORTO/POLAR/snaps restringem apenas o ponto de construção.
            cursor: this.cursorWorld,
            window: this.window,
            showGrid: this.settings.grid,
            showCrosshair: Boolean(this.cursorWorld),
            crosshairMode: crosshairMode(this.pending),
            tracking: ['point', 'pointOrEntity'].includes(this.pending?.mode) ? { points: this.tracking, lines: this.trackingLines } : null,
            hover: this.hover,
            hoverGrip: this.hoverGrip,
            activeGrip: this.activeGrip,
            gripGhost: this.activeGrip ? this.gripOriginalEntity : null,
            ghostIds: !inlineTextEntityId(this) && this.pending?.hide?.length ? new Set(this.pending.hide) : null,
            hiddenIds: inlineTextEntityId(this) ? new Set([inlineTextEntityId(this)]) : this.pending?.hide ? new Set(this.pending.hide) : (this.activeGrip ? new Set([this.activeGrip.entityId]) : null),
            collaborators: this.collaborators,
        });
        updateInlineTextEditor(this);
        this.updateDynInput?.();
        this.updateCoordinates();
    }

    // ------------------------------------------------------------ entrada dinâmica
    // Campos numéricos junto ao cursor (ex.: largura/altura do RECTANG). O comando fornece
    // fields, values(cursor), anchors(cursor) e resolve(cursor) e lê dynInput.locked no preview.
    // Digitar trava o campo; Tab alterna; Enter confirma; texto não numérico vai ao terminal.
    openDynInput(spec) {
        if (typeof document === 'undefined' || !this.stage) return;
        spec.locked = {};
        const box = document.createElement('div');
        box.className = 'cad-dyn-input';
        const inputs = spec.fields.map((field, index) => {
            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'decimal';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.className = 'cad-dyn-field';
            input.setAttribute('aria-label', field.label);
            input.dataset.field = field.key;
            input.addEventListener('input', () => {
                const number = parseNumberInput(input.value.trim());
                if (number !== null && (spec.accepts ? spec.accepts(field.key, number) : number > 0)) spec.locked[field.key] = number;
                else delete spec.locked[field.key];
                input.classList.toggle('is-locked', field.key in spec.locked);
                this.invalidate();
            });
            input.addEventListener('focus', () => { this.dyn.active = index; this.updateDynInput(); });
            input.addEventListener('keydown', (event) => this.onDynKeyDown(event, index));
            box.appendChild(input);
            return input;
        });
        box.addEventListener('pointerleave', (event) => {
            if (event.relatedTarget !== this.canvas && !box.contains(event.relatedTarget)) this.clearCursor();
        });
        this.stage.appendChild(box);
        this.dyn = { spec, box, inputs, active: 0, typed: new Set() };
    }

    clearCursor() {
        // Com comando pedindo ponto, sair da tela congela o prévio na última posição em vez de apagá-lo.
        if (['point', 'pointOrEntity'].includes(this.pending?.mode) && this.cursorWorld) {
            this.hover = null;
            this.invalidate();
            return;
        }
        this.cursorWorld = null;
        this.cursorScreen = null;
        this.snap = null;
        this.hover = null;
        if (this.hoverGrip && !this.activeGrip) this.hoverGrip = null;
        if (this.collabProvider) {
            this.collabProvider.updateLocalAwareness({ cursor: null });
        }
        this.invalidate();
    }

    closeDynInput() {
        if (!this.dyn) return;
        const hadFocus = this.dyn.box.contains(document.activeElement);
        this.dyn.box.remove();
        this.dyn = null;
        if (hadFocus) this.canvas?.focus?.();
    }

    // Não depende do foco do campo: se o navegador não o entregar, o texto acumula aqui mesmo.
    focusDynField(index, text = null) {
        const dyn = this.dyn;
        const next = (index + dyn.inputs.length) % dyn.inputs.length;
        if (next !== dyn.active) dyn.typed.clear();
        dyn.active = next;
        const input = dyn.inputs[next];
        input.focus();
        if (text === null) {
            input.select();
            return;
        }
        input.value = text === '\b' ? input.value.slice(0, -1) : (dyn.typed.has(next) ? input.value : '') + text;
        dyn.typed.add(next);
        input.dispatchEvent(new Event('input'));
    }

    commitDynInput(raw = '') {
        const dyn = this.dyn;
        // Opções (D, A, R) e coordenadas (@x,y) seguem pelo caminho normal do terminal.
        if (raw && parseNumberInput(raw) === null) {
            this.onTerminalSubmit(raw);
            return;
        }
        if (this.activeGrip) {
            this.finishGripDrag();
            return;
        }
        const cursor = this.effectiveCursor() ?? this.cursorWorld ?? this.pending?.reference;
        if (!cursor || !this.pending) return;
        if (dyn.spec.commitNumber && 'v' in dyn.spec.locked) {
            this.terminal.echo(this.pending.prompt, formatNumber(dyn.spec.locked.v, 4));
            this.resolvePending({ number: dyn.spec.locked.v });
            return;
        }
        const point = dyn.spec.resolve(cursor);
        this.terminal.echo(this.pending.prompt, dyn.spec.fields.map((f) => `${f.label} ${formatNumber(dyn.spec.values(cursor)[f.key], 4)}`).join(' × '));
        this.lastPoint = point;
        this.resolvePending({ point });
    }

    onDynKeyDown(event, index) {
        const dyn = this.dyn;
        if (!dyn) return;
        event.stopPropagation();
        if (event.key === 'Tab') {
            event.preventDefault();
            this.focusDynField(index + (event.shiftKey ? -1 : 1));
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            this.cancel();
            return;
        }
        // Os campos são numéricos: espaço confirma como Enter.
        const confirm = event.key === 'Enter' || (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey);
        if (!confirm) {
            if (event.key.length === 1 || event.key === 'Backspace') dyn.typed.add(index);
            return;
        }
        event.preventDefault();
        this.commitDynInput(dyn.inputs[index].value.trim());
    }

    updateDynInput() {
        const dyn = this.dyn;
        if (!dyn) return;
        const cursor = this.cursorWorld ? this.effectiveCursor() : null;
        dyn.box.hidden = !cursor;
        if (!cursor) return;
        const values = dyn.spec.values(cursor);
        const anchors = dyn.spec.anchors(cursor);
        dyn.spec.fields.forEach((field, index) => {
            const input = dyn.inputs[index];
            const focused = typeof document !== 'undefined' && document.activeElement === input;
            if (!(field.key in dyn.spec.locked) && !(focused && input.value && parseNumberInput(input.value.trim()) === null)) {
                const text = formatNumber(values[field.key], 2);
                if (input.value !== text) {
                    input.value = text;
                    if (focused) input.select();
                }
            }
            input.classList.toggle('is-active', index === dyn.active);
            // Sem âncora (ex.: cursor sobre a própria origem no Deslocamento Através), o campo some até ter onde ficar.
            const anchor = anchors?.[field.key];
            input.hidden = !anchor;
            if (!anchor) return;
            const screen = clampDynFieldPosition(this.viewport.worldToScreen(anchor),
                this.stage?.clientWidth, this.stage?.clientHeight, input.offsetWidth || 64, input.offsetHeight || 20);
            input.style.left = `${Math.round(screen.x)}px`;
            input.style.top = `${Math.round(screen.y)}px`;
        });
    }

    resize() {
        const rect = this.stage.getBoundingClientRect();
        const width = Math.max(200, Math.floor(rect.width));
        const height = Math.max(200, Math.floor(rect.height));
        this.renderer.resize(width, height);
        this.invalidate();
    }

    updateCoordinates() {
        const el = this.root.querySelector('[data-cad-coords]');
        if (!el) return;
        if (!this.cursorWorld) {
            el.textContent = '';
            return;
        }
        const p = this.effectiveCursor();
        let text = `${formatNumber(p.x, 3)}, ${formatNumber(p.y, 3)}`;
        if (this.pending?.reference) {
            const d = distance(this.pending.reference, p);
            const a = radToDeg(angleOf(this.pending.reference, p));
            text += `   Δ ${formatNumber(d, 3)} < ${formatNumber(a, 2)}°`;
        }
        el.textContent = text;
    }

    // ------------------------------------------------------------------ cursor

    shiftLockActive() {
        const ref = this.pending?.reference ?? (this.activeGrip ? this.activeGrip.point : null);
        return Boolean(this.shiftLock && ref && (['point', 'pointOrEntity'].includes(this.pending?.mode) || this.activeGrip));
    }

    setShiftLock(on) {
        if (Boolean(this.shiftLock) === Boolean(on)) return;
        this.shiftLock = Boolean(on);
        // TRIM/EXTEND: o prompt mostra o modo que o Shift ativou.
        if (this.pending?.shiftPrompt) this.terminal.setPrompt(`${tr(this.shiftLock ? this.pending.shiftPrompt : this.pending.prompt)}:`);
        if (this.cursorWorld) { this.updateSnap(); this.render(); }
    }

    effectiveCursor() {
        if (!this.cursorWorld) return null;
        // Shift ignora snaps de objeto: a trava angular manda no ponto.
        if (this.snap && !this.shiftLock) return this.snap.point;
        let p = this.cursorWorld;
        const ref = this.pending?.reference ?? (this.activeGrip ? this.activeGrip.point : null);
        if ((['point', 'pointOrEntity'].includes(this.pending?.mode) || this.activeGrip) && ref) {
            if (this.shiftLock) p = applyAngleLock(ref, p, 45);
            else if (this.settings.ortho) p = applyOrtho(ref, p);
            else {
                if(this.settings.polar)p=applyPolar(ref,p,this.settings.polarIncrement);
                if(this.settings.softAxis)p=findSoftAxis(ref,p,this.viewport.pixelsToWorld(10))?.point??p;
            }
        }
        return p;
    }

    updateSnap() {
        this.snap = null;
        this.trackingLines = [];
        if (!this.cursorWorld) return;
        const isPointPrompt = this.pending && ['point', 'pointOrEntity'].includes(this.pending.mode);
        if (!isPointPrompt && !this.activeGrip) return;
        const tolerance = this.viewport.pixelsToWorld(SNAP_PIXELS);
        const exclude = new Set(this.pending?.hide ?? (this.activeGrip ? [this.activeGrip.entityId] : []));
        const spatial = getDocumentSpatialIndex(this.doc);
        const snapReach = Math.max(tolerance * 2, 1);
        const entities = spatial
            ? spatial.searchRadius(this.cursorWorld, snapReach).filter((e) => {
                const l = layerOf(this.doc, e.layer);
                return !l || l.visible;
            })
            : visibleEntities(this.doc);
        const reference = this.pending?.reference ?? (this.activeGrip ? this.activeGrip.point : null);
        if (this.pending?.snapOverride) {
            // Snap digitado (TAN, END...) manda sozinho no próximo ponto: sem rastreamento nem ORTO.
            this.snap = findOverrideSnap(entities, this.cursorWorld, tolerance, this.pending.snapOverride, { reference, deferred: this.pending.deferredTangent, exclude });
            this.centerHint = null;
            return;
        }
        let objectSnap = this.settings.osnap ? findSnap(entities, this.cursorWorld, tolerance, this.settings.snaps, { reference, exclude }) : null;
        if (this.settings.osnap && !objectSnap && this.activeGrip?.type === 'textPosition' && this.gripOriginalEntity) {
            // Texto da cota encaixa no centro da medida (a própria cota fica fora do findSnap durante o arrasto).
            const center = dimensionTextCenterSnap(this.gripOriginalEntity, this.cursorWorld, tolerance);
            if (center) objectSnap = { mode: 'mid', point: center, entity: this.gripOriginalEntity };
        }
        if (this.settings.osnap) {
            // Passar pela borda de círculo/arco revela o centro; ele fica visível até tocar outra curva.
            const hints = findCenterHints(entities, this.cursorWorld, tolerance, this.settings.snaps, { exclude });
            if (hints.length > 0) this.centerHint = hints[0];
            const hint = this.centerHint;
            if (hint && (!objectSnap || objectSnap.mode === 'nea' || objectSnap.weak) && distance(hint.point, this.cursorWorld) <= tolerance * 3) {
                objectSnap = { mode: hint.mode ?? 'cen', point: hint.point, entity: hint.entity };
            }
        } else {
            this.centerHint = null;
        }
        const ghostSnap = this.settings.osnap ? this.gripGhostSnap(tolerance, reference) : null;
        if (ghostSnap) objectSnap = mergeSnaps(objectSnap, ghostSnap);
        let trackingSnap = null;
        if (this.settings.otrack && (this.tracking.length > 0 || (reference && this.settings.polar))) {
            const result = findTrackingSnap({
                tracking: this.tracking,
                reference,
                cursor: this.cursorWorld,
                tolerance,
                entities,
                exclude,
                polarOn: this.settings.polar,
                polarIncrement: this.settings.polarIncrement,
                reach: Math.max(this.viewport.pixelsToWorld(this.viewport.width + this.viewport.height) * 4, 1000),
            });
            if (result) {
                trackingSnap = result.snap;
                this.trackingLines = result.lines ?? [];
            }
        }
        this.snap = mergeSnaps(objectSnap, trackingSnap);
        if (this.snap && this.snap !== trackingSnap) this.trackingLines = [];
        if (this.snap && this.settings.ortho && reference && !this.orthoAccepts(reference, this.snap.point, tolerance)) {
            // Orto trava a direção; só aceita snaps que fiquem quase sobre o eixo horizontal/vertical do cursor.
            this.snap = null;
            this.trackingLines = [];
        }
        if(!this.snap && !this.settings.ortho && this.settings.softAxis && reference){
            const soft=findSoftAxis(reference,this.cursorWorld,this.viewport.pixelsToWorld(10));
            if(soft){this.snap={mode:'trk',point:soft.point,softAxis:soft.axis};this.trackingLines=[{kind:'line',origin:reference,angle:soft.angle}];}
        }
        if (this.shiftLockActive()) { this.snap = null; this.trackingLines = []; }
        this.scheduleAcquire(objectSnap, tolerance);
    }

    // Original tracejado da linha sob alça também é geometria para snap: os snaps normais nele
    // e o "Mais próximo" ao longo da reta prolongada, para esticar/encurtar na mesma direção.
    gripGhostSnap(tolerance, reference) {
        const ghost = this.activeGrip ? this.gripOriginalEntity : null;
        if (!ghost || ghost.type !== 'line' || !['start', 'end'].includes(this.activeGrip.type)) return null;
        const own = findSnap([{ ...ghost, id: '__grip_ghost__' }], this.cursorWorld, tolerance, this.settings.snaps, { reference });
        if (own || !this.settings.snaps.nea) return own;
        const dx = ghost.end.x - ghost.start.x;
        const dy = ghost.end.y - ghost.start.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) return null;
        const reach = Math.max(this.viewport.pixelsToWorld(this.viewport.width + this.viewport.height) * 4, len * 10);
        const ux = dx / len;
        const uy = dy / len;
        const ray = {
            ...ghost,
            id: '__grip_ghost_ext__',
            start: { x: ghost.start.x - ux * reach, y: ghost.start.y - uy * reach },
            end: { x: ghost.end.x + ux * reach, y: ghost.end.y + uy * reach },
        };
        return findSnap([ray], this.cursorWorld, tolerance, { nea: true }, { reference });
    }

    orthoAccepts(reference, point, tolerance) {
        const axisPoint = applyOrtho(reference, this.cursorWorld);
        const horizontal = axisPoint.y === reference.y;
        const off = horizontal ? Math.abs(point.y - reference.y) : Math.abs(point.x - reference.x);
        return off <= tolerance * 1.5;
    }

    // Aquisição por pausa do cursor: parar ~350ms sobre um snap de objeto o transforma em ponto de rastreio.
    scheduleAcquire(objectSnap, tolerance) {
        const acquirable = this.settings.otrack && objectSnap && ['end', 'mid', 'cen', 'gcen', 'qua', 'int'].includes(objectSnap.mode);
        const key = acquirable ? `${objectSnap.mode}:${objectSnap.point.x.toFixed(6)}:${objectSnap.point.y.toFixed(6)}` : null;
        if (key === this.dwell.key) return;
        if (this.dwell.timer) clearTimeout(this.dwell.timer);
        this.dwell = { key, timer: null };
        if (!key) return;
        this.dwell.timer = setTimeout(() => {
            const isPointPrompt = this.pending && ['point', 'pointOrEntity'].includes(this.pending.mode);
            if (this.dwell.key !== key || (!isPointPrompt && !this.activeGrip)) return;
            this.acquireTracking(objectSnap, tolerance);
        }, 350);
    }

    acquireTracking(objectSnap, tolerance = this.viewport.pixelsToWorld(SNAP_PIXELS)) {
        const tp = trackingPointFromSnap(objectSnap);
        if (!tp) return;
        const before = this.tracking.length;
        this.tracking = addTrackingPoint(this.tracking, tp, tolerance);
        if (this.tracking.length !== before) this.invalidate();
    }

    clearTracking() {
        this.tracking = [];
        this.centerHint = null;
        this.trackingLines = [];
        if (this.dwell.timer) clearTimeout(this.dwell.timer);
        this.dwell = { key: null, timer: null };
    }

    hitTest(world, { filter = null } = {}) {
        const tolerance = this.viewport.pixelsToWorld(PICK_PIXELS);
        const spatial = getDocumentSpatialIndex(this.doc);
        const candidates = spatial
            ? spatial.searchRadius(world, tolerance).filter((e) => isEntityEditable(this.doc, e) && (!filter || filter(e)))
            : editableEntities(this.doc).filter((e) => !filter || filter(e));
        let best = null;
        for (let i = candidates.length - 1; i >= 0; i -= 1) {
            const entity = candidates[i];
            let d;
            if (entity.type === 'text') {
                const box = emptyBox();
                textBox(entity).forEach((p) => boxAddPoint(box, p));
                d = pointInBox(world, box) ? 0 : Infinity;
            } else if (entity.type === 'point') {
                d = distance(world, entity.position ?? entity.point);
            } else {
                d = Math.min(...entityCurves(entity).map((c) => distanceToCurve(world, c)));
                if(entity.type==='dimension')for(const text of dimensionGeometry(entity,this.doc.dimStyle).texts){
                    const box=emptyBox();textBox(text).forEach(p=>boxAddPoint(box,p));if(pointInBox(world,box))d=0;
                }
            }
            if (d <= tolerance && (!best || d < best.d)) best = { entity, d };
        }
        return best?.entity ?? null;
    }

    entitiesInWindow(a, b, crossing) {
        const box = emptyBox();
        boxAddPoint(box, a);
        boxAddPoint(box, b);
        const spatial = getDocumentSpatialIndex(this.doc);
        const pool = spatial
            ? spatial.search(box).filter((entity) => isEntityEditable(this.doc, entity))
            : editableEntities(this.doc);
        return pool.filter((entity) => {
            const eb = entityBox(entity);
            if (boxIsEmpty(eb)) return false;
            if (boxContains(box, eb)) return true;
            if (!crossing) return false;
            if (entity.type === 'point') return pointInBox(entity.position ?? entity.point, box);
            return entityCurves(entity).some((c) => curveIntersectsBox(c, box));
        });
    }

    // ------------------------------------------------------------------ alças (grips)

    getSelectionGrips() {
        if (!gripsVisible(this.selection.size)) return [];
        const grips = [];
        for (const id of this.selection) {
            const entity = this.doc.entities.find((e) => e.id === id);
            if (entity && isEntityEditable(this.doc, entity)) {
                grips.push(...getEntityGrips(entity, this.doc.dimStyle));
            }
        }
        return grips;
    }

    updateHoverGrip(screen) {
        if (this.pending || this.activeGrip || this.selection.size === 0) {
            if (this.hoverGrip) {
                this.hoverGrip = null;
                this.invalidate();
            }
            return;
        }
        const grips = this.getSelectionGrips();
        const found = findGripAt(grips, screen, (p) => this.viewport.worldToScreen(p), 8);
        const prevId = this.hoverGrip?.id;
        const newId = found?.id;
        if (prevId !== newId) {
            this.hoverGrip = found;
            this.invalidate();
        }
    }

    startGripDrag(grip) {
        if (!grip) return;
        const entity = this.doc.entities.find((e) => e.id === grip.entityId);
        if (!entity || !isEntityEditable(this.doc, entity)) return;

        this.activeGrip = grip;
        this.gripJustActivated = true;
        this.gripOriginalEntity = JSON.parse(JSON.stringify(entity));
        this.rubber = { from: grip.point, to: grip.point };
        this.preview = [this.gripOriginalEntity];
        // Ponta de linha: campo de comprimento total medido a partir da ponta que fica parada.
        if (entity.type === 'line' && (grip.type === 'start' || grip.type === 'end')) {
            this.openDynInput(lineDynSpec(this, grip.type === 'start' ? entity.end : entity.start));
        }
        this.terminal.setPrompt('** ALÇA ** Ponto de destino [Cancelar]:');
        this.log(`Alça ativa em (${formatNumber(grip.point.x, 2)}, ${formatNumber(grip.point.y, 2)}). Arraste ou clique no novo ponto.`);
        this.updateSnap();
        this.invalidate();
    }

    updateGripDrag() {
        if (!this.activeGrip || !this.gripOriginalEntity) return;
        const cursor = this.effectiveCursor() ?? this.cursorWorld ?? this.activeGrip.point;
        const target = this.dyn ? this.dyn.spec.resolve(cursor) : cursor;
        this.rubber = { from: this.activeGrip.point, to: target };
        const modified = applyGripMove(this.gripOriginalEntity, this.activeGrip, target, this.doc.dimStyle);
        this.preview = [modified];
        this.invalidate();
    }

    finishGripDrag(targetPoint = null) {
        if (!this.activeGrip || !this.gripOriginalEntity) return;
        const cursor = this.effectiveCursor() ?? this.cursorWorld ?? this.activeGrip.point;
        const target = targetPoint ?? (this.dyn ? this.dyn.spec.resolve(cursor) : cursor);
        const modified = applyGripMove(this.gripOriginalEntity, this.activeGrip, target, this.doc.dimStyle);
        const gripId = this.activeGrip.entityId;
        this.closeDynInput();

        this.activeGrip = null;
        this.gripJustActivated = false;
        this.gripOriginalEntity = null;
        this.preview = [];
        this.rubber = null;
        this.terminal.setPrompt('Comando:');

        const nextDoc = updateEntities(this.doc, [gripId], () => modified);
        this.commit('Mover alça', nextDoc);
        this.log('Alça movida.');
        this.selection.add(gripId);
        this.updateSnap();
        this.invalidate();
    }

    cancelGripDrag() {
        if (!this.activeGrip) return;
        this.closeDynInput();
        this.activeGrip = null;
        this.gripJustActivated = false;
        this.gripOriginalEntity = null;
        this.preview = [];
        this.rubber = null;
        this.terminal.setPrompt('Comando:');
        this.log('*Alça cancelada*', 'warn');
        this.updateSnap();
        this.invalidate();
    }

    // ------------------------------------------------------------------ eventos

    bindEvents() {
        const canvas = this.canvas;
        this.pointer = { down: null, button: null, panning: false, last: null, moved: false };

        canvas.addEventListener('contextmenu', (event) => event.preventDefault());

        canvas.addEventListener('pointerdown', (event) => {
            canvas.setPointerCapture(event.pointerId);
            const screen = this.eventScreen(event);
            this.pointer.down = screen;
            this.pointer.button = event.button;
            this.pointer.moved = false;
            this.pointer.last = screen;
            if (event.button === 1 || (event.button === 0 && (this.panActive || event.altKey))) {
                this.pointer.panning = true;
                canvas.classList.add('is-panning');
                event.preventDefault();
            } else if (event.button === 0 && this.activeGrip) {
                // Alça já está ativa; clique de posicionamento tratado no pointerup.
            } else if (event.button === 0 && !this.pending && this.selection.size > 0 && this.hoverGrip) {
                this.startGripDrag(this.hoverGrip);
            } else if (event.button === 0 && !this.window && (!this.pending || ['selection', 'entityOrWindow'].includes(this.pending.mode))) {
                // Sem objeto sob o cursor: arma a janela de seleção já no pressionar, para permitir arrasto.
                const world = this.viewport.screenToWorld(screen);
                if (!this.hitTest(world, { filter: this.pending?.filter })) {
                    // Não desmarca aqui: a janela arrastada soma à seleção. Só um clique sem arrasto no vazio desmarca.
                    this.window = { a: world, b: world, crossing: false, idle: !this.pending, armed: false };
                } else {
                    // Sobre um objeto: clique seleciona o objeto, mas arrastar abre a janela (como no AutoCAD).
                    this.window = { a: world, b: world, crossing: false, idle: !this.pending, armed: false, overEntity: true };
                }
            }
            this.terminal.focus();
        });

        canvas.addEventListener('pointermove', (event) => {
            const screen = this.eventScreen(event);
            this.cursorScreen = screen;
            this.cursorWorld = this.viewport.screenToWorld(screen);
            this.shiftLock = event.shiftKey;
            if (this.collabProvider) {
                this.collabProvider.updateLocalAwareness({
                    cursor: this.cursorWorld,
                    selection: Array.from(this.selection),
                    activeTool: this.pending?.prompt || this.activeCommand || null,
                });
            }
            if (this.pointer.panning && this.pointer.last) {
                this.viewport.pan(screen.x - this.pointer.last.x, screen.y - this.pointer.last.y);
                this.pointer.last = screen;
                this.invalidate();
                return;
            }
            if (this.pointer.down && !this.pointer.moved && distance(screen, this.pointer.down) > DRAG_PIXELS) this.pointer.moved = true;
            if (this.window) {
                this.window.b = this.cursorWorld;
                this.window.crossing = this.cursorWorld.x < this.window.a.x;
            }
            this.updateSnap();
            if (this.activeGrip) {
                this.updateGripDrag();
            } else if (!this.pending && this.selection.size > 0) {
                this.updateHoverGrip(screen);
            } else if (this.hoverGrip) {
                this.hoverGrip = null;
            }
            this.hover = !this.pending || ['selection', 'entity', 'entityOrWindow', 'pointOrEntity'].includes(this.pending.mode) ? this.hitTest(this.cursorWorld, { filter: this.pending?.filter })?.id ?? null : null;
            this.invalidate();
        });

        canvas.addEventListener('pointerup', (event) => {
            const screen = this.eventScreen(event);
            const wasPanning = this.pointer.panning;
            const down = this.pointer.down;
            const moved = this.pointer.moved;
            this.pointer.panning = false;
            this.pointer.down = null;
            canvas.classList.remove('is-panning');
            if (wasPanning) return;
            if (event.button === 2) {
                this.onRightClick();
                return;
            }
            if (event.button !== 0 || !down) return;
            if (this.activeGrip) {
                if (this.gripJustActivated) {
                    this.gripJustActivated = false;
                    if (moved) {
                        this.finishGripDrag();
                    }
                    return;
                }
                this.finishGripDrag();
                return;
            }
            const world = this.viewport.screenToWorld(screen);
            if (this.window) {
                const dragged = distance(screen, down) > CLICK_PIXELS;
                if (this.window.overEntity && !this.window.armed && !dragged) {
                    this.window = null;
                    this.onClick(world, event);
                    return;
                }
                if (this.window.armed) {
                    this.finishWindow(world, event);
                } else {
                    // Soltar o botão (com ou sem arrasto) mantém a janela aberta até o próximo clique, como no BricsCAD.
                    this.window.armed = true;
                }
                return;
            }
            this.onClick(world, event);
        });

        canvas.addEventListener('pointerleave', (event) => {
            // Passar sobre os campos de medida não é sair do desenho; sem isso o prévio some e volta (pisca).
            if (this.dyn?.box.contains(event.relatedTarget)) return;
            this.clearCursor();
        });

        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            const screen = this.eventScreen(event);
            this.viewport.zoomAt(screen, wheelZoomFactor(event));
            this.cursorWorld = this.viewport.screenToWorld(screen);
            this.updateSnap();
            this.invalidate();
        }, { passive: false });

        canvas.addEventListener('dblclick', (event) => {
            if (event.button === 1) {
                this.zoomExtents();
            } else if (event.button === 0) {
                const screen = this.eventScreen(event);
                const world = this.viewport.screenToWorld(screen);
                const hit = this.hitTest(world);
                if (hit && hit.type === 'text') {
                    this.openTextEditor(hit);
                } else if (this.selection.size === 1) {
                    const selId = Array.from(this.selection)[0];
                    const sel = this.doc.entities.find((e) => e.id === selId);
                    if (sel && sel.type === 'text') {
                        this.openTextEditor(sel);
                    }
                }
            }
        });

        canvas.addEventListener('auxclick', (event) => {
            if (event.button === 1 && event.detail === 2) this.zoomExtents();
        });

        this.terminal.onSubmit = (value) => this.onTerminalSubmit(value);
        this.terminal.acceptsSpaces = () => this.pending?.mode === 'string';
        this.terminal.onCancel = () => this.cancel();
        this.terminal.getSuggestions = (value) => (this.pending ? [] : suggestCommands(value));
        this.terminal.onTab = () => (this.dyn && !this.terminal.value() ? this.focusDynField(this.dyn.active) : this.cycleSnapPriority());

        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', (event) => { if (event.key === 'Shift') this.setShiftLock(true); this.onKeyDown(event); });
            window.addEventListener('keyup', (event) => { if (event.key === 'Shift') this.setShiftLock(false); });
            window.addEventListener('blur', () => this.setShiftLock(false));
            window.addEventListener('resize', () => this.resize());
            window.addEventListener('load', () => this.resize());
        }
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(() => this.resize());
            observer.observe(this.stage);
            if (this.stage.parentElement) observer.observe(this.stage.parentElement);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('fullscreenchange', () => this.resize());
        }

        canvas.addEventListener('dragover', (event) => {
            event.preventDefault();
        });
        canvas.addEventListener('drop', async (event) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer?.files || []);
            if (files.length) await this.openFiles(files);
        });
    }

    // Abre vários arquivos em sequência, cada um na sua aba. As chamadas entram numa fila
    // para que dois lotes (arraste + Ctrl+O, ou eventos do desktop) não disputem a mesma aba.
    openFiles(files, options = {}) {
        const list = Array.from(files || []).filter(Boolean);
        const run = async () => {
            for (const file of list) {
                try {
                    await this.openFile(file, options);
                } catch (err) {
                    this.log(`Falha ao abrir "${file.name}": ${err?.message || err}`, 'error');
                }
            }
        };
        this.openQueue = (this.openQueue || Promise.resolve()).then(run, run);
        return this.openQueue;
    }

    async openFile(file, { openInNewTab = false, filePath = null } = {}) {
        if (!file) return;
        const resolvedPath = filePath || file.filePath || file.path || null;
        if (!kindOf(file.name) && !/^image\//.test(file.type) && file.type !== 'application/pdf') {
            this.log('Formato não suportado pelo CAD.', 'warn');
            return;
        }
        // Abrir arquivo encerra o comando em curso: com o desenho atual vazio o arquivo entra
        // na mesma aba (sem setSession) e o retângulo pela metade seguia no desenho aberto.
        if (this.pending) this.cancel();
        // Imagem raster entra no desenho atual como referência (IMAGEATTACH), como no BricsCAD,
        // e não abre aba nova.
        if (kindOf(file.name) === 'image' || (/^image\/(?:png|jpeg|jpg|gif|bmp|webp)/i.test(file.type) && !/\.(?:dwg|dxf|svg)$/i.test(file.name))) {
            this.pendingDropFile = file;
            await this.runCommand('IMAGEATTACH');
            return;
        }
        if (this.tabs && typeof this.tabs.findExistingTab === 'function') {
            const existing = this.tabs.findExistingTab({ name: file.name, filePath: resolvedPath });
            if (existing) {
                this.tabs.activate(existing.id);
                this.log(`O arquivo "${file.name}" já está aberto em uma aba. Alternando para a aba existente.`, 'info');
                return;
            }
        }
        if (openInNewTab || (this.tabs && (this.doc.entities.length > 0 || this.history.canUndo()))) {
            if (this.tabs && typeof this.tabs.add === 'function') {
                this.tabs.add();
            }
        }
        if (this.onDropFile && (await this.onDropFile(file))) return;

        const kind = kindOf(file.name);
        if (kind === 'dwg' || /\.dwg$/i.test(file.name)) {
            if (resolvedPath) file.filePath = resolvedPath;
            await this.importDwgFile(file);
            return;
        }
        if (kind === 'dxf' || /\.dxf$/i.test(file.name)) {
            const text = await file.text();
            await this.importDxfText(text, file.name, { filePath: resolvedPath });
            if (resolvedPath && this.doc) this.doc.filePath = resolvedPath;
            return;
        }
        if (kind === 'pdf' || /\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
            this.pendingDropFile = file;
            await this.runCommand('PDFIMPORT');
            return;
        }
        if (kind === 'svg' || /\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
            const text = await file.text();
            await this.importSvgText(text, file.name);
            if (resolvedPath && this.doc) this.doc.filePath = resolvedPath;
            return;
        }
        if (kind === 'eps' || /\.eps$/i.test(file.name)) {
            await this.importEpsBuffer(await file.arrayBuffer(), file.name, { filePath: resolvedPath });
            return;
        }
        if (kind === 'cdr' || /\.cdr$/i.test(file.name)) {
            await this.importCdrBuffer(await file.arrayBuffer(), file.name);
            if (resolvedPath && this.doc) this.doc.filePath = resolvedPath;
            return;
        }
        if (kind === 'elmt' || /\.elmt$/i.test(file.name)) {
            const text = await file.text();
            await this.importElmtText(text, file.name);
            if (resolvedPath && this.doc) this.doc.filePath = resolvedPath;
            return;
        }
        if (kind === 'qet' || /\.qet$/i.test(file.name)) {
            const text = await file.text();
            await this.importQetText(text, file.name);
            if (resolvedPath && this.doc) this.doc.filePath = resolvedPath;
            return;
        }
        if (kind === 'lxds' || /\.lxds$/i.test(file.name)) {
            await this.importLxdsBuffer(await file.arrayBuffer(), file.name);
            if (resolvedPath && this.doc) this.doc.filePath = resolvedPath;
            return;
        }
        const buffer = await file.arrayBuffer();
        if (looksLikeLxds(new Uint8Array(buffer.slice(0, 4)))) {
            await this.importLxdsBuffer(buffer, file.name);
            if (resolvedPath && this.doc) this.doc.filePath = resolvedPath;
            return;
        }
        const text = new TextDecoder('utf-8').decode(buffer);
        await this.importDxfText(text, file.name, { filePath: resolvedPath });
    }

    eventScreen(event) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    onKeyDown(event) {
        const inTerminal = this.terminal.isFocused();
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        const inInputField = !inTerminal && Boolean(
            active && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))
        );
        // Ctrl+W fecha a aba e Ctrl+F4 fecha o Traço, também com o foco num campo.
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && this.tabs
            && (event.key?.toLowerCase() === 'w' || event.key === 'F4')) {
            event.preventDefault();
            if (event.key === 'F4') this.tabs.requestQuit?.();
            else this.tabs.closeCurrent?.();
            return;
        }
        // Ctrl+Tab / Ctrl+Shift+Tab alternam entre os desenhos abertos.
        if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Tab' && this.tabs?.cycle) {
            event.preventDefault();
            this.tabs.cycle(event.shiftKey ? -1 : 1);
            return;
        }
        if (inInputField) {
            if (event.key === 'Escape') {
                active.blur?.();
                this.stage?.focus?.();
            }
            return;
        }
        const key = event.key;
        if (event.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && ['c', 'x', 'v'].includes(key.toLowerCase())) {
            const active = document.activeElement;
            const textField = active?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName);
            // Terminal vazio ocioso pode operar seleção CAD; texto digitado/selecionado e prompts ficam nativos.
            if (textField && (!inTerminal || this.terminal.value() || this.pending?.mode === 'string')) return;
            if (this.running || this.pending) return;
            event.preventDefault();
            this.runCommand({ c: 'COPYCLIP', x: 'CUTCLIP', v: 'PASTECLIP' }[key.toLowerCase()]);
            return;
        }
        if (key === 'F3') { event.preventDefault(); this.toggle('osnap'); return; }
        if (key === 'F7') { event.preventDefault(); this.toggle('grid'); return; }
        if (key === 'F8') { event.preventDefault(); this.toggle('ortho'); return; }
        if (key === 'F10') { event.preventDefault(); this.toggle('polar'); return; }
        if (key === 'F11') { event.preventDefault(); this.toggle('otrack'); return; }
        if (key === 'Escape' && !inTerminal) { this.cancel(); return; }
        if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); this.runCommand('UNDO'); return; }
        if ((event.ctrlKey || event.metaKey) && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && event.shiftKey))) { event.preventDefault(); this.runCommand('REDO'); return; }
        if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') { event.preventDefault(); this.selectAll(); return; }
        if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 's') {
            event.preventDefault();
            if (event.shiftKey) {
                this.runCommand('SAVEAS');
            } else {
                this.runCommand('SAVE');
            }
            return;
        }
        if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'o') { event.preventDefault(); this.runCommand('OPEN'); return; }
        if (key === 'Delete' && !this.pending && !this.activeGrip && this.selection.size > 0) {
            event.preventDefault();
            const ids = [...this.selection];
            this.commit('Apagar', removeEntities(this.doc, ids));
            this.selection.clear();
            this.log(`${ids.length} objeto(s) apagado(s).`);
            return;
        }
        // Com o terminal vazio, número digitado vai para o campo da entrada dinâmica (o Tab do terminal é tratado em onTab).
        if (this.dyn && (!inTerminal || !this.terminal.value()) && !event.ctrlKey && !event.metaKey && !event.altKey && /^[0-9.,\-]$/.test(key)) {
            event.preventDefault();
            this.focusDynField(this.dyn.active, key);
            return;
        }
        if (this.dyn && !inTerminal && key === 'Backspace' && this.dyn.typed.size) {
            event.preventDefault();
            this.focusDynField(this.dyn.active, '\b');
            return;
        }
        if (this.dyn && !inTerminal && key === 'Tab') {
            event.preventDefault();
            this.focusDynField(this.dyn.active + (event.shiftKey ? -1 : 1));
            return;
        }
        // Espaço fora do terminal age como Enter: confirma o prompt ou repete o último comando.
        if (!inTerminal && key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && this.pending?.mode !== 'string') {
            event.preventDefault();
            this.onTerminalSubmit('');
            return;
        }
        if (!inTerminal && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this.terminal.focus();
        }
        if (!inTerminal && key === 'Enter') {
            event.preventDefault();
            this.onTerminalSubmit('');
        }
    }

    // ------------------------------------------------------------------ prompts

    request(mode, prompt, options = {}) {
        if (this.pending) this.pending.reject(new CancelError());
        this.closeDynInput();
        return new Promise((resolve, reject) => {
            this.pending = { mode, prompt, resolve, reject, ...options };
            const dynInput = options.dynInput || (COMMANDS[this.running]?.dimInput ? autoDimSpec(this, this.pending) : null);
            if (dynInput) this.openDynInput(dynInput);
            const suffix = options.defaultValue !== undefined && options.defaultValue !== null ? ` <${typeof options.defaultValue === 'number' ? formatNumber(options.defaultValue, 4) : tr(options.defaultValue)}>` : '';
            this.terminal.setPrompt(`${tr(prompt)}${formatOptions(options.options)}${suffix}:`.replace('::', ':'));
            this.updateSnap();
            this.invalidate();
        });
    }

    resolvePending(value) {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        this.closeDynInput();
        this.snap = null;
        this.window = null;
        this.clearTracking();
        this.terminal.setPrompt('Comando:');
        this.invalidate();
        pending.resolve(value);
    }

    getPoint(prompt, options = {}) {
        return this.request('point', prompt, options);
    }

    getNumber(prompt, options = {}) {
        return this.request('number', prompt, options).then((res) => res.number);
    }

    getString(prompt, options = {}) {
        return this.request('string', prompt, options).then((res) => res.text);
    }

    getKeyword(prompt, keywords, defaultKey = null) {
        const def = keywords.find((k) => k.key === defaultKey);
        return this.request('keyword', prompt, { options: keywords, defaultValue: def?.label }).then((res) => res.option);
    }

    getSelection(prompt, options = {}) {
        if (this.selection.size > 0 && !options.ignorePreselection) {
            const ids = [...this.selection];
            this.log(`${ids.length} objeto(s) já selecionado(s).`);
            return Promise.resolve(ids);
        }
        return this.request('selection', prompt, { ...options, working: new Set() }).then((res) => res.ids);
    }

    getEntity(prompt, options = {}) {
        return this.request('entity', prompt, options).then((res) => (res.enter ? null : res));
    }

    // Aceita clique em objeto (resolve {entity, point}) ou janela/crossing no vazio (resolve {entities, box, crossing}).
    getEntityOrWindow(prompt, options = {}) {
        return this.request('entityOrWindow', prompt, options).then((res) => (res.enter ? null : res));
    }

    // Aceita clique em objeto (resolve {entity, point}) ou ponto livre/digitado (resolve {point}).
    getPointOrEntity(prompt, options = {}) {
        return this.request('pointOrEntity', prompt, options);
    }

    panMode() {
        this.panActive = true;
        this.canvas.classList.add('is-pan-mode');
        return this.request('pan', 'Arraste para deslocar; Enter ou Esc encerra', { allowEnter: true }).finally(() => {
            this.panActive = false;
            this.canvas.classList.remove('is-pan-mode');
        });
    }

    onClick(world, event) {
        const pending = this.pending;
        if (!pending) {
            const hit = this.hitTest(world);
            if (hit) {
                // Ctrl alterna (Cmd no Mac): tira se já estava, põe se não estava.
                if (toggleKey(event) && this.selection.has(hit.id)) this.selection.delete(hit.id);
                else this.selection.add(hit.id);
                this.invalidate();
                this.onChange(this);
            } else {
                if (!toggleKey(event) && this.selection.size > 0) {
                    this.clearSelection();
                }
                this.window = { a: world, b: world, crossing: false, idle: true, armed: true };
            }
            return;
        }
        switch (pending.mode) {
            case 'point': {
                if (pending.snapOverride) {
                    const snap = this.snap;
                    if (!snap) {
                        this.log(pending.snapOverride === 'tan' ? 'Nenhuma tangente possível nesse ponto.' : 'Nenhum ponto de snap nesse lugar.', 'warn');
                        return;
                    }
                    this.lastPoint = snap.point;
                    this.resolvePending({ point: snap.point, snapMode: snap.mode, deferredTangent: snap.deferred ?? null, tangentFrom: snap.tangentFrom ?? null });
                    return;
                }
                const point = this.effectiveCursor() ?? world;
                this.lastPoint = point;
                this.resolvePending({ point });
                return;
            }
            case 'selection': {
                const hit = this.hitTest(world, { filter: pending.filter });
                if (hit) {
                    if (toggleKey(event) && pending.working.has(hit.id)) pending.working.delete(hit.id);
                    else pending.working.add(hit.id);
                    this.selection = new Set(pending.working);
                    this.log(`${pending.working.size} selecionado(s). Enter para confirmar.`, 'echo');
                    this.invalidate();
                } else {
                    this.window = { a: world, b: world, crossing: false, armed: true };
                }
                return;
            }
            case 'entity': {
                const hit = this.hitTest(world, { filter: pending.filter });
                if (!hit) {
                    this.log('Nenhum objeto no ponto clicado.', 'warn');
                    return;
                }
                this.resolvePending({ entity: hit, point: world });
                return;
            }
            case 'entityOrWindow': {
                const hit = this.hitTest(world, { filter: pending.filter });
                if (hit) this.resolvePending({ entity: hit, point: world, shift: event.shiftKey });
                // Sem objeto: a janela já foi armada no pointerdown.
                return;
            }
            case 'pointOrEntity': {
                const hit = this.hitTest(world, { filter: pending.filter });
                if (hit) {
                    // O ponto segue o snap: clicar no extremo de uma linha não pode devolver a mira crua.
                    const point = this.effectiveCursor() ?? world;
                    this.lastPoint = point;
                    this.resolvePending({ entity: hit, point, pickPoint: world });
                    return;
                }
                const point = this.effectiveCursor() ?? world;
                this.lastPoint = point;
                this.resolvePending({ point });
                return;
            }
            case 'number': {
                if (pending.reference) {
                    const point = this.effectiveCursor() ?? world;
                    const value = pending.angle ? radToDeg(angleOf(pending.reference, point)) : distance(pending.reference, point);
                    this.resolvePending({ number: value });
                }
                return;
            }
            default:
                break;
        }
    }

    finishWindow(world, event = {}) {
        const toggle = toggleKey(event);
        const { a, idle } = this.window;
        // Em TRIM/EXTEND a janela é sempre crossing: basta o objeto atravessar o retângulo.
        // Com `directional` (MATCHPROP) vale a regra comum: esquerda→direita janela, direita→esquerda crossing.
        const crossing = world.x < a.x || (this.pending?.mode === 'entityOrWindow' && !this.pending.directional);
        const found = this.entitiesInWindow(a, world, crossing);
        this.window = null;
        if (idle || !this.pending) {
            // A caixa sempre soma à seleção (Ctrl tira); desmarcar tudo é com Esc, como no AutoCAD.
            found.forEach((e) => (toggle && this.selection.has(e.id) ? this.selection.delete(e.id) : this.selection.add(e.id)));
            this.invalidate();
            this.onChange(this);
            return;
        }
        if (this.pending.mode === 'selection') {
            found.forEach((e) => (toggle && this.pending.working.has(e.id) ? this.pending.working.delete(e.id) : this.pending.working.add(e.id)));
            this.selection = new Set(this.pending.working);
            this.log(`${this.pending.working.size} selecionado(s). Enter para confirmar.`, 'echo');
            this.invalidate();
            return;
        }
        if (this.pending.mode === 'entityOrWindow') {
            const filtered = this.pending.filter ? found.filter(this.pending.filter) : found;
            const box = emptyBox();
            boxAddPoint(box, a);
            boxAddPoint(box, world);
            this.resolvePending({ entities: filtered, box, crossing, shift: !!event.shiftKey });
        }
    }

    onRightClick() {
        if (this.window) {
            this.window = null;
            this.invalidate();
            return;
        }
        if (this.activeGrip) {
            this.finishGripDrag();
            return;
        }
        if (this.pending) {
            this.onTerminalSubmit('');
            return;
        }
        if (this.lastCommand) this.runCommand(this.lastCommand);
    }

    onTerminalSubmit(raw) {
        const value = String(raw ?? '').trim();
        if (this.activeGrip) {
            if (!value) {
                this.finishGripDrag();
                return;
            }
            if (/^(c|cancel|cancelar)$/i.test(value)) {
                this.cancelGripDrag();
                return;
            }
            const ref = this.activeGrip.point;
            const parsed = parsePointInput(value, { last: ref, dynamic: true });
            if (parsed?.error) return this.log(parsed.error, 'error');
            if (parsed?.point) {
                this.finishGripDrag(parsed.point);
                return;
            }
            const number = parseNumberInput(value);
            if (number !== null) {
                const cursor = this.effectiveCursor() ?? this.cursorWorld ?? ref;
                const angle = angleOf(ref, cursor);
                const point = { x: ref.x + Math.cos(angle) * number, y: ref.y + Math.sin(angle) * number };
                this.finishGripDrag(point);
                return;
            }
            return this.log('Entrada inválida. Use X,Y, @dX,dY, distância ou clique.', 'warn');
        }
        const pending = this.pending;
        if (!pending) {
            if (!value) {
                if (this.lastCommand) this.runCommand(this.lastCommand);
                return;
            }
            const { name, args } = splitCommandLine(value);
            this.runCommand(name, args);
            return;
        }
        if (!value && this.dyn && Object.keys(this.dyn.spec.locked).length) return this.commitDynInput();
        if (value) this.terminal.echo(pending.prompt, value);
        switch (pending.mode) {
            case 'point':
            case 'pointOrEntity':
                return this.submitPoint(pending, value);
            case 'number':
                return this.submitNumber(pending, value);
            case 'string':
                if (!value && pending.defaultValue !== undefined) return this.resolvePending({ text: pending.defaultValue });
                return this.resolvePending({ text: value });
            case 'keyword': {
                if (!value) {
                    const def = pending.options.find((o) => o.label === pending.defaultValue);
                    if (def) return this.resolvePending({ option: def });
                    return this.log('Informe uma opção.', 'warn');
                }
                const option = matchKeyword(value, pending.options);
                if (!option) return this.log('Opção inválida.', 'warn');
                return this.resolvePending({ option });
            }
            case 'selection': {
                if (!value) {
                    const ids = [...pending.working];
                    if (ids.length === 0 && !pending.allowEmpty) return this.log('Nada selecionado.', 'warn');
                    this.selection = new Set();
                    return this.resolvePending({ ids });
                }
                if (/^(all|tudo|todos)$/i.test(value)) {
                    editableEntities(this.doc).forEach((e) => pending.working.add(e.id));
                    this.selection = new Set(pending.working);
                    this.invalidate();
                    return this.log(`${pending.working.size} selecionado(s). Enter para confirmar.`, 'echo');
                }
                return this.log('Clique nos objetos, ALL para todos, Enter para confirmar.', 'warn');
            }
            case 'entity':
            case 'entityOrWindow': {
                if (!value && pending.defaultValue && pending.options) {
                    const def = pending.options.find((o) => o.label.toLowerCase() === pending.defaultValue.toLowerCase() || o.key.toLowerCase() === pending.defaultValue.toLowerCase());
                    if (def) return this.resolvePending({ keyword: def.key });
                }
                if (!value && pending.allowEnter) return this.resolvePending({ enter: true });
                if (pending.options) {
                    const option = matchKeyword(value, pending.options);
                    if (option) return this.resolvePending({ keyword: option.key });
                }
                if (pending.allowNumber) {
                    const number = parseNumberInput(value);
                    if (number !== null) return this.resolvePending({ number });
                }
                return this.log('Clique em um objeto.', 'warn');
            }
            case 'pan':
                return this.resolvePending({ enter: true });
            default:
                return null;
        }
    }

    submitPoint(pending, value) {
        if (!value) {
            if (pending.defaultValue !== undefined && pending.allowNumber) return this.resolvePending({ number: pending.defaultValue });
            if (pending.allowEnter !== false) return this.resolvePending({ enter: true });
            return this.log('Informe um ponto.', 'warn');
        }
        if (pending.options) {
            const option = matchKeyword(value, pending.options);
            if (option) return this.resolvePending({ keyword: option.key });
        }
        const override = parseSnapOverride(value);
        if (override) {
            pending.snapOverride = override;
            this.closeDynInput();
            this.terminal.setPrompt(tr(SNAP_OVERRIDE_PROMPTS[override]));
            this.updateSnap();
            this.invalidate();
            return null;
        }
        const parsed = parsePointInput(value, { last: pending.reference ?? this.lastPoint, dynamic: Boolean(pending.reference) });
        if (parsed?.error) return this.log(parsed.error, 'error');
        if (parsed?.point) {
            this.lastPoint = parsed.point;
            return this.resolvePending({ point: parsed.point });
        }
        const number = parseNumberInput(value);
        if (number !== null) {
            if (pending.allowNumber) return this.resolvePending({ number });
            // Entrada direta de distância: usa a direção do cursor a partir da referência.
            if (pending.reference && this.cursorWorld) {
                const cursor = this.effectiveCursor();
                const angle = angleOf(pending.reference, cursor);
                const point = { x: pending.reference.x + Math.cos(angle) * number, y: pending.reference.y + Math.sin(angle) * number };
                this.lastPoint = point;
                return this.resolvePending({ point });
            }
        }
        return this.log('Entrada inválida. Use X,Y  @dX,dY  @dist<ângulo ou clique.', 'warn');
    }

    submitNumber(pending, value) {
        if (!value) {
            if (pending.defaultValue !== undefined) return this.resolvePending({ number: pending.defaultValue });
            return this.log('Informe um valor.', 'warn');
        }
        const number = parseNumberInput(value);
        if (number === null) return this.log('Número inválido.', 'warn');
        return this.resolvePending({ number });
    }

    cancel() {
        this.window = null;
        if (this.activeGrip) {
            this.cancelGripDrag();
            return;
        }
        if (this.pending) {
            const pending = this.pending;
            this.pending = null;
            this.closeDynInput();
            this.terminal.setPrompt('Comando:');
            this.log('*Cancelado*', 'warn');
            this.clearTracking();
            pending.reject(new CancelError());
        } else if (this.selection.size > 0) {
            this.selection.clear();
            this.onChange(this);
        }
        this.snap = null;
        this.preview = [];
        this.invalidate();
    }

    cycleSnapPriority() {
        // Tab alterna o snap ativo entre os candidatos do modo atual (versão simples: alterna END/MID/CEN/INT).
        const order = ['end', 'mid', 'cen', 'gcen', 'int', 'per', 'qua', 'nea'];
        const active = order.filter((k) => this.settings.snaps[k]);
        if (active.length <= 1) return;
        const current = this.snap?.mode ?? active[0];
        const next = active[(active.indexOf(current) + 1) % active.length];
        this.settings.snaps = Object.fromEntries(order.map((k) => [k, k === next]));
        this.updateSnap();
        this.invalidate();
        setTimeout(() => {
            this.settings.snaps = Object.fromEntries(order.map((k) => [k, active.includes(k)]));
        }, 0);
    }

    // ------------------------------------------------------------------ comandos

    async runCommand(name, args = []) {
        if (this.activeGrip) {
            this.cancelGripDrag();
        }
        const command = resolveCommand(name);
        if (!command) {
            this.log(`Comando desconhecido: ${name}`, 'error');
            return;
        }
        if (this.running) {
            this.cancel();
            await Promise.resolve();
        }
        this.terminal.log(`Comando: ${command.name}`, 'command');
        this.lastCommand = command.name;
        this.running = command.name;
        // Painel Propriedades passa a mostrar cor/tipo/espessura do objeto a desenhar.
        if (DRAW_COMMANDS.has(command.name)) this.onChange(this);
        try {
            await command.run(this, args);
        } catch (error) {
            if (!(error instanceof CancelError)) {
                console.error(error);
                this.log(`Erro em ${command.name}: ${error.message}`, 'error');
            }
        } finally {
            this.running = null;
            this.pending = null;
            this.preview = [];
            this.window = null;
            this.terminal.setPrompt('Comando:');
            this.invalidate();
            this.onChange(this);
        }
    }

    // ------------------------------------------------------------------ vista

    zoomExtents({ includeOrigin = false } = {}) {
        this.pushZoom();
        const box = emptyBox();
        visibleEntities(this.doc).forEach((e) => {
            if (e.construction) return; // XLINE/RAY são infinitas
            const b = entityBox(e);
            if (!boxIsEmpty(b)) {
                boxAddPoint(box, { x: b.minX, y: b.minY });
                boxAddPoint(box, { x: b.maxX, y: b.maxY });
            }
        });
        // Enquadramento opcional do referencial; ZE ajusta somente o desenho.
        if (includeOrigin && !boxIsEmpty(box)) boxAddPoint(box, { x: 0, y: 0 });
        this.viewport.zoomToBox(box);
        this.invalidate();
    }

    zoomToBox(box) {
        this.pushZoom();
        this.viewport.zoomToBox(box);
        this.invalidate();
    }

    zoomBy(factor) {
        this.pushZoom();
        this.viewport.zoomAt({ x: this.viewport.width / 2, y: this.viewport.height / 2 }, factor);
        this.invalidate();
    }

    pushZoom() {
        this.zoomStack.push({ scale: this.viewport.scale, originX: this.viewport.originX, originY: this.viewport.originY });
        if (this.zoomStack.length > 20) this.zoomStack.shift();
    }

    zoomPrevious() {
        const prev = this.zoomStack.pop();
        if (!prev) return this.log('Sem vista anterior.', 'warn');
        Object.assign(this.viewport, prev);
        this.invalidate();
        return null;
    }

    // ------------------------------------------------------------------ arquivos

    pickFiles(accept) {
        return new Promise((resolve) => {
            const input = this.fileInput;
            if (!input) return resolve([]);
            input.accept = accept;
            input.multiple = true;
            input.value = '';
            const onChange = () => {
                input.removeEventListener('change', onChange);
                input.multiple = false;
                resolve(Array.from(input.files || []));
            };
            input.addEventListener('change', onChange);
            input.click();
            return null;
        });
    }

    pickFile(accept) {
        if (this.pendingDropFile) {
            const file = this.pendingDropFile;
            this.pendingDropFile = null;
            return Promise.resolve(file);
        }
        return new Promise((resolve) => {
            const input = this.fileInput;
            if (!input) return resolve(null);
            input.accept = accept;
            input.value = '';
            const onChange = () => {
                input.removeEventListener('change', onChange);
                resolve(input.files?.[0] ?? null);
            };
            input.addEventListener('change', onChange);
            input.click();
            return null;
        });
    }

    downloadFile(content, name, mime = 'application/octet-stream') {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        usage('export_success');
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    downloadText(text, name) {
        this.downloadFile(text, name, 'application/dxf');
    }

    async importLxdsBuffer(buffer, name = 'desenho.lxds') {
        let result;
        try {
            result = await lxdsToEntities(buffer, { name, blocks: true, leads: true });
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao ler .lxds: ${error.message}`, 'error');
            return null;
        }
        if (result.entities.length === 0) {
            usage('import_failure');
            this.log('Nenhuma geometria reconhecida no arquivo .lxds.', 'warn');
            return null;
        }
        const doc = { ...createDocument(), layers: result.layers, blocks: result.blocks ?? {}, entities: [], name: result.name, sourceFormat: 'lxds' };
        this.loadDocument(addEntities(doc, result.entities));
        usage('import_success');
        this.resize();
        this.zoomExtents();
        const s = result.stats;
        const origem = result.application ? ` (${result.application})` : '';
        this.log(`Aberto ${name}${origem}: ${result.entities.length} entidades — ${s.polylines} polilinhas (${s.arcs} arcos), ${s.circles} círculos, ${s.lines} linhas.`);
        if (s.parts > 0) {
            this.log(`${s.parts} peça(s) do nest abertas como bloco (${Object.keys(result.blocks).length} definição(ões)); use EXPLODE para editar os contornos.`);
        }
        if (s.leadsIn + s.leadsOut > 0) {
            this.log(`${s.leadsIn} entradas e ${s.leadsOut} saídas do CypCut no layer ${LXDS_LEAD_LAYER}, desligado: ligue o layer para conferir.`);
        }
        const kerf = Object.entries(s.kerf || {});
        if (kerf.length > 0) {
            const detail = kerf.map(([v, c]) => `${Number(v).toLocaleString('pt-BR')} mm em ${c}`).join(', ');
            this.log(`Compensação de kerf gravada no arquivo: ${detail} contorno(s).`);
        }
        if (s.travel > 0) {
            this.log(`${s.travel} deslocamentos do flycut ficaram no layer ${LXDS_TRAVEL_LAYER}, desligado: o laser não corta esse caminho.`);
        }
        const skipped = Object.entries(s.skipped || {});
        if (skipped.length > 0) {
            const total = skipped.reduce((n, [, c]) => n + c, 0);
            const detail = skipped.map(([cls, c]) => `${c} ${cls}`).join(', ');
            this.log(`⚠️ ${total} forma(s) do .lxds não foram importadas (${detail}). Confira no CypCut se fazem parte do corte.`, 'warn');
        }
        this.log('⚠️ Visualização de arquivo .lxds é experimental (engenharia reversa). Confira todas as medidas antes de enviar para corte.', 'warn');
        return result;
    }

    async importDwgFile(file) {
        const resolvedPath = file.filePath || file.path || null;
        if (this.tabs && typeof this.tabs.findExistingTab === 'function') {
            const existing = this.tabs.findExistingTab({ name: file.name, filePath: resolvedPath });
            if (existing) {
                const doc = this.tabs.getTabDoc?.(existing);
                if (doc && doc.entities?.length > 0) {
                    this.tabs.activate(existing.id);
                    this.log(`O arquivo "${file.name}" já está aberto em uma aba. Alternando para a aba existente.`, 'info');
                    return true;
                }
            }
        }
        if (this.dwgImportBusy) {
            this.log('Já existe uma leitura DWG em andamento.', 'error');
            throw new Error('Já existe uma leitura DWG em andamento.');
        }
        this.dwgImportBusy = true;
        try {
            this.log(`Lendo ${file.name} nativamente…`);
            const buffer = await file.arrayBuffer();
            let doc = null;
            try {
                const { dwgToDocument } = await import('./dwg.js');
                doc = await dwgToDocument(buffer, { name: file.name, filePath: resolvedPath });
            } catch (nativeErr) {
                console.warn('[Traço CAD] Falha na leitura nativa DWG, testando fallback...', nativeErr);
                let text = null;
                if (window.desktopBridge && typeof window.desktopBridge.convertDwg === 'function') {
                    text = await window.desktopBridge.convertDwg(resolvedPath, buffer);
                } else if (this.root?.dataset?.dwgUrl) {
                    const { convertDwg } = await import('./dwg.js');
                    text = await convertDwg(file, this.root.dataset.dwgUrl);
                }
                if (!text) throw nativeErr;
                const { parseDxf } = await import('./dxf.js');
                const parsed = parseDxf(text, { preserveBlocks: true, preserveDimensions: true });
                doc = addEntities({
                    ...createDocument(),
                    layers: parsed.layers,
                    blocks: parsed.blocks ?? {},
                    entities: [],
                    units: parsed.units,
                    name: file.name,
                    filePath: resolvedPath,
                    sourceFormat: 'dwg',
                    ...(parsed.view ? { view: parsed.view } : {}),
                }, parsed.entities);
            }

            if (!doc || !doc.entities || !doc.entities.length) {
                throw new Error('O DWG não contém entidades 2D suportadas pelo editor.');
            }

            if (this.tabs && this.doc?.entities?.length > 0) this.tabs.add();
            this.loadDocument(doc);
            usage('import_success');
            this.resize();
            if (doc.view && this.viewport.setView(doc.view)) {
                this.invalidate();
            } else {
                this.zoomExtents();
            }
            this.log(`Aberto ${file.name}: ${doc.entities.length} entidades, ${doc.layers.length} layers.`);
            return true;
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao abrir DWG: ${error.message}`, 'error');
            this.showError({
                title: 'Falha ao abrir DWG',
                fileName: file.name,
                message: 'Não foi possível carregar o arquivo DWG nativamente.',
                details: error.message,
            });
            throw error;
        } finally {
            this.dwgImportBusy = false;
        }
    }

    async importPdfFile(file, options = {}) {
        if (this.tabs && this.doc?.entities?.length > 0) this.tabs.add();
        this.pendingDropFile = file;
        await this.runCommand('PDFIMPORT');
    }

    async importSvgText(text, name = 'desenho.svg') {
        let result;
        try {
            const { svgToEntities } = await import('./svg.js');
            result = svgToEntities(text);
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao importar SVG: ${error.message}`, 'error');
            return;
        }
        if (!result.entities.length) {
            usage('import_failure');
            this.log('O arquivo SVG não contém vetores suportados para conversão.', 'warn');
            return;
        }
        const doc = { ...createDocument(), layers: result.layers, entities: [], units: 'mm', name: name.replace(/\.svg$/i, '.dxf') };
        this.loadDocument(addEntities(doc, result.entities));
        usage('import_success');
        this.resize();
        this.zoomExtents();
        this.log(`Importado SVG ${name}: ${result.entities.length} entidades vetoriais prontas para edição.`);
    }

    // EPS do CorelDRAW: import-eps.js converte o corpo da página em DXF (LINE/ARC,
    // Bézier em biarcos) e o resto segue o caminho do DXF.
    async importEpsBuffer(buffer, name = 'desenho.eps', { filePath = null } = {}) {
        let dxf;
        try {
            const { epsToDxfText } = await import('./import-eps.js');
            dxf = epsToDxfText(buffer);
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao importar EPS: ${error.message}`, 'error');
            return;
        }
        await this.importDxfText(dxf, name.replace(/\.eps$/i, '.dxf'), { filePath });
    }

    async importCdrBuffer(buffer, name = 'desenho.cdr') {
        let doc;
        try {
            const { cdrToDocument } = await import('./cdr.js');
            this.log(`Processando contêiner CorelDRAW (${name})…`);
            const loaded = await cdrToDocument(buffer, { name });
            doc = { ...createDocument(), ...loaded };
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao abrir CorelDRAW: ${error.message}`, 'error');
            return;
        }
        this.loadDocument(doc);
        usage('import_success');
        this.resize();
        this.zoomExtents();
        this.log(`Aberto ${name} em modo de visualização e medição (${doc.stats?.format || 'CorelDRAW'}). Utilize ferramentas de cota ou desenhe vetores por cima.`);
    }

    async importElmtText(text, name = 'elemento.elmt') {
        let doc;
        try {
            const { elmtToDocument } = await import('./elmt.js');
            doc = elmtToDocument(text, { name });
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao abrir elemento QElectroTech: ${error.message}`, 'error');
            return;
        }
        this.loadDocument(doc);
        usage('import_success');
        this.resize();
        this.zoomExtents();
        const termCount = (doc.entities || []).filter((e) => e.type === 'terminal').length;
        this.log(`Aberto elemento QElectroTech ${name}: ${doc.entities.length} entidades (${termCount} terminal/terminais).`);
    }

    async importQetText(text, name = 'projeto.qet') {
        let docs;
        try {
            const { qetToDocuments } = await import('./qet.js');
            docs = qetToDocuments(text, { name });
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao abrir projeto QElectroTech: ${error.message}`, 'error');
            return;
        }
        if (!docs.length) {
            usage('import_failure');
            this.log('O projeto QElectroTech não contém folhas válidas.', 'warn');
            return;
        }

        // Carrega a primeira folha no documento ativo
        this.loadDocument(docs[0]);
        usage('import_success');
        this.resize();
        this.zoomExtents();

        // Se houver múltiplas folhas e o TabManager estiver disponível, abre as demais abas
        if (this.tabs && docs.length > 1) {
            for (let i = 1; i < docs.length; i += 1) {
                this.tabs.add(docs[i]);
            }
            if (this.tabs.tabs[0]) {
                this.tabs.activate(this.tabs.tabs[0].id);
            }
        }

        const totalComponents = (docs[0].entities || []).filter((e) => e.layer === 'QET_COMPONENTES').length;
        const totalWires = (docs[0].entities || []).filter((e) => e.layer === 'QET_CONDUTORES').length;
        this.log(`Projeto QElectroTech ${name} aberto: ${docs.length} folha(s), ${totalComponents} componentes e ${totalWires} condutores.`);
    }

    async importDxfText(text, name = 'desenho.dxf', { filePath = null } = {}) {
        // Não interpretar um programa/arquivo desconhecido como desenho vazio nem apagar o atual.
        if (!/(?:^|\r?\n)[\s\uFEFF]*0[ \t]*\r?\n[ \t]*SECTION[ \t]*(?:\r?\n|$)/i.test(String(text))) {
            usage('import_failure');
            this.log('Arquivo sem estrutura DXF válida.', 'warn');
            return;
        }
        let parsed;
        try {
            parsed = parseDxf(text,{preserveBlocks:true,preserveDimensions:true,dimensionColor:1});
        } catch (error) {
            usage('import_failure');
            this.log(`Falha ao ler DXF: ${error.message}`, 'error');
            return;
        }
        const doc = {
            ...createDocument(),
            layers: parsed.layers,
            blocks: parsed.blocks ?? {},
            entities: [],
            units: parsed.units,
            name,
            filePath: filePath || null,
            ...(parsed.view ? { view: parsed.view } : {}),
        };
        this.loadDocument(addEntities(doc, parsed.entities));
        this.setSourceFile?.(name, text);
        usage('import_success');
        // Sincroniza o palco antes de ajustar: se o canvas ainda estiver com a medida
        // anterior (painel abrindo, lista do laser renderizando), o ajuste sai errado.
        this.resize();
        if (parsed.view && this.viewport.setView(parsed.view)) {
            this.invalidate();
        } else {
            this.zoomExtents();
        }
        this.log(`Aberto ${name}: ${parsed.entities.length} entidades, ${parsed.layers.length} layers.`);
    }

    snapModes() {
        return SNAP_MODES;
    }

    dimensionGeometry(entity) {
        return dimensionGeometry(entity, this.doc.dimStyle);
    }

    commands() {
        return COMMANDS;
    }

    colorOf(entity) {
        return entityColor(entity, this.doc);
    }

    layerColor(layer) {
        return aciToHex(layer.color);
    }

    isEditable(entity) {
        return isEntityEditable(this.doc, entity);
    }

    openTextEditor(entity) {
        return openInlineTextEditor(this, entity);
    }
}

function safePreview(fn, cursor) {
    try {
        return fn(cursor) ?? [];
    } catch (error) {
        return [];
    }
}
