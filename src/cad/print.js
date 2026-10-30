import {entityCurves,entityBox,emptyBox,boxAddPoint,boxIsEmpty,polar,sweepCCW,polylineCurves} from './geometry.js';
import {visibleEntities,entityColor,layerOf,LINETYPES} from './document.js';
import {expandInsert} from './blocks.js';
import {dimensionGeometry} from './dimensions.js';
import {fontFamily,loadCadFonts} from './fonts.js';
import './extra-entities.js';
import {patternGeometry} from './hatch.js';
export const escapeXml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const n=x=>Number(x.toFixed(6));
function curvePath(c){
 if(c.kind==='segment')return `M${n(c.a.x)} ${n(c.a.y)}L${n(c.b.x)} ${n(c.b.y)}`;
 if(c.kind==='circle'){const {x,y}=c.center,r=c.radius;return `M${n(x-r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2*r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2*r)} 0`;}
 const a=polar(c.center,c.start,c.radius),b=polar(c.center,c.end,c.radius);
 return `M${n(a.x)} ${n(a.y)}A${n(c.radius)} ${n(c.radius)} 0 ${sweepCCW(c.start,c.end)>Math.PI?1:0} 1 ${n(b.x)} ${n(b.y)}`;
}
function textSvg(e){
 return `<g transform="translate(${n(e.position.x)} ${n(e.position.y)}) rotate(${n(e.rotation??0)}) scale(1 -1)"><text font-family="${escapeXml(fontFamily(e.fontFamily))}" font-size="${n(fontEm(e.height))}" font-weight="${e.bold?700:400}" font-style="${e.italic?'italic':'normal'}" stroke="none">${String(e.text??'').split('\n').map((line,i)=>`<tspan x="0" y="${n(i*e.height*LINE_SPACING)}">${escapeXml(line)}</tspan>`).join('')}</text></g>`;
}
function entitySvg(e,doc,k,mono){
 if(e.type==='insert')return expandInsert(e).filter(x=>layerOf(doc,x.layer)?.visible!==false).map(x=>entitySvg(x,doc,k,mono)).join('');
 const color=mono?'#000000':entityColor(e,doc),stroke=(e.lineWeight??layerOf(doc,e.layer)?.lineWeight??25)/100||0.25;
 let body='';
 if(e.type==='text')body=textSvg(e);
 else if(e.type==='dimension'){
  const g=dimensionGeometry(e,doc.dimStyle);
  body=g.segments.map(s=>`<path d="${curvePath({kind:'segment',...s})}" fill="none"/>`).join('')+(g.arcs??[]).map(a=>`<path d="${curvePath({kind:'arc',center:a.center,radius:a.radius,start:a.startAngle,end:a.endAngle})}" fill="none"/>`).join('')+g.arrows.map(t=>`<polygon points="${t.map(p=>`${n(p.x)},${n(p.y)}`).join(' ')}" stroke="none"/>`).join('')+g.texts.map(textSvg).join('');
 }else if(e.type==='image'){
  if(!/^data:image\/(png|jpeg|webp);base64,/.test(e.dataURL??e.src??''))throw new Error('Imagem de referência não embutida; impressão cancelada para evitar omissão.');
  body=`<g transform="translate(${n(e.position.x)} ${n(e.position.y)}) rotate(${n(e.rotation??0)}) scale(1 -1)"><image href="${escapeXml(e.dataURL??e.src)}" x="0" y="${-e.height}" width="${e.width}" height="${e.height}" opacity="${e.opacity??1}"/></g>`;
 }else if(e.type==='hatch'){
  const d=e.loops.map(l=>polylineCurves(l.vertices,true).map((c,i)=>{const path=curvePath(c);return i?path.replace(/^M[-\d.]+ [-\d.]+/,''):path;}).join('')+'Z').join('');
  if(e.pattern==='SOLID')body=`<path d="${d}" fill="${color}" fill-rule="evenodd"/>`;
  else {
   // Mesmo padrão da tela, recortado pelo contorno em coordenadas do desenho.
   const g=patternGeometry(e);
   if(!g.complete)body=`<path d="${d}" fill="${color}" fill-opacity="0.25" fill-rule="evenodd" stroke="none"/>`;
   else body=`<path d="${g.segments.map(s=>`M${n(s.a.x)} ${n(s.a.y)}L${n(s.b.x)} ${n(s.b.y)}`).join('')}" fill="none" stroke="${color}" stroke-width="${0.15/k}"/>`+(g.dots.length?`<path d="${g.dots.map(p=>`M${n(p.x)} ${n(p.y)}h0`).join('')}" fill="none" stroke="${color}" stroke-width="${0.3/k}" stroke-linecap="round"/>`:'');
  }
 }else body=`<path d="${entityCurves(e).map(curvePath).join('')}" fill="none"/>`;
 const type=e.lineType && e.lineType!=='bylayer'?e.lineType:layerOf(doc,e.layer)?.lineType;
 const dash=LINETYPES[type]?.pattern??[];
 return `<g stroke-dasharray="${dash.map(x=>Math.max(Math.abs(x),0.3)).join(' ')}" fill="${escapeXml(color)}" stroke="${escapeXml(color)}" stroke-width="${n(stroke/k)}" stroke-linejoin="round" stroke-linecap="round">${body}</g>`;
}
export function printLayout(doc,{paper='A4',landscape=true,denominator=1,margin=10,fit=false}={}){
 if(!['A4','A3'].includes(paper)||!Number.isFinite(denominator)||denominator<=0)throw new Error('Papel/escala inválidos.');
 let [width,height]=paper==='A3'?[297,420]:[210,297];if(landscape)[width,height]=[height,width];
 const entities=visibleEntities(doc),box=emptyBox();for(const e of entities){const b=entityBox(e);if(!boxIsEmpty(b)){boxAddPoint(box,{x:b.minX,y:b.minY});boxAddPoint(box,{x:b.maxX,y:b.maxY});}}
 if(boxIsEmpty(box))throw new Error('Desenho vazio.');
 const unit=doc.units==='in'?25.4:1,availableW=width-2*margin,availableH=height-2*margin-25;
 const factor=fit?Math.min(availableW/Math.max(box.maxX-box.minX,1e-9),availableH/Math.max(box.maxY-box.minY,1e-9)):unit/denominator;
 if(!fit&&((box.maxX-box.minX)*factor>availableW+1e-6||(box.maxY-box.minY)*factor>availableH+1e-6))throw new Error('Desenho não cabe nessa escala. Aumente o denominador, use A3 ou Ajustar.');
 return {width,height,box,factor,denominator:unit/factor,margin,entities,x:margin+(availableW-(box.maxX-box.minX)*factor)/2-box.minX*factor,y:margin+(availableH-(box.maxY-box.minY)*factor)/2+box.maxY*factor};
}
export function printSvg(doc,options={}){
 const l=printLayout(doc,options),title=options.title??doc.name,author=options.author??'',revision=options.revision??'';
 const content=l.entities.map(e=>entitySvg(e,doc,l.factor,options.monochrome!==false)).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}mm" height="${l.height}mm" viewBox="0 0 ${l.width} ${l.height}"><rect width="100%" height="100%" fill="white"/><rect x="${l.margin}" y="${l.margin}" width="${l.width-2*l.margin}" height="${l.height-2*l.margin}" fill="none" stroke="black" stroke-width="0.25"/><g data-drawing-scale="${l.factor}" transform="translate(${l.x} ${l.y}) scale(${l.factor} ${-l.factor})">${content}</g><g font-family="Liberation Sans,Arial,sans-serif" font-size="3" fill="black"><path d="M${l.margin} ${l.height-l.margin-25}H${l.width-l.margin}" stroke="black" stroke-width="0.25"/><text x="${l.margin+3}" y="${l.height-l.margin-18}">${escapeXml(title)}</text><text x="${l.margin+3}" y="${l.height-l.margin-11}">Autor: ${escapeXml(author)} · Revisão: ${escapeXml(revision)}</text><text x="${l.margin+3}" y="${l.height-l.margin-4}">Escala 1:${n(l.denominator)} · ${escapeXml(doc.units)} · Traço</text></g></svg>`;
}
export async function openPrintDialog(editor){
 await loadCadFonts();
 const dialog=document.createElement('dialog');dialog.className='cad-print-dialog';
 dialog.innerHTML=`<form method="dialog"><h3>Impressão técnica / PDF</h3><label>Papel <select name="paper"><option>A4</option><option>A3</option></select></label> <label><input name="landscape" type="checkbox" checked>Paisagem</label><label>Escala 1:<input name="denominator" type="number" min="0.01" step="any" value="1"></label><label><input name="fit" type="checkbox">Ajustar à folha (escala indicada no carimbo)</label><label><input name="monochrome" type="checkbox" checked>Preto e branco</label><label>Título <input name="title"></label><label>Autor <input name="author"></label><label>Revisão <input name="revision"></label><p>Na impressão, use tamanho real / 100%, sem cabeçalhos nem margens adicionais. Para PDF, escolha Salvar como PDF.</p><p data-print-error role="alert"></p><div data-print-preview></div><button type="button" data-preview>Atualizar prévia</button><button type="button" data-print>Imprimir / PDF</button><button value="cancel">Fechar</button></form>`;
 dialog.querySelector('[name=title]').value=editor.doc.name;
 const options=()=>Object.fromEntries([...dialog.querySelectorAll('[name]')].map(x=>[x.name,x.type==='checkbox'?x.checked:x.type==='number'?Number(x.value):x.value]));
 const preview=()=>{try{const svg=printSvg(editor.doc,options());dialog.querySelector('[data-print-preview]').innerHTML=svg;dialog.querySelector('[data-print-error]').textContent='';return svg;}catch(err){dialog.querySelector('[data-print-error]').textContent=err.message;return null;}};
 dialog.querySelector('[data-preview]').onclick=preview;
 dialog.querySelector('[data-print]').onclick=()=>{
  const svg=preview();if(!svg)return;const l=printLayout(editor.doc,options());const w=window.open('','_blank');if(!w){dialog.querySelector('[data-print-error]').textContent='Permita a abertura da janela de impressão.';return;}
  const fontBase=new URL('/fonts/liberation/',location.origin).href;
  let css='';for(const [family,slug] of [['Liberation Sans','LiberationSans'],['Liberation Serif','LiberationSerif'],['Liberation Mono','LiberationMono']])for(const [suffix,weight,style]of [['Regular',400,'normal'],['Bold',700,'normal'],['Italic',400,'italic'],['BoldItalic',700,'italic']])css+=`@font-face{font-family:"${family}";src:url("${fontBase}${slug}-${suffix}.ttf");font-weight:${weight};font-style:${style}}`;
  w.document.write(`<!doctype html><html><head><title>Traço — impressão</title><style>${css}@page{size:${l.width}mm ${l.height}mm;margin:0}html,body{margin:0;padding:0}svg{display:block}@media print{button,p{display:none}}</style></head><body><button onclick="window.print()">Imprimir / salvar PDF</button><p>Imprimir em 100%, sem cabeçalhos e rodapés.</p>${svg}</body></html>`);w.document.close();
 };
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();preview();
}
