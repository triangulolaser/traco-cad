import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/cad/editor.js';

for (const input of ['enter', 'right']) {
    test(`WBLOCK: ${input} não repete enquanto salva, mas repete após encerrar`, () => {
        const calls = [];
        const editor = { running: 'WBLOCK', lastCommand: 'WBLOCK', runCommand: (...args) => calls.push(args) };
        const submit = () => input === 'enter' ? Editor.prototype.onTerminalSubmit.call(editor, '') : Editor.prototype.onRightClick.call(editor);
        submit();
        assert.equal(calls.length, 0);
        editor.running = null;
        submit();
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], 'WBLOCK');
    });
}

test('WBLOCK ainda aceita outro comando explícito durante a gravação', () => {
    const calls = [];
    Editor.prototype.onTerminalSubmit.call({ running: 'WBLOCK', runCommand: (...args) => calls.push(args) }, 'LINE');
    assert.equal(calls[0][0], 'LINE');
});
