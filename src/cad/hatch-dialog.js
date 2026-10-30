// Janela de Hachura no estilo do BricsCAD: padrão com paleta de amostras, escala, ângulo,
// cor e camada à esquerda; limites, ilhas e opções à direita. Devolve uma ação para o
// comando HATCH (escolher pontos, selecionar objetos, herdar, OK ou cancelar) e reabre
// depois de cada escolha no desenho, como no BricsCAD.

import { HATCH_PATTERNS, hatchFamilies, forEachPatternPiece } from './hatch.js';
import { aciToHex } from './document.js';

const STANDARD_COLORS = [[1, 'Vermelho'], [2, 'Amarelo'], [3, 'Verde'], [4, 'Ciano'], [5, 'Azul'], [6, 'Magenta'], [7, 'Branco']];
const ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 270];
const SCALES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 10];

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parseDecimal = (value) => {
    const text = String(value ?? '').trim().replace(',', '.');
    return text === '' ? NaN : Number(text);
};
const fmt = (n) => String(Math.round(n * 1e6) / 1e6).replace('.', ',');

function showDialog(dialog) {
    // Teclas e mouse da janela não chegam ao editor (Enter repetiria o último comando).
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) dialog.addEventListener(type, (event) => event.stopPropagation());
    // Dentro do `.cad-app` para herdar o tema claro/escuro e a tradução da interface.
    (document.querySelector('[data-cad-app]') ?? document.body).append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
}

// Escala de amostra: o padrão aparece com poucas repetições, sem virar mancha.
function sampleZoom(families) {
    const maxDy = Math.max(...families.map((f) => Math.abs(f.dy)));
    let minGap = Math.min(...families.map((f) => Math.abs(f.dy)));
    families.forEach((a, i) => families.slice(i + 1).forEach((b) => {
        if (Math.abs(Math.sin(a.angle - b.angle)) > 1e-6) return;
        const n = { x: -Math.sin(a.angle), y: Math.cos(a.angle) };
        const dy = Math.abs(a.dy);
        const d = Math.abs(((b.origin.x - a.origin.x) * n.x + (b.origin.y - a.origin.y) * n.y) % dy);
        const gap = Math.min(d, dy - d);
        if (gap > 1e-6) minGap = Math.min(minGap, gap);
    }));
    return Math.max(12 / maxDy, 2.5 / minGap);
}

