import * as THREE from 'three';
import { createFx } from './fx.js';
import { solids } from './shared.js';
import { addAction } from './toggles.js';

// Two destructible buildings made of blocks: a two-story brick cottage and a stone castle.
// Anything that hits a block (cube, arrow, bullet, sword, missile blast) knocks it loose,
// and any blocks no longer connected to the ground come tumbling down.
const BLOCK = 0.5; // block size in meters
const HALF = BLOCK / 2;
const GRAVITY = 9.8;
const PLAYER_RADIUS = 0.25;
const PLAYER_STEP = 0.55; // you can step over a single fallen block, but not through walls

// Blueprints are written in block units: x/z across, y = layer. Later put() calls overwrite earlier ones.
function blueprint(build) {
  const cells = new Map();
  const put = (x, y, z, color) => cells.set(`${x},${y},${z}`, { x, y, z, color });
  const del = (x, y, z) => cells.delete(`${x},${y},${z}`);
  build(put, del);
  return [...cells.values()];
}

// Two-story cottage: stone foundation, brick walls with cream corner stones, framed windows,
// a front door with a step, wooden upper floor, overhanging gabled roof and a chimney.
function cottage() {
  return blueprint((put, del) => {
    const W = 8;
    const D = 6;
    const H = 7;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let z = 0; z < D; z++) {
          const edgeX = x === 0 || x === W - 1;
          const edgeZ = z === 0 || z === D - 1;
          if (!edgeX && !edgeZ) continue;
          let color = 'brick';
          if (y === 0) color = 'darkStone';
          else if (y === 3) color = 'trim'; // band between the floors
          else if (edgeX && edgeZ && y % 2 === 1) color = 'trim'; // corner stones
          put(x, y, z, color);
        }
      }
    }
    // Upper floor
    for (let x = 1; x < W - 1; x++) for (let z = 1; z < D - 1; z++) put(x, 3, z, 'wood');

    // Windows: 1 wide, 2 tall, with a sill below and lintel above
    const windowAt = (x, z, floorY) => {
      del(x, floorY, z);
      del(x, floorY + 1, z);
      put(x, floorY - 1, z, 'trim');
      put(x, floorY + 2, z, 'trim');
    };
    for (const floorY of [1, 4]) {
      for (const x of [1, 6]) {
        windowAt(x, 0, floorY);
        windowAt(x, D - 1, floorY);
      }
      for (const z of [2, 3]) {
        windowAt(0, z, floorY);
        windowAt(W - 1, z, floorY);
      }
    }
    windowAt(3, D - 1, 4);
    windowAt(4, D - 1, 4);

    // Front door with a step
    for (let y = 0; y < 3; y++) for (const x of [3, 4]) del(x, y, D - 1);
    put(3, 3, D - 1, 'wood');
    put(4, 3, D - 1, 'wood');

    // Gabled roof (ridge runs along X) with a one-block overhang
    for (let k = 0; ; k++) {
      const zMin = -1 + k;
      const zMax = D - k;
      if (zMin > zMax) break;
      const top = zMax - zMin <= 1;
      for (let x = -1; x <= W; x++) {
        for (let z = zMin; z <= zMax; z++) {
          const shell = k === 0 || top || z === zMin || z === zMax || x === -1 || x === W;
          if (!shell) continue;
          put(x, H + k, z, top ? 'roofDark' : 'roof');
        }
      }
    }

    // Chimney
    for (let y = H; y < H + 5; y++) put(6, y, 1, 'darkStone');
    put(6, H + 5, 1, 'trim');
  });
}

