import test from 'node:test';
import assert from 'node:assert/strict';
import { Terminal } from '../src/cad/terminal.js';
function setup() {
    const listeners = {};
    const input = { value: '', addEventListener: (name, fn) => { listeners[name] = fn; } };
    const terminal = new Terminal({ querySelector: (selector) => selector.endsWith('input]') ? input : {}, addEventListener() {} });
    const submitted = [];
    terminal.onSubmit = (value) => submitted.push(value);
    const press = (key, props = {}) => {
        const event = { key, prevented: false, preventDefault() { this.prevented = true; }, ...props };
        listeners.keydown(event);
        return event;
    };
    return { terminal, input, submitted, press };
}
test('space submits command and history exactly like Enter', () => {
    for (const key of [' ', 'Enter']) {
        const { terminal, input, submitted, press } = setup();
        input.value = 'LINE';
        assert.equal(press(key).prevented, true);
        assert.deepEqual(submitted, ['LINE']);
        assert.deepEqual(terminal.entries, ['LINE']);
        assert.equal(input.value, '');
    }
});
test('empty space submits empty value for repeat/default and numeric input submits', () => {
    const { input, submitted, press } = setup();
    press(' '); input.value = '12.5'; press(' ');
    assert.deepEqual(submitted, ['', '12.5']);
});
test('text prompts preserve spaces and still accept Enter', () => {
    const { terminal, input, submitted, press } = setup();
    terminal.acceptsSpaces = () => true;
    input.value = 'Peça de teste';
    assert.equal(press(' ').prevented, false);
    assert.deepEqual(submitted, []);
    press('Enter'); assert.deepEqual(submitted, ['Peça de teste']);
});
test('composition and modified spaces never submit', () => {
    const { submitted, press } = setup();
    press(' ', { isComposing: true }); press('Enter', { keyCode: 229 });
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) press(' ', { [modifier]: true });
    assert.deepEqual(submitted, []);
});
test('suggestions: arrows pick, Enter submits picked name; typed text wins when nothing picked', () => {
    const { terminal, input, submitted, press } = setup();
    terminal.getSuggestions = () => [{ name: 'EXTEND', label: 'EXTEND' }, { name: 'EXPLODE', label: 'EXPLODE' }];
    input.value = 'EX'; terminal.refreshSuggestions();
    press('ArrowDown'); press('Enter');
    assert.deepEqual(submitted, ['EXPLODE']);
    assert.equal(terminal.suggestions.length, 0);
    input.value = 'EX'; terminal.refreshSuggestions(); press('Enter');
    assert.deepEqual(submitted, ['EXPLODE', 'EXTEND']);
});
test('suggestions: Tab cycles forward, Shift+Tab back, space confirms the highlighted command', () => {
    const { terminal, input, submitted, press } = setup();
    terminal.getSuggestions = () => [{ name: 'SCALE', label: 'SCALE' }, { name: 'SCALETEXT', label: 'SCALETEXT' }, { name: 'SCRIPT', label: 'SCRIPT' }];
    input.value = 'SC'; terminal.refreshSuggestions();
    assert.equal(terminal.suggestIndex, 0);
    assert.equal(press('Tab').prevented, true); assert.equal(terminal.suggestIndex, 1);
    press('Tab'); press('Tab'); assert.equal(terminal.suggestIndex, 0);
    press('Tab', { shiftKey: true }); assert.equal(terminal.suggestIndex, 2);
    press('Tab'); press('Tab'); press(' ');
    assert.deepEqual(submitted, ['SCALETEXT']);
});
test('Esc with suggestions open clears the typed text and cancels', () => {
    const { terminal, input, submitted, press } = setup();
    let cancels = 0;
    terminal.onCancel = () => { cancels += 1; };
    terminal.getSuggestions = () => [{ name: 'SCALE', label: 'SCALE' }];
    input.value = 'sc'; terminal.refreshSuggestions();
    assert.equal(press('Escape').prevented, true);
    assert.equal(input.value, ''); assert.equal(terminal.suggestions.length, 0); assert.equal(cancels, 1);
    press(' '); assert.deepEqual(submitted, ['']);
});

test('space outside the terminal repeats the last command like Enter', async () => {
    const { Editor } = await import('../src/cad/editor.js');
    const before = globalThis.document;
    const submits = [];
    let focused = 0;
    const e = { terminal: { isFocused: () => false, value: () => '', focus: () => focused++ }, root: { contains: () => true }, onTerminalSubmit: (v) => submits.push(v) };
    const key = (k, extra = {}) => { const ev = { key: k, preventDefault() { this.prevented = true; }, ...extra }; Editor.prototype.onKeyDown.call(e, ev); return ev; };
    try {
        globalThis.document = { activeElement: { tagName: 'CANVAS' } };
        assert.equal(key(' ').prevented, true);
        assert.deepEqual(submits, ['']);
        key(' ', { ctrlKey: true });
        e.pending = { mode: 'string' }; key(' ');
        assert.deepEqual(submits, ['']);
        assert.equal(focused, 1);
    } finally { globalThis.document = before; }
});

test('suggestions: partial name with one match runs the suggested command on space', () => {
    const { terminal, input, submitted, press } = setup();
    terminal.getSuggestions = () => [{ name: 'FILLET', label: 'FILLET (F, CONCORDAR)' }];
    input.value = 'conc'; terminal.refreshSuggestions(); press(' ');
    assert.deepEqual(submitted, ['FILLET']);
});
