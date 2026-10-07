/**
 * Procedural K1000 visualization model.
 *
 * No official K1000 CAD data is used: every part is generated from parametric
 * geometry approximating a professional heavy-lift quadcopter. Each entry in the
 * component database gets its own THREE.Group (pivoted at its anchor) so it can be
 * exploded, hidden, highlighted and inspected independently.
 *
 * Draw calls are kept low by merging each component's geometry per material.
 * Fasteners use InstancedMesh.
 */
import * as THREE from 'three';
import { COMPONENTS, type DroneComponent } from '../data/components';
import { ARM, ARM_LAYOUT, BODY, GEAR, MOTOR, PROP, armYaw, pad } from '../data/layout';
import {
  alignY,
  box,
  circlePath,
  cyl,
  lathe,
  merge,
  plate,
  propBlade,
  rbox,
  scaleUV,
  slotPath,
  sphere,
  surfaceFrame,
  surfaceSlab,
  tint,
  torus,
  tube,
  tubeCurve,
  xf,
  type SurfaceFn,
  type V3,
} from './geometry';
import {
  LED_KEYS,
  createComponentUniforms,
  patchMaterial,
  type ComponentUniforms,
  type MatKey,
  type MaterialLibrary,
} from './materials';
import { armDecal, glowTexture, serialPlate, wearMark } from './textures';

export interface ComponentNode {
  id: string;
  data: DroneComponent;
  group: THREE.Group;
  /** child that rotates during the spin test (props) */
  spin: THREE.Group;
  basePosition: THREE.Vector3;
  meshes: THREE.Object3D[];
  /** fastener instances parented to this component (owned by the 'fasteners' node) */
  fastenerMeshes: THREE.Object3D[];
  materials: THREE.Material[];
  uniforms: ComponentUniforms;
  localBox: THREE.Box3;
  // animated state
  dim: number;
  hi: number;
  hov: number;
  fade: number;
  transparent: boolean;
}

export interface DroneModel {
  root: THREE.Group;
  nodes: Map<string, ComponentNode>;
  pickables: THREE.Object3D[];
  ledMaterials: THREE.MeshStandardMaterial[];
  glows: THREE.Sprite[];
  recLamp: THREE.MeshStandardMaterial[];
  triangles: number;
}