// Castle: curtain walls with battlements, a gatehouse, four corner towers with slate roofs,
// and a central keep.
function castle() {
  return blueprint((put, del) => {
    const S = 11;
    const WALL_H = 5;
    const TOWER_H = 9;
    const onRing = (x, z, min, max) => x === min || x === max || z === min || z === max;

    // Curtain walls + battlements (merlons on every other block)
    for (let y = 0; y < WALL_H; y++) {
      for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) if (onRing(x, z, 0, S - 1)) put(x, y, z, y === 0 ? 'darkStone' : 'stone');
    }
    for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) if (onRing(x, z, 0, S - 1) && (x + z) % 2 === 0) put(x, WALL_H, z, 'stone');

    // Gate in the front wall, with a dark lintel
    for (let y = 0; y < 3; y++) for (let x = 4; x <= 6; x++) del(x, y, S - 1);
    for (let x = 3; x <= 7; x++) put(x, 3, S - 1, 'darkStone');

    // Corner towers: 3x3 hollow, taller than the walls, arrow slits, slate cap
    for (const [cx, cz] of [[0, 0], [S - 3, 0], [0, S - 3], [S - 3, S - 3]]) {
      for (let y = 0; y < TOWER_H; y++) {
        for (let dx = 0; dx < 3; dx++) {
          for (let dz = 0; dz < 3; dz++) {
            if (dx === 1 && dz === 1) continue;
            put(cx + dx, y, cz + dz, y === 0 ? 'darkStone' : 'towerStone');
          }
        }
      }
      for (const [dx, dz] of [[1, 0], [1, 2], [0, 1], [2, 1]]) del(cx + dx, 6, cz + dz); // arrow slits
      for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) put(cx + dx, TOWER_H, cz + dz, 'slate');
      put(cx + 1, TOWER_H + 1, cz + 1, 'slate');
      put(cx + 1, TOWER_H + 2, cz + 1, 'trim'); // finial
    }

    // Central keep
    const K0 = 4;
    const K1 = 6;
    for (let y = 0; y < 7; y++) {
      for (let x = K0; x <= K1; x++) for (let z = K0; z <= K1; z++) if (onRing(x, z, K0, K1)) put(x, y, z, 'towerStone');
    }
    del(5, 0, K1);
    del(5, 1, K1); // keep door
    del(5, 4, K0);
    del(5, 4, K1); // windows
    for (let x = K0; x <= K1; x++) for (let z = K0; z <= K1; z++) put(x, 7, z, 'slate');
    put(5, 8, 5, 'slate');
    put(5, 9, 5, 'trim');
  });
}

const BUILDINGS = [
  { blueprint: cottage, center: new THREE.Vector3(-10, 0, -7) },
  { blueprint: castle, center: new THREE.Vector3(11, 0, -10) },
];

const PALETTES = {
  brick: [0xb5523b, 0xa8492f, 0xc0603f, 0x9e4a35],
  trim: [0xe8dcc0, 0xdcd0b2],
  darkStone: [0x5d5f63, 0x55575b, 0x66686c],
  wood: [0x8a5a33, 0x7d5030],
  roof: [0x8e2c25, 0x9c3329, 0x86281f],
  roofDark: [0x6e211b],
  stone: [0x9a9a92, 0x8a8c86, 0xa7a59c, 0x92938b],
  towerStone: [0x85878a, 0x7a7c80, 0x8f9194],
  slate: [0x46566b, 0x4f6075, 0x3f4e61],
};

