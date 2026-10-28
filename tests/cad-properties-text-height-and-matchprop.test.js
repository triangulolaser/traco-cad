// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDocument, addEntities, replaceEntities } from '../src/cad/document.js';
import { EDIT_COMMANDS } from '../src/cad/edit-commands.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';
import { Editor } from '../src/cad/editor.js';

test('cad.js: inputs de tamanho de texto usam inputmode="decimal" e tratam vírgula e ponto', () => {
    const cadJsPath = resolve(process.cwd(), 'src/cad.js');
    const content = readFileSync(cadJsPath, 'utf-8');

    // Verifica que data-prop="text-height" é inputmode decimal e type text
    assert.match(content, /input type="text" inputmode="decimal" data-prop="text-height"/, 'data-prop="text-height" deve ser text com inputmode decimal');
    // Verifica que data-global-prop="dimTextHeight" é inputmode decimal e type text
    assert.match(content, /input type="text" inputmode="decimal" data-global-prop="dimTextHeight"/, 'data-global-prop="dimTextHeight" deve ser text com inputmode decimal');
    // Verifica existência do parser com replace de vírgula para ponto
    assert.match(content, /parseDecimalInput/, 'Deve possuir função parseDecimalInput');
    assert.match(content, /\.replace\(',',\s*'\.'\)/, 'parseDecimalInput deve substituir vírgula por ponto');
    // Verifica isolamento de eventos de teclado do box
    assert.match(content, /box\._cadKeydownAttached/, 'Deve registrar contenção de eventos keydown no box de propriedades');
});

test('MATCHPROP: copia layer, cor, linetype, lineweight e tamanho de texto entre cotas', async () => {
    let doc = createDocument();
    doc.layers.push({ name: 'COTAS', color: 1, lineType: 'CONTINUOUS', lineWeight: 25, visible: true, locked: false });

    const cotaOrigem = {
        id: 'dim-src',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 100, y: 0 },
        linePoint: { x: 50, y: 20 },
        layer: 'COTAS',
        color: 1, // Vermelho
        lineType: 'DASHED',
        lineWeight: 35,
        textHeight: 4.5,
        style: {
            textHeight: 4.5,
            arrowSize: 3.0,
        },
        fontFamily: 'Liberation Mono',
        bold: true,
        italic: false,
    };

    const cotaDestino = {
        id: 'dim-target',
        type: 'dimension',
        kind: 'vertical',
        p1: { x: 0, y: 0 },
        p2: { x: 0, y: 50 },
        linePoint: { x: -15, y: 25 },
        layer: '0',
        color: 'bylayer',
        lineType: 'bylayer',
        lineWeight: 'bylayer',
        textHeight: 2.5,
        style: {
            textHeight: 2.5,
            arrowSize: 2.5,
        },
    };

    doc = addEntities(doc, [cotaOrigem, cotaDestino]);

    let targetEntity = null;
    let queryStep = 0;

    const mockEditor = {
        doc,
        canvas: { classList: { add() {}, remove() {} } },
        getEntityOrWindow(prompt, opts) { return this.getEntity(prompt, opts); },
        async getEntity(prompt, opts) {
            queryStep++;
            if (queryStep === 1) {
                // Objeto de referência
                return { entity: doc.entities.find(e => e.id === 'dim-src') };
            }
            if (queryStep === 2) {
                // Pincel: clique no destino
                return { entity: doc.entities.find(e => e.id === 'dim-target') };
            }
            // Encerra loop
            return null;
        },
        commit(label, newDoc) {
            targetEntity = newDoc.entities.find(e => e.id === 'dim-target');
            doc = newDoc;
        },
    };

    await EDIT_COMMANDS.MATCHPROP.run(mockEditor);

    assert.ok(targetEntity, 'Cota de destino deve ter sido atualizada');
    assert.equal(targetEntity.layer, 'COTAS', 'Deve copiar layer');
    assert.equal(targetEntity.color, 1, 'Deve copiar cor');
    assert.equal(targetEntity.lineType, 'DASHED', 'Deve copiar tipo de linha');
    assert.equal(targetEntity.lineWeight, 35, 'Deve copiar espessura');
    assert.equal(targetEntity.textHeight, 4.5, 'Deve copiar textHeight');
    assert.equal(targetEntity.style?.textHeight, 4.5, 'Deve copiar style.textHeight');
    assert.equal(targetEntity.style?.arrowSize, 3.0, 'Deve copiar arrowSize de estilo');
    assert.equal(targetEntity.fontFamily, 'Liberation Mono', 'Deve copiar fontFamily');
    assert.equal(targetEntity.bold, true, 'Deve copiar bold');

    // Validar cálculo geométrico com as propriedades copiadas
    const geo = dimensionGeometry(targetEntity, doc.dimStyle);
    assert.equal(geo.texts[0].height, 4.5, 'Texto renderizado da cota de destino deve ter altura 4.5');
});

