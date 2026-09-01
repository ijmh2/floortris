import { DEFAULT_RULES, fromVariant } from './data.ts';
import { makeCustomFurniture } from './custom-furniture.ts';
import { radiatorOnWall } from './room-inputs.ts';
import type { AppState, Furniture, FloorPlan, RoomProfile, SectionalGeometry } from './model.ts';

export type BenchmarkDefinition = { id: string; label: string; challenge: string; suggestedPrompt: string; makeInitial: () => AppState };

const entrance = (wall: 'north'|'east'|'south'|'west' = 'south', offsetCm = 20, segmentId?: string) => ({ id: 'entrance', kind: 'door' as const, wall, ...(segmentId ? { segmentId } : {}), offsetCm, widthCm: 80, hinge: 'start' as const, swing: 'in' as const, angle: 90 as const, mechanism: 'hinged' as const, entrance: true });
const base = (id: string, name: string, widthCm: number, depthCm: number, profile: RoomProfile, floorPlan?: FloorPlan): AppState => ({
  version: 2, documentId: `benchmark-${id}`, currentRevision: 1, ruleRevision: 1, sequence: 1,
  room: { name, widthCm, depthCm, ...(floorPlan ? { floorPlan } : {}), profile, openings: [entrance()], fixtures: [] },
  rules: { ...structuredClone(DEFAULT_RULES), requiredKinds: profile.kind === 'lounge' ? ['sofa','tv'] : profile.kind === 'bedroom' ? ['bed'] : profile.kind === 'home_office' ? ['desk','chair'] : [] },
  inventory: [], current: { furniture: [], appearance: { wall: 'warm', floor: 'oak' } }, proposal: null,
});
const draft = (state: AppState, furniture: Furniture[]) => {
  state.proposal = { id: `${state.documentId}-proposal`, kind: 'layout', revision: 1, baseCurrentRevision: 1, baseRuleRevision: 1, room: structuredClone(state.room), rules: structuredClone(state.rules), layout: { furniture, appearance: structuredClone(state.current.appearance) }, omitted: [] };
  return state;
};

const lShape = () => {
  const floorPlan: FloorPlan = { kind: 'rectilinear', points: [{xCm:0,yCm:0},{xCm:600,yCm:0},{xCm:600,yCm:360},{xCm:400,yCm:360},{xCm:400,yCm:560},{xCm:0,yCm:560}] };
  const state = base('l-shape','Benchmark · L-shaped lounge',600,560,{kind:'lounge'},floorPlan);
  state.room.openings = [entrance('south',20,'wall-5'),{id:'window-main',kind:'window',wall:'north',segmentId:'wall-1',offsetCm:180,widthCm:180,sillCm:90,headCm:215,type:'fixed',windowAccess:false}];
  const sofa=fromVariant('arc-sofa-200','l-sofa');sofa.originCell={x:2,y:2};sofa.rotation=0;
  return draft(state,[sofa]);
};
const uSectional = () => {
  const state=base('u-sectional','Benchmark · measured U-sectional',800,700,{kind:'lounge'}); state.rules.requiredKinds=[];
  const geometry:SectionalGeometry={type:'sectional',primaryFacing:'south',modules:[
    {id:'left-return',type:'chaise',xCm:0,yCm:0,widthCm:80,depthCm:240,heightCm:85,facing:'east'},
    {id:'centre',type:'seat',xCm:80,yCm:0,widthCm:240,depthCm:80,heightCm:85,facing:'south'},
    {id:'right-return',type:'chaise',xCm:320,yCm:0,widthCm:80,depthCm:240,heightCm:85,facing:'west'},
  ]};
  const sofa=makeCustomFurniture({label:'Measured U-sectional',kind:'sofa',widthCm:400,depthCm:240,heightCm:85,positionCm:{xCm:200,yCm:40},rotation:0,appearance:'moss',geometry},'benchmark-u');
  return draft(state,[sofa]);
};
const tvDoorTrap = () => {
  const state=base('tv-door-trap','Benchmark · TV behind door',420,420,{kind:'lounge'});
  const sofa=fromVariant('arc-sofa-200','trap-sofa');sofa.originCell={x:5,y:1};sofa.rotation=0;
  const tv=fromVariant('frame-tv-120','trap-tv');tv.wallAnchor={wall:'south',offsetCm:20};tv.targetSofaId=sofa.id;
  return draft(state,[sofa,tv]);
};
const narrowBedroom = () => {
  const state=base('narrow-bedroom','Benchmark · narrow student bedroom',260,480,{kind:'bedroom',sleeping:'single',workspace:true,storage:true,bedsideQuantity:1}); state.rules.requiredKinds=['bed','desk','chair','storage'];
  state.room.openings.push({id:'window-north',kind:'window',wall:'north',offsetCm:60,widthCm:120,sillCm:95,headCm:215,type:'fixed',windowAccess:false});
  const bed=fromVariant('haven-single-100','narrow-bed');bed.originCell={x:0,y:0};
  return draft(state,[bed]);
};
const accessibleStudio = () => {
  const state=base('accessible-studio','Benchmark · accessible studio',620,540,{kind:'bedroom',sleeping:'single',workspace:true,storage:true,bedsideQuantity:0}); state.rules.requiredKinds=['bed','desk','chair','storage'];
  state.room.openings=[{...entrance('south',240),widthCm:100}];
  const bed=fromVariant('haven-single-100','accessible-bed');bed.originCell={x:2,y:1};
  return draft(state,[bed]);
};
const windowRadiator = () => {
  const state=base('window-radiator','Benchmark · window and radiator conflict',500,420,{kind:'lounge'});
  state.room.openings.push({id:'window-north',kind:'window',wall:'north',offsetCm:150,widthCm:200,sillCm:70,headCm:215,type:'side_hinge',windowAccess:true});
  const fixture: Furniture={id:'radiator-window',label:'Radiator under opening',kind:'radiator',ownership:'fixed',sizeCm:{w:140,d:20,h:60},originCell:{x:0,y:0},rotation:0,elevationCm:0,locked:{position:true,size:true,rotation:true},appearance:'oat',requiredInRoom:true,tags:[],wallAnchor:{wall:'north',offsetCm:180}};
  state.room.fixtures=[radiatorOnWall(fixture,state.room,'north',180,140,20,60)];
  const sofa=fromVariant('arc-sofa-200','radiator-sofa');sofa.originCell={x:7,y:5};sofa.rotation=0;
  return draft(state,[sofa]);
};
const awkwardNook = () => {
  const floorPlan: FloorPlan={kind:'rectilinear',points:[{xCm:0,yCm:0},{xCm:520,yCm:0},{xCm:520,yCm:460},{xCm:300,yCm:460},{xCm:300,yCm:360},{xCm:180,yCm:360},{xCm:180,yCm:520},{xCm:0,yCm:520}]};
  const state=base('awkward-nook','Benchmark · awkward nook',520,520,{kind:'home_office',seating:true,storage:true},floorPlan);state.room.openings=[entrance('south',20,'wall-7')];
  return draft(state,[]);
};

