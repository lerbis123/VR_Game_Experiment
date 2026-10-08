import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { features } from './features/index.js';
import { isEnabled, onToggle, registerBuiltIns } from './features/toggles.js';

// ---------- Tunables ----------
const GRAVITY = 9.8;
const CUBE_SIZE = 0.1;
const GRAB_RADIUS = 0.15;
const THROW_BOOST = 1.4;
const TARGET_RADIUS = 0.3;
const TABLE = { minX: -0.6, maxX: 0.6, minZ: -1.0, maxZ: -0.4, top: 0.8 };

const MOVE_SPEED = 2.0; // m/s, left stick
const SNAP_ANGLE = Math.PI / 6; // 30 degrees per right-stick flick
const STICK_DEADZONE = 0.15;
const PLAY_AREA_RADIUS = 25;

const BOW_REST = new THREE.Vector3(0.85, 1.1, -0.7);
const BOW_GRAB_RADIUS = 0.2;
const NOCK_RADIUS = 0.2; // how close the draw hand must be to the string
const BRACE_HEIGHT = 0.1; // string distance from the handle at rest
const MAX_DRAW = 0.65;
const ARROW_LENGTH = 0.75;
const ARROW_MIN_SPEED = 8;
const ARROW_MAX_SPEED = 38;
const MAX_ARROWS = 20;

const UP = new THREE.Vector3(0, 1, 0);

// ---------- Scene, camera, renderer ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 15, 40);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300); // far enough for distant scenery
camera.position.set(0, 1.6, 0.6);
camera.lookAt(0, 1.2, -3);

// The rig is the player's body: moving or turning it moves the headset and controllers together.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Environment ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(3, 6, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x5d8a52 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(60, 60, 0x3e6236, 0x3e6236);
grid.position.y = 0.001;
scene.add(grid);

// Table the cubes sit on
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
const tableTop = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE.maxX - TABLE.minX, 0.05, TABLE.maxZ - TABLE.minZ),
  woodMat
);
tableTop.position.set(0, TABLE.top - 0.025, (TABLE.minZ + TABLE.maxZ) / 2);
tableTop.castShadow = tableTop.receiveShadow = true;
scene.add(tableTop);
const tableParts = [tableTop];
for (const x of [TABLE.minX + 0.05, TABLE.maxX - 0.05]) {
  for (const z of [TABLE.minZ + 0.05, TABLE.maxZ - 0.05]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE.top - 0.05, 0.05), woodMat);
    leg.position.set(x, (TABLE.top - 0.05) / 2, z);
    leg.castShadow = true;
    scene.add(leg);
    tableParts.push(leg);
  }
}

let score = 0;

// ---------- Cubes ----------
const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
const cubeColors = [0xe74c3c, 0xf39c12, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6];
const cubes = cubeColors.map((color, i) => {
  const cube = new THREE.Mesh(cubeGeo, new THREE.MeshStandardMaterial({ color }));
  cube.castShadow = true;
  cube.userData = {
    home: new THREE.Vector3(-0.45 + i * 0.18, TABLE.top + CUBE_SIZE / 2, -0.7),
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    held: false,
    restTime: 0,
    thrownBy: null,
  };
  respawnCube(cube);
  scene.add(cube);
  return cube;
});

function respawnCube(cube) {
  const d = cube.userData;
  cube.position.copy(d.home);
  cube.rotation.set(0, 0, 0);
  d.velocity.set(0, 0, 0);
  d.spin.set(0, 0, 0);
  d.restTime = 0;
}

// ---------- Bow ----------
// Bow local space: handle at the origin, limbs along Y, arrows fly toward -Z, string sits at +Z.
const bow = new THREE.Group();
bow.userData = { heldBy: null };
const limbMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.6 });
bow.add(new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.018, 0.16, 10),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
));
const TIP_TOP = new THREE.Vector3(0, 0.5, BRACE_HEIGHT);
const TIP_BOTTOM = new THREE.Vector3(0, -0.5, BRACE_HEIGHT);
for (const sign of [1, -1]) {
  const limb = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0.08 * sign, 0),
    new THREE.Vector3(0, 0.32 * sign, -0.08),
    new THREE.Vector3(0, 0.5 * sign, BRACE_HEIGHT)
  );
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(limb, 16, 0.012, 6), limbMat);
  mesh.castShadow = true;
  bow.add(mesh);
}

const stringMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
const stringGeo = new THREE.CylinderGeometry(0.002, 0.002, 1, 4);
const stringTop = new THREE.Mesh(stringGeo, stringMat);
const stringBottom = new THREE.Mesh(stringGeo, stringMat);
bow.add(stringTop, stringBottom);
const nockLocal = new THREE.Vector3(0, 0, BRACE_HEIGHT);

const stretchDir = new THREE.Vector3();
function stretchBetween(mesh, a, b) {
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  stretchDir.subVectors(b, a);
  mesh.scale.set(1, stretchDir.length(), 1);
  mesh.quaternion.setFromUnitVectors(UP, stretchDir.normalize());
}
function updateString() {
  stretchBetween(stringTop, TIP_TOP, nockLocal);
  stretchBetween(stringBottom, nockLocal, TIP_BOTTOM);
}
updateString();

function nockWorld(out) {
  return bow.localToWorld(out.copy(nockLocal));
}

// Stand the bow rests on when nobody is holding it
const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.55, 10), woodMat);
stand.position.set(BOW_REST.x, 0.275, BOW_REST.z);
stand.castShadow = true;
scene.add(stand);

// When you let go of the bow it falls and stays where it lands (until switched off and on)
let bowDrop = null; // { velocity, spin } while falling

function returnBowToRack() {
  bowDrop = null;
  scene.add(bow);
  bow.position.copy(BOW_REST);
  bow.quaternion.identity();
  bow.userData.heldBy = null;
  nockLocal.set(0, 0, BRACE_HEIGHT);
  updateString();
}
returnBowToRack();

// ---------- Arrows ----------
const shaftGeo = new THREE.CylinderGeometry(0.005, 0.005, ARROW_LENGTH, 6).rotateX(Math.PI / 2);
const headGeo = new THREE.ConeGeometry(0.012, 0.05, 8).rotateX(Math.PI / 2);
const fletchGeo = new THREE.BoxGeometry(0.002, 0.03, 0.08);
const shaftMat = new THREE.MeshStandardMaterial({ color: 0xd9c49a });
const headMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6, roughness: 0.4 });
const fletchMat = new THREE.MeshStandardMaterial({ color: 0xff3366 });

// Arrow local space: tip toward +Z so Object3D.lookAt points it along its flight.
function makeArrow() {
  const arrow = new THREE.Group();
  arrow.add(new THREE.Mesh(shaftGeo, shaftMat));
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.z = ARROW_LENGTH / 2;
  arrow.add(head);
  for (const angle of [0, Math.PI / 2]) {
    const fletch = new THREE.Mesh(fletchGeo, fletchMat);
    fletch.position.z = -ARROW_LENGTH / 2 + 0.06;
    fletch.rotation.z = angle;
    arrow.add(fletch);
  }
  arrow.userData = { velocity: new THREE.Vector3(), stuck: false, life: 0, shooter: null };
  scene.add(arrow);
  return arrow;
}

const arrows = [];
function removeArrow(arrow) {
  scene.remove(arrow);
  const i = arrows.indexOf(arrow);
  if (i >= 0) arrows.splice(i, 1);
}

// ---------- Targets ----------
// Anything cubes, arrows or bullets can hit: { object, radius, onHit(controller) }.
// Hidden objects (visible = false) are skipped. Features register their own.
const hittables = [];
function addHittable(h) {
  hittables.push(h);
  return () => {
    const i = hittables.indexOf(h);
    if (i >= 0) hittables.splice(i, 1);
  };
}

const targets = [];
for (let i = 0; i < 4; i++) {
  const target = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(TARGET_RADIUS, 0.04, 12, 40),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3366, emissiveIntensity: 0.6 })
  );
  const bullseye = new THREE.Mesh(
    new THREE.CircleGeometry(TARGET_RADIUS * 0.35, 32),
    new THREE.MeshBasicMaterial({ color: 0xff3366, side: THREE.DoubleSide })
  );
  target.add(ring, bullseye);
  target.userData = { baseY: 0, phase: Math.random() * Math.PI * 2 };
  placeTarget(target);
  scene.add(target);
  targets.push(target);
  addHittable({
    object: target,
    radius: TARGET_RADIUS,
    onHit: (controller) => {
      addScore(1, target.position, controller);
      placeTarget(target);
    },
  });
}

