import * as THREE from 'three';
import { createFx } from './fx.js';
import { createDropper, holdInGrip, releaseFromGrip } from './hands.js';

// A shoulder-style missile launcher on a rack to your right. Grab with GRIP, fire with TRIGGER.
// Aim near something hittable and a red reticle locks on; the missile homes in on it.
// The blast hits everything within a few meters: targets, people, fighters, building blocks.
// Reloads itself after a couple of seconds. Let go and it drops where you are.
const STAND_POS = new THREE.Vector3(1.45, 1.05, -0.3);
const GRIP_RAKE = 0.3;
const HOLD_PITCH = -Math.PI / 2 + GRIP_RAKE; // same pistol-grip hold as the gun
const RELOAD_TIME = 2;
const START_SPEED = 12;
const MAX_SPEED = 40;
const ACCEL = 35;
const TURN_RATE = 2.2; // how hard it homes, per second
const LOCK_ANGLE = 0.14; // ~8 degrees from your aim
const LOCK_RANGE = 80;
const BLAST_RADIUS = 3;
const MISSILE_LIFE = 6;

export function setup(game) {
  const { scene } = game;
  const fx = createFx(scene);
  const geometries = [];
  const materials = [];
  function mat(params) {
    const m = new THREE.MeshStandardMaterial(params);
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

  const olive = mat({ color: 0x4b5a3a, roughness: 0.7 });
  const dark = mat({ color: 0x1e2022, roughness: 0.6 });
  const yellow = mat({ color: 0xe8c22e, roughness: 0.6 });
  const red = mat({ color: 0xd63a2f, roughness: 0.5 });
  const white = mat({ color: 0xe9e9e4, roughness: 0.5 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
  materials.push(lensMat);

  // launcher = attaches to your palm; holdPose tips it so the grip runs along your fist;
  // model = barrel along -Z, grip centered at the origin
  const launcher = new THREE.Group();
  const holdPose = new THREE.Group();
  holdPose.rotation.x = HOLD_PITCH;
  launcher.add(holdPose);
  const model = new THREE.Group();
  holdPose.add(model);

  const TUBE_Y = 0.11;
  add(new THREE.CylinderGeometry(0.065, 0.065, 1.0, 16).rotateX(Math.PI / 2), olive, 0, TUBE_Y, 0.12, model);
  add(new THREE.CylinderGeometry(0.078, 0.07, 0.07, 16).rotateX(Math.PI / 2), dark, 0, TUBE_Y, -0.36, model); // muzzle ring
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.08, 16).rotateX(Math.PI / 2), dark, 0, TUBE_Y, 0.6, model); // rear flare
  for (const z of [-0.2, 0.42]) add(new THREE.CylinderGeometry(0.067, 0.067, 0.03, 16).rotateX(Math.PI / 2), yellow, 0, TUBE_Y, z, model);
  add(new THREE.BoxGeometry(0.03, 0.11, 0.045), dark, 0, 0, 0, model).rotation.x = -GRIP_RAKE; // grip
  add(new THREE.BoxGeometry(0.03, 0.09, 0.04), dark, 0, 0.01, -0.24, model); // front handle
  add(new THREE.BoxGeometry(0.04, 0.05, 0.08), dark, -0.075, TUBE_Y + 0.06, -0.05, model); // sight
  const lens = add(new THREE.CircleGeometry(0.014, 16), lensMat, -0.075, TUBE_Y + 0.065, -0.0905, model);
  lens.rotation.y = Math.PI;
  const trigger = add(new THREE.BoxGeometry(0.005, 0.025, 0.006), dark, 0, 0.045, -0.035, model);

  // Missile nose poking out of the front when loaded
  const nose = add(new THREE.ConeGeometry(0.05, 0.14, 12).rotateX(-Math.PI / 2), red, 0, TUBE_Y, -0.44, model);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, TUBE_Y, -0.45);
  model.add(muzzle);
  const rear = new THREE.Object3D();
  rear.position.set(0, TUBE_Y, 0.66);
  model.add(rear);

  // Rack: two posts cradling the tube
  const rackParts = [];
  const postGeo = new THREE.CylinderGeometry(0.025, 0.04, 1.1, 8);
  geometries.push(postGeo);
  const wood = mat({ color: 0x8b5a2b });
  for (const dz of [-0.2, 0.45]) {
    const post = new THREE.Mesh(postGeo, wood);
    post.position.set(STAND_POS.x, 0.55, STAND_POS.z + dz);
    post.castShadow = true;
    scene.add(post);
    rackParts.push(post);
  }

  function putOnRack() {
    scene.add(launcher);
    launcher.position.copy(STAND_POS);
    launcher.rotation.set(-HOLD_PITCH, 0, 0); // undo the hand pose so it sits level
  }
  putOnRack();

  const dropper = createDropper(scene);
  const flatEuler = new THREE.Euler();
  const undoHoldPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(-HOLD_PITCH, 0, 0));
  const lieOnSide = (yaw, out) => out.setFromEuler(flatEuler.set(0, yaw, Math.PI / 2, 'YXZ')).multiply(undoHoldPose);

  // Lock-on reticle shown around whatever you're aiming at
  const reticleGeo = new THREE.RingGeometry(0.5, 0.58, 32);
  const reticleMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false, fog: false });
  geometries.push(reticleGeo);
  materials.push(reticleMat);
  const reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.renderOrder = 998;
  reticle.visible = false;
  scene.add(reticle);

  // Missile parts (shared geometry/materials)
  const bodyGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.36, 10).rotateX(Math.PI / 2);
  const tipGeo = new THREE.ConeGeometry(0.035, 0.1, 10).rotateX(Math.PI / 2);
  const finGeo = new THREE.BoxGeometry(0.003, 0.06, 0.07);
  const flameGeo = new THREE.ConeGeometry(0.03, 0.18, 8).rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa531, transparent: true, opacity: 0.9, fog: false });
  geometries.push(bodyGeo, tipGeo, finGeo, flameGeo);
  materials.push(flameMat);

  // Missile local space: nose toward +Z so lookAt points it along its flight
  function makeMissile() {
    const m = new THREE.Group();
    m.add(new THREE.Mesh(bodyGeo, white));
    const tip = new THREE.Mesh(tipGeo, red);
    tip.position.z = 0.23;
    m.add(tip);
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const fin = new THREE.Mesh(finGeo, red);
      fin.position.set(Math.cos(angle) * 0.045, Math.sin(angle) * 0.045, -0.14);
      fin.rotation.z = angle;
      m.add(fin);
    }
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.z = -0.27;
    m.add(flame);
    m.userData.flame = flame;
    scene.add(m);
    return m;
  }

  const missiles = [];
  let heldBy = null;
  let onRack = true;
  let loaded = true;
  let reloadLeft = 0;
  let lockTarget = null;

  const origin = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const segment = new THREE.Line3();
  const closest = new THREE.Vector3();
  const center = new THREE.Vector3();

  function aimRay() {
    muzzle.getWorldPosition(origin);
    aim.set(0, 0, -1).transformDirection(holdPose.matrixWorld);
  }

  // The visible hittable closest to your aim line, within the lock cone
  function findLock() {
    let best = null;
    let bestAngle = LOCK_ANGLE;
    for (const h of game.hittables ?? []) {
      if (!h.object.visible) continue;
      h.object.getWorldPosition(toTarget).sub(origin);
      const dist = toTarget.length();
      if (dist < 2 || dist > LOCK_RANGE) continue;
      const angle = aim.angleTo(toTarget);
      if (angle < bestAngle) {
        best = h;
        bestAngle = angle;
      }
    }
    return best;
  }

  function fire(controller) {
    if (!loaded) {
      game.pulse(controller, 0.1, 20); // click
      return;
    }
    loaded = false;
    reloadLeft = RELOAD_TIME;
    nose.visible = false;

    aimRay();
    const missile = makeMissile();
    missile.position.copy(origin);
    missile.lookAt(targetPos.copy(origin).add(aim));
    missiles.push({ mesh: missile, dir: aim.clone(), speed: START_SPEED, target: findLock(), life: 0, smoke: 0, shooter: controller, prev: origin.clone() });

    // Muzzle flash + backblast out the rear
    fx.sparkBurst(origin, 10, 3, [0xffd36b, 0xff8a2a, 0xffffff]);
    rear.getWorldPosition(targetPos);
    for (let i = 0; i < 6; i++) {
      fx.puff(targetPos, {
        color: 0xbdbdbd,
        size: 0.12,
        grow: 5,
        life: 1.2,
        rise: 0.2,
        opacity: 0.6,
        drift: aim.clone().multiplyScalar(-2 - Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.5, (Math.random() - 0.5) * 1.5)),
      });
    }
    model.rotation.x += 0.3; // recoil
    game.pulse(controller, 1.0, 250);
  }

  function explode(point, shooter) {
    fx.puff(point, { color: 0xffe066, size: 0.35, grow: 3, life: 0.3, rise: 0.3, opacity: 1 });
    fx.puff(point, { color: 0xff7a1a, size: 0.5, grow: 5, life: 0.5, rise: 0.6, opacity: 0.95 });
    for (let i = 0; i < 8; i++) {
      const offset = new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * 1.2);
      offset.y = Math.abs(offset.y);
      fx.puff(point.clone().add(offset), { color: i % 2 ? 0x3d3d3d : 0x5c5c5c, size: 0.4, grow: 4, life: 2.2 + Math.random(), rise: 1.0, opacity: 0.6 });
    }
    fx.sparkBurst(point, 30, 7, [0xffd36b, 0xff8a2a, 0xff4d1a], 1.4);

    // Damage everything in the blast radius
    for (const h of [...(game.hittables ?? [])]) {
      if (!h.object.visible) continue;
      const d = h.object.getWorldPosition(center).distanceTo(point);
      if (d < BLAST_RADIUS + h.radius) h.onHit(shooter, { point: point.clone(), force: 4 + 8 * Math.max(0, 1 - d / BLAST_RADIUS) });
    }

    // Feel it more the closer you are
    game.getHeadPosition(headPos);
    const nearness = THREE.MathUtils.clamp(1 - headPos.distanceTo(point) / 25, 0.2, 1);
    for (const controller of game.controllers) game.pulse(controller, nearness, 200);
  }

  const removeGrabbable = game.addGrabbable({
    object: launcher,
    radius: 0.22,
    buttons: ['squeeze'],
    onGrab(controller) {
      heldBy = controller;
      onRack = false;
      dropper.pickUp(launcher);
      holdInGrip(game, controller, launcher);
    },
    onRelease(controller) {
      heldBy = null;
      trigger.rotation.x = 0;
      reticle.visible = false;
      releaseFromGrip(game, controller);
      dropper.drop(launcher, controller, { restY: 0.07, restQuat: lieOnSide });
    },
    onTrigger(controller, pressed) {
      trigger.rotation.x = pressed ? 0.5 : 0;
      if (pressed) fire(controller);
    },
  });

  return {
    update(dt, time) {
      fx.update(dt);
      dropper.update(dt);
      if (heldBy) dropper.track(heldBy, time);
      if (onRack) launcher.position.y = STAND_POS.y + Math.sin(time * 2) * 0.008;

      // Reload
      if (!loaded) {
        reloadLeft -= dt;
        if (reloadLeft <= 0) {
          loaded = true;
          nose.visible = true;
          if (heldBy) game.pulse(heldBy, 0.5, 60);
        }
      }
      // Nose slides out as it reloads
      nose.position.z = loaded ? -0.44 : -0.3;

      // Lock-on preview while aiming
      lockTarget = null;
      if (heldBy && loaded) {
        aimRay();
        lockTarget = findLock();
      }
      if (lockTarget) {
        lockTarget.object.getWorldPosition(targetPos);
        game.getHeadPosition(headPos);
        reticle.position.copy(targetPos);
        reticle.lookAt(headPos);
        const s = Math.max(lockTarget.radius * 1.6, 0.4) * (1 + Math.sin(time * 10) * 0.08);
        reticle.scale.setScalar(s);
        reticle.visible = true;
        lensMat.color.setHex(0x3bff6a);
      } else {
        reticle.visible = false;
        lensMat.color.setHex(0xff3b3b);
      }

      model.rotation.x = THREE.MathUtils.damp(model.rotation.x, 0, 10, dt);

      // Fly missiles
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        m.life += dt;
        m.speed = Math.min(MAX_SPEED, m.speed + ACCEL * dt);
        if (m.target?.object.visible) {
          m.target.object.getWorldPosition(targetPos);
          toTarget.subVectors(targetPos, m.mesh.position).normalize();
          m.dir.lerp(toTarget, Math.min(1, TURN_RATE * dt)).normalize();
        }
        m.prev.copy(m.mesh.position);
        m.mesh.position.addScaledVector(m.dir, m.speed * dt);
        m.mesh.lookAt(targetPos.copy(m.mesh.position).add(m.dir));
        m.mesh.userData.flame.scale.set(1, 1, 0.8 + Math.random() * 0.6);

        // Smoke trail
        m.smoke -= dt;
        if (m.smoke <= 0) {
          fx.puff(m.mesh.position.clone().addScaledVector(m.dir, -0.25), { color: 0xdedede, size: 0.06, grow: 5, life: 1.3, rise: 0.15, opacity: 0.5 });
          m.smoke = 0.025;
        }

        // Hit something, the ground, or ran out of fuel
        segment.set(m.prev, m.mesh.position);
        let hit = false;
        for (const h of game.hittables ?? []) {
          if (!h.object.visible) continue;
          h.object.getWorldPosition(center);
          if (segment.closestPointToPoint(center, true, closest).distanceTo(center) < h.radius + 0.08) {
            hit = true;
            break;
          }
        }
        if (hit || m.mesh.position.y <= 0.05 || m.life > MISSILE_LIFE) {
          const point = m.mesh.position.clone();
          point.y = Math.max(point.y, 0.1);
          scene.remove(m.mesh);
          missiles.splice(i, 1);
          explode(point, m.shooter);
        }
      }
    },

    dispose() {
      if (heldBy) releaseFromGrip(game, heldBy);
      removeGrabbable();
      fx.dispose();
      launcher.removeFromParent();
      missiles.forEach((m) => scene.remove(m.mesh));
      scene.remove(reticle, ...rackParts);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
