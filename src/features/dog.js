import * as THREE from 'three';
import { trackedControllers } from './hands.js';
import { pushOutOfSolids } from './shared.js';

// A little dog that trots after you, looks up at you, and loves being petted.
// Lower a controller toward the floor and it comes over to your hand.
const FOLLOW_FORWARD = 0.7; // where it likes to stand, relative to you
const FOLLOW_SIDE = -0.7; // negative = your left
const MAX_SPEED = 3.2;
const PET_RADIUS = 0.35;
const CALL_HEIGHT = 0.6; // a hand lower than this (reach down / crouch) calls the dog over
const CALL_RANGE = 3;
const UP = new THREE.Vector3(0, 1, 0);

function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

function makeHeartTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ff4f7b';
  c.beginPath();
  c.moveTo(32, 56);
  c.bezierCurveTo(4, 36, 6, 8, 32, 20);
  c.bezierCurveTo(58, 8, 60, 36, 32, 56);
  c.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function setup(game) {
  const { scene } = game;

  const coat = new THREE.MeshStandardMaterial({ color: 0xc8873a, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x7a4a1f, roughness: 0.9 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf2e2c8, roughness: 0.9 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xff7b9c });
  const materials = [coat, dark, cream, black, pink];
  const geometries = [];

  function box(w, h, d, mat, x, y, z, parent) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // Dog local space: +Z is the nose direction, y = 0 is the floor.
  const dog = new THREE.Group();
  const body = new THREE.Group();
  dog.add(body);
  box(0.18, 0.16, 0.38, coat, 0, 0.27, 0, body);

  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.2);
  body.add(head);
  box(0.16, 0.15, 0.16, coat, 0, 0, 0, head);
  box(0.09, 0.07, 0.1, cream, 0, -0.03, 0.11, head);
  box(0.04, 0.03, 0.02, black, 0, -0.01, 0.165, head);
  const tongue = box(0.035, 0.01, 0.05, pink, 0, -0.07, 0.13, head);
  const ears = [];
  for (const s of [-1, 1]) {
    box(0.025, 0.025, 0.01, black, s * 0.045, 0.03, 0.081, head);
    const ear = box(0.045, 0.09, 0.05, dark, s * 0.07, 0.07, -0.02, head);
    ear.rotation.z = s * 0.25;
    ears.push(ear);
  }

  const legs = [];
  for (const [x, z] of [[-0.06, 0.14], [0.06, 0.14], [-0.06, -0.14], [0.06, -0.14]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.2, z);
    body.add(hip);
    box(0.05, 0.2, 0.05, coat, 0, -0.1, 0, hip);
    box(0.055, 0.03, 0.06, cream, 0, -0.185, 0.005, hip);
    legs.push(hip);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.32, -0.19);
  tail.rotation.x = 0.7;
  body.add(tail);
  box(0.03, 0.03, 0.15, dark, 0, 0, -0.075, tail);

  dog.position.set(-0.8, 0, -0.2);
  scene.add(dog);

  // Hearts that float up while you pet it
  const heartTex = makeHeartTexture();
  const hearts = [];
  function spawnHeart(at) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
    sprite.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.1, (Math.random() - 0.5) * 0.15));
    sprite.scale.setScalar(0.08);
    scene.add(sprite);
    hearts.push({ sprite, t: 0, drift: (Math.random() - 0.5) * 0.2 });
  }

  const headPos = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const goal = new THREE.Vector3();
  const toGoal = new THREE.Vector3();
  const dogHead = new THREE.Vector3();
  const dogBack = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const callPos = new THREE.Vector3();

  let speed = 0;
  let phase = 0;
  let yaw = 0;
  let petTime = 0;
  let petPulse = 0;
  let heartTimer = 0;
  let wasPetting = false;
  let hopY = 0;
  let hopV = 0;

  return {
    update(dt, time) {
      game.getHeadPosition(headPos);

      // Is a hand down low nearby, calling the dog over?
      let calledBy = null;
      for (const controller of trackedControllers(game)) {
        controller.getWorldPosition(handPos);
        const flat = Math.hypot(handPos.x - dog.position.x, handPos.z - dog.position.z);
        if (handPos.y < CALL_HEIGHT && flat < CALL_RANGE) {
          calledBy = controller;
          callPos.set(handPos.x, 0, handPos.z);
          break;
        }
      }

      if (calledBy) {
        goal.copy(callPos);
      } else {
        // Default spot: in front of you, off to one side
        game.camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
        forward.normalize();
        right.crossVectors(forward, UP);
        goal.set(headPos.x, 0, headPos.z).addScaledVector(forward, FOLLOW_FORWARD).addScaledVector(right, FOLLOW_SIDE);
      }

      toGoal.subVectors(goal, dog.position);
      toGoal.y = 0;
      let dist = toGoal.length();
      if (dist > 15) {
        dog.position.copy(goal); // got left behind: catch up instantly
        dist = 0;
      }

      const arriveAt = calledBy ? 0.2 : 0.35;
      const targetSpeed = dist > arriveAt ? Math.min(MAX_SPEED, dist * 1.8) : 0;
      speed = THREE.MathUtils.damp(speed, targetSpeed, 6, dt);
      if (dist > 1e-3 && speed > 0.01) {
        dog.position.addScaledVector(toGoal.normalize(), Math.min(speed * dt, dist));
      }
      pushOutOfSolids(dog.position, 0.2, 0.05, 0.45); // walls are solid

      // Face where it's running, or turn toward your hand / face when stopped
      let desiredYaw;
      if (speed > 0.2) {
        desiredYaw = Math.atan2(toGoal.x, toGoal.z);
      } else if (calledBy) {
        desiredYaw = Math.atan2(callPos.x - dog.position.x, callPos.z - dog.position.z);
      } else {
        desiredYaw = Math.atan2(headPos.x - dog.position.x, headPos.z - dog.position.z);
      }
      if (!calledBy || Math.hypot(callPos.x - dog.position.x, callPos.z - dog.position.z) > 0.1) {
        yaw = lerpAngle(yaw, desiredYaw, 1 - Math.exp(-8 * dt));
      }
      dog.rotation.y = yaw;

      // Trot: diagonal leg pairs swing together
      const gait = Math.min(speed / 1.5, 1);
      phase += dt * (6 + speed * 5);
      const swing = Math.sin(phase) * 0.7 * gait;
      legs[0].rotation.x = swing;
      legs[3].rotation.x = swing;
      legs[1].rotation.x = -swing;
      legs[2].rotation.x = -swing;

      // Petting: a controller near its head or back
      head.getWorldPosition(dogHead);
      dogBack.copy(dog.position).setY(0.32);
      let petting = false;
      for (const controller of trackedControllers(game)) {
        controller.getWorldPosition(handPos);
        if (handPos.distanceTo(dogHead) < PET_RADIUS || handPos.distanceTo(dogBack) < PET_RADIUS) {
          petting = true;
          petPulse -= dt;
          if (petPulse <= 0) {
            game.pulse(controller, 0.15, 30);
            petPulse = 0.15;
          }
        }
      }
      if (petting && !wasPetting && hopY === 0) hopV = 1.4; // happy hop
      wasPetting = petting;
      if (petting) {
        petTime = 1.5;
        heartTimer -= dt;
        if (heartTimer <= 0) {
          spawnHeart(dogHead);
          heartTimer = 0.25;
        }
      }
      petTime = Math.max(0, petTime - dt);

      hopV -= 9.8 * dt;
      hopY = Math.max(0, hopY + hopV * dt);
      if (hopY === 0) hopV = 0;
      body.position.y = Math.abs(Math.sin(phase)) * 0.025 * gait + hopY;

      const happy = petTime > 0;
      tongue.visible = happy || speed > 1.5;
      const wagSpeed = happy ? 20 : 9;
      const wagAmount = happy ? 0.9 : 0.4;
      tail.rotation.y = Math.sin(time * wagSpeed) * wagAmount;
      // Ears flop back when happy
      for (const [i, ear] of ears.entries()) {
        ear.rotation.x = THREE.MathUtils.damp(ear.rotation.x, happy ? -0.6 : 0, 8, dt);
        ear.rotation.z = (i === 0 ? -1 : 1) * 0.25;
      }

      // Look up at your face (or lean into your hand) and tilt its head
      const idle = 1 - gait;
      const lookTarget = calledBy && !petting ? handPos.copy(callPos).setY(0.6) : headPos;
      const flat = Math.hypot(lookTarget.x - dogHead.x, lookTarget.z - dogHead.z);
      const pitch = THREE.MathUtils.clamp(Math.atan2(lookTarget.y - dogHead.y, flat), -0.2, 0.8);
      head.rotation.x = THREE.MathUtils.damp(head.rotation.x, -pitch * idle, 5, dt);
      const tilt = happy ? Math.sin(time * 3) * 0.3 : Math.sin(time * 1.3) * 0.15;
      head.rotation.z = tilt * idle;

      for (let i = hearts.length - 1; i >= 0; i--) {
        const h = hearts[i];
        h.t += dt;
        h.sprite.position.y += dt * 0.35;
        h.sprite.position.x += h.drift * dt;
        h.sprite.material.opacity = Math.max(0, 1 - h.t / 1.2);
        h.sprite.scale.setScalar(0.08 + h.t * 0.04);
        if (h.t > 1.2) {
          scene.remove(h.sprite);
          h.sprite.material.dispose();
          hearts.splice(i, 1);
        }
      }
    },

    dispose() {
      scene.remove(dog);
      hearts.forEach((h) => {
        scene.remove(h.sprite);
        h.sprite.material.dispose();
      });
      heartTex.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
