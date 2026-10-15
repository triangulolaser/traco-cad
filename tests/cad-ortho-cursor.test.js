import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/cad/editor.js';
import { createDocument } from '../src/cad/document.js';
function setup() {
    let state;
    const editor = { doc:createDocument(),cursorWorld:{x:10,y:3},settings:{ortho:true,polar:false,grid:false},
        pending:{mode:'point',reference:{x:0,y:0},preview:point=>[{point}]},selection:new Set(),
        renderer:{draw:s=>{state=s;}},updateCoordinates(){},effectiveCursor:Editor.prototype.effectiveCursor };
    return {editor,draw:()=>{Editor.prototype.render.call(editor);return state;}};
}
test('ORTO constrains preview and construction point, never the visual cursor',()=>{
    const {editor,draw}=setup();const state=draw();
    assert.deepEqual(state.cursor,{x:10,y:3});
    assert.deepEqual(state.preview,[{point:{x:10,y:0}}]);
    assert.deepEqual(state.rubber.to,{x:10,y:0});
    assert.deepEqual(editor.effectiveCursor(),{x:10,y:0});
    editor.cursorWorld={x:2,y:12};
    assert.deepEqual(draw().cursor,{x:2,y:12});
    assert.deepEqual(editor.effectiveCursor(),{x:0,y:12});
});
test('snap indicator and construction point remain distinct from free cursor',()=>{
    const {editor,draw}=setup();editor.snap={mode:'END',point:{x:12,y:0}};
    const state=draw();assert.deepEqual(state.cursor,{x:10,y:3});
    assert.deepEqual(state.rubber.to,editor.snap.point);assert.equal(state.snap,editor.snap);
});
test('no ORTO leaves preview free and leaving stage hides cursor',()=>{
    const {editor,draw}=setup();editor.settings.ortho=false;
    assert.deepEqual(draw().rubber.to,editor.cursorWorld);
    editor.cursorWorld=null;const state=draw();assert.equal(state.cursor,null);assert.equal(state.showCrosshair,false);
});
test('point prompt uses the BricsCAD-style crosshair without pickbox',async()=>{
    const {editor,draw}=setup();assert.equal(draw().crosshairMode,'point');
    editor.pending={mode:'entity'};assert.equal(draw().crosshairMode,'select');
    editor.pending=null;assert.equal(draw().crosshairMode,'select');
    const { Renderer: CadRenderer } = await import('../src/cad/renderer.js');
    const calls=[];const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:(...a)=>calls.push([k,...a]),set:(t,k,v)=>{t[k]=v;calls.push(['set',k,v]);return true;}});
    const r=Object.create(CadRenderer.prototype);r.ctx=ctx;r.viewport={worldToScreen:p=>p};r.theme={crosshair:'w',crosshairX:'red',crosshairY:'green'};
    r.drawCrosshair({x:100,y:100},false,true);
    assert.ok(!calls.some(c=>c[0]==='strokeRect'));
    assert.ok(calls.some(c=>c[0]==='set'&&c[2]==='red'));assert.ok(calls.some(c=>c[0]==='set'&&c[2]==='green'));
    assert.ok(calls.some(c=>c[0]==='lineTo'&&c[1]===148));
    calls.length=0;r.drawCrosshair({x:100,y:100},false,false);
    assert.ok(calls.some(c=>c[0]==='strokeRect'));
});
