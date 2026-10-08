import * as THREE from 'three';

// Background scenery: rolling ground to the horizon, low-poly mountains with snow caps,
// a forest ring, rocks, drifting clouds, a sun and a gradient sky.
// On by default (everything else starts off) so the world doesn't feel empty.
export const defaultOn = true;

const TREE_COUNT = 160;
const ROCK_COUNT = 50;

// Seeded random so the layout is the same every time
function seeded(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function setup(game) {
  const { scene } = game;
  const rand = seeded(42);
  const root = new THREE.Group();
  const geometries = [];
  const materials = [];
  function track(geo, mat) {
    geometries.push(geo);
    materials.push(mat);
  }

  // Push the fog way out so distant mountains read as hazy, not invisible
  const oldFog = { near: scene.fog.near, far: scene.fog.far };
  scene.fog.near = 30;
  scene.fog.far = 230;

  // Sky dome: deep blue overhead fading to pale at the horizon
  const skyGeo = new THREE.SphereGeometry(260, 32, 16);
  const skyColors = [];
  const top = new THREE.Color(0x3f7fd6);
  const horizon = new THREE.Color(0xcfe6f7);
  const pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 260, 0, 1);
    const c = horizon.clone().lerp(top, Math.pow(t, 0.6));
    skyColors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  track(skyGeo, skyMat);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  root.add(sky);

  // Sun, in the same direction as the scene's main light
  const sunGeo = new THREE.CircleGeometry(9, 32);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4c2, fog: false });
  track(sunGeo, sunMat);
  const sunDisc = new THREE.Mesh(sunGeo, sunMat);
  sunDisc.position.set(3, 6, 2).normalize().multiplyScalar(240);
  sunDisc.lookAt(0, 0, 0);
  root.add(sunDisc);

  // Ground that reaches the horizon, just under the play-area floor
  const groundGeo = new THREE.CircleGeometry(250, 48).rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x5d8a52, roughness: 1 });
  track(groundGeo, groundMat);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -0.02;
  root.add(ground);

  // Mountains in a ring far away
  const mountainMats = [0x6f7f8f, 0x5f7466, 0x7a8696].map((color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }));
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fa, flatShading: true, roughness: 0.9 });
  materials.push(...mountainMats, snowMat);
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + rand() * 0.25;
    const dist = 140 + rand() * 50;
    const height = 30 + rand() * 35;
    const radius = 25 + rand() * 20;
    const geo = new THREE.ConeGeometry(radius, height, 6 + Math.floor(rand() * 3), 1);
    geometries.push(geo);
    const mountain = new THREE.Mesh(geo, mountainMats[i % mountainMats.length]);
    mountain.position.set(Math.cos(angle) * dist, height / 2 - 1, Math.sin(angle) * dist);
    mountain.rotation.y = rand() * Math.PI;
    root.add(mountain);
    // Snow cap: a small cone matching the top of the mountain
    const capHeight = height * 0.28;
    const capGeo = new THREE.ConeGeometry(radius * 0.28 * 1.02, capHeight, geo.parameters.radialSegments, 1);
    geometries.push(capGeo);
    const cap = new THREE.Mesh(capGeo, snowMat);
    cap.position.y = height / 2 - capHeight / 2 + 0.05;
    mountain.add(cap);
  }

  // Forest: instanced trunks + foliage cones in a ring outside the play area
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6).translate(0, 0.8, 0);
  const foliageGeo = new THREE.ConeGeometry(1.1, 3.2, 7).translate(0, 3.0, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 1 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
  track(trunkGeo, trunkMat);
  track(foliageGeo, foliageMat);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, TREE_COUNT);
  const greens = [0x2f6b3a, 0x3d7d45, 0x285c33, 0x4a8a4f, 0x356e3e].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < TREE_COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 24 + Math.pow(rand(), 0.7) * 60;
    p.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    const scale = 0.8 + rand() * 1.0;
    s.set(scale, scale * (0.85 + rand() * 0.4), scale);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m);
    foliage.setMatrixAt(i, m);
    foliage.setColorAt(i, greens[Math.floor(rand() * greens.length)]);
  }
  root.add(trunks, foliage);

  // Rocks scattered around
  const rockGeo = new THREE.IcosahedronGeometry(0.6, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8d91, flatShading: true, roughness: 1 });
  track(rockGeo, rockMat);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
  for (let i = 0; i < ROCK_COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 14 + rand() * 70;
    p.set(Math.cos(angle) * dist, 0.1, Math.sin(angle) * dist);
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    const scale = 0.4 + rand() * 1.4;
    s.set(scale * (1 + rand() * 0.6), scale * 0.6, scale);
    m.compose(p, q, s);
    rocks.setMatrixAt(i, m);
  }
  root.add(rocks);

  // Clouds: puffy clusters that slowly drift around the sky
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.35, fog: false });
  track(cloudGeo, cloudMat);
  const cloudRing = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const angle = rand() * Math.PI * 2;
    const dist = 50 + rand() * 120;
    cloud.position.set(Math.cos(angle) * dist, 35 + rand() * 25, Math.sin(angle) * dist);
    const puffs = 4 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set((j - puffs / 2) * 3 + rand() * 1.5, rand() * 1.5, rand() * 2.5);
      puff.scale.set(3 + rand() * 2.5, 2 + rand() * 1.5, 2.5 + rand() * 2);
      cloud.add(puff);
    }
    cloud.lookAt(0, cloud.position.y, 0);
    cloudRing.add(cloud);
  }
  root.add(cloudRing);

  scene.add(root);

  return {
    update(dt) {
      cloudRing.rotation.y += dt * 0.004;
    },

    dispose() {
      scene.remove(root);
      scene.fog.near = oldFog.near;
      scene.fog.far = oldFog.far;
      trunks.dispose();
      foliage.dispose();
      rocks.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((mat) => mat.dispose());
    },
  };
}
