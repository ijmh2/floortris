import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bounds } from './engine.ts';
import { PALETTES } from './data.ts';
import type { Furniture, Layout, Room, Rules, Wall } from './model.ts';

// Metres in the renderer, centimetres in the document. +X east, +Z south, +Y up.
export function furniturePose(item: Furniture, room: Room, cellCm = 20) {
  if (item.kind === 'tv' && item.wallAnchor) {
    const { wall, offsetCm } = item.wallAnchor;
    const u = (offsetCm + item.sizeCm.w / 2) / 100;
    const inset = item.sizeCm.d / 200;
    return { x: wall === 'north' || wall === 'south' ? u : wall === 'west' ? inset : room.widthCm / 100 - inset,
      z: wall === 'west' || wall === 'east' ? u : wall === 'north' ? inset : room.depthCm / 100 - inset,
      y: item.elevationCm / 100, angle: { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }[wall] };
  }
  const b = bounds(item, cellCm);
  return { x: (b.x + b.w / 2) / 100, z: (b.y + b.d / 2) / 100, y: item.elevationCm / 100, angle: -item.rotation * Math.PI / 180 };
}
export function wallPoint(room: Room, wall: Wall, u: number, inward = 0): [number, number] {
  return wall === 'north' ? [u, inward] : wall === 'south' ? [u, room.depthCm / 100 - inward] : wall === 'west' ? [inward, u] : [room.widthCm / 100 - inward, u];
}
export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
      geometries.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m));
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
const colorFor = (id: string, target: keyof typeof PALETTES = 'furniture') => PALETTES[target].find(p => p.id === id)?.color || '#b5b0a5';
const material = (color: string, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness });
function box(parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], mat: THREE.Material, radius = 0) {
  const safe = size.map(n => Math.max(.001, n)) as [number, number, number];
  const geometry = radius ? new RoundedBoxGeometry(...safe, 3, Math.min(radius, ...safe.map(n => n / 3))) : new THREE.BoxGeometry(...safe);
  const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(parent: THREE.Object3D, radiusTop: number, radiusBottom: number, height: number, at: [number, number, number], mat: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 20), mat); mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function buildFurniture(item: Furniture, room: Room, cellCm = 20): THREE.Group {
  const g = new THREE.Group(), pose = furniturePose(item, room, cellCm);
  g.name = item.id; g.userData.objectId = item.id; g.userData.heightUnknown = item.sizeCm.h === null;
  g.position.set(pose.x, pose.y, pose.z); g.rotation.y = pose.angle;
  const w = item.sizeCm.w / 100, d = item.sizeCm.d / 100, h = (item.sizeCm.h ?? 100) / 100;
  const body = material(colorFor(item.appearance)), wood = material('#ad8c63'), dark = material('#3e4844'), cream = material('#ece3d3');
  // All ornament stays inside the measured envelope. Unknown heights use a disclosed placeholder.
  const legs = (height: number, radius = .025) => { radius=Math.min(radius,w/5,d/5); for (const x of [-1, 1]) for (const z of [-1, 1]) cylinder(g, radius, radius * .75, height, [x * (w / 2 - radius * 2), height / 2, z * (d / 2 - radius * 2)], wood); };
  if (item.sizeCm.h === null) {
    body.transparent = true; body.opacity = .35;
    box(g, [w, h, d], [0, h / 2, 0], body);
    const source = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(source), new THREE.LineBasicMaterial({color:'#a96831'})); source.dispose(); edges.position.y = h / 2; g.add(edges);
  } else if (item.kind === 'sofa') {
    legs(h * .14, .035);
    box(g, [w, h * .32, d], [0, h * .30, 0], body, .07);
    box(g, [w * .94, h * .65, d * .19], [0, h * .675, -d * .395], body, .06);
    for (const x of [-1, 1]) box(g, [w * .065, h * .52, d * .91], [x * w * .4675, h * .52, d * .025], body, .04);
    const seats = Math.max(2, Math.round(w / .7));
    for (let i = 0; i < seats; i++) {
      const x = -w * .42 + w * .84 / seats * (i + .5);
      box(g, [w * .84 / seats - .014, h * .16, d * .68], [x, h * .48, d * .10], body, .045);
      box(g, [w * .84 / seats - .02, h * .39, d * .16], [x, h * .75, -d * .26], body, .045);
    }
    box(g, [w * .15, h * .32, d * .18], [-w * .29, h * .70, -d * .10], cream, .04);
  } else if (item.kind === 'chair') {
    legs(h * .46);
    box(g, [w, h * .17, d * .91], [0, h * .49, d * .04], body, .055);
    box(g, [w, h * .46, d * .18], [0, h * .77, -d * .41], body, .055);
  } else if (item.kind === 'desk' || item.kind === 'table' || item.kind === 'coffee_table') {
    const top = Math.min(.07, h * .12); legs(h - top, item.kind === 'coffee_table' ? .035 : .025);
    box(g, [w, top, d], [0, h - top / 2, 0], body, item.kind === 'coffee_table' ? .10 : .025);
    // Inset surface accents avoid inventing additional measured height.
    box(g, [w * .24, .002, d * .32], [-w * .23, h - .001, -d * .08], cream);
    box(g, [w * .23, .002, d * .31], [-w * .20, h, -d * .045], material('#738474'));
  } else if (item.kind === 'storage') {
    box(g, [w, h, d], [0, h / 2, 0], body, .018);
    for (const x of [-1,1]) {
      box(g, [w * .477, h * .86, .012], [x * w * .246, h * .51, d / 2 - .008], body, .005);
      box(g, [.012, h * .09, .018], [x * w * .075, h * .60, d / 2 - .009], dark, .003);
    }
  } else if (item.kind === 'tv') {
    box(g, [w, h, d], [0, h / 2, 0], dark, .012);
    const screen = new THREE.MeshStandardMaterial({ color:'#405653', roughness:.22, metalness:.15, emissive:'#243b3a', emissiveIntensity:.2 });
    box(g, [w * .96, h * .93, .003], [0, h / 2, d / 2 - .001], screen, .005);
    box(g, [w * .32, h * .002, .002], [w * .15, h * .18, d / 2 + .001], material('#a8b29a'));
  } else if (item.kind === 'rug') {
    const rug = box(g, [w, h, d], [0, h / 2 + .001, 0], body, .035); rug.castShadow = false;
    const seam = material('#bbae96');
    for (let z = -d / 2 + .035; z < d / 2; z += .035) { const stitch = box(g, [w * .96, .001, .003], [0, h + .002, z], seam); stitch.castShadow = false; }
  } else if (item.kind === 'radiator') {
    box(g, [w * .75, h, d], [0, h / 2, 0], cream, .01);
    for (let z = -d / 2 + .035; z < d / 2; z += .07) box(g, [w, h * .91, .035], [0, h * .51, z], body, .01);
  } else if (item.kind === 'plant') {
    const potH = h * .29; cylinder(g, Math.min(w,d) * .37, Math.min(w,d) * .27, potH, [0,potH / 2,0], material('#c39179'));
    cylinder(g,.012,.014,h * .65,[0,h * .60,0],wood);
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4, leaf = new THREE.Mesh(new THREE.SphereGeometry(1,12,8),body);
      leaf.scale.set(w * .18,h * .12,d * .09); leaf.position.set(Math.cos(a) * w * .24,h * (.45+i*.062),Math.sin(a) * d * .24); leaf.rotation.z = Math.cos(a) * .5; leaf.castShadow = true; g.add(leaf);
    }
  } else {
    box(g,[w,h,d],[0,h / 2,0],body,.025);
  }
  // Materials not used by this kind must not linger across scene rebuilds.
  const used = new Set<THREE.Material>(); g.traverse(o=>{if(o instanceof THREE.Mesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>used.add(m));});
  [body,wood,dark,cream].filter(m=>!used.has(m)).forEach(m=>m.dispose());
  return g;
}

