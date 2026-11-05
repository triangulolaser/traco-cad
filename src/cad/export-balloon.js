// Balão que aparece no canto do desenho depois do WBLOCK: miniatura do bloco gravado,
// nome, tamanho e alguns segundos para o usuário arrastar o arquivo para onde quiser.
//
// - Desktop: o arraste é nativo (plugin de drag do Tauri); vira arquivo de verdade para
//   pasta, e-mail ou chat. Soltar de volta num desenho do Traço insere como bloco.
// - Navegador: Chrome/Edge aceitam DownloadURL para soltar fora da janela; nos demais
//   sobra o download normal. Soltar no desenho também insere como bloco.

import { entitiesPreviewSvg } from './preview-svg.js';
import { defineBlock, createInsert } from './blocks.js';
import { addEntities } from './document.js';

export const BALLOON_MS = 8000;
export const DRAG_TYPE = 'application/x-traco-wblock';

// Blocos exportados recentemente, para reconhecer quando voltam soltos no desenho.
const recent = [];
const RECENT_MAX = 8;
let seq = 0;
let current = null;

function remember(data) {
    const token = `wb${Date.now().toString(36)}${(seq += 1)}`;
    recent.push({ token, data });
    while (recent.length > RECENT_MAX) recent.shift();
    return token;
}

export function exportedByToken(token) {
    return recent.find((r) => r.token === token)?.data ?? null;
}

const samePath = (a, b) => String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase();

export function exportedByPath(path) {
    if (!path) return null;
    for (let i = recent.length - 1; i >= 0; i -= 1) {
        if (recent[i].data.path && samePath(recent[i].data.path, path)) return recent[i].data;
    }
    return null;
}

