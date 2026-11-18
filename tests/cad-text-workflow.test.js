import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLeaderText, leaderTextDraft, isTextAnnotation } from '../src/cad/text-editor.js';
import { dimensionGeometry } from '../src/cad/dimensions.js';
import { mergeFontOptions } from '../src/cad/local-font-picker.js';

test('leader text adapter preserves arrow geometry, custom style and explicit formatting', () => {
    const leader = {type:'dimension',kind:'leader',id:'leader',p1:{x:0,y:0},p2:{x:12,y:8},linePoint:{x:12,y:8},textOverride:'Original',style:{textHeight:4,arrowSize:3},fontFamily:'Arial'};
    assert.ok(isTextAnnotation(leader)); assert.equal(isTextAnnotation({type:'dimension',kind:'linear'}),false);
    const draft = leaderTextDraft(leader,{textHeight:2.5});
    assert.equal(draft.height,4); assert.equal(draft.text,'Original');
    const next = applyLeaderText(leader,{...draft,text:'Linha 1\nLinha 2',height:3.25,bold:true,rotation:15,halign:'right',boxWidth:25});
    assert.equal(next.type,'dimension'); assert.equal(next.p1,leader.p1); assert.equal(next.style,leader.style);
    const g = dimensionGeometry(next);
    assert.equal(g.arrows.length,1); assert.equal(g.texts[0].height,3.25);
    assert.equal(g.texts[0].rotation,15); assert.equal(g.texts[0].halign,'right'); assert.equal(g.texts[0].boxWidth,25);
    assert.equal(g.texts[0].text,'Linha 1\nLinha 2');
});

test('system fonts merge into existing selector without duplicates or HTML injection', () => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ value: '', textContent: '' }) };
    try {
        const select = { value: 'Arial', options: [{ value: 'Arial' }], replaceChildren(...options) { this.options = options; } };
        mergeFontOptions(select,['Arial',' TC_LaserSans ','<script>bad</script>','', 'bad\nname']);
        assert.equal(select.value,'Arial');
        assert.equal(select.options.length,3);
        assert.ok(select.options.some(option => option.textContent === '<script>bad</script>'));
        assert.ok([...select.options].some(option=>option.value==='TC_LaserSans'));
    } finally { globalThis.document = previous; }
});

test('leader panel height is in drawing millimeters even when dimension scale differs', () => {
    const leader = {type:'dimension',kind:'leader',p1:{x:0,y:0},p2:{x:12,y:8},linePoint:{x:12,y:8},textHeight:5};
    const style = {scale:0.2};
    assert.equal(leaderTextDraft(leader,style).height,1);
    const edited = applyLeaderText(leader,{text:'Note',height:3.25},style);
    assert.equal(dimensionGeometry(edited,style).texts[0].height,3.25);
});
