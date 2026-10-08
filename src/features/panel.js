import * as THREE from 'three';
import { isTracked } from './hands.js';
import { getActions, getFeatures, isEnabled, onActionsChanged, onToggle, setEnabled } from './toggles.js';

// Control panel: two columns of on/off switches, then action buttons features add
// (e.g. "Spawn sword fighter"). Point a controller at it and pull the TRIGGER.
// Click the LEFT THUMBSTICK to bring the panel in front of you.
export const switchable = false; // the panel can't switch itself off

const HOME = new THREE.Vector3(-1.4, 1.35, 0.2);
const CANVAS_W = 1024;
const PX_PER_M = 1100; // canvas pixels per meter of panel
const HEADER_H = 110;
const ROW_H = 72;
const SECTION_GAP = 24;
const COLS = 2;
const POINTER_RANGE = 4;
const SUMMON_BUTTON = 3; // thumbstick press

export function setup(game) {
  const { scene } = game;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const panel = new THREE.Group();
  const faceMat = new THREE.MeshBasicMaterial({ map: texture, fog: false });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.02), backMat);
  back.position.z = -0.012;
  panel.add(face, back);
  scene.add(panel);

  // Layout: cells are { kind: 'toggle' | 'action', item, x, y, w, h }
  let cells = [];
  let canvasH = 0;
  function layout() {
    const features = getFeatures();
    const actions = getActions();
    const colW = (CANVAS_W - 32) / COLS;
    cells = [];
    features.forEach((item, i) => {
      cells.push({ kind: 'toggle', item, x: 16 + (i % COLS) * colW, y: HEADER_H + Math.floor(i / COLS) * ROW_H, w: colW, h: ROW_H });
    });
    const toggleRows = Math.ceil(features.length / COLS);
    const actionTop = HEADER_H + toggleRows * ROW_H + (actions.length ? SECTION_GAP : 0);
    actions.forEach((item, i) => {
      cells.push({ kind: 'action', item, x: 16 + (i % COLS) * colW, y: actionTop + Math.floor(i / COLS) * ROW_H, w: colW, h: ROW_H });
    });
    canvasH = actionTop + Math.ceil(actions.length / COLS) * ROW_H + 20;
    canvas.height = canvasH;

    const width = CANVAS_W / PX_PER_M;
    const height = canvasH / PX_PER_M;
    face.geometry.dispose();
    face.geometry = new THREE.PlaneGeometry(width, height);
    back.geometry.dispose();
    back.geometry = new THREE.BoxGeometry(width + 0.02, height + 0.02, 0.02);
    drawnKey = '';
  }

  function placeAt(position, faceToward) {
    panel.position.copy(position);
    panel.lookAt(faceToward.x, panel.position.y, faceToward.z);
  }
  placeAt(HOME, new THREE.Vector3(0, HOME.y, 0.4));

  // Laser pointers, one per controller, shown only while pointing at the panel
  const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const laserMat = new THREE.LineBasicMaterial({ color: 0x7dd3ff });
  const pointers = game.controllers.map((controller) => {
    const laser = new THREE.Line(laserGeo, laserMat);
    laser.visible = false;
    controller.add(laser);
    const pointer = { controller, laser, cell: null, summonWasPressed: false, pressed: 0 };
    pointer.onSelect = () => {
      const cell = pointer.cell;
      if (!cell) return;
      if (cell.kind === 'toggle') {
        setEnabled(cell.item.name, !isEnabled(cell.item.name));
      } else {
        cell.item.run();
        pointer.pressed = 0.15; // flash the button
      }
      game.pulse(controller, 0.5, 40);
    };
    controller.addEventListener('selectstart', pointer.onSelect);
    return pointer;
  });

  let drawnKey = '';
  function draw() {
    const hovered = new Set(pointers.map((p) => p.cell));
    const pressed = new Set(pointers.filter((p) => p.pressed > 0).map((p) => p.cell));
    const key = cells.map((cell) => `${cell.kind === 'toggle' && isEnabled(cell.item.name)}${hovered.has(cell)}${pressed.has(cell)}`).join();
    if (key === drawnKey) return;
    drawnKey = key;

    const c = ctx;
    c.fillStyle = '#16181d';
    c.fillRect(0, 0, CANVAS_W, canvasH);
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.font = 'bold 44px system-ui, sans-serif';
    c.fillText('Control panel', 28, 46);
    c.fillStyle = '#9aa3b2';
    c.font = '24px system-ui, sans-serif';
    c.fillText('Point + trigger to use  ·  Click left stick to bring it to you', 28, 90);

    for (const cell of cells) {
      const isHover = hovered.has(cell);
      const { x, y, w, h } = cell;
      if (cell.kind === 'toggle') {
        const on = isEnabled(cell.item.name);
        c.fillStyle = isHover ? '#2c313b' : '#20232a';
        c.beginPath();
        c.roundRect(x + 4, y + 4, w - 8, h - 8, 14);
        c.fill();
        c.fillStyle = on ? '#ffffff' : '#7d8492';
        c.font = 'bold 30px system-ui, sans-serif';
        c.fillText(cell.item.label, x + 22, y + h / 2);
        const sx = x + w - 112;
        const sy = y + h / 2 - 19;
        c.fillStyle = on ? '#34c86a' : '#4a505c';
        c.beginPath();
        c.roundRect(sx, sy, 84, 38, 19);
        c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(on ? sx + 65 : sx + 19, sy + 19, 15, 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillStyle = pressed.has(cell) ? '#f2b05e' : isHover ? '#e08a5f' : '#c96f4a';
        c.beginPath();
        c.roundRect(x + 4, y + 4, w - 8, h - 8, 14);
        c.fill();
        c.fillStyle = '#ffffff';
        c.font = 'bold 30px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText(cell.item.label, x + w / 2, y + h / 2);
        c.textAlign = 'left';
      }
    }
    texture.needsUpdate = true;
  }

  layout();
  draw();
  const unsubscribeToggle = onToggle(() => draw());
  const unsubscribeActions = onActionsChanged(() => {
    pointers.forEach((p) => (p.cell = null));
    layout();
    draw();
  });

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const summonPos = new THREE.Vector3();

  return {
    update(dt) {
      for (const p of pointers) {
        const { controller } = p;
        p.pressed = Math.max(0, p.pressed - dt);
        if (!isTracked(controller)) {
          p.cell = null;
          p.laser.visible = false;
          continue;
        }

        // Left thumbstick click brings the panel in front of you
        const buttons = controller.userData.inputSource?.gamepad?.buttons;
        const isLeft = controller.userData.inputSource?.handedness === 'left';
        const summonPressed = isLeft && !!buttons?.[SUMMON_BUTTON]?.pressed;
        if (summonPressed && !p.summonWasPressed) {
          game.getHeadPosition(headPos);
          game.camera.getWorldDirection(forward);
          forward.y = 0;
          if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
          forward.normalize();
          summonPos.copy(headPos).addScaledVector(forward, 0.8);
          summonPos.y = headPos.y - 0.2;
          placeAt(summonPos, headPos);
          game.pulse(controller, 0.3, 30);
        }
        p.summonWasPressed = summonPressed;

        // Point at the panel
        controller.getWorldPosition(origin);
        direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
        raycaster.set(origin, direction);
        raycaster.far = POINTER_RANGE;
        const hit = raycaster.intersectObject(face, false)[0];
        p.cell = null;
        if (hit?.uv) {
          const px = hit.uv.x * CANVAS_W;
          const py = (1 - hit.uv.y) * canvasH;
          p.cell = cells.find((cell) => px >= cell.x && px < cell.x + cell.w && py >= cell.y && py < cell.y + cell.h) ?? null;
          p.laser.visible = true;
          p.laser.scale.z = hit.distance;
        } else {
          p.laser.visible = false;
        }
      }
      draw();
    },

    dispose() {
      unsubscribeToggle();
      unsubscribeActions();
      for (const p of pointers) {
        p.controller.removeEventListener('selectstart', p.onSelect);
        p.controller.remove(p.laser);
      }
      scene.remove(panel);
      texture.dispose();
      face.geometry.dispose();
      back.geometry.dispose();
      laserGeo.dispose();
      [faceMat, backMat, laserMat].forEach((m) => m.dispose());
    },
  };
}
