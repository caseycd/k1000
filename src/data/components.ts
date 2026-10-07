/**
 * K1000 component database.
 *
 * Every interactive part of the visualization is described here. The 3D builder
 * (src/engine/DroneModel.ts) creates geometry for each id, and the UI reads names,
 * descriptions and specifications from this table. To add a component: add an entry
 * here and a matching builder in DroneModel.ts.
 *
 * IMPORTANT: specifications are ILLUSTRATIVE placeholders for a representative
 * heavy-lift multirotor. They are not official K1000 specifications.
 */
import { ARM, ARM_LAYOUT, BODY, GEAR, MOTOR, PROP, armPoint, pad, type Vec3 } from './layout';

export type CategoryId =
  | 'airframe'
  | 'propulsion'
  | 'power'
  | 'avionics'
  | 'sensors'
  | 'camera'
  | 'payload'
  | 'landing-gear';

export type Status = 'operational' | 'attention' | 'standby';

/**
 * exterior  — outer skin: fades out in INTERNAL view and becomes x-ray in X-RAY view.
 * structure — load-bearing / external hardware: x-rayed lightly in X-RAY view.
 * internal  — electronics and systems inside the fuselage.
 */
export type Layer = 'exterior' | 'structure' | 'internal';

export interface Spec {
  label: string;
  value: string;
}

export interface DroneComponent {
  id: string;
  name: string;
  category: CategoryId;
  system: string;
  type: string;
  partNumber: string;
  description: string;
  /** Nominal anchor point in metres (model frame). */
  position: Vec3;
  location: string;
  relatedComponents: string[];
  status: Status;
  statusNote?: string;
  illustrativeSpecifications: Spec[];
  layer: Layer;
  /** Offset applied at 100% explode, in metres. */
  explode: Vec3;
  /** 0..1 stagger so assemblies separate in sequence. */
  explodeDelay: number;
  /** Revealed only to people who look closely (see Easter eggs). */
  hiddenNote?: string;
  /** Show a label for this component in the technical overlay. */
  overlayLabel?: boolean;
}

export interface Category {
  id: CategoryId;
  label: string;
  code: string;
}

export const CATEGORIES: Category[] = [
  { id: 'airframe', label: 'Airframe', code: 'AFR' },
  { id: 'propulsion', label: 'Propulsion', code: 'PRP' },
  { id: 'power', label: 'Power', code: 'PWR' },
  { id: 'avionics', label: 'Avionics', code: 'AVN' },
  { id: 'sensors', label: 'Sensors', code: 'SNS' },
  { id: 'camera', label: 'Camera', code: 'CAM' },
  { id: 'payload', label: 'Payload', code: 'PLD' },
  { id: 'landing-gear', label: 'Landing Gear', code: 'LDG' },
];

const out = (i: number, d: number, up = 0): Vec3 => {
  const a = ARM_LAYOUT[i - 1];
  return [a.dir[0] * d, up, a.dir[1] * d];
};

const armComponents: DroneComponent[] = ARM_LAYOUT.map((a) => ({
  id: `arm-${pad(a.index)}`,
  name: `Arm ${pad(a.index)}`,
  category: 'airframe',
  system: 'Airframe Structure',
  type: 'Folding Carbon Arm',
  partNumber: `K1-AFR-A${pad(a.index)}`,
  description:
    'Pultruded carbon-fibre tube with an aluminium folding hinge at the root and an integrated motor mount and navigation light at the tip.',
  position: armPoint(a.index, (ARM.hingeRadius + ARM.tipRadius) / 2),
  location: `${a.side} quadrant`,
  relatedComponents: [`motor-${pad(a.index)}`, `esc-${pad(a.index)}`, 'center-frame', 'fasteners'],
  status: 'operational',
  illustrativeSpecifications: [
    { label: 'Tube', value: 'Ø41 mm carbon, 3K twill' },
    { label: 'Length', value: '≈ 450 mm (root to motor axis)' },
    { label: 'Hinge', value: '7075-T6 clamp, 2× M4 lock bolts' },
    { label: 'Nav light', value: a.index === 1 ? 'Green (starboard)' : a.index === 3 ? 'Red (port)' : 'White (aft)' },
    { label: 'Mass', value: '≈ 310 g' },
  ],
  layer: 'structure',
  explode: out(a.index, 0.2, 0),
  explodeDelay: 0.08,
  overlayLabel: a.index === 1,
  hiddenNote:
    a.index === 4
      ? 'Serial plate on the underside of the hinge block. Zoom in closely — the etching is about 3 mm tall.'
      : undefined,
}));

