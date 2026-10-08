import * as THREE from 'three';
import { createFx } from './fx.js';
import { blades, closestSegmentPoints, pushOutOfSolids } from './shared.js';
import { addAction, isEnabled, setEnabled } from './toggles.js';

// Sword fighters you spawn from the control panel. They walk up, hold a guard, then wind up
// (blade glows red) and swing: overhead chop, cuts from either side, or a thrust.
// Block with your sword: the blades clash, your sword is pushed back (resistance),
// and a blocked swing staggers them. Take 3 hits to defeat one (a missile does it in one).
export const switchable = false; // always loaded; it only adds panel buttons

const MAX_FIGHTERS = 3;
const MAX_HP = 3;
const REACH = 1.2; // preferred fighting distance
const WALK_SPEED = 1.3;
const BLADE_START = 0.1;
const BLADE_LEN = 0.85;
const BLADE_RADIUS = 0.025; // collision thickness of each blade
const BODY_RADIUS = 0.22; // your body, as a capsule from head to hips
const T_WIND = 0.55;
const T_HOLD = 0.22;
const T_SWING = 0.3;
const T_RECOVER = 0.55;
const T_STAGGER = 0.9;
const HIT_WORDS = ['CLANG!', 'BONK!', 'WHAM!', 'OOF!'];

const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
function pose(x, y, z, dx, dy, dz) {
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  return { hand: new THREE.Vector3(x, y, z), quat: new THREE.Quaternion().setFromUnitVectors(Z, dir) };
}

// Sword poses in the fighter's local space: +Z faces you, -X is their right (sword) side
const GUARD = pose(-0.22, 1.15, 0.35, 0.15, 0.8, 0.55);
const STAGGERED = pose(-0.4, 1.05, 0.05, -0.6, 0.6, -0.4);
const ATTACKS = [
  // Overhead chop
  [pose(-0.12, 1.75, 0.0, 0, 0.75, -0.65), pose(-0.1, 1.6, 0.4, 0, 0.4, 0.9), pose(-0.05, 1.0, 0.55, 0, -0.5, 0.85)],
  // Forehand cut (from their right)
  [pose(-0.5, 1.4, 0.05, -0.75, 0.25, -0.6), pose(-0.1, 1.35, 0.5, 0, 0.1, 1), pose(0.35, 1.25, 0.35, 0.8, 0, 0.55)],
  // Backhand cut (from their left)
  [pose(0.3, 1.4, 0.1, 0.75, 0.25, -0.6), pose(0.05, 1.35, 0.5, 0, 0.1, 1), pose(-0.4, 1.25, 0.35, -0.8, 0, 0.55)],
  // Thrust
  [pose(-0.2, 1.3, -0.05, 0, 0.05, 1), pose(-0.15, 1.35, 0.35, 0, 0, 1), pose(-0.1, 1.4, 0.75, 0, 0, 1)],
];

function lerpPose(a, b, t, out) {
  out.hand.lerpVectors(a.hand, b.hand, t);
  out.quat.slerpQuaternions(a.quat, b.quat, t);
  return out;
}
function copyPose(from, to) {
  to.hand.copy(from.hand);
  to.quat.copy(from.quat);
  return to;
}
const easeInOut = (t) => t * t * (3 - 2 * t);

function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

