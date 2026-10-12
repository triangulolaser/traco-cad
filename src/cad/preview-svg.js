// Miniatura SVG de entidades CAD (line, circle, arc, polyline com bulge), usada nos
// previews de anexos .lxds e .nsp. Eixo Y do CAD para cima; o SVG inverte no grupo.
//
// Entidade com `cam` ({ process, leadFraction, link }) é programa de laser: o corte sai na cor
// do processo, `link` é deslocamento, e entre um corte e o seguinte, na ordem do arquivo, entra
// o deslocamento tracejado do fim de um ao início do outro.

const PALETTE = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d'];
// Cor fixa por número de processo, para o mesmo processo ter a mesma cor em qualquer arquivo.
const PROCESS_COLORS = ['#475569', '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#ca8a04', '#4f46e5', '#0d9488', '#c026d3', '#65a30d', '#e11d48', '#0284c7', '#a16207'];
const TRAVEL_COLOR = '#f59e0b';

export const processColor = (process) => PROCESS_COLORS[Math.abs(Math.trunc(process)) % PROCESS_COLORS.length];

const fmt = (n) => {
    const r = Math.round(n * 100) / 100;
    return Object.is(r, -0) ? '0' : String(r);
};

const TAU = 2 * Math.PI;
const ccw = (from, to) => ((to - from) % TAU + TAU) % TAU;

// Bulge do DXF (tan(θ/4), positivo anti-horário) em arco com centro e ângulos CCW.
function arcFromBulge(a, b, bulge) {
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord < 1e-9) return null;
    const theta = 4 * Math.atan(bulge);
    const radius = Math.abs(chord / (2 * Math.sin(theta / 2)));
    const h = (chord / 2) / Math.tan(theta / 2);
    const center = {
        x: (a.x + b.x) / 2 - ((b.y - a.y) / chord) * h,
        y: (a.y + b.y) / 2 + ((b.x - a.x) / chord) * h,
    };
    let start = Math.atan2(a.y - center.y, a.x - center.x);
    let end = Math.atan2(b.y - center.y, b.x - center.x);
    if (bulge < 0) [start, end] = [end, start];
    return { center, radius, start, end, large: Math.abs(theta) > Math.PI ? 1 : 0, sweep: bulge > 0 ? 1 : 0 };
}

function extendArc(box, center, radius, start, end) {
    const span = ccw(start, end) || TAU;
    extend(box, center.x + radius * Math.cos(start), center.y + radius * Math.sin(start));
    extend(box, center.x + radius * Math.cos(start + span), center.y + radius * Math.sin(start + span));
    for (let k = 0; k < 4; k += 1) {
        const angle = (k * Math.PI) / 2;
        if (ccw(start, angle) <= span) extend(box, center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    }
}

function polylinePath(vertices, closed) {
    const n = vertices.length;
    let d = `M${fmt(vertices[0].x)} ${fmt(vertices[0].y)}`;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i += 1) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        const arc = Math.abs(a.bulge || 0) > 1e-12 ? arcFromBulge(a, b, a.bulge) : null;
        d += arc
            ? `A${fmt(arc.radius)} ${fmt(arc.radius)} 0 ${arc.large} ${arc.sweep} ${fmt(b.x)} ${fmt(b.y)}`
            : `L${fmt(b.x)} ${fmt(b.y)}`;
    }
    return closed ? `${d}Z` : d;
}

