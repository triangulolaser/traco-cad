// Link traco-cad://open: outra aplicação web entrega um desenho ao Traço desktop
// sem passar por arquivo em disco. O texto vai comprimido (deflate-raw) em
// base64url no parâmetro `z`; o app instalado registra o esquema no sistema.

export const DESKTOP_LINK_SCHEME = 'traco-cad';
// Navegadores recusam URLs perto de 2 MB; acima disso o chamador usa o Traço web.
export const DESKTOP_LINK_MAX_LENGTH = 1_500_000;

function toBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function buildDesktopOpenLink({ name, text }) {
    const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
    const params = new URLSearchParams({ name: name || 'desenho.dxf', z: toBase64Url(packed) });
    return `${DESKTOP_LINK_SCHEME}://open?${params}`;
}

// Devolve { name, text } ou null quando o link não é um traco-cad://open válido.
export async function parseDesktopOpenLink(link) {
    let url;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== `${DESKTOP_LINK_SCHEME}:` || url.hostname !== 'open') return null;
    const z = url.searchParams.get('z');
    if (!z) return null;
    const raw = await pipe(fromBase64Url(z), new DecompressionStream('deflate-raw'));
    const name = (url.searchParams.get('name') || 'desenho.dxf').split(/[\\/]/).pop() || 'desenho.dxf';
    return { name, text: new TextDecoder().decode(raw) };
}