// ───────────────────────────────────────────────────────── body surface
const SE = 3.0;
const sp = (c: number, n: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const bodySurface: SurfaceFn = (u0, v, out) => {
  const u = clamp01(u0);
  const s = Math.max(0, Math.sin(Math.PI * u));
  const a = BODY.halfWidth * Math.pow(s, 0.42) * (1 - 0.1 * u);
  const top = BODY.topHeight * Math.pow(s, 0.5) * (1 - 0.28 * u * u);
  const bot = BODY.bottomHeight * Math.pow(s, 0.4);
  const c = Math.cos(v);
  const sn = Math.sin(v);
  out.set(a * sp(c, SE), (sn >= 0 ? top : bot) * sp(sn, SE), -BODY.length / 2 + u * BODY.length);
  return out;
};

const PI = Math.PI;
const v3 = (a: V3) => new THREE.Vector3(...a);

// ───────────────────────────────────────────────────────── builder
interface Pending {
  mat: MatKey;
  geom: THREE.BufferGeometry;
}

class Builder {
  pending: Pending[] = [];
  custom: { geom: THREE.BufferGeometry; mat: THREE.Material; spin?: boolean }[] = [];
  spinPending: Pending[] = [];
  bolts: { p: THREE.Vector3; n: THREE.Vector3; s: number }[] = [];
  extras: THREE.Object3D[] = [];
  add(mat: MatKey, ...geoms: THREE.BufferGeometry[]) {
    for (const geom of geoms) this.pending.push({ mat, geom });
    return this;
  }
  addSpin(mat: MatKey, ...geoms: THREE.BufferGeometry[]) {
    for (const geom of geoms) this.spinPending.push({ mat, geom });
    return this;
  }
  addCustom(geom: THREE.BufferGeometry, mat: THREE.Material, spin = false) {
    this.custom.push({ geom, mat, spin });
  }
  bolt(p: V3 | THREE.Vector3, n: V3 | THREE.Vector3 = [0, 1, 0], s = 1) {
    this.bolts.push({
      p: Array.isArray(p) ? v3(p) : p.clone(),
      n: (Array.isArray(n) ? v3(n) : n.clone()).normalize(),
      s,
    });
  }
}

type BuildFn = (b: Builder, ctx: BuildCtx) => void;

interface BuildCtx {
  data: DroneComponent;
}

// fastener geometry: socket-cap screw head with dark hex socket (vertex coloured)
function fastenerGeometry() {
  const head = lathe(
    [
      [0, 0],
      [0.0027, 0],
      [0.0028, 0.0022],
      [0.0024, 0.0028],
      [0, 0.0028],
    ],
    20,
  );
  tint(head, 1, 1, 1);
  const socket = xf(new THREE.CircleGeometry(0.00125, 6), [0, 0.00285, 0], [-PI / 2, 0, 0]);
  tint(socket, 0.04, 0.04, 0.05);
  return merge([head, socket], true);
}

// ───────────────────────────────────────────────────────── component builders
const dirOf = (i: number) => {
  const a = ARM_LAYOUT[i - 1];
  return new THREE.Vector3(a.dir[0], 0, a.dir[1]);
};
const perpOf = (i: number) => {
  const d = dirOf(i);
  return new THREE.Vector3(-d.z, 0, d.x);
};
const at = (i: number, r: number, y: number, side = 0): V3 => {
  const d = dirOf(i);
  const p = perpOf(i);
  return [d.x * r + p.x * side, y, d.z * r + p.z * side];
};

function bodyPatch(b: Builder, mat: MatKey, u0: number, u1: number, v0: number, v1: number, thick: number, off: number, su = 16, sv = 16) {
  b.add(mat, surfaceSlab(bodySurface, u0, u1, v0, v1, su, sv, thick, off));
}

/** Orient a geometry (built with X=along, Y=normal, Z=across) onto the body surface. */
function onSurface(g: THREE.BufferGeometry, u: number, v: number, lift: number, alongU = true) {
  const f = surfaceFrame(bodySurface, u, v);
  const x = (alongU ? f.du : f.dv).clone().normalize();
  const y = f.n.clone();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  x.crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(f.p.clone().addScaledVector(f.n, lift));
  g.applyMatrix4(m);
  return g;
}

const BUILDERS: Record<string, BuildFn> = {};

// Upper shell
BUILDERS['upper-shell'] = (b) => {
  b.add('shell', surfaceSlab(bodySurface, 0, 1, 0, PI, 84, 64, BODY.shellThickness));
  // panel seams (recessed dark outlines)
  bodyPatch(b, 'seam', 0.244, 0.416, 0.35 * PI, 0.65 * PI, 0.0006, 0.0003);
  bodyPatch(b, 'seam', 0.594, 0.736, 0.36 * PI, 0.64 * PI, 0.0006, 0.0003);
  // status light strip
  bodyPatch(b, 'ledBlue', 0.12, 0.205, 0.485 * PI, 0.515 * PI, 0.0008, 0.0006, 8, 2);
  // shoulder character lines
  for (const s of [1, -1]) {
    const v = s > 0 ? 0.3 * PI : 0.7 * PI;
    bodyPatch(b, 'seam', 0.2, 0.8, v - 0.004, v + 0.004, 0.0005, 0.00025, 40, 1);
  }
  // logo decals on both flanks
  for (const side of [1, -1]) {
    const tex = logoTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      roughness: 0.5,
      metalness: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const g = new THREE.PlaneGeometry(0.095, 0.022);
    // plane: X = text direction, Y = up; place on surface frame
    g.rotateX(-PI / 2); // now normal +Y, text along +X, up along -Z
    if (side > 0) g.rotateY(PI); // port side text reads rear-ward
    onSurface(g, 0.3, side > 0 ? 0.2 * PI : 0.8 * PI, 0.0012, true);
    b.addCustom(g, mat);
  }
};

let _logo: THREE.Texture | null = null;
function logoTexture() {
  if (_logo) return _logo;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 240;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(225,232,240,0.9)';
  ctx.font = '300 150px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('K1000', 20, 125);
  ctx.fillStyle = 'rgba(111,183,255,0.9)';
  ctx.fillRect(560, 112, 420, 6);
  ctx.font = '500 40px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(170,185,200,0.85)';
  ctx.fillText('HEAVY-LIFT · VIS', 570, 170);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _logo = t;
  return t;
}

// Lower chassis
BUILDERS['lower-chassis'] = (b) => {
  b.add('shell', surfaceSlab(bodySurface, 0, 1, PI, 2 * PI, 84, 56, BODY.shellThickness));
  // belt line trim (parting line between shells)
  bodyPatch(b, 'anodized', 0.03, 0.97, -0.04, 0.04, 0.003, 0.0013, 64, 3);
  bodyPatch(b, 'anodized', 0.03, 0.97, PI - 0.04, PI + 0.04, 0.003, 0.0013, 64, 3);
  // belly drain grille aft
  bodyPatch(b, 'blackMatte', 0.1, 0.18, 1.42 * PI, 1.58 * PI, 0.0008, 0.0004, 6, 6);
  for (let k = 0; k < 5; k++) {
    const u = 0.11 + k * 0.016;
    const g = box(0.004, 0.0016, 0.05);
    onSurface(g, u, 1.5 * PI, 0.0012, true);
    b.add('anodized', g);
  }
};

// Center frame
BUILDERS['center-frame'] = (b) => {
  const s = new THREE.Shape();
  const pts: THREE.Vector2[] = [];
  const mids = [0.095, 0.205, 0.095, 0.205]; // half-extents toward +x, +z, -x, -z in shape space
  for (let k = 0; k < 4; k++) {
    const th = PI / 4 + (k * PI) / 2;
    const d = new THREE.Vector2(Math.cos(th), Math.sin(th));
    const n = new THREE.Vector2(-d.y, d.x);
    const base = 0.13;
    const tip = 0.228;
    pts.push(d.clone().multiplyScalar(base).addScaledVector(n, -0.05));
    pts.push(d.clone().multiplyScalar(tip).addScaledVector(n, -0.03));
    pts.push(d.clone().multiplyScalar(tip + 0.008).addScaledVector(n, 0));
    pts.push(d.clone().multiplyScalar(tip).addScaledVector(n, 0.03));
    pts.push(d.clone().multiplyScalar(base).addScaledVector(n, 0.05));
    const th2 = th + PI / 4;
    const m = mids[(k + 1) % 4];
    pts.push(new THREE.Vector2(Math.cos(th2) * m, Math.sin(th2) * m));
  }
  s.setFromPoints(pts);
  // lightening pockets (shape y == -world z)
  s.holes.push(circlePath(0, -0.155, 0.024));
  s.holes.push(circlePath(0, 0.16, 0.018));
  s.holes.push(circlePath(0.045, 0.14, 0.012));
  s.holes.push(circlePath(-0.045, 0.14, 0.012));
  s.holes.push(circlePath(0.058, -0.075, 0.016));
  s.holes.push(circlePath(-0.058, -0.075, 0.016));
  s.holes.push(circlePath(0.058, 0.07, 0.014));
  s.holes.push(circlePath(-0.058, 0.07, 0.014));
  for (let k = 0; k < 4; k++) {
    const th = PI / 4 + (k * PI) / 2;
    s.holes.push(slotPath(Math.cos(th) * 0.15, Math.sin(th) * 0.15, Math.cos(th) * 0.19, Math.sin(th) * 0.19, 0.008));
  }
  const g = plate(s, 0.004, -0.006, 0.0006);
  scaleUV(g, 40, 40);
  b.add('carbon', g);
  // standoffs
  for (const [x, z] of [
    [0.07, 0.1],
    [-0.07, 0.1],
    [0.07, -0.1],
    [-0.07, -0.1],
  ]) {
    b.add('aluminum', cyl(0.0032, 0.0032, 0.012, 12, [x, 0.004, z]));
  }
  // frame bolts
  for (let i = 1; i <= 4; i++) {
    b.bolt(at(i, 0.205, -0.002, 0.032), [0, 1, 0]);
    b.bolt(at(i, 0.205, -0.002, -0.032), [0, 1, 0]);
  }
};

// Arms
for (const a of ARM_LAYOUT) {
  BUILDERS[`arm-${pad(a.index)}`] = (b) => {
    const i = a.index;
    const d = dirOf(i);
    const yaw = armYaw(i);
    const r0 = ARM.rootRadius;
    const r1 = ARM.tipRadius + 0.035;
    const len = r1 - r0;
    const t = cyl(ARM.tubeRadius, ARM.tubeRadius, len, 32, undefined, undefined, true);
    scaleUV(t, 5, 20);
    alignY(t, d, v3(at(i, (r0 + r1) / 2, ARM.y)));
    b.add('carbon', t);
    // inner liner so the open tube reads solid
    const liner = cyl(ARM.tubeRadius * 0.86, ARM.tubeRadius * 0.86, len, 24, undefined, undefined, true);
    alignY(liner, d, v3(at(i, (r0 + r1) / 2, ARM.y)));
    b.add('blackMatte', liner);
    // root clamp
    b.add('anodized', rbox(0.03, 0.05, 0.05, 0.006, at(i, r0 + 0.012, ARM.y + 0.002), [0, yaw, 0]));
    // folding hinge block
    const hr = ARM.hingeRadius;
    b.add('anodized', rbox(0.04, 0.05, 0.058, 0.008, at(i, hr - 0.022, ARM.y + 0.001), [0, yaw, 0]));
    b.add('anodized', rbox(0.036, 0.048, 0.054, 0.008, at(i, hr + 0.02, ARM.y + 0.001), [0, yaw, 0]));
    b.add('seam', box(0.004, 0.046, 0.06, at(i, hr, ARM.y + 0.001), [0, yaw, 0]));
    // hinge pin + lock lever
    const pin = cyl(0.0055, 0.0055, 0.066, 20);
    alignY(pin, perpOf(i), v3(at(i, hr + 0.003, ARM.y + 0.027)));
    b.add('aluminum', pin);
    b.add('accent', rbox(0.032, 0.006, 0.012, 0.002, at(i, hr + 0.01, ARM.y + 0.03), [0, yaw, 0]));
    b.bolt(at(i, hr - 0.03, ARM.y + 0.026, 0.017), [0, 1, 0]);
    b.bolt(at(i, hr - 0.03, ARM.y + 0.026, -0.017), [0, 1, 0]);
    b.bolt(at(i, hr + 0.03, ARM.y + 0.025, 0.017), [0, 1, 0]);
    b.bolt(at(i, hr + 0.03, ARM.y + 0.025, -0.017), [0, 1, 0]);
    // motor mount + clamp
    const tip = ARM.tipRadius;
    b.add('anodized', rbox(0.108, 0.006, 0.108, 0.012, at(i, tip, MOTOR.baseY - 0.003), [0, yaw + PI / 4, 0]));
    b.add('anodized', rbox(0.056, 0.05, 0.05, 0.007, at(i, tip, ARM.y), [0, yaw, 0]));
    for (let k = 0; k < 4; k++) {
      const ang = yaw + PI / 4 + (k * PI) / 2;
      const rr = 0.047;
      const base = at(i, tip, MOTOR.baseY);
      b.bolt([base[0] + Math.cos(ang) * rr, base[1], base[2] - Math.sin(ang) * rr], [0, 1, 0]);
    }
    // end cap + nav light
    const cap = cyl(ARM.tubeRadius + 0.0015, ARM.tubeRadius + 0.0015, 0.012, 24);
    alignY(cap, d, v3(at(i, r1 + 0.005, ARM.y)));
    b.add('blackMatte', cap);
    const ledKey: MatKey = i === 1 ? 'ledGreen' : i === 3 ? 'ledRed' : 'ledWhite';
    const ledPos = at(i, r1 + 0.008, ARM.y - 0.017);
    b.add(ledKey, sphere(0.0075, ledPos, 16, 10));
    b.add('blackMatte', cyl(0.011, 0.011, 0.006, 20, [ledPos[0], ledPos[1] + 0.005, ledPos[2]]));
    const glowColor = i === 1 ? '#3dff7e' : i === 3 ? '#ff3b2e' : '#ffffff';
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: glowColor,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.6,
      }),
    );
    glow.position.set(ledPos[0], ledPos[1] - 0.004, ledPos[2]);
    glow.scale.setScalar(0.07);
    glow.userData.glow = true;
    glow.userData.base = 0.6;
    glow.raycast = () => {};
    b.extras.push(glow);
    // arm decal
    const dg = new THREE.PlaneGeometry(0.07, 0.0175);
    dg.rotateX(-PI / 2);
    dg.rotateY(yaw);
    const dp = at(i, 0.34, ARM.y + ARM.tubeRadius + 0.0004);
    dg.translate(dp[0], dp[1], dp[2]);
    b.addCustom(
      dg,
      new THREE.MeshStandardMaterial({
        map: armDecal(i),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        roughness: 0.5,
      }),
    );
    // serial plate (Easter egg): underside of hinge block on Arm 04
    if (i === 4) {
      const sg = new THREE.PlaneGeometry(0.032, 0.008);
      sg.rotateX(PI / 2);
      sg.rotateY(yaw);
      const spos = at(i, hr + 0.02, ARM.y + 0.001 - 0.0242);
      sg.translate(spos[0], spos[1], spos[2]);
      b.addCustom(
        sg,
        new THREE.MeshStandardMaterial({
          map: serialPlate('SN K1A-04-0731-RW', 'K1000 · MFG 2026-08 · ILLUSTRATIVE'),
          roughness: 0.35,
          metalness: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
    }
  };
}

// Motors
let _motorGeo: Record<string, THREE.BufferGeometry> | null = null;
function motorGeometry() {
  if (_motorGeo) return _motorGeo;
  const stator = lathe(
    [
      [0, 0],
      [0.042, 0],
      [0.046, 0.002],
      [0.046, 0.0105],
      [0.043, 0.0125],
      [0, 0.0125],
    ],
    48,
  );
  const bell = lathe(
    [
      [0, 0.013],
      [0.05, 0.013],
      [0.052, 0.0155],
      [0.052, 0.0495],
      [0.0495, 0.0545],
      [0.03, 0.058],
      [0, 0.058],
    ],
    64,
  );
  const ring = merge([torus(0.0507, 0.0016, [0, 0.0505, 0], [PI / 2, 0, 0], 8, 64), torus(0.0512, 0.0012, [0, 0.0165, 0], [PI / 2, 0, 0], 8, 64)]);
  const slots: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 14; k++) {
    const ang = (k / 14) * PI * 2;
    slots.push(box(0.003, 0.022, 0.011, [Math.cos(ang) * 0.0505, 0.033, Math.sin(ang) * 0.0505], [0, -ang, 0]));
  }
  // stator fins under the base
  for (let k = 0; k < 18; k++) {
    const ang = (k / 18) * PI * 2;
    slots.push(box(0.0018, 0.0075, 0.006, [Math.cos(ang) * 0.0455, 0.0062, Math.sin(ang) * 0.0455], [0, -ang, 0]));
  }
  const shaft = merge([cyl(0.0135, 0.0135, 0.012, 32, [0, 0.064, 0]), cyl(0.004, 0.004, 0.006, 12, [0, 0.0725, 0])]);
  _motorGeo = { stator, bell, ring, slots: merge(slots), shaft };
  return _motorGeo;
}

