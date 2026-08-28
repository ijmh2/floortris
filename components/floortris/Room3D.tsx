import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRoomScene, disposeObject, updateCutaway, type RoomScene } from './scene3d.ts';
import type { Layout, Room, Rules } from './model.ts';

type Props = { room: Room; layout: Layout; rules: Rules; title: string; revision: number; selected: string | null; onSelect: (id: string | null) => void; onReturn2D: () => void; onEditRoom?: () => void; compact?: boolean; selectable: boolean };
type Runtime = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; controls: OrbitControls; model: RoomScene | null; highlight: THREE.BoxHelper | null; room: Room; cutaway: boolean; render: () => void; reset: () => void; zoom: (factor: number) => void; select: (id: string | null) => void };

export default function Room3D(props: Props) {
  const host = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null), latest = useRef(props);
  const [error, setError] = useState<string | null>(null), [cutaway, setCutaway] = useState(true);
  const [textureWarning, setTextureWarning] = useState(false);
  useEffect(() => { latest.current = props; });
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
    catch { queueMicrotask(() => setError('3D is unavailable in this browser. Your room and all editing tools are still available in 2D.')); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor('#eef1e9'); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
    renderer.domElement.setAttribute('aria-label', `${latest.current.title} interactive 3D room`);
    renderer.domElement.setAttribute('role','img'); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-4,4,4,-4,.01,100);
    const controls = new OrbitControls(camera,renderer.domElement);
    controls.enablePan = false; controls.minPolarAngle = .18; controls.maxPolarAngle = Math.PI * .47; controls.minZoom = .55; controls.maxZoom = 2.8; controls.zoomSpeed = .7;
    const sky = new THREE.HemisphereLight('#fff7e8','#aaa994',2.5); scene.add(sky);
    const sun = new THREE.DirectionalLight('#fff0d7',3.2);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;scene.add(sun);scene.add(sun.target);
    const fill = new THREE.DirectionalLight('#e1eceb',1.1);scene.add(fill);
    let disposed = false, frame = 0;
    const rt: Runtime = { renderer,scene,camera,controls,model:null,highlight:null,room:latest.current.room,cutaway:true,
      render: () => { if(disposed||frame)return;frame=requestAnimationFrame(()=>{frame=0;if(disposed)return;if(rt.model)updateCutaway(rt.model,camera,rt.room,rt.cutaway);renderer.render(scene,camera);}); },
      reset: () => {
        const w=rt.room.widthCm/100,d=rt.room.depthCm/100,span=Math.max(w,d),height=latest.current.rules.ceilingCm/100;
        controls.target.set(w/2,height*.48,d/2);camera.position.set(w/2+span*.95,height*1.27+span*.82,d/2+span*1.15);camera.zoom=1;
        const aspect=Math.max(.1,el.clientWidth/Math.max(1,el.clientHeight)),size=Math.max(span*1.28,span/aspect*1.15)+height*.62;
        camera.left=-size*aspect/2;camera.right=size*aspect/2;camera.top=size/2;camera.bottom=-size/2;camera.updateProjectionMatrix();controls.update();
        sun.position.set(-span*.45,height+span*.9,-span*.25);sun.target.position.set(w/2,0,d/2);
        Object.assign(sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:.1,far:span*5+height});sun.shadow.camera.updateProjectionMatrix();
        fill.position.set(w+span,height+span,d+span);rt.render();
      },
      zoom: factor => {camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,controls.minZoom,controls.maxZoom);camera.updateProjectionMatrix();rt.render();},
      select: id => {
        if(rt.highlight){scene.remove(rt.highlight);disposeObject(rt.highlight);rt.highlight=null;}
        const object=id&&rt.model?.pieces.get(id);
        if(object){rt.highlight=new THREE.BoxHelper(object,'#345c43');scene.add(rt.highlight);}rt.render();
      },
    };
    runtime.current=rt;
    const resize=()=>{if(!el.clientWidth||!el.clientHeight)return;renderer.setSize(el.clientWidth,el.clientHeight,false);const aspect=el.clientWidth/el.clientHeight,span=Math.max(rt.room.widthCm,rt.room.depthCm)/100,half=(Math.max(span*1.28,span/aspect*1.15)+latest.current.rules.ceilingCm/100*.62)/2;camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();rt.render();};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();rt.reset();
    controls.addEventListener('change',rt.render);
    const raycaster=new THREE.Raycaster();let down:{x:number;y:number}|null=null;
    const pointerDown=(event:PointerEvent)=>{down=event.isPrimary&&event.button===0?{x:event.clientX,y:event.clientY}:null;};
    const pointerCancel=()=>{down=null;};
    const pointerUp=(event:PointerEvent)=>{
      if(!down||Math.hypot(event.clientX-down.x,event.clientY-down.y)>5||!latest.current.selectable){down=null;return;}down=null;
      const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),camera);
      const targets:THREE.Object3D[]=[];rt.model?.root.traverseVisible(o=>{if(o instanceof THREE.Mesh)targets.push(o);});
      const hit=raycaster.intersectObjects(targets,false)[0];
      let picked:string|null=null,o:THREE.Object3D|null=hit?.object||null;
      while(o&&!o.userData.objectId)o=o.parent;
      if(o&&latest.current.layout.furniture.some(f=>f.id===o!.userData.objectId))picked=o.userData.objectId;
      else if(o&&latest.current.room.fixtures.some(f=>f.id===o!.userData.objectId)&&latest.current.onEditRoom){latest.current.onEditRoom();return;}
      latest.current.onSelect(picked);
    };
    const contextLost=(event:Event)=>{event.preventDefault();queueMicrotask(()=>setError('The 3D graphics connection was lost. Switch to 2D to continue; your room is preserved.'));};
    renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('pointercancel',pointerCancel);renderer.domElement.addEventListener('webglcontextlost',contextLost);
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.removeEventListener('change',rt.render);controls.dispose();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',pointerCancel);renderer.domElement.removeEventListener('webglcontextlost',contextLost);disposeObject(scene);sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();runtime.current=null;};
  },[]);
  useEffect(()=>{
    const rt=runtime.current;if(!rt)return;
    let active = true;
    queueMicrotask(() => { if (active) setTextureWarning(false); });
    const resized=rt.room.widthCm!==props.room.widthCm||rt.room.depthCm!==props.room.depthCm;
    if(rt.model){rt.scene.remove(rt.model.root);disposeObject(rt.model.root);}
    rt.room=props.room;rt.model=buildRoomScene(props.room,props.layout,props.rules, {
      onTextureLoad: () => { if (active) rt.render(); },
      onTextureError: () => { if (active) queueMicrotask(() => { if (active) setTextureWarning(true); }); },
    });rt.scene.add(rt.model.root);rt.select(latest.current.selected);if(resized)rt.reset();rt.render();
    return () => { active = false; };
  },[props.room,props.layout,props.rules]);
  useEffect(()=>{runtime.current?.select(props.selected);},[props.selected]);
  useEffect(()=>{if(runtime.current){runtime.current.cutaway=cutaway;runtime.current.render();}},[cutaway]);
  const unknown=props.layout.furniture.filter(f=>f.sizeCm.h===null);
  const concepts=props.room.fixtures.some(f=>['basin','toilet','shower','bath','towel_rail'].includes(f.kind));
  return <section className={`ft-3d ${props.compact?'ft-3d-compact':''}`} aria-label={`${props.title} 3D view`}>
    <div className="ft-3d-caption"><div><strong>{props.title}</strong><span>3D · rev. {props.revision}</span></div><span>{props.room.widthCm/100} × {props.room.depthCm/100} m · {props.rules.ceilingCm/100} m high</span></div>
    <div className="ft-3d-stage"><div className="ft-3d-canvas" ref={host}/>{error&&<div className="ft-3d-fallback" role="alert"><strong>Keep planning in 2D</strong><p>{error}</p><button className="ft-button ft-primary" onClick={props.onReturn2D}>Back to 2D</button></div>}
      <span className="ft-3d-watermark">A little room. A new perspective.</span>
      {!error&&<div className="ft-3d-camera" role="group" aria-label={`${props.title} camera controls`}><button onClick={()=>runtime.current?.zoom(1.2)} aria-label={`Zoom in ${props.title} 3D`}>+</button><button onClick={()=>runtime.current?.zoom(1/1.2)} aria-label={`Zoom out ${props.title} 3D`}>−</button><button onClick={()=>runtime.current?.reset()}>Reset camera</button><button aria-pressed={cutaway} onClick={()=>setCutaway(!cutaway)}>Cutaway {cutaway?'on':'off'}</button></div>}
    </div>
    <div className="ft-3d-footer"><span>Drag to orbit · scroll or pinch to zoom</span>{props.selectable&&<label>Select piece <select aria-label={`Select piece in ${props.title} 3D`} value={props.selected||''} onChange={e=>props.onSelect(e.target.value||null)}><option value="">Choose furniture</option>{props.layout.furniture.map(f=><option key={f.id} value={f.id}>{f.label}{f.locked.position?' · pinned':''}</option>)}</select></label>}</div>
    {props.onEditRoom&&props.room.fixtures.length>0&&<button className="ft-text-button" onClick={props.onEditRoom}>Edit fixed fixtures ↗</button>}
    {concepts&&<p className="ft-3d-note">Bathroom concept only · fixed equipment and assumed access zones. No plumbing, installation or safety compliance assessment. Shower tray shown without an unmeasured enclosure.</p>}
    {unknown.length>0&&<p className="ft-3d-note">Height unknown: {unknown.map(f=>f.label).join(', ')}. Dashed boxes use a 1 m visual placeholder, not a measured height.</p>}
    {textureWarning&&<p className="ft-3d-note" role="status">A finish image could not load. Its base colour is shown; your layout and checks are unchanged.</p>}
    <p className="ft-3d-note">Same room, same rules. Door height is illustrative; TV visibility is still the 2D height-strip check.</p>
  </section>;
}
