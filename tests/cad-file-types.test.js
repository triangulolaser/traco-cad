import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { FILE_TYPES, OPENABLE_EXTENSIONS, DRAWING_ACCEPT, DRAWING_KINDS, kindOf, iconOf, extensionOf } from '../src/cad/file-types.js';
import { COMMANDS } from '../src/cad/commands.js';

test('toda extensão conhecida abre, tem ícone e tem tipo válido', () => {
    const tipos = new Set(['dwg', 'dxf', 'lxds', 'pdf', 'image', 'svg', 'cdr', 'elmt', 'qet']);
    Object.entries(FILE_TYPES).forEach(([ext, t]) => {
        assert.ok(tipos.has(t.kind), `${ext} com tipo desconhecido: ${t.kind}`);
        assert.ok(t.icon && t.icon.length > 0, `${ext} sem ícone`);
        assert.ok(OPENABLE_EXTENSIONS.has(ext), `${ext} fora do portão da árvore`);
        assert.equal(iconOf(ext.toUpperCase()), t.icon, `${ext} sem ícone por maiúscula`);
    });
    assert.equal(iconOf('zzz'), 'file-earmark');
});

test('formatos de desenho entram no accept do seletor', () => {
    const noAccept = DRAWING_ACCEPT.split(',');
    Object.entries(FILE_TYPES).forEach(([ext, t]) => {
        const esperado = DRAWING_KINDS.includes(t.kind);
        assert.equal(noAccept.includes(`.${ext}`), esperado, `.${ext} no accept deveria ser ${esperado}`);
    });
    // Imagem e PDF têm comando próprio e não entram no seletor de desenho.
    assert.ok(!noAccept.includes('.png') && !noAccept.includes('.pdf'));
    assert.ok(noAccept.includes('.dxf') && noAccept.includes('.lxds') && noAccept.includes('.svg') && noAccept.includes('.elmt') && noAccept.includes('.qet'));
});

test('kindOf aceita extensão nua e nome de arquivo, em qualquer caixa', () => {
    assert.equal(kindOf('lxds'), 'lxds');
    assert.equal(kindOf('MS 1,20 mm - #41297.LXDS'), 'lxds');
    assert.equal(kindOf('peça.dxf'), 'dxf');
    assert.equal(kindOf('programa.CNC'), null);
    assert.equal(kindOf('foto.jpeg'), 'image');
    assert.equal(kindOf('planilha.xlsx'), null);
    assert.equal(kindOf(undefined), null);
    assert.equal(extensionOf('sem extensão'), '');
});

// A regressão real: .lxds tinha importador, comando e accept, mas ficava de fora do portão
// da árvore do laser, e clicar no arquivo respondia "Tipo .lxds não abre no CAD".
test('o accept do input no HTML/blade cobre os formatos de desenho', () => {
    const bladeUrl = new URL('../index.html', import.meta.url);
    const htmlUrl = new URL('../index.html', import.meta.url);
    const htmlContent = existsSync(bladeUrl) ? readFileSync(bladeUrl, 'utf8') : readFileSync(htmlUrl, 'utf8');
    const m = /data-cad-file-input accept="([^"]+)"/.exec(htmlContent);
    assert.ok(m, 'input de arquivo sem accept no HTML/blade');
    const noBlade = m[1].split(',');
    DRAWING_ACCEPT.split(',').forEach((ext) => {
        assert.ok(noBlade.includes(ext), `${ext} falta no accept do HTML/blade`);
    });
});

test('cada tipo de desenho tem comando de abertura', () => {
    assert.ok(COMMANDS.OPEN, 'OPEN ausente');
    assert.ok(COMMANDS.LXDS, 'LXDS ausente');
    assert.ok(COMMANDS.SVG, 'SVG ausente');
    assert.ok(COMMANDS.CDR, 'CDR ausente');
    assert.ok(COMMANDS.ELMT, 'ELMT ausente');
    assert.ok(COMMANDS.EXPORTELMT, 'EXPORTELMT ausente');
    assert.ok(COMMANDS.QET, 'QET ausente');
    assert.ok(COMMANDS.EXPORTQET, 'EXPORTQET ausente');
    assert.ok(COMMANDS.TERMINAL, 'TERMINAL ausente');
});
