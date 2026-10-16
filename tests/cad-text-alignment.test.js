import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { textBox, transformEntity } from '../src/cad/geometry.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { openTextEditorModal } from '../src/cad/text-editor.js';

test('DXF: MTEXT com \\pxqc; adota alinhamento center mesmo com attachmentPoint 1 (Top-Left)', () => {
    const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'MTEXT',
        '8', 'TITULOS',
        '10', '4181.668',
        '20', '1532.337',
        '40', '100.0',
        '41', '642.651',
        '71', '1', // Top-Left
        '1', '\\pxqc;Reservatório Basculante',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 1);
    const m = parsed.entities[0];
    assert.equal(m.type, 'text');
    assert.equal(m.isMText, true);
    assert.equal(m.halign, 'center');
    assert.equal(m.valign, 'top');
    assert.equal(m.boxWidth, 642.651);
    assert.equal(m.text, 'Reservatório Basculante');
});

test('DXF: MTEXT extrai fontes tipográficas inline (\\fArial, \\fTimes New Roman) e estilos negrito/itálico', () => {
    const dxf = [
        '0', 'SECTION', '2', 'ENTITIES',
        '0', 'MTEXT',
        '8', 'LEGENDA',
        '10', '100.0',
        '20', '200.0',
        '40', '5.0',
        '71', '1',
        '1', '{\\fTimes New Roman|b0|i1|c0|p18;Eng. Resp.:}',
        '0', 'MTEXT',
        '8', 'LEGENDA',
        '10', '300.0',
        '20', '200.0',
        '40', '6.0',
        '71', '1',
        '1', '{\\fArial|b1|i0|c0|p34;Traço}',
        '0', 'ENDSEC',
        '0', 'EOF',
    ].join('\n');

    const parsed = parseDxf(dxf);
    assert.equal(parsed.entities.length, 2);

    const t1 = parsed.entities[0];
    assert.equal(t1.fontFamily, 'Times New Roman');
    assert.equal(t1.bold, false);
    assert.equal(t1.italic, true);
    assert.equal(t1.text, 'Eng. Resp.:');

    const t2 = parsed.entities[1];
    assert.equal(t2.fontFamily, 'Arial');
    assert.equal(t2.bold, true);
    assert.equal(t2.italic, false);
    assert.equal(t2.text, 'Traço');
});