export type RoomScene = { root: THREE.Group; walls: Map<Wall, THREE.Group>; pieces: Map<string, THREE.Group> };
export function buildRoomScene(room: Room, layout: Layout, rules: Rules): RoomScene {
  const root = new THREE.Group(), walls = new Map<Wall, THREE.Group>(), pieces = new Map<string, THREE.Group>();
  const w = room.widthCm / 100, d = room.depthCm / 100, h = rules.ceilingCm / 100;
  const floor = material(colorFor(layout.appearance.floor,'floor')), wallMat = material(colorFor(layout.appearance.wall,'wall'));
  box(root,[w + .16,.14,d + .16],[w / 2,-.07,d / 2],material('#d2c7b4'),.03);
  box(root,[w,.018,d],[w / 2,-.009,d / 2],floor);
  const seam = material('#c7b99f');
  for (let x = .18; x < w; x += .18) { const line = box(root,[.002,.001,d],[x,.001,d / 2],seam); line.castShadow=false; }
  for (let x = 0; x < w; x += .18) for (let z = (Math.round(x / .18) % 3) * .43 + .43; z < d; z += 1.29) { const line = box(root,[Math.min(.18,w-x),.001,.002],[x + Math.min(.18,w-x)/2,.001,z],seam); line.castShadow=false; }
  for (const wall of ['north','east','south','west'] as Wall[]) {
    const group = new THREE.Group(); group.name = `wall-${wall}`; walls.set(wall,group); root.add(group);
    const length = wall === 'north' || wall === 'south' ? w : d;
    const openings = room.openings.filter(o=>o.wall===wall);
    const cuts = [...new Set([0,length,...openings.flatMap(o=>[Math.max(0,Math.min(length,o.offsetCm/100)),Math.max(0,Math.min(length,(o.offsetCm+o.widthCm)/100))])])].sort((a,b)=>a-b);
    const slab = (a:number,b:number,bottom:number,top:number,mat=wallMat,thickness=.08,inset=-.04) => {
      if(b<=a||top<=bottom)return;
      const [x,z]=wallPoint(room,wall,(a+b)/2,inset),horizontal=wall==='north'||wall==='south';
      box(group,horizontal?[b-a,top-bottom,thickness]:[thickness,top-bottom,b-a],[x,(top+bottom)/2,z],mat);
    };
    for (let i=0;i<cuts.length-1;i++) {
      const a=cuts[i],b=cuts[i+1],mid=(a+b)/2;
      const ranges=openings.filter(o=>mid>=o.offsetCm/100&&mid<(o.offsetCm+o.widthCm)/100).map(o=>({bottom:o.kind==='window'?Math.max(0,o.sillCm/100):0,top:Math.min(h,o.kind==='window'?o.headCm/100:2.1)})).sort((a,b)=>a.bottom-b.bottom);
      let bottom=0;for(const range of ranges){slab(a,b,bottom,range.bottom);bottom=Math.max(bottom,range.top);}slab(a,b,bottom,h);
      if(!ranges.some(r=>r.bottom===0))slab(a,b,0,.07,material('#f2ece0'),.015,.008);
    }
    for (const opening of openings) {
      const a=opening.offsetCm/100,b=a+opening.widthCm/100;
      if(opening.kind==='window') {
        const bottom=opening.sillCm/100,top=opening.headCm/100;
        const frame=material('#f4f0e8'),glass=new THREE.MeshStandardMaterial({color:'#b8d2ce',transparent:true,opacity:.32,roughness:.2,depthWrite:false});
        slab(a,b,bottom,top,glass,.015,-.04);
        slab(a-.025,b+.025,bottom-.025,bottom+.025,frame,.12,-.02);slab(a-.025,b+.025,top-.025,top+.025,frame,.1,-.025);
        for(const u of [a,(a+b)/2,b])slab(u-.017,u+.017,bottom,top,frame,.085,-.04);
      } else if(opening.mechanism==='hinged') {
        const leaf=new THREE.Group(); leaf.name=`door-${opening.id}`;
        const hinge=a+(opening.hinge==='end'?opening.widthCm/100:0),width=opening.widthCm/100;
        const [x,z]=wallPoint(room,wall,hinge,opening.swing==='in'?width/2:-width/2);
        leaf.position.set(x,0,z);leaf.rotation.y=wall==='north'||wall==='south'?0:Math.PI/2;
        box(leaf,[.035,Math.min(h,2.1),width],[0,Math.min(h,2.1)/2,0],material('#cbbba1'),.01);
        // The opening height is visual-only; V1 has no measured door-height field.
        root.add(leaf);
      }
    }
  }
  for (const item of [...room.fixtures,...layout.furniture]) { const piece=buildFurniture(item,room,rules.cellCm);pieces.set(item.id,piece);root.add(piece); }
  return {root,walls,pieces};
}
export function updateCutaway(scene: RoomScene, camera: THREE.Camera, room: Room, enabled: boolean) {
  for (const [wall,group] of scene.walls) {
    const near = wall==='north'?camera.position.z<room.depthCm/200:wall==='south'?camera.position.z>room.depthCm/200:wall==='west'?camera.position.x<room.widthCm/200:camera.position.x>room.widthCm/200;
    group.visible = !enabled || !near;
  }
}