const motorComponents: DroneComponent[] = ARM_LAYOUT.map((a) => ({
  id: `motor-${pad(a.index)}`,
  name: `Motor ${pad(a.index)}`,
  category: 'propulsion',
  system: 'Propulsion System',
  type: 'Brushless Motor',
  partNumber: `K1-PRP-M${pad(a.index)}`,
  description: `Outrunner brushless motor on the ${a.side.toLowerCase()} arm. Spins ${a.spin} and drives a folding two-blade propeller. Bell vents pull air across the stator windings for cooling.`,
  position: armPoint(a.index, ARM.tipRadius, MOTOR.baseY + MOTOR.height / 2),
  location: `${a.side} Arm`,
  relatedComponents: [`prop-${pad(a.index)}`, `esc-${pad(a.index)}`, `arm-${pad(a.index)}`, 'wiring-harness'],
  status: 'operational',
  illustrativeSpecifications: [
    { label: 'Class', value: '100-series outrunner' },
    { label: 'KV rating', value: '≈ 100 KV' },
    { label: 'Configuration', value: '36N42P' },
    { label: 'Rotation', value: a.spin },
    { label: 'Max continuous', value: '≈ 2.8 kW' },
    { label: 'Bearings', value: 'Dual sealed, shielded' },
    { label: 'Mass', value: '≈ 620 g' },
  ],
  layer: 'structure',
  explode: out(a.index, 0.36, 0.09),
  explodeDelay: 0.2,
  overlayLabel: a.index === 4,
}));

const propComponents: DroneComponent[] = ARM_LAYOUT.map((a) => ({
  id: `prop-${pad(a.index)}`,
  name: `Propeller ${pad(a.index)}`,
  category: 'propulsion',
  system: 'Propulsion System',
  type: 'Folding Two-Blade Propeller',
  partNumber: `K1-PRP-P${pad(a.index)}`,
  description: `Folding carbon-composite propeller, ${a.spin} rotation. Blades are twisted and tapered for efficient hover; white tip markers aid visual inspection and ground safety.`,
  position: armPoint(a.index, ARM.tipRadius, PROP.y),
  location: `${a.side} Arm · above motor`,
  relatedComponents: [`motor-${pad(a.index)}`, `arm-${pad(a.index)}`],
  status: a.index === 3 ? 'attention' : 'operational',
  statusNote: a.index === 3 ? 'Illustrative: minor leading-edge wear flagged for next inspection.' : undefined,
  illustrativeSpecifications: [
    { label: 'Diameter', value: '≈ 760 mm (30 in)' },
    { label: 'Pitch', value: '≈ 9.6 in' },
    { label: 'Rotation', value: a.spin },
    { label: 'Material', value: 'Carbon / epoxy composite' },
    { label: 'Hub', value: 'Folding, quick-release' },
    { label: 'Mass (pair)', value: '≈ 95 g' },
  ],
  layer: 'structure',
  explode: out(a.index, 0.42, 0.42),
  explodeDelay: 0.3,
  overlayLabel: a.index === 3,
  hiddenNote: a.index === 3 ? 'Blade B, 62 % span: the wear mark is modelled. Zoom close to the leading edge.' : undefined,
}));

const escComponents: DroneComponent[] = ARM_LAYOUT.map((a) => ({
  id: `esc-${pad(a.index)}`,
  name: `ESC ${pad(a.index)}`,
  category: 'propulsion',
  system: 'Propulsion System',
  type: 'Electronic Speed Controller',
  partNumber: `K1-PRP-E${pad(a.index)}`,
  description: `Field-oriented-control speed controller for Motor ${pad(a.index)}. Mounted at the arm root inside the fuselage where airflow through the side vents cools its heatsink.`,
  position: armPoint(a.index, 0.115, 0.01),
  location: `Fuselage · ${a.side} arm root`,
  relatedComponents: [`motor-${pad(a.index)}`, 'power-distribution', 'flight-controller', 'wiring-harness'],
  status: 'operational',
  illustrativeSpecifications: [
    { label: 'Control', value: 'FOC sinusoidal' },
    { label: 'Input', value: '12S nominal' },
    { label: 'Continuous', value: '≈ 80 A' },
    { label: 'Signal', value: 'CAN / PWM' },
    { label: 'Cooling', value: 'Finned aluminium heatsink' },
  ],
  layer: 'internal',
  explode: out(a.index, 0.11, 0.14),
  explodeDelay: 0.42,
}));

