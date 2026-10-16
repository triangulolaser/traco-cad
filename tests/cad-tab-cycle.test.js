import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {} };
if (typeof globalThis.document === 'undefined') globalThis.document = { addEventListener() {}, removeEventListener() {} };

import { TabManager } from '../src/cad.js';

const fakeTabs = (n, activeIndex) => {
    const activated = [];
    const tm = Object.create(TabManager.prototype);
    tm.tabs = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
    tm.activeId = tm.tabs[activeIndex].id;
    tm.activate = (id) => { activated.push(id); tm.activeId = id; };
    return { tm, activated };
};

test('Ctrl+Tab: próximo desenho, voltando ao primeiro depois do último', () => {
    const { tm, activated } = fakeTabs(3, 1);
    tm.cycle(1); tm.cycle(1);
    assert.deepEqual(activated, [3, 1]);
});

test('Ctrl+Shift+Tab: desenho anterior, indo ao último antes do primeiro', () => {
    const { tm, activated } = fakeTabs(3, 0);
    tm.cycle(-1); tm.cycle(-1);
    assert.deepEqual(activated, [3, 2]);
});

test('com um desenho só, Ctrl+Tab não faz nada', () => {
    const { tm, activated } = fakeTabs(1, 0);
    assert.equal(tm.cycle(1), false);
    assert.deepEqual(activated, []);
});

test('editor trata Ctrl+Tab antes do campo de texto e o terminal não o consome', () => {
    const editor = readFileSync(resolve('src/cad/editor.js'), 'utf8');
    const ctrlTab = editor.indexOf("event.key === 'Tab' && this.tabs?.cycle");
    assert.ok(ctrlTab > 0 && ctrlTab < editor.indexOf('if (inInputField) {'));
    const terminal = readFileSync(resolve('src/cad/terminal.js'), 'utf8');
    assert.equal((terminal.match(/key === 'Tab' && !event\.ctrlKey/g) || []).length, 2);
});