test('MATCHPROP: copia propriedades e textHeight entre texto e cota de forma bidirecional', async () => {
    let doc = createDocument();
    doc.layers.push({ name: 'TEXTOS', color: 2, lineType: 'CONTINUOUS', lineWeight: 15, visible: true, locked: false });

    const textoOrigem = {
        id: 'txt-src',
        type: 'text',
        text: 'NOTA IMPORTANTE',
        position: { x: 10, y: 10 },
        height: 6.0,
        layer: 'TEXTOS',
        color: 2,
        lineType: 'CONTINUOUS',
        lineWeight: 15,
        fontFamily: 'Arial',
        bold: true,
    };

    const cotaDestino = {
        id: 'dim-target',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 50, y: 0 },
        linePoint: { x: 25, y: 10 },
        layer: '0',
        color: 'bylayer',
        textHeight: 2.5,
    };

    doc = addEntities(doc, [textoOrigem, cotaDestino]);

    let targetDim = null;
    let queryStep = 0;

    let mockEditor = {
        doc,
        canvas: { classList: { add() {}, remove() {} } },
        getEntityOrWindow(prompt, opts) { return this.getEntity(prompt, opts); },
        async getEntity() {
            queryStep++;
            if (queryStep === 1) return { entity: doc.entities.find(e => e.id === 'txt-src') };
            if (queryStep === 2) return { entity: doc.entities.find(e => e.id === 'dim-target') };
            return null;
        },
        commit(label, newDoc) {
            targetDim = newDoc.entities.find(e => e.id === 'dim-target');
            doc = newDoc;
        },
    };

    await EDIT_COMMANDS.MATCHPROP.run(mockEditor);

    assert.ok(targetDim, 'Cota de destino deve ser atualizada');
    assert.equal(targetDim.layer, 'TEXTOS');
    assert.equal(targetDim.color, 2);
    assert.equal(targetDim.textHeight, 6.0, 'Deve transferir height do texto para textHeight da cota');
    assert.equal(targetDim.style?.textHeight, 6.0);
    assert.equal(targetDim.fontFamily, 'Arial');
    assert.equal(targetDim.bold, true);

    // Agora da cota para um novo texto:
    const textoDestino = {
        id: 'txt-target',
        type: 'text',
        text: 'DETALHE',
        position: { x: 50, y: 50 },
        height: 2.0,
        layer: '0',
        color: 'bylayer',
    };
    doc = addEntities(doc, [textoDestino]);

    let targetTxt = null;
    queryStep = 0;
    mockEditor = {
        doc,
        canvas: { classList: { add() {}, remove() {} } },
        getEntityOrWindow(prompt, opts) { return this.getEntity(prompt, opts); },
        async getEntity() {
            queryStep++;
            if (queryStep === 1) return { entity: doc.entities.find(e => e.id === 'dim-target') };
            if (queryStep === 2) return { entity: doc.entities.find(e => e.id === 'txt-target') };
            return null;
        },
        commit(label, newDoc) {
            targetTxt = newDoc.entities.find(e => e.id === 'txt-target');
            doc = newDoc;
        },
    };

    await EDIT_COMMANDS.MATCHPROP.run(mockEditor);

    assert.ok(targetTxt, 'Texto de destino deve ser atualizado');
    assert.equal(targetTxt.layer, 'TEXTOS');
    assert.equal(targetTxt.color, 2);
    assert.equal(targetTxt.height, 6.0, 'Deve transferir textHeight da cota para height do texto');
    assert.equal(targetTxt.fontFamily, 'Arial');
    assert.equal(targetTxt.bold, true);
});

