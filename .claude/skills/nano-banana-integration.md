---
name: nano-banana-integration
description: Gemini "Nano Banana" image generation workflow for BrightForge — prompt patterns, API format, and UI asset generation guidance.
user-invocable: true
---

# Nano Banana — Gemini Image Generation

Use this skill when generating images via Gemini's image generation API (internally called "Nano Banana"). This integrates with BrightForge's `ImageClient` provider chain.

## How It Works

BrightForge's `src/core/image-client.js` supports Gemini image generation as a provider in the chain. Gemini uses the `generateContent` endpoint with `responseModalities: ["TEXT", "IMAGE"]` to produce inline PNG images.

### Provider Chain Position

Priority: Pollinations(1) → Together(2) → **Nano Banana/Gemini(3)** → Stability(4)

Gemini is the third option in the free-tier chain. Requires `GEMINI_API_KEY` in `.env.local`.

## Prompt Patterns for UI Assets

### Icons & Logos

```
A minimal flat icon of [subject], [color] on transparent background,
clean vector style, 256x256, no text, sharp edges, suitable for web UI
```

### Hero / Background Images

```
Abstract [mood] background for a developer tool dashboard,
dark theme, [color palette] gradient, digital/tech aesthetic,
subtle geometric patterns, 1920x1080, no text
```

### Card Illustrations

```
Minimal illustration of [concept], isometric view,
dark background (#141820), accent colors [blue #3B82F6, teal #14B8A6],
clean modern style, suitable for dashboard card, 400x300
```

## CLI Usage

```bash
# Generate a single image via the design engine
node bin/brightforge.js --design "hero background for AI dashboard" --style default

# Direct image client test
node src/core/image-client.js --test
```

## Web Dashboard Usage

1. Open the **Design** tab
2. Enter your image prompt in the Design Brief textarea
3. Select a style (default, blue-glass, dark-industrial)
4. Click **Generate Design**
5. Preview images → **Export** to save

## API Format

Gemini image generation uses this request shape:

```json
{
  "contents": [{
    "parts": [{ "text": "Generate an image: <prompt>" }]
  }],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

Response contains `inlineData` parts with `mimeType` and base64 `data`.

## Configuration

| Parameter | Default | Location |
|-----------|---------|----------|
| Model | `gemini-2.0-flash-exp` | `config/image-providers.yaml` |
| API Key | `GEMINI_API_KEY` | `.env.local` |
| Priority | 3 | `config/image-providers.yaml` |
| Max Dimensions | 2048px | `config/image-providers.yaml` |
| Output Directory | `output/images/` | `config/image-providers.yaml` |

## Quality Tips

- **Be specific**: "minimalist flat icon of a lightning bolt in electric blue" beats "an icon"
- **Specify dimensions**: Always include target size in the prompt
- **Dark mode assets**: Include background color hex in prompt for consistency
- **No text in images**: Gemini-generated text is unreliable; add text via HTML/CSS instead
- **Iterate**: Generate 2-3 variants and pick the best; BrightForge logs all generations

## Notes

- "Nano Banana" is the informal name for Gemini's image generation capability
- Free tier has rate limits (~60 requests/minute)
- Generated images are saved to `output/images/` with provider prefix
- All generation metadata is tracked by the TelemetryBus
