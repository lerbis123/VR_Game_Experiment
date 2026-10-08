import * as THREE from 'three';

// State shared between features. No setup() export, so it isn't a feature itself.

// Blades the player is holding, so enemies can clash with them:
// { controller, base: Vector3, tip: Vector3, correction: Vector3 }
// Enemies add to `correction` (world space) to push the blade out of theirs;
// the sword feature applies it next frame, which is what makes blocking feel solid.
export const blades = new Set();

// Solid world geometry (building walls) nothing should pass through. Each solid provides:
//   pushOut(position, radius, minY, maxY) — moves a standing character's XZ position out
//     of anything solid between heights minY..maxY; returns true if it moved
//   correction(point, radius, out) — smallest 3D push that gets a point out; returns true if inside
export const solids = new Set();

export function pushOutOfSolids(position, radius, minY = 0.05, maxY = 1.8) {
  let moved = false;
  for (const solid of solids) moved = solid.pushOut(position, radius, minY, maxY) || moved;
  return moved;
}

const pointFix = new THREE.Vector3();
export function solidCorrection(point, radius, out) {
  out.set(0, 0, 0);
  let inside = false;
  for (const solid of solids) {
    if (solid.correction(point, radius, pointFix)) {
      if (!inside || pointFix.lengthSq() > out.lengthSq()) out.copy(pointFix);
      inside = true;
    }
  }
  return inside;
}

// Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection).
// Writes them to c1 / c2 and returns the distance between them.
const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();
const r = new THREE.Vector3();
export function closestSegmentPoints(p1, q1, p2, q2, c1, c2) {
  const EPS = 1e-8;
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  r.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s;
  let t;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
