export const FONT_FAMILIES=['Liberation Sans','Arial','Liberation Serif','Times New Roman','Liberation Mono','Courier New','Verdana','Georgia','Trebuchet MS'];
export function fontFamily(family='Liberation Sans'){
 const safe=FONT_FAMILIES.includes(family)?family:'Liberation Sans';
 const fallback=['Times New Roman','Georgia','Liberation Serif'].includes(safe)?'Liberation Serif':['Courier New','Liberation Mono'].includes(safe)?'Liberation Mono':'Liberation Sans';
 return `"${safe}", "${fallback}", sans-serif`;
}
export function canvasFont(entity,size){return `${entity.italic?'italic ':''}${entity.bold?'bold ':''}${size}px ${fontFamily(entity.fontFamily)}`;}
let measuringContext;
export function textWidth(entity){
 if(!measuringContext && typeof document!=='undefined')measuringContext=document.createElement('canvas').getContext('2d');
 const lines=String(entity.text??'').split('\n');
 if(measuringContext){measuringContext.font=canvasFont(entity,100);return Math.max(0,...lines.map(t=>measuringContext.measureText(t).width))*entity.height/100;}
 return Math.max(0,...lines.map(t=>t.length))*entity.height*0.7;
}
export async function loadCadFonts(){
 if(typeof document==='undefined'||!document.fonts)return;
 await Promise.all(['Liberation Sans','Liberation Serif','Liberation Mono'].flatMap(f=>['','bold ','italic ','bold italic '].map(w=>document.fonts.load(`${w}16px "${f}"`))));
}
