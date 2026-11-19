import test from 'node:test';
import assert from 'node:assert/strict';
import {packNativeImages,unpackNativeImages,prepareNativeImages} from '../src/cad/native-images.js';
import {documentToTraco,tracoToDocument} from '../src/cad/traco-file.js';
import {createDocument} from '../src/cad/document.js';
const photo={type:'image',id:'photo',src:'data:image/jpeg;base64,/9j/test',position:{x:20,y:30},width:100,height:50,rotation:17,clip:{u0:0.1,u1:0.9,v0:0,v1:1}};
test('native v2 deduplicates images across entities and block definitions, preserving geometry',()=>{
 const doc={...createDocument(),entities:[photo,{...photo,id:'mirror',mirrored:true},{type:'line',id:'line',start:{x:0,y:0},end:{x:5,y:5}}],blocks:{P:{entities:[photo]}}};
 const before=JSON.stringify(doc),text=documentToTraco(doc),raw=JSON.parse(text);
 assert.equal(raw.versao,2);assert.equal(Object.keys(raw.imagens).length,1);assert.equal(text.split(photo.src).length,2);
 const back=tracoToDocument(text).doc;assert.deepEqual(back.entities,doc.entities);assert.deepEqual(back.blocks,doc.blocks);assert.equal(JSON.stringify(doc),before);
 assert.equal(documentToTraco(doc),text);
});
test('old inline-image v1 opens, and image-free drawings remain v1',()=>{
 const doc={...createDocument(),entities:[photo]};const raw=JSON.parse(documentToTraco(doc));raw.versao=1;raw.anotacoes=[photo];delete raw.imagens;
 assert.deepEqual(tracoToDocument(JSON.stringify(raw)).doc.entities,[photo]);
 assert.equal(JSON.parse(documentToTraco(createDocument())).versao,1);
});
test('missing asset does not silently open a drawing with missing photos',()=>{
 assert.throws(()=>unpackNativeImages({type:'image',imagem_ref:'absent'},{}),/Imagem ausente/);
 assert.throws(()=>unpackNativeImages({type:'image',imagem_ref:'toString'},{}),/Imagem ausente/);
});
test('optimization runs once per distinct image, preserves original, and avoids repeated lossy conversion',async()=>{
 const doc={...createDocument(),entities:[photo,{...photo,id:'second'}]};let calls=0;
 const optimized=await prepareNativeImages(doc,{optimize:async src=>{calls++;return src+'compressed';}});
 assert.equal(calls,1);assert.equal(doc.entities[0].src,photo.src);
 assert.equal(optimized.entities[0].imageOptimized,true);
 const reloaded=tracoToDocument(documentToTraco(optimized)).doc;
 await prepareNativeImages(reloaded,{optimize:()=>{throw Error('must not recompress');}});
 const {src,imageOptimized,...geometry}=optimized.entities[0];const {src:old,...expected}=photo;assert.deepEqual(geometry,expected);
});
test('pack/unpack retain transparent image source verbatim and do not mutate input',()=>{
 const value={type:'image',src:'data:image/png;base64,alpha'};const packed=packNativeImages(value);
 assert.deepEqual(unpackNativeImages(packed.value,packed.images),value);assert.equal(value.src,'data:image/png;base64,alpha');
});
