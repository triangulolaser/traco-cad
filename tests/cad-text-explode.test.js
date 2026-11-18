import test from 'node:test';
import assert from 'node:assert/strict';
import {outlineLoops,textPolylines,explodeText} from '../src/cad/text-explode.js';
import {createDocument,addEntities} from '../src/cad/document.js';
import {writeDxf,parseDxf} from '../src/cad/dxf.js';
const rectangle=[[0,0,0],[1,500,0],[1,500,700],[1,0,700],[4]];
const reader=async({text})=>({units_per_em:1000,glyphs:[...text].map(ch=>({advance:600,commands:ch===' '?[]:rectangle}))});
const text={type:'text',position:{x:10,y:20},height:7.16,text:'AA',fontFamily:'Stencil',layer:'0',color:3};
test('TXTEXP preserves contour closure, appearance, font choice and world transform',async()=>{
 let requested;
 const curves=await textPolylines({...text,rotation:90,mirrored:true,halign:'center'},async args=>{requested=args;return reader(args)});
 assert.equal(requested.family,'Stencil');assert.equal(curves.length,2);
 assert.equal(curves[0].closed,true);assert.equal(curves[0].color,3);
 assert.ok(Math.abs(curves[0].vertices[0].x-10)<1e-9);
 assert.ok(Math.abs(curves[0].vertices[0].y-26)<1e-9);
 const parsed=parseDxf(writeDxf(addEntities(createDocument(),curves)));
 assert.equal(parsed.entities.length,2);assert.ok(parsed.entities.every(e=>e.type==='polyline'&&e.closed));
});
test('TXTEXP keeps disjoint stencil contours and inner holes separate',()=>{
 const loops=outlineLoops([...rectangle,...rectangle.map(([op,...xy])=>[op,...xy.map(v=>v/4+100)])],.01);
 assert.equal(loops.length,2);assert.equal(loops[0].length,4);
});
test('quadratic and cubic outlines are adaptively subdivided without losing collinear excursions',()=>{
 const loop=outlineLoops([[0,0,0],[2,100,200,200,0],[3,300,-200,400,200,500,0],[1,0,0],[4]],.1)[0];
 assert.ok(loop.length>30);assert.ok(loop.some(p=>p.y>90));assert.ok(loop.some(p=>p.y<0));
 const cusp=outlineLoops([[0,0,0],[2,100,0,10,0],[1,0,10],[4]],1)[0];
 assert.ok(cusp.some(p=>p.x>40));
});
test('MText newline, blank line and wrap use CAD line spacing',async()=>{
 const curves=await textPolylines({...text,text:'A\n\nA',valign:'top'},reader);
 assert.equal(curves.length,2);assert.ok(Math.abs(curves[0].vertices[0].y-(20-7.16))<1e-9);
 assert.ok(Math.abs(curves[0].vertices[0].y-curves[1].vertices[0].y-2*7.16*5/3)<1e-9);
 const wrapped=await textPolylines({...text,text:'A A',boxWidth:13},reader);
 assert.equal(wrapped.length,2);assert.ok(wrapped[1].vertices[0].y<wrapped[0].vertices[0].y);
});
test('failure never deletes any original; success creates one undoable transaction',async()=>{
 const old=globalThis.window;
 try{
 const original=addEntities(createDocument(),[text,{...text,text:'B'}]);let commits=0;
 const e={doc:original,selection:new Set(original.entities.map(e=>e.id)),entitiesById:ids=>original.entities.filter(e=>ids.includes(e.id)),commit(_label,doc){commits++;this.doc=doc},invalidate(){}};
 globalThis.window={desktopBridge:{systemTextOutlines:async args=>{if(args.text==='B')throw Error('missing font');return reader(args)}}};
 await assert.rejects(explodeText(e),/missing font/);assert.equal(e.doc,original);assert.equal(commits,0);
 window.desktopBridge.systemTextOutlines=reader;await explodeText(e);assert.equal(commits,1);assert.ok(e.doc.entities.every(e=>e.type==='polyline'));
 }finally{globalThis.window=old;}
});
