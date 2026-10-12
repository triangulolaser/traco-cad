import test from 'node:test';import assert from 'node:assert/strict';
import {createDocument,addEntities}from '../src/cad/document.js';
import {printLayout,printSvg}from '../src/cad/print.js';
const d=addEntities(createDocument(),[{type:'line',start:{x:0,y:0},end:{x:100,y:0}}]);
test('1:1 keeps 100mm physical length; 1:2 halves it',()=>{assert.equal(printLayout(d).factor,1);assert.equal(printLayout(d,{denominator:2}).factor,0.5);assert.match(printSvg(d),/width="297mm" height="210mm"/);});
test('inch units converted; overflow rejected rather than silently clipped',()=>{assert.equal(printLayout({...d,units:'in'},{denominator:100}).factor,0.254);assert.throws(()=>printLayout(d,{denominator:0.1}));});
test('title and annotation escaped, no script injection',()=>{assert.ok(!printSvg(d,{title:'<script>alert(1)</script>'}).includes('<script>'));assert.match(printSvg(d,{title:'A&B'}),/A&amp;B/);});
