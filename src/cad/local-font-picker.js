import { useLocalFont } from './fonts.js';

export function attachLocalFontPicker(select) {
 const panel=document.createElement('span');
 panel.className='cad-local-font-picker';
 const input=document.createElement('input');
 input.type='text'; input.placeholder='Fonte instalada (ex.: TC_LaserSans)';
 input.setAttribute('aria-label','Nome da fonte instalada'); input.maxLength=160;
 const button=document.createElement('button');
 button.type='button'; button.textContent='Usar fonte local';
 const status=document.createElement('span');
 status.setAttribute('role','status');
 panel.append(input,button,status); select.after(panel);
 const apply=async()=>{
  button.disabled=true;status.textContent='Verificando fonte…';
  try{
   const name=await useLocalFont(input.value);
   if(!panel.isConnected)return;
   if(!Array.from(select.options).some(o=>o.value===name)){
    const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);
   }
   select.value=name;select.dispatchEvent(new Event('change',{bubbles:true}));
   status.textContent='Fonte local selecionada.';
  }catch(error){if(panel.isConnected)status.textContent=error.message;}
  finally{button.disabled=false;}
 };
 button.addEventListener('click',event=>{event.stopPropagation();apply();});
 input.addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();event.stopPropagation();apply();}
 });
 return panel;
}