/** Desenha a amostra do padrão no canvas (sem escala da entidade: só o desenho do padrão). */
export function drawHatchSample(canvas, { pattern, angle = 0, definition, definitionAngle, definitionScale }, color = '#d4d4d8') {
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (pattern === 'SOLID') {
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        return;
    }
    const families = hatchFamilies({ type: 'hatch', loops: [], pattern, angle, scale: definition ? definitionScale ?? 1 : 1, definition, definitionAngle, definitionScale });
    if (families.length === 0) { ctx.restore(); return; }
    const k = sampleZoom(families);
    const box = { minX: 0, minY: 0, maxX: w / k, maxY: h / k };
    const toScreen = (p0, dir, t) => ({ x: (p0.x + dir.x * t) * k, y: h - (p0.y + dir.y * t) * k });
    ctx.lineWidth = 1;
    ctx.beginPath();
    forEachPatternPiece(families, box, (kind, f, p0, dir, t0, t1) => {
        const a = toScreen(p0, dir, t0);
        if (kind === 'dot') { ctx.rect(a.x - 0.75, a.y - 0.75, 1.5, 1.5); return; }
        const b = toScreen(p0, dir, t1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
    }, { maxPieces: 20000 });
    ctx.stroke();
    ctx.fill();
    ctx.restore();
}

// Ícones das ilhas como os do BricsCAD: área hachurada, anel vazio e miolo conforme o modo.
const islandIcon = (inner) => `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><pattern id="cad-hatch-icon-${inner}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4" class="stroke"/></pattern></defs>`
    + `<rect x="2" y="2" width="36" height="36" class="outline" fill="url(#cad-hatch-icon-${inner})"/>`
    + `<circle cx="20" cy="20" r="11" class="outline" fill="${inner === 'ignore' ? `url(#cad-hatch-icon-${inner})` : 'var(--cad-panel)'}"/>`
    + `<circle cx="20" cy="20" r="5" class="outline" fill="${inner === 'outer' ? 'var(--cad-panel)' : `url(#cad-hatch-icon-${inner})`}"/></svg>`;
const ISLAND_ICONS = { nested: islandIcon('nested'), outer: islandIcon('outer'), ignore: islandIcon('ignore') };

/** Paleta de padrões com amostras; resolve com o nome escolhido ou null. */
export function openHatchPalette(current, color) {
    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'cad-hatch-dialog cad-hatch-palette';
        const names = Object.keys(HATCH_PATTERNS);
        dialog.innerHTML = `<form method="dialog">
<h3>Paleta de padrões de hachura</h3>
<div class="cad-hatch-palette-grid" role="listbox">${names.map((name) => `<button type="button" role="option" data-hatch-name="${name}" title="${escapeHtml(HATCH_PATTERNS[name].description)}" aria-selected="${name === current}"><canvas width="72" height="56"></canvas><span>${escapeHtml(HATCH_PATTERNS[name].label)}</span></button>`).join('')}</div>
<p class="cad-hatch-palette-desc" data-hatch-desc></p>
<footer><button type="submit" value="ok" data-hatch-palette-ok>OK</button><button type="button" data-hatch-palette-cancel>Cancelar</button></footer>
</form>`;
        let chosen = HATCH_PATTERNS[current] ? current : names[1];
        const desc = dialog.querySelector('[data-hatch-desc]');
        const mark = () => {
            dialog.querySelectorAll('[data-hatch-name]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.hatchName === chosen)));
            desc.textContent = `${HATCH_PATTERNS[chosen].label}: ${HATCH_PATTERNS[chosen].description}`;
        };
        let result = null;
        dialog.querySelectorAll('[data-hatch-name]').forEach((button) => {
            drawHatchSample(button.querySelector('canvas'), { pattern: button.dataset.hatchName }, color);
            button.addEventListener('click', () => { chosen = button.dataset.hatchName; mark(); });
            button.addEventListener('dblclick', () => { chosen = button.dataset.hatchName; result = chosen; dialog.close(); });
        });
        dialog.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); result = chosen; dialog.close(); });
        dialog.querySelector('[data-hatch-palette-cancel]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => resolve(result), { once: true });
        mark();
        showDialog(dialog);
        dialog.querySelector(`[data-hatch-name="${chosen}"]`)?.focus();
    });
}

/**
 * Abre a janela de Hachura. Resolve com { action, state }:
 * action = 'ok' | 'cancel' | 'pick' | 'select' | 'clear' | 'inherit'.
 * onChange(state) avisa cada alteração para a prévia no desenho.
 */