for (const a of ARM_LAYOUT) {
  BUILDERS[`motor-${pad(a.index)}`] = (b) => {
    const i = a.index;
    const base = at(i, ARM.tipRadius, MOTOR.baseY);
    const g = motorGeometry();
    const place = (geo: THREE.BufferGeometry) => xf(geo.clone(), base);
    b.add('anodized', place(g.stator));
    b.add('motorBell', place(g.bell));
    b.add('aluminum', place(g.ring), place(g.shaft));
    b.add('blackMatte', place(g.slots));
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * PI * 2 + PI / 4;
      b.bolt([base[0] + Math.cos(ang) * 0.022, base[1] + 0.058, base[2] + Math.sin(ang) * 0.022], [0, 1, 0], 0.8);
    }
  };
}

// Propellers (geometry relative to the hub; meshes live under node.spin)
const _bladeCache: Record<string, THREE.BufferGeometry> = {};
function bladeGeo(dir: 1 | -1, part: 'main' | 'tip') {
  const key = `${dir}-${part}`;
  if (!_bladeCache[key]) {
    const g = part === 'main' ? propBlade(0.045, PROP.radius, dir, 0, 0.9) : propBlade(0.045, PROP.radius, dir, 0.9, 1, 1.12);
    if (part === 'main') scaleUV(g, 14, 2);
    _bladeCache[key] = g;
  }
  return _bladeCache[key];
}

