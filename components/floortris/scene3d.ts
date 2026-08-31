import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bounds } from './sectional-engine.ts';
import { formFor, PALETTES } from './data.ts';
import { finishMaterial, mapFinishUV, type TextureOptions } from './finish-material.ts';
import type { Furniture, Layout, Room, Rules, Wall } from './model.ts';
import { floorPoints, wallPointCm, wallSegments } from './floorplan.ts';
import { isWallMounted } from './fixture-placement.ts';
import { moduleEdgeJoined } from './sectional.ts';
import { opposite, type SectionalModule } from './model.ts';

// Metres in the renderer, centimetres in the document. +X east, +Z south, +Y up.
export function furniturePose(item: Furniture, room: Room, cellCm = 20) {
  if (isWallMounted(item) && item.wallAnchor) {
    const { wall } = item.wallAnchor, point = wallPointCm(room, item.wallAnchor, item.sizeCm.w / 2, item.sizeCm.d / 2);
    if (point) return { x: point[0] / 100, z: point[1] / 100, y: item.elevationCm / 100, angle: { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }[wall] };
  }
  const b = bounds(item, cellCm);
  return { x: (b.x + b.w / 2) / 100, z: (b.y + b.d / 2) / 100, y: item.elevationCm / 100, angle: -item.rotation * Math.PI / 180 };
}
export function wallPoint(room: Room, wall: Wall, u: number, inward = 0, segmentId?: string): [number, number] {
  const point = wallPointCm(room, { wall, segmentId, offsetCm: 0 }, u * 100, inward * 100);
  return point ? [point[0] / 100, point[1] / 100] : [0, 0];
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
  if (item.ownership === 'custom') { g.userData.custom = true; g.userData.provenance = item.customProvenance?.source; g.userData.measuredEnvelopeCm = { ...item.sizeCm }; if (item.geometry) { g.userData.sectional = true; g.userData.accessibleLabel = `CUSTOM SECTIONAL ${item.label}, ${item.geometry.modules.length} measured modules`; g.userData.modules = structuredClone(item.geometry.modules); } }
  g.position.set(pose.x, pose.y, pose.z); g.rotation.y = pose.angle;
  const w = item.sizeCm.w / 100, d = item.sizeCm.d / 100, h = (item.sizeCm.h ?? 100) / 100;
  const body = material(colorFor(item.appearance)), wood = material('#ad8c63'), dark = material('#3e4844'), cream = material('#ece3d3');
  // Catalogue variants may name a visual form; owned and measured pieces have no
  // variantId, so they always fall back to the kind's own shape.
  const form = formFor(item.variantId);
  // All ornament stays inside the measured envelope. Unknown heights use a disclosed placeholder.
  const legs = (height: number, radius = .025) => { radius=Math.min(radius,w/5,d/5); for (const x of [-1, 1]) for (const z of [-1, 1]) cylinder(g, radius, radius * .75, height, [x * (w / 2 - radius * 2), height / 2, z * (d / 2 - radius * 2)], wood); };
  if (item.sizeCm.h === null) {
    body.transparent = true; body.opacity = .35;
    box(g, [w, h, d], [0, h / 2, 0], body);
    const source = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(source), new THREE.LineBasicMaterial({color:'#a96831'})); source.dispose(); edges.position.y = h / 2; g.add(edges);
  } else if (item.geometry?.type === 'sectional') {
    const edgeBox = (module: SectionalModule, edge: Wall, height: number, thickness: number, mat: THREE.Material) => {
      const mw=module.widthCm/100, md=module.depthCm/100, mx=-w/2+(module.xCm+module.widthCm/2)/100, mz=-d/2+(module.yCm+module.depthCm/2)/100;
      if(edge==='north'||edge==='south') box(g,[mw,height,Math.min(md,thickness)],[mx,height/2,mz+(edge==='north'?-1:1)*(md/2-Math.min(md,thickness)/2)],mat,.025);
      else box(g,[Math.min(mw,thickness),height,md],[mx+(edge==='west'?-1:1)*(mw/2-Math.min(mw,thickness)/2),height/2,mz],mat,.025);
    };
    const order:Wall[]=['north','east','south','west'];
    for(const section of item.geometry.modules){
      const mw=section.widthCm/100,md=section.depthCm/100,mh=section.heightCm/100,mx=-w/2+(section.xCm+section.widthCm/2)/100,mz=-d/2+(section.yCm+section.depthCm/2)/100,base=Math.min(mh*.32,.28);
      box(g,[mw,base,md],[mx,base/2,mz],body,.035);
      box(g,[mw*.88,Math.min(mh*.18,.15),md*.72],[mx,base+Math.min(mh*.09,.075),mz],cream,.035);
      const back=opposite[section.facing],sideA=order[(order.indexOf(section.facing)+1)%4],sideB=order[(order.indexOf(section.facing)+3)%4];
      if(!moduleEdgeJoined(item.geometry,section,back)) edgeBox(section,back,mh,Math.min(mw,md)*.16,body);
      if(!moduleEdgeJoined(item.geometry,section,sideA)) edgeBox(section,sideA,mh*.62,Math.min(mw,md)*.11,body);
      if(!moduleEdgeJoined(item.geometry,section,sideB)) edgeBox(section,sideB,mh*.62,Math.min(mw,md)*.11,body);
    }
  } else if (item.kind === 'window_treatment') {
    if (item.fixtureType === 'blind') {
      box(g, [w, h, Math.max(.006,d)], [0, h / 2, 0], cream, .006);
      for (let y=.025;y<h;y+=.07) box(g,[w*.98,.009,Math.max(.002,d*.72)],[0,y,d*.12],body,.003);
      box(g,[w,.035,Math.max(.003,d*.9)],[0,h-.0175,0],dark,.004);
    } else {
      const rail=.035; box(g,[w,rail,d*.45],[0,h-rail/2,-d*.18],dark,.008);
      const panelW=w*.49;
      for(const x of [-1,1]) {
        box(g,[panelW,h-rail,d],[x*w*.255,(h-rail)/2,0],body,.025);
        for(let fold=-panelW/2+.025;fold<panelW/2;fold+=.055) box(g,[.012,h-rail,d*.94],[x*w*.255+fold,(h-rail)/2,d*.03],cream,.006);
      }
    }
  } else if (item.kind === 'ceiling_light') {
    const glow=new THREE.MeshStandardMaterial({color:'#fff3bd',emissive:'#ffd98a',emissiveIntensity:.8,roughness:.45});
    if(item.fixtureType==='track') {
      box(g,[w,.045,d],[0,h-.025,0],dark,.008);
      for(const x of [-w*.36,0,w*.36]) { const spot=cylinder(g,Math.min(d*.22,.07),Math.min(d*.30,.10),Math.min(h*.72,.14),[x,h*.48,0],body);spot.rotation.z=x===0?0:(x<0?-.3:.3); cylinder(g,Math.min(d*.13,.045),Math.min(d*.13,.045),.012,[x,Math.max(.006,h*.18),0],glow); }
    } else if(item.fixtureType==='recessed') {
      cylinder(g,w*.48,w*.48,h,[0,h/2,0],dark); cylinder(g,w*.39,w*.39,.006,[0,.008,0],body); cylinder(g,w*.31,w*.31,.008,[0,.004,0],glow);
    } else if(item.fixtureType==='flush') {
      cylinder(g,w*.48,w*.42,h,[0,h/2,0],body); cylinder(g,w*.43,w*.43,.009,[0,h-.0045,0],dark); cylinder(g,w*.38,w*.38,.012,[0,.006,0],glow);
    } else {
      cylinder(g,.012,.012,h*.62,[0,h*.69,0],dark);
      cylinder(g,w*.12,w*.47,h*.38,[0,h*.19,0],body);
      cylinder(g,w*.32,w*.32,.012,[0,.006,0],glow);
    }
  } else if (item.kind === 'wall_light') {
    const glow=new THREE.MeshStandardMaterial({color:'#fff2bd',emissive:'#ffd98a',emissiveIntensity:.7,roughness:.5});
    box(g,[w*.55,h*.32,d*.3],[0,h*.5,-d*.35],dark,.025);
    cylinder(g,Math.min(w*.22,d*.22),Math.min(w*.38,d*.32),h*.68,[0,h*.48,-d*.08],body);
    box(g,[w*.62,h*.12,Math.min(.008,d*.12)],[0,h*.34,d/2-Math.min(.004,d*.06)],glow,.02);
  } else if (item.kind === 'floor_lamp' || item.kind === 'table_lamp') {
    const reach=Math.min(w,d)/2, shade=item.kind==='floor_lamp'?h*.25:h*.42, glow=new THREE.MeshStandardMaterial({color:'#fff2bd',emissive:'#ffd98a',emissiveIntensity:.55,roughness:.55});
    cylinder(g,reach*.48,reach*.58,Math.min(h*.05,.04),[0,Math.min(h*.025,.02),0],dark);
    cylinder(g,reach*.075,reach*.095,h-shade*.65,[0,(h-shade*.65)/2,0],wood);
    cylinder(g,reach*.48,reach*.82,shade,[0,h-shade/2,0],body);
    cylinder(g,reach*.46,reach*.46,.012,[0,h-shade+.006,0],glow);
  } else if (item.kind === 'sofa' && form === 'corner') {
    // Conservative L inside the measured rectangle: a main run plus a chaise return.
    // The chaise sits on the west side, so the open corner is the south east
    // quadrant in both views; the 2D notch uses the same convention.
    const run = d * .55, arm = w * .38, plinth = h * .1, span = w - arm - w * .06;
    box(g, [w, plinth, run], [0, plinth / 2, -(d - run) / 2], dark, .01);
    box(g, [arm, plinth, d - run], [-w / 2 + arm / 2, plinth / 2, run / 2], dark, .01);
    box(g, [w, h * .32, run], [0, h * .28, -(d - run) / 2], body, .06);
    box(g, [arm, h * .32, d - run], [-w / 2 + arm / 2, h * .28, run / 2], body, .06);
    box(g, [w, h * .62, run * .22], [0, h * .66, -d / 2 + run * .11], body, .05);
    box(g, [arm * .18, h * .62, d - run], [-w / 2 + arm * .09, h * .66, run / 2], body, .05);
    box(g, [w * .06, h * .5, run], [w / 2 - w * .03, h * .4, -(d - run) / 2], body, .04);
    const seats = Math.max(2, Math.round(span / .7));
    for (let i = 0; i < seats; i++) {
      const x = -w / 2 + arm + span / seats * (i + .5);
      box(g, [span / seats - .016, h * .17, run * .74], [x, h * .48, -d / 2 + run * .58], cream, .045);
      box(g, [span / seats - .022, h * .36, run * .2], [x, h * .7, -d / 2 + run * .3], body, .045);
    }
    box(g, [arm * .8, h * .17, (d - run) * .82], [-w / 2 + arm / 2, h * .48, run / 2], cream, .045);
    box(g, [w * .1, h * .22, run * .2], [w * .2, h * .7, -d / 2 + run * .34], cream, .04);
  } else if (item.kind === 'sofa' && form === 'loveseat') {
    // Rolled arms and two deep cushions read as a small sofa, not a shrunken three seater.
    const roll = Math.min(h * .09, w * .05);
    legs(h * .16, .035);
    box(g, [w, h * .34, d], [0, h * .31, 0], body, .07);
    box(g, [w * .9, h * .6, d * .2], [0, h * .68, -d * .39], body, .06);
    for (const x of [-1, 1]) {
      box(g, [w * .11, h * .44, d * .9], [x * (w / 2 - w * .055), h * .5, d * .03], body, .05);
      const bolster = cylinder(g, roll, roll, d * .86, [x * (w / 2 - w * .055), h * .68, d * .03], body); bolster.rotation.x = Math.PI / 2;
    }
    for (const x of [-1, 1]) {
      box(g, [w * .34, h * .17, d * .64], [x * w * .19, h * .5, d * .1], cream, .05);
      box(g, [w * .32, h * .36, d * .16], [x * w * .19, h * .76, -d * .25], body, .05);
    }
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
  } else if (item.kind === 'chair' && form === 'task') {
    // The five star base stays inside the circle inscribed in the footprint.
    const reach = Math.min(w, d) / 2, seat = h * .46;
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5, spoke = box(g, [reach * .84, h * .035, reach * .16], [Math.cos(a) * reach * .42, h * .045, Math.sin(a) * reach * .42], dark, .008);
      spoke.rotation.y = -a;
      cylinder(g, reach * .07, reach * .07, h * .05, [Math.cos(a) * reach * .8, h * .025, Math.sin(a) * reach * .8], dark);
    }
    cylinder(g, reach * .1, reach * .13, seat - h * .07, [0, (seat + h * .07) / 2, 0], dark);
    box(g, [w * .86, h * .09, d * .82], [0, seat + h * .045, d * .02], body, .03);
    box(g, [w * .74, h * .42, d * .12], [0, h * .76, -d * .36], body, .035);
    box(g, [w * .6, h * .05, d * .06], [0, h * .56, -d * .33], dark, .012);
    for (const x of [-1, 1]) box(g, [w * .06, h * .06, d * .5], [x * w * .44, seat + h * .17, d * .04], dark, .015);
  } else if (item.kind === 'chair' && form === 'stool') {
    const reach = Math.min(w, d) / 2;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, leg = cylinder(g, reach * .09, reach * .07, h * .86, [Math.cos(a) * reach * .58, h * .43, Math.sin(a) * reach * .58], wood);
      leg.rotation.set(Math.sin(a) * .07, 0, -Math.cos(a) * .07);
    }
    cylinder(g, reach * .94, reach * .9, h * .13, [0, h * .935, 0], body);
    cylinder(g, reach * .6, reach * .6, .004, [0, h - .002, 0], cream);
  } else if (item.kind === 'chair' && form === 'armchair') {
    legs(h * .13, .03);
    box(g, [w, h * .28, d], [0, h * .25, 0], body, .05);
    box(g, [w * .94, h * .5, d * .2], [0, h * .62, -d * .4], body, .05);
    for (const x of [-1, 1]) box(g, [w * .13, h * .4, d * .86], [x * (w / 2 - w * .065), h * .44, d * .05], body, .04);
    box(g, [w * .66, h * .13, d * .64], [0, h * .43, d * .06], cream, .045);
    box(g, [w * .5, h * .28, d * .12], [0, h * .62, -d * .28], cream, .04);
  } else if (item.kind === 'chair' && form === 'dining') {
    legs(h * .5, .02);
    box(g, [w, h * .09, d * .9], [0, h * .545, d * .05], body, .03);
    for (const x of [-1, 1]) box(g, [w * .09, h * .42, d * .1], [x * w * .42, h * .78, -d * .4], wood, .015);
    box(g, [w * .93, h * .1, d * .09], [0, h * .95, -d * .4], wood, .02);
    box(g, [w * .8, h * .07, d * .06], [0, h * .78, -d * .4], wood, .015);
  } else if (item.kind === 'chair') {
    legs(h * .46);
    box(g, [w, h * .17, d * .91], [0, h * .49, d * .04], body, .055);
    box(g, [w, h * .46, d * .18], [0, h * .77, -d * .41], body, .055);
  } else if (item.kind === 'bed' && form === 'day') {
    // A day bed puts its back along the long side, with two low ends.
    legs(h * .16, Math.min(.035, w * .035));
    box(g, [w, h * .24, d], [0, h * .22, 0], wood, .035);
    box(g, [w * .065, h, d], [-w * .4675, h / 2, 0], body, .04);
    for (const z of [-1, 1]) box(g, [w, h * .52, d * .055], [0, h * .26, z * (d / 2 - d * .0275)], body, .04);
    box(g, [w * .86, h * .22, d * .94], [w * .03, h * .45, 0], cream, .05);
    box(g, [w * .8, h * .075, d * .55], [w * .04, h * .595, 0], body, .045);
    for (const z of [-1, 1]) box(g, [w * .5, h * .14, d * .18], [w * .16, h * .63, z * d * .3], cream, .045);
  } else if (item.kind === 'bed') {
    // The measured envelope includes the headboard, not just the mattress.
    legs(h * .16, Math.min(.035, w * .035));
    box(g, [w, h * .24, d], [0, h * .22, 0], wood, .035);
    box(g, [w, h, d * .065], [0, h / 2, -d * .4675], body, .04);
    box(g, [w * .91, h * .22, d * .91], [0, h * .45, d * .017], cream, .05);
    box(g, [w * .94, h * .075, d * .62], [0, h * .595, d * .16], body, .045);
    box(g, [w * .94, h * .025, d * .15], [0, h * .645, d * .36], material('#d8c5a7'), .015);
    const pillows = w < 1.15 ? 1 : 2;
    for (let i = 0; i < pillows; i++) {
      const x = pillows === 1 ? 0 : (i === 0 ? -1 : 1) * w * .235;
      box(g, [w * (pillows === 1 ? .68 : .40), h * .12, d * .20], [x, h * .625, -d * .30], cream, .045);
    }
  } else if (item.kind === 'desk' && form === 'corner') {
    // Rectangular envelope, L-shaped worktop: the inner corner is left open.
    const arm = d * .52, top = Math.min(.07, h * .12), r = Math.min(.028, w * .04), stand = h - top;
    box(g, [w, top, arm], [0, h - top / 2, -(d - arm) / 2], body, .02);
    box(g, [arm, top, d - arm], [-(w - arm) / 2, h - top / 2, arm / 2], body, .02);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1]] as const) cylinder(g, r, r * .75, stand, [x * (w / 2 - r * 2), stand / 2, z * (d / 2 - r * 2)], wood);
    cylinder(g, r, r * .75, stand, [w / 2 - r * 2, stand / 2, -d / 2 + arm - r * 2], wood);
    cylinder(g, r, r * .75, stand, [-w / 2 + arm - r * 2, stand / 2, d / 2 - r * 2], wood);
    box(g, [w * .22, .002, arm * .5], [-w * .16, h - .001, -(d - arm) / 2], cream);
    box(g, [w * .1, .002, arm * .3], [w * .28, h, -(d - arm) / 2], dark);
  } else if (item.kind === 'desk' && form === 'standing') {
    const top = Math.min(.07, h * .12), post = w * .05;
    box(g, [w, top, d], [0, h - top / 2, 0], body, .02);
    for (const x of [-1, 1]) {
      box(g, [post, h - top, d * .55], [x * (w / 2 - w * .1), (h - top) / 2, 0], dark, .01);
      box(g, [post * 1.4, h * .035, d * .92], [x * (w / 2 - w * .1), h * .018, 0], dark, .008);
    }
    box(g, [w * .52, h * .05, d * .22], [0, h - top - h * .05, -d * .1], dark, .008);
    box(g, [w * .16, h * .03, d * .05], [-w * .28, h - top - h * .02, d * .32], cream, .005);
    box(g, [w * .3, .002, d * .34], [w * .12, h - .001, -d * .05], cream);
  } else if (item.kind === 'desk' && form === 'dressing') {
    const top = Math.min(.07, h * .12), bank = Math.min(w * .34, .42), stand = h - top;
    box(g, [w, top, d], [0, h - top / 2, 0], body, .02);
    box(g, [bank, stand * .62, d * .9], [w / 2 - bank / 2 - w * .02, h - top - stand * .31, 0], body, .012);
    for (let i = 0; i < 2; i++) {
      const y = h - top - stand * (.16 + i * .3);
      box(g, [bank * .86, stand * .22, .012], [w / 2 - bank / 2 - w * .02, y, d * .45 - .008], body, .004);
      box(g, [bank * .4, .012, .016], [w / 2 - bank / 2 - w * .02, y, d * .45 - .009], dark, .003);
    }
    for (const z of [-1, 1]) cylinder(g, .016, .011, stand, [-w / 2 + .04, stand / 2, z * (d / 2 - .04)], wood);
    box(g, [w * .26, .003, d * .5], [-w * .22, h - .0015, 0], cream);
    box(g, [w * .05, .004, d * .05], [-w * .32, h - .002, 0], dark);
  } else if (item.kind === 'table' && form === 'console') {
    const top = Math.min(.05, h * .08);
    box(g, [w, top, d], [0, h - top / 2, 0], body, .015);
    for (const x of [-1, 1]) for (const z of [-1, 1]) cylinder(g, .014, .009, h - top, [x * (w / 2 - .035), (h - top) / 2, z * (d / 2 - .028)], wood);
    box(g, [w * .86, .014, d * .68], [0, h * .25, 0], body, .006);
    box(g, [w * .18, h * .1, d * .44], [w * .24, h * .3, 0], cream, .012);
    box(g, [w * .1, h * .07, d * .3], [-w * .22, h * .285, 0], dark, .01);
  } else if (item.kind === 'table' && form === 'side') {
    const reach = Math.min(w, d) / 2;
    cylinder(g, reach * .58, reach * .66, h * .04, [0, h * .02, 0], dark);
    cylinder(g, reach * .15, reach * .15, h * .92, [0, h * .5, 0], wood);
    cylinder(g, reach, reach * .97, h * .08, [0, h * .96, 0], body);
    cylinder(g, reach * .34, reach * .34, .003, [0, h - .0015, 0], cream);
    box(g, [reach * .3, h * .09, reach * .3], [reach * .38, h * .955, 0], cream, .01);
  } else if (item.kind === 'table' && form === 'meeting') {
    const top = Math.min(.07, h * .12), post = w * .05;
    box(g, [w, top, d], [0, h - top / 2, 0], body, .025);
    for (const x of [-1, 1]) for (const z of [-1, 1]) box(g, [post, h - top, d * .08], [x * (w / 2 - post), (h - top) / 2, z * (d / 2 - d * .07)], wood, .008);
    box(g, [w * .78, h * .05, d * .04], [0, h * .17, 0], wood, .006);
    for (const x of [-1, 1]) box(g, [post * .6, h * .05, d * .7], [x * (w / 2 - post), h * .17, 0], wood, .006);
    box(g, [w * .34, .003, d * .42], [0, h - .0015, 0], cream);
    box(g, [w * .08, .004, d * .1], [-w * .3, h - .002, d * .2], dark);
  } else if (item.kind === 'table' && form === 'bench') {
    box(g, [w, h * .15, d], [0, h * .925, 0], wood, .012);
    for (const x of [-1, 1]) box(g, [w * .05, h * .85, d * .82], [x * (w / 2 - w * .035), h * .425, 0], body, .01);
    box(g, [w * .74, h * .07, d * .16], [0, h * .3, 0], body, .008);
    box(g, [w * .3, h * .03, d * .5], [w * .2, h * .985, 0], cream, .01);
  } else if (item.kind === 'coffee_table' && form === 'ottoman') {
    for (const x of [-1, 1]) for (const z of [-1, 1]) cylinder(g, .016, .012, h * .12, [x * (w / 2 - .05), h * .06, z * (d / 2 - .05)], dark);
    box(g, [w, h * .92, d], [0, h * .54, 0], body, .06);
    box(g, [w, h * .012, d], [0, h * .7, 0], cream, .004);
    box(g, [w * .3, h * .05, d * .3], [0, h * .975, 0], body, .02);
  } else if (item.kind === 'desk' || item.kind === 'table' || item.kind === 'coffee_table') {
    const top = Math.min(.07, h * .12); legs(h - top, item.kind === 'coffee_table' ? .035 : .025);
    box(g, [w, top, d], [0, h - top / 2, 0], body, item.kind === 'coffee_table' ? .10 : .025);
    // Inset surface accents avoid inventing additional measured height.
    box(g, [w * .24, .002, d * .32], [-w * .23, h - .001, -d * .08], cream);
    box(g, [w * .23, .002, d * .31], [-w * .20, h, -d * .045], material('#738474'));
  } else if (item.kind === 'storage' && (form === 'shelving' || form === 'media')) {
    // Open carcass: sides, deck, top and a back panel, then shelves with contents.
    const t = Math.min(.018, w * .06, d * .12), bays = form === 'media' ? Math.max(1, Math.round(w / .45)) : 1;
    for (const x of [-1, 1]) box(g, [t, h, d], [x * (w / 2 - t / 2), h / 2, 0], body);
    box(g, [w - 2 * t, t, d], [0, h - t / 2, 0], body);
    box(g, [w - 2 * t, t, d], [0, t / 2, 0], body);
    box(g, [w - 2 * t, h - 2 * t, .008], [0, h / 2, -d / 2 + .005], form === 'media' ? dark : cream);
    const decks = form === 'media' ? 1 : Math.min(5, Math.max(2, Math.round((h - 2 * t) / .34))), gap = (h - 2 * t) / (decks + 1);
    for (let i = 1; i <= decks; i++) box(g, [w - 2 * t, .014, d - .014], [0, t + gap * i, .006], body);
    for (let i = 1; i < bays; i++) box(g, [t, h - 2 * t, d], [-w / 2 + w * i / bays, h / 2, 0], body);
    for (let s = 0; s <= decks; s++) {
      let x = -w / 2 + t + .012;
      for (let i = 0; i < 14; i++) {
        const bw = .016 + (i % 3) * .008, bh = (gap - .016) * (.58 + (i % 4) * .09);
        if (x + bw > w / 2 - t) break;
        box(g, [bw, bh, d * .6], [x + bw / 2, t + gap * s + .008 + bh / 2, d * .04], [wood, dark, cream, body][(s + i) % 4]);
        x += bw + .005;
      }
    }
  } else if (item.kind === 'storage' && form === 'drawers') {
    const runs = Math.min(5, Math.max(2, Math.round(h / .26)));
    box(g, [w, h, d], [0, h / 2, 0], body, .015);
    for (let i = 0; i < runs; i++) {
      const face = h * .94 / runs, y = h * .03 + face * (i + .5);
      box(g, [w * .93, face * .84, .012], [0, y, d / 2 - .008], body, .004);
      box(g, [w * .34, .014, .016], [0, y, d / 2 - .009], dark, .003);
    }
  } else if (item.kind === 'storage' && form === 'bedside') {
    const lift = h * .16, carcass = h - lift;
    for (const x of [-1, 1]) for (const z of [-1, 1]) box(g, [w * .07, lift, d * .07], [x * (w / 2 - w * .045), lift / 2, z * (d / 2 - d * .045)], wood, .004);
    box(g, [w, carcass, d], [0, lift + carcass / 2, 0], body, .012);
    box(g, [w * .9, carcass * .3, .012], [0, h - carcass * .22, d / 2 - .008], body, .004);
    box(g, [w * .3, .012, .016], [0, h - carcass * .22, d / 2 - .009], dark, .003);
    box(g, [w * .84, carcass * .46, .01], [0, lift + carcass * .3, d / 2 - .006], dark, .004);
  } else if (item.kind === 'storage' && form === 'basket') {
    // Open topped: woven bands and a lining, never a door front.
    const t = Math.min(.014, w * .06, d * .06);
    for (const z of [-1, 1]) box(g, [w, h * .94, t], [0, h * .47, z * (d / 2 - t / 2)], body, .004);
    for (const x of [-1, 1]) box(g, [t, h * .94, d - 2 * t], [x * (w / 2 - t / 2), h * .47, 0], body, .004);
    box(g, [w - 2 * t, .012, d - 2 * t], [0, .006, 0], wood);
    for (let i = 1; i <= 3; i++) {
      const y = h * .94 * i / 4;
      for (const z of [-1, 1]) box(g, [w * .99, .012, t * .6], [0, y, z * (d / 2 - t * .3)], wood);
      for (const x of [-1, 1]) box(g, [t * .6, .012, (d - 2 * t) * .99], [x * (w / 2 - t * .3), y, 0], wood);
    }
    box(g, [w * .86, h * .07, d * .86], [0, h * .9, 0], cream, .01);
    box(g, [w, h * .04, d], [0, h * .98, 0], wood, .008);
  } else if (item.kind === 'storage' && form === 'wardrobe') {
    box(g, [w, h, d], [0, h / 2, 0], body, .015);
    box(g, [w * .98, h * .035, d * .96], [0, h * .0175, 0], dark, .006);
    for (const x of [-1, 1]) {
      box(g, [w * .485, h * .93, .012], [x * w * .2475, h * .51, d / 2 - .008], body, .005);
      box(g, [.016, h * .22, .018], [x * Math.min(.026, w * .06), h * .55, d / 2 - .009], dark, .004);
    }
    box(g, [w, h * .014, d * .99], [0, h * .965, 0], dark);
  } else if (item.kind === 'storage' && form === 'chest') {
    for (const x of [-1, 1]) for (const z of [-1, 1]) box(g, [w * .06, h * .12, d * .08], [x * (w / 2 - w * .04), h * .06, z * (d / 2 - d * .05)], dark, .004);
    box(g, [w, h * .72, d], [0, h * .48, 0], body, .012);
    box(g, [w, h * .16, d], [0, h * .92, 0], wood, .012);
    for (const x of [-1, 1]) box(g, [w * .05, h * .62, .01], [x * w * .3, h * .45, d / 2 - .006], wood, .003);
    box(g, [w * .14, h * .04, .014], [0, h * .8, d / 2 - .008], dark, .003);
  } else if (item.kind === 'storage' && form === 'vanity') {
    const reach = Math.min(w, d);
    box(g, [w, h * .74, d], [0, h * .37, 0], body, .012);
    for (const x of [-1, 1]) {
      box(g, [w * .47, h * .66, .012], [x * w * .242, h * .37, d / 2 - .008], body, .004);
      box(g, [.012, h * .07, .018], [x * Math.min(.03, w * .06), h * .44, d / 2 - .009], dark, .003);
    }
    box(g, [w, h * .05, d], [0, h * .765, 0], cream, .008);
    cylinder(g, reach * .3, reach * .24, h * .15, [0, h * .865, d * .03], cream);
    cylinder(g, reach * .03, reach * .03, h * .12, [0, h * .85, -d * .32], dark);
    box(g, [w * .05, h * .03, d * .14], [0, h * .905, -d * .25], dark, .004);
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
    const horizontal = item.wallAnchor?.wall === 'north' || item.wallAnchor?.wall === 'south';
    box(g, [horizontal ? w : w * .75, h, horizontal ? d * .75 : d], [0, h / 2, 0], cream, .01);
    const length = horizontal ? w : d;
    for (let t = -length / 2 + .035; t < length / 2; t += .07) box(g, horizontal ? [.035, h * .91, d] : [w, h * .91, .035], horizontal ? [t, h * .51, 0] : [0, h * .51, t], body, .01);
  } else if (String(item.kind) === 'basin') {
    const ceramic = material('#f2f1e9'), recess = material('#bacdcd'), chrome = material('#8faaa8');
    if (w >= .75) box(g, [w * .93, h * .69, d * .9], [0, h * .345, 0], body, .025);
    else cylinder(g, Math.min(w,d) * .19, Math.min(w,d) * .24, h * .68, [0,h * .34,0], ceramic);
    box(g, [w, h * .09, d], [0,h * .745,0], ceramic, .04);
    box(g, [w * .71, h * .012, d * .57], [0,h * .799,d * .045], recess, .035);
    for (const x of [-1,1]) box(g, [w * .11,h * .12,d * .87], [x * w * .445,h * .84,0], ceramic, .025);
    for (const z of [-1,1]) box(g, [w * .81,h * .12,d * .12], [0,h * .84,z * d * .435], ceramic, .025);
    cylinder(g, Math.min(w,d) * .025, Math.min(w,d) * .025, h * .12, [0,h * .90,-d * .34], chrome);
    box(g, [w * .045,h * .025,d * .18], [0,h * .948,-d * .26], chrome, .004);
  } else if (String(item.kind) === 'toilet') {
    const ceramic = material('#f4f3ec'), water = material('#abc2c2');
    box(g, [w * .80,h * .47,d * .24], [0,h * .765,-d * .36], ceramic, .035);
    box(g, [w * .82,h * .025,d * .25], [0,h * .9875,-d * .36], cream, .012);
    const pedestal = cylinder(g, 1, .72, h * .38, [0,h * .19,d * .12], ceramic);
    pedestal.scale.set(w * .33,1,d * .25);
    const bowl = cylinder(g, 1, .76, h * .18, [0,h * .44,d * .12], ceramic);
    bowl.scale.set(w * .48,1,d * .34);
    const seat = cylinder(g, 1, 1, h * .035, [0,h * .548,d * .12], cream);
    seat.scale.set(w * .46,1,d * .32);
    const opening = cylinder(g, 1, 1, h * .005, [0,h * .568,d * .13], water);
    opening.scale.set(w * .31,1,d * .22);
    box(g, [w * .15,h * .009,d * .045], [w * .2,h * .989,-d * .23], dark, .003);
  } else if (String(item.kind) === 'shower') {
    // Tray-only measurements: no unmeasured glass or overhead shower hardware.
    const ceramic = material('#edece4'), recess = material('#c1d0cc');
    box(g, [w,h * .78,d], [0,h * .39,0], ceramic, .018);
    box(g, [w * .88,h * .02,d * .88], [0,h * .80,0], recess, .012);
    for (const x of [-1,1]) box(g, [w * .04,h * .2,d], [x * w * .48,h * .90,0], ceramic, .008);
    for (const z of [-1,1]) box(g, [w,h * .2,d * .04], [0,h * .90,z * d * .48], ceramic, .008);
    cylinder(g, Math.min(w,d) * .045, Math.min(w,d) * .045, h * .02, [w * .27,h * .83,-d * .27], dark);
  } else if (String(item.kind) === 'bath') {
    const ceramic = material('#efeee6'), inset = material('#c3d3d0'), chrome = material('#90a4a1');
    box(g, [w,h * .18,d], [0,h * .09,0], ceramic, .045);
    for (const z of [-1,1]) box(g, [w,h * .82,d * .1], [0,h * .59,z * d * .45], ceramic, .035);
    for (const x of [-1,1]) box(g, [w * .06,h * .82,d * .83], [x * w * .47,h * .59,0], ceramic, .035);
    box(g, [w * .87,h * .015,d * .78], [0,h * .27,0], inset, .04);
    cylinder(g, Math.min(w,d) * .023, Math.min(w,d) * .023, h * .10, [-w * .45,h * .88,0], chrome);
    box(g, [w * .075,h * .025,d * .045], [-w * .42,h * .927,0], chrome, .004);
  } else if (String(item.kind) === 'towel_rail') {
    const metal = material('#7b9590');
    for (const x of [-1,1]) cylinder(g, Math.min(w,d) * .11, Math.min(w,d) * .11, h * .97, [x * w * .43,h * .5,0], metal);
    for (let i=0;i<8;i++) box(g, [w * .86,h * .018,d * .28], [0,h * (.12+i*.105),0], metal, .006);
    box(g, [w * .57,h * .36,d * .10], [w * .05,h * .59,d * .28], body, .01);
  } else if (item.kind === 'plant') {
    // A tilted leaf spans |cos|*sx + |sin|*sy, so both half-extents are capped
    // against the envelope; the old spread pushed leaves ~2 cm outside it.
    const potH = h * .29, reach = Math.min(w,d), leafX = Math.min(reach * .13,h * .1), leafY = Math.min(h * .085,reach * .12);
    cylinder(g, reach * .37, reach * .27, potH, [0,potH / 2,0], material('#c39179'));
    cylinder(g,Math.min(.012,reach * .06),Math.min(.014,reach * .07),h * .65,[0,h * .60,0],wood);
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4, leaf = new THREE.Mesh(new THREE.SphereGeometry(1,12,8),body);
      leaf.scale.set(leafX,leafY,reach * .09); leaf.position.set(Math.cos(a) * reach * .2,h * (.45+i*.0586),Math.sin(a) * reach * .2); leaf.rotation.z = Math.cos(a) * .5; leaf.castShadow = true; g.add(leaf);
    }
  } else {
    box(g,[w,h,d],[0,h / 2,0],body,.025);
  }
  // Custom pieces are contractual measured envelopes, not catalogue art. Some
  // decorative seams intentionally sit a millimetre proud on named variants;
  // contain the complete safe primitive for custom records so no mesh exceeds
  // the exact agent-supplied width, height or depth.
  if (item.ownership === 'custom') {
    const rotationY = g.rotation.y;
    g.rotation.y = 0; g.updateMatrixWorld(true);
    const rendered = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    g.scale.set(Math.min(1, w / Math.max(rendered.x, .001)), Math.min(1, h / Math.max(rendered.y, .001)), Math.min(1, d / Math.max(rendered.z, .001)));
    g.rotation.y = rotationY; g.updateMatrixWorld(true);
  }
  // Materials not used by this kind must not linger across scene rebuilds.
  const used = new Set<THREE.Material>(); g.traverse(o=>{if(o instanceof THREE.Mesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>used.add(m));});
  [body,wood,dark,cream].filter(m=>!used.has(m)).forEach(m=>m.dispose());
  return g;
}

