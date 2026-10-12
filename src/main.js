import './styles/desktop.css';
import './cad.js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save as tauriSaveDialog, open as tauriOpenDialog } from '@tauri-apps/plugin-dialog';
import { initDesktopUpdates } from './updater.js';

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
            window.tracoCad.openFile(file, { filePath: payload.path });
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

// 2. Processa arquivos pendentes passados no cold boot (inicialização do app):
async function drainPendingFiles() {
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

// 3. Atualização automática: checa ao abrir e pelo botão da barra superior.
initDesktopUpdates();
