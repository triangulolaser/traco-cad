import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, CancelError } from '../src/cad/commands.js';
import { createDocument, addEntities, History } from '../src/cad/document.js';
function editor() {
    const e = { doc: addEntities(createDocument(), [{ type: 'line', id: 'source', start: {x: 10,y: 20}, end: {x: 20,y: 20} }]), selection: new Set(['source']), log() {}, commits: [],
        async getSelection() { return [...this.selection]; }, entitiesById(ids) { return this.doc.entities.filter(e => ids.includes(e.id)); },
        commit(label, doc) { this.commits.push(this.doc); this.doc = doc; }, async getPoint() { return { point: {x:100,y:200} }; } };
    return e;
}
test('copy snapshot and paste preserve original, translate and allocate unique IDs', async () => {
    const e = editor(); await COMMANDS.COPYCLIP.run(e);
    assert.equal(e.commits.length,0);
    await COMMANDS.PASTECLIP.run(e); await COMMANDS.PASTECLIP.run(e);
    assert.equal(e.doc.entities.length,3);
    assert.equal(new Set(e.doc.entities.map(e=>e.id)).size,3);
    assert.deepEqual(e.doc.entities[1].start,{x:100,y:200});
    assert.deepEqual(e.doc.entities[0].start,{x:10,y:20});
    assert.deepEqual(e.entityClipboard.entities[0].start,{x:10,y:20});
});
test('cut is one reversible commit; paste cancellation never changes document', async () => {
    const e = editor(); await COMMANDS.CUTCLIP.run(e);
    assert.equal(e.doc.entities.length,0); assert.equal(e.commits.length,1);
    e.doc = e.commits.pop(); assert.equal(e.doc.entities.length,1);
    e.getPoint = async () => { throw new CancelError(); };
    await assert.rejects(COMMANDS.PASTECLIP.run(e),CancelError);
    assert.equal(e.doc.entities.length,1);
});
test('clipboard pastes across drawing tabs and restores missing layers', async () => {
    const e = editor(); e.doc.layers.push({name:'CORTE',color:1,locked:false}); e.doc.entities[0].layer='CORTE';
    await COMMANDS.COPYCLIP.run(e); e.doc=createDocument(); await COMMANDS.PASTECLIP.run(e);
    assert.equal(e.doc.entities.length,1); assert.equal(e.doc.layers.find(l=>l.name==='CORTE').color,1);
});
test('locked layers, empty clipboard and mismatched units do not mutate document', async () => {
    const e = editor(); await COMMANDS.PASTECLIP.run(e); assert.equal(e.commits.length,0);
    e.doc.layers[0].locked=true; await COMMANDS.CUTCLIP.run(e); assert.equal(e.doc.entities.length,1);
    e.doc.layers[0].locked=false; await COMMANDS.COPYCLIP.run(e); e.doc.units='inch';
    await COMMANDS.PASTECLIP.run(e); assert.equal(e.commits.length,0);
    e.doc.units='mm'; e.doc.layers[0].locked=true; await COMMANDS.PASTECLIP.run(e); assert.equal(e.commits.length,0);
});

test('Ctrl/Cmd clipboard routes CAD but leaves editable fields and text prompts native', async () => {
    const { Editor } = await import('../src/cad/editor.js');
    const before = globalThis.document;
    const calls=[];
    const e={ terminal:{isFocused:()=>false,value:()=>''},root:{contains:()=>true},runCommand:name=>calls.push(name) };
    const key=(k,extra={})=>{ const ev={key:k,ctrlKey:true,preventDefault(){this.prevented=true;},...extra}; Editor.prototype.onKeyDown.call(e,ev);return ev; };
    try {
        globalThis.document={activeElement:{tagName:'CANVAS'}};
        for(const k of ['c','x','v']) assert.equal(key(k).prevented,true);
        assert.equal(key('c',{ctrlKey:false,metaKey:true}).prevented,true);
        assert.deepEqual(calls,['COPYCLIP','CUTCLIP','PASTECLIP','COPYCLIP']);
        globalThis.document.activeElement={tagName:'INPUT'};
        assert.equal(key('v').prevented,undefined);
        e.terminal.isFocused=()=>true; e.terminal.value=()=>'texto';
        assert.equal(key('x').prevented,undefined);
        e.terminal.value=()=>'';e.pending={mode:'string'};
        assert.equal(key('v').prevented,undefined);
        e.pending=null;assert.equal(key('v').prevented,true);
    } finally {globalThis.document=before;}
});