test('editor.js: onKeyDown não rouba foco nem dispara comandos do CAD quando usuário digita em input dentro de this.root', () => {
    // Simula ambiente de DOM com input focado dentro do container root
    let terminalFocused = false;
    let commandExecuted = null;

    const mockRoot = {
        contains(element) {
            return true; // Simula input que está dentro de this.root (painel de propriedades)
        },
    };

    const mockInput = {
        tagName: 'INPUT',
        isContentEditable: false,
        value: '4,5',
        blurred: false,
        blur() {
            this.blurred = true;
        },
    };

    const mockTerminal = {
        isFocused() {
            return false;
        },
        focus() {
            terminalFocused = true;
        },
        value() {
            return '';
        },
    };

    // Cria instância com mock de métodos para validar isolamento
    const editorProto = Editor.prototype;

    const dummyEditor = {
        terminal: mockTerminal,
        root: mockRoot,
        selection: new Set(['dim-1']),
        pending: null,
        activeGrip: null,
        executeCommand(cmd) {
            commandExecuted = cmd;
        },
        runCommand(cmd) {
            commandExecuted = cmd;
        },
        cancel() {},
    };

    // Configura global document.activeElement para o input mockado
    const originalDoc = globalThis.document;
    // @ts-ignore
    globalThis.document = { activeElement: mockInput };

    try {
        // 1. Tecla '4' digitada no input
        editorProto.onKeyDown.call(dummyEditor, {
            key: '4',
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            isComposing: false,
            preventDefault() {},
        });

        assert.equal(terminalFocused, false, 'Não deve roubar foco para o terminal ao digitar caractere no input');

        // 2. Tecla 'Delete' pressionada no input
        editorProto.onKeyDown.call(dummyEditor, {
            key: 'Delete',
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            isComposing: false,
            preventDefault() {},
        });

        assert.equal(commandExecuted, null, 'Não deve executar ERASE ao pressionar Delete dentro do input');

        // 3. Tecla 'Escape' pressionada no input
        let stageFocused = false;
        dummyEditor.stage = {
            focus() {
                stageFocused = true;
            },
        };

        editorProto.onKeyDown.call(dummyEditor, {
            key: 'Escape',
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            isComposing: false,
            preventDefault() {},
        });

        assert.equal(mockInput.blurred, true, 'Escape deve chamar blur() no input');
        assert.equal(stageFocused, true, 'Escape deve devolver foco ao stage');
    } finally {
        globalThis.document = originalDoc;
    }
});

test('MATCHPROP: cota já selecionada vira referência e o primeiro clique é o destino', async () => {
    let doc = addEntities(createDocument(), [
        { id: 'src', type: 'dimension', layer: 'COTAS', color: 1, textHeight: 5 },
        { id: 'dst', type: 'dimension', layer: '0', color: 7, textHeight: 2.5 },
    ]);
    const prompts = [];
    let step = 0;
    const editor = {
        get doc() { return doc; },
        selection: new Set(['src']),
        canvas: { classList: { add() {}, remove() {} } },
        log() {},
        getEntityOrWindow(prompt, opts) { return this.getEntity(prompt, opts); },
        async getEntity(prompt) {
            prompts.push(prompt);
            step++;
            return step === 1 ? { entity: doc.entities.find(x => x.id === 'dst') } : null;
        },
        commit(label, next) { doc = next; },
    };
    await EDIT_COMMANDS.MATCHPROP.run(editor);
    assert.ok(!prompts.includes('Objeto de referência'), 'não deve pedir a referência de novo');
    const dst = doc.entities.find(x => x.id === 'dst');
    assert.equal(dst.layer, 'COTAS');
    assert.equal(dst.color, 1);
    assert.equal(dst.textHeight, 5);
});