function placeTarget(target) {
  target.position.set(
    THREE.MathUtils.randFloat(-3, 3),
    0,
    THREE.MathUtils.randFloat(-7, -3.5)
  );
  target.userData.baseY = THREE.MathUtils.randFloat(1.0, 2.4);
  target.lookAt(0, target.userData.baseY, 0);
}

function addScore(points, position, controller) {
  score += points;
  burst(position);
  if (controller) pulse(controller, 1.0, 120);
}

// Expanding ring burst when a target is hit
const effects = [];
function burst(position) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(TARGET_RADIUS * 0.8, TARGET_RADIUS, 40),
    new THREE.MeshBasicMaterial({ color: 0xffee55, transparent: true, side: THREE.DoubleSide })
  );
  mesh.position.copy(position);
  mesh.lookAt(camera.getWorldPosition(new THREE.Vector3()));
  scene.add(mesh);
  effects.push({ mesh, t: 0 });
}

// ---------- Controllers ----------
const modelFactory = new XRControllerModelFactory();
const controllers = [];
const handPos = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  controller.userData = {
    held: null, // a cube or the bow
    grabbedWith: null, // 'select' (trigger) or 'squeeze' (grip)
    drawing: null, // { arrow, button, draw, aim, lastPulse } while pulling the string
    history: [],
    inputSource: null,
    hovered: null,
    turnLatched: false,
  };
  controller.addEventListener('connected', (e) => (controller.userData.inputSource = e.data));
  controller.addEventListener('disconnected', () => {
    release(controller, 'select');
    release(controller, 'squeeze');
    controller.userData.inputSource = null;
  });
  controller.addEventListener('selectstart', () => grab(controller, 'select'));
  controller.addEventListener('selectend', () => release(controller, 'select'));
  controller.addEventListener('squeezestart', () => grab(controller, 'squeeze'));
  controller.addEventListener('squeezeend', () => release(controller, 'squeeze'));

  // Small dot showing the grab point
  controller.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.01, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  ));
  rig.add(controller);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(modelFactory.createControllerModel(grip));
  rig.add(grip);

  controllers.push(controller);
}

// Feature-provided grabbable objects:
// { object, radius, buttons?: ['squeeze' | 'select'], onGrab(controller), onRelease(controller), onTrigger?(controller, pressed) }
const grabbables = [];
function addGrabbable(g) {
  grabbables.push(g);
  return () => {
    if (g.heldBy) {
      g.heldBy.userData.held = null;
      g.heldBy.userData.grabbedWith = null;
      g.heldBy = null;
    }
    const i = grabbables.indexOf(g);
    if (i >= 0) grabbables.splice(i, 1);
  };
}

function otherController(controller) {
  return controllers.find((c) => c !== controller);
}

function nearestCube(position) {
  let best = null;
  let bestDist = GRAB_RADIUS;
  for (const cube of cubes) {
    if (cube.userData.held || !cube.visible) continue;
    const d = cube.position.distanceTo(position);
    if (d < bestDist) {
      best = cube;
      bestDist = d;
    }
  }
  return best;
}

function canNock(controller) {
  const holder = bow.userData.heldBy;
  if (!holder || holder === controller || controller.userData.held || controller.userData.drawing) return false;
  return controller.getWorldPosition(handPos).distanceTo(nockWorld(tmpVec)) < NOCK_RADIUS;
}

function pulse(controller, intensity, ms) {
  const actuator = controller.userData.inputSource?.gamepad?.hapticActuators?.[0];
  actuator?.pulse?.(intensity, ms);
}

