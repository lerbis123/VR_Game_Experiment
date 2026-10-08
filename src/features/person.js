import * as THREE from 'three';
import { createFx } from './fx.js';
import { pushOutOfSolids } from './shared.js';

// A person who wanders around the field and stops to wave when you get close.
// Hit them (cube, arrow, bullet, sword) and they get knocked over cartoon-style,
// see stars, then get up and run away from you.
const WALK_SPEED = 1.2;
const FLEE_SPEED = 3.2;
const GREET_DISTANCE = 2.5;
const GREET_TIME = 2.5;
const GREET_COOLDOWN = 10;
const DOWN_TIME = 2.8;
const GETUP_TIME = 0.6;
const FLEE_TIME = 3;
const HIT_WORDS = ['POW!', 'BONK!', 'OOF!', 'WHAM!', 'OUCH!', 'ZAP!'];

function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

function randomWaypoint(out) {
  const angle = Math.random() * Math.PI * 2;
  const r = THREE.MathUtils.randFloat(3, 12);
  return out.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
}

export function setup(game) {
  const { scene } = game;
  const fx = createFx(scene);
  const geometries = [];
  const materials = [];
  function mat(color, roughness = 0.85) {
    const m = new THREE.MeshStandardMaterial({ color, roughness });
    materials.push(m);
    return m;
  }
  function part(geo, material, x, y, z, parent) {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const shirtColors = [0xd94f3d, 0x3d8bd9, 0x46b36a, 0xe0a030, 0x8e5bd1];
  const skin = mat(0xe8b896);
  const shirt = mat(shirtColors[Math.floor(Math.random() * shirtColors.length)]);
  const pants = mat(0x2b3a55);
  const shoes = mat(0x1a1a1a);
  const hair = mat(0x3b2516);

  // Person local space: +Z forward, feet at y = 0. The body pivots at the feet so it can fall over.
  const person = new THREE.Group();
  const body = new THREE.Group();
  person.add(body);

  part(new THREE.BoxGeometry(0.4, 0.6, 0.22), shirt, 0, 1.2, 0, body); // torso
  part(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), skin, 0, 1.53, 0, body); // neck
  const head = new THREE.Group();
  head.position.set(0, 1.66, 0);
  body.add(head);
  part(new THREE.SphereGeometry(0.12, 16, 12), skin, 0, 0, 0, head);
  part(new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 0.01, -0.01, head);
  const eyes = [];
  for (const s of [-1, 1]) eyes.push(part(new THREE.SphereGeometry(0.015, 8, 6), shoes, s * 0.04, 0.02, 0.11, head));

  function limb(x, y, length, width, material, endMaterial) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    body.add(pivot);
    part(new THREE.BoxGeometry(width, length, width + 0.02), material, 0, -length / 2, 0, pivot);
    part(new THREE.BoxGeometry(width + 0.01, 0.06, width + 0.08), endMaterial, 0, -length + 0.03, 0.03, pivot);
    return pivot;
  }
  const leftLeg = limb(0.1, 0.9, 0.9, 0.13, pants, shoes);
  const rightLeg = limb(-0.1, 0.9, 0.9, 0.13, pants, shoes);
  const leftArm = limb(0.26, 1.47, 0.62, 0.09, shirt, skin);
  const rightArm = limb(-0.26, 1.47, 0.62, 0.09, shirt, skin); // -X is their right when facing +Z

  // What weapons and thrown things collide with
  const hitbox = new THREE.Object3D();
  hitbox.position.set(0, 1.1, 0);
  person.add(hitbox);

  // Dizzy stars that circle their head while they're down
  const starGeo = new THREE.OctahedronGeometry(0.035, 0);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, fog: false });
  geometries.push(starGeo);
  materials.push(starMat);
  const stars = [0, 1, 2].map(() => {
    const star = new THREE.Mesh(starGeo, starMat);
    star.visible = false;
    scene.add(star);
    return star;
  });

  randomWaypoint(person.position);
  scene.add(person);

  const waypoint = randomWaypoint(new THREE.Vector3());
  const toWaypoint = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const hitPos = new THREE.Vector3();
  const headWorld = new THREE.Vector3();
  let state = 'walk'; // 'walk' | 'pause' | 'greet' | 'down' | 'getup' | 'flee'
  let stateTime = 0;
  let greetCooldown = 0;
  let yaw = 0;
  let phase = 0;
  let stride = 0; // 0 = standing, 1 = full walk cycle
  let knock = 0; // 0 = standing, 1 = flat on their back
  let stuckTime = 0;

  const removeHittable = game.addHittable({
    object: hitbox,
    radius: 0.45,
    onHit(controller) {
      hitbox.getWorldPosition(hitPos);
      fx.sparkBurst(hitPos, 18, 3.5);
      fx.popup(HIT_WORDS[Math.floor(Math.random() * HIT_WORDS.length)], hitPos.clone().add(new THREE.Vector3(0, 0.8, 0)));
      if (controller) game.pulse(controller, 1.0, 150);

      // Snap to face you so they fall backward, away from you
      game.getHeadPosition(headPos);
      yaw = Math.atan2(headPos.x - person.position.x, headPos.z - person.position.z);
      state = 'down';
      stateTime = DOWN_TIME;
      hitbox.visible = false; // can't be hit again while down
    },
  });

  return {
    update(dt, time) {
      fx.update(dt);
      game.getHeadPosition(headPos);
      const toPlayerX = headPos.x - person.position.x;
      const toPlayerZ = headPos.z - person.position.z;
      const playerDist = Math.hypot(toPlayerX, toPlayerZ);
      const yawToPlayer = Math.atan2(toPlayerX, toPlayerZ);

      greetCooldown -= dt;
      stateTime -= dt;

      if ((state === 'walk' || state === 'pause') && playerDist < GREET_DISTANCE && greetCooldown <= 0) {
        state = 'greet';
        stateTime = GREET_TIME;
      }

      let desiredYaw = yaw;
      let walking = false;
      let moveSpeed = WALK_SPEED;

      if (state === 'walk') {
        toWaypoint.subVectors(waypoint, person.position);
        toWaypoint.y = 0;
        const dist = toWaypoint.length();
        if (dist < 0.2) {
          state = 'pause';
          stateTime = THREE.MathUtils.randFloat(1, 3);
        } else {
          desiredYaw = Math.atan2(toWaypoint.x, toWaypoint.z);
          // Only walk once mostly facing the right way
          if (Math.abs(Math.atan2(Math.sin(desiredYaw - yaw), Math.cos(desiredYaw - yaw))) < 0.6) {
            person.position.addScaledVector(toWaypoint.normalize(), Math.min(WALK_SPEED * dt, dist));
            walking = true;
          }
        }
      } else if (state === 'pause') {
        if (stateTime <= 0) {
          randomWaypoint(waypoint);
          state = 'walk';
        }
      } else if (state === 'greet') {
        desiredYaw = yawToPlayer;
        if (stateTime <= 0) {
          greetCooldown = GREET_COOLDOWN;
          state = 'walk';
        }
      } else if (state === 'down') {
        knock = Math.min(1, knock + dt * 5);
        if (stateTime <= 0) {
          state = 'getup';
          stateTime = GETUP_TIME;
        }
      } else if (state === 'getup') {
        knock = Math.max(0, stateTime / GETUP_TIME);
        if (stateTime <= 0) {
          knock = 0;
          state = 'flee';
          stateTime = FLEE_TIME;
          hitbox.visible = true;
        }
      } else if (state === 'flee') {
        // Run directly away from you
        desiredYaw = yawToPlayer + Math.PI;
        moveSpeed = FLEE_SPEED;
        person.position.x += Math.sin(yaw) * FLEE_SPEED * dt;
        person.position.z += Math.cos(yaw) * FLEE_SPEED * dt;
        if (person.position.length() > 18) person.position.setLength(18);
        walking = true;
        if (stateTime <= 0) {
          randomWaypoint(waypoint);
          greetCooldown = 15; // still upset with you
          state = 'walk';
        }
      }

      // Walls are solid; if one keeps blocking the way, pick somewhere else to go
      if (pushOutOfSolids(person.position, 0.3, 0.05, 1.8)) {
        stuckTime += dt;
        if (stuckTime > 1.5 && state === 'walk') {
          randomWaypoint(waypoint);
          stuckTime = 0;
        }
      } else {
        stuckTime = 0;
      }

      const fallen = state === 'down' || state === 'getup';
      if (!fallen) yaw = lerpAngle(yaw, desiredYaw, 1 - Math.exp(-(state === 'flee' ? 10 : 5) * dt));
      person.rotation.y = yaw;

      // Fall over backward, pivoting at the feet
      body.rotation.x = -knock * Math.PI * 0.48;

      // Walk cycle: legs and arms swing opposite each other
      stride = THREE.MathUtils.damp(stride, walking ? 1 : 0, 8, dt);
      phase += dt * (moveSpeed > WALK_SPEED ? 13 : 7) * stride;
      const swing = Math.sin(phase) * (moveSpeed > WALK_SPEED ? 0.8 : 0.5) * stride;
      leftLeg.rotation.x = fallen ? 0 : swing;
      rightLeg.rotation.x = fallen ? 0 : -swing;
      body.position.y = Math.abs(Math.cos(phase)) * 0.03 * stride;

      if (fallen) {
        // Arms flung out to the sides
        leftArm.rotation.set(0, 0, THREE.MathUtils.damp(leftArm.rotation.z, 1.3, 10, dt));
        rightArm.rotation.set(0, 0, THREE.MathUtils.damp(rightArm.rotation.z, -1.3, 10, dt));
      } else if (state === 'flee') {
        // Arms waving in the air while running away
        leftArm.rotation.set(0, 0, 2.6 + Math.sin(time * 14) * 0.4);
        rightArm.rotation.set(0, 0, -2.6 + Math.sin(time * 14 + 1.5) * 0.4);
      } else if (state === 'greet') {
        leftArm.rotation.set(-swing * 0.8, 0, THREE.MathUtils.damp(leftArm.rotation.z, 0, 8, dt));
        rightArm.rotation.x = THREE.MathUtils.damp(rightArm.rotation.x, 0, 10, dt);
        rightArm.rotation.z = THREE.MathUtils.damp(rightArm.rotation.z, -2.6 + Math.sin(time * 9) * 0.35, 12, dt);
      } else {
        leftArm.rotation.set(-swing * 0.8, 0, THREE.MathUtils.damp(leftArm.rotation.z, 0, 8, dt));
        rightArm.rotation.set(swing * 0.8, 0, THREE.MathUtils.damp(rightArm.rotation.z, 0, 8, dt));
      }

      // Eyes squash into lines while dazed
      for (const eye of eyes) eye.scale.y = state === 'down' ? 0.25 : 1;

      // Dizzy stars orbit the head while they're on the ground
      head.getWorldPosition(headWorld);
      stars.forEach((star, i) => {
        star.visible = state === 'down';
        const a = time * 5 + (i * Math.PI * 2) / stars.length;
        star.position.set(headWorld.x + Math.cos(a) * 0.18, headWorld.y + 0.18, headWorld.z + Math.sin(a) * 0.18);
        star.rotation.y = time * 6;
      });

      // Look at you when you're nearby
      const lookAtPlayer = playerDist < 5 && !fallen ? 1 : 0;
      const headTurn = Math.atan2(Math.sin(yawToPlayer - yaw), Math.cos(yawToPlayer - yaw));
      head.rotation.y = THREE.MathUtils.damp(head.rotation.y, THREE.MathUtils.clamp(headTurn, -1.1, 1.1) * lookAtPlayer, 6, dt);
    },

    dispose() {
      removeHittable();
      fx.dispose();
      scene.remove(person, ...stars);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