export function setup(game) {
  const { scene } = game;
  const fx = createFx(scene);
  const geo = new THREE.BoxGeometry(BLOCK * 0.98, BLOCK * 0.98, BLOCK * 0.98);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const matrix = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const headPos = new THREE.Vector3();

  const buildings = BUILDINGS.map((def) => {
    const layout = def.blueprint();
    // Center the footprint on the building's spot
    const xs = layout.map((b) => b.x);
    const zs = layout.map((b) => b.z);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;

    const mesh = new THREE.InstancedMesh(geo, mat, layout.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const building = { mesh, blocks: [], grid: new Map(), center: def.center, midX, midZ };

    layout.forEach((b, i) => {
      const home = new THREE.Vector3(
        def.center.x + (b.x - midX) * BLOCK,
        b.y * BLOCK + BLOCK / 2,
        def.center.z + (b.z - midZ) * BLOCK
      );
      const palette = PALETTES[b.color];
      mesh.setColorAt(i, new THREE.Color(palette[Math.abs(b.x * 7 + b.y * 3 + b.z * 5) % palette.length]));
      const proxy = new THREE.Object3D(); // what hits are tested against
      proxy.position.copy(home);
      scene.add(proxy);
      const block = {
        building,
        index: i,
        cell: [b.x, b.y, b.z],
        home,
        pos: home.clone(),
        quat: new THREE.Quaternion(),
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        state: 'static', // 'static' | 'falling' | 'resting'
        proxy,
      };
      block.removeHittable = game.addHittable({
        object: proxy,
        radius: BLOCK * 0.62,
        onHit: (controller, info) => knockOut(block, info),
      });
      building.blocks.push(block);
      building.grid.set(`${b.x},${b.y},${b.z}`, block);
    });
    return building;
  });

  function writeMatrix(block) {
    matrix.compose(block.pos, block.quat, one);
    block.building.mesh.setMatrixAt(block.index, matrix);
    block.building.mesh.instanceMatrix.needsUpdate = true;
  }

  function rebuild() {
    for (const building of buildings) {
      for (const block of building.blocks) {
        block.pos.copy(block.home);
        block.quat.identity();
        block.vel.set(0, 0, 0);
        block.spin.set(0, 0, 0);
        block.state = 'static';
        block.proxy.visible = true;
        writeMatrix(block);
      }
      building.mesh.instanceColor.needsUpdate = true;
    }
  }
  rebuild();

  function setFalling(block, impulse) {
    block.state = 'falling';
    block.proxy.visible = false; // no longer hittable
    block.vel.copy(impulse);
    block.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6);
  }

  // Blocks still connected (face to face) to a ground-level block stay up; the rest fall
  function collapseUnsupported(building) {
    const supported = new Set();
    const queue = building.blocks.filter((b) => b.state === 'static' && b.cell[1] === 0);
    queue.forEach((b) => supported.add(b));
    while (queue.length) {
      const [x, y, z] = queue.pop().cell;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const next = building.grid.get(`${x + dx},${y + dy},${z + dz}`);
        if (next && next.state === 'static' && !supported.has(next)) {
          supported.add(next);
          queue.push(next);
        }
      }
    }
    for (const block of building.blocks) {
      if (block.state === 'static' && !supported.has(block)) {
        setFalling(block, new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6));
      } else if (block.state === 'resting' && block.pos.y > HALF + 0.05) {
        // Rubble sitting up on the building: let it re-check whether it's still supported
        block.state = 'falling';
        block.vel.set(0, 0, 0);
        block.spin.set(0, 0, 0);
      }
    }
  }

  function knockOut(block, info) {
    if (block.state !== 'static') return;
    // Push away from the blast point, or away from you for direct hits
    const from = info?.point ?? game.getHeadPosition(headPos);
    const force = info?.force ?? 4;
    const dir = block.pos.clone().sub(from).normalize();
    dir.y = Math.max(dir.y, 0) + 0.35;
    setFalling(block, dir.multiplyScalar(force * (0.7 + Math.random() * 0.6)));

    // A direct hit also shakes loose a neighbor or two
    if (!info?.point) {
      const [x, y, z] = block.cell;
      const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]
        .map(([dx, dy, dz]) => block.building.grid.get(`${x + dx},${y + dy},${z + dz}`))
        .filter((n) => n && n.state === 'static');
      for (const n of neighbors) {
        if (Math.random() < 0.35) setFalling(n, dir.clone().multiplyScalar(0.5 + Math.random()));
      }
    }

    fx.sparkBurst(block.pos, 8, 2.5, [0xc9b49a, 0x8a7a66, 0xe0d4c0], 1.6);
    fx.puff(block.pos, { color: 0xc9b9a3, size: 0.25, grow: 3, life: 1.2, rise: 0.4, opacity: 0.5 });
    collapseUnsupported(block.building);
  }

  // ---------- Solidity: nothing passes through standing blocks ----------
  const staticAt = (building, x, y, z) => {
    const block = building.grid.get(`${x},${y},${z}`);
    return block && block.state === 'static' ? block : null;
  };
  const toCell = (building, x, y, z) => [
    Math.round((x - building.center.x) / BLOCK + building.midX),
    Math.round((y - HALF) / BLOCK),
    Math.round((z - building.center.z) / BLOCK + building.midZ),
  ];

  const solid = {
    // Characters: push a vertical capsule (XZ circle spanning minY..maxY) out of walls
    pushOut(position, radius, minY, maxY) {
      let moved = false;
      const reach = Math.ceil(radius / BLOCK) + 1;
      const y0 = Math.max(0, Math.floor(minY / BLOCK));
      const y1 = Math.floor(maxY / BLOCK);
      for (const building of buildings) {
        const [cx, , cz] = toCell(building, position.x, 0, position.z);
        for (let ix = cx - reach; ix <= cx + reach; ix++) {
          for (let iz = cz - reach; iz <= cz + reach; iz++) {
            for (let iy = y0; iy <= y1; iy++) {
              const block = staticAt(building, ix, iy, iz);
              if (!block) continue;
              const nx = THREE.MathUtils.clamp(position.x, block.home.x - HALF, block.home.x + HALF);
              const nz = THREE.MathUtils.clamp(position.z, block.home.z - HALF, block.home.z + HALF);
              const dx = position.x - nx;
              const dz = position.z - nz;
              const d2 = dx * dx + dz * dz;
              if (d2 >= radius * radius) continue;
              if (d2 > 1e-10) {
                const d = Math.sqrt(d2);
                position.x += (dx / d) * (radius - d);
                position.z += (dz / d) * (radius - d);
              } else {
                // Center is inside the block: leave by the nearest face
                const px = position.x - block.home.x;
                const pz = position.z - block.home.z;
                if (Math.abs(px) > Math.abs(pz)) position.x = block.home.x + Math.sign(px || 1) * (HALF + radius);
                else position.z = block.home.z + Math.sign(pz || 1) * (HALF + radius);
              }
              moved = true;
            }
          }
        }
      }
      return moved;
    },

    // Points (blade samples, dropped items, falling blocks): smallest push out of a block,
    // never toward a neighboring solid block, so things can't be shoved deeper into a wall
    correction(point, radius, out) {
      let found = false;
      out.set(0, 0, 0);
      for (const building of buildings) {
        const [cx, cy, cz] = toCell(building, point.x, point.y, point.z);
        for (let ix = cx - 1; ix <= cx + 1; ix++) {
          for (let iy = cy - 1; iy <= cy + 1; iy++) {
            for (let iz = cz - 1; iz <= cz + 1; iz++) {
              const block = staticAt(building, ix, iy, iz);
              if (!block) continue;
              const dx = point.x - block.home.x;
              const dy = point.y - block.home.y;
              const dz = point.z - block.home.z;
              const ext = HALF + radius;
              if (Math.abs(dx) >= ext || Math.abs(dy) >= ext || Math.abs(dz) >= ext) continue;
              let best = null;
              for (const [axis, d, nx, ny, nz] of [
                ['x', dx, Math.sign(dx || 1), 0, 0],
                ['y', dy, 0, Math.sign(dy || 1), 0],
                ['z', dz, 0, 0, Math.sign(dz || 1)],
              ]) {
                if (staticAt(building, ix + nx, iy + ny, iz + nz)) continue; // that side is buried
                const depth = ext - Math.abs(d);
                if (!best || depth < best.depth) best = { axis, depth, sign: Math.sign(d || 1) };
              }
              if (!best) continue;
              const push = best.depth * best.sign;
              if (!found || Math.abs(push) > out.length()) {
                out.set(0, 0, 0);
                out[best.axis] = push;
              }
              found = true;
            }
          }
        }
      }
      return found;
    },
  };
  solids.add(solid);

  const removeAction = addAction({ label: 'Rebuild buildings', run: rebuild });

  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const fix = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const feet = new THREE.Vector3();

  // Bounce a falling block off a surface with this normal; settle if it's slow and on top of something
  function bounce(block, n) {
    const vn = block.vel.dot(n);
    if (vn < 0) block.vel.addScaledVector(n, -1.25 * vn);
    block.vel.multiplyScalar(0.6);
    block.spin.multiplyScalar(0.5);
    if (n.y > 0.5 && block.vel.lengthSq() < 0.05) {
      block.state = 'resting';
      tmpEuler.setFromQuaternion(block.quat, 'YXZ');
      block.quat.setFromEuler(tmpEuler.set(0, tmpEuler.y, 0, 'YXZ'));
    }
  }

  return {
    update(dt) {
      fx.update(dt);

      // You can't walk (or lean) through walls: push your body back out
      game.getHeadPosition(headPos);
      feet.set(headPos.x, 0, headPos.z);
      if (solid.pushOut(feet, PLAYER_RADIUS, PLAYER_STEP, headPos.y)) {
        game.rig.position.x += feet.x - headPos.x;
        game.rig.position.z += feet.z - headPos.z;
      }

      for (const building of buildings) {
        for (const block of building.blocks) {
          if (block.state !== 'falling') continue;
          block.vel.y -= GRAVITY * dt;
          block.pos.addScaledVector(block.vel, dt);
          tmpQuat.setFromEuler(tmpEuler.set(block.spin.x * dt, block.spin.y * dt, block.spin.z * dt));
          block.quat.premultiply(tmpQuat);

          // Land on (or bounce off) standing blocks
          if (solid.correction(block.pos, HALF * 0.85, fix)) {
            block.pos.add(fix);
            bounce(block, normal.copy(fix).normalize());
          }
          // ...and on rubble that has already settled
          if (block.state === 'falling') {
            for (const other of building.blocks) {
              if (other.state !== 'resting') continue;
              const d = block.pos.distanceTo(other.pos);
              if (d >= BLOCK * 0.9 || d < 1e-6) continue;
              normal.subVectors(block.pos, other.pos).normalize();
              if (normal.y < 0.3) normal.y = 0.3; // favor stacking on top
              normal.normalize();
              block.pos.addScaledVector(normal, BLOCK * 0.9 - d);
              bounce(block, normal);
              break;
            }
          }

          // Bounce and settle on the ground
          if (block.state === 'falling' && block.pos.y < HALF) {
            block.pos.y = HALF;
            if (block.vel.y < -1.5) fx.puff(block.pos, { color: 0xc9b9a3, size: 0.2, grow: 2, life: 0.8, rise: 0.2, opacity: 0.4 });
            bounce(block, normal.set(0, 1, 0));
          }
          writeMatrix(block);
        }
      }
    },

    dispose() {
      solids.delete(solid);
      removeAction();
      fx.dispose();
      for (const building of buildings) {
        for (const block of building.blocks) {
          block.removeHittable();
          scene.remove(block.proxy);
        }
        scene.remove(building.mesh);
        building.mesh.dispose();
      }
      geo.dispose();
      mat.dispose();
    },
  };
}
