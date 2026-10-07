/**
 * Procedural K1000ULE visualization model.
 *
 * No official CAD data is used. Geometry is generated from parametric shapes whose
 * proportions were traced from Kraus Hamdani Aerospace's public product imagery:
 * a high-aspect-ratio solar wing, slender fuselage pod with nose tractor propeller,
 * long tail boom with T-tail, and two under-wing booms carrying four lift rotors.
 * Absolute scale and internal layout are illustrative.
 *
 * If a real model is supplied at /models/k1000ule.glb it replaces this geometry
 * (see GltfModel.ts). Each entry in the component database gets its own THREE.Group
 * so it can be exploded, hidden, highlighted and inspected independently. Draw calls
 * are kept low by merging each component's geometry per material; fasteners use
 * InstancedMesh.
 */
import * as THREE from 'three';
import { COMPONENTS, type DroneComponent } from '../data/components';
import {
  BOOM,
  BOOM_Y,
  CRUISE,
  FUSELAGE,
  GEAR,
  LIFT,
  LIFT_LAYOUT,
  MOTOR_BASE_Y,
  TAIL,
  WING,
  pad,
  wingStation,
  wingY,
} from '../data/layout';
import {
  alignY,
  airfoilAt,
  box,
  cyl,
  lathe,
  latheZ,
  merge,
  propBlade,
  rbox,
  scaleUV,
  sphere,
  surfaceSlab,
  tint,
  torus,
  tube,
  wingLoft,
  xf,
  type LoftStation,
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
import { glowTexture, serialPlate, solarTexture, wearMark } from './textures';

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

// ───────────────────────────────────────────────────────── fuselage surface
/**
 * [z, halfWidth, centreY, halfHeightTop, halfHeightBottom] stations traced from the
 * reference top view, 3/4 render and flight photo: a slender conical nose, a deep keel
 * under the wing, and an aft section that sweeps up into a tail boom leaving from the
 * top of the fuselage at wing level, with a wide triangular dorsal fairing behind the wing.
 */
const FS: [number, number, number, number, number][] = [
  [0.925, 0.025, -0.016, 0.025, 0.027],
  [0.8, 0.04, -0.02, 0.05, 0.055],
  [0.6, 0.055, -0.02, 0.075, 0.09],
  [0.4, 0.066, -0.02, 0.098, 0.11],
  [0.25, 0.072, -0.02, 0.112, 0.12],
  [0.1, 0.08, -0.015, 0.108, 0.118],
  [-0.05, 0.094, 0.0, 0.095, 0.105],
  [-0.15, 0.076, 0.018, 0.077, 0.08],
  [-0.25, 0.054, 0.035, 0.058, 0.055],
  [-0.35, 0.036, 0.05, 0.04, 0.036],
  [-0.45, 0.026, 0.06, 0.028, 0.026],
  [-0.55, 0.021, 0.066, 0.021, 0.021],
  [-0.62, 0.019, 0.068, 0.019, 0.019],
];
const FUSE_Z0 = FS[0][0];
const FUSE_Z1 = FS[FS.length - 1][0];
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** [halfWidth, centreY, halfHeightTop, halfHeightBottom] at station z. */
export function fuselageProfile(z: number): [number, number, number, number] {
  const zc = Math.min(FUSE_Z0, Math.max(FUSE_Z1, z));
  let i = 0;
  while (i < FS.length - 2 && zc < FS[i + 1][0]) i++;
  const a = FS[i];
  const b = FS[i + 1];
  const t = (a[0] - zc) / (a[0] - b[0]);
  const p0 = FS[Math.max(0, i - 1)];
  const p3 = FS[Math.min(FS.length - 1, i + 2)];
  return [1, 2, 3, 4].map((k) => cr(p0[k], a[k], b[k], p3[k], t)) as [number, number, number, number];
}
export const fuselageTop = (z: number) => {
  const [, yc, ht] = fuselageProfile(z);
  return yc + ht;
};
export const fuselageBottom = (z: number) => {
  const [, yc, , hb] = fuselageProfile(z);
  return yc - hb;
};

/** cruise-motor axis height (centre of the nose section) */
export const NOSE_Y = -0.016;

const SE = 2.5;
const sp = (c: number, n: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
const zToU = (z: number) => (FUSE_Z0 - z) / (FUSE_Z0 - FUSE_Z1);

export const fuselageSurface: SurfaceFn = (u, v, out) => {
  const z = FUSE_Z0 - Math.min(1, Math.max(0, u)) * (FUSE_Z0 - FUSE_Z1);
  const [w, yc, ht, hb] = fuselageProfile(z);
  const c = Math.cos(v);
  const s = Math.sin(v);
  out.set(w * sp(c, SE), yc + (s >= 0 ? ht : hb) * sp(s, SE), z);
  return out;
};

function fusePatch(b: Builder, mat: MatKey, z0: number, z1: number, v0: number, v1: number, thick: number, off: number, su = 14, sv = 14) {
  b.add(mat, surfaceSlab(fuselageSurface, zToU(z1), zToU(z0), v0, v1, su, sv, thick, off));
}

/** Place a geometry (X = along body, Y = surface normal, Z = across) on the fuselage at (z, v). */
function onFuselage(g: THREE.BufferGeometry, z: number, v: number, lift: number) {
  const u = zToU(z);
  const p = fuselageSurface(u, v, new THREE.Vector3());
  const e = 1e-3;
  const du = fuselageSurface(u + e, v, new THREE.Vector3()).sub(fuselageSurface(u - e, v, new THREE.Vector3())).normalize();
  const dv = fuselageSurface(u, v + e, new THREE.Vector3()).sub(fuselageSurface(u, v - e, new THREE.Vector3())).normalize();
  const n = new THREE.Vector3().crossVectors(du, dv).normalize();
  if (n.dot(new THREE.Vector3(p.x, p.y - fuselageProfile(p.z)[1], 0)) < 0) n.negate();
  const x = du.clone().negate(); // forward
  const zA = new THREE.Vector3().crossVectors(x, n).normalize();
  x.crossVectors(n, zA).normalize();
  const m = new THREE.Matrix4().makeBasis(x, n, zA);
  m.setPosition(p.addScaledVector(n, lift));
  g.applyMatrix4(m);
  return g;
}

// ───────────────────────────────────────────────────────── wing helpers
/** Spanwise stations for |x| in [xa, xb] (denser toward the elliptical tip). */
function wingStations(xa: number, xb: number, side: 1 | -1, tcScale = 1): LoftStation[] {
  const xs = new Set<number>([xa, xb]);
  for (let x = 0; x < WING.tipStart; x += 0.25) if (x > xa && x < xb) xs.add(x);
  for (let k = 0; k <= 16; k++) {
    const x = WING.tipStart + (WING.halfSpan - WING.tipStart) * Math.sin((k / 16) * (Math.PI / 2));
    if (x > xa && x < xb) xs.add(x);
  }
  return [...xs]
    .sort((a, b) => a - b)
    .map((x) => {
      const st = wingStation(x);
      const tc = (0.14 - 0.03 * (x / WING.halfSpan)) * tcScale;
      return { s: side * x, t: wingY(x), le: st.le, chord: st.chord, tc };
    });
}

/** Point on the wing upper surface at |x|, chord fraction xc. */
function wingUpper(side: 1 | -1, x: number, xc: number, out: THREE.Vector3, lift = 0) {
  const st = wingStation(x);
  const tc = 0.14 - 0.03 * (x / WING.halfSpan);
  const [up] = airfoilAt(xc, tc);
  return out.set(side * x, wingY(x) + up * st.chord + lift, st.le - xc * st.chord);
}

/** Thin conformal panel on a wing upper surface, returned as a closed slab. */
function solarPanel(side: 1 | -1, xa: number, xb: number, ca: number, cb: number) {
  const fn: SurfaceFn =
    side > 0
      ? (u, v, o) => wingUpper(1, u, v, o)
      : (u, v, o) => wingUpper(-1, v, u, o); // parameter order swapped so the normal still points up
  return side > 0 ? surfaceSlab(fn, xa, xb, ca, cb, 10, 8, 0.0012, 0.0016) : surfaceSlab(fn, ca, cb, xa, xb, 8, 10, 0.0012, 0.0016);
}

function navLight(b: Builder, key: MatKey, pos: V3, color: string) {
  b.add(key, sphere(0.008, pos, 14, 10));
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }),
  );
  glow.position.set(pos[0], pos[1], pos[2]);
  glow.scale.setScalar(0.12);
  glow.userData.glow = true;
  glow.raycast = () => {};
  b.extras.push(glow);
}

