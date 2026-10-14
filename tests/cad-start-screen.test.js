import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertRecent, formatSize, formatWhen, loadRecents, showOnStart, setShowOnStart, thumbnailFor, RECENTS_KEY, RECENTS_LIMIT } from '../src/cad/start-screen.js';

const memoryStorage = () => {
    const data = new Map();
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
};

test('recente reaberto sobe para o topo sem duplicar e mantém a miniatura', () => {
    let list = upsertRecent([], { name: 'a.dxf', filePath: 'C:\\x\\a.dxf', thumb: '<svg/>', openedAt: 1 });
    list = upsertRecent(list, { name: 'b.dxf', filePath: null, openedAt: 2 });
    list = upsertRecent(list, { name: 'A.dxf', filePath: 'c:\\x\\A.dxf', thumb: null, openedAt: 3 });
    assert.deepEqual(list.map((i) => i.openedAt), [3, 2]);
    assert.equal(list[0].thumb, '<svg/>');
});

test('lista de recentes é limitada', () => {
    let list = [];
    for (let i = 0; i < RECENTS_LIMIT + 5; i++) list = upsertRecent(list, { name: `${i}.dxf`, openedAt: i });
    assert.equal(list.length, RECENTS_LIMIT);
    assert.equal(list[0].name, `${RECENTS_LIMIT + 4}.dxf`);
});

test('tamanho e data no formato do lançador', () => {
    assert.equal(formatSize(13517), '13,2 kB');
    assert.equal(formatSize(2 * 1024 * 1024), '2,0 MB');
    assert.equal(formatSize(null), '');
    const now = new Date(2026, 9, 14, 9).getTime();
    assert.equal(formatWhen(new Date(2026, 9, 14, 1).getTime(), now), 'Hoje');
    assert.equal(formatWhen(new Date(2026, 9, 13, 23).getTime(), now), 'Ontem');
    assert.equal(formatWhen(new Date(2026, 9, 1).getTime(), now), '01/10/2026');
});

test('armazenamento corrompido não derruba a tela e a opção liga por padrão', () => {
    const storage = memoryStorage();
    storage.setItem(RECENTS_KEY, '{quebrado');
    assert.deepEqual(loadRecents(storage), []);
    assert.equal(showOnStart(storage), true);
    setShowOnStart(false, storage);
    assert.equal(showOnStart(storage), false);
});

test('miniatura sai da geometria e documento vazio fica sem miniatura', () => {
    const svg = thumbnailFor({ entities: [{ type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 100, y: 50 } }] });
    assert.match(svg, /^<svg/);
    assert.equal(thumbnailFor({ entities: [] }), null);
});