function grab(controller, button) {
  const d = controller.userData;
  if (d.held) {
    // Trigger while holding something (e.g. a gun held by the grip)
    if (button === 'select' && d.grabbedWith !== 'select') d.held.userData.grabbable?.onTrigger?.(controller, true);
    return;
  }
  if (d.drawing) return;

  // Other hand is holding the bow and this hand is at the string: nock an arrow
  if (canNock(controller)) {
    d.drawing = { arrow: makeArrow(), button, draw: 0, aim: null, lastPulse: 0 };
    pulse(controller, 0.3, 30);
    return;
  }

  controller.getWorldPosition(handPos);

  for (const g of grabbables) {
    if (g.heldBy || (g.buttons && !g.buttons.includes(button))) continue;
    if (g.object.getWorldPosition(tmpVec).distanceTo(handPos) < g.radius) {
      g.heldBy = controller;
      g.object.userData.grabbable = g;
      d.held = g.object;
      d.grabbedWith = button;
      g.onGrab(controller);
      pulse(controller, 0.5, 50);
      return;
    }
  }

  if (bow.visible && !bow.userData.heldBy && bow.getWorldPosition(tmpVec).distanceTo(handPos) < BOW_GRAB_RADIUS) {
    bowDrop = null;
    controller.add(bow);
    bow.position.set(0, 0, 0);
    bow.quaternion.identity();
    bow.userData.heldBy = controller;
    d.held = bow;
    d.grabbedWith = button;
    pulse(controller, 0.5, 50);
    return;
  }

  const cube = nearestCube(handPos);
  if (!cube) return;
  cube.userData.held = true;
  cube.userData.velocity.set(0, 0, 0);
  cube.userData.spin.set(0, 0, 0);
  controller.attach(cube);
  d.held = cube;
  d.grabbedWith = button;
  pulse(controller, 0.4, 40);
}

// How fast the hand was moving over the last few frames (for throws and drops)
function handVelocity(controller, out) {
  const h = controller.userData.history;
  out.set(0, 0, 0);
  if (h.length >= 2) {
    const first = h[0];
    const last = h[h.length - 1];
    out.subVectors(last.pos, first.pos).divideScalar(Math.max(last.t - first.t, 1e-3));
  }
  return out;
}

const bowRestEuler = new THREE.Euler();
function updateBowDrop(dt) {
  if (!bowDrop) return;
  const v = bowDrop.velocity;
  v.y -= GRAVITY * dt;
  bow.position.addScaledVector(v, dt);
  bow.rotation.x += bowDrop.spin.x * dt;
  bow.rotation.y += bowDrop.spin.y * dt;
  bow.rotation.z += bowDrop.spin.z * dt;
  if (bow.position.y <= 0.03) {
    bow.position.y = 0.03;
    v.y = -v.y * 0.2;
    v.x *= 0.5;
    v.z *= 0.5;
    bowDrop.spin.multiplyScalar(0.5);
    if (v.lengthSq() < 0.1) {
      // Settle lying on its side, keeping the direction it was facing
      bowRestEuler.setFromQuaternion(bow.quaternion, 'YXZ');
      bow.quaternion.setFromEuler(bowRestEuler.set(0, bowRestEuler.y, Math.PI / 2, 'YXZ'));
      bowDrop = null;
    }
  }
}

function release(controller, button) {
  const d = controller.userData;

  if (d.drawing && d.drawing.button === button) {
    fireArrow(controller);
    return;
  }
  if (!d.held) return;
  const grabbable = d.held.userData.grabbable;
  if (d.grabbedWith !== button) {
    if (button === 'select') grabbable?.onTrigger?.(controller, false);
    return;
  }

  if (grabbable) {
    grabbable.heldBy = null;
    d.held = null;
    d.grabbedWith = null;
    grabbable.onRelease(controller);
    return;
  }

  if (d.held === bow) {
    // Letting go of the bow cancels any draw and drops it where you are
    const other = otherController(controller);
    if (other?.userData.drawing) {
      removeArrow(other.userData.drawing.arrow);
      other.userData.drawing = null;
    }
    scene.attach(bow);
    bow.userData.heldBy = null;
    nockLocal.set(0, 0, BRACE_HEIGHT);
    updateString();
    bowDrop = {
      velocity: handVelocity(controller, new THREE.Vector3()),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4),
    };
    d.held = null;
    d.grabbedWith = null;
    return;
  }

  const cube = d.held;
  scene.attach(cube);
  cube.userData.held = false;
  cube.userData.thrownBy = controller;
  cube.userData.restTime = 0;

  // Throw velocity = recent controller movement
  const h = d.history;
  if (h.length >= 2) {
    const first = h[0];
    const last = h[h.length - 1];
    const dt = Math.max(last.t - first.t, 1e-3);
    cube.userData.velocity.subVectors(last.pos, first.pos).divideScalar(dt).multiplyScalar(THROW_BOOST);
  }
  const speed = cube.userData.velocity.length();
  cube.userData.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(speed * 3);

  d.held = null;
  d.grabbedWith = null;
}

