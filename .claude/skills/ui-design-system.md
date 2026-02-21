---
name: BrightForge UI Design System
description: Design tokens, color palette, typography, spacing, layout, and accessibility rules for the BrightForge web dashboard. Auto-loaded for any CSS/HTML task in public/.
user-invocable: false
---

# BrightForge UI Design System

Comprehensive design system for the BrightForge Creative Studio dark-theme dashboard. Based on [cowork-skills/design-system](https://github.com/GrizzwaldHouse/cowork-skills) principles, adapted for BrightForge's "Nano Banana" aesthetic.

## Design Tokens (CSS Custom Properties)

All tokens are defined in `public/css/dashboard.css` `:root`. **Always use variables, never hardcode colors.**

### Surfaces — Dark Mode

```css
--bg-app: #09090b;          /* Page background — extremely dark */
--bg-sidebar: #0F1116;      /* Sidebar background */
--bg-card: #141820;         /* Card / panel surface */
--bg-card-hover: #1E232E;   /* Hovered card state */
--glass-panel: rgba(20, 24, 32, 0.7);  /* Glassmorphic overlay */
--glass-border: rgba(255, 255, 255, 0.08);  /* Glass edge */
```

### Text

```css
--text-primary: #FAFAFA;    /* Primary text — near white */
--text-secondary: #A1A1AA;  /* Secondary text — zinc-400 */
--text-dim: #52525B;        /* Dimmed labels — zinc-600 */
--text-accent: #60A5FA;     /* Accent text — blue-400 */
```

### Brand / Accents — 60-30-10 Rule

```css
/* 60% dominant: --bg-app and surfaces */
/* 30% secondary: */
--brand-primary: #3B82F6;   /* Blue-500 — primary actions, active tabs */
--brand-hover: #2563EB;     /* Blue-600 — hover state */
--brand-glow: rgba(59, 130, 246, 0.5);  /* Glow effects */

/* 10% accent: */
--accent-purple: #8B5CF6;   /* Purple-500 — premium/creative highlights */
--accent-teal: #14B8A6;     /* Teal-500 — progress bars, success variant */
--accent-amber: #F59E0B;    /* Amber-500 — secondary CTA, warnings */
```

### Semantic Status Colors

```css
--success: #22C55E;   /* Green-500 — approve, online, success */
--warning: #F59E0B;   /* Amber-500 — caution, generating state */
--error: #EF4444;     /* Red-500 — reject, delete, error */
```

### Borders & Shadows

```css
--border: #27272A;           /* Subtle border — zinc-800 */
--border-light: #3F3F46;     /* Prominent border — zinc-700 */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
--shadow-glow: 0 0 15px rgba(59, 130, 246, 0.15);
```

### Border Radius

```css
--radius-sm: 6px;    /* Small badges, indicators */
--radius-md: 8px;    /* Inputs, buttons */
--radius-lg: 12px;   /* Cards, sections */
--radius-xl: 16px;   /* Pills, large panels */
```

### Token Aliases (for backward compatibility)

```css
/* design-viewer.css uses these older names — aliased in dashboard.css */
--bg-primary: var(--bg-app);
--bg-secondary: var(--bg-sidebar);
--bg-tertiary: var(--bg-card-hover);
--bg-hover: var(--bg-card-hover);
--accent-primary: var(--brand-primary);
--accent-secondary: var(--brand-hover);
--accent-light: #3B82F6;
```

### Semantic Color Usage

| Purpose | Token | Example |
|---------|-------|---------|
| Primary action button | `--brand-primary` | Generate, Send |
| Hover state | `--brand-hover` | Button hover |
| Approve / success | `--success` | Approve button, online badge |
| Danger / destructive | `--error` | Reject, delete, error badge |
| Warning / caution | `--warning` | Rollback, generating state |
| Inactive / disabled | `--text-dim` | Disabled buttons, placeholder |
| Active tab indicator | `--brand-primary` | 2px bottom border + glow |

### WCAG Contrast Compliance

| Combination | Ratio | Rating |
|-------------|-------|--------|
| `--text-primary` (#FAFAFA) on `--bg-app` (#09090B) | ~19:1 | AAA ✓ |
| `--text-primary` on `--bg-card` (#141820) | ~16:1 | AAA ✓ |
| `--text-secondary` (#A1A1AA) on `--bg-app` | ~8:1 | AAA ✓ |
| `--brand-primary` (#3B82F6) on `--bg-app` | ~5.5:1 | AA ✓ |
| `--text-dim` (#52525B) on `--bg-sidebar` (#0F1116) | ~3.5:1 | AA Large ✓ |

## Typography

### Font Stack

```css
--font-sans: 'Inter', system-ui, sans-serif;           /* Body text */
--font-heading: 'Outfit', 'Inter', sans-serif;         /* Headings */
--font-mono: 'JetBrains Mono', monospace;              /* Code/paths */
```

Google Fonts loaded in `index.html`: Inter (400,500,600,700), Outfit (400,500,600,700), JetBrains Mono (400,500).

### Type Scale — Major Third (1.25) from 16px base

| Element | Size | Weight | Line Height | Usage |
|---------|------|--------|-------------|-------|
| Display | 2.5rem (40px) | 700 | 1.1 | Hero/splash text |
| H1 / Welcome | 2rem (32px) | 700 | 1.15 | Welcome message |
| H2 / Panel Title | 1.5rem (24px) | 600 | 1.2 | Section titles |
| H3 / Card Title | 1.125rem (18px) | 600 | 1.25 | Card headers |
| Body | 1rem (16px) | 400 | 1.5 | Default text |
| UI Labels | 0.875rem (14px) | 500 | 1.4 | Tabs, buttons, inputs |
| Small / Meta | 0.8125rem (13px) | 400 | 1.5 | Paths, metadata |
| Caption | 0.75rem (12px) | 500-600 | 1.4 | Section headers (uppercase) |

### Rules

- **Max 2 typefaces** in UI: `--font-heading` + `--font-sans`. Use `--font-mono` only for code/paths.
- **Minimum readable**: Never below 0.625rem (10px).
- **Section headings**: `text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem; font-weight: 600; color: var(--text-dim);`
- **Weight contrast**: Minimum 2 weight steps between heading (600-700) and body (400).

### Proven Pairings (from cowork-skills/design-system)

| Heading | Body | Vibe |
|---------|------|------|
| Outfit 600 | Inter 400 | **BrightForge default** — rounded modern + systematic |
| Inter 700 | Inter 400 | Neutral, developer-friendly |
| Poppins 600 | Nunito 400 | Rounded, approachable (alternative) |

## Spacing — 8px Base Grid

```css
--spacing-xs: 0.25rem;   /* 4px — tight inline spacing, icon gaps */
--spacing-sm: 0.5rem;    /* 8px — compact element spacing */
--spacing-md: 1rem;      /* 16px — default padding/gap */
--spacing-lg: 1.5rem;    /* 24px — section inner padding */
--spacing-xl: 2rem;      /* 32px — large section separation */
```

**Rule**: All spacing values must be multiples of 8px. Only exception is 4px for micro-spacing.

## Layout

### Dashboard Structure

```
┌──────────────────────────────────────────────────┐
│ Topbar (64px) — logo left, status right           │
├────────────┬─────────────────────────────────────┤
│ Sidebar    │ Tab Bar (Chat|Design|Forge3D|Health) │
│ (280px)    ├─────────────────────────────────────┤
│            │ Tab Panel (flex: 1, overflow: auto)  │
│ Sessions   │                                      │
│ Providers  │                                      │
│ Budget     │                                      │
└────────────┴─────────────────────────────────────┘
```

### Sidebar Pattern

- Width: 280px fixed
- Items: 4px vertical gap
- Active item: `rgba(59, 130, 246, 0.1)` background + blue left border
- Section headings: uppercase, `--text-dim`, `--spacing-sm` margin-bottom

### Component Patterns

**Card**: `background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--spacing-md);`

**Primary button**: `background: var(--brand-primary); color: #fff; border-radius: var(--radius-md); font-weight: 600;`

**Input field**: `background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); focus: border-color: var(--brand-primary) + box-shadow glow;`

**Focus visible**: `outline: 2px solid var(--brand-primary); outline-offset: 2px;`

### Animations

- **fadeIn**: opacity 0→1, translateY 10px→0, 0.3s ease-out (messages)
- **slideUp**: opacity 0→1, translateY 20px→0, 0.3s ease (panels)
- **Card hover**: `translateY(-2px)` + border-color lighten, 0.2s ease
- **Transitions**: 0.2s ease for all hover/focus states

## CSS File Organization

| File | Purpose |
|------|---------|
| `dashboard.css` | Base tokens, global layout, chat, buttons, utilities |
| `system-health.css` | Health tab — provider cards, latency, activity |
| `file-browser.css` | File browser dropdown component |
| `design-viewer.css` | Design tab — prompt input, image cards, status |
| `forge3d.css` | Forge3D tab — viewport, controls, gallery, queue |

### When Adding New Styles

1. Use existing CSS variables — never hardcode colors or spacing
2. Add component-scoped styles to the relevant tab CSS file
3. Keep global utilities (`.hidden`, scrollbar) in `dashboard.css`
4. Use `var(--radius-md)` for inputs/buttons, `var(--radius-lg)` for cards
5. Match shadow pattern: cards are flat with border; buttons get shadow on hover only
6. All font sizes in `rem`, never `px`

## Accessibility Checklist

- All text meets WCAG AA contrast (4.5:1 body, 3:1 large)
- Color is not the sole indicator of meaning (status badges have text + color)
- Interactive elements have `:hover`, `:focus-visible` states with visible ring
- Font size never below 10px (0.625rem) for readable text
- Keyboard-navigable tabs and buttons via `:focus-visible` ring
- `aria-label` on icon-only buttons and indicators
- Colorblind safety: never rely on color alone — pair with icons, labels, or patterns
