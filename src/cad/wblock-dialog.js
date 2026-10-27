// Janela do WBLOCK no estilo do BricsCAD: caminho já preenchido com o último usado,
// ponto base 0,0,0 e OK em foco — W, Enter, Enter grava e confirma a substituição.

const escapeAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showDialog(dialog) {
    // Teclas da janela não chegam ao editor: Enter no OK repetiria o último comando.
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    // Idem para o mouse, agora que o diálogo mora dentro do `.cad-app`.
    for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) dialog.addEventListener(type, (event) => event.stopPropagation());
    // Dentro do `.cad-app` para herdar o tema claro/escuro; no body ficava sempre escuro.
    (document.querySelector('[data-cad-app]') ?? document.body).append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
}

/**
 * Abre a janela e resolve com { action: 'ok' | 'pick' | 'cancel', path, base }.
 * `browse` (opcional) abre a janela nativa de salvar e devolve o caminho escolhido.
 */
export function openWblockDialog({ path, base, count, browse }) {
    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'cad-wblock-dialog';
        dialog.innerHTML = `<form method="dialog">
<h3>Gravar bloco em arquivo</h3>
<fieldset><legend>Arquivo de destino</legend>
<label>Nome e caminho <span class="cad-wblock-path"><input name="path" value="${escapeAttr(path)}" spellcheck="false">${browse ? '<button type="button" data-wblock-browse title="Procurar">…</button>' : ''}</span></label>
</fieldset>
<fieldset><legend>Ponto base</legend>
<button type="button" data-wblock-pick>Escolher no desenho</button>
<span class="cad-wblock-xyz"><label>X <input name="x" type="number" step="any" value="${base.x}"></label><label>Y <input name="y" type="number" step="any" value="${base.y}"></label><label>Z <input name="z" type="number" step="any" value="${base.z ?? 0}"></label></span>
</fieldset>
<p class="cad-wblock-count">Entidades selecionadas: <b>${count}</b></p>
<footer><button value="ok" type="submit" data-wblock-ok autofocus>OK</button><button value="cancel" type="button" data-wblock-cancel>Cancelar</button></footer>
</form>`;
        const form = dialog.querySelector('form');
        const read = () => ({
            path: form.path.value.trim(),
            base: { x: Number(form.x.value) || 0, y: Number(form.y.value) || 0, z: Number(form.z.value) || 0 },
        });
        let result = { action: 'cancel' };
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const values = read();
            if (!values.path) { form.path.focus(); return; }
            result = { action: 'ok', ...values };
            dialog.close();
        });
        dialog.querySelector('[data-wblock-cancel]').addEventListener('click', () => dialog.close());
        dialog.querySelector('[data-wblock-pick]').addEventListener('click', () => { result = { action: 'pick', ...read() }; dialog.close(); });
        dialog.querySelector('[data-wblock-browse]')?.addEventListener('click', async () => {
            const chosen = await browse(form.path.value.trim());
            if (chosen) form.path.value = chosen;
            dialog.querySelector('[data-wblock-ok]').focus();
        });
        dialog.addEventListener('close', () => resolve(result), { once: true });
        showDialog(dialog);
        dialog.querySelector('[data-wblock-ok]').focus();
    });
}

/** Pergunta se substitui o arquivo; "Sim" em foco para o Enter confirmar. */
export function confirmOverwrite(path) {
    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'cad-wblock-dialog cad-wblock-confirm';
        dialog.innerHTML = `<form method="dialog"><p>O arquivo já existe:</p><p class="cad-wblock-confirm-path"></p><p>Deseja substituir?</p>
<footer><button value="yes" type="submit" autofocus>Sim</button><button value="no" type="submit">Não</button></footer></form>`;
        dialog.querySelector('.cad-wblock-confirm-path').textContent = path;
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
        showDialog(dialog);
        dialog.querySelector('button[value=yes]').focus();
    });
}
