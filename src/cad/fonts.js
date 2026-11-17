export const FONT_FAMILIES=['Liberation Sans','Arial','Liberation Serif','Times New Roman','Liberation Mono','Courier New','Verdana','Georgia','Trebuchet MS'];
export function fontFamily(family='Liberation Sans'){
 const safe=normalizeFontFamily(family)||'Liberation Sans';
 const fallback=['Times New Roman','Georgia','Liberation Serif'].includes(safe)?'Liberation Serif':['Courier New','Liberation Mono'].includes(safe)?'Liberation Mono':'Liberation Sans';
 return `${JSON.stringify(safe)}, ${JSON.stringify(fallback)}, sans-serif`;
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
 await loadLocalFonts();
}

const LOCAL_FONTS_KEY='traco:local-font-families';
export function normalizeFontFamily(value){
 if(typeof value!=='string')return '';
 const name=value.trim();
 return name.length>0&&name.length<=160&&!/[\u0000-\u001f\u007f]/.test(name)?name:'';
}
export function rememberFontFamily(value){
 const name=normalizeFontFamily(value);
 if(!name)throw new Error('Nome de fonte inválido.');
 if(!FONT_FAMILIES.includes(name))FONT_FAMILIES.push(name);
 measuredWidths.clear();
 return name;
}
// FontFace.load rejects unavailable local faces, unlike document.fonts.check(),
// which can report success for fallback fonts. No font bytes leave the machine.
export async function useLocalFont(value,{persist=true}={}){
 const name=normalizeFontFamily(value);
 if(!name)throw new Error('Informe o nome da família instalada no computador.');
 if(typeof FontFace!=='function')throw new Error('Este ambiente não permite validar fontes locais.');
 const probe=new FontFace('TracoLocalFontProbe',`local(${JSON.stringify(name)})`);
 try{await probe.load();}catch{throw new Error(`Fonte não encontrada: ${name}. Confira o nome no Catálogo de Fontes e reinicie o Traço após instalar.`);}
 rememberFontFamily(name);
 if(persist)try{
  const saved=JSON.parse(localStorage.getItem(LOCAL_FONTS_KEY)||'[]');
  const names=Array.isArray(saved)?saved.filter(n=>normalizeFontFamily(n)):[];
  localStorage.setItem(LOCAL_FONTS_KEY,JSON.stringify([...new Set([...names,name])].slice(-100)));
 }catch{}
 return name;
}
export async function loadLocalFonts(){
 let saved=[];
 try{const data=JSON.parse(localStorage.getItem(LOCAL_FONTS_KEY)||'[]');if(Array.isArray(data))saved=data.slice(0,100);}catch{}
 // Discover the requested laser family when it is already installed.
 await Promise.allSettled([...new Set(['TC_LaserSans',...saved])].map(name=>useLocalFont(name,{persist:false})));
}
