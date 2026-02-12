# Blue Glass - 3D Glass Morphism Style

## Color Palette
- **Primary:** #3b82f6 (Blue 500)
- **Secondary:** #8b5cf6 (Violet 500)
- **Accent:** #06b6d4 (Cyan 500)
- **Background:** linear-gradient(135deg, #667eea 0%, #764ba2 100%)
- **Glass Surface:** rgba(255, 255, 255, 0.1)
- **Glass Border:** rgba(255, 255, 255, 0.2)
- **Text Primary:** #ffffff
- **Text Secondary:** rgba(255, 255, 255, 0.8)
- **Shadow:** rgba(0, 0, 0, 0.3)

## Typography
### Headings
- **Font Family:** 'Inter', -apple-system, sans-serif
- **H1:** 42px / 700 weight / letter-spacing -1px
- **H2:** 32px / 700 weight / letter-spacing -0.5px
- **H3:** 24px / 600 weight / letter-spacing -0.3px
- **H4:** 20px / 600 weight / letter-spacing 0px
- **Text Shadow:** 0 2px 8px rgba(0,0,0,0.3)

### Body
- **Font Family:** 'Inter', -apple-system, sans-serif
- **Body:** 16px / 400 weight / line-height 1.7
- **Small:** 14px / 400 weight / line-height 1.6

## Layout Principles
- **Grid:** Asymmetric, overlapping elements for depth
- **Spacing:** 12px baseline (multiples: 12, 24, 36, 48, 60, 72, 96)
- **Container Max Width:** 1400px
- **Depth Layers:** Background → Midground cards → Foreground elements

## Component Patterns

### Glass Cards
- **Background:** rgba(255, 255, 255, 0.1)
- **Backdrop Filter:** blur(10px) saturate(180%)
- **Border:** 1px solid rgba(255, 255, 255, 0.2)
- **Border Radius:** 20px
- **Padding:** 32px
- **Box Shadow:**
  - 0 8px 32px rgba(0, 0, 0, 0.3)
  - inset 0 1px rgba(255, 255, 255, 0.3)

### Buttons
- **Primary:**
  - Background: linear-gradient(135deg, #3b82f6, #8b5cf6)
  - Text: White
  - Padding: 14px 28px
  - Border Radius: 12px
  - Box Shadow: 0 4px 16px rgba(59, 130, 246, 0.4)
  - Hover: Transform translateY(-2px) + shadow 0 6px 20px

- **Glass:**
  - Background: rgba(255, 255, 255, 0.15)
  - Backdrop Filter: blur(10px)
  - Border: 1px solid rgba(255, 255, 255, 0.3)
  - Padding: 14px 28px
  - Border Radius: 12px
  - Hover: Background rgba(255, 255, 255, 0.25)

### Inputs
- **Background:** rgba(255, 255, 255, 0.1)
- **Backdrop Filter:** blur(10px)
- **Border:** 1px solid rgba(255, 255, 255, 0.2)
- **Border Radius:** 12px
- **Padding:** 12px 16px
- **Placeholder:** rgba(255, 255, 255, 0.5)
- **Focus:** Border rgba(255, 255, 255, 0.4) + shadow 0 0 20px rgba(59, 130, 246, 0.5)

### Navigation
- **Background:** rgba(255, 255, 255, 0.08)
- **Backdrop Filter:** blur(20px)
- **Border Bottom:** 1px solid rgba(255, 255, 255, 0.1)
- **Height:** 72px
- **Link Padding:** 16px 20px
- **Active:** Background rgba(255, 255, 255, 0.15)

## 3D Effects
### Depth & Shadows
- **Card Lift:** transform: translateY(-4px) on hover
- **Layered Shadows:**
  - Near: 0 4px 16px rgba(0, 0, 0, 0.2)
  - Mid: 0 8px 32px rgba(0, 0, 0, 0.3)
  - Far: 0 16px 64px rgba(0, 0, 0, 0.4)

### Glassmorphism
- **Always use:** backdrop-filter: blur(10px)
- **Overlay:** rgba(255, 255, 255, 0.1) to 0.2 depending on depth
- **Reflections:** Subtle top border with lighter rgba for glass reflection

## Design Principles
1. **Depth:** Layered glass cards with parallax effects
2. **Luminosity:** Glowing accents and subtle light sources
3. **Blur:** Consistent backdrop blur for glass effect
4. **Gradients:** Smooth color transitions, avoid harsh edges
5. **Motion:** Smooth transitions (0.3s ease) on all interactions