for (const a of ARM_LAYOUT) {
  BUILDERS[`prop-${pad(a.index)}`] = (b, ctx) => {
    const dir: 1 | -1 = a.spin === 'CW' ? -1 : 1;
    const c = v3(ctx.data.position);
    const P = (g: THREE.BufferGeometry, yaw: number) => {
      const out = g.clone();
      out.rotateY(yaw + armYaw(a.index));
      out.translate(c.x, c.y, c.z);
      return out;
    };
    const hub = lathe(
      [
        [0, -0.011],
        [0.022, -0.011],
        [0.025, -0.008],
        [0.025, 0.006],
        [0.02, 0.011],
        [0, 0.011],
      ],
      40,
    );
    const spinner = lathe(
      [
        [0, 0.011],
        [0.015, 0.011],
        [0.013, 0.017],
        [0.007, 0.021],
        [0, 0.0225],
      ],
      32,
    );
    const yokes = merge([rbox(0.03, 0.017, 0.028, 0.004, [0.04, 0.001, 0]), rbox(0.03, 0.017, 0.028, 0.004, [-0.04, 0.001, 0])]);
    b.addSpin('anodized', P(hub, 0), P(yokes, 0));
    b.addSpin('aluminum', P(spinner, 0));
    b.addSpin('carbon', P(bladeGeo(dir, 'main'), 0), P(bladeGeo(dir, 'main'), PI));
    b.addSpin('propWhite', P(bladeGeo(dir, 'tip'), 0), P(bladeGeo(dir, 'tip'), PI));
    // blade-pin bolts ride on the spinning yokes; kept as regular bolts (static) is fine visually
    for (const s of [1, -1]) {
      const v = new THREE.Vector3(0.04 * s, 0.0098, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), armYaw(a.index));
      b.bolt(c.clone().add(v), [0, 1, 0], 0.9);
    }
    if (a.index === 3) {
      // modelled leading-edge wear on blade B (Easter egg)
      const t = 0.62;
      const twist = THREE.MathUtils.degToRad(24 - 16 * t) * dir;
      const r = 0.045 + (PROP.radius - 0.045) * t;
      const g = new THREE.PlaneGeometry(0.03, 0.011);
      g.rotateX(-PI / 2);
      g.rotateX(-twist);
      g.translate(r, 0.0128 + r * 0.0, 0.0085 * dir);
      g.rotateY(PI + armYaw(a.index));
      g.translate(c.x, c.y, c.z);
      b.addCustom(
        g,
        new THREE.MeshStandardMaterial({
          map: wearMark(),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          roughness: 0.8,
        }),
        true,
      );
    }
  };
}

// ESCs
for (const a of ARM_LAYOUT) {
  BUILDERS[`esc-${pad(a.index)}`] = (b) => {
    const i = a.index;
    const yaw = armYaw(i);
    const r = 0.115;
    b.add('pcbBlack', rbox(0.05, 0.003, 0.034, 0.001, at(i, r, 0.0015), [0, yaw, 0]));
    b.add('anodized', rbox(0.044, 0.004, 0.03, 0.001, at(i, r, 0.005), [0, yaw, 0]));
    const fins: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) fins.push(box(0.044, 0.011, 0.0016, at(i, r, 0.0125, -0.0135 + k * 0.0045), [0, yaw, 0]));
    b.add('anodized', merge(fins));
    // capacitors
    for (const s of [-0.009, 0.009]) {
      const cp = cyl(0.0048, 0.0048, 0.014, 16);
      alignY(cp, perpOf(i), v3(at(i, r - 0.03, 0.006, s)));
      b.add('plastic', cp);
      const cap = cyl(0.0049, 0.0049, 0.002, 16);
      alignY(cap, perpOf(i), v3(at(i, r - 0.03, 0.006, s + Math.sign(s) * 0.007)));
      b.add('aluminum', cap);
    }
    b.add('copper', box(0.008, 0.0012, 0.026, at(i, r + 0.022, 0.0035), [0, yaw, 0]));
    b.add('ledBlue', box(0.002, 0.001, 0.002, at(i, r - 0.02, 0.0034, 0.013), [0, yaw, 0]));
  };
}

