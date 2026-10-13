import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineTextGeometry } from '../src/cad/text-editor.js';
import { Viewport } from '../src/cad/viewport.js';

const text = { position: {x: 10, y: 20}, height: 5, rotation: 45 };
test('inline text maps world anchor through pan/zoom and uses inverse screen rotation', () => {
    const view = new Viewport(800,600);
    view.pan(40,-25); view.zoomAt({x:120,y:90},2);
    const g = inlineTextGeometry(text,view,80,2);
    assert.deepEqual({x:g.x,y:g.y},view.worldToScreen(text.position));
    assert.equal(g.rotation,-45);
    assert.equal(g.px,40);
    assert.equal(g.height,94);
    assert.equal(g.offsetY,-32);
});
test('inline text preserves top/middle/bottom multiline alignment and centered/right anchors', () => {
    const view = new Viewport();
    assert.equal(inlineTextGeometry({...text,valign:'top'},view,80,3).offsetY,0);
    assert.equal(inlineTextGeometry({...text,valign:'middle',halign:'center'},view,80,3).offsetY,-37);
    assert.equal(inlineTextGeometry({...text,valign:'middle',halign:'center'},view,80,3).offsetX,-40);
    assert.equal(inlineTextGeometry({...text,valign:'bottom',halign:'right'},view,80,3).offsetY,-74);
    assert.equal(inlineTextGeometry({...text,halign:'right'},view,80,3).offsetX,-80);
});
test('MText box attachment preserves left/center/right box origin', () => {
    const view = new Viewport();
    for (const [attachmentPoint,expected] of [[1,0],[2,-60],[3,-120]]) {
        const g=inlineTextGeometry({...text,boxWidth:30,attachmentPoint},view,120,2);
        assert.equal(g.offsetX,expected);
        assert.equal(g.offsetY,0);
    }
});