let _solarTex: THREE.Texture | null = null;
const solarMat = () => {
  _solarTex ??= solarTexture();
  return _solarTex;
};

const BUILDERS: Record<string, BuildFn> = {};

// ───────────────────────────────────────────────────────── airframe
BUILDERS['fuselage'] = (b) => {
  b.add('shell', surfaceSlab(fuselageSurface, 0, 1, 0, Math.PI * 2, 96, 64, FUSELAGE.shellThickness));
  // hatch seams (hatches themselves are separate components)
  fusePatch(b, 'seam', 0.475, 0.725, 0.355 * Math.PI, 0.645 * Math.PI, 0.0005, 0.00025);
  fusePatch(b, 'seam', 0.175, 0.445, 1.355 * Math.PI, 1.645 * Math.PI, 0.0005, 0.00025);
  // nose joint ring
  fusePatch(b, 'seam', 0.832, 0.836, 0, Math.PI * 2, 0.0004, 0.0002, 2, 48);
  // logo decals
  for (const side of [1, -1]) {
    const mat = new THREE.MeshStandardMaterial({
      map: logoTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const g = new THREE.PlaneGeometry(0.16, 0.035);
    g.rotateX(-Math.PI / 2); // text along +X, normal +Y
    if (side > 0) g.rotateY(Math.PI);
    onFuselage(g, 0.36, side > 0 ? 0.08 : Math.PI - 0.08, 0.0008);
    b.addCustom(g, mat);
  }
};

let _logo: THREE.Texture | null = null;
function logoTexture() {
  if (_logo) return _logo;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 224;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(40,46,54,0.88)';
  ctx.font = '400 132px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('K1000ULE', 16, 112);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _logo = t;
  return t;
}

BUILDERS['nose-cone'] = (b) => {
  // slender nose fairing ahead of the conical pod, around the cruise motor axis
  b.add(
    'shell',
    latheZ(
      [
        [0, 0.918],
        [0.0262, 0.918],
        [0.0252, 0.93],
        [0.0228, 0.941],
        [0.0205, 0.948],
        [0, 0.948],
      ],
      40,
      0,
      NOSE_Y,
    ),
  );
  b.add('seam', torus(0.0258, 0.0006, [0, NOSE_Y, 0.9185], [0, 0, 0], 6, 40));
};

for (const side of [1, -1] as const) {
  BUILDERS[side > 0 ? 'wing-port' : 'wing-starboard'] = (b) => {
    const A = WING.aileron;
    b.add('shell', wingLoft(wingStations(0, A.inner, side), 0, 1));
    b.add('shell', wingLoft(wingStations(A.inner, A.outer, side), 0, A.hinge));
    b.add('shell', wingLoft(wingStations(A.outer, WING.halfSpan, side), 0, 1));
    // wingtip position light
    const tip = wingStation(WING.halfSpan - 0.04);
    navLight(b, side > 0 ? 'ledRed' : 'ledGreen', [side * (WING.halfSpan - 0.035), wingY(WING.halfSpan), (tip.le + tip.te) / 2 + 0.01], side > 0 ? '#ff3b2e' : '#3dff7e');
  };
  BUILDERS[side > 0 ? 'aileron-port' : 'aileron-starboard'] = (b) => {
    const A = WING.aileron;
    b.add('shell', wingLoft(wingStations(A.inner + 0.004, A.outer - 0.004, side), A.hinge + 0.006, 1));
    // hinge line
    const mid = (A.inner + A.outer) / 2;
    void mid;
  };
  BUILDERS[side > 0 ? 'solar-port' : 'solar-starboard'] = (b) => {
    for (let i = 0; i < 8; i++) {
      const xa = 0.06 + i * 0.285;
      const xb = xa + 0.27;
      const ca = i >= 6 ? 0.16 : 0.05;
      const g = solarPanel(side, xa, xb, ca, 0.9);
      b.addCustom(g, new THREE.MeshPhysicalMaterial({ map: solarMat(), roughness: 0.16, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 }));
    }
  };
}

BUILDERS['wing-spar'] = (b) => {
  const zs = 0.172;
  for (const side of [1, -1] as const) {
    const p0 = new THREE.Vector3(0, wingY(0) + 0.011, zs);
    const p1 = new THREE.Vector3(side * 2.25, wingY(2.25) + 0.008, zs - 0.01);
    const len = p0.distanceTo(p1);
    const g = cyl(0.0065, 0.012, len, 20);
    scaleUV(g, 3, 60);
    alignY(g, p1.clone().sub(p0).normalize(), p0.clone().lerp(p1, 0.5));
    b.add('carbon', g);
    for (let k = 1; k <= 6; k++) {
      const x = k * 0.35;
      const st = wingStation(x);
      const tc = (0.14 - 0.03 * (x / WING.halfSpan)) * 0.86;
      const stations: LoftStation[] = [
        { s: side * (x - 0.003), t: wingY(x) + 0.001, le: st.le - 0.01, chord: st.chord - 0.02, tc },
        { s: side * (x + 0.003), t: wingY(x) + 0.001, le: st.le - 0.01, chord: st.chord - 0.02, tc },
      ];
      b.add('plastic', wingLoft(stations, 0.02, 0.95, 16));
    }
  }
  b.add('aluminum', rbox(0.12, 0.022, 0.04, 0.004, [0, wingY(0) + 0.011, zs]));
};

BUILDERS['tail-boom'] = (b) => {
  // leaves the top of the aft fuselage at wing level and runs straight to the fin
  const p0 = new THREE.Vector3(0, 0.068, -0.585);
  const p1 = new THREE.Vector3(0, 0.08, FUSELAGE.tailEndZ + 0.005);
  const L = p0.distanceTo(p1);
  const g = lathe(
    [
      [0, 0],
      [0.0195, 0],
      [0.0145, L],
      [0.0095, L + 0.007],
      [0, L + 0.01],
    ],
    32,
  );
  alignY(g, p1.clone().sub(p0).normalize(), p0);
  b.add('shell', g);
};

const finStations = (): LoftStation[] => [
  { s: TAIL.finBaseY - 0.012, t: 0, le: TAIL.finRootLE, chord: TAIL.finRootLE - TAIL.finRootTE, tc: 0.1 },
  { s: TAIL.finTipY, t: 0, le: TAIL.finTipLE, chord: TAIL.finTipLE - TAIL.finTipTE, tc: 0.09 },
];

BUILDERS['vertical-fin'] = (b) => {
  b.add('shell', wingLoft(finStations(), 0, 0.7, 22, 0, 'y'));
};
BUILDERS['rudder'] = (b) => {
  b.add('shell', wingLoft(finStations(), 0.705, 1, 16, 0, 'y'));
};

function stabStations(side: 1 | -1): LoftStation[] {
  const c0 = TAIL.stabLE - TAIL.stabTE;
  const xs = [0, 0.2, 0.36, 0.44, 0.49, 0.515, 0.528, TAIL.stabHalfSpan];
  return xs.map((x) => {
    const t = Math.max(0, (x - 0.4) / (TAIL.stabHalfSpan - 0.4));
    const c = Math.max(0.05, c0 * Math.sqrt(Math.max(0, 1 - t * t)));
    const te = TAIL.stabTE + 0.3 * (c0 - c);
    return { s: side * x, t: TAIL.finTipY + 0.006, le: te + c, chord: c, tc: 0.09 };
  });
}

BUILDERS['horizontal-stabilizer'] = (b) => {
  for (const side of [1, -1] as const) b.add('shell', wingLoft(stabStations(side), 0, 0.68, 20, 0));
};
BUILDERS['elevator'] = (b) => {
  for (const side of [1, -1] as const) b.add('shell', wingLoft(stabStations(side), 0.685, 1, 14, 0));
};

BUILDERS['solar-tail'] = (b) => {
  const c0 = TAIL.stabLE - TAIL.stabTE;
  for (const side of [1, -1] as const) {
    for (const [xa, xb] of [
      [0.03, 0.235],
      [0.255, 0.46],
    ]) {
      const fn: SurfaceFn = (u, v, o) => {
        const x = side > 0 ? u : v;
        const xc = side > 0 ? v : u;
        const [up] = airfoilAt(xc, 0.09, 0);
        const t = Math.max(0, (x - 0.4) / (TAIL.stabHalfSpan - 0.4));
        const c = Math.max(0.05, c0 * Math.sqrt(Math.max(0, 1 - t * t)));
        const te = TAIL.stabTE + 0.3 * (c0 - c);
        return o.set(side * x, TAIL.finTipY + 0.006 + up * c, te + c - xc * c);
      };
      const g = side > 0 ? surfaceSlab(fn, xa, xb, 0.1, 0.62, 6, 6, 0.001, 0.0014) : surfaceSlab(fn, 0.1, 0.62, xa, xb, 6, 6, 0.001, 0.0014);
      b.addCustom(g, new THREE.MeshPhysicalMaterial({ map: solarMat(), roughness: 0.16, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 }));
    }
  }
};

for (const side of [1, -1] as const) {
  BUILDERS[side > 0 ? 'boom-port' : 'boom-starboard'] = (b) => {
    const x = side * BOOM.x;
    const r = BOOM.radius;
    b.add(
      'shell',
      latheZ(
        [
          [0, BOOM.rearZ],
          [0.009, BOOM.rearZ + 0.006],
          [0.017, BOOM.rearZ + 0.03],
          [r, BOOM.rearZ + 0.08],
          [r, BOOM.frontZ - 0.04],
          [r - 0.002, BOOM.frontZ - 0.02],
          [0.016, BOOM.frontZ - 0.007],
          [0, BOOM.frontZ],
        ],
        32,
        x,
        BOOM_Y,
      ),
    );
    // faired pylon up into the wing
    b.add(
      'shell',
      wingLoft(
        [
          { s: BOOM_Y, t: x, le: 0.25, chord: 0.31, tc: 0.15 },
          { s: wingY(BOOM.x) + 0.004, t: x, le: 0.236, chord: 0.27, tc: 0.13 },
        ],
        0,
        1,
        20,
        0,
        'y',
      ),
    );
    // motor mount pads
    for (const z of [BOOM.rotorFrontZ, BOOM.rotorRearZ]) {
      b.add('anodized', rbox(0.052, 0.008, 0.052, 0.006, [x, MOTOR_BASE_Y - 0.004, z]));
      b.add('anodized', cyl(r + 0.0015, r + 0.0015, 0.05, 28, [x, BOOM_Y, z], [Math.PI / 2, 0, 0]));
    }
    // serial plate (Easter egg) under the starboard boom
    if (side < 0) {
      const g = new THREE.PlaneGeometry(0.034, 0.0085);
      g.rotateX(Math.PI / 2);
      g.rotateY(Math.PI / 2);
      g.translate(x, BOOM_Y - r - 0.0004, 0.05);
      b.addCustom(
        g,
        new THREE.MeshStandardMaterial({
          map: serialPlate('SN K1ULE-B02-0731', 'K1000ULE · ILLUSTRATIVE PLATE'),
          roughness: 0.35,
          metalness: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
    }
  };
}

BUILDERS['avionics-hatch'] = (b) => {
  fusePatch(b, 'panel', 0.48, 0.72, 0.36 * Math.PI, 0.64 * Math.PI, 0.002, 0.0009);
  for (const z of [0.5, 0.7])
    for (const v of [0.39, 0.61]) {
      const g = new THREE.BufferGeometry();
      void g;
      const p = fuselageSurface(zToU(z), v * Math.PI, new THREE.Vector3());
      b.bolt([p.x, p.y + 0.0028, p.z], [p.x * 2, 1, 0], 1.2);
    }
};

BUILDERS['fasteners'] = () => {};

// ───────────────────────────────────────────────────────── propulsion
let _motorGeo: Record<string, THREE.BufferGeometry> | null = null;
function motorGeometry() {
  if (_motorGeo) return _motorGeo;
  const s = LIFT.motorRadius / 0.052;
  const stator = lathe(
    [
      [0, 0],
      [0.042, 0],
      [0.046, 0.002],
      [0.046, 0.0105],
      [0.043, 0.0125],
      [0, 0.0125],
    ],
    40,
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
    48,
  );
  const ring = merge([torus(0.0507, 0.0016, [0, 0.0505, 0], [Math.PI / 2, 0, 0], 8, 48), torus(0.0512, 0.0012, [0, 0.0165, 0], [Math.PI / 2, 0, 0], 8, 48)]);
  const slots: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    slots.push(box(0.003, 0.022, 0.011, [Math.cos(a) * 0.0505, 0.033, Math.sin(a) * 0.0505], [0, -a, 0]));
  }
  const shaft = merge([cyl(0.0135, 0.0135, 0.012, 24, [0, 0.064, 0])]);
  const out = { stator, bell, ring, slots: merge(slots), shaft };
  for (const g of Object.values(out)) g.scale(s, s, s);
  _motorGeo = out;
  return out;
}

for (const a of LIFT_LAYOUT) {
  BUILDERS[`lift-motor-${pad(a.index)}`] = (b) => {
    const g = motorGeometry();
    const base: V3 = [a.x, MOTOR_BASE_Y, a.z];
    const place = (geo: THREE.BufferGeometry) => xf(geo.clone(), base);
    b.add('anodized', place(g.stator));
    b.add('motorBell', place(g.bell));
    b.add('aluminum', place(g.ring), place(g.shaft));
    b.add('blackMatte', place(g.slots));
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + Math.PI / 4;
      b.bolt([a.x + Math.cos(ang) * 0.021, MOTOR_BASE_Y, a.z + Math.sin(ang) * 0.021], [0, 1, 0], 0.7);
    }
  };
}

const _blade: Record<string, THREE.BufferGeometry> = {};
const bladeGeo = (dir: 1 | -1, root: number, tip: number) => {
  const key = `${dir}:${root}:${tip}`;
  if (!_blade[key]) {
    const g = propBlade(root, tip, dir);
    scaleUV(g, 14, 2);
    _blade[key] = g;
  }
  return _blade[key];
};

for (const a of LIFT_LAYOUT) {
  BUILDERS[`lift-prop-${pad(a.index)}`] = (b, ctx) => {
    const dir: 1 | -1 = a.spin === 'CW' ? -1 : 1;
    const c = new THREE.Vector3(...ctx.data.position);
    const s = 0.6;
    const P = (g: THREE.BufferGeometry, yaw: number) => {
      const out = g.clone();
      out.rotateY(yaw + Math.PI / 2); // parked in line with the boom
      out.translate(c.x, c.y, c.z);
      return out;
    };
    const hub = lathe(
      [
        [0, -0.011 * s],
        [0.022 * s, -0.011 * s],
        [0.025 * s, -0.008 * s],
        [0.025 * s, 0.006 * s],
        [0.02 * s, 0.011 * s],
        [0, 0.011 * s],
      ],
      32,
    );
    const spinner = lathe(
      [
        [0, 0.011 * s],
        [0.015 * s, 0.011 * s],
        [0.013 * s, 0.017 * s],
        [0.007 * s, 0.021 * s],
        [0, 0.0225 * s],
      ],
      24,
    );
    b.addSpin('anodized', P(hub, 0));
    b.addSpin('aluminum', P(spinner, 0));
    const blade = bladeGeo(dir, 0.016, LIFT.propRadius);
    b.addSpin('carbon', P(blade, 0), P(blade, Math.PI));
    if (a.index === 3) {
      const t = 0.62;
      const twist = THREE.MathUtils.degToRad(24 - 16 * t) * dir;
      const r = 0.016 + (LIFT.propRadius - 0.016) * t;
      const g = new THREE.PlaneGeometry(0.018, 0.007);
      g.rotateX(-Math.PI / 2);
      g.rotateX(-twist);
      g.translate(r, 0.0035 + r * 0.035, 0.0045 * dir);
      g.rotateY(Math.PI + Math.PI / 2);
      g.translate(c.x, c.y, c.z);
      b.addCustom(
        g,
        new THREE.MeshStandardMaterial({ map: wearMark(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.8 }),
        true,
      );
    }
  };
}

for (const a of LIFT_LAYOUT) {
  BUILDERS[`esc-${pad(a.index)}`] = (b, ctx) => {
    const [x, y, z] = ctx.data.position;
    b.add('pcbBlack', rbox(0.03, 0.003, 0.06, 0.001, [x, y - 0.008, z]));
    b.add('anodized', rbox(0.026, 0.01, 0.054, 0.002, [x, y - 0.0005, z]));
    b.add('ledBlue', box(0.002, 0.001, 0.002, [x + 0.01, y + 0.0048, z]));
  };
}

BUILDERS['cruise-motor'] = (b) => {
  b.add('motorBell', cyl(0.0195, 0.0195, 0.011, 36, [0, NOSE_Y, 0.9535], [Math.PI / 2, 0, 0]));
  b.add('aluminum', torus(0.0196, 0.0008, [0, NOSE_Y, 0.958], [0, 0, 0], 6, 36));
};

BUILDERS['cruise-prop'] = (b) => {
  const z = CRUISE.z;
  b.addSpin(
    'blackMatte',
    latheZ(
      [
        [0, 0.959],
        [0.0205, 0.959],
        [0.0195, 0.969],
        [0.0158, 0.98],
        [0.009, 0.989],
        [0, 0.992],
      ],
      36,
      0,
      NOSE_Y,
    ),
  );
  const blade = bladeGeo(1, 0.02, CRUISE.propRadius);
  for (const yaw of [0, Math.PI]) {
    const g = blade.clone();
    g.rotateY(yaw);
    g.rotateX(Math.PI / 2); // disc in XY, thrust along +Z
    g.translate(0, NOSE_Y, z);
    b.addSpin('carbon', g);
  }
};

BUILDERS['cruise-esc'] = (b) => {
  b.add('anodized', rbox(0.04, 0.026, 0.05, 0.004, [0, -0.022, 0.8]));
  const fins: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) fins.push(box(0.0014, 0.007, 0.044, [-0.014 + k * 0.007, -0.0055, 0.8]));
  b.add('anodized', merge(fins));
};

// ───────────────────────────────────────────────────────── power
BUILDERS['battery'] = (b) => {
  const cz = 0.3;
  const L = 0.36;
  b.add('plastic', rbox(0.1, 0.075, L, 0.008, [0, 0.015, cz]));
  b.add('accent', rbox(0.102, 0.077, 0.006, 0.004, [0, 0.015, cz + L / 2 - 0.02]));
  b.add('anodized', rbox(0.104, 0.079, 0.014, 0.005, [0, 0.015, cz - L / 2 + 0.005]));
  for (let k = 0; k < 4; k++) b.add('ledBlue', box(0.004, 0.003, 0.002, [-0.012 + k * 0.008, 0.035, cz - L / 2 - 0.0025]));
  const lg = new THREE.PlaneGeometry(0.088, 0.044);
  lg.rotateX(-Math.PI / 2);
  lg.rotateY(Math.PI / 2);
  lg.translate(0, 0.0526, cz + 0.02);
  b.add('batteryLabel', lg);
  const sg = new THREE.PlaneGeometry(0.04, 0.01);
  sg.rotateX(Math.PI / 2);
  sg.translate(0, 0.015 - 0.0398, cz - L / 2 + 0.005);
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

BUILDERS['mppt'] = (b) => {
  b.add('anodized', rbox(0.056, 0.022, 0.07, 0.003, [0, 0.033, -0.12]));
  const fins: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) fins.push(box(0.0014, 0.007, 0.064, [-0.021 + k * 0.007, 0.0475, -0.12]));
  b.add('anodized', merge(fins));
  b.add('ledGreen', box(0.0025, 0.0015, 0.0025, [0.022, 0.0445, -0.09]));
};

BUILDERS['power-distribution'] = (b) => {
  b.add('pcb', rbox(0.08, 0.004, 0.08, 0.002, [0, -0.035, 0.07]));
  b.add('copper', box(0.05, 0.0016, 0.012, [0, -0.0325, 0.04]));
  for (const x of [-0.025, 0.025]) {
    b.add('plastic', cyl(0.004, 0.004, 0.01, 14, [x, -0.028, 0.095]));
    b.add('aluminum', cyl(0.0041, 0.0041, 0.0015, 14, [x, -0.0225, 0.095]));
  }
  b.add('blackMatte', rbox(0.016, 0.008, 0.012, 0.001, [0.02, -0.029, 0.06]));
};

BUILDERS['wiring-harness'] = (b) => {
  const pair = (pts: V3[], r = 0.0022, off: V3 = [0.004, 0, 0]) => {
    b.add('wireRed', tube(pts, r, 32, 8));
    b.add('wireBlack', tube(pts.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]] as V3), r, 32, 8));
  };
  // battery → PDB
  pair([[-0.01, 0.0, 0.12], [-0.01, -0.02, 0.105], [-0.006, -0.031, 0.09]], 0.0028);
  // PDB → cruise ESC
  pair([[0.03, -0.038, 0.11], [0.05, -0.06, 0.3], [0.03, -0.045, 0.56], [0.012, -0.03, 0.776]]);
  // PDB → wing root → spar → booms → lift ESCs
  for (const side of [1, -1] as const) {
    const x = side * BOOM.x;
    const up: V3[] = [
      [side * 0.03, -0.03, 0.05],
      [side * 0.068, 0.0, 0.02],
      [side * 0.05, 0.075, 0.08],
      [side * 0.03, wingY(0.03) + 0.006, 0.155],
      [side * 0.4, wingY(0.4) + 0.006, 0.156],
      [x - side * 0.02, wingY(BOOM.x) + 0.004, 0.156],
      [x, BOOM_Y + 0.01, 0.15],
    ];
    pair(up, 0.0018, [0, 0, 0.005]);
    for (const zEnd of [BOOM.rotorFrontZ - 0.1, BOOM.rotorRearZ + 0.1]) {
      pair([[x, BOOM_Y + 0.008, 0.15], [x, BOOM_Y + 0.006, (0.15 + zEnd) / 2], [x, BOOM_Y + 0.003, zEnd]], 0.0016, [side * 0.004, 0, 0]);
    }
  }
  // solar → MPPT
  b.add('wireYellow', tube([[0.012, 0.046, -0.095], [0.012, 0.085, -0.02], [0.012, wingY(0) + 0.004, 0.1], [0.03, wingY(0.03) + 0.01, 0.165]], 0.0016, 24, 6));
  // signal: FC → SATCOM, datalink, mission computer
  b.add('wireSignal', tube([[0, 0.042, 0.0], [0, 0.062, -0.08], [0, 0.074, -0.128]], 0.0014, 20, 6));
  b.add('wireSignal', tube([[0.015, 0.03, -0.01], [0.02, 0.04, -0.15], [0.008, 0.048, -0.28]], 0.0014, 24, 6));
  b.add('wireSignal', tube([[0, 0.042, 0.065], [0, 0.064, 0.3], [0, 0.046, 0.555]], 0.0014, 24, 6));
  b.add('wireBlack', tube([[0, 0.029, -0.302], [0, 0.012, -0.292], [0, fuselageBottom(-0.282) + 0.004, -0.282]], 0.0015, 10, 6));
};