export function setup(game) {
  const { scene } = game;
  const fx = createFx(scene);
  const geometries = [];
  const materials = [];
  function geo(g) {
    geometries.push(g);
    return g;
  }
  function mat(color, extra = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
    materials.push(m);
    return m;
  }

  const skin = mat(0xe0ac88);
  const tunic = mat(0x7a1f1f);
  const armor = mat(0x5a5f66, { metalness: 0.6, roughness: 0.4 });
  const pants = mat(0x2a2a2e);
  const boots = mat(0x4a2e1c);
  const black = mat(0x111111);
  const leather = mat(0x3a2414);
  const gold = mat(0xb08a2e, { metalness: 0.7, roughness: 0.35 });

  const torsoGeo = geo(new THREE.BoxGeometry(0.42, 0.6, 0.24));
  const plateGeo = geo(new THREE.BoxGeometry(0.44, 0.3, 0.26));
  const headGeo = geo(new THREE.SphereGeometry(0.12, 16, 12));
  const helmGeo = geo(new THREE.CylinderGeometry(0.135, 0.13, 0.2, 14));
  const visorGeo = geo(new THREE.BoxGeometry(0.2, 0.025, 0.02));
  const plumeGeo = geo(new THREE.BoxGeometry(0.03, 0.12, 0.2));
  const limbGeo = geo(new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0)); // hangs down from its pivot
  const stretchGeo = geo(new THREE.BoxGeometry(1, 1, 1)); // centered, stretched between two points
  const handGeo = geo(new THREE.SphereGeometry(0.05, 10, 8));
  const handleGeo = geo(new THREE.CylinderGeometry(0.016, 0.018, 0.16, 8).rotateX(Math.PI / 2));
  const guardGeo = geo(new THREE.BoxGeometry(0.16, 0.025, 0.03));
  const bladeGeo = geo(new THREE.BoxGeometry(0.045, 0.008, BLADE_LEN - 0.06).translate(0, 0, BLADE_START + (BLADE_LEN - 0.06) / 2));
  const tipGeo = geo(new THREE.ConeGeometry(0.0225, 0.06, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.18, 1).translate(0, 0, BLADE_START + BLADE_LEN - 0.03));

  function part(g, m, x, y, z, parent) {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // Red flash when you get hit: a sphere around your head
  const flashGeo = geo(new THREE.SphereGeometry(0.3, 16, 8));
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false });
  materials.push(flashMat);
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.renderOrder = 999;
  flash.visible = false;
  game.camera.add(flash);
  let flashTime = 0;

  const fighters = [];
  const headPos = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();

  function buildFighter(position) {
    const root = new THREE.Group();
    const body = new THREE.Group(); // pivots at the feet so they can fall over
    root.add(body);

    part(torsoGeo, tunic, 0, 1.2, 0, body);
    part(plateGeo, armor, 0, 1.33, 0, body);
    const head = new THREE.Group();
    head.position.set(0, 1.66, 0);
    body.add(head);
    part(headGeo, skin, 0, 0, 0, head);
    part(helmGeo, armor, 0, 0.04, 0, head);
    part(visorGeo, black, 0, 0.02, 0.13, head);
    part(plumeGeo, tunic, 0, 0.18, -0.02, head);

    const legs = [0.1, -0.1].map((x) => {
      const hip = new THREE.Group();
      hip.position.set(x, 0.9, 0);
      body.add(hip);
      part(limbGeo, pants, 0, 0, 0, hip).scale.set(0.14, 0.86, 0.16);
      part(handGeo, boots, 0, -0.86, 0.04, hip).scale.set(1.3, 0.7, 1.8);
      return hip;
    });

    // Left arm hangs and swings; right arm reaches to the sword hand
    const leftArm = new THREE.Group();
    leftArm.position.set(0.25, 1.45, 0);
    body.add(leftArm);
    part(limbGeo, tunic, 0, 0, 0, leftArm).scale.set(0.09, 0.6, 0.11);
    part(handGeo, skin, 0, -0.62, 0, leftArm);
    const SHOULDER = new THREE.Vector3(-0.25, 1.45, 0);
    const rightArm = part(stretchGeo, tunic, 0, 0, 0, body);
    rightArm.scale.set(0.09, 0.5, 0.11);

    // Their sword: handle at the origin, blade along +Z
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc9d1da, metalness: 0.85, roughness: 0.25, emissive: 0xff2200, emissiveIntensity: 0 });
    const sword = new THREE.Group();
    body.add(sword);
    part(handleGeo, leather, 0, 0, 0, sword);
    part(guardGeo, gold, 0, 0, 0.09, sword);
    part(bladeGeo, bladeMat, 0, 0, 0, sword);
    part(tipGeo, bladeMat, 0, 0, 0, sword);
    part(handGeo, skin, 0, 0, 0, sword).scale.setScalar(0.9); // sword hand

    const hitbox = new THREE.Object3D();
    hitbox.position.set(0, 1.15, 0);
    root.add(hitbox);

    root.position.copy(position);
    scene.add(root);

    const f = {
      root,
      body,
      head,
      legs,
      leftArm,
      rightArm,
      shoulder: SHOULDER,
      sword,
      bladeMat,
      hitbox,
      hp: MAX_HP,
      state: 'approach',
      stateTime: 0,
      yaw: 0,
      attack: null,
      pose: copyPose(GUARD, { hand: new THREE.Vector3(), quat: new THREE.Quaternion() }),
      startPose: { hand: new THREE.Vector3(), quat: new THREE.Quaternion() },
      deflect: new THREE.Vector3(), // world-space push on their blade from yours
      push: new THREE.Vector3(), // knockback velocity
      inContact: false,
      parried: false,
      hitThisSwing: false,
      nextAttack: 1 + Math.random(),
      phase: 0,
      knock: 0,
      seed: Math.random() * 10,
      base: new THREE.Vector3(),
      tip: new THREE.Vector3(),
      prevTip: new THREE.Vector3(),
      hasPrev: false,
    };

    f.removeHittable = game.addHittable({
      object: hitbox,
      radius: 0.4,
      onHit: (controller, info) => hurt(f, controller, info),
    });
    fighters.push(f);
    return f;
  }

  function setState(f, state, time) {
    f.state = state;
    f.stateTime = time;
    copyPose(f.pose, f.startPose);
  }

  function hurt(f, controller, info) {
    if (f.state === 'dead') return;
    f.hp -= (info?.force ?? 0) >= 8 ? MAX_HP : 1;
    f.hitbox.getWorldPosition(tmp);
    fx.sparkBurst(tmp, 16, 3);
    if (controller) game.pulse(controller, 1.0, 120);
    game.getHeadPosition(headPos);
    f.push.set(f.root.position.x - headPos.x, 0, f.root.position.z - headPos.z).setLength(2.2);
    if (f.hp <= 0) {
      fx.popup('DEFEATED!', tmp.clone().add(new THREE.Vector3(0, 0.9, 0)), '#7dff9a');
      f.hitbox.visible = false;
      f.bladeMat.emissiveIntensity = 0;
      setState(f, 'dead', 1.8);
    } else {
      fx.popup(HIT_WORDS[Math.floor(Math.random() * HIT_WORDS.length)], tmp.clone().add(new THREE.Vector3(0, 0.9, 0)));
      setState(f, 'stagger', T_STAGGER);
    }
  }

  function removeFighter(f, withPoof) {
    if (withPoof) {
      f.hitbox.getWorldPosition(tmp);
      for (let i = 0; i < 6; i++) {
        fx.puff(tmp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.6)), {
          color: 0x9a8fb0,
          size: 0.3,
          grow: 2,
          life: 0.9,
          rise: 0.5,
          opacity: 0.7,
        });
      }
    }
    f.removeHittable();
    scene.remove(f.root);
    f.bladeMat.dispose();
    fighters.splice(fighters.indexOf(f), 1);
  }

  function spawn() {
    if (fighters.length >= MAX_FIGHTERS) {
      game.getHeadPosition(headPos);
      fx.popup('MAX 3!', headPos.clone().add(new THREE.Vector3(0, 0.3, -1.5)), '#ff8a5c');
      return;
    }
    if (!isEnabled('sword')) setEnabled('sword', true); // you'll want something to block with

    game.getHeadPosition(headPos);
    game.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
    forward.normalize().applyAxisAngle(UP, (Math.random() - 0.5) * 1.2);
    const position = new THREE.Vector3(headPos.x, 0, headPos.z).addScaledVector(forward, 5.5);
    const f = buildFighter(position);
    f.yaw = Math.atan2(headPos.x - position.x, headPos.z - position.z);
    for (let i = 0; i < 6; i++) {
      fx.puff(position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 1.6, (Math.random() - 0.5) * 0.8)), {
        color: 0x9a8fb0,
        size: 0.35,
        grow: 2,
        life: 1,
        rise: 0.6,
        opacity: 0.7,
      });
    }
  }

  const removeSpawn = addAction({ label: 'Spawn sword fighter', run: spawn });
  const removeClear = addAction({ label: 'Clear fighters', run: () => [...fighters].forEach((f) => removeFighter(f, true)) });

  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const contact = new THREE.Vector3();
  const bodyTop = new THREE.Vector3();
  const bodyBottom = new THREE.Vector3();
  const deflectLocal = new THREE.Vector3();
  const armDir = new THREE.Vector3();

  // Closest contact between a player blade and this fighter's blade (and the arc its tip swept this frame)
  function bladeContact(pb, f) {
    let d = closestSegmentPoints(pb.base, pb.tip, f.base, f.tip, c1, c2);
    if (d >= BLADE_RADIUS * 2 && f.hasPrev) {
      d = closestSegmentPoints(pb.base, pb.tip, f.prevTip, f.tip, c1, c2);
    }
    return d;
  }

  function updateFighter(f, dt, time) {
    f.stateTime -= dt;
    game.getHeadPosition(headPos);
    const dx = headPos.x - f.root.position.x;
    const dz = headPos.z - f.root.position.z;
    const dist = Math.hypot(dx, dz);
    const alive = f.state !== 'dead';

    // --- Movement ---
    let moveSpeed = 0;
    if (alive && f.state !== 'stagger') {
      if (f.state === 'approach') {
        moveSpeed = WALK_SPEED;
        if (dist <= REACH + 0.15) setState(f, 'guard', 0);
      } else if (dist > REACH + 0.35) {
        moveSpeed = f.state === 'guard' ? 0.9 : 0.4;
      } else if (dist < REACH - 0.3) {
        moveSpeed = -0.7; // back off a little
      }
      if (moveSpeed !== 0 && dist > 0.01) {
        f.root.position.x += (dx / dist) * moveSpeed * dt;
        f.root.position.z += (dz / dist) * moveSpeed * dt;
      }
      // Circle a little while on guard
      if (f.state === 'guard') {
        const strafe = Math.sin(time * 0.8 + f.seed) * 0.35 * dt;
        f.root.position.x += (-dz / Math.max(dist, 0.01)) * strafe;
        f.root.position.z += (dx / Math.max(dist, 0.01)) * strafe;
      }
      f.yaw = lerpAngle(f.yaw, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
    }
    // Knockback
    f.root.position.addScaledVector(f.push, dt);
    f.push.multiplyScalar(Math.exp(-5 * dt));
    // Keep fighters from stacking on top of each other
    for (const other of fighters) {
      if (other === f) continue;
      tmp.subVectors(f.root.position, other.root.position).setY(0);
      const gap = tmp.length();
      if (gap < 0.9 && gap > 1e-4) f.root.position.addScaledVector(tmp.normalize(), (0.9 - gap) * 0.5);
    }
    pushOutOfSolids(f.root.position, 0.3, 0.05, 1.8); // walls are solid
    f.root.rotation.y = f.yaw;

    // --- State machine + sword pose ---
    const blend = 1 - Math.exp(-10 * dt);
    switch (f.state) {
      case 'approach':
      case 'guard':
        lerpPose(f.pose, GUARD, blend, f.pose);
        if (f.state === 'guard') {
          f.nextAttack -= dt;
          if (f.nextAttack <= 0 && dist < REACH + 0.5) {
            f.attack = ATTACKS[Math.floor(Math.random() * ATTACKS.length)];
            setState(f, 'windup', T_WIND);
          }
        }
        break;
      case 'windup':
        lerpPose(f.startPose, f.attack[0], easeInOut(1 - Math.max(f.stateTime, 0) / T_WIND), f.pose);
        if (f.stateTime <= 0) setState(f, 'hold', T_HOLD);
        break;
      case 'hold':
        copyPose(f.attack[0], f.pose);
        f.pose.hand.y += Math.sin(time * 60) * 0.004; // tense shiver
        if (f.stateTime <= 0) {
          setState(f, 'swing', T_SWING);
          f.parried = false;
          f.hitThisSwing = false;
        }
        break;
      case 'swing': {
        const t = THREE.MathUtils.clamp(1 - f.stateTime / T_SWING, 0, 1);
        if (t < 0.5) lerpPose(f.attack[0], f.attack[1], t * 2, f.pose);
        else lerpPose(f.attack[1], f.attack[2], (t - 0.5) * 2, f.pose);
        if (f.stateTime <= 0) setState(f, 'recover', T_RECOVER);
        break;
      }
      case 'recover':
        lerpPose(f.startPose, GUARD, easeInOut(1 - Math.max(f.stateTime, 0) / T_RECOVER), f.pose);
        if (f.stateTime <= 0) {
          setState(f, 'guard', 0);
          f.nextAttack = 0.7 + Math.random() * 1.0;
        }
        break;
      case 'stagger':
        lerpPose(f.pose, STAGGERED, blend, f.pose);
        if (f.stateTime <= 0) {
          setState(f, 'guard', 0);
          f.nextAttack = 0.6 + Math.random() * 0.8;
        }
        break;
      case 'dead':
        f.knock = Math.min(1, f.knock + dt * 4);
        if (f.stateTime <= 0) {
          removeFighter(f, true);
          return;
        }
        break;
    }

    // Blade glows red while winding up — your cue to block
    const glowTarget = f.state === 'windup' || f.state === 'hold' ? 1.4 : 0;
    f.bladeMat.emissiveIntensity = THREE.MathUtils.damp(f.bladeMat.emissiveIntensity, glowTarget, 12, dt);

    // Place the sword, including any push from your blade
    f.deflect.multiplyScalar(Math.exp(-8 * dt));
    tmpQuat.copy(f.root.quaternion).invert();
    deflectLocal.copy(f.deflect).applyQuaternion(tmpQuat);
    f.sword.position.copy(f.pose.hand).add(deflectLocal);
    f.sword.quaternion.copy(f.pose.quat);

    // Right arm stretches from shoulder to sword hand
    f.rightArm.position.addVectors(f.shoulder, f.sword.position).multiplyScalar(0.5);
    armDir.subVectors(f.sword.position, f.shoulder);
    f.rightArm.scale.y = Math.max(armDir.length(), 0.05);
    f.rightArm.quaternion.setFromUnitVectors(UP, armDir.normalize());

    // Body: walking legs, swinging left arm, falling over when defeated
    const walking = Math.abs(moveSpeed) > 0 && alive;
    f.phase += dt * (walking ? 8 : 0);
    const swing = walking ? Math.sin(f.phase) * 0.5 : 0;
    f.legs[0].rotation.x = swing;
    f.legs[1].rotation.x = -swing;
    f.leftArm.rotation.x = -swing * 0.8;
    f.body.rotation.x = -f.knock * Math.PI * 0.48;

    if (!alive) return;

    // --- Blade collisions ---
    f.root.updateMatrixWorld(true);
    if (f.hasPrev) f.prevTip.copy(f.tip);
    f.sword.localToWorld(f.base.set(0, 0, BLADE_START));
    f.sword.localToWorld(f.tip.set(0, 0, BLADE_START + BLADE_LEN));
    if (!f.hasPrev) {
      f.prevTip.copy(f.tip);
      f.hasPrev = true;
    }

    let touching = false;
    for (const pb of blades) {
      const d = bladeContact(pb, f);
      if (d >= BLADE_RADIUS * 2) continue;
      touching = true;
      normal.subVectors(c1, c2);
      if (normal.lengthSq() < 1e-10) normal.subVectors(pb.base, f.base);
      normal.normalize();
      const penetration = BLADE_RADIUS * 2 - d;
      // Push your blade out of theirs (felt as resistance) and theirs back a bit
      pb.correction.addScaledVector(normal, penetration + 0.004);
      f.deflect.addScaledVector(normal, -(penetration * 0.5 + 0.01));
      contact.addVectors(c1, c2).multiplyScalar(0.5);

      if (!f.inContact) {
        fx.sparkBurst(contact, 12, 2.5);
        game.pulse(pb.controller, 0.9, 60);
      } else {
        game.pulse(pb.controller, 0.35, 20);
      }

      if (f.state === 'swing' && !f.parried) {
        // Blocked! They stagger back
        f.parried = true;
        fx.sparkBurst(contact, 20, 4);
        fx.popup('BLOCK!', contact.clone().add(new THREE.Vector3(0, 0.35, 0)), '#7dff9a');
        game.pulse(pb.controller, 1.0, 120);
        tmp.set(f.root.position.x - headPos.x, 0, f.root.position.z - headPos.z).setLength(1.6);
        f.push.copy(tmp);
        setState(f, 'stagger', T_STAGGER);
      }
    }
    f.inContact = touching;

    // --- Did the swing land on you? ---
    if (f.state === 'swing' && !f.parried && !f.hitThisSwing) {
      bodyTop.copy(headPos).y -= 0.1;
      bodyBottom.set(headPos.x, Math.max(0.3, headPos.y - 1.0), headPos.z);
      let d = closestSegmentPoints(f.base, f.tip, bodyTop, bodyBottom, c1, c2);
      if (d >= BODY_RADIUS + BLADE_RADIUS) d = closestSegmentPoints(f.prevTip, f.tip, bodyTop, bodyBottom, c1, c2);
      if (d < BODY_RADIUS + BLADE_RADIUS) {
        f.hitThisSwing = true;
        flash.visible = true;
        flashTime = 0.35;
        for (const controller of game.controllers) game.pulse(controller, 1.0, 200);
        fx.popup('OUCH!', f.root.position.clone().add(new THREE.Vector3(0, 2.15, 0)), '#ff5c5c');
      }
    }
  }

  return {
    update(dt, time) {
      fx.update(dt);
      for (const f of [...fighters]) updateFighter(f, dt, time);

      if (flashTime > 0) {
        flashTime -= dt;
        flashMat.opacity = Math.max(0, flashTime / 0.35) * 0.45;
        if (flashTime <= 0) flash.visible = false;
      }
    },

    dispose() {
      removeSpawn();
      removeClear();
      [...fighters].forEach((f) => removeFighter(f, false));
      fx.dispose();
      game.camera.remove(flash);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
