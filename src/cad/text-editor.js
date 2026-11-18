import { attachLocalFontPicker } from './local-font-picker.js';
import { FONT_FAMILIES, canvasFont, fontEm, LINE_SPACING } from './fonts.js';
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
    overlay.className = 'cad-text-editor-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
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
                        <label class="cad-text-editor-label" for="cadTextEditorHeight">Altura do texto (mm)</label>
                        <input id="cadTextEditorHeight" class="cad-text-editor-input" type="number" required step="0.01" min="0.01" value="${heightVal}" />
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorHAlign">Alinhamento horizontal</label>
                        <select id="cadTextEditorHAlign" class="cad-text-editor-select">
                            <option value="left" ${halign === 'left' ? 'selected' : ''}>Esquerda</option>
                            <option value="center" ${halign === 'center' ? 'selected' : ''}>Centro</option>
                            <option value="right" ${halign === 'right' ? 'selected' : ''}>Direita</option>
                        </select>
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorVAlign">Alinhamento vertical</label>
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
                        <label class="cad-text-editor-label" for="cadTextEditorBoxWidth">Largura da caixa (mm)</label>
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

    const save = () => {
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

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            dismiss();
        }
    });

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

    root.appendChild(overlay);
    activeOverlay = overlay;

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
    const height = px + (lineCount - 1) * px * 1.35;
    const valign = entity.valign ?? (entity.attachmentPoint ? 'top' : 'baseline');
    const y = valign === 'top' ? 0 : valign === 'middle' ? -height / 2 : valign === 'bottom' ? -height : -px * .8;
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
    if (!editor?.stage || entity?.type !== 'text') return null;
    if (!isEntityEditable(editor.doc, entity)) {
        editor.log('A camada deste texto está bloqueada para edição.', 'warn');
        return null;
    }
    closeTextEditorModal();
    const originalDoc = editor.doc;
    const root = document.createElement('div');
    root.className = 'cad-inline-text-editor';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Editar texto no desenho');
    root.innerHTML = `<div class="cad-inline-text-toolbar" role="toolbar" aria-label="Formatação do texto">
        <select aria-label="Fonte">${FONT_FAMILIES.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')}</select>
        <input aria-label="Altura do texto" type="number" min="0.001" step="any" required>
        <button type="button" data-action="bold" aria-label="Negrito" title="Negrito"><b>B</b></button>
        <button type="button" data-action="italic" aria-label="Itálico" title="Itálico"><i>I</i></button>
        <button type="button" data-action="advanced" title="Propriedades avançadas" aria-label="Propriedades avançadas">⚙</button>
        <button type="button" data-action="save" title="Confirmar" aria-label="Confirmar texto">✓</button>
        <button type="button" data-action="cancel" title="Cancelar (Esc)" aria-label="Cancelar edição">✕</button>
        </div><div class="cad-inline-text-anchor"><textarea aria-label="Texto no desenho" spellcheck="false"></textarea></div>`;
    const textarea = root.querySelector('textarea');
    const font = root.querySelector('select');
    const size = root.querySelector('input');
    attachLocalFontPicker(font);
    let bold = !!entity.bold, italic = !!entity.italic;
    textarea.value = entity.text ?? '';
    const currentFont = entity.fontFamily || 'Liberation Sans';
    if (!FONT_FAMILIES.includes(currentFont)) {
        const option = document.createElement('option'); option.value = currentFont; option.textContent = currentFont; font.appendChild(option);
    }
    font.value = currentFont;
    size.value = entity.height || 2.5;
    const draft = () => ({ ...entity, text: textarea.value, fontFamily: font.value,
        height: Number.isFinite(Number(size.value)) && Number(size.value) > 0 ? Number(size.value) : (entity.height || 2.5), bold, italic,
        isMText: entity.isMText || textarea.value.includes('\n') || !!entity.boxWidth });
    // Esc descarta com o foco em qualquer lugar (inclusive no desenho); salvar só pelo botão ✓.
    const onEscape = event => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        close();
    };
    const close = () => {
        document.removeEventListener('keydown', onEscape, true);
        root.remove();
        activeInline = null;
        editor.invalidate();
        editor.terminal?.focus?.();
    };
    const update = () => {
        if (editor.doc !== originalDoc || !editor.doc.entities.some(e => e.id === entity.id)) { close(); return; }
        const next = draft();
        const px = next.height * editor.viewport.scale;
        const context = editor.canvas.getContext('2d');
        context.save();
        context.font = canvasFont(next, fontEm(px));
        const width = next.boxWidth > 0 ? next.boxWidth * editor.viewport.scale : Math.max(px, ...next.text.split('\n').map(line => context.measureText(line || ' ').width));
        context.restore();
        // CSS textarea scrollHeight includes word wrapping for MText.
        Object.assign(textarea.style, { fontFamily: next.fontFamily, fontSize: `${fontEm(px)}px`, lineHeight: `${px * LINE_SPACING}px`, fontWeight: bold ? 'bold' : 'normal', fontStyle: italic ? 'italic' : 'normal', textAlign: next.halign || 'left', width: `${width + 2}px`, height: '0px', whiteSpace: next.boxWidth ? 'pre-wrap' : 'pre' });
        const lineCount = Math.max(next.text.split('\n').length, Math.round(textarea.scrollHeight / (px * LINE_SPACING)));
        const g = inlineTextGeometry(next, editor.viewport, width, lineCount);
        const canvasRect = editor.canvas.getBoundingClientRect();
        const stageRect = editor.stage.getBoundingClientRect();
        const x = g.x + canvasRect.left - stageRect.left, y = g.y + canvasRect.top - stageRect.top;
        Object.assign(root.querySelector('.cad-inline-text-anchor').style, { left: `${x}px`, top: `${y}px`, transform: `rotate(${g.rotation}deg)${entity.mirrored ? ' scaleX(-1)' : ''}` });
        Object.assign(textarea.style, { transform: `translate(${g.offsetX}px, ${g.offsetY}px)`, height: `${Math.max(g.height, textarea.scrollHeight)}px` });
        const toolbar = root.querySelector('.cad-inline-text-toolbar');
        toolbar.style.left = `${Math.max(4, Math.min(x, editor.stage.clientWidth - toolbar.offsetWidth - 4))}px`;
        const angle = g.rotation * Math.PI / 180;
        const mirror = entity.mirrored ? -1 : 1;
        const top = Math.min(...[g.offsetX, g.offsetX + width].flatMap(localX =>
            [g.offsetY, g.offsetY + g.height].map(localY => Math.sin(angle) * localX * mirror + Math.cos(angle) * localY)));
        toolbar.style.top = `${Math.max(4, Math.min(y + top - toolbar.offsetHeight - 8, editor.stage.clientHeight - toolbar.offsetHeight - 4))}px`;
        root.querySelector('[data-action="bold"]').setAttribute('aria-pressed', String(bold));
        root.querySelector('[data-action="italic"]').setAttribute('aria-pressed', String(italic));
    };
    const save = () => {
        if (!size.reportValidity()) return;
        if (!isEntityEditable(editor.doc, entity)) { close(); return; }
        const current = editor.doc.entities.find(e => e.id === entity.id);
        if (!current) { close(); return; }
        const next = { ...current, text: textarea.value, height: draft().height, fontFamily: font.value, bold, italic, isMText: draft().isMText };
        editor.commit('Editar Texto', replaceEntities(editor.doc, new Map([[entity.id, next]])));
        editor.selection = new Set([entity.id]);
        close();
    };
    root.addEventListener('keydown', event => {
        event.stopPropagation();
    });
    document.addEventListener('keydown', onEscape, true);
    for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) root.addEventListener(type, e => e.stopPropagation());
    root.addEventListener('input', update);
    root.addEventListener('change', update);
    root.querySelectorAll('button[data-action]').forEach(button => button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'save') save();
        else if (action === 'cancel') close();
        else if (action === 'advanced') { const next = draft(); close(); openTextEditorModal(editor, next); }
        else { if (action === 'bold') bold = !bold; else italic = !italic; update(); textarea.focus(); }
    }));
    editor.stage.appendChild(root);
    activeInline = { editor, entity, update, close };
    update();
    editor.invalidate();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    return root;
}
