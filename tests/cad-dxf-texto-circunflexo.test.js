import test from 'node:test';import assert from 'node:assert/strict';
import {parseDxf} from '../src/cad/dxf.js';
const dxf=(type,text)=>['0','SECTION','2','ENTITIES','0',type,'8','0','10','0','20','0','30','0','40','2.5','1',text,'0','ENDSEC','0','EOF'].join('\n');
const texto=(type,text)=>parseDxf(dxf(type,text)).entities.find(e=>e.type==='text').text;
test('MTEXT com ^I (tab do DXF) não mostra o código literal',()=>{
 assert.equal(texto('MTEXT','DAA810003^I- LATERAL'),'DAA810003 - LATERAL');
});
test('TEXT decodifica notação de circunflexo: ^J quebra, "^ " é o próprio ^',()=>{
 assert.equal(texto('TEXT','A^ B'),'A^B');
 assert.equal(texto('MTEXT','L1^JL2'),'L1\nL2');
});
test('Texto com ^ sobrevive a exportar e reimportar',async()=>{
 const {createDocument,addEntities}=await import('../src/cad/document.js');const {writeDxf}=await import('../src/cad/dxf.js');
 const d=addEntities(createDocument(),[{type:'text',position:{x:0,y:0},height:2.5,text:'R^2 OK',layer:'0'},{type:'text',position:{x:0,y:10},height:2.5,text:'L1^x\nL2',layer:'0'}]);
 const back=parseDxf(writeDxf(d)).entities.filter(e=>e.type==='text').map(e=>e.text).sort();
 assert.deepEqual(back,['L1^x\nL2','R^2 OK']);
});
