import * as THREE from 'three';
import { createDropper, holdInGrip, releaseFromGrip, setControllerModelVisible } from './hands.js';

// A pistol on a stand left of the table. Grab with GRIP, shoot with TRIGGER.
// Let go and it drops where you are (switch it off and on to put it back on the stand).
// Manual reload: A / X (on the gun hand) ejects the magazine. With your other hand,
// reach to your hip and GRIP to pull a fresh mag from the pouch, then push it up
// into the bottom of the gun's grip.
const STAND_POS = new THREE.Vector3(-0.85, 1.05, -0.7);
const MAG_SIZE = 8;
const RANGE = 100;
const EJECT_BUTTONS = [4, 5]; // A/B on right controller, X/Y on left
const INSERT_DISTANCE = 0.09; // how close the new mag must get to the mag well
const GRIP_RAKE = 0.3; // pistol grip angle back from vertical (radians)
// Grip space has -Z running out the thumb side of your fist. A pistol's grip runs along
// your fist, so tip the gun until its grip lines up with -Z and the barrel points forward.
const HOLD_PITCH = -Math.PI / 2 + GRIP_RAKE;
const UP = new THREE.Vector3(0, 1, 0);

export function setup(game) {
  const { scene } = game;
  const geometries = [];
  const materials = [];
  function mat(params) {
    const m = new THREE.MeshStandardMaterial(params);
    materials.push(m);
    return m;
  }
  function box(w, h, d, material, x, y, z, parent) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const metal = mat({ color: 0x3a3d42, metalness: 0.7, roughness: 0.35 });
  const dark = mat({ color: 0x1b1c1f, roughness: 0.6 });
  const gripMat = mat({ color: 0x5b3a22, roughness: 0.8 });
  const orange = mat({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.6 });
  const brass = mat({ color: 0xc9a227, metalness: 0.8, roughness: 0.3 });

  // gun      = what attaches to your hand (or sits on the stand)
  // holdPose = rotates the pistol so its grip runs along your fist
  // model    = the visible pistol (barrel along -Z, top +Y); recoil animates it
  const gun = new THREE.Group();
  const holdPose = new THREE.Group();
  holdPose.rotation.x = HOLD_PITCH;
  gun.add(holdPose);
  const model = new THREE.Group();
  const MODEL_REST = new THREE.Vector3(0, 0.05, -0.025); // puts the middle of the grip in your palm
  model.position.copy(MODEL_REST);
  holdPose.add(model);

  const SLIDE_REST_Z = -0.06;
  const slide = box(0.034, 0.042, 0.2, metal, 0, 0.04, SLIDE_REST_Z, model);
  box(0.006, 0.008, 0.006, orange, 0, 0.025, -0.092, slide); // front sight
  box(0.02, 0.008, 0.006, dark, 0, 0.025, 0.094, slide); // rear sight
  box(0.03, 0.02, 0.17, dark, 0, 0.012, -0.05, model); // frame
  box(0.03, 0.11, 0.045, gripMat, 0, -0.04, 0.02, model).rotation.x = -GRIP_RAKE; // grip
  box(0.006, 0.006, 0.05, dark, 0, -0.012, -0.03, model); // trigger guard
  const trigger = box(0.005, 0.025, 0.006, metal, 0, -0.008, -0.022, model);

  // Mag well: where a magazine sits inside the grip
  const magWell = new THREE.Group();
  magWell.position.set(0, -0.04, 0.02);
  magWell.rotation.x = -GRIP_RAKE;
  model.add(magWell);

  const magGeo = new THREE.BoxGeometry(0.024, 0.1, 0.034);
  const roundGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.02, 8).rotateX(Math.PI / 2);
  geometries.push(magGeo, roundGeo);
  function makeMag() {
    const mag = new THREE.Group();
    const body = new THREE.Mesh(magGeo, dark);
    body.castShadow = true;
    mag.add(body);
    const round = new THREE.Mesh(roundGeo, brass);
    round.position.set(0, 0.053, 0);
    mag.add(round);
    return mag;
  }
  function seatMag(mag) {
    magWell.add(mag);
    mag.position.set(0, -0.006, 0);
    mag.quaternion.identity();
  }
  let magInGun = makeMag();
  seatMag(magInGun);
  let rounds = MAG_SIZE;

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.17);
  model.add(muzzle);

  const flashGeo = new THREE.SphereGeometry(0.03, 8, 6);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9 });
  geometries.push(flashGeo);
  materials.push(flashMat);
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.set(0, 0.04, -0.19);
  flash.visible = false;
  model.add(flash);

  // Ammo counter on both sides of the frame, below the slide, so it stays out of the sight line
  const ammoCanvas = document.createElement('canvas');
  ammoCanvas.width = 128;
  ammoCanvas.height = 64;
  const ammoCtx = ammoCanvas.getContext('2d');
  const ammoTex = new THREE.CanvasTexture(ammoCanvas);
  ammoTex.colorSpace = THREE.SRGBColorSpace;
  const ammoMat = new THREE.MeshBasicMaterial({ map: ammoTex });
  const ammoGeo = new THREE.PlaneGeometry(0.05, 0.025);
  geometries.push(ammoGeo);
  materials.push(ammoMat);
  for (const side of [-1, 1]) {
    const ammoPanel = new THREE.Mesh(ammoGeo, ammoMat);
    ammoPanel.position.set(side * 0.018, 0.006, -0.07);
    ammoPanel.rotation.y = (side * Math.PI) / 2; // face outward
    model.add(ammoPanel);
  }

  function drawAmmo() {
    const c = ammoCtx;
    c.fillStyle = '#0d0f12';
    c.fillRect(0, 0, 128, 64);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (!magInGun) {
      c.fillStyle = '#ffd36b';
      c.font = 'bold 28px system-ui, sans-serif';
      c.fillText('NO MAG', 64, 32);
    } else if (rounds === 0) {
      c.fillStyle = '#ff4d4d';
      c.font = 'bold 30px system-ui, sans-serif';
      c.fillText('EMPTY', 64, 32);
    } else {
      c.fillStyle = '#7dffb0';
      c.font = 'bold 40px system-ui, sans-serif';
      c.fillText(`${rounds}/${MAG_SIZE}`, 64, 34);
    }
    ammoTex.needsUpdate = true;
  }
  drawAmmo();

  // Stand
  const standGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.9, 10);
  geometries.push(standGeo);
  const stand = new THREE.Mesh(standGeo, mat({ color: 0x8b5a2b }));
  stand.position.set(STAND_POS.x, 0.45, STAND_POS.z);
  stand.castShadow = true;
  scene.add(stand);

  let onStand = true;
  function putOnStand() {
    scene.add(gun);
    gun.position.copy(STAND_POS);
    gun.rotation.set(-HOLD_PITCH, 0, 0); // undo the hand pose so it sits upright
  }
  putOnStand();

  // Dropped: falls where you let go and lies on its side (switch it off and on to reset)
  const dropper = createDropper(scene);
  const flatEuler = new THREE.Euler();
  const undoHoldPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(-HOLD_PITCH, 0, 0));
  const lieOnSide = (yaw, out) => out.setFromEuler(flatEuler.set(0, yaw, Math.PI / 2, 'YXZ')).multiply(undoHoldPose);

  // Hip pouch of spare mags: follows your belt on the side of your free hand, only while you hold the gun
  const pouch = new THREE.Group();
  box(0.07, 0.09, 0.05, mat({ color: 0x3d4a2a, roughness: 0.9 }), 0, 0, 0, pouch);
  for (const x of [-0.015, 0.015]) box(0.02, 0.04, 0.03, dark, x, 0.06, 0, pouch);
  pouch.visible = false;
  scene.add(pouch);

  // Tracer + floor dust puffs
  const tracerGeo = new THREE.CylinderGeometry(0.003, 0.003, 1, 4);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true });
  geometries.push(tracerGeo);
  materials.push(tracerMat);
  const tracer = new THREE.Mesh(tracerGeo, tracerMat);
  tracer.visible = false;
  scene.add(tracer);

  const puffGeo = new THREE.SphereGeometry(0.05, 8, 6);
  geometries.push(puffGeo);
  const puffs = [];
  function puff(position) {
    const m = new THREE.MeshBasicMaterial({ color: 0xb8a58a, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(puffGeo, m);
    mesh.position.copy(position);
    scene.add(mesh);
    puffs.push({ mesh, t: 0 });
  }

  // Dropped/ejected magazines fall to the floor and fade away
  const looseMags = [];
  function dropMag(mag, velocity) {
    scene.attach(mag);
    looseMags.push({ mag, velocity, life: 4 });
  }

  const ray = new THREE.Ray();
  const sphere = new THREE.Sphere();
  const hitPoint = new THREE.Vector3();
  const end = new THREE.Vector3();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const headPos = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wellPos = new THREE.Vector3();
  const magPos = new THREE.Vector3();
  let tracerLife = 0;
  let flashLife = 0;
  let heldBy = null;
  let handMag = null; // { mag, controller } — a spare mag in your free hand
  let ejectWasPressed = false;

  function fire(controller) {
    if (!magInGun || rounds === 0) {
      game.pulse(controller, 0.1, 20); // dry click
      return;
    }
    rounds--;
    drawAmmo();

    muzzle.getWorldPosition(ray.origin);
    ray.direction.set(0, 0, -1).transformDirection(holdPose.matrixWorld);

    // Nearest hittable along the shot
    let best = null;
    let bestDist = RANGE;
    for (const h of game.hittables ?? []) {
      if (!h.object.visible) continue;
      h.object.getWorldPosition(sphere.center);
      sphere.radius = h.radius;
      if (ray.intersectSphere(sphere, hitPoint)) {
        const d = hitPoint.distanceTo(ray.origin);
        if (d < bestDist) {
          best = h;
          bestDist = d;
        }
      }
    }

    if (best) {
      ray.at(bestDist, end);
    } else if (ray.intersectPlane(floorPlane, hitPoint) && hitPoint.distanceTo(ray.origin) < RANGE) {
      end.copy(hitPoint);
      puff(end);
    } else {
      ray.at(RANGE, end);
    }

    // Tracer from muzzle to impact
    tracer.position.addVectors(ray.origin, end).multiplyScalar(0.5);
    hitPoint.subVectors(end, ray.origin);
    tracer.scale.set(1, hitPoint.length(), 1);
    tracer.quaternion.setFromUnitVectors(UP, hitPoint.normalize());
    tracer.visible = true;
    tracerLife = 0.06;

    flash.visible = true;
    flashLife = 0.05;
    model.rotation.x += 0.35; // recoil kick
    model.position.z += 0.025;
    game.pulse(controller, 0.9, 50);

    if (best) best.onHit(controller);
    if (rounds === 0) game.pulse(controller, 0.3, 30);
  }

  function ejectMag() {
    if (!magInGun) return;
    const mag = magInGun;
    magInGun = null;
    rounds = 0;
    dropMag(mag, new THREE.Vector3(0, -1.5, 0));
    drawAmmo();
    game.pulse(heldBy, 0.4, 40);
  }

  function dropHandMag() {
    if (!handMag) return;
    releaseFromGrip(game, handMag.controller);
    dropMag(handMag.mag, new THREE.Vector3(0, 0, 0));
    handMag = null;
  }

  const removeGun = game.addGrabbable({
    object: gun,
    radius: 0.2,
    buttons: ['squeeze'],
    onGrab(controller) {
      heldBy = controller;
      onStand = false;
      dropper.pickUp(gun);
      holdInGrip(game, controller, gun);
    },
    onRelease(controller) {
      heldBy = null;
      trigger.rotation.x = 0;
      releaseFromGrip(game, controller);
      dropHandMag();
      dropper.drop(gun, controller, { restY: 0.03, restQuat: lieOnSide });
    },
    onTrigger(controller, pressed) {
      trigger.rotation.x = pressed ? 0.5 : 0;
      if (pressed) fire(controller);
    },
  });

  const removePouch = game.addGrabbable({
    object: pouch,
    radius: 0.25,
    onGrab(controller) {
      if (!heldBy || handMag) return;
      const mag = makeMag();
      holdInGrip(game, controller, mag);
      // Mag's top (+Y) points out the thumb side of your fist (-Z), ready to push in
      mag.rotation.x = -Math.PI / 2;
      mag.position.z = -0.03;
      handMag = { mag, controller };
      game.pulse(controller, 0.3, 30);
    },
    onRelease(controller) {
      if (handMag?.controller === controller) dropHandMag();
    },
  });

  return {
    update(dt, time) {
      // Eject button on the gun hand
      const buttons = heldBy?.userData.inputSource?.gamepad?.buttons;
      const ejectPressed = !!buttons && EJECT_BUTTONS.some((i) => buttons[i]?.pressed);
      if (ejectPressed && !ejectWasPressed) ejectMag();
      ejectWasPressed = ejectPressed;

      // Keep the pouch on your hip (free-hand side) while you hold the gun; park it far away otherwise
      if (heldBy) {
        game.getHeadPosition(headPos);
        game.camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
        forward.normalize();
        right.crossVectors(forward, UP);
        const side = heldBy.userData.inputSource?.handedness === 'left' ? 1 : -1;
        pouch.position.copy(headPos).addScaledVector(right, side * 0.22).addScaledVector(forward, 0.05);
        pouch.position.y = Math.max(0.3, headPos.y - 0.7);
        pouch.rotation.y = Math.atan2(forward.x, forward.z);
        pouch.visible = true;
      } else {
        pouch.position.set(0, -100, 0);
        pouch.visible = false;
      }

      // Push the spare mag into the mag well to reload
      if (handMag && heldBy && !magInGun) {
        magWell.localToWorld(wellPos.set(0, -0.06, 0)); // bottom opening of the grip
        handMag.mag.localToWorld(magPos.set(0, 0.05, 0)); // top of the spare mag
        if (wellPos.distanceTo(magPos) < INSERT_DISTANCE) {
          const { mag, controller } = handMag;
          releaseFromGrip(game, controller);
          handMag = null;
          magInGun = mag;
          seatMag(mag);
          rounds = MAG_SIZE;
          drawAmmo();
          game.pulse(heldBy, 0.8, 60); // clack
          game.pulse(controller, 0.8, 60);
          setControllerModelVisible(game, controller, true);
        }
      }

      // Slide locks back when empty
      const locked = !magInGun || rounds === 0;
      slide.position.z = THREE.MathUtils.damp(slide.position.z, locked ? SLIDE_REST_Z + 0.03 : SLIDE_REST_Z, 25, dt);

      // Recoil recovery
      model.rotation.x = THREE.MathUtils.damp(model.rotation.x, 0, 14, dt);
      model.position.z = THREE.MathUtils.damp(model.position.z, MODEL_REST.z, 14, dt);

      if (onStand) gun.position.y = STAND_POS.y + Math.sin(time * 2) * 0.01;
      if (heldBy) dropper.track(heldBy, time);
      dropper.update(dt);

      for (let i = looseMags.length - 1; i >= 0; i--) {
        const m = looseMags[i];
        m.life -= dt;
        m.velocity.y -= 9.8 * dt;
        m.mag.position.addScaledVector(m.velocity, dt);
        if (m.mag.position.y < 0.02) {
          m.mag.position.y = 0.02;
          m.velocity.set(0, 0, 0);
        }
        if (m.life < 0.5) m.mag.scale.setScalar(Math.max(0.01, m.life / 0.5));
        if (m.life <= 0) {
          scene.remove(m.mag);
          looseMags.splice(i, 1);
        }
      }

      if (flashLife > 0 && (flashLife -= dt) <= 0) flash.visible = false;
      if (tracerLife > 0) {
        tracerLife -= dt;
        tracerMat.opacity = Math.max(tracerLife / 0.06, 0);
        if (tracerLife <= 0) tracer.visible = false;
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.t += dt;
        p.mesh.scale.setScalar(1 + p.t * 5);
        p.mesh.material.opacity = Math.max(0, 0.8 - p.t * 1.6);
        if (p.t > 0.5) {
          scene.remove(p.mesh);
          p.mesh.material.dispose();
          puffs.splice(i, 1);
        }
      }
    },

    dispose() {
      if (heldBy) releaseFromGrip(game, heldBy);
      if (handMag) {
        releaseFromGrip(game, handMag.controller);
        handMag.mag.removeFromParent();
      }
      removeGun();
      removePouch();
      gun.removeFromParent();
      scene.remove(stand, tracer, pouch);
      looseMags.forEach((m) => scene.remove(m.mag));
      puffs.forEach((p) => {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
      });
      ammoTex.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
