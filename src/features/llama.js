import * as THREE from 'three';
import { createFx } from './fx.js';
import { trackedControllers } from './hands.js';
import { pushOutOfSolids } from './shared.js';

// A fluffy llama that wanders near its spot, grazes, and wanders over when you're close.
// Pet its head, neck or back: it closes its eyes happily, wiggles its ears, prances, and hearts float up.
const HOME = new THREE.Vector3(2.5, 0, 1.8);
const WANDER_RADIUS = 3;
const WALK_SPEED = 0.6;
const CURIOUS_DISTANCE = 3.5;
const PET_RADIUS = 0.3;

function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

export function setup(game) {
  const { scene } = game;
  const fx = createFx(scene);
  const geometries = [];
  const materials = [];
  function mat(color, extra = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...extra });
    materials.push(m);
    return m;
  }
  function add(geo, material, x, y, z, parent) {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const puffGeo = () => new THREE.IcosahedronGeometry(1, 1);

  const wool = mat(0xf7f0e3, { flatShading: true });
  const face = mat(0xfff8ee);
  const dark = mat(0x2a2220, { roughness: 0.4 });
  const white = mat(0xffffff);
  const pinkInner = mat(0xf2a7b5);
  const blush = mat(0xff9fb3, { transparent: true, opacity: 0.75 });
  const hoof = mat(0x5b4636);
  const blanketColors = [0xff6f9c, 0x3cc5c0, 0xffd04d, 0x8a6cf0].map((c) => mat(c));

  // Llama local space: +Z forward, feet at y = 0
  const llama = new THREE.Group();
  const body = new THREE.Group(); // bobs while walking / prancing
  llama.add(body);

  add(puffGeo(), wool, 0, 0.95, 0, body).scale.set(0.27, 0.24, 0.42);
  for (const [x, y, z, s] of [
    [0.13, 1.05, 0.2, 0.13], [-0.13, 1.05, 0.2, 0.13], [0.15, 1.0, -0.15, 0.14], [-0.15, 1.0, -0.15, 0.14],
    [0, 1.12, -0.25, 0.12], [0.18, 0.88, 0.02, 0.12], [-0.18, 0.88, 0.02, 0.12], [0, 0.8, 0.25, 0.12],
  ]) {
    add(puffGeo(), wool, x, y, z, body).scale.setScalar(s);
  }

  // Striped blanket on its back, with tassels
  const blanket = new THREE.Group();
  blanket.position.set(0, 1.17, -0.02);
  body.add(blanket);
  add(new THREE.BoxGeometry(0.42, 0.03, 0.4), blanketColors[0], 0, 0, 0, blanket);
  [-0.12, 0, 0.12].forEach((z, i) => add(new THREE.BoxGeometry(0.43, 0.032, 0.05), blanketColors[i + 1], 0, 0.002, z, blanket));
  for (const x of [-0.21, 0.21]) {
    for (const z of [-0.18, 0, 0.18]) add(new THREE.SphereGeometry(0.022, 8, 6), blanketColors[2], x, -0.05, z, blanket);
  }

  // Legs
  const legs = [];
  for (const [x, z] of [[0.12, 0.24], [-0.12, 0.24], [0.12, -0.24], [-0.12, -0.24]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.78, z);
    body.add(hip);
    add(new THREE.CylinderGeometry(0.04, 0.035, 0.74, 8).translate(0, -0.37, 0), face, 0, 0, 0, hip);
    add(puffGeo(), wool, 0, -0.02, 0, hip).scale.setScalar(0.09);
    add(new THREE.BoxGeometry(0.075, 0.05, 0.09), hoof, 0, -0.75, 0.01, hip);
    legs.push(hip);
  }

  // Tail
  const tail = add(puffGeo(), wool, 0, 1.0, -0.42, body);
  tail.scale.set(0.07, 0.09, 0.07);

  // Long fluffy neck with the head on top
  const neck = new THREE.Group();
  neck.position.set(0, 1.05, 0.3);
  body.add(neck);
  add(new THREE.CylinderGeometry(0.085, 0.1, 0.6, 10).translate(0, 0.3, 0), wool, 0, 0, 0, neck);
  for (const y of [0.1, 0.25, 0.4]) {
    for (const s of [-1, 1]) add(puffGeo(), wool, s * 0.06, y, 0.03, neck).scale.setScalar(0.075);
  }

  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.03);
  neck.add(head);
  add(puffGeo(), face, 0, 0, 0, head).scale.set(0.12, 0.125, 0.14);
  add(new THREE.SphereGeometry(0.075, 14, 10), face, 0, -0.045, 0.12, head).scale.set(1, 0.8, 1); // snout
  add(new THREE.SphereGeometry(0.012, 8, 6), dark, -0.022, -0.025, 0.19, head); // nostrils
  add(new THREE.SphereGeometry(0.012, 8, 6), dark, 0.022, -0.025, 0.19, head);
  for (const [x, y, z, s] of [[0, 0.11, 0, 0.06], [0.05, 0.1, -0.03, 0.05], [-0.05, 0.1, -0.03, 0.05], [0, 0.13, -0.05, 0.045]]) {
    add(puffGeo(), wool, x, y, z, head).scale.setScalar(s); // fluffy tuft
  }
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.065, 0.025, 0.085);
    head.add(eye);
    add(new THREE.SphereGeometry(0.028, 12, 10), dark, 0, 0, 0, eye);
    add(new THREE.SphereGeometry(0.009, 8, 6), white, s * -0.008, 0.01, 0.024, eye); // sparkle
    add(new THREE.BoxGeometry(0.004, 0.014, 0.004), dark, s * 0.02, 0.028, 0.012, eye).rotation.z = s * -0.5; // lash
    eyes.push(eye);
    add(new THREE.SphereGeometry(0.03, 12, 8), blush, s * 0.085, -0.035, 0.07, head).scale.set(1, 0.6, 0.3); // cheek
  }
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.065, 0.1, -0.02);
    ear.rotation.z = s * -0.3;
    head.add(ear);
    add(new THREE.CylinderGeometry(0.022, 0.03, 0.15, 8).translate(0, 0.075, 0), face, 0, 0, 0, ear);
    add(new THREE.BoxGeometry(0.018, 0.1, 0.005), pinkInner, 0, 0.075, 0.022, ear);
    ears.push(ear);
  }

  llama.position.copy(HOME);
  scene.add(llama);

  const headPos = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const headWorld = new THREE.Vector3();
  const neckWorld = new THREE.Vector3();
  const backWorld = new THREE.Vector3();
  const waypoint = HOME.clone();
  const toGoal = new THREE.Vector3();

  let state = 'idle'; // 'idle' | 'walk' | 'graze' | 'curious'
  let stateTime = 2;
  let yaw = Math.PI; // start facing the play area
  let phase = 0;
  let stride = 0;
  let happy = 0;
  let heartTimer = 0;
  let petPulse = 0;
  let prance = 0;
  let stuckTime = 0;

  function pickWaypoint() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * WANDER_RADIUS;
    waypoint.set(HOME.x + Math.cos(angle) * r, 0, HOME.z + Math.sin(angle) * r);
  }

  return {
    update(dt, time) {
      fx.update(dt);
      game.getHeadPosition(headPos);
      const toPlayerX = headPos.x - llama.position.x;
      const toPlayerZ = headPos.z - llama.position.z;
      const playerDist = Math.hypot(toPlayerX, toPlayerZ);

      // Curious about you when you come close
      if (playerDist < CURIOUS_DISTANCE && state !== 'curious') state = 'curious';
      if (state === 'curious' && playerDist > CURIOUS_DISTANCE + 1.5) {
        state = 'idle';
        stateTime = 1;
      }

      stateTime -= dt;
      let walking = false;
      let desiredYaw = yaw;
      let grazing = false;

      if (state === 'curious') {
        desiredYaw = Math.atan2(toPlayerX, toPlayerZ);
        if (playerDist > 1.2) {
          toGoal.set(toPlayerX, 0, toPlayerZ).normalize();
          llama.position.addScaledVector(toGoal, WALK_SPEED * 1.2 * dt);
          walking = true;
        }
      } else if (state === 'walk') {
        toGoal.subVectors(waypoint, llama.position).setY(0);
        const dist = toGoal.length();
        if (dist < 0.15 || stateTime <= 0) {
          state = Math.random() < 0.6 ? 'graze' : 'idle';
          stateTime = 3 + Math.random() * 3;
        } else {
          desiredYaw = Math.atan2(toGoal.x, toGoal.z);
          if (Math.abs(Math.atan2(Math.sin(desiredYaw - yaw), Math.cos(desiredYaw - yaw))) < 0.7) {
            llama.position.addScaledVector(toGoal.normalize(), Math.min(WALK_SPEED * dt, dist));
            walking = true;
          }
        }
      } else {
        grazing = state === 'graze';
        if (stateTime <= 0) {
          pickWaypoint();
          state = 'walk';
          stateTime = 10;
        }
      }

      // Walls are solid; give up on a blocked waypoint
      if (pushOutOfSolids(llama.position, 0.4, 0.05, 1.8)) {
        stuckTime += dt;
        if (stuckTime > 1.5 && state === 'walk') {
          pickWaypoint();
          stuckTime = 0;
        }
      } else {
        stuckTime = 0;
      }

      yaw = lerpAngle(yaw, desiredYaw, 1 - Math.exp(-3 * dt));
      llama.rotation.y = yaw;

      // Petting: a hand near its head, neck or back
      head.getWorldPosition(headWorld);
      neck.localToWorld(neckWorld.set(0, 0.3, 0.05));
      backWorld.copy(llama.position).setY(1.18);
      let petting = false;
      for (const controller of trackedControllers(game)) {
        controller.getWorldPosition(handPos);
        if (handPos.distanceTo(headWorld) < PET_RADIUS || handPos.distanceTo(neckWorld) < PET_RADIUS || handPos.distanceTo(backWorld) < PET_RADIUS + 0.1) {
          petting = true;
          petPulse -= dt;
          if (petPulse <= 0) {
            game.pulse(controller, 0.15, 30);
            petPulse = 0.15;
          }
        }
      }
      if (petting) {
        if (happy === 0) prance = 1;
        happy = 1.5;
        heartTimer -= dt;
        if (heartTimer <= 0) {
          fx.heart(headWorld.clone().add(new THREE.Vector3(0, 0.12, 0)));
          heartTimer = 0.2;
        }
      }
      happy = Math.max(0, happy - dt);
      const isHappy = happy > 0;

      // Legs: walking gait, or a happy little prance in place
      stride = THREE.MathUtils.damp(stride, walking ? 1 : 0, 6, dt);
      phase += dt * (5 * stride + (isHappy ? 9 : 0));
      const swing = Math.sin(phase) * 0.45 * Math.max(stride, isHappy ? 0.4 : 0);
      legs[0].rotation.x = swing;
      legs[3].rotation.x = swing;
      legs[1].rotation.x = -swing;
      legs[2].rotation.x = -swing;
      prance = Math.max(0, prance - dt * 1.5);
      body.position.y = Math.abs(Math.sin(phase)) * (0.02 * stride + (isHappy ? 0.04 : 0)) + Math.sin(prance * Math.PI) * 0.12;

      // Neck: graze (head to the ground), or look toward you / straight ahead
      const lookYaw = state === 'curious' || isHappy ? Math.atan2(Math.sin(Math.atan2(toPlayerX, toPlayerZ) - yaw), Math.cos(Math.atan2(toPlayerX, toPlayerZ) - yaw)) : Math.sin(time * 0.4) * 0.3;
      neck.rotation.y = THREE.MathUtils.damp(neck.rotation.y, THREE.MathUtils.clamp(lookYaw, -0.9, 0.9), 4, dt);
      const neckPitch = grazing ? 1.75 : isHappy ? -0.1 : 0.12;
      neck.rotation.x = THREE.MathUtils.damp(neck.rotation.x, neckPitch, 3, dt);
      // Keep the face level-ish, and chew while grazing
      head.rotation.x = THREE.MathUtils.damp(head.rotation.x, grazing ? -0.6 + Math.sin(time * 8) * 0.06 : -neck.rotation.x * 0.6, 4, dt);
      head.rotation.z = isHappy ? Math.sin(time * 4) * 0.2 : Math.sin(time * 0.9) * 0.05;

      // Happy face: eyes squeeze shut into smiles, ears wiggle; tail swishes
      for (const eye of eyes) eye.scale.y = THREE.MathUtils.damp(eye.scale.y, isHappy ? 0.2 : (time % 4 < 0.12 ? 0.15 : 1), 20, dt);
      ears.forEach((ear, i) => {
        const s = i === 0 ? -1 : 1;
        ear.rotation.z = s * -0.3 + (isHappy ? Math.sin(time * 14 + i) * 0.35 : Math.sin(time * 1.3 + i) * 0.05);
      });
      tail.rotation.y = Math.sin(time * (isHappy ? 12 : 2)) * (isHappy ? 0.6 : 0.2);
    },

    dispose() {
      fx.dispose();
      scene.remove(llama);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
