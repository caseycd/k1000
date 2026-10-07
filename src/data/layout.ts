/**
 * Shared layout constants for the K1000ULE visualization.
 *
 * Units are metres. Frame: +Y up, +Z forward (nose), +X port (left wing), -X starboard.
 *
 * Proportions were traced from Kraus Hamdani Aerospace's public product imagery
 * (top view and 3/4 renders). Absolute scale is NOT published — the wingspan below is
 * an illustrative assumption, so every dimension derived from it is illustrative too.
 */

export type Vec3 = [number, number, number];

/** Illustrative wingspan; every other dimension is a ratio of this, traced from imagery. */
export const SPAN = 5.0;
const k = SPAN / 1380; // metres per pixel of the reference top view

export const WING = {
  halfSpan: SPAN / 2,
  rootChord: 85 * k,
  /** spanwise position where the elliptical tip begins */
  tipStart: 1.9,
  /** trailing edge z at the root */
  teZ: -0.05,
  /** chord-line height at the root (wing sits on top of the fuselage pod) */
  y: 0.1,
  dihedralDeg: 2.5,
  aileron: { inner: 1.36, outer: 2.2, hinge: 0.76 },
} as const;

export const FUSELAGE = {
  noseZ: 0.95,
  podEndZ: -0.62,
  tailEndZ: 0.95 - 675 * k,
  shellThickness: 0.0028,
} as const;

export const BOOM = {
  x: 217 * k,
  frontZ: 0.95 - 60 * k,
  rearZ: 0.95 - 430 * k,
  radius: 0.024,
  /** lift rotor stations along the booms */
  rotorFrontZ: 0.95 - 75 * k,
  rotorRearZ: 0.95 - 412 * k,
} as const;

export const LIFT = {
  motorRadius: 0.03,
  motorHeight: 0.036,
  propRadius: (105 / 2) * k,
} as const;

export const CRUISE = {
  propRadius: (120 / 2) * k,
  z: 0.985,
} as const;

export const TAIL = {
  finRootLE: -1.1,
  finRootTE: -1.47,
  finTipLE: -1.3,
  finTipTE: -1.48,
  finBaseY: 0.03,
  finTipY: 0.45,
  stabHalfSpan: (294 / 2) * k,
  stabLE: 0.95 - 675 * k + 50 * k,
  stabTE: 0.95 - 675 * k,
} as const;

export const GEAR = {
  footY: -0.205,
  bellySkidY: -0.11,
} as const;

/** dihedral rise of the wing chord line at spanwise station |x| */
export const wingY = (x: number) => WING.y + Math.abs(x) * Math.tan((WING.dihedralDeg * Math.PI) / 180);

/** chord and leading/trailing edge z at spanwise station |x| (elliptical tips) */
export function wingStation(xAbs: number) {
  const c0 = WING.rootChord;
  let c = c0;
  if (xAbs > WING.tipStart) {
    const t = Math.min(1, (xAbs - WING.tipStart) / (WING.halfSpan - WING.tipStart));
    c = Math.max(0.035, c0 * Math.sqrt(Math.max(0, 1 - t * t)));
  }
  const te = WING.teZ + 0.35 * (c0 - c);
  return { chord: c, te, le: te + c };
}

/**
 * Quad-X lift rotor numbering (PX4 style): 1 front-right, 2 rear-left, 3 front-left,
 * 4 rear-right. Port (+X) boom carries 2 and 3, starboard (-X) boom carries 1 and 4.
 */
export const LIFT_LAYOUT = [
  { index: 1, x: -BOOM.x, z: BOOM.rotorFrontZ, side: 'Front Right', boom: 'Starboard', spin: 'CCW' },
  { index: 2, x: BOOM.x, z: BOOM.rotorRearZ, side: 'Rear Left', boom: 'Port', spin: 'CCW' },
  { index: 3, x: BOOM.x, z: BOOM.rotorFrontZ, side: 'Front Left', boom: 'Port', spin: 'CW' },
  { index: 4, x: -BOOM.x, z: BOOM.rotorRearZ, side: 'Rear Right', boom: 'Starboard', spin: 'CW' },
] as const;

export const BOOM_Y = wingY(BOOM.x) - 0.075;
export const MOTOR_BASE_Y = BOOM_Y + BOOM.radius + 0.002;
export const LIFT_PROP_Y = MOTOR_BASE_Y + LIFT.motorHeight + 0.016;

export const pad = (n: number) => String(n).padStart(2, '0');

/** Overall envelope (mm) — illustrative because the absolute scale is assumed. */
export const ENVELOPE = {
  span: Math.round(SPAN * 1000),
  length: Math.round((FUSELAGE.noseZ + 0.05 - FUSELAGE.tailEndZ) * 1000),
  height: Math.round((TAIL.finTipY + 0.02 - GEAR.footY) * 1000),
};
