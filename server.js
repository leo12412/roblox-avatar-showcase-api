'use strict';
const http = require('node:http');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PAGES = 10;
const MAX_OUTFITS = 500;
const CACHE_MS = 120000;
const cache = new Map();
const ANIMATION_TYPES = new Set(['climbanimation','fallanimation','idleanimation','jumpanimation','runanimation','swimanimation','walkanimation','animation','emoteanimation','poseanimation']);
const HEAD_TYPES = new Set(['dynamichead','head','face','faceaccessory','eyebrowaccessory','eyelashaccessory']);
const FOOTWEAR_TYPES = new Set(['leftshoeaccessory','rightshoeaccessory']);
const CLOTHING_TYPES = new Set(['shirt','pants','tshirt','jacketaccessory','sweateraccessory','shortsaccessory','dressskirtaccessory','tshirtaccessory','shirtaccessory','pantsaccessory']);
const CLOTHING_IDS = new Set([2, 11, 12, 64, 65, 66, 67, 68, 69, 72]);
const STRICT_REQUIRE_CLOTHING = true; // Cambia a false para volver a criterios de V8.
const BODY_TYPES = new Set(['head','torso','leftarm','rightarm','leftleg','rightleg','dynamichead']);
const normalize = s => String(s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
function send(res, code, data) {
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
async function getJson(url) {
  const response = await fetch(url, {headers:{Accept:'application/json','User-Agent':'AvatarShowcaseLearningProject/1.0'},signal:AbortSignal.timeout(10000)});
  if (!response.ok) {
    const error = new Error(`Roblox HTTP ${response.status}`);
    error.code = response.status === 429 ? 503 : 502;
    throw error;
  }
  return response.json();
}
function typeFromEntry(entry) {
  const value = entry.outfitType ?? entry.OutfitType ?? entry.outfitTypeId;
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return ({2:'Avatar',3:'DynamicHead',4:'Shoes',5:'Makeup'})[value] || String(value);
  return String(value);
}
function getAssets(detail) {
  const raw = detail.assets ?? detail.Assets;
  if (!Array.isArray(raw)) return null; // null = metadatos no verificados
  return raw.map(asset => {
    const type = asset.assetType ?? asset.AssetType;
    const numeric = Number(type?.id ?? type?.Id ?? asset.assetTypeId ?? asset.AssetTypeId ?? (typeof type === 'number' ? type : NaN));
    const name = normalize(type?.name ?? type?.Name ?? asset.assetTypeName ?? (typeof type === 'string' ? type : ''));
    return {id:Number.isInteger(numeric) ? numeric : null, name};
  });
}
function classify(entry, detail) {
  const reportedType = typeFromEntry(entry);
  if (reportedType && normalize(reportedType) !== 'avatar') return {keep:false,reason:`Tipo ${reportedType}`,reportedType};
  const assets = getAssets(detail);
  if (assets === null) return {keep:true,reason:'Revisar: detalles sin lista de assets',reportedType};
  const names = assets.map(a=>a.name).filter(Boolean);
  const isClothing = a => CLOTHING_IDS.has(a.id) || CLOTHING_TYPES.has(a.name);
  if (assets.some(isClothing)) return {keep:true,reason:'Contiene ropa clasica o layered',reportedType};
  if (assets.length === 0) return {keep:false,reason:'No contiene articulos',reportedType};
  if (STRICT_REQUIRE_CLOTHING) return {keep:false,reason:'Sin prendas clasicas ni layered (no cuentan zapatos)',reportedType};
  if (names.length && names.every(t=>ANIMATION_TYPES.has(t))) return {keep:false,reason:'Solo animaciones',reportedType};
  if (names.length && names.every(t=>HEAD_TYPES.has(t))) return {keep:false,reason:'Solo cabeza o rostro',reportedType};
  if (names.length && names.every(t=>FOOTWEAR_TYPES.has(t))) return {keep:false,reason:'Solo zapatos',reportedType};
  return {keep:true,reason:'Sin ropa: permitido por configuracion',reportedType};
}
async function listRaw(userId) {
  let page = 1, pages = 1, complete = true;
  const found = [], seen = new Set();
  do {
    const url = new URL(`https://avatar.roblox.com/v2/avatar/users/${userId}/outfits`);
    url.searchParams.set('outfitType','Avatar');
    url.searchParams.set('page',String(page));
    url.searchParams.set('itemsPerPage','50');
    const json = await getJson(url);
    if (!Array.isArray(json.data)) throw Object.assign(new Error('Roblox devolvio un formato inesperado'), {code:502});
    for (const item of json.data) {
      const id = Number(item.id);
      if (Number.isSafeInteger(id) && id>0 && !seen.has(id)) {
        seen.add(id);found.push({id,name:String(item.name||`Outfit ${id}`).slice(0,100),raw:item});
      }
      if(found.length>=MAX_OUTFITS) break;
    }
    pages = Number(json.totalPages);
    if(!Number.isInteger(pages)||pages<1) pages=1;
    page++;
  } while(page<=Math.min(pages,MAX_PAGES)&&found.length<MAX_OUTFITS);
  if(page<=pages || found.length>=MAX_OUTFITS) complete=false;
  return {found,complete};
}
async function outfitsFor(userId) {
  const cached=cache.get(userId);
  if(cached&&cached.expires>Date.now())return cached.data;
  const {found,complete}=await listRaw(userId);
  let index=0;
  const results=new Array(found.length);
  async function worker() {
    while(index<found.length) {
      const i=index++;
      const entry=found[i];
      try {
        const detail=await getJson(`https://avatar.roblox.com/v3/outfits/${entry.id}/details`);
        const decision=classify(entry.raw,detail);
        results[i]={entry, decision, inspected:true};
      } catch(error) {
        // Fallos transitorios no deben borrar arbitrariamente atuendos válidos.
        results[i]={entry,decision:{keep:true,reason:'Revisar: no se pudo verificar el detalle',reportedType:typeFromEntry(entry.raw)},inspected:false};
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,found.length)},()=>worker()));
  const outfits=[], excluded=[], review=[];
  for(const r of results) {
    if(!r)continue;
    const {entry,decision}=r;
    if(!decision.keep) {excluded.push({id:entry.id,name:entry.name,reason:decision.reason});continue;}
    outfits.push({id:entry.id,name:entry.name,outfitType:'Avatar'});
    if(decision.reason.startsWith('Revisar')||!r.inspected) review.push({id:entry.id,name:entry.name,reason:decision.reason});
  }
  const data={userId:Number(userId),count:outfits.length,outfits,complete,filterVersion:9,excludedCount:excluded.length,reviewCount:review.length,diagnostic:{excluded,review}};
  cache.set(userId,{expires:Date.now()+CACHE_MS,data});
  return data;
}
http.createServer(async(req,res)=>{
  if(req.method!=='GET')return send(res,405,{error:'Metodo no permitido'});
  let url;
  try{url=new URL(req.url,'http://localhost');}catch{return send(res,400,{error:'URL invalida'});}
  if(url.pathname==='/health')return send(res,200,{ok:true,service:'Avatar Showcase API',filterVersion:9});
  const match=url.pathname.match(/^\/api\/outfits\/([1-9][0-9]{0,15})$/);
  if(!match)return send(res,404,{error:'Ruta no encontrada'});
  const userId=Number(match[1]);
  if(!Number.isSafeInteger(userId))return send(res,400,{error:'UserId invalido'});
  try{
    const data=await outfitsFor(userId);
    if(url.searchParams.get('debug')==='1')return send(res,200,data);
    const {diagnostic,...publicData}=data;
    return send(res,200,publicData);
  }catch(error){console.error(error);return send(res,error.code||502,{error:error.message});}
}).listen(PORT,HOST,()=>console.log(`Avatar Showcase API V9: http://${HOST}:${PORT}`));