test('Geometria: textBox projeta MTEXT com boxWidth e quebra de palavras centrada sem extrapolar a largura', () => {
    const entity = {
        type: 'text',
        position: { x: 4181.668, y: 1532.337 },
        height: 100,
        text: 'Reservatório Basculante',
        attachmentPoint: 1, // Top-Left
        halign: 'center',
        valign: 'top',
        boxWidth: 642.651,
    };

    const box = textBox(entity);
    assert.equal(box.length, 4);

    const xs = box.map((p) => p.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const centerX = (minX + maxX) / 2;

    // O centro do retângulo da entidade deve ser aproximadamente insertionPoint.x + boxWidth / 2 = 4181.668 + 321.325 = 4502.99
    const expectedCenter = 4181.668 + 642.651 / 2;
    assert.ok(Math.abs(centerX - expectedCenter) < 1.0, `Centro calculado (${centerX}) deve ser próximo de ${expectedCenter}`);

    // Com quebra de linhas para as duas palavras, a largura do envelope deve respeitar o boxWidth
    const envelopeWidth = maxX - minX;
    assert.ok(envelopeWidth <= 642.651 * 1.05, `Envelope (${envelopeWidth}) não deve extrapolar o boxWidth (642.651)`);
});

test('Títulos de painéis no Diagrama Eletrônica não se sobrepõem', () => {
    // Painel 1: Reservatório Basculante
    const t1 = {
        type: 'text',
        position: { x: 4181.668553403968, y: 1532.3373897674815 },
        height: 100,
        text: 'Reservatório Basculante',
        attachmentPoint: 1,
        halign: 'center',
        valign: 'top',
        boxWidth: 642.6514544227794,
    };

    // Painel 2: Reservatório Fixo
    const t2 = {
        type: 'text',
        position: { x: 5097.827867899484, y: 1532.3373897674815 },
        height: 100,
        text: 'Reservatório Fixo',
        attachmentPoint: 1,
        halign: 'center',
        valign: 'top',
        boxWidth: 642.6514544227794,
    };

    const box1 = textBox(t1);
    const box2 = textBox(t2);

    const max1X = Math.max(...box1.map((p) => p.x));
    const min2X = Math.min(...box2.map((p) => p.x));

    // Deve existir espaço livre claro entre os dois títulos (sem sobreposição)
    assert.ok(max1X < min2X, `O título 1 (max X: ${max1X}) deve terminar antes do título 2 (min X: ${min2X})`);
    const gap = min2X - max1X;
    assert.ok(gap > 100, `Deve haver folga visível (>100 unidades) entre os títulos, encontrado: ${gap}`);
});

test('transformEntity escala boxWidth proporcionalmente ao fator de escala do texto', () => {
    const entity = {
        type: 'text',
        position: { x: 10, y: 20 },
        height: 10,
        rotation: 0,
        text: 'TEXTO',
        boxWidth: 100,
    };

    // Escala 2x
    const scaled = transformEntity(entity, (p) => ({ x: p.x * 2, y: p.y * 2 }));
    assert.equal(scaled.height, 20);
    assert.equal(scaled.boxWidth, 200);
});

test('DXF Roundtrip: writeDxf preserva MTEXT com boxWidth e justificação \\pxqc;', () => {
    const doc = addEntities(createDocument(), [
        {
            type: 'text',
            isMText: true,
            position: { x: 4181.67, y: 1532.34 },
            height: 100,
            rotation: 0,
            text: 'Reservatório Basculante',
            attachmentPoint: 1,
            halign: 'center',
            valign: 'top',
            boxWidth: 642.65,
        },
    ]);

    const dxf = writeDxf(doc);
    assert.match(dxf, /MTEXT/);
    assert.match(dxf, /\n41\n642\.65/);
    assert.match(dxf, /\\pxqc;Reservat\\U\+00F3rio Basculante/);

    const reimported = parseDxf(dxf);
    assert.equal(reimported.entities.length, 1);
    const t = reimported.entities[0];
    assert.equal(t.halign, 'center');
    assert.equal(t.boxWidth, 642.65);
    assert.equal(t.text, 'Reservatório Basculante');
});

test('openTextEditorModal cria interface completa e atualiza documento com novos parâmetros', () => {
    function createMockEl(tag) {
        const eventListeners = {};
        const attrs = {};
        const el = {
            tagName: tag.toUpperCase(),
            className: '',
            value: '',
            checked: false,
            setAttribute(k, v) { attrs[k] = v; },
            getAttribute(k) { return attrs[k] ?? null; },
            addEventListener(event, fn) {
                (eventListeners[event] = eventListeners[event] || []).push(fn);
            },
            dispatchEvent(evt) {
                (eventListeners[evt.type] || []).forEach((fn) => fn(evt));
            },
            set innerHTML(html) {
                this._html = html;
                this._elements = [];
                const idMatches = [...html.matchAll(/id="([^"]+)"/g)];
                for (const m of idMatches) {
                    const sub = createMockEl('div');
                    sub.id = m[1];
                    this._elements.push(sub);
                }
                const actionMatches = [...html.matchAll(/data-action="([^"]+)"/g)];
                for (const m of actionMatches) {
                    const btn = createMockEl('button');
                    btn.setAttribute('data-action', m[1]);
                    this._elements.push(btn);
                }
            },
            querySelector(selector) {
                if (selector.startsWith('#')) {
                    const id = selector.slice(1);
                    return this._elements?.find((e) => e.id === id) || null;
                }
                if (selector.startsWith('[data-action="')) {
                    const action = selector.match(/data-action="([^"]+)"/)?.[1];
                    return this._elements?.find((e) => e.getAttribute('data-action') === action) || null;
                }
                return null;
            },
            querySelectorAll(selector) {
                if (selector.startsWith('[data-action="')) {
                    const action = selector.match(/data-action="([^"]+)"/)?.[1];
                    return this._elements?.filter((e) => e.getAttribute('data-action') === action) || [];
                }
                return [];
            },
            focus() {},
            setSelectionRange() {},
            remove() {},
        };
        return el;
    }

    const prevDoc = globalThis.document;
    const docKeydown = new Set();
    globalThis.document = {
        createElement: (tag) => createMockEl(tag),
        body: createMockEl('body'),
        addEventListener(type, fn) { if (type === 'keydown') docKeydown.add(fn); },
        removeEventListener(type, fn) { if (type === 'keydown') docKeydown.delete(fn); },
    };
    const pressKey = (init) => [...docKeydown].forEach((fn) => fn({ preventDefault() {}, stopPropagation() {}, ...init }));

    try {
        const entity = {
            id: 'text-1',
            type: 'text',
            position: { x: 50, y: 60 },
            height: 5,
            rotation: 0,
            text: 'Linha Antiga',
            halign: 'left',
            valign: 'top',
            layer: '0',
        };

        const stage = {
            appendChild(el) { this.child = el; },
        };

        let committedDoc = null;
        let committedMsg = '';
        const fakeEditor = {
            stage,
            doc: {
                layers: [{ name: '0', locked: false, visible: true }],
                entities: [entity],
            },
            selection: new Set(),
            commit(msg, doc) {
                committedMsg = msg;
                committedDoc = doc;
            },
            invalidate() {},
            onChange() {},
            log() {},
        };

        // Esc descarta e Ctrl+Enter não salva: confirmar só pelo botão.
        const discarded = openTextEditorModal(fakeEditor, entity);
        discarded.querySelector('#cadTextEditorValue').value = 'Descartar';
        pressKey({ key: 'Enter', ctrlKey: true });
        assert.equal(committedDoc, null, 'Ctrl+Enter não salva');
        pressKey({ key: 'Escape' });
        assert.equal(committedDoc, null, 'Esc descarta');
        assert.equal(docKeydown.size, 0, 'Esc fecha o modal e solta o atalho');

        // Abre o modal
        const overlay = openTextEditorModal(fakeEditor, entity);
        assert.ok(overlay, 'Overlay foi criado');

        // Valida elementos do formulário presentes
        const textarea = overlay.querySelector('#cadTextEditorValue');
        const heightInput = overlay.querySelector('#cadTextEditorHeight');
        const halignSelect = overlay.querySelector('#cadTextEditorHAlign');
        const fontSelect = overlay.querySelector('#cadTextEditorFont');
        const boldCheck = overlay.querySelector('#cadTextEditorBold');

        assert.ok(textarea);
        assert.ok(heightInput);
        assert.ok(halignSelect);
        assert.ok(fontSelect);

        // Altera valores
        textarea.value = 'Linha Editada 1\nLinha Editada 2';
        heightInput.value = '12.5';
        halignSelect.value = 'center';
        fontSelect.value = 'Arial';
        boldCheck.checked = true;

        // Dispara clique em Salvar
        const saveBtn = overlay.querySelector('[data-action="save"]');
        saveBtn.dispatchEvent({ type: 'click', stopPropagation() {} });

        assert.equal(committedMsg, 'Editar Texto');
        assert.ok(committedDoc);
        const updated = committedDoc.entities.find((e) => e.id === 'text-1');
        assert.ok(updated);
        assert.equal(updated.text, 'Linha Editada 1\nLinha Editada 2');
        assert.equal(updated.height, 12.5);
        assert.equal(updated.halign, 'center');
        assert.equal(updated.fontFamily, 'Arial');
        assert.equal(updated.bold, true);
    } finally {
        globalThis.document = prevDoc;
    }
});