// Battery
BUILDERS['battery'] = (b) => {
  const cz = -0.025;
  const L = 0.2;
  b.add('plastic', rbox(0.15, 0.047, L, 0.007, [0, -0.0315, cz]));
  // accent band + end cap
  b.add('accent', rbox(0.152, 0.049, 0.006, 0.003, [0, -0.0315, cz + L / 2 - 0.018]));
  b.add('anodized', rbox(0.154, 0.051, 0.014, 0.004, [0, -0.0315, cz - L / 2 + 0.004]));
  b.add('blackMatte', rbox(0.06, 0.012, 0.01, 0.003, [0, -0.0315, cz - L / 2 - 0.006]));
  // charge indicator
  for (let k = 0; k < 4; k++) b.add('ledBlue', box(0.004, 0.003, 0.002, [-0.012 + k * 0.008, -0.016, cz - L / 2 - 0.0035]));
  // top label
  const lg = new THREE.PlaneGeometry(0.14, 0.07);
  lg.rotateX(-PI / 2);
  lg.translate(0, -0.0079, cz + 0.01);
  b.add('batteryLabel', lg);
  // cycle-count plate underneath end cap (Easter egg)
  const sg = new THREE.PlaneGeometry(0.04, 0.01);
  sg.rotateX(PI / 2);
  sg.translate(0, -0.0573, cz - L / 2 + 0.004);
  b.addCustom(
    sg,
    new THREE.MeshStandardMaterial({
      map: serialPlate('CYCLE 0147 · CELL Δ 4 mV', 'K1-PWR-B01 · ILLUSTRATIVE'),
      roughness: 0.4,
      metalness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
};

BUILDERS['battery-bay'] = (b) => {
  b.add('plastic', rbox(0.165, 0.003, 0.215, 0.002, [0, -0.0575, -0.025]));
  for (const s of [1, -1]) {
    b.add('plastic', rbox(0.004, 0.02, 0.21, 0.0015, [s * 0.081, -0.048, -0.025]));
    b.add('foam', box(0.003, 0.03, 0.12, [s * 0.0775, -0.03, -0.025]));
  }
  b.add('plastic', rbox(0.16, 0.024, 0.004, 0.0015, [0, -0.046, 0.083]));
  b.add('accent', rbox(0.03, 0.012, 0.008, 0.002, [0, -0.05, -0.132]));
  for (const [x, z] of [
    [0.077, 0.075],
    [-0.077, 0.075],
    [0.077, -0.125],
    [-0.077, -0.125],
  ]) {
    b.add('aluminum', cyl(0.0028, 0.0028, 0.05, 10, [x, -0.032, z]));
  }
};

BUILDERS['power-distribution'] = (b) => {
  b.add('pcb', rbox(0.075, 0.003, 0.075, 0.002, [0, 0.0035, 0]));
  for (let i = 1; i <= 4; i++) b.add('copper', rbox(0.014, 0.0015, 0.01, 0.0005, at(i, 0.042, 0.0058), [0, armYaw(i), 0]));
  b.add('blackMatte', rbox(0.016, 0.008, 0.012, 0.001, [0.02, 0.009, -0.025]));
  b.add('copper', box(0.03, 0.0016, 0.012, [-0.012, 0.0058, -0.03]));
  for (const x of [-0.025, 0.025]) {
    b.add('plastic', cyl(0.004, 0.004, 0.01, 14, [x, 0.01, 0.026]));
    b.add('aluminum', cyl(0.0041, 0.0041, 0.0015, 14, [x, 0.0155, 0.026]));
  }
};

BUILDERS['power-connector'] = (b) => {
  b.add('wireYellow', rbox(0.024, 0.013, 0.026, 0.002, [0, -0.02, -0.145]));
  b.add('wireYellow', rbox(0.02, 0.011, 0.012, 0.002, [0, -0.02, -0.164]));
  b.add('gold', cyl(0.003, 0.003, 0.012, 10, [-0.005, -0.02, -0.132], [PI / 2, 0, 0]));
  b.add('gold', cyl(0.003, 0.003, 0.012, 10, [0.005, -0.02, -0.132], [PI / 2, 0, 0]));
};

BUILDERS['wiring-harness'] = (b) => {
  // PDB → ESC power pairs
  for (let i = 1; i <= 4; i++) {
    for (const [s, mat] of [
      [0.0045, 'wireRed'],
      [-0.0045, 'wireBlack'],
    ] as const) {
      b.add(mat, tube([at(i, 0.045, 0.0068, s), at(i, 0.065, 0.011, s), at(i, 0.09, 0.0075, s)], 0.0021, 16, 8));
    }
    // ESC → arm phase leads
    const ph: MatKey[] = ['wireBlack', 'wireSignal', 'wireYellow'];
    ph.forEach((m, k) => {
      const s = (k - 1) * 0.0045;
      b.add(m, tube([at(i, 0.14, 0.006, s), at(i, 0.155, 0.012, s), at(i, ARM.rootRadius + 0.004, ARM.y, s * 0.6)], 0.0015, 14, 6));
    });
  }
  // battery → connector → PDB
  for (const [s, mat] of [
    [1, 'wireRed'],
    [-1, 'wireBlack'],
  ] as const) {
    b.add(mat, tube([[s * 0.016, -0.028, -0.125], [s * 0.013, -0.024, -0.129], [s * 0.005, -0.02, -0.132]], 0.003, 10, 8));
    b.add(
      mat,
      tube(
        [
          [s * 0.005, -0.02, -0.17],
          [s * 0.028, -0.014, -0.178],
          [s * 0.05, -0.004, -0.155],
          [s * 0.045, 0.008, -0.1],
          [s * 0.012, 0.0065, -0.04],
        ],
        0.0029,
        40,
        8,
      ),
    );
  }
  // signal looms: FC → GPS, FC → datalink, FC → companion
  b.add('wireSignal', tube([[0, 0.028, -0.036], [0, 0.048, -0.1], [0, 0.058, -0.17], [0, 0.064, -0.198]], 0.0016, 32, 6));
  b.add('wireSignal', tube([[0.022, 0.026, -0.036], [0.026, 0.026, -0.1], [0.02, 0.024, -0.147]], 0.0014, 24, 6));
  b.add('wireSignal', tube([[-0.006, 0.026, 0.036], [-0.006, 0.03, 0.07], [-0.006, 0.022, 0.1]], 0.0014, 20, 6));
  b.add('wireYellow', tube([[0.006, 0.026, 0.036], [0.006, 0.03, 0.07], [0.006, 0.022, 0.1]], 0.0014, 20, 6));
  // coax to antennas
  for (const s of [1, -1]) {
    b.add('wireBlack', tube([[s * 0.02, 0.021, -0.193], [s * 0.06, 0.018, -0.212], [s * 0.098, 0.006, -0.226]], 0.0018, 24, 6));
  }
  // wire clips on the frame
  for (const z of [-0.1, 0.06]) b.add('plastic', rbox(0.012, 0.004, 0.006, 0.001, [0.045, 0.002, z]));
};

BUILDERS['flight-controller'] = (b) => {
  for (const [x, z] of [
    [0.028, 0.028],
    [-0.028, 0.028],
    [0.028, -0.028],
    [-0.028, -0.028],
  ]) {
    b.add('rubber', cyl(0.0052, 0.0052, 0.012, 14, [x, 0.012, z]));
  }
  b.add('anodized', rbox(0.07, 0.022, 0.07, 0.004, [0, 0.029, 0]));
  const lid = new THREE.PlaneGeometry(0.062, 0.062);
  lid.rotateX(-PI / 2);
  lid.translate(0, 0.0402, 0);
  b.add('fcLid', lid);
  // connectors
  for (let k = 0; k < 4; k++) b.add('plasticLight', rbox(0.01, 0.005, 0.004, 0.0006, [-0.022 + k * 0.0147, 0.024, 0.0365]));
  for (let k = 0; k < 3; k++) b.add('blackMatte', rbox(0.004, 0.005, 0.01, 0.0006, [0.0365, 0.024, -0.015 + k * 0.015]));
  b.add('ledGreen', box(0.0025, 0.0015, 0.0025, [0.028, 0.0405, -0.028]));
};

BUILDERS['companion-computer'] = (b) => {
  const z = 0.13;
  b.add('pcb', rbox(0.085, 0.003, 0.06, 0.002, [0, 0.0135, z]));
  for (const [x, dz] of [
    [0.037, 0.024],
    [-0.037, 0.024],
    [0.037, -0.024],
    [-0.037, -0.024],
  ]) {
    b.add('aluminum', cyl(0.0025, 0.0025, 0.014, 10, [x, 0.005, z + dz]));
  }
  b.add('anodized', rbox(0.056, 0.005, 0.044, 0.001, [-0.006, 0.0175, z]));
  const fins: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) fins.push(box(0.0014, 0.012, 0.044, [-0.032 + k * 0.0065, 0.026, z]));
  b.add('anodized', merge(fins));
  // blower
  b.add('plastic', cyl(0.016, 0.016, 0.009, 32, [0.034, 0.02, z + 0.004]));
  b.add('blackMatte', cyl(0.012, 0.012, 0.0095, 24, [0.034, 0.02, z + 0.004]));
  const blades: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const ang = (k / 9) * PI * 2;
    blades.push(box(0.0008, 0.008, 0.009, [0.034 + Math.cos(ang) * 0.0075, 0.0205, z + 0.004 + Math.sin(ang) * 0.0075], [0, -ang + 0.5, 0]));
  }
  b.add('plastic', merge(blades));
  b.add('gold', box(0.03, 0.002, 0.004, [0, 0.0158, z - 0.027]));
};

BUILDERS['datalink'] = (b) => {
  const z = -0.17;
  b.add('anodized', rbox(0.07, 0.02, 0.045, 0.004, [0, 0.016, z]));
  const fins: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) fins.push(box(0.062, 0.005, 0.0016, [0, 0.0285, z - 0.018 + k * 0.0051]));
  b.add('anodized', merge(fins));
  for (const s of [1, -1]) {
    b.add('gold', cyl(0.0035, 0.0035, 0.01, 14, [s * 0.02, 0.018, z - 0.027], [PI / 2, 0, 0]));
  }
  b.add('ledBlue', box(0.003, 0.002, 0.001, [0.028, 0.02, z + 0.0228]));
  b.add('plasticLight', rbox(0.016, 0.006, 0.004, 0.0006, [-0.015, 0.016, z + 0.0235]));
};

BUILDERS['gps'] = (b) => {
  const z = -0.2;
  b.add('anodized', lathe([[0, 0.056], [0.014, 0.056], [0.016, 0.062], [0.012, 0.07], [0, 0.07]], 32, [0, 0, z]));
  const rod = cyl(0.0052, 0.0052, 0.105, 16, [0, 0.12, z]);
  scaleUV(rod, 2, 10);
  b.add('carbon', rod);
  b.add('anodized', cyl(0.012, 0.014, 0.008, 24, [0, 0.172, z]));
  b.add('anodized', torus(0.0065, 0.0022, [0, 0.11, z], [PI / 2, 0, 0], 8, 20));
  b.add(
    'plasticLight',
    lathe(
      [
        [0, 0.176],
        [0.037, 0.176],
        [0.039, 0.18],
        [0.039, 0.187],
        [0.033, 0.195],
        [0.018, 0.2],
        [0, 0.201],
      ],
      48,
      [0, 0, z],
    ),
  );
  b.add('blackMatte', cyl(0.0395, 0.0395, 0.003, 48, [0, 0.1775, z]));
  // forward arrow
  const s = new THREE.Shape();
  s.moveTo(0, -0.014);
  s.lineTo(0.008, -0.002);
  s.lineTo(0.003, -0.002);
  s.lineTo(0.003, 0.01);
  s.lineTo(-0.003, 0.01);
  s.lineTo(-0.003, -0.002);
  s.lineTo(-0.008, -0.002);
  s.closePath();
  b.add('accent', plate(s, 0.0008, 0.2005, 0).translate(0, 0, z));
};