export const BENCHMARKS: BenchmarkDefinition[] = [
  {id:'benchmark-l-shape',label:'Benchmark · L-shape',challenge:'Custom rectilinear boundary and return walls.',suggestedPrompt:'Furnish this L-shaped lounge while keeping the return and entrance route clear. Compare open-floor, social and TV-focused options.',makeInitial:lShape},
  {id:'benchmark-u-sectional',label:'Benchmark · U-sectional',challenge:'One connected measured custom sofa with a genuine U footprint.',suggestedPrompt:'Review the measured U-sectional, then add a coffee table and TV without filling its internal conversation space.',makeInitial:uSectional},
  {id:'benchmark-tv-door',label:'Benchmark · TV/door trap',challenge:'A wall TV intersects the open entrance leaf.',suggestedPrompt:'Repair the TV-behind-door proposal. Keep the sofa association and find a checked wall placement before reporting the result.',makeInitial:tvDoorTrap},
  {id:'benchmark-narrow-bedroom',label:'Benchmark · narrow bedroom',challenge:'Single bed, work setup and storage in a 2.6 m room.',suggestedPrompt:'Complete this narrow student bedroom with a linked desk chair and wardrobe. Report anything the bounded planner cannot fit.',makeInitial:narrowBedroom},
  {id:'benchmark-accessible-studio',label:'Benchmark · accessible studio',challenge:'Generous entrance and an accessibility planning brief.',suggestedPrompt:'Complete this studio using the accessibility planning pack. Preserve a turning area and report every advisory assumption.',makeInitial:accessibleStudio},
  {id:'benchmark-window-radiator',label:'Benchmark · window/radiator',challenge:'Opening access competes with a radiator keep-out.',suggestedPrompt:'Plan the lounge without blocking the operable window or radiator keep-out. Add a window treatment only if its projection stays clear.',makeInitial:windowRadiator},
  {id:'benchmark-awkward-nook',label:'Benchmark · awkward nook',challenge:'A stepped outline creates a small usable nook.',suggestedPrompt:'Turn the nook into useful office storage without treating the missing floor as available. Complete the desk-chair brief.',makeInitial:awkwardNook},
];
export const benchmarkById=(id:string)=>BENCHMARKS.find(item=>item.id===id);
