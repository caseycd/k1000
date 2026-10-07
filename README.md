# K1000 Interactive

An explorable digital-twin website for the **Kraus Hamdani Aerospace K1000ULE**, a solar-recharged eVTOL UAV that flies for a very long time. The whole site is the aircraft: rotate it, zoom in on tiny parts, explode it, X-ray it, cut sections through it and inspect any of its 55 components.

Built with React, TypeScript, Vite and Three.js, and deployed on Cloudflare Pages with a small Pages Function (Worker) at `/api/status`.

> **About accuracy.** No official CAD is bundled. The 3D model is built in code. Its proportions were traced from the manufacturer's public product imagery: the solar wing, T-tail, nose tractor prop, and two booms carrying four lift rotors. The absolute scale (a 5 m wingspan is assumed) and the internal layout are illustrative. In the inspector, specs tagged **PUBLISHED** come from the public K1000ULE product page. Every other value is a labelled placeholder. To show the real geometry, drop in a model file (see below).

## Run locally

```bash
npm install
npm run dev          # Vite dev server (mocks /api/status)
npm run build        # typecheck + production build → dist/
npm run pages:dev    # build, then serve dist/ + functions/ in the Cloudflare runtime
```

## Deploy to Cloudflare Pages

Either connect the repository in the Cloudflare dashboard (Pages → Create → Connect to Git) with:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Functions directory | `functions` (auto-detected) |

or deploy from the CLI:

```bash
npx wrangler login
npm run deploy       # wrangler pages deploy dist --project-name k1000-interactive
```

`wrangler.toml` sets `pages_build_output_dir`. `public/_headers` gives hashed assets a year-long immutable cache and adds security headers.

## Using the real K1000ULE model

Put a glTF binary at **`public/models/k1000ule.glb`**. If it's there, it replaces the generated model automatically. If it's missing, the generated model is used.

- **Coordinate frame:** +Y up, nose toward +Z, units in metres. Files in other units are rescaled to a 5 m span and re-centred.
- **Interactive parts:** name each mesh (or its parent node) after a component id from `src/data/components.ts`, e.g. `wing-port`, `lift-motor-03`, `battery`. Alternatively, set `extras.componentId` on the mesh. Matching parts can then be selected, exploded, hidden and inspected on their own. Meshes that don't match a component are grouped under `fuselage`.
- **CAD files:** convert STEP/IGES to glTF first, e.g. with Blender, CAD Exchanger or FreeCAD.

## Features

- **Camera:** smooth damped orbit, pan and zoom. Zoom follows the cursor and goes from the whole aircraft down to millimetre-scale parts. Presets: Reset, Front, Side, Top and Bottom. Inertia and auto-rotate are included. Touch: one finger rotates, two fingers pan, pinch zooms.
- **Inspect:**
  - Hovering shows a tooltip.
  - Clicking dims the rest of the aircraft, outlines the selected part and draws a callout line to the panel.
  - The panel has Overview, Technical, Location (planform locator) and Related tabs.
  - Inspection mode adds corner brackets with coordinates and flies the camera to the selected part.
  - Selecting an internal part ghosts the skin automatically so you can see it.
- **Views:**
  - **Exploded:** animated, staggered separation of the assemblies, controlled with an ASSEMBLY slider. Guide lines connect each part to where it belongs.
  - **Internal:** the skin is ghosted so the inside shows.
  - **X-ray:** fresnel-style see-through rendering.
  - **Cross-section:** cut from the top, side or front with a slider, showing hatched cut faces.
- **Tools:**
  - Measurements between any two points. Multiple measurements are allowed, and each line stays attached to its parts in exploded view.
  - Technical overlay: centrelines, rotor discs, envelope dimensions, axes, labels and the published facts.
  - Lighting presets: Studio, Technical, Night and Inspection.
  - Free cam (WASD + Q/E), presentation mode and a component tree with per-part and per-category visibility.
- **Shareable URL state:**
  - `?mode=inspection&component=lift-motor-04`
  - `?view=exploded` · `?view=internal` · `?view=xray` · `?section=side&cut=0.2`
  - `?light=night&overlay=1&cam=…`
  - Use **Copy link** in settings.
- **Easter eggs:**
  - Click the logo five times to turn on Engineer mode (diagnostics, rotor spin test, wireframe, hidden field notes).
  - Click a part number three times to reveal a note.
  - Look for the tiny serial plate under the starboard boom.
  - Type `k1000` for a cinematic flyaround.
- **Sound:** optional synthesized interface sounds, off by default.

### Keyboard

`1–5` views · `E` explode · `I` inspect · `M` measure · `T` internal · `X` x-ray · `S` section · `O` overlay · `L` lighting · `R` auto-rotate · `C` free cam · `P` presentation · `F` focus · `H` hide part · `B` components · `Esc` back

## Performance

- **Lazy loading:** the app shell paints immediately. Three.js and the engine load as a separate code-split chunk.
- **Geometry:** all generated in code, with no image or model assets. Each component's geometry is merged per material, fasteners are instanced, and raycasting is BVH-accelerated (`three-mesh-bvh`).
- **Rendering:** frames render only when something changes. Pixel ratio adapts to frame time, and mobile is capped at 1.5×.

## Project structure

```
src/
  components/   DroneViewer, ComponentInspector, ComponentTree, Controls, ExplodedView,
                SectionControl, MeasurementTool, TechnicalOverlay, StatusPanel, IntroOverlay, …
  data/         components.ts (component database), layout.ts (traced proportions)
  engine/       DroneEngine (renderer, camera, interaction, animation), DroneModel (generated model),
                GltfModel (real-model loader), Hud (SVG overlay), materials, lighting, geometry, textures
  shaders/      material patch (highlight / x-ray / ghost / section caps), floor grid
  hooks/        idle fade, keyboard, URL sync
  utils/        actions, URL state, sound
functions/api/  status.ts — Cloudflare Pages Function
```

K1000ULE is a product of Kraus Hamdani Aerospace. This project is an independent interactive visualization.
