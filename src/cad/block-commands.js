import {addEntities,removeEntities,isEntityEditable} from './document.js';
import {defineBlock,createInsert,expandInsert} from './blocks.js';
import {geometryFields,setGeometryField} from './edit-tools.js';

const libraryKey=e=>`mvp-cad:blocks:${e.root.dataset.libraryScope??e.root.dataset.storageScope??e.root.dataset.workspaceScope??location.origin}`;
const readLibrary=e=>{try{return JSON.parse(localStorage.getItem(libraryKey(e))??'{}');}catch{return {};}};
async function namePrompt(e){e.log(Object.keys(e.doc.blocks??{}).join(', ')||'Nenhum bloco definido.');return e.getString('Nome do bloco');}
export const BLOCK_COMMANDS={
 BLOCK:{aliases:['B','BLOCO'],description:'Criar ou redefinir bloco persistente a partir da seleção',async run(e){
  const ids=await e.getSelection('Geometria do bloco');const entities=e.entitiesById(ids).filter(x=>isEntityEditable(e.doc,x));
  if(!entities.length)return;const base=(await e.getPoint('Ponto base')).point;const name=await e.getString('Nome do bloco (nome existente redefine todas as instâncias)');
  if(e.doc.blocks?.[name]){const yes=await e.getKeyword('Redefinir todas as instâncias?',[{key:'s',label:'Sim'},{key:'n',label:'Não'}],'n');if(yes?.key!=='s')return;}
  const doc=defineBlock(e.doc,name,entities,base);
  e.commit('Definir bloco',addEntities(removeEntities(doc,entities.map(x=>x.id)),[createInsert(name,doc.blocks[name],base,{layer:e.doc.currentLayer})]));e.clearSelection();
 }},
 INSERTBLOCK:{aliases:['IB','INSERIRBLOCO'],description:'Inserir instância de bloco por ponto, escala e rotação',async run(e){
  const name=await namePrompt(e),def=e.doc.blocks?.[name];if(!def)throw new Error('Bloco inexistente.');
  const scale=await e.getNumber('Escala uniforme',{defaultValue:1});const rotation=await e.getNumber('Rotação em graus',{defaultValue:0});
  const position=(await e.getPoint('Inserção',{preview:p=>[createInsert(name,def,p,{scale,rotation,layer:e.doc.currentLayer})]})).point;
  e.commit('Inserir bloco',addEntities(e.doc,[createInsert(name,def,position,{scale,rotation,layer:e.doc.currentLayer})]));
 }},
 BEDIT:{aliases:['EDITARBLOCO'],description:'Editar propriedade geométrica de definição; todas instâncias atualizadas',async run(e){
  const name=await namePrompt(e),def=e.doc.blocks?.[name];if(!def)throw new Error('Bloco inexistente.');
  e.log(def.entities.map((x,i)=>`${i+1}: ${x.type}`).join('; '));
  const index=(await e.getNumber('Número da entidade',{min:1,max:def.entities.length}))-1;
  if(!Number.isInteger(index)||!def.entities[index])throw new Error('Entidade inválida.');
  e.log(geometryFields(def.entities[index]).map(x=>`${x.key}=${x.value}`).join('; '));
  const key=await e.getString('Propriedade'),value=await e.getNumber('Novo valor');
  const entities=def.entities.map((x,i)=>i===index?setGeometryField(x,key,value):x);
  e.commit('Editar definição de bloco',defineBlock(e.doc,name,entities,def.basePoint));
 }},
 BLOCKSAVE:{aliases:['BIBSALVAR'],description:'Salvar definição na biblioteca local deste navegador',async run(e){
  const name=await namePrompt(e);if(!e.doc.blocks?.[name])throw new Error('Bloco inexistente.');
  const lib=readLibrary(e);lib[name]={definition:e.doc.blocks[name],units:e.doc.units,layers:e.doc.layers};
  localStorage.setItem(libraryKey(e),JSON.stringify(lib));e.log(`Bloco ${name} salvo na biblioteca local.`);
 }},
 BLOCKLOAD:{aliases:['BIBLIOTECA'],description:'Carregar bloco da biblioteca local no documento',async run(e){
  const lib=readLibrary(e);e.log(Object.keys(lib).join(', ')||'Biblioteca vazia.');const name=await e.getString('Nome do bloco');const item=lib[name];
  if(!item)throw new Error('Bloco inexistente na biblioteca.');if(item.units!==e.doc.units)throw new Error('Unidades diferentes; converta antes de importar.');
  if(e.doc.blocks?.[name])throw new Error('Já existe bloco com esse nome no desenho.');
  const layers=[...e.doc.layers];for(const l of item.layers??[])if(!layers.some(x=>x.name===l.name))layers.push(l);
  e.commit('Carregar biblioteca',defineBlock({...e.doc,layers},name,item.definition.entities,item.definition.basePoint));
 }},
};
