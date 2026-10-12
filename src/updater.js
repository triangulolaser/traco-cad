// Atualização automática do Traço desktop (tauri-plugin-updater).
// O app lê https://trls.com.br/traco/updates/latest.json, confere a
// assinatura do pacote com a chave pública do tauri.conf.json e só então instala.
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const STARTUP_DELAY_MS = 5000;
const DISMISS_KEY = 'traco.desktop.update.dismissed';

let busy = false;
let banner = null;

function unsavedTabCount() {
    const tabs = window.tracoCad?.tabs;
    if (!tabs || !Array.isArray(tabs.tabs) || typeof tabs.isTabDirty !== 'function') return 0;
    return tabs.tabs.filter((tab) => tabs.isTabDirty(tab)).length;
}

function showBanner(html, actions = []) {
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'desktop-update-banner';
        banner.setAttribute('role', 'status');
        document.body.appendChild(banner);
    }
    banner.innerHTML = `<span class="desktop-update-text">${html}</span>`;
    for (const { label, primary, onClick } of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = primary ? 'cad-btn desktop-update-primary' : 'cad-btn';
        button.textContent = label;
        button.addEventListener('click', onClick);
        banner.appendChild(button);
    }
}

function hideBanner() {
    banner?.remove();
    banner = null;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Janela de atualização com desenhos abertos sem salvar. O caminho seguro
// ("Salvar tudo e atualizar") é o botão grande; descartar fica pequeno e vermelho.
function askUnsavedBeforeUpdate(update, unsaved) {
    return new Promise((resolve) => {
        document.querySelectorAll('[data-desktop-update-modal]').forEach((el) => el.remove());
        const overlay = document.createElement('div');
        overlay.className = 'cad-error-overlay desktop-update-overlay';
        overlay.setAttribute('data-desktop-update-modal', '');
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'desktop-update-modal-title');
        const plural = unsaved === 1 ? '1 desenho tem alterações não salvas' : `${unsaved} desenhos têm alterações não salvas`;
        overlay.innerHTML = `
            <div class="cad-error-modal desktop-update-modal" role="document">
                <h2 class="desktop-update-modal-title" id="desktop-update-modal-title">Atualizar para o Traço ${escapeHtml(update.version)}</h2>
                <p class="desktop-update-modal-text">${plural}. O Traço reinicia para instalar a nova versão.</p>
                <button type="button" class="cad-btn desktop-update-save-all" data-update-choice="save">
                    <i class="bi bi-floppy-fill" aria-hidden="true"></i>
                    <span>Salvar tudo e atualizar</span>
                </button>
                <div class="desktop-update-modal-secondary">
                    <button type="button" class="cad-btn" data-update-choice="cancel">Agora não</button>
                    <button type="button" class="cad-btn desktop-update-discard" data-update-choice="discard">Atualizar sem salvar</button>
                </div>
            </div>
        `;
        const finish = (choice) => {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
            resolve(choice);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); finish('cancel'); }
        };
        overlay.addEventListener('click', (event) => {
            const button = event.target.closest('[data-update-choice]');
            if (button) finish(button.dataset.updateChoice);
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        overlay.querySelector('[data-update-choice="save"]')?.focus();
    });
}

async function install(update) {
    if (busy) return;
    const unsaved = unsavedTabCount();
    if (unsaved > 0) {
        const choice = await askUnsavedBeforeUpdate(update, unsaved);
        if (choice === 'cancel') return;
        if (choice === 'save') {
            busy = true;
            showBanner('Salvando desenhos…');
            const result = await window.tracoCad.tabs.saveAllDirty();
            busy = false;
            if (result.failed) {
                showBanner(`Atualização cancelada: "${escapeHtml(result.failed)}" não foi salvo.`, [
                    { label: 'Tentar de novo', primary: true, onClick: () => install(update) },
                    { label: 'Fechar', onClick: hideBanner },
                ]);
                return;
            }
        }
    }
    busy = true;
    let total = 0;
    let received = 0;
    showBanner(`Baixando Traço ${escapeHtml(update.version)}…`);
    try {
        await update.downloadAndInstall((event) => {
            if (event.event === 'Started') total = event.data.contentLength || 0;
            if (event.event === 'Progress') {
                received += event.data.chunkLength;
                if (total > 0) showBanner(`Baixando Traço ${escapeHtml(update.version)}… ${Math.round((received / total) * 100)}%`);
            }
            if (event.event === 'Finished') showBanner('Instalando e reiniciando…');
        });
        await relaunch();
    } catch (err) {
        busy = false;
        showBanner(`Falha ao atualizar: ${escapeHtml(err?.message || err)}`, [{ label: 'Fechar', onClick: hideBanner }]);
    }
}

export async function checkForDesktopUpdate({ manual = false } = {}) {
    if (busy) return;
    busy = true;
    if (manual) showBanner('Verificando atualizações…');
    let update = null;
    try {
        update = await check();
    } catch (err) {
        busy = false;
        if (manual) showBanner(`Não foi possível verificar atualizações: ${escapeHtml(err?.message || err)}`, [{ label: 'Fechar', onClick: hideBanner }]);
        else console.warn('[Traço] Verificação de atualização falhou:', err);
        return;
    }
    busy = false;
    if (!update) {
        if (manual) showBanner('O Traço já está na versão mais recente.', [{ label: 'Fechar', onClick: hideBanner }]);
        return;
    }
    if (!manual && localStorage.getItem(DISMISS_KEY) === update.version) return;

    const notes = update.body ? `<small>${escapeHtml(update.body)}</small>` : '';
    showBanner(`Traço ${escapeHtml(update.version)} disponível (você usa ${escapeHtml(update.currentVersion)}). ${notes}`, [
        { label: 'Atualizar agora', primary: true, onClick: () => install(update) },
        {
            label: 'Depois',
            onClick: () => {
                localStorage.setItem(DISMISS_KEY, update.version);
                hideBanner();
            },
        },
    ]);
}

export function initDesktopUpdates() {
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-desktop-update-check]')) {
            checkForDesktopUpdate({ manual: true });
        }
    });
    setTimeout(() => checkForDesktopUpdate(), STARTUP_DELAY_MS);
}