// ───────────────────────────────────────────────────────── avionics
BUILDERS['flight-controller'] = (b) => {
  for (const [x, z] of [
    [0.028, 0.058],
    [-0.028, 0.058],
    [0.028, 0.002],
    [-0.028, 0.002],
  ])
    b.add('rubber', cyl(0.005, 0.005, 0.01, 12, [x, 0.012, z]));
  b.add('anodized', rbox(0.07, 0.022, 0.07, 0.004, [0, 0.028, 0.03]));
  const lid = new THREE.PlaneGeometry(0.062, 0.062);
  lid.rotateX(-Math.PI / 2);
  lid.translate(0, 0.0392, 0.03);
  b.add('fcLid', lid);
  for (let k = 0; k < 4; k++) b.add('plasticLight', rbox(0.01, 0.005, 0.004, 0.0006, [-0.022 + k * 0.0147, 0.023, 0.0665]));
  b.add('ledGreen', box(0.0025, 0.0015, 0.0025, [0.028, 0.0395, 0.002]));
};

BUILDERS['companion-computer'] = (b) => {
  const z = 0.6;
  b.add('pcb', rbox(0.075, 0.003, 0.1, 0.002, [0, 0.004, z]));
  b.add('anodized', rbox(0.062, 0.006, 0.08, 0.001, [0, 0.0095, z]));
  const fins: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) fins.push(box(0.0014, 0.018, 0.08, [-0.028 + k * 0.007, 0.0215, z]));
  b.add('anodized', merge(fins));
  b.add('gold', box(0.03, 0.002, 0.004, [0, 0.0062, z - 0.047]));
};