export type RoomScene = { root: THREE.Group; walls: Map<string, THREE.Group>; pieces: Map<string, THREE.Group> };
export function buildRoomScene(room: Room, layout: Layout, rules: Rules, textures: TextureOptions = {}): RoomScene {
  const root = new THREE.Group(), walls = new Map<string, THREE.Group>(), pieces = new Map<string, THREE.Group>();
  const w = room.widthCm / 100, d = room.depthCm / 100, h = rules.ceilingCm / 100;
  const floorFinish = PALETTES.floor.find(p => p.id === layout.appearance.floor);
  const floor = finishMaterial(floorFinish, textures), wallMat = finishMaterial(PALETTES.wall.find(p => p.id === layout.appearance.wall), textures);
  if (room.floorPlan) {
    const shape = new THREE.Shape(), points = floorPoints(room); shape.moveTo(points[0].xCm / 100, points[0].yCm / 100); points.slice(1).forEach(point => shape.lineTo(point.xCm / 100, point.yCm / 100)); shape.closePath();
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .14, bevelEnabled: false }), material('#d2c7b4')); base.rotation.x = Math.PI / 2; base.receiveShadow = true; root.add(base);
    const surface = new THREE.Mesh(new THREE.ShapeGeometry(shape), floor); surface.rotation.x = Math.PI / 2; surface.position.y = .001; surface.receiveShadow = true; mapFinishUV(surface, 'floor'); root.add(surface);
  } else {
    box(root,[w + .16,.14,d + .16],[w / 2,-.07,d / 2],material('#d2c7b4'),.03);
    mapFinishUV(box(root,[w,.018,d],[w / 2,-.009,d / 2],floor), 'floor');
  }
  if (!room.floorPlan && !floorFinish?.texture) {
    const seam = material('#c7b99f');
    for (let x = .18; x < w; x += .18) { const line = box(root,[.002,.001,d],[x,.001,d / 2],seam); line.castShadow=false; }
    for (let x = 0; x < w; x += .18) for (let z = (Math.round(x / .18) % 3) * .43 + .43; z < d; z += 1.29) { const line = box(root,[Math.min(.18,w-x),.001,.002],[x + Math.min(.18,w-x)/2,.001,z],seam); line.castShadow=false; }
  }
  for (const segment of wallSegments(room)) {
    const wall = segment.wall, segmentId = room.floorPlan ? segment.id : undefined;
    const group = new THREE.Group(); group.name = `wall-${segment.id}`; group.userData.wall = wall; group.userData.segment = segment; walls.set(segment.id,group); root.add(group);
    const length = segment.lengthCm / 100;
    const openings = room.openings.filter(o=>room.floorPlan ? o.segmentId===segment.id : o.wall===wall);
    const cuts = [...new Set([0,length,...openings.flatMap(o=>[Math.max(0,Math.min(length,o.offsetCm/100)),Math.max(0,Math.min(length,(o.offsetCm+o.widthCm)/100))])])].sort((a,b)=>a-b);
    const slab = (a:number,b:number,bottom:number,top:number,mat=wallMat,thickness=.08,inset=-.04) => {
      if(b<=a||top<=bottom)return;
      const [x,z]=wallPoint(room,wall,(a+b)/2,inset,segmentId),horizontal=wall==='north'||wall==='south';
      const mesh = box(group,horizontal?[b-a,top-bottom,thickness]:[thickness,top-bottom,b-a],[x,(top+bottom)/2,z],mat);
      if (mat === wallMat) mapFinishUV(mesh, horizontal ? 'north-south' : 'east-west');
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
        const [x,z]=wallPoint(room,wall,hinge,opening.swing==='in'?width/2:-width/2,segmentId);
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
  for (const group of scene.walls.values()) {
    const wall = group.userData.wall as Wall;
    const near = wall==='north'?camera.position.z<room.depthCm/200:wall==='south'?camera.position.z>room.depthCm/200:wall==='west'?camera.position.x<room.widthCm/200:camera.position.x>room.widthCm/200;
    group.visible = !enabled || !near;
  }
}
