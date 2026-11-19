// Native files store each raster once. Geometry and document objects are never mutated.
export function packNativeImages(value) {
    const images = {};
    const ids = new Map();
    const visit = v => {
        if (Array.isArray(v)) return v.map(visit);
        if (!v || typeof v !== 'object') return v;
        const result = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
        if (v.type === 'image' && typeof v.src === 'string' && v.src) {
            if (!ids.has(v.src)) {
                const id = `img${ids.size + 1}`;
                ids.set(v.src, id);
                images[id] = v.src;
            }
            delete result.src;
            result.imagem_ref = ids.get(v.src);
        }
        return result;
    };
    return { value: visit(value), images };
}

export function unpackNativeImages(value, images) {
    const visit = v => {
        if (Array.isArray(v)) return v.map(visit);
        if (!v || typeof v !== 'object') return v;
        const result = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
        if (v.type === 'image' && v.imagem_ref !== undefined) {
            if (!images || !Object.hasOwn(images, v.imagem_ref) || typeof images[v.imagem_ref] !== 'string' || !images[v.imagem_ref]) {
                throw new Error('Imagem ausente no arquivo .traco.');
            }
            result.src = images[v.imagem_ref];
            delete result.imagem_ref;
        }
        return result;
    };
    return visit(value);
}

// Photos used as drawing references: at most 3072 pixels, JPEG quality 90%.
// Do not fetch external URLs, upscale, discard transparency, or replace with a larger result.
export async function optimizeRasterSource(src) {
    if (typeof document === 'undefined' || typeof Image === 'undefined' || !src.startsWith('data:')) return src;
    const base64 = src.slice(src.indexOf(',') + 1);
    const jpeg = base64.startsWith('/9j/');
    const png = base64.startsWith('iVBORw0KGgo');
    if ((!jpeg && !png) || src.length < 1024 * 1024) return src;
    let image;
    try {
        image = new Image();
        image.src = src;
        await image.decode();
        const scale = Math.min(1, 3072 / Math.max(image.naturalWidth, image.naturalHeight));
        if (png && scale === 1) return src;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return src;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const candidate = canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9);
        canvas.width = canvas.height = 0;
        return candidate.length < src.length && candidate.startsWith('data:image/') ? candidate : src;
    } catch {
        // A codec failure must not remove a user's image or prevent saving the original.
        return src;
    } finally {
        if (image) image.src = '';
    }
}

export async function prepareNativeImages(doc, { optimize = optimizeRasterSource } = {}) {
    const sources = new Map();
    const collect = value => {
        if (!value || typeof value !== 'object') return;
        if (value.type === 'image' && typeof value.src === 'string' && !value.imageOptimized) sources.set(value.src, value.src);
        for (const x of Object.values(value)) collect(x);
    };
    collect(doc);
    // Sequential conversion bounds decoded bitmap memory; duplicates share one conversion.
    for (const src of sources.keys()) sources.set(src, await optimize(src));
    const copy = value => {
        if (Array.isArray(value)) return value.map(copy);
        if (!value || typeof value !== 'object') return value;
        const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
        if (value.type === 'image' && sources.has(value.src)) {
            result.src = sources.get(value.src);
            if (result.src !== value.src) result.imageOptimized = true;
        }
        return result;
    };
    return copy(doc);
}
