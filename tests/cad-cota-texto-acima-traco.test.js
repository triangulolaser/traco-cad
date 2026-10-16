import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';

const source = readFileSync(new URL('./fixtures/cad-cota-traco-sem-dimtad.dxf', import.meta.url), 'utf8');

const dims = (text) => parseDxf(text, { preserveDimensions: true }).entities.filter((e) => e.type === 'dimension');
const byText = (list, t) => list.find((d) => d.textOverride === t);

function assertAbove(list) {
    // 2410 horizontal: linha em y=111.4, texto acima. 506,29 vertical: linha em x=276.1, texto à esquerda (base virada para a linha).
    const h = dimensionGeometry(byText(list, '2410'), byText(list, '2410').style ?? {});
    assert.ok(h.texts[0].position.y > 111.399248, `2410 acima da linha (y=${h.texts[0].position.y})`);
    const v = dimensionGeometry(byText(list, '506,29'), byText(list, '506,29').style ?? {});
    assert.ok(v.texts[0].position.x < 276.125, `506,29 à esquerda da linha (x=${v.texts[0].position.x})`);
}

test('DXF salvo pelo Traço sem DIMTAD: texto da cota fica acima / à esquerda da linha', () => {
    assertAbove(dims(source));
});

test('Traço grava DIMTAD=1 e o texto continua acima depois de salvar e reabrir', () => {
    const doc = parseDxf(source, { preserveDimensions: true });
    const out = writeDxf(doc);
    assert.match(out, /AcDbDimStyleTableRecord\n2\nTRACO_DIM_\d+[\s\S]*?\n77\n1\n/);
    assertAbove(dims(out));
});
