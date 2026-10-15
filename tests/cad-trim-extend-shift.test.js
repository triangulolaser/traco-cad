import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from '../src/cad/commands.js';
import { createDocument, addEntities } from '../src/cad/document.js';

// Parede vertical em x=10, uma linha curta antes dela e outra que a atravessa.
function editor(picks) {
    const doc = addEntities(createDocument(), [
        { type: 'line', id: 'wall', start: { x: 10, y: -10 }, end: { x: 10, y: 10 } },
        { type: 'line', id: 'short', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
        { type: 'line', id: 'long', start: { x: 0, y: 5 }, end: { x: 20, y: 5 } },
    ]);
    return {
        doc, logs: [], prompts: [], options: [],
        log(msg) { this.logs.push(msg); },
        async getSelection() { return []; },
        entitiesById(ids) { return this.doc.entities.filter((e) => ids.includes(e.id)); },
        commit(label, next) { this.doc = next; },
        async getEntityOrWindow(prompt, options) {
            this.prompts.push(prompt); this.options.push(options);
            const pick = picks.shift();
            if (!pick) return null;
            return { entity: this.doc.entities.find((e) => e.id === pick.id), point: pick.point, shift: pick.shift };
        },
    };
}
const byId = (e, id) => e.doc.entities.find((x) => x.id === id);

test('TRIM com Shift estende e sem Shift volta a aparar', async () => {
    const e = editor([
        { id: 'short', point: { x: 4, y: 0 }, shift: true },
        { id: 'long', point: { x: 18, y: 5 }, shift: false },
    ]);
    await COMMANDS.TRIM.run(e);
    assert.deepEqual(byId(e, 'short').end, { x: 10, y: 0 });
    assert.equal(byId(e, 'long').end.x, 10);
    assert.match(e.prompts[0], /aparar.*Shift estende/);
    assert.match(e.options[0].shiftPrompt, /estender/);
});

test('EXTEND com Shift apara e sem Shift estende', async () => {
    const e = editor([
        { id: 'long', point: { x: 18, y: 5 }, shift: true },
        { id: 'short', point: { x: 4, y: 0 }, shift: false },
    ]);
    await COMMANDS.EXTEND.run(e);
    assert.equal(byId(e, 'long').end.x, 10);
    assert.deepEqual(byId(e, 'short').end, { x: 10, y: 0 });
    assert.match(e.prompts[0], /estender.*Shift apara/);
});

test('Shift no TRIM recusa estender círculo sem alterar o desenho', async () => {
    const e = editor([{ id: 'c', point: { x: 30, y: 0 }, shift: true }]);
    e.doc = addEntities(e.doc, [{ type: 'circle', id: 'c', center: { x: 30, y: 0 }, radius: 2 }]);
    const before = e.doc;
    await COMMANDS.TRIM.run(e);
    assert.equal(e.doc, before);
    assert.match(e.logs.at(-1), /linhas e arcos/);
});