BUILDERS['satcom'] = (b) => {
  const z = -0.14;
  const top = fuselageTop(z);
  const g = sphere(1, [0, 0, 0], 32, 20);
  g.scale(0.03, 0.022, 0.07);
  g.translate(0, top - 0.004, z);
  b.add('radome', g);
  b.add('anodized', rbox(0.064, 0.004, 0.15, 0.002, [0, top - 0.007, z]));
};

BUILDERS['datalink'] = (b) => {
  b.add('anodized', rbox(0.042, 0.03, 0.08, 0.004, [0, 0.046, -0.32]));
  b.add('gold', cyl(0.0032, 0.0032, 0.008, 12, [0, 0.027, -0.3], [0, 0, 0]));
  b.add('ledBlue', box(0.003, 0.002, 0.001, [0.014, 0.052, -0.2797]));
};

BUILDERS['gnss'] = (b) => {
  const z = -0.42;
  const top = fuselageTop(z);
  b.add('plasticLight', lathe([[0, 0], [0.019, 0], [0.019, 0.006], [0.014, 0.011], [0, 0.012]], 32, [0, top - 0.003, z]));
  b.add('blackMatte', cyl(0.0195, 0.0195, 0.002, 32, [0, top - 0.002, z]));
};

for (const [id, z, yTop] of [
  ['antenna-01', -0.28, fuselageBottom(-0.28)],
  ['antenna-02', -0.95, 0.062],
] as const) {
  BUILDERS[id] = (b) => {
    const s = new THREE.Shape();
    s.moveTo(0.02, 0);
    s.lineTo(-0.025, 0);
    s.lineTo(-0.032, -0.06);
    s.lineTo(-0.02, -0.062);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0012, bevelSegments: 2 });
    g.translate(0, 0, -0.002);
    g.rotateY(Math.PI / 2); // shape X → -Z (sweep aft)
    g.translate(0, yTop + 0.002, z);
    b.add('plasticLight', g);
  };
}

