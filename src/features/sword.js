import * as THREE from 'three';
import { createFx } from './fx.js';
import { createDropper, gripOf, holdInGrip, releaseFromGrip } from './hands.js';
import { blades, solidCorrection } from './shared.js';

// A sword stuck in the ground left of the gun stand. Grab it (grip or trigger) and swing:
// a fast enough swing hits targets and the person, with sparks and a glowing trail.
// Let go and it falls where you drop it (switch it off and on to reset it).
const REST_POS = new THREE.Vector3(-1.5, 1.0, -0.6);
const BLADE_START = 0.1; // along -Z from the palm (grip space: -Z leaves the thumb side of your fist)
const BLADE_END = 1.02;
const MIN_SWING_SPEED = 2.0; // tip speed (m/s) needed to land a hit
const HIT_COOLDOWN = 0.4; // per target, so one swing counts once
const TRAIL_SAMPLES = 14;

export function setup(game) {
  const { scene } = game;
  const fx = createFx(scene);
  const geometries = [];
  const materials = [];

  function add(geo, material, x, y, z, parent) {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const steel = new THREE.MeshStandardMaterial({ color: 0xdde6f0, metalness: 0.9, roughness: 0.2, emissive: 0x3a6dff, emissiveIntensity: 0.15 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a437, metalness: 0.8, roughness: 0.3 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.9 });
  materials.push(steel, gold, leather);

  // Sword local space: handle centered in your palm, blade toward -Z
  const sword = new THREE.Group();
  add(new THREE.CylinderGeometry(0.016, 0.018, 0.18, 10).rotateX(Math.PI / 2), leather, 0, 0, 0, sword); // handle
  add(new THREE.SphereGeometry(0.026, 12, 8), gold, 0, 0, 0.1, sword); // pommel
  add(new THREE.BoxGeometry(0.17, 0.025, 0.03), gold, 0, 0, -0.09, sword); // crossguard
  const bladeLength = BLADE_END - BLADE_START - 0.08;
  add(new THREE.BoxGeometry(0.045, 0.008, bladeLength), steel, 0, 0, -(BLADE_START + bladeLength / 2), sword);
  const tipGeo = new THREE.ConeGeometry(0.0225, 0.08, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.18, 1);
  add(tipGeo, steel, 0, 0, -(BLADE_END - 0.04), sword);

  // Glowing swing trail: a ribbon between recent blade-base and blade-tip positions
  const trailPositions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
  const trailColors = new Float32Array(TRAIL_SAMPLES * 2 * 3);
  const trailIndex = [];
  for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
    const a = i * 2;
    trailIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  trailGeo.setIndex(trailIndex);
  const trailMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  geometries.push(trailGeo);
  materials.push(trailMat);
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);
  const trailBase = Array.from({ length: TRAIL_SAMPLES }, () => new THREE.Vector3());
  const trailTip = Array.from({ length: TRAIL_SAMPLES }, () => new THREE.Vector3());

  function stickInGround() {
    scene.add(sword);
    sword.position.copy(REST_POS);
    sword.rotation.set(-Math.PI / 2, 0, 0); // blade straight down
  }
  stickInGround();

  let heldBy = null;
  let hasPrevTip = false;
  const dropper = createDropper(scene);
  const flatEuler = new THREE.Euler();
  const lieFlat = (yaw, out) => out.setFromEuler(flatEuler.set(0, yaw, 0)); // blade flat on the ground

  // Registered while held so enemy blades can clash with it and push it back
  const blade = { controller: null, base: new THREE.Vector3(), tip: new THREE.Vector3(), correction: new THREE.Vector3() };
  const contactOffset = new THREE.Vector3(); // how far the blade is being held back from your hand
  const gripQuat = new THREE.Quaternion();
  const MAX_PUSH = 0.35;
  const wallPush = new THREE.Vector3();
  const wallFix = new THREE.Vector3();
  const bladePoint = new THREE.Vector3();
  const base = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const prevTip = new THREE.Vector3();
  const center = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const bladeLine = new THREE.Line3();
  const sweepLine = new THREE.Line3();
  const lastHit = new Map(); // hittable -> time

  const removeGrabbable = game.addGrabbable({
    object: sword,
    radius: 0.25,
    onGrab(controller) {
      heldBy = controller;
      dropper.pickUp(sword);
      holdInGrip(game, controller, sword);
      hasPrevTip = false;
      blade.controller = controller;
      blade.correction.set(0, 0, 0);
      contactOffset.set(0, 0, 0);
      blades.add(blade);
    },
    onRelease(controller) {
      heldBy = null;
      blades.delete(blade);
      releaseFromGrip(game, controller);
      dropper.drop(sword, controller, { restY: 0.03, restQuat: lieFlat }); // stays where it lands
    },
  });

  return {
    update(dt, time) {
      fx.update(dt);
      dropper.update(dt);
      if (heldBy) dropper.track(heldBy, time);

      if (!heldBy) {
        trailMat.opacity = THREE.MathUtils.damp(trailMat.opacity, 0, 10, dt);
        return;
      }

      // Resistance: when an enemy blade pushes ours, hold the sword back from the hand
      // (it springs back to the hand once the blades separate)
      if (blade.correction.lengthSq() > 0) {
        contactOffset.add(blade.correction);
        if (contactOffset.length() > MAX_PUSH) contactOffset.setLength(MAX_PUSH);
        blade.correction.set(0, 0, 0);
      } else {
        contactOffset.multiplyScalar(Math.exp(-12 * dt));
      }
      gripOf(game, heldBy).getWorldQuaternion(gripQuat).invert();
      sword.position.copy(contactOffset).applyQuaternion(gripQuat);

      sword.updateWorldMatrix(true, false);
      sword.localToWorld(base.set(0, 0, -BLADE_START));
      sword.localToWorld(tip.set(0, 0, -BLADE_END));
      blade.base.copy(base);
      blade.tip.copy(tip);

      // Walls stop the blade: push it back out of any building block it's sunk into
      wallPush.set(0, 0, 0);
      for (let i = 0; i <= 5; i++) {
        bladePoint.lerpVectors(base, tip, i / 5);
        if (solidCorrection(bladePoint, 0.02, wallFix) && wallFix.lengthSq() > wallPush.lengthSq()) wallPush.copy(wallFix);
      }
      if (wallPush.lengthSq() > 0) {
        blade.correction.add(wallPush);
        game.pulse(heldBy, 0.3, 20);
      }
      const tipSpeed = hasPrevTip ? tip.distanceTo(prevTip) / Math.max(dt, 1e-3) : 0;

      // Hit test the blade, plus the arc the tip swept this frame so fast swings can't skip through
      if (hasPrevTip && tipSpeed > MIN_SWING_SPEED) {
        bladeLine.set(base, tip);
        sweepLine.set(prevTip, tip);
        for (const h of [...(game.hittables ?? [])]) {
          if (!h.object.visible) continue;
          if (time - (lastHit.get(h) ?? -Infinity) < HIT_COOLDOWN) continue;
          h.object.getWorldPosition(center);
          bladeLine.closestPointToPoint(center, true, closest);
          let d = closest.distanceTo(center);
          if (d >= h.radius) {
            sweepLine.closestPointToPoint(center, true, closest);
            d = closest.distanceTo(center);
          }
          if (d < h.radius) {
            lastHit.set(h, time);
            fx.sparkBurst(closest, 12, 2.5);
            game.pulse(heldBy, 1.0, 90);
            h.onHit(heldBy);
          }
        }
      }
      prevTip.copy(tip);

      // Trail: shift samples back, newest at the front; fade toward the end
      for (let i = TRAIL_SAMPLES - 1; i > 0; i--) {
        trailBase[i].copy(trailBase[i - 1]);
        trailTip[i].copy(trailTip[i - 1]);
      }
      trailBase[0].copy(base);
      trailTip[0].copy(tip);
      if (!hasPrevTip) {
        trailBase.forEach((v) => v.copy(base));
        trailTip.forEach((v) => v.copy(tip));
      }
      hasPrevTip = true;
      for (let i = 0; i < TRAIL_SAMPLES; i++) {
        trailBase[i].toArray(trailPositions, i * 6);
        trailTip[i].toArray(trailPositions, i * 6 + 3);
        const fade = 1 - i / (TRAIL_SAMPLES - 1);
        trailColors.set([0.1 * fade, 0.25 * fade, 0.6 * fade, 0.4 * fade, 0.7 * fade, 1.0 * fade], i * 6);
      }
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.color.needsUpdate = true;
      const targetOpacity = THREE.MathUtils.clamp((tipSpeed - 1.5) / 4, 0, 0.9);
      trailMat.opacity = THREE.MathUtils.damp(trailMat.opacity, targetOpacity, 12, dt);
    },

    dispose() {
      blades.delete(blade);
      if (heldBy) releaseFromGrip(game, heldBy);
      removeGrabbable();
      fx.dispose();
      sword.removeFromParent();
      scene.remove(trail);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
