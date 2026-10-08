import * as THREE from 'three';
import { createFx } from './fx.js';
import { trackedControllers } from './hands.js';

// A friendly floating Claude helper bot. It hovers by the bow stand, watches you,
// and gives tips in a speech bubble. Poke it to say hi; hit it and it complains.
const CORAL = 0xd97757;
const HOME = new THREE.Vector3(1.6, 1.45, -1.4); // hovers here, just past the bow stand
const POKE_RADIUS = 0.22;
const TIP_SHOW = 6;
const TIP_GAP = 3;

const TIPS = [
  'The bow is on the stand right of the table.',
  'Gun empty? A or X drops the mag. Grab a new one from your hip!',
  'Blue targets are worth 2 points.',
  'Reach down low and the dog will come to you.',
  'Swing the sword fast to hit things!',
  'Left stick walks, right stick turns.',
  'Throw a cube at the rings!',
  'Pull the bowstring further for faster arrows.',
  'Click the left thumbstick for the control panel.',
  'Spawn a sword fighter from the panel. Block with your sword!',
  'Their blade glows red right before they swing.',
  'Try the missile launcher on the castle!',
  'The llama loves being petted.',
  'Knocked a building down? Rebuild it from the panel.',
  'Having fun? I am!',
];
const POKE_LINES = ['Boop!', 'Hey, that tickles!', 'High five!', 'Hello there!'];
const HIT_LINES = ["Hey! I'm on your side!", 'Ow! Friendly fire!', 'Missed me! ...wait.', 'Rude!'];

