import test from 'node:test';import assert from 'node:assert/strict';
import {createDocument,addEntities} from '../src/cad/document.js';
import {defineBlock,createInsert} from '../src/cad/blocks.js';
import {parseDxf,writeDxf} from '../src/cad/dxf.js';
const p=(x,y)=>({x,y});
const header=(t,k)=>{const l=t.split(/\r?\n/).map(s=>s.trim());const i=l.indexOf(k);return i<0?null:Number(l[i+2]);};
test('DXF em mm declara $MEASUREMENT métrico (SolidWorks lia ×25,4)',()=>{
 let d=defineBlock(createDocument(),'PECA',[{type:'line',start:p(0,0),end:p(114.64,0),layer:'0'}],p(0,0));
 d=addEntities(d,[createInsert('PECA',d.blocks.PECA,p(0,0))]);
 const t=writeDxf(d);
 assert.equal(header(t,'$INSUNITS'),4);assert.equal(header(t,'$MEASUREMENT'),1);

 const back=parseDxf(t,{preserveBlocks:true});assert.equal(back.units,'mm');assert.equal(back.entities[0].name,'PECA');
});
