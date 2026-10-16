import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommand, COMMANDS } from '../src/cad/commands.js';

test('N abre o comando NEW', () => {
    assert.equal(resolveCommand('n')?.name, 'NEW');
    assert.equal(resolveCommand('N')?.name, 'NEW');
});

test('alias N não pertence a outro comando', () => {
    const owners = Object.entries(COMMANDS).filter(([, c]) => c.aliases.includes('N')).map(([k]) => k);
    assert.deepEqual(owners, ['NEW']);
});
