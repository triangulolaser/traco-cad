import test from 'node:test';
import assert from 'node:assert/strict';
import { rotationEdges, findRotationSnap } from '../src/cad/rotation-snap.js';
import { polar, degToRad } from '../src/cad/geometry.js';
const base = { x: 20, y: -30 };
const line = { type: 'line', start: base, end: polar(base, degToRad(30), 50) };
const edges = rotationEdges([line]);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, a+' != '+b);
for (const target of [-210,-120,-30,60,150,240]) test('borda inclinada nivela em '+target, () => {
    const s=findRotationSnap(edges,base,polar(base,degToRad(target+2),100),10);
    near(s.angle,degToRad(target > 180 ? target-360 : target < -180 ? target+360 : target));
    assert.ok(Math.abs(s.guide.start.x-s.guide.end.x)<1e-8 || Math.abs(s.guide.start.y-s.guide.end.y)<1e-8);
});
test('libera além de 3 graus ou 10 pixels, em vários zooms',()=>{
    for(const zoom of [0.1,1,10]) {
        assert.ok(findRotationSnap(edges,base,polar(base,degToRad(-28),100/zoom),10/zoom));
        assert.equal(findRotationSnap(edges,base,polar(base,degToRad(-26),100/zoom),10/zoom),null);
        assert.equal(findRotationSnap(edges,base,polar(base,degToRad(-28),1000/zoom),10/zoom),null);
    }
    assert.equal(findRotationSnap(edges,base,base,10),null);
});
test('referência considera delta real aplicado à peça',()=>{
    const s=findRotationSnap(edges,base,polar(base,degToRad(17),100),10,degToRad(45));
    near(s.angle,degToRad(-30)); near(s.guide.start.y,s.guide.end.y);
});
test('ignora círculos, texto, degeneradas e bulges',()=>{
    const poly={type:'polyline',closed:false,vertices:[{x:0,y:0,bulge:1},{x:10,y:0},{x:20,y:5}]};
    assert.equal(rotationEdges([poly,{type:'circle',center:base,radius:10},{type:'text'}, {type:'line',start:base,end:base}]).length,1);
});
test('bloco fornece borda transformada sem alterar original',()=>{
    const block={type:'insert',position:base,rotation:30,definition:{basePoint:{x:0,y:0},entities:[{type:'line',start:{x:0,y:0},end:{x:50,y:0}}]}};
    const before=JSON.stringify(block);const s=findRotationSnap(rotationEdges([block]),base,polar(base,degToRad(-28),100),10);
    near(s.guide.start.y,s.guide.end.y);assert.equal(JSON.stringify(block),before);
});
