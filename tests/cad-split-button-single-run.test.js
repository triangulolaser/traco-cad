import test from 'node:test';
import assert from 'node:assert/strict';
import { setupToolbar, setupSplitButtons } from '../src/cad.js';

function el(classes = [], dataset = {}) {
    const listeners = [];
    const cls = new Set(classes);
    return {
        dataset: { ...dataset },
        hidden: false,
        title: '',
        style: {},
        classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
        setAttribute() {},
        addEventListener: (type, fn) => listeners.push([type, fn]),
        click() { listeners.filter(([t]) => t === 'click').forEach(([, fn]) => fn({ stopPropagation() {}, target: this })); },
        getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
        querySelector: () => null,
    };
}

test('item do menu do botão dividido roda o comando uma única vez', () => {
    const item = el(['cad-ribbon-dropdown-item'], { cadCommand: 'CIRCLE', cadArgs: '2p', cadLabel: 'Círculo 2-Pontos' });
    const main = el(['cad-ribbon-split-main'], { cadCommand: 'CIRCLE', cadArgs: 'cr' });
    const menu = el(['cad-ribbon-dropdown-menu']);
    const split = el([], { cadSplit: 'circle' });
    split.querySelector = (s) => (s === '.cad-ribbon-dropdown-menu' ? menu : s === '.cad-ribbon-split-main' ? main : null);
    split.querySelectorAll = (s) => (s === '.cad-ribbon-dropdown-item' ? [item] : []);
    const root = {
        querySelectorAll: (s) => (s === '[data-cad-command]' ? [main, item] : s === '[data-cad-split]' ? [split] : []),
    };
    const runs = [];
    const editor = { tabs: { tabs: [1] }, runCommand: (c, a) => runs.push([c, a]) };

    setupToolbar(editor, root);
    setupSplitButtons(editor, root);
    item.click();

    assert.deepEqual(runs, [['CIRCLE', ['2p']]]);
    main.click();
    assert.deepEqual(runs.at(-1), ['CIRCLE', ['2p']]);
});
