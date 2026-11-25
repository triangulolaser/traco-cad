import test from 'node:test';import assert from 'node:assert/strict';
import {loopsFromEntities,hatchLineRange,MAX_HATCH_EDGES,patternSegments}from'../src/cad/hatch.js';
import {Renderer}from'../src/cad/renderer.js';
const ring=(count,radius=100,cx=0)=>{const v=i=>({x:cx+radius*Math.cos(2*Math.PI*i/count),y:radius*Math.sin(2*Math.PI*i/count)});return Array.from({length:count},(_,i)=>{const j=i*997%count;return{type:'line',start:v(j),end:v((j+1)%count)}});};
test('shuffled 8000-edge contour closes and independent loops remain separate',()=>{const t=performance.now();const loops=loopsFromEntities(ring(8000));assert.equal(loops.length,1);assert.equal(loops[0].vertices.length,8000);console.log('8000 edges ms',Math.round(performance.now()-t));assert.equal(loopsFromEntities([...ring(100),...ring(100,10,200)]).length,2);});
test('complexity overflow is explicit, before geometry expansion',()=>{assert.throws(()=>loopsFromEntities(ring(MAX_HATCH_EDGES+1)),/complexo|limitada/);});
test('line range uses bounded count even when first + 1 equals first',()=>{const r=hatchLineRange(1e17,1e17+1000,2);assert.ok(r.count>0&&r.count<=6001);assert.equal(r.first+1,r.first);assert.equal(hatchLineRange(NaN,2,1).count,0);});
test('renderer terminates at huge coordinates instead of blocking forever',()=>{
 let calls=0;const old=globalThis.Path2D;globalThis.Path2D=class{moveTo(){}lineTo(){calls++;assert.ok(calls<=6001+4,'bounded render');}closePath(){}rect(){}};
 const ctx=new Proxy({},{get:(_,key)=>()=>{if(key==='lineTo'){calls++;assert.ok(calls<=6001,'bounded render');}},set:()=>true});
 const e={type:'hatch',pattern:'ANSI31',angle:0,spacing:2,loops:[{vertices:[{x:0,y:1e17},{x:100,y:1e17},{x:100,y:1e17+1000},{x:0,y:1e17+1000}]}]};
 try{Renderer.prototype.drawHatch.call({ctx,viewport:{width:1000,height:1000,scale:1,worldToScreen:p=>({x:p.x,y:1e17+1000-p.y})}},e,{});assert.ok(calls>0);}finally{globalThis.Path2D=old;}
});

test('pontos internos: spline e elipse abertas na vista não quebram e fecham contorno com linhas', async () => {
    const { loopsFromEntities, loopAreaExact } = await import('../src/cad/hatch.js').then(async (m) => ({ ...m, ...(await import('../src/cad/topology-dcel.js')) }));
    const lines = [
        { id: 'a', type: 'line', layer: '0', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
        { id: 'b', type: 'line', layer: '0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { id: 'c', type: 'line', layer: '0', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    ];
    const spline = { id: 's', type: 'spline', layer: '0', degree: 3, fitPoints: [{ x: 10, y: 10 }, { x: 5, y: 13 }, { x: 0, y: 10 }] };
    const loops = loopsFromEntities([...lines, spline]);
    assert.ok(loops.some((l) => Math.abs(loopAreaExact(l)) > 100), 'contorno com topo em spline');
    const ellipse = { id: 'e', type: 'ellipse', layer: '0', center: { x: 30, y: 5 }, major: { x: 4, y: 0 }, ratio: 0.5, start: 0, end: 1.5 };
    const stray = { id: 'x', type: 'spline', layer: '0', degree: 3, fitPoints: [{ x: 40, y: 0 }, { x: 42, y: 3 }, { x: 45, y: 1 }] };
    assert.doesNotThrow(() => loopsFromEntities([...lines, spline, ellipse, stray]));
    const closedRect = { id: 'r', type: 'polyline', layer: '0', closed: true, vertices: [{ x: 50, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 10 }, { x: 50, y: 10 }] };
    assert.doesNotThrow(() => loopsFromEntities([closedRect, ellipse, stray, lines[0]]));
});

test('pontos internos em vista pesada: face com cruzamento em T achada em volta do clique, com ilha', async () => {
    const { localBoundaryLoopsAt, loopAreaExact } = await import('../src/cad/hatch.js').then(async (m) => ({ ...m, ...(await import('../src/cad/topology-dcel.js')) }));
    const L = (a, b, c, d) => ({ type: 'line', start: { x: a, y: b }, end: { x: c, y: d } });
    const face = [L(0, 0, 100, 0), L(100, 0, 100, 50), L(100, 50, 0, 50), L(0, 50, 0, 0), L(0, 25, 100, 25), { type: 'circle', center: { x: 50, y: 10 }, radius: 3 }];
    const noise = Array.from({ length: 2500 }, (_, i) => L(200 + i, 0, 200 + i, 5));
    const ents = [...face, ...noise];
    const found = localBoundaryLoopsAt({ x: 20, y: 10 }, ents, { limitBox: { minX: 0, minY: 0, maxX: 2700, maxY: 60 } });
    assert.deepEqual(found.map((l) => Math.round(Math.abs(loopAreaExact(l)))).sort((a, b) => b - a), [2500, 28], 'metade de baixo + ilha do círculo');
    assert.equal(localBoundaryLoopsAt({ x: 150, y: 10 }, ents).length, 0, 'fora de qualquer contorno');
    assert.equal(localBoundaryLoopsAt({ x: 20, y: 40 }, ents).map((l) => Math.round(Math.abs(loopAreaExact(l))))[0], 2500, 'metade de cima');
});

test('pontos internos: aba curva de vista isométrica fecha apesar do arredondamento de 6 casas do DXF', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseDxf } = await import('../src/cad/dxf.js');
    const { localBoundaryLoopsAt, loopsFromEntities, boundaryLoopsAt, loopAreaExact } = await import('../src/cad/hatch.js').then(async (m) => ({ ...m, ...(await import('../src/cad/topology-dcel.js')) }));
    const ents = parseDxf(readFileSync(new URL('./fixtures/hatch-aba-curva-isometrica.dxf', import.meta.url), 'utf8')).entities;
    const p = { x: 162, y: -1.5 };
    const local = localBoundaryLoopsAt(p, ents);
    assert.ok(local.length > 1, 'aba com os furos como ilhas');
    assert.ok(Math.abs(Math.abs(loopAreaExact(local[0])) - 152.3) < 0.5, 'área da aba ' + Math.abs(loopAreaExact(local[0])));
    assert.ok(boundaryLoopsAt(p, loopsFromEntities(ents)).length > 0, 'laços da vista inteira também fecham');
});