function fireArrow(controller) {
  const { arrow, draw, aim } = controller.userData.drawing;
  controller.userData.drawing = null;
  nockLocal.set(0, 0, BRACE_HEIGHT);
  updateString();

  if (!aim || draw < 0.08) {
    scene.remove(arrow); // barely drawn: just drop it
    return;
  }
  const power = draw / MAX_DRAW;
  arrow.userData.velocity.copy(aim).multiplyScalar(THREE.MathUtils.lerp(ARROW_MIN_SPEED, ARROW_MAX_SPEED, power));
  arrow.userData.shooter = controller;
  arrows.push(arrow);
  while (arrows.length > MAX_ARROWS) removeArrow(arrows[0]);

  pulse(controller, 0.4, 40);
  if (bow.userData.heldBy) pulse(bow.userData.heldBy, 0.4 + power * 0.6, 80);
}

function updateControllers(time) {
  for (const controller of controllers) {
    const d = controller.userData;

    // Track the last few positions to compute throw velocity
    d.history.push({ t: time, pos: controller.getWorldPosition(new THREE.Vector3()) });
    while (d.history.length > 6) d.history.shift();

    // Highlight the cube you'd grab
    const hover = d.held || d.drawing ? null : nearestCube(controller.getWorldPosition(handPos));
    if (d.hovered && d.hovered !== hover) d.hovered.material.emissive.setHex(0x000000);
    if (hover) hover.material.emissive.setHex(0x444444);
    d.hovered = hover;
  }
}

// ---------- Locomotion ----------
const moveForward = new THREE.Vector3();
const moveRight = new THREE.Vector3();
const headPos = new THREE.Vector3();

function snapTurn(angle) {
  // Rotate the rig around the player's head so they turn in place
  camera.getWorldPosition(headPos);
  rig.position.sub(headPos).applyAxisAngle(UP, angle).add(headPos);
  rig.rotation.y += angle;
}

function updateLocomotion(dt) {
  for (const controller of controllers) {
    const d = controller.userData;
    const gamepad = d.inputSource?.gamepad;
    if (!gamepad) continue;
    // xr-standard mapping: thumbstick is axes 2 (x) and 3 (y, forward = -1)
    const x = gamepad.axes[2] ?? 0;
    const y = gamepad.axes[3] ?? 0;

    if (d.inputSource.handedness === 'left') {
      if (Math.hypot(x, y) < STICK_DEADZONE) continue;
      camera.getWorldDirection(moveForward);
      moveForward.y = 0;
      moveForward.normalize();
      moveRight.crossVectors(moveForward, UP);
      rig.position.addScaledVector(moveForward, -y * MOVE_SPEED * dt);
      rig.position.addScaledVector(moveRight, x * MOVE_SPEED * dt);
      if (rig.position.length() > PLAY_AREA_RADIUS) rig.position.setLength(PLAY_AREA_RADIUS);
    } else if (d.inputSource.handedness === 'right') {
      if (!d.turnLatched && Math.abs(x) > 0.7) {
        snapTurn(-Math.sign(x) * SNAP_ANGLE);
        d.turnLatched = true;
      } else if (Math.abs(x) < 0.3) {
        d.turnLatched = false;
      }
    }
  }
}

// ---------- Bow aiming ----------
const bowPos = new THREE.Vector3();
const drawHandPos = new THREE.Vector3();
const holderQuat = new THREE.Quaternion();
const aimQuat = new THREE.Quaternion();
const holderUp = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();

