export const FONT_FAMILIES=['Liberation Sans','Arial','Liberation Serif','Times New Roman','Liberation Mono','Courier New','Verdana','Georgia','Trebuchet MS'];
export function fontFamily(family='Liberation Sans'){
 const safe=FONT_FAMILIES.includes(family)?family:'Liberation Sans';
 const fallback=['Times New Roman','Georgia','Liberation Serif'].includes(safe)?'Liberation Serif':['Courier New','Liberation Mono'].includes(safe)?'Liberation Mono':'Liberation Sans';
 return `"${safe}", "${fallback}", sans-serif`;
}
// Altura do texto CAD é a altura da maiúscula (AutoCAD/BricsCAD), não o corpo da fonte.
export const CAP_HEIGHT_RATIO=0.716;
export const LINE_SPACING=5/3;
export function fontEm(height){return height/CAP_HEIGHT_RATIO;}
export function canvasFont(entity,size){return `${entity.italic?'italic ':''}${entity.bold?'bold ':''}${size}px ${fontFamily(entity.fontFamily)}`;}
let measuringContext;
const measuredWidths=new Map();
// Largura real no mundo, a mesma que o canvas desenha; null quando não há canvas para medir (Node, worker).
export function measuredLineWidth(entity,line){
 if(measuringContext===undefined)measuringContext=typeof document==='undefined'?null:document.createElement?.('canvas')?.getContext?.('2d')??null;
 if(typeof measuringContext?.measureText!=='function')return null;
 const font=canvasFont(entity,100),key=`${font}\n${line}`;
 let width=measuredWidths.get(key);
 if(width===undefined){
  if(measuredWidths.size>=5000)measuredWidths.clear();
  measuringContext.font=font;width=measuringContext.measureText(line).width;measuredWidths.set(key,width);
 }
 return width*fontEm(entity.height)/100;
}
export function textWidth(entity){
 const lines=String(entity.text??'').split('\n');
 return Math.max(0,...lines.map(t=>measuredLineWidth(entity,t)??t.length*fontEm(entity.height)*0.556));
}
export async function loadCadFonts(){
 if(typeof document==='undefined'||!document.fonts)return;
 await Promise.all(['Liberation Sans','Liberation Serif','Liberation Mono'].flatMap(f=>['','bold ','italic ','bold italic '].map(w=>document.fonts.load(`${w}16px "${f}"`))));
 measuredWidths.clear();
}