for (const s of [1, -1]) {
  const id = s > 0 ? 'antenna-01' : 'antenna-02';
  BUILDERS[id] = (b) => {
    const base = new THREE.Vector3(s * 0.104, 0.006, -0.228);
    b.add('anodized', rbox(0.016, 0.014, 0.018, 0.003, [base.x, base.y, base.z]));
    b.add('aluminum', sphere(0.0062, [base.x, base.y + 0.009, base.z], 16, 12));
    const dir = new THREE.Vector3(s * 0.3, 0.92, -0.26).normalize();
    const start = base.clone().add(new THREE.Vector3(0, 0.012, 0));
    const sleeve = cyl(0.0058, 0.0062, 0.12, 20);
    alignY(sleeve, dir, start.clone().addScaledVector(dir, 0.06));
    b.add('rubber', sleeve);
    const whip = cyl(0.0032, 0.0045, 0.05, 14);
    alignY(whip, dir, start.clone().addScaledVector(dir, 0.145));
    b.add('rubber', whip);
    b.add('rubber', sphere(0.0034, start.clone().addScaledVector(dir, 0.17).toArray() as V3, 12, 8));
    const band = cyl(0.0064, 0.0064, 0.004, 20);
    alignY(band, dir, start.clone().addScaledVector(dir, 0.02));
    b.add('accent', band);
  };
}

BUILDERS['vision-front'] = (b) => {
  bodyPatch(b, 'glass', 0.885, 0.972, 0.1 * PI, 0.9 * PI, 0.0018, 0.0007, 14, 30);
  for (const s of [1, -1]) {
    const v = s > 0 ? 0.26 * PI : 0.74 * PI;
    const u = 0.93;
    const ring = cyl(0.0098, 0.0098, 0.003, 32);
    onSurface(ring, u, v, 0.0022);
    b.add('anodized', ring);
    const lens = cyl(0.0072, 0.0072, 0.0034, 32);
    onSurface(lens, u, v, 0.0026);
    b.add('lens', lens);
  }
  // centre IR projector
  const ir = cyl(0.004, 0.004, 0.003, 20);
  onSurface(ir, 0.935, 0.5 * PI, 0.0022);
  b.add('lens', ir);
};

BUILDERS['lidar-down'] = (b) => {
  const c: V3 = [0.03, -0.066, 0.11];
  b.add('blackMatte', rbox(0.026, 0.013, 0.036, 0.003, c));
  b.add('lens', cyl(0.0058, 0.0058, 0.002, 24, [c[0], c[1] - 0.0066, c[2] + 0.008]));
  b.add('glass', cyl(0.0068, 0.0068, 0.002, 24, [c[0], c[1] - 0.0066, c[2] - 0.008]));
  b.add('anodized', torus(0.0068, 0.0009, [c[0], c[1] - 0.0068, c[2] - 0.008], [PI / 2, 0, 0], 6, 24));
};

BUILDERS['optical-flow'] = (b) => {
  const c: V3 = [-0.03, -0.066, 0.11];
  b.add('blackMatte', rbox(0.026, 0.013, 0.036, 0.003, c));
  b.add('lens', cyl(0.0075, 0.0075, 0.0022, 28, [c[0], c[1] - 0.0066, c[2]]));
  b.add('anodized', torus(0.0076, 0.001, [c[0], c[1] - 0.0068, c[2]], [PI / 2, 0, 0], 6, 28));
  for (const dz of [-0.013, 0.013]) b.add('ledRed', cyl(0.0018, 0.0018, 0.001, 10, [c[0], c[1] - 0.0066, c[2] + dz]));
};

BUILDERS['rear-sensor'] = (b) => {
  bodyPatch(b, 'glass', 0.012, 0.07, 0.32 * PI, 0.68 * PI, 0.0016, 0.0006, 8, 12);
  const lens = cyl(0.0055, 0.0055, 0.003, 24);
  onSurface(lens, 0.035, 0.45 * PI, 0.0021);
  b.add('lens', lens);
  const em = cyl(0.003, 0.003, 0.003, 16);
  onSurface(em, 0.035, 0.56 * PI, 0.0021);
  b.add('lens', em);
};

BUILDERS['gimbal'] = (b) => {
  const z = 0.2;
  b.add('anodized', rbox(0.09, 0.005, 0.06, 0.004, [0, -0.0555, z]));
  for (const [x, dz] of [
    [0.034, 0.021],
    [-0.034, 0.021],
    [0.034, -0.021],
    [-0.034, -0.021],
  ]) {
    b.add('rubber', sphere(0.0072, [x, -0.0645, z + dz], 16, 12));
    b.bolt([x, -0.0528, z + dz], [0, 1, 0], 0.8);
  }
  b.add('anodized', rbox(0.082, 0.004, 0.052, 0.004, [0, -0.0735, z]));
  b.add('aluminum', cyl(0.02, 0.02, 0.007, 36, [0, -0.079, z]));
  b.add('accent', cyl(0.0205, 0.0205, 0.0018, 36, [0, -0.0815, z]));
  b.add('motorBell', cyl(0.021, 0.021, 0.016, 40, [0, -0.091, z]));
  b.add('aluminum', torus(0.0205, 0.0012, [0, -0.0835, z], [PI / 2, 0, 0], 6, 40));
  // yaw arm → roll motor → roll arm → pitch motor
  b.add('plasticLight', rbox(0.018, 0.012, 0.052, 0.004, [0, -0.104, z - 0.02]));
  b.add('plasticLight', rbox(0.018, 0.05, 0.014, 0.004, [0, -0.124, z - 0.042]));
  b.add('motorBell', cyl(0.019, 0.019, 0.018, 36, [0, -0.15, z - 0.036], [PI / 2, 0, 0]));
  b.add('aluminum', torus(0.0185, 0.0011, [0, -0.15, z - 0.027], [0, 0, 0], 6, 36));
  b.add('plasticLight', rbox(0.064, 0.014, 0.014, 0.004, [0.034, -0.15, z - 0.022]));
  b.add('plasticLight', rbox(0.014, 0.014, 0.06, 0.004, [0.064, -0.15, z + 0.004]));
  b.add('plasticLight', rbox(0.014, 0.034, 0.016, 0.004, [0.064, -0.164, z + 0.03]));
  b.add('motorBell', cyl(0.018, 0.018, 0.014, 36, [0.051, -0.175, z + 0.032], [0, 0, PI / 2]));
  b.add('aluminum', torus(0.0175, 0.001, [0.0445, -0.175, z + 0.032], [0, PI / 2, 0], 6, 36));
};