// ───────────────────────────────────────────────────────── sensors
BUILDERS['pitot'] = (b) => {
  const x = 1.25;
  const st = wingStation(x);
  const yl = wingY(x) - 0.006;
  b.add('shell', rbox(0.008, 0.03, 0.03, 0.003, [x, yl - 0.012, st.le - 0.04]));
  b.add('aluminum', cyl(0.0035, 0.0035, 0.16, 14, [x, yl - 0.026, st.le + 0.03], [Math.PI / 2, 0, 0]));
  b.add('blackMatte', cyl(0.0037, 0.0037, 0.006, 14, [x, yl - 0.026, st.le + 0.11], [Math.PI / 2, 0, 0]));
};

BUILDERS['lidar-down'] = (b) => {
  const bot = fuselageBottom(-0.05);
  b.add('blackMatte', rbox(0.022, 0.012, 0.03, 0.003, [0, bot + 0.002, -0.05]));
  b.add('lens', cyl(0.005, 0.005, 0.002, 20, [0, bot - 0.0042, -0.043]));
  b.add('glass', cyl(0.0055, 0.0055, 0.002, 20, [0, bot - 0.0042, -0.057]));
};

BUILDERS['nav-lights'] = (b) => {
  navLight(b, 'ledWhite', [0, TAIL.finTipY + 0.022, TAIL.stabTE + 0.012], '#ffffff');
  b.add('shell', rbox(0.012, 0.012, 0.03, 0.004, [0, TAIL.finTipY + 0.014, TAIL.stabTE + 0.02]));
};

