// Lining the hall up with the phone's world (the AR builder, ar.html). Pure maths, no three.js, so the
// tests can check it. The phone's world is y up (WebXR); the hall frame is trackgen's: x across the
// carpet (0 = the white wall's side), y up the hall (0 = the pilots' rail), z up.
//
// The person taps two points on the floor: A, a known corner of the carpet, then B, any point further
// along a known edge from it. That gives where the hall is and which way it runs.
import { HALL } from './trackgen.js';

/** Where you can line up: a corner of the carpet (at, in hall metres) and the edge to follow from it. */
export const REFS = {
  rail: { name: 'The corners by the rail', at: [0, 0], along: [1, 0], first: 'The corner of the carpet by the pilots\' rail, on the white wall\'s side', second: 'Any point further along the carpet\'s edge by the rail, toward the orange wall: the further, the better' },
  far: { name: 'The corners by the black wall', at: [0, HALL.l], along: [1, 0], first: 'The far corner of the carpet by the black wall, on the white wall\'s side', second: 'Any point further along the carpet\'s edge by the black wall, toward the orange wall: the further, the better' },
  white: { name: 'Along the white wall', at: [0, 0], along: [0, 1], first: 'The corner of the carpet by the pilots\' rail, on the white wall\'s side', second: 'Any point further up the carpet\'s edge along the white wall: the further, the better' },
};
/** The hall's place in the phone's world from the two taps (world points {x, y, z}, y up):
    { ox, oz, floor, yaw } with world = rotateY(yaw) · (hx, hz, -hy) + (ox, floor, oz). Null when A and B
    are too close to tell the way (under 1 m apart). */
export function frameFrom(ref, A, B) {
  const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
  if (d < 1) return null;
  // the hall's own direction of that edge, in the local (x, -y) plane, and where it points in the world
  const [ax, ay] = ref.along;
  const localAng = Math.atan2(-(-ay), ax);           // angle of (ax, 0, -ay) from +x, about y (three.js sense)
  const worldAng = Math.atan2(-dz, dx);
  const yaw = worldAng - localAng;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // the corner A is the hall point ref.at: take its rotated local position away
  const lx = ref.at[0], lz = -ref.at[1];
  const rx = c * lx + s * lz, rz = -s * lx + c * lz;
  return { ox: A.x - rx, oz: A.z - rz, floor: (A.y + B.y) / 2, yaw, span: d };
}
/** A hall point (x, y, z up) in the phone's world, for a frame from frameFrom. */
export function toWorld(f, x, y, z = 0) {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw), lx = x, lz = -y;
  return { x: f.ox + c * lx + s * lz, y: f.floor + z, z: f.oz - s * lx + c * lz };
}
/** A world point back in the hall (x, y, z up). */
export function toHall(f, p) {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw), wx = p.x - f.ox, wz = p.z - f.oz;
  const lx = c * wx - s * wz, lz = s * wx + c * wz;
  return { x: lx, y: -lz, z: p.y - f.floor };
}
