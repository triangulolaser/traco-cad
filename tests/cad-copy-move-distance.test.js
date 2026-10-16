import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from '../src/cad/commands.js';

// Editor mínimo: devolve as respostas na ordem e guarda as opções de cada getPoint.
function fakeEditor(answers) {
    const prompts = [];
    const commits = [];
    const line = { id: 'a', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    return {
        prompts,
        commits,
        doc: { entities: [line] },
        viewport: { pixelsToWorld: (n) => n },
        getSelection: async () => ['a'],
        entitiesById: () => [line],
        getPoint: async (prompt, options = {}) => {
            prompts.push({ prompt, options });
            return answers.shift() ?? { enter: true };
        },
        commit: (label) => commits.push(label),
        clearSelection() {},
        log() {},
    };
}

for (const name of ['COPY', 'MOVE']) {
    test(`${name}: segundo ponto mostra distância e ângulo digitáveis a partir do ponto base`, async () => {
        const editor = fakeEditor([{ point: { x: 0, y: 0 } }]);
        await COMMANDS[name].run(editor);
        const second = editor.prompts.find((p) => p.options.reference);
        assert.ok(second, 'prompt do segundo ponto');
        const dyn = second.options.dynInput;
        assert.deepEqual(dyn.fields.map((f) => f.key), ['len', 'ang']);
        assert.ok(Math.abs(dyn.values({ x: 30, y: 40 }).len - 50) < 1e-9);
        // Distância digitada vale também para a prévia da peça.
        dyn.locked.len = 100;
        const preview = second.options.preview({ x: 0, y: 5 });
        assert.ok(Math.abs(preview[0].start.y - 100) < 1e-9);
    });
}
