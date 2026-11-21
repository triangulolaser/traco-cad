// Paleta de cores em quadradinhos, no estilo da paleta nativa do macOS.
// O seletor nativo do Windows/Linux (input type=color) só abre o espectro e
// os campos RGB; a paleta deixa escolher com um clique em qualquer sistema e
// mantém o seletor nativo em "Mais cores...". A primeira linha usa índices ACI,
// que voltam como número para o DXF continuar com cores indexadas.
import { aciToHex } from './document.js';
import { t } from './i18n.js';

export const PALETTE_ACI = [[1, 'Vermelho'], [2, 'Amarelo'], [3, 'Verde'], [4, 'Ciano'], [5, 'Azul'], [6, 'Magenta'], [7, 'Branco'], [8, 'Cinza escuro'], [9, 'Cinza claro']];

// Colunas de matiz e linhas de luminosidade (escuro → claro), como a grade do macOS.
const HUES = [195, 215, 245, 275, 310, 350, 8, 25, 40, 52, 65, 95];
const LIGHTNESS = [16, 24, 33, 42, 50, 60, 70, 80, 90];
const SATURATION = [100, 100, 90, 85, 85, 90, 95, 95, 90];

function hslToHex(h, s, l) {
    const sat = s / 100;
    const lig = l / 100;
    const a = sat * Math.min(lig, 1 - lig);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// Grade de cores livres: uma linha de cinzas (branco → preto) e as linhas de matiz.
export function paletteGrid() {
    const grays = Array.from({ length: HUES.length }, (_, i) => {
        const v = Math.round(255 - (255 * i) / (HUES.length - 1)).toString(16).padStart(2, '0');
        return `#${v}${v}${v}`;
    });
    const rows = LIGHTNESS.map((l, r) => HUES.map((h) => hslToHex(h, SATURATION[r], l)));
    return [grays, ...rows];
}

const sameColor = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

let openPalette = null;

export function closeColorPalette() {
    openPalette?.close();
}

// Abre a paleta ancorada em `anchor`. `value` é a cor atual (número ACI, '#rrggbb'
// ou 'bylayer'); `onPick` recebe o valor escolhido; `onMore` abre o seletor nativo.
export function openColorPalette({ anchor, value, allowByLayer = true, onPick, onMore }) {
    closeColorPalette();
    const doc = anchor.ownerDocument;
    const pop = doc.createElement('div');
    pop.className = 'cad-color-palette';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t('Paleta de cores'));

    const tile = (val, hex, label, extraClass = '') => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = `cad-color-tile${extraClass}`;
        b.dataset.color = String(val);
        if (hex) b.style.background = hex;
        b.title = label;
        b.setAttribute('aria-label', label);
        if (sameColor(val, value)) b.classList.add('is-current');
        return b;
    };

    const aciRow = doc.createElement('div');
    aciRow.className = 'cad-color-row cad-color-aci';
    if (allowByLayer) aciRow.append(tile('bylayer', null, 'ByLayer', ' cad-color-bylayer'));
    PALETTE_ACI.forEach(([n, name]) => aciRow.append(tile(n, aciToHex(n), `${t(name)} (ACI ${n})`)));

    const grid = doc.createElement('div');
    grid.className = 'cad-color-grid';
    paletteGrid().forEach((row) => row.forEach((hex) => grid.append(tile(hex, hex, hex.toUpperCase()))));

    const more = doc.createElement('button');
    more.type = 'button';
    more.className = 'cad-color-more';
    more.textContent = t('Mais cores...');

    pop.append(aciRow, grid, more);
    // Dentro do .cad-app para herdar as variáveis do tema claro/escuro.
    (anchor.closest('.cad-app') ?? doc.body).append(pop);

    // Abaixo do controle; acima quando não couber na janela.
    const win = doc.defaultView;
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const top = r.bottom + 6 + pr.height > win.innerHeight ? Math.max(6, r.top - 6 - pr.height) : r.bottom + 6;
    const left = Math.min(Math.max(6, r.left), Math.max(6, win.innerWidth - pr.width - 6));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    const onDown = (event) => { if (!pop.contains(event.target) && !anchor.contains(event.target)) close(); };
    const onKey = (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); anchor.focus?.(); }
    };
    function close() {
        pop.remove();
        doc.removeEventListener('pointerdown', onDown, true);
        doc.removeEventListener('keydown', onKey, true);
        win.removeEventListener('resize', close);
        if (openPalette?.pop === pop) openPalette = null;
    }
    pop.addEventListener('click', (event) => {
        const t = event.target.closest('.cad-color-tile');
        if (t) {
            const raw = t.dataset.color;
            close();
            onPick?.(raw === 'bylayer' || raw.startsWith('#') ? raw : Number(raw));
            return;
        }
        if (event.target.closest('.cad-color-more')) {
            close();
            onMore?.();
        }
    });
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    win.addEventListener('resize', close);
    openPalette = { pop, close };
    (pop.querySelector('.is-current') ?? pop.querySelector('.cad-color-tile'))?.focus();
    return openPalette;
}
