import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDesktopOpenLink, parseDesktopOpenLink, DESKTOP_LINK_SCHEME } from '../src/cad/desktop-link.js';

const dxf = `0\nSECTION\n2\nENTITIES\n${'0\nLINE\n8\n0\n10\n0\n20\n0\n11\n100\n21\n50\n'.repeat(400)}0\nENDSEC\n0\nEOF\n`;

test('link traco-cad://open devolve nome e texto do desenho', async () => {
    const link = await buildDesktopOpenLink({ name: 'Peça 7 ç.dxf', text: dxf });
    assert.ok(link.startsWith(`${DESKTOP_LINK_SCHEME}://open?`));
    assert.ok(link.length < dxf.length / 4, 'o desenho vai comprimido');
    assert.deepEqual(await parseDesktopOpenLink(link), { name: 'Peça 7 ç.dxf', text: dxf });
});

test('link de outro esquema, sem conteúdo ou com caminho no nome', async () => {
    assert.equal(await parseDesktopOpenLink('https://example.com/open?z=abc'), null);
    assert.equal(await parseDesktopOpenLink(`${DESKTOP_LINK_SCHEME}://open?name=a.dxf`), null);
    assert.equal(await parseDesktopOpenLink('não é url'), null);
    const link = await buildDesktopOpenLink({ name: '../../etc/a.dxf', text: 'x' });
    assert.equal((await parseDesktopOpenLink(link)).name, 'a.dxf');
});

test('app desktop registra o esquema no Mac e encaminha o link para a janela', () => {
    const plist = readFileSync(new URL('../src-tauri/Info.plist', import.meta.url), 'utf8');
    assert.match(plist, /CFBundleURLSchemes<\/key>\s*<array>\s*<string>traco-cad<\/string>/);
    const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
    assert.match(lib, /url\.scheme\(\) == "traco-cad"/);
    assert.match(lib, /get_pending_open_links/);
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(main, /listen\('link-opened'/);
});
