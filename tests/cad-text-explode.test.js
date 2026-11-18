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
test('quadratic and cubic outlines use arcs without losing collinear excursions',()=>{
 const loop=outlineLoops([[0,0,0],[2,100,200,200,0],[3,300,-200,400,200,500,0],[1,0,0],[4]],.1)[0];
 assert.ok(loop.some(p=>p.bulge));assert.ok(loop.some(p=>p.y>90));assert.ok(loop.some(p=>p.y<0));
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

test('curved glyph keeps arcs through mirror, rotation and DXF roundtrip',async()=>{
 const k=0.5522847498307936;
 const commands=[[0,100,0],[3,100,100*k,100*k,100,0,100],[1,0,0],[1,100,0],[4]];
 const read=async()=>({units_per_em:1000,glyphs:[{advance:120,commands}]});
 const normal=(await textPolylines({...text,text:'C',height:71.6},read))[0];
 const mirrored=(await textPolylines({...text,text:'C',height:71.6,mirrored:true,rotation:37},read))[0];
 assert.ok(normal.vertices.length>=3);
 assert.ok(normal.vertices[0].bulge>0);
 assert.ok(Math.abs(normal.vertices.reduce((sum,p)=>sum+4*Math.atan(p.bulge||0),0)-Math.PI/2)<.001);
 assert.equal(mirrored.vertices[0].bulge,-normal.vertices[0].bulge);
 assert.ok(normal.vertices.slice(-2).every(p=>!p.bulge));
 const parsed=parseDxf(writeDxf(addEntities(createDocument(),[mirrored]))).entities[0];
 assert.ok(Math.abs(parsed.vertices[0].bulge-mirrored.vertices[0].bulge)<1e-6);
 assert.equal(parsed.closed,true);
});

test('small and large quadratic glyphs stay within 0.01 mm of the original curve',async()=>{
 const {entityCurves,closestPointOnCurve}=await import('../src/cad/geometry.js');
 for(const scale of [.001,.1,10]){
  const vertices=outlineLoops([[0,0,0],[2,100,200,200,0],[1,0,0],[4]],scale)[0].map(p=>({...p,x:p.x*scale,y:p.y*scale}));
  const curves=entityCurves({type:'polyline',closed:true,vertices});
  assert.ok(vertices.some(p=>p.bulge));
  for(let i=0;i<=2000;i++){
   const t=i/2000,q={x:200*t*scale,y:400*t*(1-t)*scale};
   const distance=Math.min(...curves.map(c=>{const p=closestPointOnCurve(q,c);return Math.hypot(q.x-p.x,q.y-p.y)}));
   assert.ok(distance<=.0101,`scale ${scale}: deviation ${distance}`);
  }
 }
});

test('small lettering preserves shallow curves and tangent continuity instead of flattening them',()=>{
 const vertices=outlineLoops([[0,0,0],[2,100,1,200,0],[1,200,-20],[1,0,-20],[4]],.001)[0];
 assert.ok(vertices[0].bulge,'shallow curve must not become a straight line');
 const first=vertices[0],next=vertices[1];
 const tangent=Math.atan2(next.y-first.y,next.x-first.x)-2*Math.atan(first.bulge);
 assert.ok(Math.abs(tangent-Math.atan2(1,100))<.0002);
 for(let i=1;i<vertices.length-1;i++){
  const a=vertices[i-1],b=vertices[i],c=vertices[i+1];
  if(!a.bulge||!b.bulge)continue;
  const incoming=Math.atan2(b.y-a.y,b.x-a.x)+2*Math.atan(a.bulge);
  const outgoing=Math.atan2(c.y-b.y,c.x-b.x)-2*Math.atan(b.bulge);
  assert.ok(Math.abs(Math.atan2(Math.sin(outgoing-incoming),Math.cos(outgoing-incoming)))<.0004);
 }
});

test('small text uses scale-relative precision and remains consistent when enlarged',()=>{
 const commands=[[0,0,0],[2,50,110,200,0],[1,0,0],[4]];
 const small=outlineLoops(commands,.001)[0],large=outlineLoops(commands,.1)[0];
 assert.equal(small.length,large.length);
 for(let i=0;i<small.length;i++){
  assert.ok(Math.hypot(small[i].x-large[i].x,small[i].y-large[i].y)<1e-7);
  assert.ok(Math.abs((small[i].bulge||0)-(large[i].bulge||0))<1e-7);
 }
});
