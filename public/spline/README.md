# brightforge-forge.splinecode — Scene Spec
Developer: Marcus Daley
Date: 2026-04-29
Purpose: Spline scene designer reference for the Viking forge background scene.
Defines all variables, object names, and animation states the BrightForge dashboard reads.

## Concept

A translucent Viking forge interior — massive stone anvil, war hammer resting diagonally,
molten amber glow from forge fire below. The scene sits BEHIND the Terminal Forge UI panels
at 15–25% opacity. It should feel like the tool itself was forged here.

Scene mood: "The forge never sleeps. Neither does the dev."

## Canvas & Background

- Canvas size: 1920×1080 minimum (fluid)
- Background fill: TRANSPARENT (alpha 0) — the dark UI background shows through
- Ambient light: warm amber `#6a3c08`, intensity 0.4
- Rim light (cold): `#1a2a3a`, intensity 0.15, position top-right
- Fog: none — keep it crisp

## Required Objects (exact names, case-sensitive)

| Object Name         | Type   | Description |
|---------------------|--------|-------------|
| `Anvil`             | Mesh   | Stone/iron anvil, center-bottom of scene |
| `Hammer`            | Mesh   | War hammer, resting on anvil at 25° angle |
| `ForgeEmber`        | Light  | Point light below anvil, amber glow |
| `RuneCircle`        | Mesh   | Large circular Norse knotwork disc, behind anvil, very faint |
| `SparkParticles`    | Particles | Ember/spark system rising from anvil strike point |
| `ForgeGlow`         | Mesh   | Plane with emission material, below/behind scene, large |
| `HammerRunes_1`     | Mesh   | Rune engravings on hammer head face |
| `HammerRunes_2`     | Mesh   | Secondary rune channel cut on hammer side |

## Required Variables (Spline Variables panel)

Create these exactly — BrightForge reads them by name at runtime.

| Variable Name        | Type    | Default | Range        | Purpose |
|----------------------|---------|---------|--------------|---------|
| `scene_opacity`      | Number  | 0.18    | 0.0 – 1.0    | Overall scene transparency (CSS opacity on canvas) |
| `ember_intensity`    | Number  | 0.4     | 0.0 – 1.0    | ForgeEmber point light intensity |
| `spark_rate`         | Number  | 12      | 0 – 60       | SparkParticles emit rate per second |
| `hammer_angle`       | Number  | 25      | 0 – 45       | Hammer rest angle in degrees |
| `rune_opacity`       | Number  | 0.12    | 0.0 – 0.4    | RuneCircle material opacity |
| `forge_active`       | Boolean | false   | true/false   | When true: increase ember + sparks (job running) |
| `alert_mode`         | Boolean | false   | true/false   | When true: red forge glow (error state) |

## State → Visual Mapping

| State              | forge_active | ember_intensity | spark_rate | ForgeEmber color |
|--------------------|-------------|-----------------|------------|------------------|
| Idle               | false        | 0.25            | 4          | `#6a3c08` amber  |
| Job running        | true         | 0.7             | 28         | `#c47a18` bright amber |
| Job complete       | false        | 0.4             | 8          | `#6a3c08` amber  |
| Error / alert      | true (alert) | 0.8             | 50         | `#8a1a08` red    |

## Animation Specs

### Idle ambient loop
- Hammer: subtle 0.3° sway, 8-second sinusoidal loop, Y-axis
- ForgeEmber: flicker — intensity oscillates ±0.08 over 1.2s random cycle
- SparkParticles: 4 emits/sec, rise 80px, fade out over 1.8s
- RuneCircle: 0.004 RPM rotation (barely perceptible)

### Forge active (job running)
- SparkParticles: burst to 28/sec, rise 160px, bright amber `#f0a840`
- ForgeEmber: intensity 0.7, warm flicker ±0.15 over 0.6s
- Hammer: slight vibration — 0.5px shake on X, 0.3s loop

### Alert mode (error)
- ForgeEmber: switch to red `#8a1a08`, intensity 0.8, rapid flicker 0.15s
- SparkParticles: 50/sec, rise 200px, red-orange `#c04010`
- RuneCircle: opacity increases to 0.3, rotation speeds to 0.01 RPM

## Materials

### Anvil
- Base: PBR metallic, roughness 0.85, metalness 0.6
- Color: `#1a1208` (very dark iron-tinted black)
- Normal map: chipped stone/iron texture
- Emissive: none on body; strike face has faint amber emissive `#3a1a06` at 0.1

### Hammer head
- Base: PBR metallic, roughness 0.5, metalness 0.9
- Color: `#2a1a08`
- Striking face: emissive `#c47a18` at 0.6 (glowing from recent strike)
- Rune inlays: emissive `#8a5a18` at 0.4

### Hammer handle
- PBR wood, roughness 0.9, metalness 0
- Color: `#1e1208`, wrapped bands `#0e0a04`

### RuneCircle
- Unlit material, color `#4a3018`
- Opacity: driven by `rune_opacity` variable
- Texture: circular Norse knotwork SVG baked to texture

## Camera

- Position: slightly elevated, looking down at 12° angle
- FOV: 55°
- No camera animation — static composition
- Scene fills right ~60% of canvas; left 40% is empty space (rail sits there)

## File Output

Export as: `brightforge-forge.splinecode`
Place at: `D:\BrightForge\public\spline\brightforge-forge.splinecode`

The BrightForge server will serve it at `/spline/brightforge-forge.splinecode`.

## Integration Notes

The scene is embedded as a full-viewport canvas behind the Terminal Forge dashboard panels.
CSS: `position: absolute; inset: 0; opacity: var(--forge-bg-opacity, 0.18); pointer-events: none; z-index: 0;`

BrightForge calls `spline.setVariable('forge_active', true)` when a generation job starts
and `spline.setVariable('alert_mode', true)` on errors. See `public/js/forge-bg.js`.
