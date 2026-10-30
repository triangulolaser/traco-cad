import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {} };
if (typeof globalThis.document === 'undefined') globalThis.document = { addEventListener() {}, removeEventListener() {} };

const { COMMANDS } = await import('../src/cad/commands.js');
const { createDocument, addEntities } = await import('../src/cad/document.js');
const { Editor } = await import('../src/cad/editor.js');

// Parede vertical em x=10 e duas linhas que a atravessam; o histórico já tem um passo anterior ao comando.
function editor(picks) {
    const base = addEntities(createDocument(), [
        { type: 'line', id: 'wall', start: { x: 10, y: -10 }, end: { x: 10, y: 10 } },
        { type: 'line', id: 'a', start: { x: 0, y: 0 }, end: { x: 20, y: 0 } },
        { type: 'line', id: 'b', start: { x: 0, y: 5 }, end: { x: 20, y: 5 } },
        { type: 'line', id: 'short', start: { x: 0, y: -5 }, end: { x: 5, y: -5 } },
    ]);
    return {
        doc: base, past: [{ label: 'Linha', doc: createDocument() }], logs: [], options: [],
        log(msg) { this.logs.push(msg); },
        async getSelection() { return []; },
        entitiesById(ids) { return this.doc.entities.filter((e) => ids.includes(e.id)); },
        commit(label, next) { this.past.push({ label, doc: this.doc }); this.doc = next; },
        undo() { const entry = this.past.pop(); this.doc = entry.doc; return entry.label; },
        async getEntityOrWindow(prompt, options) {
            this.options.push(options);
            const pick = picks.shift();
            if (!pick) return null;
            if (pick.keyword) return { keyword: pick.keyword };
            return { entity: this.doc.entities.find((e) => e.id === pick.id), point: pick.point, shift: pick.shift };
        },
    };
}
const byId = (e, id) => e.doc.entities.find((x) => x.id === id);

test('Desfazer no TRIM volta só o último corte e continua no comando', async () => {
    const e = editor([
        { id: 'a', point: { x: 18, y: 0 } },
        { id: 'b', point: { x: 18, y: 5 } },
        { keyword: 'u' },
        { id: 'b', point: { x: 2, y: 5 } },
    ]);
    await COMMANDS.TRIM.run(e);
    assert.equal(byId(e, 'a').end.x, 10);
    // O corte desfeito da linha b foi refeito do outro lado, sinal de que o comando seguiu ativo.
    assert.deepEqual([byId(e, 'b').start.x, byId(e, 'b').end.x], [10, 20]);
    assert.ok(e.options.every((o) => o.undoKeyword === 'u' && o.options.some((k) => k.key === 'u')));
});

test('Desfazer no TRIM não passa do início do comando', async () => {
    const e = editor([
        { id: 'a', point: { x: 18, y: 0 } },
        { keyword: 'u' },
        { keyword: 'u' },
    ]);
    const before = e.doc;
    await COMMANDS.TRIM.run(e);
    assert.equal(e.doc, before);
    assert.equal(e.past.length, 1, 'o passo anterior ao comando continua no histórico');
    assert.match(e.logs.at(-1), /Nada para desfazer/);
});

test('Desfazer no EXTEND ignora tentativas sem alteração', async () => {
    const e = editor([
        { id: 'short', point: { x: 4, y: -5 } },
        { id: 'a', point: { x: 1, y: 0 } }, // sem limite à esquerda: nada muda
        { keyword: 'u' },
        { keyword: 'u' },
    ]);
    await COMMANDS.EXTEND.run(e);
    assert.equal(byId(e, 'short').end.x, 5);
    assert.equal(e.past.length, 1);
});

test('Ctrl+Z (UNDO) com prompt de desfazer próprio responde ao comando sem cancelá-lo', async () => {
    const ed = Object.create(Editor.prototype);
    let resolved = null;
    let cancelled = false;
    ed.activeGrip = null;
    ed.running = 'TRIM';
    ed.pending = { undoKeyword: 'u' };
    ed.resolvePending = (value) => { resolved = value; };
    ed.cancel = () => { cancelled = true; };
    await ed.runCommand('UNDO');
    assert.deepEqual(resolved, { keyword: 'u' });
    assert.equal(cancelled, false);
    assert.equal(ed.running, 'TRIM');
});
