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

test('Ctrl+V cola o DWG do SolidWorks/BricsCAD da área de transferência com layers', async () => {
    const { documentToDwg } = await import('../src/cad/dwg.js');
    const src = addEntities({ ...createDocument(), layers: [{ name: '0', color: 7 }, { name: 'DOBRA', color: 3 }] },
        [{ type: 'line', start: { x: 5, y: 5 }, end: { x: 55, y: 5 }, layer: 'DOBRA' }, { type: 'circle', center: { x: 30, y: 30 }, radius: 10, layer: '0' }]);
    const bytes = await documentToDwg(src);
    let seq = 7;
    const bridge = { readCadClipboard: async () => ({ seq, format: 'AutoCAD.r14', bytes: Array.from(bytes) }), clipboardSequence: async () => seq };
    const before = globalThis.window; globalThis.window = { desktopBridge: bridge };
    try {
        const e = editor(); e.doc = createDocument();
        await COMMANDS.PASTECLIP.run(e);
        assert.equal(e.doc.entities.length, 2);
        assert.ok(e.doc.layers.some(l => l.name === 'DOBRA'));
        const line = e.doc.entities.find(x => x.type === 'line');
        assert.equal(line.layer, 'DOBRA');
        assert.deepEqual(line.start, { x: 100, y: 200 });
        // Cópia interna depois da cópia do sistema: Ctrl+V volta a usar a interna.
        e.selection = new Set([line.id]); await COMMANDS.COPYCLIP.run(e);
        await COMMANDS.PASTECLIP.run(e);
        assert.equal(e.doc.entities.length, 3);
        // Nova cópia no SolidWorks: o sistema volta a valer.
        seq = 8; await COMMANDS.PASTECLIP.run(e);
        assert.equal(e.doc.entities.length, 5);
    } finally { globalThis.window = before; }
});

test('sem DWG na área de transferência o Ctrl+V usa o clipboard interno', async () => {
    const before = globalThis.window;
    globalThis.window = { desktopBridge: { readCadClipboard: async () => ({ seq: 1, format: null, bytes: null }), clipboardSequence: async () => 1 } };
    try {
        const e = editor(); await COMMANDS.COPYCLIP.run(e); await COMMANDS.PASTECLIP.run(e);
        assert.equal(e.doc.entities.length, 2);
    } finally { globalThis.window = before; }
});
