import test from 'node:test';
import assert from 'node:assert/strict';
import {fontFamily, normalizeFontFamily, useLocalFont, loadLocalFonts, FONT_FAMILIES} from '../src/cad/fonts.js';
import {parseDxf, writeDxf} from '../src/cad/dxf.js';

test('local names reach canvas without whitelist substitution; CSS is quoted',()=>{
 assert.equal(fontFamily('TC_LaserSans'), '"TC_LaserSans", "Liberation Sans", sans-serif');
 assert.equal(normalizeFontFamily('  Local Font  '),'Local Font');
 assert.equal(normalizeFontFamily('bad\nname'),'');
 assert.equal(normalizeFontFamily('x'.repeat(161)),'');
});
test('local font validation rejects missing faces and remembers only loaded names',async()=>{
 const oldFace=globalThis.FontFace,oldStorage=globalThis.localStorage;
 const store=new Map();
 globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
 globalThis.FontFace=class{constructor(name,source){this.source=source;}async load(){if(this.source.includes('Missing'))throw Error('missing');return this;}};
 try{
  await useLocalFont('Test Installed Family');
  assert.ok(FONT_FAMILIES.includes('Test Installed Family'));
  assert.deepEqual(JSON.parse(store.get('traco:local-font-families')),['Test Installed Family']);
  await assert.rejects(useLocalFont('Missing Font'),/não encontrada/);
  assert.ok(!FONT_FAMILIES.includes('Missing Font'));
  store.set('traco:local-font-families','{}');await loadLocalFonts();
  store.set('traco:local-font-families','invalid');await loadLocalFonts();
 }finally{globalThis.FontFace=oldFace;globalThis.localStorage=oldStorage;}
});

import {createDocument,addEntities} from '../src/cad/document.js';
test('DXF roundtrip preserves a local font family',()=>{
 const doc=addEntities(createDocument(),[{id:'local-text',type:'text',position:{x:0,y:0},text:'ABO',height:10,fontFamily:'TC_LaserSans',layer:'0',rotation:0}]);
 const parsed=parseDxf(writeDxf(doc));
 const text=parsed.entities.find(e=>e.type==='text');
 assert.equal(text.fontFamily,'TC_LaserSans');
});
