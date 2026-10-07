/**
 * Shared layout constants for the procedural K1000 visualization.
 *
 * Units are metres. Coordinate frame: +Y up, +Z forward (nose), -X starboard (right).
 * These dimensions are ILLUSTRATIVE — chosen to approximate a professional heavy-lift
 * quadcopter, not taken from official K1000 engineering data.
 */

export type Vec3 = [number, number, number];

export const BODY = {
  length: 0.58,
  halfWidth: 0.176,
  topHeight: 0.092,
  bottomHeight: 0.07,
  shellThickness: 0.0032,
} as const;

export const ARM = {
  rootRadius: 0.17,
  tipRadius: 0.62,
  y: 0.018,
  tubeRadius: 0.0205,
  hingeRadius: 0.235,
} as const;

export const MOTOR = {
  radius: 0.052,
  height: 0.058,
  baseY: ARM.y + ARM.tubeRadius + 0.006,
} as const;

export const PROP = {
  radius: 0.38,
  y: MOTOR.baseY + MOTOR.height + 0.022,
} as const;

export const GEAR = {
  skidY: -0.405,
  skidX: 0.275,
  skidHalfLength: 0.32,
  mountX: 0.085,
  mountZ: 0.13,
  mountY: -0.058,
} as const;

/** PX4-style quad-X numbering: 1 front-right, 2 rear-left, 3 front-left, 4 rear-right. */
export const ARM_LAYOUT = [
  { index: 1, dir: [-Math.SQRT1_2, Math.SQRT1_2] as [number, number], side: 'Front Right', spin: 'CCW' },
  { index: 2, dir: [Math.SQRT1_2, -Math.SQRT1_2] as [number, number], side: 'Rear Left', spin: 'CCW' },
  { index: 3, dir: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], side: 'Front Left', spin: 'CW' },
  { index: 4, dir: [-Math.SQRT1_2, -Math.SQRT1_2] as [number, number], side: 'Rear Right', spin: 'CW' },
] as const;

export function armPoint(index: number, radius: number, y: number = ARM.y): Vec3 {
  const a = ARM_LAYOUT[index - 1];
  return [a.dir[0] * radius, y, a.dir[1] * radius];
}

/** Rotation about +Y that points local +X along the arm direction. */
export function armYaw(index: number): number {
  const a = ARM_LAYOUT[index - 1];
  return Math.atan2(-a.dir[1], a.dir[0]);
}

export const pad = (n: number) => String(n).padStart(2, '0');
