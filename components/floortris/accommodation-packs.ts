import { DEFAULT_RULES, fromVariant } from './data.ts';
import type { AccommodationContext, AppState, Furniture, Room } from './model.ts';

export type AccommodationPack = { id:string; providerName:string; buildingName:string; roomLabel:string; summary:string; makeInitial:()=>AppState };
const locked=(item:Furniture)=>{item.locked={position:true,rotation:true,size:true,appearance:true};return item;};
const context=(packId:string,providerId:string,buildingId:string,roomId:string,approvedVariantIds:string[],fixedFurnitureIds:string[],restrictions:string[]):AccommodationContext=>({packId,providerId,buildingId,roomId,approvedVariantIds,fixedFurnitureIds,restrictions});
const state=(documentId:string,room:Room,furniture:Furniture[],requiredKinds:AppState['rules']['requiredKinds']):AppState=>({version:2,documentId,currentRevision:1,ruleRevision:1,sequence:0,proposal:null,room,rules:{...structuredClone(DEFAULT_RULES),requiredKinds},inventory:[],current:{furniture,appearance:{wall:'warm',floor:'oak'}}});

function alderA204(){
  const bed=locked(fromVariant('haven-single-100','provider-bed')),desk=locked(fromVariant('line-desk-100','provider-desk'));
  bed.originCell={x:1,y:1};desk.originCell={x:10,y:0};desk.rotation=90;
  const approved=['haven-single-100','line-desk-100','nest-chair-60','tallline-wardrobe-100','nook-bedside-40','line-blind-160','halo-flush-35'];
  const room:Room={name:'Alder Hall · A-204',widthCm:320,depthCm:460,profile:{kind:'bedroom',sleeping:'single',workspace:true,storage:true,bedsideQuantity:1},openings:[
    {id:'entrance',kind:'door',wall:'south',offsetCm:20,widthCm:90,hinge:'start',swing:'in',angle:90,mechanism:'hinged',entrance:true},
    {id:'window-north',kind:'window',wall:'north',offsetCm:80,widthCm:160,sillCm:95,headCm:215,type:'fixed',windowAccess:false},
  ],fixtures:[],openingLocks:['entrance','window-north'],measurementContext:{records:[{target:'room shell and openings',source:'provider',confidence:1,note:'Alder Hall type A survey drawing'},{target:'provider bed and desk',source:'provider',confidence:1}],assumptions:[]},accommodation:context('northbridge-alder-a204','northbridge-university','alder-hall','A-204',approved,[bed.id,desk.id],['Provider bed and desk positions are fixed.','Only the measured approved inventory may be proposed.','Do not obscure the window or alter fixed finishes.'])};
  return state('pack-northbridge-alder-a204',room,[bed,desk],['bed','desk','chair','storage']);
}
function mapleS12(){
  const bed=locked(fromVariant('haven-single-100','provider-accessible-bed'));bed.originCell={x:1,y:1};
  const approved=['haven-single-100','line-desk-100','nest-chair-60','folio-drawers-90','nook-bedside-40','line-blind-160','halo-flush-35'];
  const room:Room={name:'Maple House · S-12',widthCm:620,depthCm:540,profile:{kind:'bedroom',sleeping:'single',workspace:true,storage:true,bedsideQuantity:0},openings:[
    {id:'entrance',kind:'door',wall:'south',offsetCm:250,widthCm:100,hinge:'start',swing:'in',angle:90,mechanism:'hinged',entrance:true},
    {id:'window-north',kind:'window',wall:'north',offsetCm:210,widthCm:200,sillCm:80,headCm:215,type:'fixed',windowAccess:true},
  ],fixtures:[],openingLocks:['entrance','window-north'],measurementContext:{records:[{target:'room shell, openings and provider bed',source:'provider',confidence:1}],assumptions:['Accessibility pack is planning assistance; confirm individual requirements and applicable standards.']},accommodation:context('civic-maple-s12','civic-living','maple-house','S-12',approved,[bed.id],['Keep the provider bed locked.','Maintain the configured advisory turning and transfer spaces.','Only approved measured products may be proposed.'])};
  const result=state('pack-civic-maple-s12',room,[bed],['bed','desk','chair','storage']);
  result.rules.accessibility={id:'wheelchair-planning-150',enabled:true,turningCircleCm:150,routeWidthCm:90,doorApproachDepthCm:120,bedTransferCm:90,deskApproachCm:90,reachableStorageMaxCm:140,maxProjectionCm:10};
  return result;
}

export const ACCOMMODATION_PACKS:AccommodationPack[]=[
  {id:'pack-northbridge-alder-a204',providerName:'Northbridge University',buildingName:'Alder Hall',roomLabel:'A-204',summary:'Standard single room with fixed provider bed and desk.',makeInitial:alderA204},
  {id:'pack-civic-maple-s12',providerName:'Civic Living',buildingName:'Maple House',roomLabel:'S-12',summary:'Accessible studio planning template with a locked provider bed.',makeInitial:mapleS12},
];
export const accommodationPackById=(id:string)=>ACCOMMODATION_PACKS.find(pack=>pack.id===id);
