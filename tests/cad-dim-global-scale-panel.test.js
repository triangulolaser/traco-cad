import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureDimensionSetup } from '../src/cad/dimensions.js';
import { createDocument, addEntities } from '../src/cad/document.js';

test('painel sem seleção grava o estilo de cota por commit (editor.doc só tem getter)', () => {
    const src = readFileSync(resolve('src/cad.js'), 'utf8');
    const start = src.indexOf("['dimOverallScale', 'scale']");
    const block = src.slice(start, src.indexOf("input.addEventListener('change', apply);", start));
    assert.ok(block.includes("editor.commit('Estilo de cota'"), 'aplica via commit');
    assert.ok(!/editor\.doc\s*=[^=]/.test(block), 'não atribui editor.doc');
});

test('escala geral digitada (inclusive 1) não é sobrescrita pela auto-escala ao cotar', () => {
    const doc = addEntities(createDocument(), [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, layer: '0' }]);
    let present = { ...doc, dimStyle: { ...(doc.dimStyle ?? {}), scale: 1, scaleManual: true } };
    const editor = { history: { get present() { return present; }, set present(v) { present = v; } }, get doc() { return present; }, log() {}, onChange() {} };
    ensureDimensionSetup(editor);
    assert.equal(present.dimStyle.scale, 1);
    present = { ...present, dimStyle: { ...present.dimStyle, scaleManual: false } };
    ensureDimensionSetup(editor);
    assert.equal(present.dimStyle.scale, 30);
});
