import test from 'node:test';
import assert from 'node:assert/strict';
import { imageCorners, imageVisibleCorners } from '../src/cad/extra-entities.js';
import { mirrorEntity, mirrorPoint } from '../src/cad/geometry.js';
const image = { type: 'image', position: { x: 3130.9643823085676, y: -543.2979369870867 }, width: 210, height: 296.9637096774193, rotation: 14.612898108582428, src: 'data:image/png;base64,test' };
const near = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)<1e-8;
// Source-pixel coordinates, independent of the entity's frame handedness.
function pixel(e,u,v) {
 const [p,x,,y]=imageCorners(e); const s=e.mirrored?1-u:u;
 return {x:p.x+s*(x.x-p.x)+v*(y.x-p.x),y:p.y+s*(x.y-p.y)+v*(y.y-p.y)};
}
for (const [name,a,b] of [['vertical',{x:3447.8924576347713,y:0},{x:3447.8924576347713,y:1}],['horizontal',{x:0,y:120},{x:1,y:120}],['oblique',{x:7,y:-12},{x:63,y:44}]]) {
 for (const mirrored of [false,true]) test(`image mirror ${name}, already mirrored=${mirrored}`,()=>{
  const original={...image,mirrored,clip:{u0:0.1,u1:0.7,v0:0.2,v1:0.8}};
  const result=mirrorEntity(original,a,b);
  for(const [u,v] of [[0,0],[1,0],[0,1],[1,1],[0.2,0.7]]) assert.ok(near(pixel(result,u,v),mirrorPoint(pixel(original,u,v),a,b)),`pixel ${u},${v}`);
  const visible=imageVisibleCorners(result);
  for(const p of imageVisibleCorners(original)) assert.ok(visible.some(q=>near(q,mirrorPoint(p,a,b))));
  const twice=mirrorEntity(result,a,b);
  for(const [u,v] of [[0,0],[1,1],[0.3,0.4]]) assert.ok(near(pixel(twice,u,v),pixel(original,u,v)));
  assert.equal(twice.mirrored,mirrored);
  assert.equal(original.clip.u0,0.1);
 });
}
