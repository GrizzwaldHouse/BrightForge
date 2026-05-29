# BrightForge Viking Forge Icon — Image Generation Prompts

Reference image: ChatGPT concept (hammer + anvil, dark forge, amber glow)
Color palette: `#0e0a06` bg · `#c47a18` amber · `#e8922a` bright amber · `#1a1208` iron

---

## App Icon (1024×1024 — Rounded Square)

**Primary prompt (Midjourney / DALL-E 3 / Stable Diffusion XL):**

```
A Viking war hammer resting diagonally on a stone iron anvil, dramatic low-angle view,
glowing molten amber forge fire below the anvil, flying forge sparks, Norse rune engravings
carved into the hammer head and anvil face, ancient stone forge interior background,
deep near-black atmosphere with single warm amber light source, photorealistic concept art,
app icon composition centered, no background clutter, dark vignette edges,
4K detail, cinematic lighting, color palette: deep black #0e0a06, amber #c47a18, bright spark #e8922a
--ar 1:1 --v 6 --style raw --q 2
```

**Negative prompt (SD/ComfyUI):**
```
bright background, white, light gray, blue tones, fantasy cartoon, anime, watermark,
text, signature, border frame, low quality, blurry, glowing eyes, dragons
```

---

## App Icon Variants

### Variant A — Monochrome Dark (taskbar, 32×32)
```
Single Viking hammer silhouette on dark background, amber accent glow only on striking face,
minimalist flat icon design, extreme close-up of hammer head, Norse rune channel visible,
icon for dark taskbar, #0e0a06 background, #c47a18 amber, clean sharp edges
--ar 1:1 --v 6 --style raw
```

### Variant B — Circle Badge (macOS style)
```
Viking war hammer and anvil scene inside perfect circle, dark circular badge,
molten amber glow emanating from forge fire, Norse aesthetic, app icon,
circular composition with radial amber rim light, deep black interior
--ar 1:1 --v 6
```

### Variant C — Embossed Metal Coin (light mode)
```
Ancient iron coin embossed with Viking hammer and anvil, Norse knotwork border,
aged patina metal, dark iron texture, silver-gray color scheme, numismatic style,
circular coin shape, isolated on white, studio lighting
--ar 1:1 --v 6 --style raw
```

---

## Background Scene (1920×1080 — Dashboard Background)

**Full forge interior (translucent overlay):**
```
Ancient Viking forge interior, massive stone anvil center, large war hammer resting on anvil
at 25-degree angle, molten amber forge fire glowing below from pit, ember sparks drifting upward,
Norse rune circle carved into stone floor, dark stone walls with iron brackets,
atmospheric depth, very dark overall exposure, amber and near-black color palette only,
cinematic wide shot, 16:9 composition, left third empty dark space, right two-thirds forge scene,
photorealistic environment concept art, game background art quality, ultra detailed
--ar 16:9 --v 6 --style raw --q 2
```

---

## Background Variants

### Variant 1 — Classic Forge
```
Dark Viking forge, stone walls, iron anvil, war hammer, forge fire pit glowing amber,
realistic industrial fantasy, dark atmosphere, amber light source only
--ar 16:9 --v 6
```

### Variant 2 — Ice and Fire (Norse winter)
```
Viking forge in winter, stone walls frosted, forge fire amber against ice-blue cracks in walls,
hammer on frost-edged anvil, contrast of warm amber forge glow and cold blue ambient,
cinematic, dark, Norse aesthetic
--ar 16:9 --v 6
```

### Variant 3 — Nordic Hall
```
Great Norse mead hall converted to forge, wooden beams overhead, amber forge fire,
rune-carved stone anvil, war hammer, atmospheric candlelight and forge glow,
wide establishing shot, dark and dramatic
--ar 16:9 --v 6
```

### Variant 4 — Mystic Forge (fantasy)
```
Magical Viking forge, runes glowing amber on walls and floor, ethereal forge fire,
ancient war hammer with rune inscriptions, stone anvil, mystical particles,
dark fantasy art, deep black and amber palette, D&D concept art quality
--ar 16:9 --v 6
```

---

## Taskbar / Small Icons (16×16, 32×32, 64×64)

For small sizes, use a simplified mark — just the hammer head silhouette:
```
Minimal flat icon, Viking hammer head silhouette, single amber glowing strike face,
pixel-perfect clarity at 64 pixels, dark background, icon design, no gradients,
2-color: #0e0a06 and #c47a18 only
--ar 1:1 --v 6 --style raw
```

---

## Logo Wordmark Composition

```
Wordmark logo: text "BRIGHTFORGE" in bold monospace type with small Viking hammer icon
to the left, dark background, amber color (#c47a18), Norse-industrial aesthetic,
professional software company logo, minimal, no decoration except single hammer mark,
horizontal layout, anti-aliased typography
--ar 3:1 --v 6 --style raw
```

---

## Generation Tips

- **Midjourney**: Add `--style raw` for photorealism over stylization
- **DALL-E 3**: Prepend "Photorealistic concept art: " to the prompt
- **Stable Diffusion XL**: Use `DreamShaper XL` or `RealVisXL` checkpoint; CFG 7, steps 35
- **ComfyUI workflow**: ControlNet depth map from the ChatGPT reference image gives excellent composition control
- **For icon sizes 32×32 and below**: Generate at 1024×1024 first, then downscale with a sharpening pass in Photoshop/Affinity — never generate small directly

## Color Spec (for Photoshop/Affinity refinement)

| Role            | Hex       | OKLCH equivalent           |
|-----------------|-----------|----------------------------|
| Background      | `#0e0a06` | `oklch(9.5% 0.008 52)`     |
| Amber primary   | `#c47a18` | `oklch(58% 0.15 74)`       |
| Amber bright    | `#e8922a` | `oklch(68% 0.18 74)`       |
| Amber dim       | `#7a4a08` | `oklch(38% 0.09 74)`       |
| Iron/steel      | `#1a1208` | `oklch(11% 0.012 52)`      |
| Spark white     | `#f0c060` | `oklch(82% 0.14 80)`       |
