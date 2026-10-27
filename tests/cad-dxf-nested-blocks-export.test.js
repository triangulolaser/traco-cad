import test from 'node:test';import assert from 'node:assert/strict';
import {createDocument,addEntities} from '../src/cad/document.js';
import {createInsert,expandInsert} from '../src/cad/blocks.js';
import {parseDxf,writeDxf} from '../src/cad/dxf.js';
const p=(x,y)=>({x,y});
// Linear hole pattern as AutoCAD/BricsCAD store it: *U72 (array) inserting *U73 (one hole) N times.
test('nested block definitions are exported even when only reachable through another insert',()=>{
 const hole={basePoint:p(0,0),entities:[{type:'circle',center:p(0,0),radius:3,layer:'0'}]};
 const array={basePoint:p(0,0),entities:Array.from({length:10},(_,i)=>createInsert('*U73',hole,p(0,i*50)))};
 const d=addEntities(createDocument(),[createInsert('*U72',array,p(100,100))]);
 const raw=writeDxf(d);
 assert.match(raw,/\nBLOCK_RECORD\n[\s\S]*?\n2\n\*U73\n/);
 assert.match(raw,/\nAcDbBlockBegin\n2\n\*U73\n/);
 const back=parseDxf(raw,{preserveBlocks:true});
 const circles=expandInsert(back.entities[0]).flatMap(e=>e.type==='insert'?expandInsert(e):[e]).filter(e=>e.type==='circle');
 assert.equal(circles.length,10);
 assert.deepEqual(circles.map(c=>c.center.y).sort((a,b)=>a-b),Array.from({length:10},(_,i)=>100+i*50));
 const flat=parseDxf(raw).entities.filter(e=>e.type==='circle');
 assert.equal(flat.length,10);
});
test('shared nested definition is written once',()=>{
 const hole={basePoint:p(0,0),entities:[{type:'circle',center:p(0,0),radius:3,layer:'0'}]};
 const array={basePoint:p(0,0),entities:[createInsert('H',hole,p(0,0)),createInsert('H',hole,p(10,0))]};
 const d=addEntities(createDocument(),[createInsert('A',array,p(0,0)),createInsert('A',array,p(0,50))]);
 const raw=writeDxf(d);
 assert.equal(raw.match(/\nAcDbBlockBegin\n2\nH\n/g).length,1);
 assert.equal(parseDxf(raw).entities.filter(e=>e.type==='circle').length,4);
});
