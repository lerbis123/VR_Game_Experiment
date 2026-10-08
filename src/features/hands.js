import * as THREE from 'three';
import { solidCorrection } from './shared.js';

// Helpers for items held in the hand. No setup() export, so it isn't a feature itself.
//
// Held items attach to the controller's *grip* space, not its pointer ray. Grip space has
// its origin in your palm and -Z running along your closed fist out the thumb side
// (the way a sword blade or flashlight beam leaves your hand).

// A controller that isn't being tracked (asleep, set down, out of view) is hidden and parked
// at the rig's origin on the floor. Ignore those, or they look like a hand reaching down.
export function isTracked(controller) {
  return controller.visible && !!controller.userData.inputSource;
}

export function trackedControllers(game) {
  return game.controllers.filter(isTracked);
}

export function gripOf(game, controller) {
  return game.renderer.xr.getControllerGrip(game.controllers.indexOf(controller));
}

// The controller model is the first thing main.js adds to each grip
export function setControllerModelVisible(game, controller, visible) {
  const model = gripOf(game, controller)?.children[0];
  if (model) model.visible = visible;
}

export function holdInGrip(game, controller, object) {
  gripOf(game, controller).add(object);
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  setControllerModelVisible(game, controller, false);
}

export function releaseFromGrip(game, controller) {
  setControllerModelVisible(game, controller, true);
}

// Dropped items fall with your throw speed, bounce, and settle where they land.
// Call track() each frame while held, drop() on release, pickUp() on grab, update() every frame.
export function createDropper(scene) {
  const items = new Map(); // object -> { velocity, spin, restY, restQuat }
  const history = new Map(); // controller -> recent [{ t, pos }]
  const euler = new THREE.Euler();
  const spinQuat = new THREE.Quaternion();
  const fix = new THREE.Vector3();

  function track(controller, time) {
    const h = history.get(controller) ?? [];
    h.push({ t: time, pos: controller.getWorldPosition(new THREE.Vector3()) });
    while (h.length > 6) h.shift();
    history.set(controller, h);
  }

  function velocityOf(controller) {
    const h = history.get(controller) ?? [];
    history.delete(controller);
    const v = new THREE.Vector3();
    if (h.length >= 2) {
      const first = h[0];
      const last = h[h.length - 1];
      v.subVectors(last.pos, first.pos).divideScalar(Math.max(last.t - first.t, 1e-3));
    }
    return v;
  }

  // restY: height of the object's origin when lying on the ground
  // restQuat(yaw, out): how it lies on the ground, given the direction it was facing
  function drop(object, controller, { restY, restQuat }) {
    scene.attach(object);
    const velocity = velocityOf(controller);
    const spin = new THREE.Vector3().randomDirection().multiplyScalar(1 + velocity.length() * 1.5);
    items.set(object, { velocity, spin, restY, restQuat });
  }

  function pickUp(object) {
    items.delete(object);
  }

  function update(dt) {
    for (const [object, it] of items) {
      it.velocity.y -= 9.8 * dt;
      object.position.addScaledVector(it.velocity, dt);
      spinQuat.setFromEuler(euler.set(it.spin.x * dt, it.spin.y * dt, it.spin.z * dt));
      object.quaternion.premultiply(spinQuat);

      // Bounce off walls and land on roofs instead of passing through buildings
      if (solidCorrection(object.position, it.restY, fix)) {
        object.position.add(fix);
        const n = fix.normalize();
        const vn = it.velocity.dot(n);
        if (vn < 0) it.velocity.addScaledVector(n, -1.2 * vn);
        it.velocity.multiplyScalar(0.6);
        it.spin.multiplyScalar(0.5);
        if (n.y > 0.5 && it.velocity.lengthSq() < 0.1) {
          euler.setFromQuaternion(object.quaternion, 'YXZ');
          it.restQuat(euler.y, object.quaternion);
          items.delete(object);
        }
        continue;
      }

      if (object.position.y <= it.restY) {
        object.position.y = it.restY;
        it.velocity.y = -it.velocity.y * 0.2;
        it.velocity.x *= 0.5;
        it.velocity.z *= 0.5;
        it.spin.multiplyScalar(0.5);
        if (it.velocity.lengthSq() < 0.1) {
          // Settle flat, keeping the direction it was facing
          euler.setFromQuaternion(object.quaternion, 'YXZ');
          it.restQuat(euler.y, object.quaternion);
          items.delete(object);
        }
      }
    }
  }

  return { track, drop, pickUp, update };
}
