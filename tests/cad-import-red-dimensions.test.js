import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDxf, writeDxf } from '../src/cad/dxf.js';
import { createDocument, addEntities } from '../src/cad/document.js';
import { Editor } from '../src/cad/editor.js';
import { documentToDwg, dwgToDocument } from '../src/cad/dwg.js';
const options = {preserveBlocks:true,preserveDimensions:true,dimensionColor:1};
const dim = {type:'dimension',kind:'horizontal',layer:'0',color:'#00ff00',p1:{x:0,y:0},p2:{x:20,y:0},linePoint:{x:0,y:8}};
const line = {type:'line',layer:'0',color:3,start:{x:0,y:0},end:{x:20,y:0}};
const doc = () => addEntities(createDocument(),[dim,line]);
test('cotas truecolor ficam vermelhas sem alterar geometria, layers e linhas explodidas',()=>{
 const text=writeDxf(doc()); const before=parseDxf(text,{...options,dimensionColor:null}); const after=parseDxf(text,options);
 assert.ok(text.includes('420')); assert.equal(after.entities[0].color,1);
 assert.deepEqual({...after.entities[0],color:before.entities[0].color},before.entities[0]);
 assert.deepEqual(after.entities[1],before.entities[1]); assert.deepEqual(after.layers,before.layers);
});
test('abertura real do editor aplica vermelho',async()=>{
 let loaded; const editor={loadDocument:d=>loaded=d,log(){},resize(){},zoomExtents(){},viewport:{setView(){return false;}}};
 await Editor.prototype.importDxfText.call(editor,writeDxf(doc()),'cotas.dxf');
 assert.equal(loaded.entities[0].color,1); assert.equal(loaded.entities[1].color,3);
});
test('DWG binário passa pelo conversor e abre com cotas vermelhas',async()=>{
 const bytes=await documentToDwg(doc()); const loaded=await dwgToDocument(bytes);
 assert.equal(loaded.entities.find(e=>e.type==='dimension').color,1);
 assert.equal(loaded.entities.find(e=>e.type==='line').color,3);
});
const pairs=(...p)=>p.join(String.fromCharCode(10))+String.fromCharCode(10);
test('fallback DIMENSION não recolore INSERT comum que compartilha bloco',()=>{
 const text=pairs(0,'SECTION',2,'BLOCKS',0,'BLOCK',2,'GRAPH',10,0,20,0,0,'LINE',8,'0',62,5,10,0,20,0,11,20,21,0,0,'ENDBLK',0,'ENDSEC',0,'SECTION',2,'ENTITIES',0,'DIMENSION',2,'GRAPH',8,'0',70,6,0,'INSERT',2,'GRAPH',8,'0',10,40,20,0,0,'ENDSEC',0,'EOF');
 const parsed=parseDxf(text,options);
 assert.equal(parsed.entities[0].type,'line'); assert.equal(parsed.entities[0].color,1);
 assert.equal(parsed.entities[1].type,'insert'); assert.equal(parsed.entities[1].definition.entities[0].color,5);
 assert.equal(parsed.blocks.GRAPH.entities[0].color,5);
 assert.equal(parseDxf(text,{...options,dimensionColor:null}).entities[0].type,'insert');
});
test('cotas dentro de blocos recebem vermelho sem mudar as outras entidades',()=>{
 const source=doc();source.blocks={PART:{basePoint:{x:0,y:0},entities:source.entities}};
 const parsed=parseDxf(writeDxf(source),options);
 assert.equal(parsed.blocks.PART.entities[0].color,1);assert.equal(parsed.blocks.PART.entities[1].color,3);
});
