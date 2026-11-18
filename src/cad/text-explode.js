import {cubicToArcs} from './import-svg.js';
import {fontEm, LINE_SPACING} from './fonts.js';
import {replaceEntities, isEntityEditable} from './document.js';

// Fit each original Bézier independently: corners and stencil openings remain exact.
// Tolerance is expressed in drawing millimeters, not font units.
export function outlineLoops(commands, scale, tolerance = .01) {
    if (!(scale > 0) || !Number.isFinite(scale) || !(tolerance > 0) || !Number.isFinite(tolerance)) {
        throw new Error('Escala ou tolerância inválida para o contorno.');
    }
    const loops = []; let loop = [], point;
    const appendCurve = points => {
        const cubic = points.length === 4 ? points : [points[0],
            {x:points[0].x+2/3*(points[1].x-points[0].x), y:points[0].y+2/3*(points[1].y-points[0].y)},
            {x:points[2].x+2/3*(points[1].x-points[2].x), y:points[2].y+2/3*(points[1].y-points[2].y)}, points[2]];
        for (const seg of cubicToArcs(cubic.map(p=>({x:p.x*scale,y:p.y*scale})), tolerance)) {
            if (seg.kind === 'arc') {
                let sweep = Math.atan2(seg.b.y-seg.center.y,seg.b.x-seg.center.x)-Math.atan2(seg.a.y-seg.center.y,seg.a.x-seg.center.x);
                if (seg.ccw && sweep < 0) sweep += 2*Math.PI;
                if (!seg.ccw && sweep > 0) sweep -= 2*Math.PI;
                loop.at(-1).bulge = Math.tan(sweep/4);
            }
            loop.push({x:seg.b.x/scale,y:seg.b.y/scale});
        }
    };
    for(const [op,...v] of commands){
        const p=(i)=>({x:v[i],y:v[i+1]});
        if(op===0){loop=[p(0)];point=p(0);}
        else if(op===1){point=p(0);loop.push(point);}
        else if(op===2||op===3){const end=p(op===2?2:4);appendCurve(op===2?[point,p(0),end]:[point,p(0),p(2),end]);point=end;}
        else if(op===4){
            if(loop.length>1){
                if(Math.hypot(loop[0].x-loop.at(-1).x,loop[0].y-loop.at(-1).y)<1e-9)loop.pop();
                if(loop.length>2 || (loop.length===2 && loop.some(p=>p.bulge)))loops.push(loop);
            }
            loop=[];
        }
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
                const vertices=loop.map(p=>{const lx=((p.x+(glyph.offset_x||0))*scale+x)*(entity.mirrored?-1:1),ly=(p.y+(glyph.offset_y||0))*scale+baseline-row*h*LINE_SPACING;return {x:entity.position.x+c*lx-s*ly,y:entity.position.y+s*lx+c*ly,...(p.bulge ? {bulge:p.bulge*(entity.mirrored?-1:1)} : {})};});
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
