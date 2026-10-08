import * as THREE from 'three';

// Shared cartoon effects. No setup() export, so it isn't loaded as a feature itself.
const SPARK_COLORS = [0xfff27a, 0xffb43b, 0xffffff];

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

export function createFx(scene) {
  const sparkGeo = new THREE.OctahedronGeometry(0.03, 0);
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const sparkMats = new Map(); // color -> material
  let heartTex = null;
  const sparks = [];
  const popups = [];
  const puffs = [];
  const hearts = [];

  function sparkMat(color) {
    if (!sparkMats.has(color)) sparkMats.set(color, new THREE.MeshBasicMaterial({ color, fog: false }));
    return sparkMats.get(color);
  }

  // Little bits flying out: sparks by default, or pass colors for debris
  function sparkBurst(position, count = 14, speed = 3, colors = SPARK_COLORS, size = 1) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat(colors[i % colors.length]));
      mesh.position.copy(position);
      const vel = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.5 + Math.random()));
      vel.y += 1;
      scene.add(mesh);
      sparks.push({ mesh, vel, t: 0, life: 0.5 + Math.random() * 0.3, size });
    }
  }

  // Soft ball of smoke/dust/fire that grows, rises and fades
  function puff(position, { color = 0xcccccc, size = 0.15, grow = 2, life = 1, rise = 0.3, opacity = 0.6, drift = null } = {}) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const mesh = new THREE.Mesh(puffGeo, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(size);
    scene.add(mesh);
    puffs.push({ mesh, t: 0, life, size, grow, rise, opacity, drift });
  }

  // A heart that floats up and fades
  function heart(position) {
    heartTex ??= makeHeartTexture();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
    sprite.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.1, (Math.random() - 0.5) * 0.15));
    sprite.scale.setScalar(0.08);
    scene.add(sprite);
    hearts.push({ sprite, t: 0, drift: (Math.random() - 0.5) * 0.2 });
  }

  // Comic-book word that pops up and floats away
  function popup(text, position, color = '#ffe14d') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const c = canvas.getContext('2d');
    c.font = 'italic 900 78px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 14;
    c.strokeStyle = '#1a1a1a';
    c.strokeText(text, 128, 66);
    c.fillStyle = color;
    c.fillText(text, 128, 66);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sprite.position.copy(position);
    sprite.material.rotation = (Math.random() - 0.5) * 0.4;
    scene.add(sprite);
    popups.push({ sprite, tex, t: 0 });
  }

  function update(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += dt;
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += dt * 10;
      s.mesh.rotation.y += dt * 7;
      s.mesh.scale.setScalar(Math.max(0.01, (1 - s.t / s.life) * s.size));
      if (s.t > s.life) {
        scene.remove(s.mesh);
        sparks.splice(i, 1);
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.t += dt;
      const k = p.t / p.life;
      p.mesh.scale.setScalar(p.size * (1 + k * p.grow));
      p.mesh.position.y += p.rise * dt;
      if (p.drift) p.mesh.position.addScaledVector(p.drift, dt);
      p.mesh.material.opacity = p.opacity * Math.max(0, 1 - k);
      if (p.t > p.life) {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        puffs.splice(i, 1);
      }
    }
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
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.t += dt;
      // Pop in big, settle, then float up and fade
      const pop = p.t < 0.12 ? (p.t / 0.12) * 1.3 : Math.max(1, 1.3 - (p.t - 0.12) * 2);
      p.sprite.scale.set(0.6 * pop, 0.3 * pop, 1);
      p.sprite.position.y += dt * 0.4;
      p.sprite.material.opacity = Math.min(1, (1.1 - p.t) / 0.4);
      if (p.t > 1.1) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
        p.tex.dispose();
        popups.splice(i, 1);
      }
    }
  }

  function dispose() {
    sparks.forEach((s) => scene.remove(s.mesh));
    puffs.forEach((p) => {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
    });
    hearts.forEach((h) => {
      scene.remove(h.sprite);
      h.sprite.material.dispose();
    });
    popups.forEach((p) => {
      scene.remove(p.sprite);
      p.sprite.material.dispose();
      p.tex.dispose();
    });
    sparkGeo.dispose();
    puffGeo.dispose();
    heartTex?.dispose();
    sparkMats.forEach((m) => m.dispose());
  }

  return { sparkBurst, puff, heart, popup, update, dispose };
}