// ───────────────────────────────────────────────────────── camera
BUILDERS['gimbal'] = (b) => {
  const z = 0.62;
  const bot = fuselageBottom(z);
  b.add('anodized', cyl(0.034, 0.034, 0.01, 40, [0, bot + 0.002, z]));
  b.add('motorBell', cyl(0.028, 0.03, 0.016, 40, [0, bot - 0.011, z]));
  b.add('aluminum', torus(0.0285, 0.0012, [0, bot - 0.004, z], [Math.PI / 2, 0, 0], 6, 40));
  for (const s of [1, -1]) {
    b.add('plasticLight', rbox(0.01, 0.05, 0.03, 0.004, [s * 0.05, bot - 0.042, z]));
    b.add('plasticLight', rbox(0.05, 0.01, 0.03, 0.004, [s * 0.026, bot - 0.02, z]));
    b.add('motorBell', cyl(0.012, 0.012, 0.008, 24, [s * 0.046, bot - 0.055, z], [0, 0, Math.PI / 2]));
  }
};

BUILDERS['eo-ir'] = (b) => {
  const z = 0.62;
  const cy = fuselageBottom(z) - 0.055;
  b.add('plasticLight', sphere(0.041, [0, cy, z], 40, 28));
  // sensor windows facing forward
  const win = (r: number, x: number, y: number, key: MatKey) => {
    const g = cyl(r, r, 0.006, 32);
    g.rotateX(Math.PI / 2);
    g.translate(x, cy + y, z + 0.0385);
    b.add(key, g);
  };
  b.add('blackMatte', rbox(0.05, 0.034, 0.012, 0.006, [0, cy - 0.002, z + 0.034]));
  win(0.012, -0.01, 0, 'lens');
  win(0.008, 0.014, 0.004, 'glass');
  b.add('ledRed', sphere(0.0018, [0.016, cy - 0.011, z + 0.041], 10, 8));
};

