import {registerEntityProvider,entityCurves,entityBox,transformEntity,add,sub,distance,angleOf,degToRad,radToDeg,polar} from './geometry.js';
import {normalizeEntity,isEntityEditable} from './document.js';

export function expandInsert(insert, depth=0) {
    if(depth>12)throw new Error('Blocos aninhados além do limite de segurança.');
    const block=insert.definition;
    if(!block)return [];
    const sx=insert.scaleX??1,sy=insert.scaleY??1,angle=degToRad(insert.rotation??0),c=Math.cos(angle),s=Math.sin(angle);
    const fn=p=>{const x=(p.x-block.basePoint.x)*sx,y=(p.y-block.basePoint.y)*sy;return {x:insert.position.x+x*c-y*s,y:insert.position.y+x*s+y*c};};
    return block.entities.flatMap(e=>e.type==='insert'?expandInsert(e,depth+1):[e]).map(e=>{
        let out;
        // Escala não uniforme de círculos deve virar elipse, não círculo incorreto.
        if(e.type==='circle' && Math.abs(Math.abs(sx)-Math.abs(sy))>1e-9){
            const alongX=Math.abs(sx)>=Math.abs(sy),center=fn(e.center);
            out={...e,type:'ellipse',center,major:sub(fn(add(e.center,alongX?{x:e.radius,y:0}:{x:0,y:e.radius})),center),ratio:Math.min(Math.abs(sx),Math.abs(sy))/Math.max(Math.abs(sx),Math.abs(sy)),start:0,end:Math.PI*2};
        }else {
            if(Math.abs(Math.abs(sx)-Math.abs(sy))>1e-9 && ['arc','polyline','dimension','hatch'].includes(e.type))throw new Error('Bloco com arcos/cotas/hachuras exige escala uniforme para preservar geometria.');
            out=transformEntity(e,fn,{mirror:sx*sy<0});
        }
        return {...out,layer:e.layer==='0'?insert.layer:e.layer,color:e.color==='byblock'?insert.color:e.color,id:insert.id};
    });
}
export function createInsert(name,definition,position,{scale=1,rotation=0,layer='0'}={}){
    if(!Number.isFinite(scale)||Math.abs(scale)<1e-9)throw new Error('Escala inválida.');
    return {type:'insert',name,definition:structuredClone(definition),position,scaleX:scale,scaleY:scale,rotation,layer,color:'bylayer'};
}
export function defineBlock(doc,name,entities,basePoint){
    name=String(name).trim();
    if(['__proto__','constructor','prototype'].includes(name))throw new Error('Nome reservado.');
    if(!name || /[<>/\\":;?*|=\n\r]/.test(name))throw new Error('Nome de bloco inválido.');
    if(!entities.length)throw new Error('Bloco vazio.');
    const definition={basePoint:{...basePoint},entities:entities.flatMap(e=>e.type==='insert'?expandInsert(e):[structuredClone(e)]).map(e=>({...e,id:undefined}))};
    if(doc.entities.some(e=>e.type==='insert'&&e.name===name&&!isEntityEditable(doc,e)))throw new Error('Há instâncias desse bloco em layer bloqueado.');
    return {...doc,blocks:{...doc.blocks,[name]:definition},entities:doc.entities.map(e=>e.type==='insert'&&e.name===name?{...e,definition:structuredClone(definition)}:e)};
}
export function hydrateInsert(raw,blocks,stack=[]){
    const name=raw.name;
    if(stack.includes(name)||stack.length>12)throw new Error(`Referência circular ou profunda no bloco ${name}.`);
    const b=Object.hasOwn(blocks,name)?blocks[name]:null;if(!b || !Array.isArray(b.entities))throw new Error(`Definição ausente para bloco ${name}.`);
    const entities=b.entities.map(e=>e.type==='__insert'||e.type==='insert'?hydrateInsert(e,blocks,[...stack,name]):e);
    const out={...raw,type:'insert',definition:{...b,entities}};
    expandInsert(out); // rejeita transformações que ainda não preservamos fielmente.
    return out;
}
registerEntityProvider('insert',{
    curves:e=>expandInsert(e).flatMap(entityCurves),
    extraPoints:e=>expandInsert(e).flatMap(child=>{const b=entityBox(child);return [{x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}];}),
    transform:(e,fn,mirror)=>{
        const position=fn(e.position),x=fn(polar(e.position,degToRad(e.rotation??0),1));
        const factor=distance(position,x);
        return {...e,position,rotation:radToDeg(angleOf(position,x)),scaleX:(e.scaleX??1)*factor,scaleY:(e.scaleY??1)*factor*(mirror?-1:1)};
    }
});
