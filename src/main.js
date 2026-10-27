import './styles/desktop.css';
import './cad.js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save as tauriSaveDialog, open as tauriOpenDialog } from '@tauri-apps/plugin-dialog';
import { initDesktopUpdates } from './updater.js';
import { parseDesktopOpenLink } from './cad/desktop-link.js';

console.log('Traço CAD Desktop inicializado.');

window.desktopBridge = {
    isDesktop: true,
    async saveFile(path, contents) {
        if (typeof contents === 'string') {
            return invoke('write_file', { path, contents });
        }
        const u8Array = contents instanceof Uint8Array ? Array.from(contents) : Array.from(new Uint8Array(contents));
        return invoke('write_file_binary', { path, bytes: u8Array });
    },
    async saveFileBinary(path, bytes) {
        const u8Array = bytes instanceof Uint8Array ? Array.from(bytes) : Array.from(new Uint8Array(bytes));
        return invoke('write_file_binary', { path, bytes: u8Array });
    },
    async readFileText(path) {
        return invoke('read_file_text', { path });
    },
    async readFileBinary(path) {
        return invoke('read_file_binary', { path });
    },
    async showSaveDialog(options = {}) {
        return tauriSaveDialog(options);
    },
    async showOpenDialog(options = {}) {
        return tauriOpenDialog(options);
    },
    async convertDwg(path, bytes) {
        const u8Array = bytes ? Array.from(new Uint8Array(bytes)) : null;
        return invoke('convert_dwg_to_dxf', { path: path || null, bytes: u8Array });
    },
    async readCadClipboard() {
        return invoke('read_cad_clipboard');
    },
    async clipboardSequence() {
        return (await invoke('read_cad_clipboard_seq')) ?? null;
    },
    async closeWindow() {
        return getCurrentWindow().destroy();
    },
};

function openOpenedFile(payload) {
    if (!payload || !payload.bytes || !payload.name) return;
    const uint8 = new Uint8Array(payload.bytes);
    const mime = payload.name.toLowerCase().endsWith('.dwg') ? 'image/vnd.dwg' : 'application/octet-stream';
    const file = new File([uint8], payload.name, { type: mime });
    if (payload.path) {
        file.filePath = payload.path;
    }

    const tryOpen = () => {
        if (window.tracoCad && typeof window.tracoCad.openFile === 'function' && window.tracoCad.tabs) {
            if (typeof window.tracoCad.openFiles === 'function') window.tracoCad.openFiles([file], { filePath: payload.path });
            else window.tracoCad.openFile(file, { filePath: payload.path });
            return true;
        }
        return false;
    };

    if (!tryOpen()) {
        const interval = setInterval(() => {
            if (tryOpen()) clearInterval(interval);
        }, 50);
        setTimeout(() => clearInterval(interval), 5000);
    }
}

// 1. Escuta arquivos abertos durante a execução (duplo-clique no Finder, Abrir com):
listen('file-opened', (event) => {
    console.log('[Tauri] Arquivo aberto via evento:', event.payload);
    openOpenedFile(event.payload);
});

// 2. Desenho enviado por outra aplicação pelo link traco-cad://open (vira uma aba sem caminho em disco):
async function openOpenedLink(link) {
    try {
        const drawing = await parseDesktopOpenLink(link);
        if (!drawing) return;
        openOpenedFile({ path: '', name: drawing.name, bytes: new TextEncoder().encode(drawing.text) });
    } catch (err) {
        console.warn('[Tauri] Link de desenho inválido:', err);
    }
}

listen('link-opened', (event) => openOpenedLink(event.payload));

// 3. Processa arquivos e links pendentes do cold boot (inicialização do app):
async function drainPendingFiles() {
    try {
        const links = await invoke('get_pending_open_links');
        for (const link of links || []) openOpenedLink(link);
    } catch (err) {
        console.warn('[Tauri] Falha ao verificar links pendentes:', err);
    }
    try {
        const pending = await invoke('get_pending_open_files');
        if (Array.isArray(pending) && pending.length > 0) {
            console.log('[Tauri] Arquivos pendentes do cold boot:', pending.length);
            for (const item of pending) {
                openOpenedFile(item);
            }
        }
    } catch (err) {
        console.warn('[Tauri] Falha ao verificar arquivos pendentes:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', drainPendingFiles);
} else {
    drainPendingFiles();
}

// 4. Arraste de arquivos do Explorer/Finder: o webview do Tauri intercepta o drop e entrega
// só os caminhos, então lemos cada arquivo e abrimos na fila do editor, um por aba.
getCurrentWebview()
    .onDragDropEvent(async (event) => {
        if (event.payload?.type !== 'drop') return;
        for (const path of event.payload.paths || []) {
            try {
                const bytes = await invoke('read_file_binary', { path });
                const name = path.split(/[\\/]/).pop() || 'desenho.dxf';
                openOpenedFile({ path, name, bytes });
            } catch (err) {
                console.warn('[Tauri] Falha ao ler arquivo arrastado:', path, err);
            }
        }
    })
    .catch((err) => console.warn('[Tauri] Arraste de arquivos indisponível:', err));

// 5. X da janela e Alt+F4 passam pela mesma pergunta do Ctrl+F4: desenho com
// alteração pergunta se salva, e Cancelar mantém o Traço aberto.
getCurrentWindow()
    .onCloseRequested(async (event) => {
        const tabs = window.tracoCad?.tabs;
        if (!tabs?.requestQuit) return;
        event.preventDefault();
        await tabs.requestQuit();
    })
    .catch((err) => console.warn('[Tauri] Interceptação do fechamento indisponível:', err));

// 6. Trava dos arquivos abertos: enquanto houver aba com o arquivo, o Windows
// não deixa apagar, mover nem renomear pelo Explorer e avisa que está aberto no
// Traço. Conferido a cada segundo para pegar abrir, fechar e Salvar como.
let lockedPathsKey = null;
function syncFileLocks() {
    const tabs = window.tracoCad?.tabs;
    if (!tabs?.tabs) return;
    const paths = [...new Set(tabs.tabs.map((tab) => tabs.getTabDoc(tab)?.filePath).filter(Boolean))].sort();
    const key = paths.join('\n');
    if (key === lockedPathsKey) return;
    lockedPathsKey = key;
    invoke('sync_file_locks', { paths }).catch((err) => {
        lockedPathsKey = null;
        console.warn('[Tauri] Falha ao travar arquivos abertos:', err);
    });
}
setInterval(syncFileLocks, 1000);

// 7. Atualização automática: checa ao abrir e pelo botão da barra superior.
initDesktopUpdates();
