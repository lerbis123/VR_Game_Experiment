import * as THREE from 'three';

// Blue bullseyes on the move, worth 2 points. They vanish for a moment when hit.
const RADIUS = 0.45;
const POINTS = 2;
const RESPAWN_DELAY = 1.2;

// Each path returns a position for a given time. All kept 12+ m away, down-range.
const PATHS = [
  { rail: { y: 1.6, z: -14, halfWidth: 5 }, at: (t, p) => p.set(Math.sin(t * 0.7) * 5, 1.6, -14) },
  { rail: { y: 3.0, z: -18, halfWidth: 4 }, at: (t, p) => p.set(Math.sin(t * 1.2 + 1) * 4, 3.0, -18) },
  { at: (t, p) => p.set(6, 2.2 + Math.sin(t * 1.1) * 1.5, -13) },
  { at: (t, p) => p.set(Math.cos(t * 0.5) * 6, 4.5 + Math.sin(t * 1.2) * 0.5, -16 + Math.sin(t * 0.5) * 3) },
  { at: (t, p) => p.set(-6 + Math.sin(t * 0.5) * 3, RADIUS + Math.abs(Math.sin(t * 3)) * 0.9, -12) },
];

export function setup(game) {
  const { scene } = game;
  const geometries = [];
  const materials = [];
  const removers = [];
  const objects = [];

  const colors = [0x1e6fd9, 0xffffff];
  // fog: false keeps them crisp at long range
  const ringMats = colors.map((color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide, fog: false }));
  const railMat = new THREE.MeshStandardMaterial({ color: 0x555b66, metalness: 0.5, roughness: 0.5 });
  materials.push(...ringMats, railMat);

  const headPos = new THREE.Vector3();

  const targets = PATHS.map((path) => {
    const target = new THREE.Group();
    // Concentric rings, alternating blue and white
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const outer = RADIUS * (1 - i / bands);
      const inner = RADIUS * (1 - (i + 1) / bands);
      const geo = i === bands - 1 ? new THREE.CircleGeometry(outer, 32) : new THREE.RingGeometry(inner, outer, 32);
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, ringMats[i % 2]);
      mesh.position.z = i * 0.002; // avoid z-fighting
      target.add(mesh);
    }
    scene.add(target);
    objects.push(target);

    if (path.rail) {
      const geo = new THREE.BoxGeometry(path.rail.halfWidth * 2 + 0.8, 0.04, 0.04);
      geometries.push(geo);
      const rail = new THREE.Mesh(geo, railMat);
      rail.position.set(0, path.rail.y - RADIUS - 0.05, path.rail.z);
      scene.add(rail);
      objects.push(rail);
    }

    const state = { target, path, hiddenFor: 0, timeOffset: 0 };
    removers.push(game.addHittable({
      object: target,
      radius: RADIUS,
      onHit: (controller) => {
        game.addScore(POINTS, target.position, controller);
        target.visible = false;
        state.hiddenFor = RESPAWN_DELAY;
        state.timeOffset += Math.random() * 10; // reappear somewhere else along the path
      },
    }));
    return state;
  });

  return {
    update(dt, time) {
      game.getHeadPosition(headPos);
      for (const state of targets) {
        if (state.hiddenFor > 0) {
          state.hiddenFor -= dt;
          if (state.hiddenFor <= 0) state.target.visible = true;
        }
        state.path.at(time + state.timeOffset, state.target.position);
        state.target.lookAt(headPos); // always face the player
      }
    },

    dispose() {
      removers.forEach((remove) => remove());
      objects.forEach((o) => scene.remove(o));
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
