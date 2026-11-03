// Janela da matriz: não é modal, para o desenho seguir visível e navegável com a pré-visualização.
// Cada valor válido digitado atualiza o desenho na hora, por `onChange`.

import { ARRAY_FIELDS, ARRAY_MODE_LABELS } from './array.js';

const parseDecimal = (value) => {
    const text = String(value ?? '').trim().replace(',', '.');
    return text === '' ? NaN : Number(text);
};
const fmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6).replace('.', ',') : '');

/**
 * Abre a janela e devolve { result, close }. `result` resolve com
 * { action: 'ok' | 'cancel' | 'pick-center' | 'pick-direction', state }.
 * `onChange(state)` devolve { error, items, entities } para o rodapé.
 */
export function openArrayDialog({ state, onChange, onFit = () => {}, anchor = null }) {
    const local = { ...state };
    const dialog = document.createElement('dialog');
    dialog.className = 'cad-hatch-dialog cad-array-dialog';
    let resolveResult;
    const result = new Promise((resolve) => { resolveResult = resolve; });
    const invalid = new Set();

    const readField = (key) => {
        if (key === 'centerX') return local.center?.x;
        if (key === 'centerY') return local.center?.y;
        return local[key];
    };
    const writeField = (key, value) => {
        if (key === 'centerX') local.center = { x: value, y: local.center?.y ?? 0 };
        else if (key === 'centerY') local.center = { x: local.center?.x ?? 0, y: value };
        else local[key] = value;
    };
    const fieldHtml = (field) => {
        if (field.kind === 'bool') return `<label class="cad-hatch-check"><input type="checkbox" name="${field.key}">${field.label}</label>`;
        return `<label class="cad-hatch-row"><span>${field.label}</span><input name="${field.key}" inputmode="${field.kind === 'int' ? 'numeric' : 'decimal'}" autocomplete="off"></label>`;
    };
    dialog.innerHTML = `<form method="dialog">
<header><h3>Matriz</h3></header>
<div class="cad-array-modes" role="radiogroup">${Object.entries(ARRAY_MODE_LABELS).map(([key, label]) => `<label><input type="radio" name="mode" value="${key}">${label}</label>`).join('')}</div>
${Object.entries(ARRAY_FIELDS).map(([mode, fields]) => `<div class="cad-array-fields" data-array-mode="${mode}">${fields.map(fieldHtml).join('')}${mode === 'p' ? '<button type="button" class="cad-hatch-action" data-array-action="pick-center">Indicar o centro no desenho</button>' : ''}${mode === 'l' ? '<button type="button" class="cad-hatch-action" data-array-action="pick-direction">Indicar com dois pontos</button>' : ''}</div>`).join('')}
<label class="cad-hatch-check"><input type="checkbox" name="associative">Editável depois nas propriedades</label>
<p class="cad-array-status" data-array-status aria-live="polite"></p>
<footer>
<button type="button" data-array-fit title="Enquadrar a matriz na tela">Enquadrar</button>
<span class="cad-hatch-spacer"></span>
<button type="submit" value="ok" data-array-ok>OK</button><button type="button" data-array-cancel>Cancelar</button>
</footer>
</form>`;
    const form = dialog.querySelector('form');
    const status = dialog.querySelector('[data-array-status]');
    const ok = dialog.querySelector('[data-array-ok]');

    const fill = () => {
        for (const fields of Object.values(ARRAY_FIELDS)) {
            for (const field of fields) {
                dialog.querySelectorAll(`[name="${field.key}"]`).forEach((input) => {
                    if (field.kind === 'bool') input.checked = Boolean(readField(field.key));
                    else if (document.activeElement !== input) {
                        input.value = field.kind === 'int' ? String(readField(field.key) ?? '') : fmt(readField(field.key));
                        input.classList.remove('is-invalid');
                    }
                });
            }
        }
        form.mode.value = local.mode;
        form.associative.checked = Boolean(local.associative);
        dialog.querySelectorAll('[data-array-mode]').forEach((box) => { box.hidden = box.dataset.arrayMode !== local.mode; });
    };
    let lastError = null;
    const changed = () => {
        const info = onChange({ ...local }) ?? {};
        lastError = invalid.size ? 'Corrija os valores destacados.' : info.error ?? null;
        status.textContent = lastError ?? `${info.items} itens, ${info.entities} entidades`;
        status.classList.toggle('is-error', Boolean(lastError));
        ok.disabled = Boolean(lastError);
    };

    let done = false;
    const finish = (action) => {
        if (done) return;
        done = true;
        resolveResult({ action, state: { ...local } });
        if (dialog.open) dialog.close();
        dialog.remove();
    };

    for (const fields of Object.values(ARRAY_FIELDS)) {
        for (const field of fields) {
            dialog.querySelectorAll(`[name="${field.key}"]`).forEach((input) => {
                if (field.kind === 'bool') {
                    input.addEventListener('change', () => { local[field.key] = input.checked; changed(); });
                    return;
                }
                input.addEventListener('input', () => {
                    const value = parseDecimal(input.value);
                    const valid = field.kind === 'int' ? Number.isInteger(value) : Number.isFinite(value);
                    input.classList.toggle('is-invalid', !valid);
                    const id = `${input.closest('[data-array-mode]').dataset.arrayMode}:${field.key}`;
                    if (valid) { invalid.delete(id); writeField(field.key, value); } else invalid.add(id);
                    changed();
                });
                input.addEventListener('blur', () => {
                    if (input.classList.contains('is-invalid')) return;
                    input.value = field.kind === 'int' ? String(readField(field.key) ?? '') : fmt(readField(field.key));
                });
            });
        }
    }
    dialog.querySelectorAll('[name=mode]').forEach((radio) => radio.addEventListener('change', () => {
        local.mode = form.mode.value;
        invalid.clear();
        // Polar não tem centro razoável por padrão: quem sabe é quem está desenhando.
        if (local.mode === 'p' && !local.center) { finish('pick-center'); return; }
        fill();
        changed();
    }));
    form.associative.addEventListener('change', () => { local.associative = form.associative.checked; changed(); });
    dialog.querySelectorAll('[data-array-action]').forEach((button) => button.addEventListener('click', () => finish(button.dataset.arrayAction)));
    dialog.querySelector('[data-array-fit]').addEventListener('click', onFit);
    dialog.querySelector('[data-array-cancel]').addEventListener('click', () => finish('cancel'));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!lastError) finish('ok');
    });
    dialog.addEventListener('keydown', (event) => {
        // Teclas da janela não chegam ao editor (Enter repetiria o último comando).
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); finish('cancel'); }
    });
    for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) dialog.addEventListener(type, (event) => event.stopPropagation());
    // Dentro do `.cad-app` para herdar o tema claro/escuro e a tradução da interface.
    (document.querySelector('[data-cad-app]') ?? document.body).append(dialog);
    dialog.show();
    // Arrastável pelo título: a janela não pode esconder a parte da matriz que se quer conferir.
    const header = dialog.querySelector('header');
    header.addEventListener('pointerdown', (event) => {
        const box = dialog.getBoundingClientRect();
        const dx = event.clientX - box.left;
        const dy = event.clientY - box.top;
        const move = (e) => {
            dialog.style.left = `${Math.min(Math.max(0, e.clientX - dx), window.innerWidth - box.width)}px`;
            dialog.style.top = `${Math.min(Math.max(0, e.clientY - dy), window.innerHeight - 40)}px`;
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
    if (anchor) {
        dialog.style.top = `${anchor.top + 12}px`;
        dialog.style.left = `${Math.max(anchor.left + 12, anchor.right - dialog.offsetWidth - 12)}px`;
    }
    fill();
    changed();
    dialog.querySelector(`[data-array-mode="${local.mode}"] input`)?.focus();
    dialog.querySelector(`[data-array-mode="${local.mode}"] input`)?.select?.();

    return { result, close: () => finish('cancel'), state: () => ({ ...local }) };
}
