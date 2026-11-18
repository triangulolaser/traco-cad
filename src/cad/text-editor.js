import { attachLocalFontPicker } from './local-font-picker.js';
import { FONT_FAMILIES, canvasFont, fontEm, fontFamily, LINE_SPACING, ensureFont } from './fonts.js';
import { addEntities, replaceEntities, isEntityEditable } from './document.js';

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let activeOverlay = null;
let activeInline = null;
let activeOverlayEscape = null;
let activeOnClose = null;

export function closeTextEditorModal() {
    const onClose = activeOnClose;
    activeOnClose = null;
    onClose?.();
    activeInline?.close();
    if (activeOverlayEscape) {
        document.removeEventListener('keydown', activeOverlayEscape, true);
        activeOverlayEscape = null;
    }
    if (activeOverlay) {
        activeOverlay.remove();
        activeOverlay = null;
    }
}

/**
 * Abre o diálogo de edição in-place / modal para uma entidade de texto.
 * Permite alterar conteúdo, tamanho da fonte (altura), alinhamento (halign/valign),
 * família tipográfica, rotação, estilos (negrito/itálico) e largura da caixa (MText).
 *
 * @param {Object} editor Instância do Editor Traço CAD
 * @param {Object} entity Entidade de texto a ser editada
 */
export function openTextEditorModal(editor, source, options = {}) {
    if (!editor || !source || !isTextAnnotation(source)) return null;
    const leader = source.type === 'dimension';
    const entity = leader ? leaderTextDraft(source, editor.doc.dimStyle) : source;

    if (!isEntityEditable(editor.doc, source)) {
        editor.log('A camada deste texto está bloqueada para edição.', 'warn');
        return null;
    }

    closeTextEditorModal();
    activeOnClose = options.onClose;

    const root = editor.stage || (typeof document !== 'undefined' ? document.body : null);
    if (!root) return null;

    const overlay = document.createElement('div');
    overlay.className = 'cad-text-editor-overlay cad-text-editor-inplace';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'false');
    overlay.setAttribute('aria-labelledby', 'cadTextEditorTitle');

    const currentFont = entity.fontFamily || 'Liberation Sans';
    const fontOptions = [...new Set([...FONT_FAMILIES, currentFont])].map((f) =>
        `<option value="${escapeHtml(f)}" ${f === currentFont ? 'selected' : ''}>${escapeHtml(f)}</option>`
    ).join('');

    const halign = entity.halign || 'left';
    const valign = entity.valign || (entity.attachmentPoint ? 'top' : 'baseline');
    const originalHeight = Number.isFinite(entity.height) ? entity.height : 2.5;
    const heightVal = originalHeight.toFixed(2);
    const rotationVal = Number.isFinite(entity.rotation) ? entity.rotation : 0;
    const boxWidthVal = Number.isFinite(entity.boxWidth) && entity.boxWidth > 0 ? entity.boxWidth : '';

    overlay.innerHTML = `
        <div class="cad-text-editor-modal" role="document">
            <div class="cad-text-editor-header">
                <h3 id="cadTextEditorTitle" class="cad-text-editor-title">
                    <i class="bi bi-fonts"></i>
                    <span>${options.create ? (leader ? 'Texto da chamada' : 'Inserir texto') : 'Editar texto'}</span>
                </h3>
                <button type="button" class="cad-text-editor-close" data-action="close" title="Fechar (Esc)" aria-label="Fechar">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cad-text-editor-body">
                <p class="cad-text-editor-help">Escreva o conteúdo e ajuste a aparência. A altura é medida no desenho, em milímetros.</p>
                <div class="cad-text-editor-field">
                    <label class="cad-text-editor-label" for="cadTextEditorValue">Conteúdo do texto</label>
                    <textarea id="cadTextEditorValue" class="cad-text-editor-textarea" rows="3" placeholder="Digite o texto…">${escapeHtml(entity.text ?? '')}</textarea>
                </div>
                <div class="cad-text-editor-grid">
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorFont">Fonte</label>
                        <select id="cadTextEditorFont" class="cad-text-editor-select">
                            ${fontOptions}
                        </select>
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorHeight">Altura (mm)</label>
                        <input id="cadTextEditorHeight" class="cad-text-editor-input" type="number" required step="0.01" min="0.01" value="${heightVal}" />
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorHAlign">Horizontal</label>
                        <select id="cadTextEditorHAlign" class="cad-text-editor-select">
                            <option value="left" ${halign === 'left' ? 'selected' : ''}>Esquerda</option>
                            <option value="center" ${halign === 'center' ? 'selected' : ''}>Centro</option>
                            <option value="right" ${halign === 'right' ? 'selected' : ''}>Direita</option>
                        </select>
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorVAlign">Vertical</label>
                        <select id="cadTextEditorVAlign" class="cad-text-editor-select">
                            <option value="baseline" ${valign === 'baseline' ? 'selected' : ''}>Linha de base</option>
                            <option value="top" ${valign === 'top' ? 'selected' : ''}>Topo</option>
                            <option value="middle" ${valign === 'middle' ? 'selected' : ''}>Meio</option>
                            <option value="bottom" ${valign === 'bottom' ? 'selected' : ''}>Base</option>
                        </select>
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorRotation">Rotação (°)</label>
                        <input id="cadTextEditorRotation" class="cad-text-editor-input" type="number" step="any" value="${rotationVal}" />
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorBoxWidth">Caixa (mm)</label>
                        <input id="cadTextEditorBoxWidth" class="cad-text-editor-input" type="number" step="any" min="0" placeholder="Automática" value="${boxWidthVal}" />
                    </div>
                </div>
                <div class="cad-text-editor-toggles">
                    <label class="cad-text-editor-toggle-label">
                        <input type="checkbox" id="cadTextEditorBold" ${entity.bold ? 'checked' : ''} />
                        <span><strong>Negrito</strong></span>
                    </label>
                    <label class="cad-text-editor-toggle-label">
                        <input type="checkbox" id="cadTextEditorItalic" ${entity.italic ? 'checked' : ''} />
                        <span><em>Itálico</em></span>
                    </label>
                </div>
            </div>
            <div class="cad-text-editor-footer">
                <span class="cad-text-editor-hint">Esc descarta as alterações</span>
                <div class="cad-text-editor-actions">
                    <button type="button" class="cad-btn cad-btn-secondary" data-action="close">
                        Cancelar
                    </button>
                    <button type="button" class="cad-btn cad-btn-primary" data-action="save">
                        <i class="bi bi-check-lg"></i>
                        <span>${options.create ? 'Inserir texto' : 'Salvar alterações'}</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    const textarea = overlay.querySelector('#cadTextEditorValue');
    const fontSelect = overlay.querySelector('#cadTextEditorFont');
    attachLocalFontPicker(fontSelect);
    const heightInput = overlay.querySelector('#cadTextEditorHeight');
    const halignSelect = overlay.querySelector('#cadTextEditorHAlign');
    const valignSelect = overlay.querySelector('#cadTextEditorVAlign');
    const rotationInput = overlay.querySelector('#cadTextEditorRotation');
    const boxWidthInput = overlay.querySelector('#cadTextEditorBoxWidth');
    const boldCheckbox = overlay.querySelector('#cadTextEditorBold');
    const italicCheckbox = overlay.querySelector('#cadTextEditorItalic');

    // Esc descarta com o foco em qualquer lugar; salvar só pelo botão.
    const onEscape = (e) => {
        if (e.key !== 'Escape' || e.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        dismiss();
    };
    const dismiss = () => {
        closeTextEditorModal();
        if (editor.terminal && typeof editor.terminal.focus === 'function') {
            editor.terminal.focus();
        }
    };

    let saving = false;
    const save = async () => {
        if (saving) return;
        saving = true;
        try { await ensureFont({fontFamily: fontSelect.value, bold: boldCheckbox.checked, italic: italicCheckbox.checked}); } catch (error) { saving = false; editor.log(error.message, 'warn'); return; }
        saving = false;
        if (editor.doc !== originalDoc || activeOverlay !== overlay) return;
        if (!heightInput.reportValidity() || !rotationInput.reportValidity() || !boxWidthInput.reportValidity()) return;
        const current = options.create ? source : editor.doc.entities.find(item => item.id === source.id);
        if (!current || !isEntityEditable(editor.doc, current)) { dismiss(); return; }
        const newText = textarea ? textarea.value : (entity.text ?? '');
        const newHeight = heightInput.value === heightVal ? originalHeight : Number(heightInput.value);
        if (!Number.isFinite(newHeight) || newHeight <= 0) return;
        const newRotation = parseFloat(rotationInput?.value) || 0;
        const newFontFamily = fontSelect ? fontSelect.value : (entity.fontFamily || 'Liberation Sans');
        const newHalign = halignSelect ? halignSelect.value : (entity.halign || 'left');
        const newValign = valignSelect ? valignSelect.value : (entity.valign || 'baseline');
        const newBold = boldCheckbox ? boldCheckbox.checked : Boolean(entity.bold);
        const newItalic = italicCheckbox ? italicCheckbox.checked : Boolean(entity.italic);
        const rawBoxWidth = parseFloat(boxWidthInput?.value);
        const newBoxWidth = Number.isFinite(rawBoxWidth) && rawBoxWidth > 0 ? rawBoxWidth : undefined;

        const updated = {
            ...entity,
            ...(!leader ? current : {}),
            text: newText,
            height: newHeight,
            rotation: newRotation,
            fontFamily: newFontFamily,
            halign: newHalign,
            valign: newValign,
            bold: newBold,
            italic: newItalic,
        };

        if (newBoxWidth !== undefined) {
            updated.boxWidth = newBoxWidth;
        } else {
            delete updated.boxWidth;
        }
        if (newText.includes('\n') || newBoxWidth !== undefined) {
            updated.isMText = true;
        }

        const result = leader ? applyLeaderText(current, updated, editor.doc.dimStyle) : updated;
        if (options.create) {
            editor.memory.textHeight = newHeight;
            editor.commit(leader ? 'Chamada' : 'Texto', addEntities(editor.doc, [result]));
        } else {
            editor.commit('Editar Texto', replaceEntities(editor.doc, new Map([[source.id, result]])));
            editor.selection = new Set([source.id]);
        }
        options.onSave?.(result);
        editor.invalidate();
        if (typeof editor.onChange === 'function') {
            editor.onChange(editor);
        }
        editor.log(options.create ? 'Texto inserido.' : 'Texto atualizado.', 'info');
        dismiss();
    };

    overlay.querySelectorAll('[data-action="close"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            dismiss();
        });
    });

    const saveBtn = overlay.querySelector('[data-action="save"]');
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            save();
        });
    }



    // Keep drawing shortcuts and pointer gestures outside the dialog.
    for (const type of ['keydown', 'pointerdown', 'dblclick', 'wheel']) overlay.addEventListener(type, event => event.stopPropagation());
    overlay.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const fields = [...overlay.querySelectorAll('button, input, select, textarea')].filter(el => !el.disabled && !el.closest('[hidden]'));
        const first = fields[0], last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('keydown', onEscape, true);
    activeOverlayEscape = onEscape;

    const anchor = document.createElement('div');
    anchor.className = 'cad-inline-text-anchor';
    anchor.append(textarea);
    overlay.append(anchor);
    overlay.querySelector('.cad-text-editor-body > .cad-text-editor-field')?.remove();
    const originalDoc = editor.doc;
    const update = () => {
        if (!editor.viewport || !editor.canvas) return;
        if (editor.doc !== originalDoc) { dismiss(); return; }
        const next = {...entity, position: entity.position || {x: source.linePoint.x, y: source.linePoint.y + (editor.doc.dimStyle?.textGap ?? .9)},
            text: textarea.value, height: Number(heightInput.value) > 0 ? Number(heightInput.value) : originalHeight,
            fontFamily: fontSelect.value, bold: boldCheckbox.checked, italic: italicCheckbox.checked,
            rotation: Number(rotationInput.value) || 0, halign: halignSelect.value, valign: valignSelect.value,
            boxWidth: Number(boxWidthInput.value) || undefined};
        const px = next.height * editor.viewport.scale;
        const ctx = editor.canvas.getContext('2d');
        ctx.save(); ctx.font = canvasFont(next, fontEm(px));
        const width = next.boxWidth ? next.boxWidth * editor.viewport.scale : Math.max(px, ...next.text.split('\n').map(line => ctx.measureText(line || ' ').width));
        const metrics = ctx.measureText('Hg');
        const ascent = metrics.fontBoundingBoxAscent ?? px;
        const descent = metrics.fontBoundingBoxDescent ?? px * .25;
        const cssBaseline = (px * LINE_SPACING - ascent - descent) / 2 + ascent;
        ctx.restore();
        Object.assign(textarea.style, {fontFamily: fontFamily(next.fontFamily), fontSize: `${fontEm(px)}px`, lineHeight: `${px * LINE_SPACING}px`, fontWeight: next.bold ? 'bold' : 'normal', fontStyle: next.italic ? 'italic' : 'normal', textAlign: next.halign, width: `${width + 3}px`, height: '0px', whiteSpace: next.boxWidth ? 'pre-wrap' : 'pre'});
        const lines = Math.max(next.text.split('\n').length, Math.round(textarea.scrollHeight / (px * LINE_SPACING)));
        const g = inlineTextGeometry(next, editor.viewport, width, lines);
        const cr = editor.canvas.getBoundingClientRect(), sr = root.getBoundingClientRect();
        Object.assign(anchor.style, {left: `${g.x + cr.left - sr.left}px`, top: `${g.y + cr.top - sr.top}px`, transform: `rotate(${g.rotation}deg)${next.mirrored ? ' scaleX(-1)' : ''}`});
        Object.assign(textarea.style, {transform: `translate(${g.offsetX}px, ${g.offsetY + px - cssBaseline}px)`, height: `${Math.max(g.height, textarea.scrollHeight)}px`});
    };
    overlay.addEventListener('input', () => { update(); editor.invalidate(); });
    overlay.addEventListener('change', async () => {
        try { await ensureFont({fontFamily: fontSelect.value, bold: boldCheckbox.checked, italic: italicCheckbox.checked}); update(); editor.invalidate(); }
        catch (error) { editor.log(error.message, 'warn'); }
    });
    root.appendChild(overlay);
    activeOverlay = overlay;
    activeInline = {editor, entity: source, update, close: () => { activeInline = null; editor.invalidate(); }};
    update();
    editor.invalidate();
    ensureFont(entity).then(() => {update(); editor.invalidate();}).catch(error => editor.log(error.message, 'warn'));

    if (textarea && typeof textarea.focus === 'function') {
        textarea.focus();
        if (typeof textarea.setSelectionRange === 'function') {
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    }

    return overlay;
}

export function isTextAnnotation(entity) {
    return entity?.type === 'text' || (entity?.type === 'dimension' && entity.kind === 'leader');
}

function leaderScale(entity, dimStyle = {}) {
    const raw = entity.scale ?? entity.style?.scale ?? dimStyle.scale ?? 1;
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function leaderTextDraft(entity, dimStyle = {}) {
    const style = { ...dimStyle, ...entity.style };
    return { ...entity, type: 'text', text: entity.textOverride ?? '',
        height: (entity.textHeight ?? style.textHeight ?? 2.5) * leaderScale(entity, dimStyle),
        fontFamily: entity.fontFamily ?? style.fontFamily,
        bold: entity.bold ?? style.bold, italic: entity.italic ?? style.italic,
        rotation: entity.textRotation ?? 0 };
}

export function applyLeaderText(entity, draft, dimStyle = {}) {
    return { ...entity, textOverride: draft.text, textHeight: draft.height / leaderScale(entity, dimStyle),
        fontFamily: draft.fontFamily, bold: draft.bold, italic: draft.italic,
        textRotation: draft.rotation, halign: draft.halign, valign: draft.valign,
        boxWidth: draft.boxWidth, isMText: draft.isMText };
}

export function insertTextAnnotation(editor, entity) {
    return new Promise(resolve => {
        const panel = openTextEditorModal(editor, entity, { create: true, onSave: resolve, onClose: () => resolve(null) });
        if (!panel) resolve(null);
    });
}

/** Screen geometry follows the same anchor, baseline and rotation as the canvas. */
export function inlineTextGeometry(entity, viewport, width, lineCount) {
    const anchor = viewport.worldToScreen(entity.position);
    const px = (entity.height || 2.5) * viewport.scale;
    const height = px + (lineCount - 1) * px * LINE_SPACING;
    const valign = entity.valign ?? (entity.attachmentPoint ? 'top' : 'baseline');
    const y = valign === 'top' ? 0 : valign === 'middle' ? -height / 2 : valign === 'bottom' ? -height : -px;
    let x = entity.halign === 'center' ? -width / 2 : entity.halign === 'right' ? -width : 0;
    if (entity.boxWidth > 0) {
        const box = entity.boxWidth * viewport.scale;
        const col = ((entity.attachmentPoint || 1) - 1) % 3;
        x = col === 0 ? 0 : -col * box / 2;
    }
    return { ...anchor, offsetX: x, offsetY: y, px, height, rotation: -(entity.rotation || 0) };
}

export function updateInlineTextEditor(editor) {
    if (activeInline?.editor === editor) activeInline.update();
}

export function inlineTextEntityId(editor) {
    return activeInline?.editor === editor ? activeInline.entity.id : null;
}

/** Edits a private draft; the document/history change only on explicit confirmation. */
export function openInlineTextEditor(editor, entity) {
    return openTextEditorModal(editor, entity);
}