// ───────────────────────────────────────────────────────── payload
BUILDERS['payload-bay'] = (b) => {
  fusePatch(b, 'panel', 0.18, 0.44, 1.36 * Math.PI, 1.64 * Math.PI, 0.002, 0.0009);
  for (const z of [0.2, 0.42])
    for (const v of [1.4, 1.6]) {
      const p = fuselageSurface(zToU(z), v * Math.PI, new THREE.Vector3());
      b.bolt([p.x, p.y - 0.0028, p.z], [p.x * 2, -1, 0], 1.2);
    }
};

BUILDERS['payload-module'] = (b) => {
  b.add('anodized', rbox(0.1, 0.044, 0.22, 0.006, [0, -0.06, 0.31]));
  b.add('accent', rbox(0.03, 0.006, 0.004, 0.001, [0.03, -0.037, 0.4]));
  b.add('gold', box(0.04, 0.003, 0.006, [0, -0.037, 0.22]));
};

// ───────────────────────────────────────────────────────── landing gear
for (const side of [1, -1] as const) {
  BUILDERS[side > 0 ? 'gear-port' : 'gear-starboard'] = (b) => {
    const x = side * BOOM.x;
    for (const z of [BOOM.rotorFrontZ - 0.12, BOOM.rotorRearZ + 0.12]) {
      const top = new THREE.Vector3(x, BOOM_Y - BOOM.radius + 0.004, z);
      const foot = new THREE.Vector3(x + side * 0.03, GEAR.footY + 0.008, z);
      const g = cyl(0.0055, 0.0075, top.distanceTo(foot), 14);
      alignY(g, top.clone().sub(foot).normalize(), foot.clone().lerp(top, 0.5));
      scaleUV(g, 2, 12);
      b.add('carbon', g);
      b.add('anodized', rbox(0.022, 0.012, 0.03, 0.004, [x, BOOM_Y - BOOM.radius + 0.002, z]));
      b.add('rubber', rbox(0.026, 0.01, 0.05, 0.004, [foot.x, GEAR.footY + 0.004, z]));
    }
  };
}

