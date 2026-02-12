# Dark Industrial - Bold & Technical

## Color Palette
- **Primary:** #10b981 (Emerald 500)
- **Secondary:** #6366f1 (Indigo 500)
- **Accent:** #f59e0b (Amber 500)
- **Background:** #0a0a0a (Almost Black)
- **Surface:** #1a1a1a (Dark Gray)
- **Surface Elevated:** #262626 (Lighter Gray)
- **Text Primary:** #ffffff (White)
- **Text Secondary:** #a3a3a3 (Neutral 400)
- **Border:** #404040 (Neutral 700)
- **Error:** #ef4444 (Red 500)
- **Success:** #10b981 (Emerald 500)

## Typography
### Headings
- **Font Family:** 'JetBrains Mono', 'Fira Code', monospace
- **H1:** 48px / 700 weight / letter-spacing -1px / uppercase
- **H2:** 36px / 700 weight / letter-spacing -0.5px / uppercase
- **H3:** 28px / 600 weight / letter-spacing 0px
- **H4:** 22px / 600 weight / letter-spacing 0px

### Body
- **Font Family:** 'Inter', -apple-system, sans-serif
- **Body:** 15px / 400 weight / line-height 1.7
- **Code:** 'JetBrains Mono', monospace / 14px
- **Small:** 13px / 400 weight / line-height 1.6

## Layout Principles
- **Grid:** Technical grid with visible grid lines (optional)
- **Spacing:** 8px baseline (multiples: 8, 16, 24, 32, 40, 48, 64, 80)
- **Container Max Width:** 1600px
- **Breakpoints:**
  - Mobile: 0-640px
  - Tablet: 641-1024px
  - Desktop: 1025px+

## Component Patterns

### Buttons
- **Primary:**
  - Background: Primary color
  - Text: Background color
  - Padding: 12px 24px
  - Border: 2px solid Primary color
  - Border Radius: 0px (sharp corners)
  - Font: 600 weight / 14px / uppercase / letter-spacing 1px
  - Hover: Background transparent + Text Primary

- **Secondary:**
  - Background: Transparent
  - Border: 2px solid Border color
  - Text: Text Primary
  - Padding: 12px 24px
  - Border Radius: 0px
  - Hover: Border Primary color + Text Primary

### Cards
- **Background:** Surface color
- **Border:** 2px solid Border color
- **Border Radius:** 0px (sharp corners)
- **Padding:** 24px
- **Box Shadow:** None (flat design)
- **Accent Line:** 4px solid Primary on left edge

### Panels/Sections
- **Background:** Surface Elevated
- **Border:** 1px solid Border color
- **Title Bar:** Background Surface + Border Bottom 2px Primary
- **Header Padding:** 16px 24px

### Inputs
- **Background:** Surface color
- **Border:** 2px solid Border color
- **Border Radius:** 0px
- **Padding:** 10px 12px
- **Font:** Monospace for code inputs, sans-serif otherwise
- **Focus:** Border Primary color + no shadow

### Code Blocks
- **Background:** #000000
- **Border:** 1px solid Border color
- **Border Radius:** 0px
- **Padding:** 16px
- **Font:** 'JetBrains Mono' / 13px
- **Line Numbers:** Text Secondary
- **Syntax Colors:** Monokai theme

### Navigation
- **Background:** Surface color
- **Border Bottom:** 2px solid Border color
- **Height:** 56px
- **Link Padding:** 0 20px
- **Link Border Bottom:** 3px solid transparent
- **Active:** Border bottom Primary color

### Data Tables
- **Background:** Surface color
- **Border:** 2px solid Border color
- **Header Background:** Background color
- **Header Text:** Primary color / uppercase / 600 weight
- **Row Border:** 1px solid Border color
- **Hover Row:** Background Surface Elevated

## Technical Flourishes
### Grid Overlay (Optional)
- **Grid Lines:** 1px rgba(255, 255, 255, 0.05)
- **Grid Size:** 8px × 8px
- **Usage:** Subtle background pattern

### Status Indicators
- **Active:** Emerald 500 glow
- **Error:** Red 500 with pulse animation
- **Processing:** Indigo 500 with spin animation
- **Dot Size:** 8px circle

### Terminal/CLI Aesthetic
- **Prompt Symbol:** `>` or `$` prefix on headings
- **Cursor:** Blinking underscore animation
- **Line Numbers:** Monospace, Text Secondary

## Design Principles
1. **Precision:** Sharp edges, aligned grid, technical accuracy
2. **Contrast:** High contrast for readability
3. **Minimalism:** Flat design, no gradients or shadows
4. **Functionality:** Form follows function, data-first
5. **Monospace:** Use monospace fonts for technical content
6. **Status:** Clear visual indicators for system state