export function openHatchDialog({ state, boundaries = 0, loops = 0, layers = [], currentLayer = '', onChange = () => {} }) {
    return new Promise((resolve) => {
        const local = { ...state };
        const dialog = document.createElement('dialog');
        dialog.className = 'cad-hatch-dialog';
        const names = Object.keys(HATCH_PATTERNS);
        const patternOptions = names.map((n) => `<option value="${n}">${escapeHtml(HATCH_PATTERNS[n].label)}</option>`).join('')
            + (local.definition && !HATCH_PATTERNS[local.pattern] ? `<option value="${escapeHtml(local.pattern)}">${escapeHtml(local.pattern)} (do arquivo)</option>` : '');
        const colorOptions = [['current', 'Usar atual'], ['bylayer', 'ByLayer'], ...STANDARD_COLORS.map(([n, name]) => [String(n), name])];
        if (!colorOptions.some(([v]) => v === String(local.color))) colorOptions.push([String(local.color), String(local.color)]);
        const layerOptions = [['', `Usar atual (${currentLayer})`], ...layers.map((l) => [l, l])];
        const boundaryText = boundaries
            ? `${boundaries} limite(s), ${loops} laço(s) definidos.`
            : 'Nenhum limite definido. Escolha pontos internos ou selecione objetos.';
        dialog.innerHTML = `<form method="dialog">
<header><h3>Hachura</h3></header>
<div class="cad-hatch-columns">
<div class="cad-hatch-col">
<fieldset><legend>Padrão</legend>
<label class="cad-hatch-row"><span>Nome</span><span class="cad-hatch-field"><select name="pattern">${patternOptions}</select><button type="button" data-hatch-palette title="Paleta de padrões">…</button></span></label>
<div class="cad-hatch-row"><span>Amostra</span><button type="button" class="cad-hatch-sample" data-hatch-sample title="Abrir a paleta de padrões"><canvas width="200" height="44"></canvas></button></div>
<label class="cad-hatch-row"><span>Escala</span><input name="scale" inputmode="decimal" list="cad-hatch-scales" autocomplete="off"></label>
<label class="cad-hatch-row"><span>Ângulo</span><input name="angle" inputmode="decimal" list="cad-hatch-angles" autocomplete="off"></label>
<label class="cad-hatch-row"><span>Cor</span><span class="cad-hatch-field"><span class="cad-hatch-swatch" data-hatch-swatch></span><select name="color">${colorOptions.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('')}</select></span></label>
<label class="cad-hatch-row"><span>Camada</span><select name="layer">${layerOptions.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('')}</select></label>
<datalist id="cad-hatch-scales">${SCALES.map((v) => `<option value="${fmt(v)}"></option>`).join('')}</datalist>
<datalist id="cad-hatch-angles">${ANGLES.map((v) => `<option value="${v}"></option>`).join('')}</datalist>
<p class="cad-hatch-note" data-hatch-note></p>
</fieldset>
</div>
<div class="cad-hatch-col">
<fieldset><legend>Limites</legend>
<button type="button" class="cad-hatch-action" data-hatch-action="pick"><span class="cad-hatch-icon">+</span>Escolher pontos internos</button>
<button type="button" class="cad-hatch-action" data-hatch-action="select"><span class="cad-hatch-icon">▢</span>Selecionar objetos</button>
<button type="button" class="cad-hatch-action" data-hatch-action="clear" ${boundaries ? '' : 'disabled'}><span class="cad-hatch-icon">×</span>Remover limites</button>
<p class="cad-hatch-status ${boundaries ? '' : 'is-empty'}" data-hatch-status>${boundaryText}</p>
</fieldset>
<fieldset><legend>Ilhas</legend>
<div class="cad-hatch-islands">${[['nested', 'Aninhado'], ['outer', 'Exterior'], ['ignore', 'Ignorar']].map(([v, l]) => `<label class="cad-hatch-island"><input type="radio" name="islands" value="${v}">${ISLAND_ICONS[v]}<span>${l}</span></label>`).join('')}</div>
</fieldset>
<fieldset><legend>Opções</legend>
<label class="cad-hatch-check"><input type="checkbox" name="separate">Criar hachuras separadas</label>
</fieldset>
</div>
</div>
<footer>
<button type="button" class="cad-hatch-inherit" data-hatch-action="inherit">Herdar propriedades</button>
<span class="cad-hatch-spacer"></span>
<button type="submit" value="ok" data-hatch-ok ${boundaries ? '' : 'disabled'}>OK</button><button type="button" data-hatch-cancel>Cancelar</button>
</footer>
</form>`;
        const form = dialog.querySelector('form');
        const sample = dialog.querySelector('[data-hatch-sample] canvas');
        const note = dialog.querySelector('[data-hatch-note]');
        const swatch = dialog.querySelector('[data-hatch-swatch]');
        form.pattern.value = local.pattern;
        form.scale.value = fmt(local.scale ?? 1);
        form.angle.value = fmt(local.angle ?? 0);
        form.color.value = String(local.color ?? 'current');
        form.layer.value = local.layer ?? '';
        if (!form.layer.value && local.layer) form.layer.value = '';
        form.islands.value = local.islands ?? 'nested';
        form.separate.checked = Boolean(local.separate);

        const inkColor = () => getComputedStyle(dialog).color || '#d4d4d8';
        const sync = () => {
            const solid = local.pattern === 'SOLID';
            form.scale.disabled = solid;
            form.angle.disabled = solid;
            drawHatchSample(sample, local, inkColor());
            const color = local.color === 'current' || local.color === 'bylayer' ? null : aciToHex(Number(local.color)) || String(local.color);
            swatch.style.background = color ?? 'transparent';
            swatch.classList.toggle('is-auto', !color);
            note.textContent = HATCH_PATTERNS[local.pattern]?.description ?? (local.definition ? 'Padrão do arquivo importado' : '');
        };
        const changed = () => { sync(); onChange({ ...local }); };

        form.pattern.addEventListener('change', () => {
            local.pattern = form.pattern.value;
            // Padrão da biblioteca: a definição trazida do arquivo deixa de valer.
            if (HATCH_PATTERNS[local.pattern]) { delete local.definition; delete local.definitionAngle; delete local.definitionScale; }
            changed();
        });
        const numeric = (input, key, valid) => {
            const apply = () => {
                const value = parseDecimal(input.value);
                if (!valid(value)) { input.value = fmt(local[key]); input.classList.add('is-invalid'); return; }
                input.classList.remove('is-invalid');
                if (value !== local[key]) { local[key] = value; changed(); }
            };
            input.addEventListener('change', apply);
            input.addEventListener('input', () => { const v = parseDecimal(input.value); if (valid(v)) { input.classList.remove('is-invalid'); local[key] = v; changed(); } });
            return apply;
        };
        const applyScale = numeric(form.scale, 'scale', (v) => Number.isFinite(v) && v > 0);
        const applyAngle = numeric(form.angle, 'angle', (v) => Number.isFinite(v));
        form.color.addEventListener('change', () => { const v = form.color.value; local.color = /^\d+$/.test(v) ? Number(v) : v; changed(); });
        form.layer.addEventListener('change', () => { local.layer = form.layer.value; changed(); });
        form.querySelectorAll('[name=islands]').forEach((r) => r.addEventListener('change', () => { local.islands = form.islands.value; changed(); }));
        form.separate.addEventListener('change', () => { local.separate = form.separate.checked; changed(); });

        const palette = async () => {
            const picked = await openHatchPalette(local.pattern, inkColor());
            if (picked && picked !== local.pattern) {
                form.pattern.value = picked;
                form.pattern.dispatchEvent(new Event('change'));
            }
        };
        dialog.querySelector('[data-hatch-palette]').addEventListener('click', palette);
        dialog.querySelector('[data-hatch-sample]').addEventListener('click', palette);

        let result = { action: 'cancel', state: local };
        const finish = (action) => { applyScale(); applyAngle(); result = { action, state: { ...local } }; dialog.close(); };
        dialog.querySelectorAll('[data-hatch-action]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.hatchAction)));
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (!boundaries) return;
            finish('ok');
        });
        dialog.querySelector('[data-hatch-cancel]').addEventListener('click', () => { result = { action: 'cancel', state: { ...local } }; dialog.close(); });
        dialog.addEventListener('close', () => resolve(result), { once: true });
        showDialog(dialog);
        sync();
        (boundaries ? dialog.querySelector('[data-hatch-ok]') : dialog.querySelector('[data-hatch-action="pick"]')).focus();
    });
}
