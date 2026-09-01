import type { AppState } from './model.ts';
import { readImportedRoom } from './persistence.ts';

export const SHARE_JSON_LIMIT=300_000;
export const SHARE_FRAGMENT_LIMIT=120_000;
const bytesToBase64Url=(bytes:Uint8Array)=>{
  let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
};
const base64UrlToBytes=(value:string)=>{
  if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length>SHARE_FRAGMENT_LIMIT)return null;
  const binary=atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'='));
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
};
async function streamBytes(bytes:Uint8Array,format:'gzip',compress:boolean){
  const constructor=compress?globalThis.CompressionStream:globalThis.DecompressionStream;
  if(!constructor)return null;
  const copy=Uint8Array.from(bytes),stream=new Blob([copy.buffer]).stream().pipeThrough(new constructor(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeShareFragment(state:AppState):Promise<{fragment:string|null;reason?:string;compressed:boolean}> {
  const json=JSON.stringify(state),source=new TextEncoder().encode(json);
  if(source.length>SHARE_JSON_LIMIT)return{fragment:null,reason:'This room is too large for a reliable URL. Use the JSON export instead.',compressed:false};
  const compressed=await streamBytes(source,'gzip',true);
  const payload=compressed&&compressed.length<source.length?`gz.${bytesToBase64Url(compressed)}`:`raw.${bytesToBase64Url(source)}`;
  if(payload.length>SHARE_FRAGMENT_LIMIT)return{fragment:null,reason:'The safe URL size limit was exceeded. Use the JSON export instead.',compressed:payload.startsWith('gz.')};
  return{fragment:`share=${payload}`,compressed:payload.startsWith('gz.')};
}

export async function decodeShareFragment(hash:string):Promise<AppState|null>{
  try{
    const raw=hash.replace(/^#/,'');if(!raw.startsWith('share=')||raw.length>SHARE_FRAGMENT_LIMIT+6)return null;
    const payload=raw.slice(6),separator=payload.indexOf('.');if(separator<1)return null;
    const mode=payload.slice(0,separator),bytes=base64UrlToBytes(payload.slice(separator+1));if(!bytes)return null;
    let decoded:Uint8Array|null=bytes;
    if(mode==='gz')decoded=await streamBytes(bytes,'gzip',false);else if(mode!=='raw')return null;
    if(!decoded||decoded.length>SHARE_JSON_LIMIT)return null;
    return readImportedRoom(new TextDecoder().decode(decoded));
  }catch{return null;}
}
