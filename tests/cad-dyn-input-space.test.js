import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/cad/editor.js';

const fakeEditor = () => {
    const calls = [];
    return {
        calls,
        dyn: { inputs: [{ value: ' 50 ' }], typed: new Set() },
        commitDynInput: (raw) => calls.push(raw),
        focusDynField: () => {},
        cancel: () => {},
    };
};
const key = (k, extra = {}) => ({ key: k, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra });

test('Entrada dinâmica: espaço confirma como Enter', () => {
    const ed = fakeEditor();
    const ev = key(' ');
    Editor.prototype.onDynKeyDown.call(ed, ev, 0);
    assert.deepEqual(ed.calls, ['50']);
    assert.ok(ev.prevented);
});

test('Entrada dinâmica: Ctrl+espaço não confirma', () => {
    const ed = fakeEditor();
    Editor.prototype.onDynKeyDown.call(ed, key(' ', { ctrlKey: true }), 0);
    assert.deepEqual(ed.calls, []);
});
