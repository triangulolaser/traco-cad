import test from 'node:test';
import assert from 'node:assert/strict';
import { TabManager } from '../src/cad.js';
const manager = (count, index = 0) => {
 const tm = Object.create(TabManager.prototype);
 tm.tabs = Array.from({length:count}, (_, i) => ({id:i+1}));
 tm.activeId = tm.tabs[index]?.id ?? null;
 tm.navigation = ['first','previous','next','last'].map(cadTabNav => ({dataset:{cadTabNav}}));
 tm.activate = id => { tm.activeId = id; tm.updateNavigation(); };
 return tm;
};
test('setas navegam sem circular nos limites', () => {
 const tm=manager(4); tm.updateNavigation();
 assert.deepEqual(tm.navigation.map(b=>b.disabled),[true,true,false,false]);
 assert.equal(tm.navigate('previous'),false);
 tm.navigate('next'); assert.equal(tm.activeId,2);
 tm.navigate('last'); assert.equal(tm.activeId,4);
 assert.deepEqual(tm.navigation.map(b=>b.disabled),[false,false,true,true]);
 assert.equal(tm.navigate('next'),false);
 tm.navigate('previous'); assert.equal(tm.activeId,3);
 tm.navigate('first'); assert.equal(tm.activeId,1);
 assert.equal(tm.navigate('invalid'),false);
});
test('zero ou uma guia desabilita todas as setas', () => {
 for(const n of [0,1]) {const tm=manager(n);tm.updateNavigation();assert.ok(tm.navigation.every(b=>b.disabled));assert.equal(tm.navigate('last'),false);}
});
test('fechamento e inclusão recalculam limites', () => {
 const tm=manager(3,2);tm.tabs.pop();tm.activeId=2;tm.updateNavigation();assert.ok(tm.navigation[3].disabled);
 tm.tabs.push({id:4});tm.updateNavigation();assert.equal(tm.navigation[3].disabled,false);tm.navigate('last');assert.equal(tm.activeId,4);
});
