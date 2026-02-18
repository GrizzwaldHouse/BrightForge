---
name: BrightForge UI Design System
description: Design tokens, color palette, typography, spacing, and component patterns for the BrightForge web dashboard. Reference this when modifying any CSS or HTML in public/.
---

# BrightForge UI Design System

Based on [cowork-skills/design-system](https://github.com/GrizzwaldHouse/cowork-skills) Professional/Corporate palette, adapted for the BrightForge dark-theme dashboard.

## Design Tokens (CSS Custom Properties)

All tokens are defined in `public/css/dashboard.css` `:root`. Always use variables, never hardcode colors.

### Color Palette — Professional/Corporate

```css
/* Surfaces (dark mode — Slate scale) */
--bg-primary: #0F172A;       /* slate-900 — page background */
--bg-secondary: #1E293B;     /* slate-800 — sidebar, topbar, panels */
--bg-tertiary: #334155;      /* slate-700 — elevated/active states */
--bg-card: #1E293B;          /* slate-800 — card backgrounds */
--bg-hover: #334155;         /* slate-700 — hover states */

/* Text */
--text-primary: #F1F5F9;     /* slate-100 */
--text-secondary: #94A3B8;   /* slate-400 */
--text-dim: #64748B;         /* slate-500 */

/* Brand */
--accent-primary: #2563EB;   /* blue-600 — primary action, links, active tabs */
--accent-secondary: #1E40AF; /* blue-800 — user message bg */
--accent-light: #3B82F6;     /* blue-500 — hover highlights */
--accent-amber: #F59E0B;     /* amber-500 — secondary accent, CTA */

/* Semantic */
--success: #16A34A;           /* green-600 */
--warning: #D97706;           /* amber-600 */
--error: #DC2626;             /* red-600 */

/* Borders & Shadows */
--border: #334155;            /* slate-700 */
--border-light: #475569;     /* slate-600 — prominent borders */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
--shadow-md: 0 4px 6px rgba(0,0,0,0.3);
--shadow-lg: 0 10px 25px rgba(0,0,0,0.4);

/* Radius */
--radius-sm: 4px;   /* indicators, small badges */
--radius-md: 6px;   /* inputs, buttons */
--radius-lg: 8px;   /* cards, sections */
--radius-xl: 12px;  /* pills, error indicator */
```

### Semantic Color Usage

| Purpose | Token | Example |
|---------|-------|---------|
| Primary action button | `--accent-primary` | Generate, Send |
| Secondary action | `--accent-amber` | Secondary CTA |
| Approve / success | `--success` | Approve button, online badge |
| Danger / destructive | `--error` | Reject, delete, error badge |
| Warning / caution | `--warning` | Rollback, generating state |
| Inactive / disabled | `--text-dim` | Disabled buttons, placeholder |
| Section headings | `--accent-primary` | Forge3D section h3, plan title |
| Active tab indicator | `--accent-primary` | 2px bottom border |
| Hover highlight | `--accent-light` | Bold text, link hover |

### Hover State Darken Pattern

Button hover shades (no variable — use directly):
- Blue hover: `--accent-light` (#3B82F6)
- Green hover: `#15803D` (green-700)
- Red hover: `#B91C1C` (red-700)
- Amber hover: `#B45309` (amber-700)
- Secondary hover: `#EAB308` (yellow-500)

### Contrast Compliance (WCAG)

- `--text-primary` (#F1F5F9) on `--bg-primary` (#0F172A): ~15:1 (AAA pass)
- `--text-primary` on `--bg-card` (#1E293B): ~12:1 (AAA pass)
- `--accent-primary` (#2563EB) on `--bg-primary`: ~4.6:1 (AA pass)
- `--accent-light` (#3B82F6) on `--bg-primary`: ~5.2:1 (AA pass)
- `--success` (#16A34A) on `--bg-primary`: ~4.8:1 (AA pass)
- `--error` (#DC2626) on `--bg-primary`: ~4.6:1 (AA pass)

## Typography

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
```

Google Fonts loaded in `index.html`:
- Inter: 400, 500, 600, 700
- JetBrains Mono: 400, 500

### Scale (Major Third 1.25 from 16px base)

| Element | Size | Weight | Usage |
|---------|------|--------|-------|
| Welcome heading | 1.5rem (24px) | 700 | Welcome message h2 |
| Logo | 1.375rem (22px) | 700 | Topbar brand |
| Plan title | 1.125rem (18px) | 600 | Plan viewer heading |
| Body | 0.9375rem (15px) | 400 | Chat input |
| UI labels | 0.875rem (14px) | 500 | Tabs, buttons, inputs |
| Small | 0.8125rem (13px) | 400 | Mono paths, plan meta |
| Caption | 0.75rem (12px) | 400-600 | Section headers, meta |
| Micro | 0.625rem (10px) | — | Status dots |

### Rules

- **Max 2 typefaces**: `--font-sans` (everything) + `--font-mono` (code/paths only)
- **Minimum**: Never below 0.625rem (10px) for any visible text
- **Section headings**: uppercase + `letter-spacing: 0.5-1px`

## Spacing (8px Base Grid)

```css
--spacing-xs: 0.25rem;  /* 4px — tight inline, icon gaps */
--spacing-sm: 0.5rem;   /* 8px — compact spacing */
--spacing-md: 1rem;     /* 16px — default padding/gap */
--spacing-lg: 1.5rem;   /* 24px — section padding */
--spacing-xl: 2rem;     /* 32px — large section separation */
```

## Layout

### Dashboard Structure

```
┌──────────────────────────────────────────────┐
│ Topbar (56px) — logo left, status right      │
├──────────┬───────────────────────────────────┤
│ Sidebar  │ Tab Bar (chat|design|forge3d|...) │
│ (260px)  ├───────────────────────────────────┤
│          │ Tab Panel (flex: 1, overflow)      │
│ Sessions │                                    │
│ Providers│                                    │
│ Budget   │                                    │
└──────────┴───────────────────────────────────┘
```

### Component Patterns

**Card**: `background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--spacing-md);`

**Section heading**: `font-size: 0.75rem; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px;`

**Input field**: `background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); focus: border-color: var(--accent-primary);`

**Primary button**: `background: var(--accent-primary); color: #fff; border-radius: var(--radius-md); font-weight: 600; hover: var(--accent-light) + translateY(-1px) + box-shadow;`

**Focus visible**: `outline: 2px solid var(--accent-primary); outline-offset: 2px;`

### Animations

- **fadeIn**: opacity 0→1, translateY 10px→0, 0.3s ease (messages)
- **slideUp**: opacity 0→1, translateY 20px→0, 0.3s ease (plan viewer)
- **pulse**: opacity 0.3↔1, scale 0.8↔1, 1.4s ease (loading dots)
- **Transitions**: 0.2s ease for hover/focus states

## CSS File Organization

| File | Purpose |
|------|---------|
| `dashboard.css` | Base tokens, global layout, chat, plan viewer, buttons, utilities |
| `system-health.css` | Health tab — provider cards, latency charts, activity |
| `file-browser.css` | File browser dropdown component |
| `design-viewer.css` | Design tab — prompt input, image cards, status |
| `forge3d.css` | Forge3D tab — viewport, controls, gallery, queue |

### When Adding New Styles

1. Use existing CSS variables — never hardcode colors or spacing
2. Add component-scoped styles to the relevant tab CSS file
3. Keep global utilities (`.hidden`, scrollbar) in `dashboard.css`
4. Use `var(--radius-md)` for inputs/buttons, `var(--radius-lg)` for cards
5. Match existing shadow pattern (cards are flat with border; buttons get shadow on hover only)
6. All font sizes in `rem`, never `px`

## Accessibility Checklist

- All text meets WCAG AA contrast (4.5:1 body, 3:1 large)
- Color is not the sole indicator of meaning (status badges have text + color)
- Interactive elements have `:hover`, `:focus`, and `:focus-visible` states
- Font size never below 10px (0.625rem) for readable text
- Keyboard-navigable tabs and buttons via `:focus-visible` ring
- `aria-label` on icon-only buttons and indicators