test('MATCHPROP: caixa de seleção aplica a referência a vários destinos de uma vez', async () => {
    let doc = addEntities(createDocument(), [
        { id: 'src', type: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, layer: 'CORTE', color: 1, lineType: 'DASHED', lineWeight: 35 },
        { id: 'l1', type: 'line', a: { x: 0, y: 5 }, b: { x: 1, y: 5 }, layer: '0', color: 7 },
        { id: 'l2', type: 'line', a: { x: 0, y: 9 }, b: { x: 1, y: 9 }, layer: '0', color: 3 },
        { id: 'fora', type: 'line', a: { x: 50, y: 50 }, b: { x: 51, y: 50 }, layer: '0', color: 3 },
    ]);
    doc.layers.push({ name: 'CORTE', color: 1, visible: true, locked: false });
    let step = 0;
    let commits = 0;
    let lastOpts = null;
    const editor = {
        get doc() { return doc; },
        selection: new Set(),
        canvas: { classList: { add() {}, remove() {} } },
        log() {},
        async getEntity() { return { entity: doc.entities.find((x) => x.id === 'src') }; },
        async getEntityOrWindow(prompt, opts) {
            lastOpts = opts;
            step++;
            // A caixa pega também a própria referência: ela não conta como destino.
            return step === 1 ? { entities: doc.entities.filter((x) => x.id !== 'fora'), crossing: false } : null;
        },
        commit(label, next) { commits++; doc = next; },
    };
    await EDIT_COMMANDS.MATCHPROP.run(editor);
    assert.equal(lastOpts.directional, true, 'MA usa janela/crossing pela direção do arraste');
    assert.equal(commits, 1, 'uma caixa vira um único passo de desfazer');
    for (const id of ['l1', 'l2']) {
        const x = doc.entities.find((e) => e.id === id);
        assert.equal(x.layer, 'CORTE');
        assert.equal(x.color, 1);
        assert.equal(x.lineType, 'DASHED');
        assert.equal(x.lineWeight, 35);
    }
    assert.equal(doc.entities.find((e) => e.id === 'fora').color, 3);
});

test('entityOrWindow: directional segue a direção do arraste; sem ela continua sempre crossing', () => {
    const run = (directional, from, to) => {
        let resolved = null;
        let crossingArg = null;
        const dummy = {
            window: { a: from },
            pending: { mode: 'entityOrWindow', directional },
            entitiesInWindow(a, b, crossing) { crossingArg = crossing; return []; },
            resolvePending(v) { resolved = v; },
            invalidate() {},
            onChange() {},
            log() {},
        };
        Editor.prototype.finishWindow.call(dummy, to, {});
        return { crossingArg, resolved };
    };
    assert.equal(run(true, { x: 0, y: 0 }, { x: 10, y: 10 }).crossingArg, false, 'esquerda→direita = janela');
    assert.equal(run(true, { x: 10, y: 0 }, { x: 0, y: 10 }).crossingArg, true, 'direita→esquerda = crossing');
    assert.equal(run(undefined, { x: 0, y: 0 }, { x: 10, y: 10 }).crossingArg, true, 'TRIM/EXTEND continuam crossing');
});

test('MATCHPROP: com Shift o clique ou a caixa devolve as propriedades originais e o pincel continua', async () => {
    let doc = addEntities(createDocument(), [
        { id: 'src', type: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, layer: 'CORTE', color: 1, lineType: 'DASHED', lineWeight: 35 },
        { id: 'l1', type: 'line', a: { x: 0, y: 5 }, b: { x: 1, y: 5 }, layer: '0', color: 7 },
        { id: 'l2', type: 'line', a: { x: 0, y: 9 }, b: { x: 1, y: 9 }, layer: '0', color: 3, lineType: 'CENTER' },
        { id: 'l3', type: 'line', a: { x: 0, y: 12 }, b: { x: 1, y: 12 }, layer: '0', color: 5 },
    ]);
    doc.layers.push({ name: 'CORTE', color: 1, visible: true, locked: false });
    const by = (id) => doc.entities.find((x) => x.id === id);
    const picks = [
        () => ({ entities: [by('l1'), by('l2')] }),
        () => ({ entities: [by('l1'), by('l2'), by('l3')], shift: true }),
        () => ({ entity: by('l1') }),
    ];
    let commits = 0;
    let snapshot = null;
    const editor = {
        get doc() { return doc; },
        selection: new Set(),
        canvas: { classList: { add() {}, remove() {} } },
        log() {},
        async getEntity() { return { entity: by('src') }; },
        async getEntityOrWindow() {
            if (picks.length === 2) snapshot = structuredClone(doc.entities);
            const next = picks.shift();
            return next ? next() : null;
        },
        commit(label, next) { commits++; doc = next; },
    };
    await EDIT_COMMANDS.MATCHPROP.run(editor);
    assert.equal(commits, 3, 'caixa do Shift sem objeto mudado (l3) não cria passo extra');
    assert.equal(by('l2').color, 3);
    assert.equal(by('l2').lineType, 'CENTER');
    assert.equal(by('l2').layer, '0');
    assert.ok(!('lineWeight' in by('l2')), 'propriedade que não existia volta a não existir');
    assert.equal(by('l3').color, 5, 'Shift não mexe em quem o pincel não mudou');
    assert.equal(by('l1').color, 1, 'soltar o Shift volta a aplicar');
    assert.equal(snapshot.find((x) => x.id === 'l2').color, 1);
});
