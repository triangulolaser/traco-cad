import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Editor } from '../src/cad/editor.js';

if (typeof globalThis.window === 'undefined' || !globalThis.window.addEventListener) {
    globalThis.window = {
        addEventListener() {},
        removeEventListener() {},
        devicePixelRatio: 1,
        history: { replaceState() {} },
    };
}

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        createElement() {
            return { textContent: '', appendChild() {}, className: '', style: {}, setAttribute() {} };
        },
    };
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = () => {};
}

function createMockRoot() {
    const canvas = {
        width: 800,
        height: 600,
        style: {},
        getContext: () => ({
            save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, rect() {}, fillText() {}, strokeText() {}, setLineDash() {}, scale() {}, translate() {},
        }),
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0 }),
    };

    const historyEl = {
        children: [],
        appendChild(el) { this.children.push(el); },
        removeChild(el) { const idx = this.children.indexOf(el); if (idx >= 0) this.children.splice(idx, 1); },
        get firstChild() { return this.children[0] ?? null; },
        scrollTop: 0,
        scrollHeight: 0,
    };
    const inputEl = { addEventListener() {}, focus() {}, setAttribute() {}, value: '' };
    const promptEl = { textContent: '' };

    const terminalContainer = {
        addEventListener() {},
        querySelector(selector) {
            if (selector === '[data-cad-terminal-history]') return historyEl;
            if (selector === '[data-cad-terminal-input]') return inputEl;
            if (selector === '[data-cad-terminal-prompt]') return promptEl;
            return null;
        },
    };

    return {
        addEventListener() {},
        removeEventListener() {},
        querySelector(selector) {
            if (selector === '[data-cad-canvas]') return canvas;
            if (selector === '[data-cad-terminal]') return terminalContainer;
            if (selector === '[data-cad-stage]') return canvas;
            return null;
        },
    };
}

test('openFile: arquivos .dwg com MIME image/vnd.dwg são despachados para importDwgFile e NUNCA para IMAGEATTACH', async () => {
    const root = createMockRoot();
    const editor = new Editor(root, { storage: { getItem: () => null, setItem: () => {} } });

    let importDwgCalled = false;
    let imageAttachCalled = false;

    editor.importDwgFile = async (file) => {
        importDwgCalled = true;
        assert.equal(file.name, 'new block2.dwg');
        return true;
    };

    editor.runCommand = async (cmd) => {
        if (cmd === 'IMAGEATTACH') {
            imageAttachCalled = true;
        }
    };

    // Simula arquivo DWG como reportado pelo macOS/WebKit (MIME IANA oficial: image/vnd.dwg)
    const dwgFile = {
        name: 'new block2.dwg',
        type: 'image/vnd.dwg',
        size: 1024,
        filePath: '/Users/usuario/Downloads/new block2.dwg',
    };

    await editor.openFile(dwgFile);

    assert.ok(importDwgCalled, 'Deve ter chamado importDwgFile para o arquivo .dwg');
    assert.ok(!imageAttachCalled, 'NÃO pode chamar IMAGEATTACH para arquivo .dwg mesmo com MIME image/vnd.dwg');
});

test('openFile: arquivos de imagem raster (PNG, JPG) continuam sendo despachados para IMAGEATTACH', async () => {
    const root = createMockRoot();
    const editor = new Editor(root, { storage: { getItem: () => null, setItem: () => {} } });

    let imageAttachCalled = false;
    let attachedFile = null;

    editor.runCommand = async (cmd) => {
        if (cmd === 'IMAGEATTACH') {
            imageAttachCalled = true;
            attachedFile = editor.pendingDropFile;
        }
    };

    const pngFile = {
        name: 'planta.png',
        type: 'image/png',
        size: 2048,
    };

    await editor.openFile(pngFile);

    assert.ok(imageAttachCalled, 'Deve chamar IMAGEATTACH para imagem PNG');
    assert.equal(attachedFile.name, 'planta.png');
});

test('openFile: arquivos .dxf com MIME image/vnd.dxf são despachados para importDxfText', async () => {
    const root = createMockRoot();
    const editor = new Editor(root, { storage: { getItem: () => null, setItem: () => {} } });

    let importDxfCalled = false;

    editor.importDxfText = async (text, name) => {
        importDxfCalled = true;
        assert.equal(name, 'desenho.dxf');
        return true;
    };

    editor.runCommand = async (cmd) => {
        if (cmd === 'IMAGEATTACH') {
            assert.fail('NÃO pode chamar IMAGEATTACH para arquivo .dxf');
        }
    };

    const dxfFile = {
        name: 'desenho.dxf',
        type: 'image/vnd.dxf',
        size: 512,
        text: async () => '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF',
    };

    await editor.openFile(dxfFile);

    assert.ok(importDxfCalled, 'Deve ter chamado importDxfText para o arquivo .dxf');
});