BUILDERS['belly-skid'] = (b) => {
  for (const s of [1, -1]) {
    const pts: V3[] = [];
    for (let k = 0; k <= 8; k++) {
      const z = -0.08 + (k / 8) * 0.42;
      const [w, yc, , hb] = fuselageProfile(z);
      const x = s * 0.035;
      const y = yc - hb * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) / w, SE)), 1 / SE) - 0.004;
      pts.push([x, y, z]);
    }
    b.add('rubber', tube(pts, 0.004, 24, 8));
  }
};

// ───────────────────────────────────────────────────────── assemble
export function buildDroneModel(lib: MaterialLibrary, external?: THREE.Object3D | null): DroneModel {
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
    const fn = external ? undefined : BUILDERS[data.id];
    if (!fn) {
      if (!external) console.warn('No builder for component', data.id);
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
        if (data.id === 'eo-ir' && key === 'ledRed') recLamp.push(m as THREE.MeshStandardMaterial);
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

  if (external) triangles = distributeExternal(external, root, nodes, pickables, registerMat);

  // fasteners node box: approximate overall
  fastenerNode.localBox.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.6, 0.2, 0.6));

  return { root, nodes, pickables, ledMaterials, glows, recLamp, triangles: Math.round(triangles) };
}

/** Normalised mesh/node name → component id (exact, then longest-prefix match). */
const IDS_BY_LENGTH = COMPONENTS.map((c) => c.id).sort((a, b) => b.length - a.length);
function resolveComponentId(o: THREE.Object3D | null): string | null {
  for (let cur = o; cur; cur = cur.parent) {
    const explicit = cur.userData?.componentId as string | undefined;
    if (explicit && IDS_BY_LENGTH.includes(explicit)) return explicit;
    const name = cur.name.toLowerCase().replace(/[\s_.]+/g, '-');
    if (!name) continue;
    if (IDS_BY_LENGTH.includes(name)) return name;
    const hit = IDS_BY_LENGTH.find((id) => name.startsWith(id));
    if (hit) return hit;
  }
  return null;
}

/**
 * Re-home the meshes of an external (glTF) model into the component groups so every
 * interaction works unchanged. Meshes whose names don't match a component id fall
 * back to the fuselage.
 */
function distributeExternal(
  scene: THREE.Object3D,
  root: THREE.Group,
  nodes: Map<string, ComponentNode>,
  pickables: THREE.Object3D[],
  registerMat: (node: ComponentNode, mat: THREE.Material) => void,
) {
  for (const node of nodes.values()) if (!node.group.parent) root.add(node.group);
  root.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  let tris = 0;
  const unmatched = new Set<string>();
  for (const mesh of meshes) {
    const id = resolveComponentId(mesh) ?? 'fuselage';
    if (!resolveComponentId(mesh)) unmatched.add(mesh.name || '(unnamed)');
    const node = nodes.get(id)!;
    const local = node.group.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    mesh.removeFromParent();
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
      const c = m.clone();
      registerMat(node, c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    mesh.userData.componentId = id;
    node.group.add(mesh);
    node.meshes.push(mesh);
    pickables.push(mesh);
    mesh.updateMatrix();
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) node.localBox.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
    const g = mesh.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  for (const node of nodes.values()) {
    if (node.localBox.isEmpty()) node.localBox.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.02, 0.02, 0.02));
  }
  if (unmatched.size) console.info(`[K1000] ${unmatched.size} glTF meshes had no component id and were assigned to the fuselage.`);
  return Math.round(tris);
}