function updateBow() {
  const holder = bow.userData.heldBy;
  const drawer = holder && otherController(holder);

  if (!drawer?.userData.drawing) {
    if (holder) bow.quaternion.identity();
    stringMat.color.setHex(drawer && canNock(drawer) ? 0xffdd33 : 0xeeeeee);
    return;
  }
  stringMat.color.setHex(0xeeeeee);

  const drawing = drawer.userData.drawing;
  holder.getWorldPosition(bowPos);
  drawer.getWorldPosition(drawHandPos);
  const aim = bowPos.clone().sub(drawHandPos);
  const draw = THREE.MathUtils.clamp(aim.length() - BRACE_HEIGHT, 0, MAX_DRAW);
  aim.normalize();

  // Aim the bow along the line from the draw hand through the bow hand
  holder.getWorldQuaternion(holderQuat);
  holderUp.copy(UP).applyQuaternion(holderQuat);
  lookMatrix.lookAt(drawHandPos, bowPos, holderUp); // -Z points from hand toward bow
  aimQuat.setFromRotationMatrix(lookMatrix);
  bow.quaternion.copy(holderQuat.invert()).multiply(aimQuat);
  bow.updateMatrixWorld(true);

  nockLocal.set(0, 0, BRACE_HEIGHT + draw);
  updateString();

  // Arrow tail sits on the string, pointing along the aim
  const arrow = drawing.arrow;
  nockWorld(arrow.position).addScaledVector(aim, ARROW_LENGTH / 2);
  arrow.lookAt(tmpVec.copy(arrow.position).add(aim));

  // Creaky-string haptics that get stronger the further you pull
  if (Math.abs(draw - drawing.lastPulse) > 0.03) {
    pulse(drawer, 0.1 + (draw / MAX_DRAW) * 0.5, 15);
    drawing.lastPulse = draw;
  }
  drawing.draw = draw;
  drawing.aim = aim;
}

// ---------- Physics ----------
function bounce(cube) {
  const v = cube.userData.velocity;
  v.y = -v.y * 0.35;
  if (Math.abs(v.y) < 0.4) v.y = 0;
  v.x *= 0.75;
  v.z *= 0.75;
  cube.userData.spin.multiplyScalar(0.6);
}

function updateCubes(dt) {
  const half = CUBE_SIZE / 2;
  for (const cube of cubes) {
    const d = cube.userData;
    if (d.held || !cube.visible) continue;
    const p = cube.position;
    const v = d.velocity;

    v.y -= GRAVITY * dt;
    p.addScaledVector(v, dt);
    cube.rotation.x += d.spin.x * dt;
    cube.rotation.y += d.spin.y * dt;
    cube.rotation.z += d.spin.z * dt;

    const overTable = p.x > TABLE.minX && p.x < TABLE.maxX && p.z > TABLE.minZ && p.z < TABLE.maxZ;
    let grounded = false;
    if (overTable && v.y <= 0 && p.y < TABLE.top + half && p.y > TABLE.top - 0.1) {
      p.y = TABLE.top + half;
      bounce(cube);
      grounded = true;
    } else if (p.y < half) {
      p.y = half;
      bounce(cube);
      grounded = true;
    }

    if (grounded && Math.hypot(v.x, v.z) < 0.05) {
      v.set(0, 0, 0);
      d.spin.set(0, 0, 0);
    }

    // Cubes stay wherever they land; switching "Table & cubes" off and on resets them

    // Hit detection against targets
    if (v.lengthSq() < 1) continue;
    for (const h of [...hittables]) {
      if (!h.object.visible) continue;
      if (p.distanceTo(h.object.getWorldPosition(hitCenter)) < h.radius + half) h.onHit(d.thrownBy);
    }
  }
}

const arrowPath = new THREE.Line3();
const closestPoint = new THREE.Vector3();
const hitCenter = new THREE.Vector3();

function arrowTip(arrow, out) {
  return arrow.getWorldDirection(out).multiplyScalar(ARROW_LENGTH / 2).add(arrow.position);
}

function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const arrow = arrows[i];
    const d = arrow.userData;

    if (d.stuck) {
      d.life -= dt;
      if (d.life <= 0) removeArrow(arrow);
      continue;
    }

    arrowTip(arrow, arrowPath.start);
    d.velocity.y -= GRAVITY * dt;
    arrow.position.addScaledVector(d.velocity, dt);
    arrow.lookAt(tmpVec.copy(arrow.position).add(d.velocity));
    arrowTip(arrow, arrowPath.end);

    // Check the whole path travelled this frame so fast arrows can't skip past a ring
    const hit = hittables.find((h) => {
      if (!h.object.visible) return false;
      h.object.getWorldPosition(hitCenter);
      return arrowPath.closestPointToPoint(hitCenter, true, closestPoint).distanceTo(hitCenter) < h.radius;
    });
    if (hit) {
      hit.onHit(d.shooter);
      removeArrow(arrow);
    } else if (arrowPath.end.y <= 0) {
      arrow.position.y -= arrowPath.end.y; // stick in the ground
      d.stuck = true;
      d.life = 8;
    } else if (arrow.position.length() > 100) {
      removeArrow(arrow);
    }
  }
}

