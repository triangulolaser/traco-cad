// Importação de PDF: página como imagem (raster) ou extração vetorial dos caminhos (linhas, polilinhas, béziers achatadas).
// pdf.js é carregado sob demanda para não pesar o bundle do CAD.

const PT_TO_MM = 25.4 / 72;

let pdfjsPromise = null;
async function loadPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist').then((lib) => {
            lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
            return lib;
        });
    }
    return pdfjsPromise;
}

export async function openPdf(data) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data }).promise;
    return { doc, pdfjs };
}

// Renderiza a página como PNG (dataURL) e devolve tamanho em mm.
export async function pdfPageToImage(doc, pageNumber, dpi = 150) {
    const page = await doc.getPage(pageNumber);
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const base = page.getViewport({ scale: 1 });
    return { src: canvas.toDataURL('image/png'), widthMm: base.width * PT_TO_MM, heightMm: base.height * PT_TO_MM, pageCount: doc.numPages };
}

// ---------------------------------------------------------------------------
// Vetorização: interpreta a lista de operadores da página.

function mul(m, n) {
    // Produto de matrizes afins [a b c d e f] (pdf.js: p' = p·M).
    return [
        m[0] * n[0] + m[1] * n[2],
        m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2],
        m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4],
        m[4] * n[1] + m[5] * n[3] + n[5],
    ];
}

function apply(m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function flattenCubic(p0, p1, p2, p3, segments = 12) {
    const out = [];
    for (let i = 1; i <= segments; i += 1) {
        const t = i / segments;
        const mt = 1 - t;
        out.push({
            x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
            y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
        });
    }
    return out;
}

// Converte subcaminhos acumulados em entidades (pontos já em mm).
function emitSubpaths(subpaths, layer, entities) {
    subpaths.forEach((sp) => {
        const pts = sp.points.filter((p, i) => i === 0 || Math.hypot(p.x - sp.points[i - 1].x, p.y - sp.points[i - 1].y) > 1e-6);
        if (pts.length < 2) return;
        if (pts.length === 2) {
            entities.push({ type: 'line', layer, start: pts[0], end: pts[1] });
            return;
        }
        entities.push({ type: 'polyline', layer, closed: sp.closed, vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })) });
    });
}

// fnArray/argsArray: saída de page.getOperatorList(); OPS: mapa de códigos do pdf.js.
export function operatorListToEntities(fnArray, argsArray, OPS, { layer = 'PDF', unit = PT_TO_MM, baseMatrix = null } = {}) {
    const entities = [];
    const stack = [];
    let ctm = baseMatrix ? [...baseMatrix] : [1, 0, 0, 1, 0, 0];
    let subpaths = [];
    let current = null;
    let cursor = null;
    let start = null;
    const toMm = (p) => ({ x: p.x * unit, y: p.y * unit });
    const moveTo = (x, y) => {
        const p = apply(ctm, x, y);
        current = { points: [toMm(p)], closed: false };
        subpaths.push(current);
        cursor = p;
        start = p;
    };
    const lineTo = (x, y) => {
        const p = apply(ctm, x, y);
        if (!current) moveTo(x, y);
        else current.points.push(toMm(p));
        cursor = p;
    };
    const curveTo = (x1, y1, x2, y2, x3, y3) => {
        if (!cursor) moveTo(x1, y1);
        const p1 = apply(ctm, x1, y1);
        const p2 = apply(ctm, x2, y2);
        const p3 = apply(ctm, x3, y3);
        flattenCubic(cursor, p1, p2, p3).forEach((p) => current.points.push(toMm(p)));
        cursor = p3;
    };
    const closePath = () => {
        if (current) current.closed = true;
        if (start) cursor = start;
        current = null;
    };
    const rectangle = (x, y, w, h) => {
        moveTo(x, y);
        lineTo(x + w, y);
        lineTo(x + w, y + h);
        lineTo(x, y + h);
        closePath();
    };
    const flush = (keep) => {
        if (keep) emitSubpaths(subpaths, layer, entities);
        subpaths = [];
        current = null;
    };
    const pathOps = {
        [OPS.moveTo]: (a, i) => { moveTo(a[i], a[i + 1]); return 2; },
        [OPS.lineTo]: (a, i) => { lineTo(a[i], a[i + 1]); return 2; },
        [OPS.curveTo]: (a, i) => { curveTo(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5]); return 6; },
        [OPS.curveTo2]: (a, i) => { const c = cursor ?? { x: 0, y: 0 }; const inv = ctmInverse(ctm); const cl = apply(inv, c.x, c.y); curveTo(cl.x, cl.y, a[i], a[i + 1], a[i + 2], a[i + 3]); return 4; },
        [OPS.curveTo3]: (a, i) => { curveTo(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 2], a[i + 3]); return 4; },
        [OPS.closePath]: () => { closePath(); return 0; },
        [OPS.rectangle]: (a, i) => { rectangle(a[i], a[i + 1], a[i + 2], a[i + 3]); return 4; },
    };
    const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter((v) => v !== undefined));
    const discardOps = new Set([OPS.endPath, OPS.clip, OPS.eoClip].filter((v) => v !== undefined));

    for (let k = 0; k < fnArray.length; k += 1) {
        const fn = fnArray[k];
        const args = argsArray[k];
        if (fn === OPS.save) stack.push([...ctm]);
        else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = mul(args, ctm);
        else if (fn === OPS.paintFormXObjectBegin) {
            stack.push([...ctm]);
            if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(args[0], ctm);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.constructPath) {
            const ops = args[0] ?? [];
            const coords = args[1] ?? [];
            let ci = 0;
            ops.forEach((op) => {
                const handler = pathOps[op];
                if (handler) ci += handler(coords, ci);
            });
        } else if (fn === OPS.moveTo || fn === OPS.lineTo || fn === OPS.curveTo || fn === OPS.closePath || fn === OPS.rectangle) {
            const handler = pathOps[fn];
            if (handler) handler(args ?? [], 0);
        } else if (strokeOps.has(fn)) {
            if (fn === OPS.closeStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) closePath();
            flush(true);
        } else if (discardOps.has(fn)) flush(false);
    }
    flush(false);
    return entities;
}

function ctmInverse(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0];
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export async function pdfPageToEntities(doc, pageNumber, pdfjs, { layer = 'PDF' } = {}) {
    const page = await doc.getPage(pageNumber);
    const list = await page.getOperatorList();
    // Normaliza a origem: a caixa da página pode não começar em (0,0).
    const view = page.view ?? [0, 0, 0, 0];
    const base = [1, 0, 0, 1, -view[0], -view[1]];
    return operatorListToEntities(list.fnArray, list.argsArray, pdfjs.OPS, { layer, baseMatrix: base });
}

export { PT_TO_MM };