/** Nome de bloco a partir do arquivo, sem extensão e sem caracteres que o DXF recusa. */
export function blockNameFor(fileName, blocks = {}) {
    const stem = String(fileName || 'bloco').split(/[\\/]/).pop().replace(/\.dxf$/i, '');
    const base = stem.replace(/[<>/\\":;?*|=\n\r]/g, '_').trim() || 'bloco';
    if (!blocks[base]) return base;
    let n = 2;
    while (blocks[`${base}-${n}`]) n += 1;
    return `${base}-${n}`;
}

/** Insere o bloco exportado no desenho atual, com o ponto base no ponto dado. */
export function insertExportedBlock(editor, data, point) {
    if (!data?.entities?.length) return false;
    if (data.units != null && editor.doc.units != null && data.units !== editor.doc.units) {
        editor.log('As unidades dos desenhos diferem. Ajuste as unidades antes de inserir o bloco.', 'warn');
        return false;
    }
    const layers = [...editor.doc.layers];
    for (const l of data.layers ?? []) if (!layers.some((x) => x.name === l.name)) layers.push(structuredClone(l));
    const name = blockNameFor(data.name, editor.doc.blocks ?? {});
    const doc = defineBlock({ ...editor.doc, layers }, name, data.entities, data.base ?? { x: 0, y: 0 });
    const insert = createInsert(name, doc.blocks[name], { x: point.x, y: point.y }, { layer: editor.doc.currentLayer ?? '0' });
    editor.commit('Inserir bloco', addEntities(doc, [insert]));
    editor.log(`Bloco ${name} inserido.`);
    return true;
}

/** Copia a geometria do bloco para o clipboard do desenho; Ctrl+V cola pelo ponto base. */
export async function copyExportedBlock(editor, data, bridge = globalThis.window?.desktopBridge) {
    const clip = structuredClone({ entities: data.entities, layers: data.layers ?? [], base: data.base ?? { x: 0, y: 0 }, units: data.units });
    try { clip.systemSeq = (await bridge?.clipboardSequence?.()) ?? null; } catch { clip.systemSeq = null; }
    editor.entityClipboard = clip;
    editor.log(`${data.entities.length} objeto(s) copiado(s); use Ctrl+V para inserir.`);
}

export function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function thumbSvg(entities) {
    try {
        return entitiesPreviewSvg(entities, { width: 160, maxHeight: 160 }).svg;
    } catch {
        return null;
    }
}

function svgToPng(svg, size = 96) {
    return new Promise((resolve) => {
        try {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const k = Math.min(size / img.width, size / img.height);
                    canvas.width = Math.max(1, Math.round(img.width * k));
                    canvas.height = Math.max(1, Math.round(img.height * k));
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/png'));
                } catch { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        } catch { resolve(null); }
    });
}

function fallbackPng() {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const g = canvas.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
        g.strokeStyle = '#0a84ff'; g.lineWidth = 3; g.strokeRect(10, 10, 44, 44);
        return canvas.toDataURL('image/png');
    } catch { return null; }
}

export function closeExportBalloon() {
    current?.close();
}

/**
 * Mostra o balão do arquivo recém-gravado.
 * data: { name, path (só desktop), content (texto DXF), entities, layers, base, units }
 */
export function showExportBalloon(editor, data, { duration = BALLOON_MS, bridge = globalThis.window?.desktopBridge } = {}) {
    if (typeof document === 'undefined') return null;
    current?.close();
    const token = remember(data);
    const host = editor.root?.closest?.('[data-cad-app]') ?? editor.root ?? document.body;
    const nativeDrag = !!(data.path && typeof bridge?.startFileDrag === 'function');
    const canReveal = !!(data.path && typeof bridge?.revealInFolder === 'function');
    const size = new Blob([data.content ?? '']).size;
    const svg = thumbSvg(data.entities ?? []);

    const el = document.createElement('div');
    el.className = 'cad-export-balloon';
    el.setAttribute('role', 'status');
    el.dataset.exportBalloon = token;
    el.innerHTML = `<button type="button" class="cad-export-balloon-close" title="Fechar" aria-label="Fechar">×</button>
<div class="cad-export-balloon-thumb" draggable="true" title="Arraste o arquivo">${svg ? `<img alt="" draggable="false" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">` : '<span class="cad-export-balloon-icon">DXF</span>'}</div>
<div class="cad-export-balloon-info">
<div class="cad-export-balloon-name" title="${esc(data.path ?? data.name)}">${esc(data.name)}</div>
<div class="cad-export-balloon-meta">Bloco · ${data.entities?.length ?? 0} entidades · ${formatBytes(size)}</div>
<div class="cad-export-balloon-hint">Arraste para uma pasta, e-mail, chat ou outro desenho</div>
<div class="cad-export-balloon-actions">${canReveal ? '<button type="button" data-balloon-reveal>Mostrar na pasta</button>' : ''}<button type="button" data-balloon-copy>Copiar</button></div>
</div>
<div class="cad-export-balloon-bar"><i style="animation-duration:${duration}ms"></i></div>`;

    // O editor não pode reagir a clique, roda ou tecla dentro do balão.
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'keydown', 'contextmenu']) {
        el.addEventListener(type, (event) => event.stopPropagation());
    }

    const rect = editor.stage?.getBoundingClientRect?.();
    if (rect && rect.width > 0) {
        el.style.right = `${Math.max(8, window.innerWidth - rect.right + 16)}px`;
        el.style.bottom = `${Math.max(8, window.innerHeight - rect.bottom + 16)}px`;
    }

    let timer = null;
    let remaining = duration;
    let startedAt = 0;
    let held = 0; // hover e arraste seguram o balão
    let blobUrl = null;
    let closed = false;

    const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        el.remove();
        if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        if (current?.el === el) current = null;
    };
    const run = () => { startedAt = Date.now(); clearTimeout(timer); timer = setTimeout(close, remaining); el.classList.remove('is-paused'); };
    const hold = () => {
        held += 1;
        if (held > 1) return;
        clearTimeout(timer);
        remaining = Math.max(1500, remaining - (Date.now() - startedAt));
        el.classList.add('is-paused');
    };
    const release = () => { held = Math.max(0, held - 1); if (!held && !closed) run(); };

    el.addEventListener('mouseenter', hold);
    el.addEventListener('mouseleave', release);
    el.querySelector('.cad-export-balloon-close').addEventListener('click', close);
    el.querySelector('[data-balloon-copy]').addEventListener('click', () => { copyExportedBlock(editor, data, bridge); });
    el.querySelector('[data-balloon-reveal]')?.addEventListener('click', async () => {
        try { await bridge.revealInFolder(data.path); } catch (err) { editor.log(`Não foi possível abrir a pasta: ${err?.message || err}`, 'warn'); }
    });

    const thumb = el.querySelector('.cad-export-balloon-thumb');
    let pngPromise = null;
    if (nativeDrag) pngPromise = (svg ? svgToPng(svg) : Promise.resolve(null)).then((png) => png ?? fallbackPng());
    let dragPng = null;
    pngPromise?.then((png) => { dragPng = png; });

    thumb.addEventListener('dragstart', (event) => {
        if (nativeDrag && dragPng) {
            // Arraste do sistema: o arquivo gravado sai como arquivo de verdade.
            event.preventDefault();
            hold();
            el.classList.add('is-dragging');
            Promise.resolve(bridge.startFileDrag(data.path, dragPng, (result) => {
                el.classList.remove('is-dragging');
                release();
                if (String(result?.result ?? result).toLowerCase() === 'dropped') close();
            })).catch((err) => {
                el.classList.remove('is-dragging');
                release();
                editor.log(`Não foi possível arrastar o arquivo: ${err?.message || err}`, 'warn');
            });
            return;
        }
        const dt = event.dataTransfer;
        if (!dt) return;
        dt.effectAllowed = 'copy';
        dt.setData(DRAG_TYPE, token);
        dt.setData('text/plain', data.name);
        if (!blobUrl && typeof URL?.createObjectURL === 'function') blobUrl = URL.createObjectURL(new Blob([data.content ?? ''], { type: 'application/dxf' }));
        // Chrome/Edge: soltar fora da janela grava o arquivo (pasta, área de trabalho).
        if (blobUrl) dt.setData('DownloadURL', `application/dxf:${data.name}:${blobUrl}`);
        const img = thumb.querySelector('img');
        if (img && dt.setDragImage) dt.setDragImage(img, 24, 24);
        hold();
        el.classList.add('is-dragging');
    });
    thumb.addEventListener('dragend', (event) => {
        if (!el.classList.contains('is-dragging')) return;
        el.classList.remove('is-dragging');
        release();
        if (event.dataTransfer?.dropEffect && event.dataTransfer.dropEffect !== 'none') close();
    });

    host.append(el);
    run();
    current = { el, close, token, data };
    return current;
}