function updateTargets(time, dt) {
  for (const target of targets) {
    const d = target.userData;
    target.position.y = d.baseY + Math.sin(time * 1.2 + d.phase) * 0.2;
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.t += dt;
    fx.mesh.scale.setScalar(1 + fx.t * 6);
    fx.mesh.material.opacity = Math.max(0, 1 - fx.t / 0.5);
    if (fx.t > 0.5) {
      scene.remove(fx.mesh);
      fx.mesh.geometry.dispose();
      fx.mesh.material.dispose();
      effects.splice(i, 1);
    }
  }
}

// ---------- Features (src/features/*.js, hot-swapped while you play) ----------
// Each feature exports setup(game) and returns { update?(dt, time), dispose?() }.
const game = {
  scene,
  rig,
  camera,
  renderer,
  controllers,
  hittables, // read-only list, e.g. for raycasting shots
  addHittable,
  addGrabbable,
  addScore,
  pulse,
  getHeadPosition: (out) => camera.getWorldPosition(out),
};

// Built-in parts of the game the control panel can switch on and off (everything starts off)
registerBuiltIns([
  { name: 'cubes', label: 'Table & cubes' },
  { name: 'bow', label: 'Bow' },
  { name: 'rings', label: 'Rings' },
]);

function applyBuiltIns() {
  const cubesOn = isEnabled('cubes');
  tableParts.forEach((part) => (part.visible = cubesOn));
  for (const cube of cubes) {
    if (!cubesOn) {
      // Drop it if it's in your hand
      const holder = controllers.find((c) => c.userData.held === cube);
      if (holder) {
        scene.attach(cube);
        cube.userData.held = false;
        holder.userData.held = null;
        holder.userData.grabbedWith = null;
      }
      respawnCube(cube);
    }
    cube.visible = cubesOn;
  }

  const bowOn = isEnabled('bow');
  const bowHolder = bow.userData.heldBy;
  if (!bowOn) {
    if (bowHolder) {
      const other = otherController(bowHolder);
      if (other?.userData.drawing) {
        removeArrow(other.userData.drawing.arrow);
        other.userData.drawing = null;
      }
      bowHolder.userData.held = null;
      bowHolder.userData.grabbedWith = null;
    }
    returnBowToRack(); // so it's back on its stand next time it's switched on
  }
  bow.visible = stand.visible = bowOn;

  const ringsOn = isEnabled('rings');
  targets.forEach((target) => (target.visible = ringsOn));
}
applyBuiltIns();
onToggle((name) => {
  if (name === 'cubes' || name === 'bow' || name === 'rings') applyBuiltIns();
});

let activeFeatures = [];
function startFeatures(list) {
  activeFeatures = list.map((feature) => {
    try {
      return feature.setup(game) ?? {};
    } catch (err) {
      console.error('Feature setup failed', err);
      return {};
    }
  });
}
function stopFeatures() {
  for (const f of activeFeatures) {
    try {
      f.dispose?.();
    } catch (err) {
      console.error('Feature dispose failed', err);
    }
  }
  activeFeatures = [];
}
function updateFeatures(dt, time) {
  for (const f of activeFeatures) {
    try {
      f.update?.(dt, time);
    } catch (err) {
      // A thrown error would stop the XR frame loop and freeze the headset
      console.error('Feature update failed', err);
      f.update = null;
    }
  }
}

startFeatures(features);
if (import.meta.hot) {
  import.meta.hot.accept('./features/index.js', (mod) => {
    if (!mod) return;
    stopFeatures();
    startFeatures(mod.features);
  });
}

// ---------- Loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  updateLocomotion(dt);
  updateControllers(time);
  updateBow();
  updateBowDrop(dt);
  updateFeatures(dt, time);
  updateCubes(dt);
  updateArrows(dt);
  updateTargets(time, dt);
  renderer.render(scene, camera);
});
