import test from 'node:test';
import assert from 'node:assert/strict';
import {stretchDocument,chamferLines,breakAtPoint,moveGrip,setGeometryField,geometryFields} from '../src/cad/edit-tools.js';
import {createDocument,addEntities,History} from '../src/cad/document.js';
import {dimensionGeometry} from '../src/cad/dimensions.js';
import {findSoftAxis} from '../src/cad/snaps.js';
import {Editor} from '../src/cad/editor.js';
const p=(x,y)=>({x,y});
test('stretch keeps hole diameter and locked geometry, undo/redo exact',()=>{
 let d=addEntities(createDocument(),[{type:'line',start:p(0,0),end:p(100,0)},{type:'circle',center:p(90,5),radius:3},{type:'line',layer:'locked',start:p(90,0),end:p(100,0)}]);d.layers.push({name:'locked',visible:true,locked:true});
 const n=stretchDocument(d,{minX:80,minY:-10,maxX:110,maxY:10},p(20,0));assert.deepEqual(n.entities[0].start,p(0,0));assert.deepEqual(n.entities[0].end,p(120,0));assert.equal(n.entities[1].radius,3);assert.equal(n.entities[1].center.x,110);assert.deepEqual(n.entities[2],d.entities[2]);
 const h=new History(d);h.commit('stretch',n);h.undo();assert.equal(h.present,d);h.redo();assert.equal(h.present,n);
});
test('chamfer bounded and immutable',()=>{const a={type:'line',start:p(0,0),end:p(100,0)},b={type:'line',start:p(0,0),end:p(0,100)};const c=chamferLines(a,b,10,20);assert.deepEqual(c.first.start,p(10,0));assert.deepEqual(c.second.start,p(0,20));assert.deepEqual(a.start,p(0,0));assert.throws(()=>chamferLines(a,b,101,2));});
test('break projects onto line and rejects endpoint',()=>{const e={type:'line',start:p(0,0),end:p(100,0)};const x=breakAtPoint(e,p(30,2));assert.equal(x.length,2);assert.deepEqual(x[0].end,p(30,0));assert.deepEqual(x[1].start,p(30,0));assert.throws(()=>breakAtPoint(e,p(0,0)));});
test('grips and properties validated',()=>{const c={type:'circle',center:p(0,0),radius:4};assert.equal(moveGrip(c,'radius',p(3,4)).radius,5);assert.throws(()=>setGeometryField(c,'radius',-2));assert.equal(setGeometryField(c,'center.x',12).center.x,12);assert.equal(c.center.x,0);});
test('angular dimensions measure and leader annotates',()=>{const g=dimensionGeometry({kind:'angular',center:p(0,0),p1:p(10,0),p2:p(0,10),linePoint:p(20,0)});assert.equal(g.measurement,90);assert.equal(g.text,'90°');const l=dimensionGeometry({kind:'leader',p1:p(0,0),p2:p(10,10),linePoint:p(20,10),textOverride:'Furo'});assert.equal(l.text,'Furo');});
test('soft axis precise and weak in four directions',()=>{for(const [a,b] of [[p(100,3),p(100,0)],[p(-100,3),p(-100,0)],[p(3,100),p(0,100)],[p(-3,-100),p(0,-100)]])assert.deepEqual(findSoftAxis(p(0,0),a,10).point,b);assert.equal(findSoftAxis(p(0,0),p(10,8),10),null);assert.equal(findSoftAxis(p(0,0),p(1000,20),10),null);});
test('click dimension text selects complete dimension',()=>{const doc=addEntities(createDocument(),[{type:'dimension',kind:'horizontal',p1:p(0,0),p2:p(100,0),linePoint:p(0,30)}]);const text=dimensionGeometry(doc.entities[0],doc.dimStyle).texts[0];const e={doc,viewport:{pixelsToWorld:()=>0.1}};assert.equal(Editor.prototype.hitTest.call(e,p(text.position.x+1,text.position.y+1)).id,doc.entities[0].id);});
test('clockwise arc polyline break keeps negative bulge and total geometry',()=>{
 const e={type:'polyline',closed:false,vertices:[{x:0,y:0,bulge:-1},{x:20,y:0,bulge:0}]};
 const parts=breakAtPoint(e,p(10,10));assert.equal(parts.length,2);assert.ok(parts[0].vertices[0].bulge<0);assert.ok(parts[1].vertices[0].bulge<0);assert.ok(Math.abs(parts[0].vertices[0].bulge+Math.tan(Math.PI/8))<1e-8);
});
test('diameter field edits circle and arc radius',()=>{const c={type:'circle',center:p(0,0),radius:100};const keys=geometryFields(c).map(f=>f.key);assert.equal(keys[keys.indexOf('radius')+1],'diameter');assert.equal(geometryFields(c).find(f=>f.key==='diameter').value,200);assert.equal(setGeometryField(c,'diameter',150).radius,75);assert.equal(c.radius,100);assert.throws(()=>setGeometryField(c,'diameter',0));const a={type:'arc',center:p(0,0),radius:10,start:0,end:Math.PI};assert.equal(setGeometryField(a,'diameter',30).radius,15);assert.equal(geometryFields({type:'line',start:p(0,0),end:p(1,0)}).some(f=>f.key==='diameter'),false);});
