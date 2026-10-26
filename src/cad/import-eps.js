import { cubicToArcs, simplifyChain, createDxfWriter } from './import-svg.js';

// EPS do CorelDRAW → DXF (LINE/ARC) para os importadores de corte e o CAD.
// Não é um interpretador PostScript: lê só o corpo da página, onde o Corel
// escreve cada objeto com m/l/c (e as variantes L/C/v/y), @c para fechar e
// Tl/scale/concat entre @gs/@sv e @gr/@rs. O prólogo (procsets e fontes, quase
// todo o tamanho do arquivo) é pulado. Texto (@t … T) fica fora: no acervo
// são cotas, não contorno de corte. Unidade = ponto PostScript (1/72 pol).

const PT_MM = 25.4 / 72;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const compose = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

const MOVE = new Set(['m', 'moveto']);
const LINE = new Set(['l', 'L', 'lineto']);
const CURVE = new Set(['c', 'C', 'curveto']);
const CURVE_V = new Set(['v', 'V']); // 1º controle = ponto atual
const CURVE_Y = new Set(['y', 'Y']); // 2º controle = ponto final
const CLOSE = new Set(['@c', '@cp', 'closepath', 'h', 'H']);
const PAINT = new Set(['S', 's', 'F', 'f', 'B', 'b', 'stroke', 'fill', 'eofill']);
const DISCARD = new Set(['n', 'N', '@np', 'newpath', 'W', 'clip', 'eoclip']);
const SAVE = new Set(['@gs', '@sv', 'gsave', 'save']);
const RESTORE = new Set(['@gr', '@rs', 'grestore', 'restore']);
const TRANSLATE = new Set(['Tl', 'translate']);

// Bytes → texto PostScript. Aceita EPS "DOS" (cabeçalho binário C5 D0 D3 C6 com prévia TIFF/WMF).
export function epsText(input) {
    if (typeof input === 'string') return input;
    let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const off = dv.getUint32(4, true), size = dv.getUint32(8, true);
        bytes = bytes.subarray(off, off + size);
    }
    // latin1: um caractere por byte, sem decodificação que quebre trechos binários do prólogo.
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
}

function* tokens(src, from, to) {
    let i = from;
    while (i < to) {
        const ch = src[i];
        if (ch === '%') { const e = src.indexOf('\n', i); i = e < 0 ? to : e + 1; continue; }
        if (ch <= ' ') { i++; continue; }
        if (ch === '(') { // string literal, com parênteses aninhados e escapes
            let depth = 1, j = i + 1;
            while (j < to && depth) { const c = src[j]; if (c === '\\') j++; else if (c === '(') depth++; else if (c === ')') depth--; j++; }
            yield { str: true }; i = j; continue;
        }
        if (ch === '<' && src[i + 1] !== '<') { const e = src.indexOf('>', i); yield { str: true }; i = e < 0 ? to : e + 1; continue; }
        if ('[]{}'.includes(ch)) { yield { op: ch }; i++; continue; }
        let j = i + 1;
        while (j < to && src[j] > ' ' && !'()[]{}<>%'.includes(src[j]) && !(src[j] === '/' )) j++;
        const word = src.slice(i, j);
        i = j;
        const n = Number(word);
        if (word !== '' && Number.isFinite(n) && /^[-+.\d]/.test(word)) yield { num: n };
        else yield { op: word };
    }
}