export const COMPONENTS: DroneComponent[] = [
  // ───────────────────────── AIRFRAME
  {
    id: 'upper-shell',
    name: 'Upper Shell',
    category: 'airframe',
    system: 'Airframe Structure',
    type: 'Composite Fairing',
    partNumber: 'K1-AFR-S01',
    description:
      'Aerodynamic upper fairing that encloses avionics and power systems. Moulded composite with a satin clear-coat; houses two tool-less access panels and the side cooling vents.',
    position: [0, BODY.topHeight * 0.75, 0],
    location: 'Fuselage · upper half',
    relatedComponents: ['lower-chassis', 'access-panel-a', 'access-panel-b', 'cooling-vents'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Material', value: 'Carbon / aramid sandwich' },
      { label: 'Wall', value: '≈ 3.2 mm' },
      { label: 'Finish', value: 'Graphite satin clear-coat' },
      { label: 'Ingress', value: 'Splash resistant (illustrative)' },
      { label: 'Mass', value: '≈ 540 g' },
    ],
    layer: 'exterior',
    explode: [0, 0.4, 0],
    explodeDelay: 0,
    overlayLabel: true,
  },
  {
    id: 'lower-chassis',
    name: 'Lower Chassis',
    category: 'airframe',
    system: 'Airframe Structure',
    type: 'Structural Belly Pan',
    partNumber: 'K1-AFR-S02',
    description:
      'Lower half of the fuselage. Carries the landing gear, gimbal, payload rails and downward sensors, and closes the battery compartment from below.',
    position: [0, -BODY.bottomHeight * 0.7, 0],
    location: 'Fuselage · lower half',
    relatedComponents: ['upper-shell', 'gear-left', 'gear-right', 'payload-rails', 'gimbal'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Material', value: 'Carbon composite, foam core' },
      { label: 'Hardpoints', value: '6 (gear, gimbal, payload)' },
      { label: 'Wall', value: '≈ 3.2 mm' },
      { label: 'Mass', value: '≈ 610 g' },
    ],
    layer: 'exterior',
    explode: [0, -0.18, 0],
    explodeDelay: 0.05,
  },
  {
    id: 'center-frame',
    name: 'Center Frame',
    category: 'airframe',
    system: 'Airframe Structure',
    type: 'Carbon Sandwich Plate',
    partNumber: 'K1-AFR-F01',
    description:
      'The primary load path. A machined carbon plate ties all four arm hinges together and carries the electronics deck. Lightening pockets reduce mass without compromising stiffness.',
    position: [0, -0.004, 0],
    location: 'Fuselage · core',
    relatedComponents: ['arm-01', 'arm-02', 'arm-03', 'arm-04', 'flight-controller', 'battery'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Material', value: '4 mm carbon plate, CNC' },
      { label: 'Features', value: '14 lightening pockets' },
      { label: 'Interfaces', value: '4 arm hinges, 4 gear mounts' },
      { label: 'Mass', value: '≈ 280 g' },
    ],
    layer: 'internal',
    explode: [0, 0.0, 0],
    explodeDelay: 0.5,
    hiddenNote: 'The lightening pockets are deliberately asymmetric fore and aft — the battery sits slightly behind the CG datum.',
  },
  ...armComponents,
  {
    id: 'access-panel-a',
    name: 'Access Panel A',
    category: 'airframe',
    system: 'Airframe Structure',
    type: 'Removable Hatch',
    partNumber: 'K1-AFR-H01',
    description: 'Aft access hatch over the battery compartment. Four captive quarter-turn fasteners allow tool-less battery swaps.',
    position: [0, BODY.topHeight + 0.004, -0.09],
    location: 'Upper shell · aft',
    relatedComponents: ['upper-shell', 'battery', 'battery-bay'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Fasteners', value: '4× quarter-turn, captive' },
      { label: 'Seal', value: 'Perimeter EPDM gasket' },
      { label: 'Mass', value: '≈ 70 g' },
    ],
    layer: 'exterior',
    explode: [0, 0.62, -0.06],
    explodeDelay: 0.02,
  },
  {
    id: 'access-panel-b',
    name: 'Access Panel B',
    category: 'airframe',
    system: 'Airframe Structure',
    type: 'Removable Hatch',
    partNumber: 'K1-AFR-H02',
    description: 'Forward avionics hatch. Gives access to the flight controller, companion computer and service port.',
    position: [0, BODY.topHeight + 0.002, 0.08],
    location: 'Upper shell · forward',
    relatedComponents: ['upper-shell', 'flight-controller', 'companion-computer'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Fasteners', value: '4× quarter-turn, captive' },
      { label: 'Service port', value: 'USB-C (illustrative)' },
      { label: 'Mass', value: '≈ 55 g' },
    ],
    layer: 'exterior',
    explode: [0, 0.6, 0.08],
    explodeDelay: 0.02,
  },
  {
    id: 'cooling-vents',
    name: 'Cooling Vents',
    category: 'airframe',
    system: 'Thermal Management',
    type: 'Louvred Intake Grilles',
    partNumber: 'K1-AFR-V01',
    description:
      'Port and starboard louvred grilles. Ram air enters here, passes over the ESC heatsinks and companion computer, and exhausts aft.',
    position: [BODY.halfWidth, 0.03, 0.02],
    location: 'Upper shell · port & starboard flanks',
    relatedComponents: ['upper-shell', 'esc-01', 'esc-03', 'companion-computer'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Louvres', value: '2 × 9 slats' },
      { label: 'Filter', value: 'Stainless mesh, removable' },
      { label: 'Airflow', value: 'Passive ram + prop wash' },
    ],
    layer: 'exterior',
    explode: [0, 0.4, 0],
    explodeDelay: 0,
  },
  {
    id: 'fasteners',
    name: 'Fasteners',
    category: 'airframe',
    system: 'Airframe Hardware',
    type: 'Socket Cap Screws',
    partNumber: 'K1-AFR-X00',
    description:
      'Stainless socket-cap screws and captive fasteners used across hinges, motor mounts, gear mounts and hatches. Shown as a single set; each instance follows its parent assembly.',
    position: [0, 0, 0],
    location: 'Distributed',
    relatedComponents: ['arm-01', 'motor-01', 'gear-left', 'access-panel-a'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Standard', value: 'ISO 4762, A4 stainless' },
      { label: 'Sizes', value: 'M3 / M4' },
      { label: 'Thread lock', value: 'Medium strength' },
      { label: 'Torque (M3)', value: '≈ 1.2 N·m' },
    ],
    layer: 'structure',
    explode: [0, 0, 0],
    explodeDelay: 0,
  },

  // ───────────────────────── PROPULSION
  ...motorComponents,
  ...propComponents,
  ...escComponents,

  // ───────────────────────── POWER
  {
    id: 'battery',
    name: 'Flight Battery',
    category: 'power',
    system: 'Power System',
    type: 'Lithium Polymer Pack',
    partNumber: 'K1-PWR-B01',
    description:
      'Smart flight battery seated in the central bay below the electronics deck. Integrated cell monitoring reports state of charge and cell health to the flight controller.',
    position: [0, -0.032, -0.04],
    location: 'Fuselage · central battery bay',
    relatedComponents: ['battery-bay', 'power-connector', 'power-distribution', 'access-panel-a'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Chemistry', value: 'LiPo / Li-ion (illustrative)' },
      { label: 'Configuration', value: '12S' },
      { label: 'Capacity', value: '≈ 22 Ah' },
      { label: 'Energy', value: '≈ 980 Wh' },
      { label: 'Monitoring', value: 'Per-cell voltage & temp' },
      { label: 'Mass', value: '≈ 5.6 kg' },
    ],
    layer: 'internal',
    explode: [0, -0.42, -0.08],
    explodeDelay: 0.32,
    overlayLabel: true,
    hiddenNote: 'Cycle count on the label reads 0147. Look underneath, on the end cap.',
  },
  {
    id: 'battery-bay',
    name: 'Battery Compartment',
    category: 'power',
    system: 'Power System',
    type: 'Battery Tray & Latch',
    partNumber: 'K1-PWR-T01',
    description: 'Guided tray with a spring latch and foam isolators. Holds the battery against the centre frame and locates the power connector.',
    position: [0, -0.04, -0.04],
    location: 'Fuselage · below centre frame',
    relatedComponents: ['battery', 'center-frame', 'power-connector'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Latch', value: 'Spring, positive lock' },
      { label: 'Isolation', value: 'Closed-cell foam pads' },
      { label: 'Material', value: 'Glass-filled nylon' },
    ],
    layer: 'internal',
    explode: [0, -0.26, -0.02],
    explodeDelay: 0.26,
  },
  {
    id: 'power-distribution',
    name: 'Power Distribution',
    category: 'power',
    system: 'Power System',
    type: 'Power Distribution Board',
    partNumber: 'K1-PWR-D01',
    description: 'Heavy-copper board that splits battery power to the four ESCs and feeds regulated rails to avionics. Includes current sensing.',
    position: [0, 0.008, 0.01],
    location: 'Fuselage · electronics deck',
    relatedComponents: ['battery', 'esc-01', 'esc-02', 'esc-03', 'esc-04', 'flight-controller'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Copper', value: '4 oz, 6 layer' },
      { label: 'Rails', value: '5 V / 12 V regulated' },
      { label: 'Sensing', value: 'Hall-effect current' },
    ],
    layer: 'internal',
    explode: [0, 0.1, 0],
    explodeDelay: 0.48,
  },
  {
    id: 'power-connector',
    name: 'Main Power Connector',
    category: 'power',
    system: 'Power System',
    type: 'Anti-spark Connector',
    partNumber: 'K1-PWR-C01',
    description: 'High-current anti-spark connector between the battery and the distribution board.',
    position: [0, -0.008, -0.17],
    location: 'Fuselage · aft of battery',
    relatedComponents: ['battery', 'power-distribution', 'wiring-harness'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Rating', value: '≈ 90 A continuous' },
      { label: 'Feature', value: 'Pre-charge resistor' },
    ],
    layer: 'internal',
    explode: [0, -0.06, -0.24],
    explodeDelay: 0.36,
  },
  {
    id: 'wiring-harness',
    name: 'Wiring Harness',
    category: 'power',
    system: 'Power & Signal Distribution',
    type: 'Power + Signal Looms',
    partNumber: 'K1-PWR-W01',
    description:
      'Silicone-insulated power leads from the distribution board to each ESC and phase leads into the arms, plus the signal looms linking avionics, GPS and sensors.',
    position: [0, 0.01, 0],
    location: 'Fuselage · distributed',
    relatedComponents: ['power-distribution', 'esc-01', 'flight-controller', 'gps'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Power', value: '10 AWG silicone' },
      { label: 'Signal', value: 'Shielded CAN / UART' },
      { label: 'Routing', value: 'Clipped to centre frame' },
    ],
    layer: 'internal',
    explode: [0, 0.05, 0],
    explodeDelay: 0.55,
  },

  // ───────────────────────── AVIONICS
  {
    id: 'flight-controller',
    name: 'Flight Controller',
    category: 'avionics',
    system: 'Avionics',
    type: 'Autopilot Module',
    partNumber: 'K1-AVN-F01',
    description:
      'Triple-redundant IMU autopilot on vibration dampers at the centre of gravity. Runs attitude control, navigation and failsafe logic.',
    position: [0, 0.036, 0.0],
    location: 'Fuselage · CG, electronics deck',
    relatedComponents: ['companion-computer', 'gps', 'datalink', 'power-distribution', 'esc-01'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'IMU', value: '3× redundant, temperature controlled' },
      { label: 'Barometer', value: '2× redundant' },
      { label: 'Processor', value: 'Dual-core MCU' },
      { label: 'Isolation', value: '4× silicone dampers' },
      { label: 'Interfaces', value: 'CAN ×2, UART ×6' },
    ],
    layer: 'internal',
    explode: [0, 0.26, 0],
    explodeDelay: 0.4,
    overlayLabel: true,
    hiddenNote: 'Firmware build string on the case: K1-FW 4.7.2-illustrative. The arrow on the lid points forward.',
  },
  {
    id: 'companion-computer',
    name: 'Companion Computer',
    category: 'avionics',
    system: 'Avionics',
    type: 'Edge Compute Module',
    partNumber: 'K1-AVN-C01',
    description: 'Onboard computer for vision processing, mission logic and payload control. Actively cooled by a small blower fan.',
    position: [0, 0.03, 0.13],
    location: 'Fuselage · forward deck',
    relatedComponents: ['flight-controller', 'vision-front', 'camera', 'datalink'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Compute', value: 'Embedded GPU module' },
      { label: 'Storage', value: 'NVMe (illustrative)' },
      { label: 'Cooling', value: 'Active blower' },
    ],
    layer: 'internal',
    explode: [0, 0.2, 0.12],
    explodeDelay: 0.44,
  },
  {
    id: 'datalink',
    name: 'Communication Module',
    category: 'avionics',
    system: 'Communications',
    type: 'Datalink Radio',
    partNumber: 'K1-AVN-R01',
    description: 'Dual-band encrypted datalink for command, telemetry and video downlink. Feeds the two aft antennas through low-loss coax.',
    position: [0, 0.03, -0.17],
    location: 'Fuselage · aft deck',
    relatedComponents: ['antenna-01', 'antenna-02', 'flight-controller'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Bands', value: 'Dual-band (illustrative)' },
      { label: 'Link', value: 'AES-encrypted' },
      { label: 'Diversity', value: '2× antenna' },
    ],
    layer: 'internal',
    explode: [0, 0.2, -0.16],
    explodeDelay: 0.44,
  },
  {
    id: 'gps',
    name: 'GNSS Module',
    category: 'avionics',
    system: 'Navigation',
    type: 'Multi-band GNSS Receiver',
    partNumber: 'K1-AVN-G01',
    description: 'Mast-mounted multi-constellation GNSS receiver with integrated compass, raised above the shell to reduce interference.',
    position: [0, 0.19, -0.2],
    location: 'Upper shell · aft mast',
    relatedComponents: ['flight-controller', 'wiring-harness'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Constellations', value: 'GPS / GLONASS / Galileo / BeiDou' },
      { label: 'Correction', value: 'RTK capable (illustrative)' },
      { label: 'Compass', value: 'Integrated magnetometer' },
    ],
    layer: 'structure',
    explode: [0, 0.72, -0.1],
    explodeDelay: 0.1,
    overlayLabel: true,
  },
  {
    id: 'antenna-01',
    name: 'Antenna 01',
    category: 'avionics',
    system: 'Communications',
    type: 'Dipole Antenna',
    partNumber: 'K1-AVN-N01',
    description: 'Port datalink antenna on a swivel base, angled aft and outward for diversity.',
    position: [0.12, 0.13, -0.24],
    location: 'Aft · port',
    relatedComponents: ['datalink', 'antenna-02'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Type', value: 'Sleeve dipole' },
      { label: 'Polarisation', value: 'Vertical' },
    ],
    layer: 'structure',
    explode: [0.16, 0.34, -0.2],
    explodeDelay: 0.12,
  },
  {
    id: 'antenna-02',
    name: 'Antenna 02',
    category: 'avionics',
    system: 'Communications',
    type: 'Dipole Antenna',
    partNumber: 'K1-AVN-N02',
    description: 'Starboard datalink antenna on a swivel base, angled aft and outward for diversity.',
    position: [-0.12, 0.13, -0.24],
    location: 'Aft · starboard',
    relatedComponents: ['datalink', 'antenna-01'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Type', value: 'Sleeve dipole' },
      { label: 'Polarisation', value: 'Vertical' },
    ],
    layer: 'structure',
    explode: [-0.16, 0.34, -0.2],
    explodeDelay: 0.12,
  },

  // ───────────────────────── SENSORS
  {
    id: 'vision-front',
    name: 'Forward Vision Sensors',
    category: 'sensors',
    system: 'Perception',
    type: 'Stereo Camera Pair',
    partNumber: 'K1-SNS-V01',
    description: 'Wide-baseline stereo pair behind the nose window for obstacle detection and visual odometry.',
    position: [0, 0.035, BODY.length / 2 - 0.035],
    location: 'Nose · sensor window',
    relatedComponents: ['companion-computer', 'lidar-down', 'optical-flow'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Baseline', value: '≈ 110 mm' },
      { label: 'Shutter', value: 'Global' },
      { label: 'Range', value: 'Obstacle sensing (illustrative)' },
    ],
    layer: 'structure',
    explode: [0, 0.14, 0.3],
    explodeDelay: 0.14,
    overlayLabel: true,
  },
  {
    id: 'lidar-down',
    name: 'Downward Lidar',
    category: 'sensors',
    system: 'Perception',
    type: 'Laser Altimeter',
    partNumber: 'K1-SNS-L01',
    description: 'Downward laser rangefinder for precision altitude hold and terrain following.',
    position: [0.03, -BODY.bottomHeight - 0.004, 0.11],
    location: 'Belly · forward',
    relatedComponents: ['optical-flow', 'flight-controller'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Type', value: 'Time-of-flight laser' },
      { label: 'Eye safety', value: 'Class 1 (illustrative)' },
    ],
    layer: 'structure',
    explode: [0.06, -0.3, 0.12],
    explodeDelay: 0.18,
  },
  {
    id: 'optical-flow',
    name: 'Optical Flow Camera',
    category: 'sensors',
    system: 'Perception',
    type: 'Downward Flow Sensor',
    partNumber: 'K1-SNS-O01',
    description: 'Downward-facing camera measuring ground motion for GNSS-denied position hold.',
    position: [-0.03, -BODY.bottomHeight - 0.004, 0.11],
    location: 'Belly · forward',
    relatedComponents: ['lidar-down', 'flight-controller'],
    status: 'standby',
    statusNote: 'Illustrative: standby until GNSS quality degrades.',
    illustrativeSpecifications: [
      { label: 'Field of view', value: '≈ 42°' },
      { label: 'Illumination', value: 'IR assist' },
    ],
    layer: 'structure',
    explode: [-0.06, -0.3, 0.12],
    explodeDelay: 0.18,
  },
  {
    id: 'rear-sensor',
    name: 'Rear Proximity Sensor',
    category: 'sensors',
    system: 'Perception',
    type: 'ToF Proximity Sensor',
    partNumber: 'K1-SNS-R01',
    description: 'Aft-facing time-of-flight sensor that guards against reversing into obstacles.',
    position: [0, 0.02, -BODY.length / 2 + 0.01],
    location: 'Tail',
    relatedComponents: ['flight-controller', 'vision-front'],
    status: 'operational',
    illustrativeSpecifications: [{ label: 'Type', value: 'Multizone ToF' }],
    layer: 'structure',
    explode: [0, 0.06, -0.3],
    explodeDelay: 0.16,
  },

  // ───────────────────────── CAMERA
  {
    id: 'gimbal',
    name: 'Gimbal',
    category: 'camera',
    system: 'Imaging',
    type: '3-Axis Stabilised Gimbal',
    partNumber: 'K1-CAM-G01',
    description: 'Three-axis brushless gimbal hung from four vibration-isolation dampers under the nose.',
    position: [0, -0.13, 0.2],
    location: 'Under nose',
    relatedComponents: ['camera', 'lower-chassis', 'companion-computer'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Axes', value: 'Yaw / roll / pitch' },
      { label: 'Stabilisation', value: '≈ ±0.01° (illustrative)' },
      { label: 'Isolation', value: '4× rubber dampers' },
      { label: 'Quick release', value: 'Bayonet mount' },
    ],
    layer: 'structure',
    explode: [0, -0.14, 0.34],
    explodeDelay: 0.22,
    overlayLabel: true,
  },
  {
    id: 'camera',
    name: 'Imaging Payload',
    category: 'camera',
    system: 'Imaging',
    type: 'Stabilised Camera',
    partNumber: 'K1-CAM-C01',
    description: 'Primary imaging camera with a large-aperture lens. Carried in the gimbal pitch frame.',
    position: [0, -0.175, 0.23],
    location: 'Under nose · gimbal pitch frame',
    relatedComponents: ['gimbal', 'companion-computer', 'datalink'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Sensor', value: 'Large-format (illustrative)' },
      { label: 'Lens', value: 'Fixed prime, multicoated' },
      { label: 'Recording', value: 'Onboard + downlink' },
    ],
    layer: 'structure',
    explode: [0, -0.18, 0.56],
    explodeDelay: 0.28,
    hiddenNote: 'The tiny red dot next to the lens is the record lamp — it blinks in Night lighting.',
  },
  {
    id: 'fpv-camera',
    name: 'FPV Camera',
    category: 'camera',
    system: 'Imaging',
    type: 'Pilot View Camera',
    partNumber: 'K1-CAM-F01',
    description: 'Low-latency forward camera for the pilot view, mounted in the chin below the sensor window.',
    position: [0, -0.02, BODY.length / 2 - 0.02],
    location: 'Nose · chin',
    relatedComponents: ['datalink', 'vision-front'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Latency', value: 'Low-latency (illustrative)' },
      { label: 'Field of view', value: '≈ 150°' },
    ],
    layer: 'structure',
    explode: [0, -0.02, 0.36],
    explodeDelay: 0.16,
  },

  // ───────────────────────── PAYLOAD
  {
    id: 'payload-rails',
    name: 'Payload Bay',
    category: 'payload',
    system: 'Payload',
    type: 'Rail Interface',
    partNumber: 'K1-PLD-B01',
    description: 'Twin aluminium rails under the belly provide a standard mounting interface for mission payloads.',
    position: [0, -BODY.bottomHeight - 0.012, -0.03],
    location: 'Belly · centre',
    relatedComponents: ['payload-release', 'payload-pod', 'lower-chassis'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Rails', value: '2× extruded 6061' },
      { label: 'Spacing', value: '≈ 120 mm' },
      { label: 'Power / data', value: 'Blind-mate connector' },
    ],
    layer: 'structure',
    explode: [0, -0.24, -0.02],
    explodeDelay: 0.24,
  },
  {
    id: 'payload-release',
    name: 'Release Mechanism',
    category: 'payload',
    system: 'Payload',
    type: 'Servo Release Hook',
    partNumber: 'K1-PLD-R01',
    description: 'Servo-actuated release hook for dropping or lowering payloads.',
    position: [0, -BODY.bottomHeight - 0.03, -0.03],
    location: 'Belly · between rails',
    relatedComponents: ['payload-rails', 'payload-pod', 'companion-computer'],
    status: 'standby',
    illustrativeSpecifications: [
      { label: 'Actuation', value: 'Digital servo' },
      { label: 'Fail-safe', value: 'Locked on power loss' },
    ],
    layer: 'structure',
    explode: [0, -0.34, -0.02],
    explodeDelay: 0.3,
  },
  {
    id: 'payload-pod',
    name: 'Payload Module',
    category: 'payload',
    system: 'Payload',
    type: 'Mission Pod',
    partNumber: 'K1-PLD-P01',
    description: 'Representative aerodynamic mission pod clipped to the rails. The visualization shows a generic enclosure.',
    position: [0, -BODY.bottomHeight - 0.075, -0.05],
    location: 'Belly · on rails',
    relatedComponents: ['payload-rails', 'payload-release'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Envelope', value: '≈ 300 × 130 × 90 mm' },
      { label: 'Capacity', value: 'Mission dependent' },
    ],
    layer: 'structure',
    explode: [0, -0.5, -0.04],
    explodeDelay: 0.34,
  },

  // ───────────────────────── LANDING GEAR
  {
    id: 'gear-left',
    name: 'Landing Gear · Port',
    category: 'landing-gear',
    system: 'Landing Gear',
    type: 'Curved Skid Assembly',
    partNumber: 'K1-LDG-L01',
    description: 'Port skid with two curved carbon struts and replaceable rubber feet.',
    position: [GEAR.skidX, (GEAR.skidY + GEAR.mountY) / 2, 0],
    location: 'Port side · below fuselage',
    relatedComponents: ['gear-right', 'lower-chassis', 'fasteners'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Struts', value: '2× Ø20 mm carbon' },
      { label: 'Skid', value: 'Ø16 mm aluminium' },
      { label: 'Feet', value: 'Replaceable rubber pads' },
    ],
    layer: 'structure',
    explode: [0.26, -0.24, 0],
    explodeDelay: 0.1,
    overlayLabel: true,
  },
  {
    id: 'gear-right',
    name: 'Landing Gear · Starboard',
    category: 'landing-gear',
    system: 'Landing Gear',
    type: 'Curved Skid Assembly',
    partNumber: 'K1-LDG-R01',
    description: 'Starboard skid with two curved carbon struts and replaceable rubber feet.',
    position: [-GEAR.skidX, (GEAR.skidY + GEAR.mountY) / 2, 0],
    location: 'Starboard side · below fuselage',
    relatedComponents: ['gear-left', 'lower-chassis', 'fasteners'],
    status: 'operational',
    illustrativeSpecifications: [
      { label: 'Struts', value: '2× Ø20 mm carbon' },
      { label: 'Skid', value: 'Ø16 mm aluminium' },
      { label: 'Feet', value: 'Replaceable rubber pads' },
    ],
    layer: 'structure',
    explode: [-0.26, -0.24, 0],
    explodeDelay: 0.1,
  },
];

export const COMPONENT_MAP: Record<string, DroneComponent> = Object.fromEntries(
  COMPONENTS.map((c) => [c.id, c]),
);

export const getComponent = (id: string | null | undefined) => (id ? COMPONENT_MAP[id] : undefined);

export const componentsByCategory = (cat: CategoryId) => COMPONENTS.filter((c) => c.category === cat);

/** Overall illustrative envelope used by overlays (mm). */
export const ENVELOPE = {
  span: Math.round((ARM.tipRadius * 2 * Math.SQRT1_2 + PROP.radius * 2) * 1000),
  wheelbase: Math.round(ARM.tipRadius * 2 * 1000),
  height: Math.round((PROP.y - GEAR.skidY) * 1000),
};
