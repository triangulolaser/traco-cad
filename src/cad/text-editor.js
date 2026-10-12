import { FONT_FAMILIES } from './fonts.js';
import { replaceEntities, isEntityEditable } from './document.js';

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let activeOverlay = null;

export function closeTextEditorModal() {
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
export function openTextEditorModal(editor, entity) {
    if (!editor || !entity || entity.type !== 'text') return null;

    if (!isEntityEditable(editor.doc, entity)) {
        editor.log('A camada deste texto está bloqueada para edição.', 'warn');
        return null;
    }

    closeTextEditorModal();

    const root = editor.stage || (typeof document !== 'undefined' ? document.body : null);
    if (!root) return null;

    const overlay = document.createElement('div');
    overlay.className = 'cad-text-editor-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cadTextEditorTitle');

    const currentFont = entity.fontFamily || 'Liberation Sans';
    const fontOptions = FONT_FAMILIES.map((f) =>
        `<option value="${escapeHtml(f)}" ${f === currentFont ? 'selected' : ''}>${escapeHtml(f)}</option>`
    ).join('');

    const halign = entity.halign || 'left';
    const valign = entity.valign || (entity.attachmentPoint ? 'top' : 'baseline');
    const heightVal = Number.isFinite(entity.height) ? entity.height : 2.5;
    const rotationVal = Number.isFinite(entity.rotation) ? entity.rotation : 0;
    const boxWidthVal = Number.isFinite(entity.boxWidth) && entity.boxWidth > 0 ? entity.boxWidth : '';

    overlay.innerHTML = `
        <div class="cad-text-editor-modal" role="document">
            <div class="cad-text-editor-header">
                <h3 id="cadTextEditorTitle" class="cad-text-editor-title">
                    <i class="bi bi-fonts"></i>
                    <span>Editar Texto</span>
                </h3>
                <button type="button" class="cad-text-editor-close" data-action="close" title="Fechar (Esc)" aria-label="Fechar">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="cad-text-editor-body">
                <div class="cad-text-editor-field">
                    <label class="cad-text-editor-label" for="cadTextEditorValue">Conteúdo do texto</label>
                    <textarea id="cadTextEditorValue" class="cad-text-editor-textarea" rows="3" placeholder="Digite o texto...">${escapeHtml(entity.text ?? '')}</textarea>
                </div>
                <div class="cad-text-editor-grid">
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorFont">Família da fonte</label>
                        <select id="cadTextEditorFont" class="cad-text-editor-select">
                            ${fontOptions}
                        </select>
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorHeight">Tamanho da fonte (altura)</label>
                        <input id="cadTextEditorHeight" class="cad-text-editor-input" type="number" step="any" min="0.001" value="${heightVal}" />
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorHAlign">Alinhamento horizontal</label>
                        <select id="cadTextEditorHAlign" class="cad-text-editor-select">
                            <option value="left" ${halign === 'left' ? 'selected' : ''}>Esquerda (Left)</option>
                            <option value="center" ${halign === 'center' ? 'selected' : ''}>Centro (Center)</option>
                            <option value="right" ${halign === 'right' ? 'selected' : ''}>Direita (Right)</option>
                        </select>
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorVAlign">Alinhamento vertical</label>
                        <select id="cadTextEditorVAlign" class="cad-text-editor-select">
                            <option value="baseline" ${valign === 'baseline' ? 'selected' : ''}>Linha base (Baseline)</option>
                            <option value="top" ${valign === 'top' ? 'selected' : ''}>Superior (Top)</option>
                            <option value="middle" ${valign === 'middle' ? 'selected' : ''}>Meio (Middle)</option>
                            <option value="bottom" ${valign === 'bottom' ? 'selected' : ''}>Inferior (Bottom)</option>
                        </select>
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorRotation">Rotação (°)</label>
                        <input id="cadTextEditorRotation" class="cad-text-editor-input" type="number" step="any" value="${rotationVal}" />
                    </div>
                    <div class="cad-text-editor-field">
                        <label class="cad-text-editor-label" for="cadTextEditorBoxWidth">Largura da caixa (MText)</label>
                        <input id="cadTextEditorBoxWidth" class="cad-text-editor-input" type="number" step="any" min="0" placeholder="Automática (0)" value="${boxWidthVal}" />
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
                <span class="cad-text-editor-hint">Ctrl+Enter para salvar • Esc para cancelar</span>
                <div class="cad-text-editor-actions">
                    <button type="button" class="cad-btn cad-btn-secondary" data-action="close">
                        Cancelar
                    </button>
                    <button type="button" class="cad-btn cad-btn-primary" data-action="save">
                        <i class="bi bi-check-lg"></i>
                        <span>Salvar</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    const textarea = overlay.querySelector('#cadTextEditorValue');
    const fontSelect = overlay.querySelector('#cadTextEditorFont');
    const heightInput = overlay.querySelector('#cadTextEditorHeight');
    const halignSelect = overlay.querySelector('#cadTextEditorHAlign');
    const valignSelect = overlay.querySelector('#cadTextEditorVAlign');
    const rotationInput = overlay.querySelector('#cadTextEditorRotation');
    const boxWidthInput = overlay.querySelector('#cadTextEditorBoxWidth');
    const boldCheckbox = overlay.querySelector('#cadTextEditorBold');
    const italicCheckbox = overlay.querySelector('#cadTextEditorItalic');

    const dismiss = () => {
        closeTextEditorModal();
        if (editor.terminal && typeof editor.terminal.focus === 'function') {
            editor.terminal.focus();
        }
    };

    const save = () => {
        const newText = textarea ? textarea.value : (entity.text ?? '');
        const newHeight = Math.max(0.001, parseFloat(heightInput?.value) || entity.height || 2.5);
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

        editor.commit('Editar Texto', replaceEntities(editor.doc, new Map([[entity.id, updated]])));
        editor.selection = new Set([entity.id]);
        editor.invalidate();
        if (typeof editor.onChange === 'function') {
            editor.onChange(editor);
        }
        editor.log('Texto atualizado.', 'info');
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

    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            dismiss();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            save();
        }
    });

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