BUILDERS['camera'] = (b) => {
  const c: V3 = [0, -0.175, 0.232];
  b.add('plasticLight', rbox(0.07, 0.058, 0.066, 0.009, c));
  b.add('anodized', rbox(0.072, 0.008, 0.06, 0.003, [c[0], c[1] - 0.026, c[2]]));
  // vents
  for (let k = 0; k < 5; k++) b.add('blackMatte', box(0.0012, 0.03, 0.004, [-0.0352, c[1], c[2] - 0.02 + k * 0.009]));
  const front = c[2] + 0.033;
  const toZ = (g: THREE.BufferGeometry) => xf(g, [c[0], c[1] + 0.002, front], [PI / 2, 0, 0]);
  b.add(
    'anodized',
    toZ(
      lathe(
        [
          [0, 0],
          [0.026, 0],
          [0.026, 0.012],
          [0.0285, 0.014],
          [0.0285, 0.03],
          [0.0245, 0.034],
          [0, 0.034],
        ],
        48,
      ),
    ),
  );
  b.add('blackMatte', toZ(torus(0.0272, 0.0016, [0, 0.022, 0], [PI / 2, 0, 0], 6, 48)));
  b.add('aluminum', toZ(torus(0.0262, 0.0009, [0, 0.0315, 0], [PI / 2, 0, 0], 6, 48)));
  b.add(
    'lens',
    toZ(
      lathe(
        [
          [0, 0.0372],
          [0.01, 0.0365],
          [0.0185, 0.0345],
          [0.0195, 0.0335],
          [0, 0.0335],
        ],
        48,
      ),
    ),
  );
  b.add('ledRed', sphere(0.0018, [0.026, c[1] + 0.022, front + 0.0005], 10, 8));
};

BUILDERS['fpv-camera'] = (b) => {
  const c: V3 = [0, -0.019, 0.272];
  b.add('blackMatte', rbox(0.024, 0.019, 0.02, 0.004, c));
  b.add('anodized', cyl(0.0075, 0.0075, 0.008, 28, [c[0], c[1], c[2] + 0.012], [PI / 2, 0, 0]));
  b.add('lens', cyl(0.0058, 0.0058, 0.002, 28, [c[0], c[1], c[2] + 0.0165], [PI / 2, 0, 0]));
};

BUILDERS['payload-rails'] = (b) => {
  for (const s of [1, -1]) {
    b.add('aluminum', rbox(0.012, 0.012, 0.26, 0.0015, [s * 0.06, -0.08, -0.03]));
    b.add('blackMatte', box(0.0016, 0.004, 0.25, [s * 0.0665, -0.08, -0.03]));
    for (const z of [-0.12, 0.06]) {
      b.add('anodized', cyl(0.0045, 0.0045, 0.02, 12, [s * 0.06, -0.066, z]));
      b.bolt([s * 0.06, -0.0862, z], [0, -1, 0], 0.9);
    }
  }
};

BUILDERS['payload-release'] = (b) => {
  b.add('plastic', rbox(0.03, 0.02, 0.042, 0.003, [0, -0.078, -0.03]));
  b.add('aluminum', torus(0.009, 0.0022, [0, -0.096, -0.03], [0, PI / 2, 0], 8, 24));
  b.add('accent', cyl(0.0025, 0.0025, 0.034, 10, [0, -0.0895, -0.03], [0, 0, PI / 2]));
  b.add('ledGreen', box(0.003, 0.002, 0.002, [0.01, -0.07, -0.0085]));
};

BUILDERS['payload-pod'] = (b) => {
  b.add('shell', rbox(0.13, 0.08, 0.3, 0.032, [0, -0.146, -0.04], undefined, 5));
  b.add('seam', rbox(0.1315, 0.0815, 0.004, 0.032, [0, -0.146, 0.04], undefined, 5));
  b.add('glass', rbox(0.06, 0.006, 0.12, 0.003, [0, -0.1865, -0.04]));
  for (const s of [1, -1]) b.add('anodized', rbox(0.02, 0.022, 0.03, 0.003, [s * 0.06, -0.096, -0.04]));
};

for (const s of [1, -1]) {
  const id = s > 0 ? 'gear-left' : 'gear-right';
  BUILDERS[id] = (b) => {
    const x = s * GEAR.skidX;
    for (const zs of [1, -1]) {
      const z0 = zs * GEAR.mountZ;
      b.add('anodized', rbox(0.032, 0.016, 0.032, 0.004, [s * GEAR.mountX, GEAR.mountY - 0.004, z0]));
      b.bolt([s * GEAR.mountX + 0.009, GEAR.mountY - 0.0122, z0 + 0.009], [0, -1, 0]);
      b.bolt([s * GEAR.mountX - 0.009, GEAR.mountY - 0.0122, z0 - 0.009], [0, -1, 0]);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(s * GEAR.mountX, GEAR.mountY - 0.008, z0),
        new THREE.Vector3(s * 0.255, GEAR.mountY - 0.03, z0 * 1.03),
        new THREE.Vector3(x, GEAR.skidY + 0.008, z0 * 1.12),
      );
      const strut = tubeCurve(curve, 0.0095, 48, 14);
      scaleUV(strut, 20, 4);
      b.add('carbon', strut);
      b.add('anodized', cyl(0.0135, 0.0135, 0.038, 24, [x, GEAR.skidY + 0.002, z0 * 1.12], [PI / 2, 0, 0]));
      b.add('anodized', cyl(0.0112, 0.0125, 0.03, 20, [x, GEAR.skidY + 0.018, z0 * 1.12]));
    }
    const L = GEAR.skidHalfLength;
    b.add(
      'anodized',
      tube(
        [
          [x, GEAR.skidY + 0.035, -L - 0.03],
          [x, GEAR.skidY + 0.01, -L + 0.012],
          [x, GEAR.skidY, -L + 0.07],
          [x, GEAR.skidY, L - 0.07],
          [x, GEAR.skidY + 0.01, L - 0.012],
          [x, GEAR.skidY + 0.035, L + 0.03],
        ],
        0.0082,
        64,
        14,
      ),
    );
    b.add('rubber', sphere(0.0088, [x, GEAR.skidY + 0.035, -L - 0.03], 14, 10));
    b.add('rubber', sphere(0.0088, [x, GEAR.skidY + 0.035, L + 0.03], 14, 10));
    for (const zz of [-0.19, 0.19]) b.add('rubber', rbox(0.024, 0.009, 0.07, 0.003, [x, GEAR.skidY - 0.008, zz]));
  };
}

BUILDERS['access-panel-a'] = (b) => {
  bodyPatch(b, 'panel', 0.25, 0.41, 0.36 * PI, 0.64 * PI, 0.0024, 0.0011, 16, 16);
  for (const [u, v] of [
    [0.265, 0.385],
    [0.265, 0.615],
    [0.395, 0.385],
    [0.395, 0.615],
  ]) {
    const f = surfaceFrame(bodySurface, u, v * PI);
    b.bolt(f.p.clone().addScaledVector(f.n, 0.0034), f.n, 1.25);
  }
  // grip recess
  const g = rbox(0.03, 0.002, 0.008, 0.0009);
  onSurface(g, 0.39, 0.5 * PI, 0.0033, false);
  b.add('seam', g);
};

BUILDERS['access-panel-b'] = (b) => {
  bodyPatch(b, 'panel', 0.6, 0.73, 0.37 * PI, 0.63 * PI, 0.0024, 0.0011, 14, 14);
  for (const [u, v] of [
    [0.613, 0.395],
    [0.613, 0.605],
    [0.717, 0.395],
    [0.717, 0.605],
  ]) {
    const f = surfaceFrame(bodySurface, u, v * PI);
    b.bolt(f.p.clone().addScaledVector(f.n, 0.0034), f.n, 1.25);
  }
  // service port
  const g = rbox(0.012, 0.002, 0.005, 0.0012);
  onSurface(g, 0.7, 0.5 * PI, 0.0034);
  b.add('blackMatte', g);
};

