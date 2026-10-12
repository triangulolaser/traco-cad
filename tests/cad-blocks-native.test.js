import test from 'node:test';import assert from 'node:assert/strict';
import {createDocument,addEntities} from '../src/cad/document.js';
import {defineBlock,createInsert,expandInsert} from '../src/cad/blocks.js';
import {parseDxf,writeDxf} from '../src/cad/dxf.js';
const p=(x,y)=>({x,y});
test('block instances persist through DXF without flattening and retain transform',()=>{
 let d=defineBlock(createDocument(),'FURO',[{type:'circle',center:p(0,0),radius:5,layer:'0'}],p(0,0));
 d=addEntities(d,[createInsert('FURO',d.blocks.FURO,p(50,20),{scale:2,rotation:45})]);
 const back=parseDxf(writeDxf(d),{preserveBlocks:true,preserveDimensions:true});assert.equal(back.entities[0].type,'insert');assert.equal(back.entities[0].name,'FURO');const children=expandInsert(back.entities[0]);assert.ok(Math.abs(children[0].radius-10)<1e-8);assert.deepEqual(children[0].center,p(50,20));
});
test('native linear radial angular dimensions round trip as dimensions',()=>{
 for(const kind of ['horizontal','vertical','aligned','radius','diameter','angular']){
 const dim={type:'dimension',kind,p1:p(20,0),p2:p(0,20),center:p(0,0),radius:10,linePoint:p(30,30),textOverride:'TESTE'};
 const d=addEntities(createDocument(),[dim]);const raw=writeDxf(d);assert.match(raw,/\nDIMENSION\n/);const back=parseDxf(raw,{preserveBlocks:true,preserveDimensions:true});assert.equal(back.entities[0].type,'dimension');assert.equal(back.entities[0].kind,kind);assert.equal(back.entities[0].textOverride,'TESTE');
 }
});
test('redefinition updates instances but never changes locked ones silently',()=>{
 let d=defineBlock(createDocument(),'B',[{type:'circle',center:p(0,0),radius:5}],p(0,0));d=addEntities(d,[createInsert('B',d.blocks.B,p(0,0))]);d=defineBlock(d,'B',[{type:'circle',center:p(0,0),radius:8}],p(0,0));assert.equal(expandInsert(d.entities[0])[0].radius,8);d.layers[0].locked=true;assert.throws(()=>defineBlock(d,'B',[],p(0,0)));
});
test('font family bold italic survive native DXF for text and dimension',()=>{
 const d=addEntities(createDocument(),[{type:'text',position:p(0,0),height:3,text:'Arial é Ø',fontFamily:'Arial',bold:true,italic:true},{type:'dimension',kind:'horizontal',p1:p(0,0),p2:p(10,0),linePoint:p(0,5),fontFamily:'Liberation Serif',bold:true}]);
 const raw=writeDxf(d);assert.match(raw,/AcDbTextStyleTableRecord/);const b=parseDxf(raw,{preserveBlocks:true,preserveDimensions:true});
 assert.equal(b.entities[0].fontFamily,'Arial');assert.equal(b.entities[0].bold,true);assert.equal(b.entities[0].italic,true);assert.equal(b.entities[1].fontFamily,'Liberation Serif');assert.equal(b.entities[1].bold,true);
});
test('repeated native dimension roundtrip does not accumulate anonymous blocks',()=>{
 let d=addEntities(createDocument(),[{type:'dimension',kind:'horizontal',p1:p(0,0),p2:p(50,0),linePoint:p(0,20)}]);
 d.dimStyle.textHeight=7;d.dimStyle.scale=2;
 for(let i=0;i<3;i++){const raw=writeDxf(d);d={...d,...parseDxf(raw,{preserveBlocks:true,preserveDimensions:true})};assert.equal(d.entities.length,1);assert.equal(Object.keys(d.blocks).length,0);assert.equal(d.entities[0].style.textHeight,7);}
});
test('imported dimension style survives export from fresh document defaults',()=>{
 let original=addEntities(createDocument(),[{type:'dimension',kind:'aligned',p1:p(0,0),p2:p(10,10),linePoint:p(20,20)}]);original.dimStyle.textHeight=9;original.dimStyle.fontFamily='Liberation Mono';
 const imported={...createDocument(),...parseDxf(writeDxf(original),{preserveBlocks:true,preserveDimensions:true})};
 const again=parseDxf(writeDxf(imported),{preserveBlocks:true,preserveDimensions:true});assert.equal(again.entities[0].style.textHeight,9);assert.equal(again.entities[0].fontFamily,'Liberation Mono');
});