export function epsToDxfText(input, { toleranceMm = 0.02 } = {}) {
    const src = epsText(input);
    if (!/^%!PS-Adobe/.test(src.slice(0, 64).replace(/^\s+/, ''))) throw new Error('Arquivo EPS inválido.');
    // Corpo da página: depois do setup (procsets ficam no prólogo) até o trailer.
    let from = src.indexOf('%%Page:');
    if (from < 0) from = src.indexOf('%%EndSetup');
    if (from < 0) from = src.indexOf('%%EndProlog');
    if (from < 0) from = 0;
    let to = src.indexOf('%%Trailer', from);
    if (to < 0) to = src.length;

    const dxf = createDxfWriter();
    const stack = [];
    const saved = [];
    let ctm = IDENTITY, sub = null, subs = [], cur = null, start = null, arrayDepth = 0, arr = null, procDepth = 0;
    const toMm = p => { const q = apply(ctm, p); return { x: q.x * PT_MM, y: q.y * PT_MM }; };
    const pop = k => (stack.length >= k ? stack.splice(stack.length - k, k) : null);
    const flushSub = () => { if (sub?.segs.length) subs.push(sub); sub = null; };
    const close = () => {
        if (sub && cur && start && Math.hypot(cur.x - start.x, cur.y - start.y) > 1e-9) sub.segs.push({ kind: 'line', a: cur, b: start });
        if (sub) sub.closed = true;
        cur = start;
    };
    const paint = () => {
        flushSub();
        for (const s of subs) {
            const fitted = [];
            for (const seg of s.segs) fitted.push(...(seg.kind === 'line' ? [seg] : cubicToArcs(seg.p, toleranceMm)));
            for (const seg of simplifyChain(fitted, toleranceMm)) dxf.emit('0', seg);
        }
        subs = []; cur = start = null;
    };
    const curve = (c1, c2, p) => {
        if (!cur) return;
        const pts = [cur, toMm(c1), toMm(c2), toMm(p)];
        sub.segs.push({ kind: 'cubic', p: pts });
        cur = pts[3];
    };

    for (const t of tokens(src, from, to)) {
        if (t.num !== undefined) { if (arr) arr.push(t.num); else stack.push(t.num); continue; }
        if (t.str) { stack.length = 0; continue; }
        const op = t.op;
        if (procDepth) { if (op === '{') procDepth++; else if (op === '}') procDepth--; continue; }
        if (op === '{') { procDepth = 1; continue; }
        if (op === '[') { arrayDepth++; if (arrayDepth === 1) arr = []; continue; }
        if (op === ']') { if (--arrayDepth <= 0) { arrayDepth = 0; stack.push(arr); arr = null; } continue; }
        if (arr) continue;
        if (MOVE.has(op)) {
            const a = pop(2); if (!a || typeof a[0] !== 'number') { stack.length = 0; continue; }
            flushSub();
            cur = start = toMm({ x: a[0], y: a[1] });
            sub = { segs: [], closed: false };
        } else if (LINE.has(op)) {
            const a = pop(2); if (!a || !cur) { stack.length = 0; continue; }
            const p = toMm({ x: a[0], y: a[1] });
            if (Math.hypot(p.x - cur.x, p.y - cur.y) > 1e-9) sub.segs.push({ kind: 'line', a: cur, b: p });
            cur = p;
        } else if (CURVE.has(op)) {
            const a = pop(6); if (!a) { stack.length = 0; continue; }
            curve({ x: a[0], y: a[1] }, { x: a[2], y: a[3] }, { x: a[4], y: a[5] });
        } else if (CURVE_V.has(op) || CURVE_Y.has(op)) {
            const a = pop(4); if (!a || !cur) { stack.length = 0; continue; }
            const c = { x: a[0], y: a[1] }, p = { x: a[2], y: a[3] };
            // v: o 1º controle coincide com o ponto atual (em espaço do usuário; ctm é afim, então vale em mm).
            if (CURVE_V.has(op)) {
                const pts = [cur, cur, toMm(c), toMm(p)];
                sub.segs.push({ kind: 'cubic', p: pts }); cur = pts[3];
            } else curve(c, p, p);
        } else if (CLOSE.has(op)) close();
        else if (PAINT.has(op)) paint();
        else if (DISCARD.has(op)) { flushSub(); subs = []; cur = start = null; }
        else if (SAVE.has(op)) saved.push(ctm);
        else if (RESTORE.has(op)) { if (saved.length) ctm = saved.pop(); }
        else if (TRANSLATE.has(op)) { const a = pop(2); if (a) ctm = compose(ctm, [1, 0, 0, 1, a[0], a[1]]); }
        else if (op === 'scale') { const a = pop(2); if (a) ctm = compose(ctm, [a[0], 0, 0, a[1], 0, 0]); }
        else if (op === 'concat') { const a = pop(1); if (Array.isArray(a?.[0]) && a[0].length === 6) ctm = compose(ctm, a[0]); }
        else stack.length = 0;
    }
    if (!dxf.count()) throw new Error('EPS sem contornos legíveis. Suportado: EPS exportado pelo CorelDRAW com curvas (texto convertido em curvas).');
    return dxf.text();
}
