import * as THREE from 'three';
import type { Finish } from './data.ts';

export type TextureOptions = {
  loadTexture?: (url: string, loaded: (texture: THREE.Texture) => void, failed: () => void) => THREE.Texture;
  onTextureLoad?: () => void;
  onTextureError?: (finishId: string) => void;
};

/** One map per finish per scene. Plain colour stays visible while loading or on failure. */
export function finishMaterial(finish: Finish | undefined, options: TextureOptions = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: finish?.color || '#e8dfce', roughness: .9 });
  mat.userData.finishId = finish?.id;
  if (!finish?.texture) return mat;
  const load = options.loadTexture || (typeof document !== 'undefined'
    ? (url: string, loaded: (texture: THREE.Texture) => void, failed: () => void) => new THREE.TextureLoader().load(url, loaded, undefined, failed)
    : undefined);
  if (!load) return mat; // Geometry tests and server-side rendering never fetch images.
  let active = true, texture: THREE.Texture | undefined;
  mat.addEventListener('dispose', () => { active = false; texture?.dispose(); });
  const configure = (map: THREE.Texture) => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
    map.repeat.set(100 / finish.texture!.repeatCm[0], 100 / finish.texture!.repeatCm[1]);
    map.anisotropy = 4;
  };
  try {
    texture = load(finish.texture.url, map => {
      if (!active) return;
      configure(map); mat.map = map; mat.color.set('#ffffff'); mat.needsUpdate = true;
      options.onTextureLoad?.();
    }, () => {
      if (!active) return;
      mat.map = null; mat.color.set(finish.color); mat.needsUpdate = true;
      options.onTextureError?.(finish.id);
    });
    configure(texture);
  } catch {
    options.onTextureError?.(finish.id);
  }
  return mat;
}

/** World-metre UVs keep the pattern scale and phase continuous around openings. */
export function mapFinishUV(mesh: THREE.Mesh, plane: 'floor' | 'north-south' | 'east-west') {
  const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + mesh.position.x, y = position.getY(i) + mesh.position.y, z = position.getZ(i) + mesh.position.z;
    uv.setXY(i, plane === 'east-west' ? z : x, plane === 'floor' ? z : y);
  }
  uv.needsUpdate = true;
}