BUILDERS['cooling-vents'] = (b) => {
  for (const side of [1, -1]) {
    const va = side > 0 ? 0.05 : PI - 0.32;
    const vb = side > 0 ? 0.32 : PI - 0.05;
    const u0 = 0.43;
    const u1 = 0.63;
    bodyPatch(b, 'blackMatte', u0, u1, va, vb, 0.0008, 0.0004, 10, 8);
    // frame
    bodyPatch(b, 'anodized', u0 - 0.008, u1 + 0.008, va - 0.025, va, 0.0018, 0.0009, 12, 2);
    bodyPatch(b, 'anodized', u0 - 0.008, u1 + 0.008, vb, vb + 0.025, 0.0018, 0.0009, 12, 2);
    bodyPatch(b, 'anodized', u0 - 0.008, u0, va, vb, 0.0018, 0.0009, 2, 8);
    bodyPatch(b, 'anodized', u1, u1 + 0.008, va, vb, 0.0018, 0.0009, 2, 8);
    // louvres
    const slats: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const u = u0 + 0.012 + (k * (u1 - u0 - 0.024)) / 8;
      const vm = (va + vb) / 2;
      const f0 = surfaceFrame(bodySurface, u, va + 0.01);
      const f1 = surfaceFrame(bodySurface, u, vb - 0.01);
      const len = f0.p.distanceTo(f1.p);
      const g = box(0.0035, 0.0016, len);
      g.rotateZ(0.5 * side);
      onSurface(g, u, vm, 0.0016, true);
      slats.push(g);
    }
    b.add('anodized', merge(slats));
  }
};

BUILDERS['fasteners'] = () => {};

// ───────────────────────────────────────────────────────── assemble
export function buildDroneModel(lib: MaterialLibrary): DroneModel {
  const root = new THREE.Group();
  root.name = 'K1000';
  const nodes = new Map<string, ComponentNode>();
  const pickables: THREE.Object3D[] = [];
  const ledMaterials: THREE.MeshStandardMaterial[] = [];
  const recLamp: THREE.MeshStandardMaterial[] = [];
  const glows: THREE.Sprite[] = [];
  const fastenerGeo = fastenerGeometry();
  let triangles = 0;

  // fasteners node first: other components parent their instances to themselves
  const makeNode = (data: DroneComponent): ComponentNode => {
    const xrayW = data.layer === 'exterior' ? 1 : data.layer === 'structure' ? 0.55 : 0;
    const ghostW = data.layer === 'exterior' ? 1 : 0;
    const group = new THREE.Group();
    group.name = data.id;
    const spin = new THREE.Group();
    group.add(spin);
    const basePosition = new THREE.Vector3(...data.position);
    group.position.copy(basePosition);
    return {
      id: data.id,
      data,
      group,
      spin,
      basePosition,
      meshes: [],
      fastenerMeshes: [],
      materials: [],
      uniforms: createComponentUniforms(xrayW, ghostW),
      localBox: new THREE.Box3(),
      dim: 0,
      hi: 0,
      hov: 0,
      fade: 1,
      transparent: false,
    };
  };

  for (const data of COMPONENTS) nodes.set(data.id, makeNode(data));
  const fastenerNode = nodes.get('fasteners')!;
  const fastenerMat = lib.fastener.clone();
  patchMaterial(fastenerMat, fastenerNode.uniforms);
  fastenerNode.materials.push(fastenerMat);

  const registerMat = (node: ComponentNode, mat: THREE.Material, key?: MatKey) => {
    patchMaterial(mat, node.uniforms);
    mat.userData.baseTransparent = mat.transparent;
    mat.userData.baseDepthWrite = mat.depthWrite;
    node.materials.push(mat);
    if (key && LED_KEYS.includes(key)) {
      ledMaterials.push(mat as THREE.MeshStandardMaterial);
      (mat as THREE.MeshStandardMaterial).userData.baseEmissive = (mat as THREE.MeshStandardMaterial).emissiveIntensity;
    }
  };

  for (const data of COMPONENTS) {
    const node = nodes.get(data.id)!;
    const fn = BUILDERS[data.id];
    if (!fn) {
      console.warn('No builder for component', data.id);
      continue;
    }
    const b = new Builder();
    fn(b, { data });
    const anchor = node.basePosition;
    const matCache = new Map<MatKey, THREE.Material>();
    const getMat = (key: MatKey) => {
      let m = matCache.get(key);
      if (!m) {
        m = lib[key].clone();
        registerMat(node, m, key);
        if (data.id === 'camera' && key === 'ledRed') recLamp.push(m as THREE.MeshStandardMaterial);
        matCache.set(key, m);
      }
      return m;
    };

    const addMeshes = (list: Pending[], parent: THREE.Object3D) => {
      const byMat = new Map<MatKey, THREE.BufferGeometry[]>();
      for (const p of list) {
        if (!byMat.has(p.mat)) byMat.set(p.mat, []);
        byMat.get(p.mat)!.push(p.geom);
      }
      for (const [key, geoms] of byMat) {
        const g = merge(geoms);
        g.translate(-anchor.x, -anchor.y, -anchor.z);
        g.computeBoundingBox();
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, getMat(key));
        mesh.userData.componentId = data.id;
        mesh.name = `${data.id}:${key}`;
        parent.add(mesh);
        node.meshes.push(mesh);
        pickables.push(mesh);
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
        if (g.boundingBox) node.localBox.union(g.boundingBox);
      }
    };
    addMeshes(b.pending, node.group);
    addMeshes(b.spinPending, node.spin);
    for (const c of b.custom) {
      c.geom.translate(-anchor.x, -anchor.y, -anchor.z);
      registerMat(node, c.mat);
      const mesh = new THREE.Mesh(c.geom, c.mat);
      mesh.userData.componentId = data.id;
      mesh.renderOrder = 2;
      (c.spin ? node.spin : node.group).add(mesh);
      node.meshes.push(mesh);
      pickables.push(mesh);
    }
    for (const e of b.extras) {
      e.position.sub(anchor);
      node.group.add(e);
      if ((e as THREE.Sprite).isSprite) glows.push(e as THREE.Sprite);
    }
    if (b.bolts.length) {
      const im = new THREE.InstancedMesh(fastenerGeo, fastenerMat, b.bolts.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      b.bolts.forEach((bolt, k) => {
        q.setFromUnitVectors(up, bolt.n);
        m.compose(bolt.p.clone().sub(anchor), q, new THREE.Vector3(bolt.s, bolt.s, bolt.s));
        im.setMatrixAt(k, m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.computeBoundingBox();
      im.userData.componentId = 'fasteners';
      im.userData.host = data.id;
      im.name = `fasteners@${data.id}`;
      node.group.add(im);
      node.fastenerMeshes.push(im);
      fastenerNode.meshes.push(im);
      pickables.push(im);
    }
    if (node.localBox.isEmpty()) node.localBox.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.02, 0.02, 0.02));
    root.add(node.group);
  }

  // fasteners node box: approximate overall
  fastenerNode.localBox.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.6, 0.2, 0.6));

  return { root, nodes, pickables, ledMaterials, glows, recLamp, triangles: Math.round(triangles) };
}
