import test from 'node:test';
import assert from 'node:assert/strict';
import { solveBernsteinRoots } from '../src/cad/predicates.js';
import { intersectLineBezier } from '../src/cad/curve-intersect.js';
test('Bernstein endpoint tangency is bounded and emits only the true root', () => {
 const start = performance.now();
 for (const scale of [1,-1,1e-12,1e12]) {
 assert.deepEqual(solveBernsteinRoots([0,0,.25,1].map(x=>x*scale)),[0]);
 assert.deepEqual(solveBernsteinRoots([1,.25,0,0].map(x=>x*scale)),[1]);
 assert.deepEqual(solveBernsteinRoots([0,1,1,0].map(x=>x*scale)),[0,1]);
 assert.deepEqual(solveBernsteinRoots([1e-16,1e-16,.25,1].map(x=>x*scale)),[]);
 }
 assert.ok(performance.now()-start<500,'endpoint roots must not expand exponential subdivision trees');
});
test('interior double root and crossings remain available',()=>{
 const roots=solveBernsteinRoots([.25,-.25,.25]);
 assert.equal(roots.length,1);assert.ok(Math.abs(roots[0]-.5)<1e-9);
 const crossing=solveBernsteinRoots([-.25,.75]);assert.equal(crossing.length,1);assert.ok(Math.abs(crossing[0]-.25)<1e-12);
});
test('line tangent to cubic endpoint returns one intersection after translation and scaling',()=>{
 for(const s of [.01,1,100])for(const offset of [0,8000]){
 const point=(x,y)=>({x:offset+x*s,y:offset+y*s});
 const curve={kind:'bezier',points:[point(0,0),point(0,-.2),point(-.05,-.4),point(-.15,-.6)]};
 const hits=intersectLineBezier(point(0,-3),point(0,0),curve);
 assert.equal(hits.length,1);assert.ok(Math.hypot(hits[0].point.x-offset,hits[0].point.y-offset)<1e-9);
 }
});