export function setup(game) {
  const { scene } = game;
  const fx = createFx(scene);
  const geometries = [];
  const materials = [];
  function add(geo, material, x, y, z, parent) {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  const shell = new THREE.MeshStandardMaterial({ color: CORAL, roughness: 0.45, metalness: 0.1 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf4ede4, roughness: 0.6 });
  const screen = new THREE.MeshStandardMaterial({ color: 0x1f1a17, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffe3d6 });
  const sparkle = new THREE.MeshStandardMaterial({ color: CORAL, emissive: CORAL, emissiveIntensity: 0.8 });
  const jet = new THREE.MeshBasicMaterial({ color: 0xffb08f, transparent: true, opacity: 0.6, depthWrite: false });
  materials.push(shell, cream, screen, glow, sparkle, jet);

  // Bot local space: +Z faces you
  const bot = new THREE.Group();
  const body = new THREE.Group(); // spins and tilts independently of the facing direction
  bot.add(body);
  add(new THREE.SphereGeometry(0.16, 24, 16), shell, 0, 0, 0, body).scale.set(1, 0.9, 0.9);
  add(new THREE.CircleGeometry(0.095, 32), screen, 0, 0.005, 0.146, body).scale.set(1, 0.65, 1);
  const eyes = [-1, 1].map((s) => add(new THREE.BoxGeometry(0.022, 0.04, 0.005), glow, s * 0.035, 0.008, 0.149, body));
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.035, 12, 8), cream, s * 0.155, 0, 0, body); // ear pods

  // Antenna topped with a spinning starburst
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), cream, 0, 0.17, 0, body);
  const star = new THREE.Group();
  star.position.set(0, 0.23, 0);
  body.add(star);
  for (let i = 0; i < 4; i++) {
    add(new THREE.BoxGeometry(0.075, 0.012, 0.012), sparkle, 0, 0, 0, star).rotation.z = (i * Math.PI) / 4;
  }

  // Floating hands
  const hands = [-1, 1].map((s) => add(new THREE.SphereGeometry(0.03, 12, 8), shell, s * 0.21, -0.08, 0.03, body));

  // Hover jet glow underneath
  const jetGlow = add(new THREE.ConeGeometry(0.05, 0.12, 12).rotateX(Math.PI), jet, 0, -0.2, 0, body);

  // Speech bubble
  const bubbleCanvas = document.createElement('canvas');
  bubbleCanvas.width = 768;
  bubbleCanvas.height = 288;
  const bubbleCtx = bubbleCanvas.getContext('2d');
  const bubbleTex = new THREE.CanvasTexture(bubbleCanvas);
  bubbleTex.colorSpace = THREE.SRGBColorSpace;
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false, fog: false }));
  bubble.scale.set(0.62, 0.23, 1);
  bubble.position.set(0, 0.42, 0);
  bubble.visible = false;
  bot.add(bubble);
  materials.push(bubble.material);

  function say(text, seconds = TIP_SHOW) {
    const c = bubbleCtx;
    c.clearRect(0, 0, 768, 288);
    c.fillStyle = '#fffaf5';
    c.strokeStyle = '#d97757';
    c.lineWidth = 10;
    c.beginPath();
    c.roundRect(10, 10, 748, 220, 48);
    c.moveTo(350, 228);
    c.lineTo(384, 280);
    c.lineTo(418, 228);
    c.fill();
    c.stroke();
    c.fillStyle = '#fffaf5';
    c.fillRect(352, 220, 64, 12); // hide the border line under the tail

    // Word-wrap into at most 3 lines
    c.fillStyle = '#3d2b1f';
    c.font = 'bold 46px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (c.measureText(test).width > 680 && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
    const lineHeight = 56;
    const top = 120 - ((lines.length - 1) * lineHeight) / 2;
    lines.slice(0, 3).forEach((l, i) => c.fillText(l, 384, top + i * lineHeight));
    bubbleTex.needsUpdate = true;
    bubble.visible = true;
    speakTime = seconds;
  }

  const headPos = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const botPos = new THREE.Vector3();

  let speakTime = 0;
  let tipTimer = 2;
  let tipIndex = 0;
  let spin = 0;
  let waveTime = 0;
  let blinkTimer = 2;
  let wasPoked = false;

  scene.add(bot);
  say("Hi! I'm Claude. Let's play!", 5);
  waveTime = 2;

  function spinOut() {
    spin = Math.PI * 2;
  }

  const removeHittable = game.addHittable({
    object: bot,
    radius: 0.2,
    onHit(controller) {
      bot.getWorldPosition(botPos);
      fx.sparkBurst(botPos, 10, 2);
      say(HIT_LINES[Math.floor(Math.random() * HIT_LINES.length)], 3);
      spinOut();
      if (controller) game.pulse(controller, 0.6, 80);
    },
  });

  return {
    update(dt, time) {
      fx.update(dt);
      game.getHeadPosition(headPos);

      // Hover in place (gentle bob) and turn to watch you
      bot.position.copy(HOME);
      bot.position.y += Math.sin(time * 2) * 0.04;
      bot.lookAt(headPos);

      // Poke it with a controller
      bot.getWorldPosition(botPos);
      let poked = false;
      for (const controller of trackedControllers(game)) {
        if (controller.getWorldPosition(handPos).distanceTo(botPos) < POKE_RADIUS) {
          poked = true;
          if (!wasPoked) {
            say(POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)], 3);
            waveTime = 1.5;
            game.pulse(controller, 0.4, 40);
          }
        }
      }
      wasPoked = poked;

      // Cycle through tips
      if (speakTime > 0) {
        speakTime -= dt;
        if (speakTime <= 0) {
          bubble.visible = false;
          tipTimer = TIP_GAP;
        }
      } else if ((tipTimer -= dt) <= 0) {
        say(TIPS[tipIndex++ % TIPS.length]);
      }

      // Spin when hit, lean with movement, gentle idle sway
      if (spin > 0) spin = Math.max(0, spin - dt * 14);
      body.rotation.y = spin;
      body.rotation.z = Math.sin(time * 1.5) * 0.06;

      // Blink every few seconds
      blinkTimer -= dt;
      const eyeScale = blinkTimer < 0.12 ? 0.15 : 1;
      if (blinkTimer < 0) blinkTimer = 2 + Math.random() * 3;
      eyes.forEach((e) => (e.scale.y = eyeScale));

      // Hands bob; right hand waves when greeting
      waveTime = Math.max(0, waveTime - dt);
      hands[0].position.y = -0.08 + Math.sin(time * 3) * 0.015;
      if (waveTime > 0) {
        hands[1].position.set(0.22 + Math.sin(time * 14) * 0.03, 0.1, 0.03);
      } else {
        hands[1].position.set(0.21, -0.08 + Math.sin(time * 3 + 1) * 0.015, 0.03);
      }

      star.rotation.z = time * 1.5;
      jetGlow.scale.y = 0.8 + Math.sin(time * 20) * 0.2;
      jet.opacity = 0.45 + Math.sin(time * 13) * 0.15;
    },

    dispose() {
      removeHittable();
      fx.dispose();
      scene.remove(bot);
      bubbleTex.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
