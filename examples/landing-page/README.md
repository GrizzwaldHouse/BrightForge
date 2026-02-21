# Landing Page Example

**Difficulty:** Intermediate
**Time:** 10 minutes
**Features:** Design Engine, Image Generation, HTML Export

---

## Overview

Generate an AI-powered landing page with images and semantic HTML using BrightForge's Design Engine.

**What you'll learn:**
- Design Engine workflow
- Style selection (blue-glass, dark-industrial, default)
- Image generation via free providers
- HTML + CSS export

---

## Prerequisites

- Node.js 18+
- BrightForge installed
- At least one image provider configured (Pollinations, Gemini, Together AI)
  - Pollinations works without API key (completely free)
  - Gemini requires API key in `.env.local`

---

## Instructions

### Step 1: Start Web Server

```bash
# From BrightForge root directory
npm run server

# Open browser at http://localhost:3847
```

### Step 2: Navigate to Design Tab

Click **Design** tab in the dashboard.

### Step 3: Enter Design Prompt

Paste this prompt:

```
Modern landing page for "CloudFlow" - a SaaS productivity tool for remote teams. Include hero section with call-to-action, features section with icons, pricing table, and testimonials. Professional and trustworthy design.
```

### Step 4: Select Style

Choose one of:
- **default** - Clean and minimalist
- **blue-glass** - Glassmorphism with blue gradients
- **dark-industrial** - Dark theme with tech aesthetics

Recommended: **blue-glass**

### Step 5: Generate Design

Click **Generate Design** button.

BrightForge will:
1. Generate hero image (via Pollinations/Gemini/Together)
2. Create semantic HTML structure
3. Apply inline CSS styles
4. Show preview

Wait ~15-30 seconds for completion.

### Step 6: Preview Result

Click **Preview** button to open in new tab.

You should see:
- Hero section with generated image
- Features grid with icons
- Pricing table (3 tiers)
- Testimonials carousel
- Footer with links

### Step 7: Export HTML

Click **Export HTML** button to download standalone file.

The exported file includes:
- Inline CSS (no external dependencies)
- Base64-encoded images
- Responsive design
- Mobile-friendly layout

---

## Expected Output

### Generated HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudFlow - SaaS Productivity for Remote Teams</title>
  <style>
    /* Inline CSS generated based on selected style */
  </style>
</head>
<body>
  <!-- Hero Section -->
  <section class="hero">
    <img src="data:image/png;base64,..." alt="Hero Image">
    <h1>CloudFlow</h1>
    <p>Boost your team's productivity with AI-powered workflows</p>
    <button>Get Started Free</button>
  </section>

  <!-- Features Section -->
  <section class="features">
    <div class="feature">
      <h3>Real-Time Collaboration</h3>
      <p>Work together seamlessly from anywhere</p>
    </div>
    <!-- More features... -->
  </section>

  <!-- Pricing Section -->
  <section class="pricing">
    <!-- Pricing tiers... -->
  </section>

  <!-- Testimonials Section -->
  <section class="testimonials">
    <!-- Customer quotes... -->
  </section>

  <!-- Footer -->
  <footer>
    <!-- Links and copyright... -->
  </footer>
</body>
</html>
```

---

## CLI Alternative

You can also generate designs via CLI:

```bash
cd examples/landing-page

node ../../bin/brightforge.js --design "Modern landing page for CloudFlow SaaS tool" --style blue-glass
```

Output will be saved to:
```
output/designs/design_YYYYMMDD_HHMMSS.html
output/designs/hero_YYYYMMDD_HHMMSS.png
```

---

## Customization

### Modify Existing Design

```bash
# In Design tab, click "Edit Prompt" and refine:
node ../../bin/brightforge.js --design "Make the CloudFlow landing page darker with purple accent color" --style dark-industrial
```

### Add More Sections

```bash
node ../../bin/brightforge.js --design "Add a FAQ section and newsletter signup form to the landing page"
```

### Change Color Scheme

```bash
node ../../bin/brightforge.js --design "Change the color scheme to green and white for an eco-friendly SaaS product"
```

---

## Advanced Variations

```bash
# E-commerce landing page
node ../../bin/brightforge.js --design "Landing page for 'EcoWear' sustainable fashion brand with product showcase and shopping cart" --style default

# Portfolio landing page
node ../../bin/brightforge.js --design "Personal portfolio landing page for a UX designer with case studies and contact form" --style blue-glass

# Event landing page
node ../../bin/brightforge.js --design "Landing page for 'DevCon 2026' tech conference with speaker lineup, schedule, and ticket sales" --style dark-industrial

# App landing page
node ../../bin/brightforge.js --design "Mobile app landing page for 'FitTrack' fitness tracking app with download buttons and screenshots" --style default
```

---

## Troubleshooting

### "Image generation failed"

**Cause:** No image provider available or rate limited.

**Fix:**

```bash
# Option 1: Use Pollinations (no API key needed)
# Already enabled by default in config/image-providers.yaml

# Option 2: Add Gemini API key
# Edit .env.local:
GEMINI_API_KEY=your_key_here

# Restart server
npm run server
```

### "Design looks broken on mobile"

**Cause:** Responsive CSS not generated.

**Fix:**

```bash
# Request mobile-responsive design explicitly
node ../../bin/brightforge.js --design "Mobile-responsive landing page for CloudFlow with hamburger menu and touch-friendly buttons"
```

### "Images not loading"

**Cause:** Base64 encoding failed or image too large.

**Fix:**

- Images are embedded as base64 in exported HTML
- If file size is too large (>5MB), reduce image complexity in prompt
- Alternative: Host images externally and update `<img src="...">` URLs

---

## Style Comparison

### default

- Clean, minimalist design
- Light background (#ffffff)
- Black text (#1a202c)
- Simple sans-serif font
- Subtle shadows

### blue-glass

- Glassmorphism effects
- Blue gradient background
- Semi-transparent cards
- Backdrop blur
- Modern and sleek

### dark-industrial

- Dark background (#0a0e27)
- Tech-inspired aesthetics
- Cyan accents (#00d9ff)
- Monospace fonts
- Cyberpunk vibes

---

## Next Steps

1. Try the [3D Asset Batch](../3d-asset-batch/) example (Forge3D)
2. Customize styles in `config/styles/`
3. Create your own design templates

---

## License

MIT License - see [LICENSE](../../LICENSE) for details.
