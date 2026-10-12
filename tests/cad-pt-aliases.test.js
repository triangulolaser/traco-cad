import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveCommand, suggestCommands } from '../src/cad/commands.js';
import { PT_ALIASES } from '../src/cad/pt-aliases.js';

test('every Portuguese alias points to an existing command', () => {
    for (const name of Object.keys(PT_ALIASES)) assert.ok(COMMANDS[name], name);
});
test('no name or alias resolves to two commands', () => {
    const owner = new Map();
    for (const [name, command] of Object.entries(COMMANDS)) {
        for (const key of [name, ...command.aliases]) {
            assert.ok(!owner.has(key) || owner.get(key) === name, `${key}: ${owner.get(key)} e ${name}`);
            owner.set(key, name);
        }
    }
});
test('commands accept English and Portuguese, with or without accents', () => {
    const cases = { LINE: ['LINE', 'linha'], CIRCLE: ['circle', 'CÍRCULO', 'circulo'], RECTANG: ['RECTANG', 'Retângulo'], TRIM: ['trim', 'aparar'], ERASE: ['erase', 'apagar'], MIRROR: ['mirror', 'espelhar'], OFFSET: ['offset', 'deslocar'], UNDO: ['undo', 'desfazer'], LAYER: ['layer', 'camada'], POLYGON: ['polígono'], DIMDIAMETER: ['cotadiâmetro'] };
    for (const [name, inputs] of Object.entries(cases)) for (const input of inputs) assert.equal(resolveCommand(input)?.name, name, input);
});
test('suggestions match Portuguese prefixes with accents', () => {
    assert.ok(suggestCommands('retâ').some((s) => s.name === 'RECTANG'));
    assert.ok(suggestCommands('espe').some((s) => s.name === 'MIRROR'));
});
