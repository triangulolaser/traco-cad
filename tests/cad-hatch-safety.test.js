import test from 'node:test';import assert from 'node:assert/strict';
import {loopsFromEntities,hatchLineRange,MAX_HATCH_EDGES,patternSegments}from'../src/cad/hatch.js';
import {Renderer}from'../src/cad/renderer.js';
const ring=(count,radius=100,cx=0)=>{const v=i=>({x:cx+radius*Math.cos(2*Math.PI*i/count),y:radius*Math.sin(2*Math.PI*i/count)});return Array.from({length:count},(_,i)=>{const j=i*997%count;return{type:'line',start:v(j),end:v((j+1)%count)}});};
test('shuffled 8000-edge contour closes and independent loops remain separate',()=>{const t=performance.now();const loops=loopsFromEntities(ring(8000));assert.equal(loops.length,1);assert.equal(loops[0].vertices.length,8000);console.log('8000 edges ms',Math.round(performance.now()-t));assert.equal(loopsFromEntities([...ring(100),...ring(100,10,200)]).length,2);});
test('complexity overflow is explicit, before geometry expansion',()=>{assert.throws(()=>loopsFromEntities(ring(MAX_HATCH_EDGES+1)),/complexo|limitada/);});
test('line range uses bounded count even when first + 1 equals first',()=>{const r=hatchLineRange(1e17,1e17+1000,2);assert.ok(r.count>0&&r.count<=6001);assert.equal(r.first+1,r.first);assert.equal(hatchLineRange(NaN,2,1).count,0);});
test('renderer terminates at huge coordinates instead of blocking forever',()=>{
 let calls=0;const old=globalThis.Path2D;globalThis.Path2D=class{moveTo(){}lineTo(){calls++;assert.ok(calls<=6001+4,'bounded render');}closePath(){}rect(){}};
 const ctx=new Proxy({},{get:(_,key)=>()=>{if(key==='lineTo'){calls++;assert.ok(calls<=6001,'bounded render');}},set:()=>true});
 const e={type:'hatch',pattern:'ANSI31',angle:0,spacing:2,loops:[{vertices:[{x:0,y:1e17},{x:100,y:1e17},{x:100,y:1e17+1000},{x:0,y:1e17+1000}]}]};
 try{Renderer.prototype.drawHatch.call({ctx,viewport:{width:1000,height:1000,scale:1,worldToScreen:p=>({x:p.x,y:1e17+1000-p.y})}},e,{});assert.ok(calls>0);}finally{globalThis.Path2D=old;}
});