function entityPath(e) {
    switch (e.type) {
        case 'line':
            return `M${fmt(e.start.x)} ${fmt(e.start.y)}L${fmt(e.end.x)} ${fmt(e.end.y)}`;
        case 'circle': {
            const { x, y } = e.center;
            const r = e.radius;
            return `M${fmt(x - r)} ${fmt(y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;
        }
        case 'arc': {
            const sweep = ccw(e.start, e.end);
            const p0 = { x: e.center.x + e.radius * Math.cos(e.start), y: e.center.y + e.radius * Math.sin(e.start) };
            const p1 = { x: e.center.x + e.radius * Math.cos(e.end), y: e.center.y + e.radius * Math.sin(e.end) };
            return `M${fmt(p0.x)} ${fmt(p0.y)}A${fmt(e.radius)} ${fmt(e.radius)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${fmt(p1.x)} ${fmt(p1.y)}`;
        }
        case 'polyline':
            return e.vertices?.length >= 2 ? polylinePath(e.vertices, e.closed) : '';
        default:
            return '';
    }
}

function extend(box, x, y) {
    if (x < box.minX) box.minX = x;
    if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
}

export function entitiesBounds(entities) {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const e of entities) {
        if (e.type === 'line') { extend(box, e.start.x, e.start.y); extend(box, e.end.x, e.end.y); }
        else if (e.type === 'circle') {
            extend(box, e.center.x - e.radius, e.center.y - e.radius);
            extend(box, e.center.x + e.radius, e.center.y + e.radius);
        } else if (e.type === 'arc') {
            extendArc(box, e.center, e.radius, e.start, e.end);
        } else if (e.type === 'polyline') {
            const n = e.vertices.length;
            e.vertices.forEach((v, i) => {
                extend(box, v.x, v.y);
                if (!e.closed && i === n - 1) return;
                const arc = Math.abs(v.bulge || 0) > 1e-12 ? arcFromBulge(v, e.vertices[(i + 1) % n], v.bulge) : null;
                if (arc) extendArc(box, arc.center, arc.radius, arc.start, arc.end);
            });
        }
    }
    return Number.isFinite(box.minX) ? box : null;
}

function pointOnPolyline(vertices, closed, fraction) {
    const n = vertices.length;
    const count = closed ? n : n - 1;
    const pieces = [];
    let total = 0;
    for (let i = 0; i < count; i += 1) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        const theta = 4 * Math.atan(a.bulge || 0);
        const length = Math.abs(theta) > 1e-9 && chord > 1e-12 ? Math.abs((chord / (2 * Math.sin(theta / 2))) * theta) : chord;
        pieces.push({ a, b, length });
        total += length;
    }
    let target = fraction * total;
    for (const piece of pieces) {
        if (target <= piece.length || piece === pieces[pieces.length - 1]) {
            const t = piece.length > 0 ? Math.min(1, target / piece.length) : 0;
            const arc = Math.abs(piece.a.bulge || 0) > 1e-12 ? arcFromBulge(piece.a, piece.b, piece.a.bulge) : null;
            if (!arc) return { x: piece.a.x + (piece.b.x - piece.a.x) * t, y: piece.a.y + (piece.b.y - piece.a.y) * t };
            const from = Math.atan2(piece.a.y - arc.center.y, piece.a.x - arc.center.x);
            const angle = from + 4 * Math.atan(piece.a.bulge) * t;
            return { x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) };
        }
        target -= piece.length;
    }
    return { x: vertices[0].x, y: vertices[0].y };
}

/** Início e fim do corte de uma entidade, para ligar os deslocamentos. */
export function cutEndpoints(e) {
    const fraction = e.cam?.leadFraction ?? null;
    switch (e.type) {
        case 'line':
            return { entry: e.start, exit: e.end };
        case 'circle': {
            // No CypCut a posição da entrada no círculo é a fração da volta a partir de 45°.
            const angle = fraction === null ? 0 : Math.PI / 4 + fraction * TAU;
            const p = { x: e.center.x + e.radius * Math.cos(angle), y: e.center.y + e.radius * Math.sin(angle) };
            return { entry: p, exit: p };
        }
        case 'arc': {
            const at = (a) => ({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) });
            return { entry: at(e.start), exit: at(e.end) };
        }
        case 'polyline': {
            if (!e.closed) return { entry: e.vertices[0], exit: e.vertices[e.vertices.length - 1] };
            const p = fraction ? pointOnPolyline(e.vertices, true, fraction) : e.vertices[0];
            return { entry: p, exit: p };
        }
        default:
            return null;
    }
}

export function entitiesPreviewSvg(entities, { width = 960, maxHeight = 720, label = '' } = {}) {
    const camMode = entities.some((e) => e.cam);
    const cuts = new Map();
    const travel = [];
    const pushCut = (key, d) => {
        if (!cuts.has(key)) cuts.set(key, []);
        cuts.get(key).push(d);
    };
    let previousExit = null;
    for (const e of entities) {
        const d = entityPath(e);
        if (!d) continue;
        if (!camMode) {
            pushCut(e.layer || '0', d);
            continue;
        }
        if (!e.cam) continue;
        const ends = cutEndpoints(e);
        if (ends && previousExit && Math.hypot(ends.entry.x - previousExit.x, ends.entry.y - previousExit.y) > 0.05) {
            travel.push(`M${fmt(previousExit.x)} ${fmt(previousExit.y)}L${fmt(ends.entry.x)} ${fmt(ends.entry.y)}`);
        }
        if (ends) previousExit = ends.exit;
        if (e.cam.link) travel.push(d);
        else pushCut(e.cam.process, d);
    }
    const box = entitiesBounds(entities);
    if (!box || cuts.size === 0) throw new Error('Arquivo sem geometria desenhável.');

    const w = Math.max(box.maxX - box.minX, 1e-3);
    const h = Math.max(box.maxY - box.minY, 1e-3);
    const pad = Math.max(w, h) * 0.03;
    const vbW = w + 2 * pad;
    const vbH = h + 2 * pad;
    const height = Math.max(120, Math.min(maxHeight, Math.round(width * (vbH / vbW))));
    const outWidth = Math.round(Math.min(width, height * (vbW / vbH)));
    // Espessura em unidades do desenho para dar ~1,2 px na miniatura, sem depender de
    // vector-effect (o Inkscape que rasteriza os nests pesados não garante suporte).
    const px = vbW / outWidth;

    const keys = [...cuts.keys()];
    if (camMode) keys.sort((a, b) => a - b);
    const color = (key, i) => (camMode ? processColor(key) : PALETTE[i % PALETTE.length]);
    const groups = keys.map((key, i) => (
        `<path data-${camMode ? 'process' : 'layer'}="${String(key).replace(/[^A-Za-z0-9_.-]/g, '')}" stroke="${color(key, i)}" d="${cuts.get(key).join('')}"/>`
    ));
    if (travel.length) {
        groups.unshift(`<path data-travel="1" stroke="${TRAVEL_COLOR}" stroke-width="${fmt(px * 0.8)}" stroke-dasharray="${fmt(px * 4)} ${fmt(px * 3)}" d="${travel.join('')}"/>`);
    }

    const legendItems = camMode
        ? [...keys.map((key) => ({ text: `Processo ${key}`, color: processColor(key) })), ...(travel.length ? [{ text: 'Deslocamento', color: TRAVEL_COLOR, dashed: true }] : [])]
        : [];
    // Legenda em linhas que cabem na largura da miniatura (nest de chapa em pé fica estreito).
    let legend = '';
    let x = 8;
    let row = 0;
    for (const item of legendItems) {
        const itemWidth = 21 + item.text.length * 6.2;
        if (x > 8 && x + itemWidth > outWidth - 4) { x = 8; row += 1; }
        const y = height + 6 + row * 18;
        const swatch = item.dashed
            ? `<line x1="${x}" y1="${y + 6}" x2="${x + 16}" y2="${y + 6}" stroke="${item.color}" stroke-width="2" stroke-dasharray="4 3"/>`
            : `<rect x="${x}" y="${y + 1}" width="16" height="10" rx="2" fill="${item.color}"/>`;
        legend += `${swatch}<text x="${x + 21}" y="${y + 10}" font-family="Arial, sans-serif" font-size="11" fill="#334155">${item.text}</text>`;
        x += itemWidth + 12;
    }
    const totalHeight = height + (legend ? 6 + (row + 1) * 18 : 0);

    const title = label ? `<title>${label.replace(/[<>&"]/g, '')}</title>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outWidth}" height="${totalHeight}" viewBox="0 0 ${outWidth} ${totalHeight}" role="img">${title}`
        + `<rect width="${outWidth}" height="${totalHeight}" fill="#ffffff"/>`
        + `<svg width="${outWidth}" height="${height}" viewBox="0 0 ${fmt(vbW)} ${fmt(vbH)}">`
        + `<g transform="translate(${fmt(pad - box.minX)} ${fmt(pad + box.maxY)}) scale(1 -1)" fill="none" stroke-width="${fmt(px * 1.2)}" stroke-linejoin="round" stroke-linecap="round">`
        + groups.join('')
        + `</g></svg>${legend}</svg>`;
    return { svg, width: outWidth, height: totalHeight };
}
