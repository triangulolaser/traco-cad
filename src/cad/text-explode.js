import {fontEm, LINE_SPACING} from './fonts.js';
import {replaceEntities, isEntityEditable} from './document.js';

// Adaptive subdivision bounds the chord error in drawing millimeters.
export function outlineLoops(commands, scale, tolerance = .01) {
    const loops = []; let loop = [], point;
    const dist = (p,a,b) => {
        const dx=b.x-a.x,dy=b.y-a.y;
        const t=dx*dx+dy*dy ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy))) : 0;
        return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    };
    const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const flatten=(points,depth=0)=>{
        if(depth>=18 || points.slice(1,-1).every(p=>dist(p,points[0],points.at(-1))*scale<=tolerance)) {loop.push(points.at(-1));return;}
        let row=points,left=[row[0]],right=[row.at(-1)];
        while(row.length>1){row=row.slice(1).map((p,i)=>mid(row[i],p));left.push(row[0]);right.unshift(row.at(-1));}
        flatten(left,depth+1);flatten(right,depth+1);
    };
    for(const [op,...v] of commands){
        const p=(i)=>({x:v[i],y:v[i+1]});
        if(op===0){loop=[p(0)];point=p(0);}
        else if(op===1){point=p(0);loop.push(point);}
        else if(op===2||op===3){const end=p(op===2?2:4);flatten(op===2?[point,p(0),end]:[point,p(0),p(2),end]);point=end;}
        else if(op===4){if(loop.length>2){if(loop[0].x===loop.at(-1).x&&loop[0].y===loop.at(-1).y)loop.pop();loops.push(loop);}loop=[];}
    }
    return loops;
}

export async function textPolylines(entity, readOutlines) {
    if(!readOutlines)throw new Error('TXTEXP de fontes instaladas está disponível no Traço desktop atualizado.');
    const raw=String(entity.text??'').split('\n');
    const style={family:entity.fontFamily||'Liberation Sans',bold:!!entity.bold,italic:!!entity.italic};
    const lines=[];
    const shape = async text => {
        const data=await readOutlines({...style,text});
        return {glyphs:data.glyphs,scale:fontEm(entity.height)/data.units_per_em};
    };
    for(const text of raw){
        if(entity.boxWidth>0){
            let line='';
            for(const word of text.split(' ')){
                const candidate=line ? line+' '+word : word;
                const shaped=await shape(candidate);
                const width=shaped.glyphs.reduce((sum,g)=>sum+g.advance*shaped.scale,0);
                if(line && width>entity.boxWidth){lines.push(await shape(line));line=word;}
                else line=candidate;
            }
            lines.push(await shape(line));
        } else lines.push(await shape(text));
    }
    const h=entity.height,total=h+(lines.length-1)*h*LINE_SPACING;
    const valign=entity.valign??(entity.attachmentPoint?'top':'baseline');
    const baseline=valign==='top'?-h:valign==='middle'?total/2-h:valign==='bottom'?total-h:0;
    const angle=(entity.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),result=[];
    lines.forEach(({glyphs,scale},row)=>{
        const width=glyphs.reduce((sum,g)=>sum+g.advance*scale,0);
        let x=entity.halign==='center'?-width/2:entity.halign==='right'?-width:0;
        if(entity.boxWidth>0){x-=(((entity.attachmentPoint||1)-1)%3)*entity.boxWidth/2;x+=entity.halign==='center'?entity.boxWidth/2:entity.halign==='right'?entity.boxWidth:0;}
        for(const glyph of glyphs){
            for(const loop of outlineLoops(glyph.commands,scale)){
                const vertices=loop.map(p=>{const lx=((p.x+(glyph.offset_x||0))*scale+x)*(entity.mirrored?-1:1),ly=(p.y+(glyph.offset_y||0))*scale+baseline-row*h*LINE_SPACING;return {x:entity.position.x+c*lx-s*ly,y:entity.position.y+s*lx+c*ly};});
                result.push({type:'polyline',closed:true,vertices,layer:entity.layer,color:entity.color,lineType:entity.lineType,lineWeight:entity.lineWeight});
            }
            x+=glyph.advance*scale;
        }
    });
    return result;
}

export async function explodeText(editor) {
    let ids=[...editor.selection];
    if(!ids.length)ids=await editor.getSelection('Selecione textos para converter em contornos:');
    const source=editor.doc,entities=editor.entitiesById(ids).filter(e=>e.type==='text');
    if(!entities.length)throw new Error('Selecione entidades TEXT ou MTEXT.');
    const replacements=new Map();
    for(const entity of entities){
        if(!isEntityEditable(source,entity))throw new Error('A camada deste texto está bloqueada para edição.');
        const curves=await textPolylines(entity,globalThis.window?.desktopBridge?.systemTextOutlines);
        if(!curves.length)throw new Error('Texto sem contornos. O original foi preservado.');
        replacements.set(entity.id,curves);
    }
    if(editor.doc!==source)throw new Error('O desenho mudou durante a conversão. Repita TXTEXP.');
    editor.commit('TXTEXP',replaceEntities(source,replacements));
    editor.selection=new Set();editor.invalidate();
}
