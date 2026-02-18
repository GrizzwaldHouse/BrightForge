---
name: BrightForge UI Design System
description: Design tokens, color palette, typography, spacing, and component patterns for the BrightForge web dashboard. Reference this when modifying any CSS or HTML in public/.
---

# BrightForge UI Design System

Based on [cowork-skills/design-system](https://github.com/GrizzwaldHouse/cowork-skills) principles, adapted for the BrightForge dark-theme dashboard.

## Design Tokens (CSS Custom Properties)

All tokens are defined in `public/css/dashboard.css` `:root`. Always use variables, never hardcode colors.

### Current Color Palette

```css
--bg-primary: #1a1a2e;     /* Page background (surface level 0) */
--bg-secondary: #16213e;   /* Sidebar, topbar, input bars (surface level 1) */
--bg-tertiary: #0f3460;    /* Active states, user messages (surface level 2) */
--bg-card: #252941;        /* Cards, elevated panels */
--bg-hover: #2d3250;       /* Hover states, operation headers */
--text-primary: #e0e0e0;   /* Body text — WCAG AAA vs bg-primary (13.3:1) */
--text-secondary: #a0a0a0; /* Labels, meta text */
--text-dim: #707070;       /* Disabled, placeholder */
--accent-primary: #00d9ff; /* Cyan — links, active tabs, headings, buttons */
--accent-secondary: #00a8cc; /* Darker cyan — hover states */
--success: #00e676;        /* Green — online, complete, approve */
--warning: #ffd600;        /* Yellow — degraded, generating states */
--error: #ff5252;          /* Red — offline, failed, reject, delete */
--border: #3a3a54;         /* Card/section borders */
```

### Semantic Color Usage

| Purpose | Token | Example |
|---------|-------|---------|
| Primary action button | `--accent-primary` on bg | Generate, Send |
| Approve / success | `--success` on bg | Approve button, online badge |
| Danger / destructive | `--error` on bg | Reject, delete, error badge |
| Warning / caution | `--warning` on bg | Rollback, generating state |
| Inactive / disabled | `--text-dim` | Disabled buttons, placeholder |
| Section headings | `--accent-primary` | Forge3D section h3, plan title |
| Active tab indicator | `--accent-primary` | 2px bottom border |

### Contrast Compliance (WCAG)

- `--text-primary` on `--bg-primary`: 13.3:1 (AAA pass)
- `--text-primary` on `--bg-card`: ~10:1 (AAA pass)
- `--accent-primary` on `--bg-primary`: ~8.5:1 (AAA pass)
- `--success` on `--bg-primary`: ~6:1 (AA pass)
- `--error` on `--bg-primary`: ~4.8:1 (AA pass)

## Typography

```css
--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
--font-mono: 'Fira Code', 'Cascadia Code', 'Courier New', Consolas, monospace;
```

### Scale (Major Third 1.25 from 16px base)

| Element | Size | Weight | Line Height | Usage |
|---------|------|--------|-------------|-------|
| Logo | 1.5rem (24px) | 600 | — | Topbar brand |
| H2 | 1.2rem (19px) | 600 | 1.3 | Panel headings, plan title |
| H3 (sections) | 0.85rem (14px) | 600 | — | Sidebar sections, forge3d sections |
| Body | 1rem (16px) | 400 | 1.6 | Chat messages |
| UI labels | 0.95rem (15px) | 500 | — | Tab labels, buttons |
| Small | 0.9rem (14px) | 400 | — | Session items, inputs |
| Caption | 0.75-0.85rem | 400-600 | — | Meta text, status badges |
| Mono data | 0.85rem (14px) | 400 | 1.5 | Code blocks, file paths |

### Rules

- **Max 2 typefaces**: `--font-sans` (everything) + `--font-mono` (code/paths only)
- **Minimum**: Never below 10px (caption smallest at 0.75rem = 12px)
- **Section headings**: uppercase + `letter-spacing: 0.5-1px`
- **All-caps**: Only for section labels and status badges

## Spacing (8px Base Grid)

```css
--spacing-xs: 0.25rem;  /* 4px — tight inline, icon gaps */
--spacing-sm: 0.5rem;   /* 8px — compact element spacing */
--spacing-md: 1rem;     /* 16px — default padding/gap */
--spacing-lg: 1.5rem;   /* 24px — section padding, chat padding */
--spacing-xl: 2rem;     /* 32px — large section separation */
```

All spacing must be multiples of 8px. The only exception is 4px for micro-spacing.

## Layout

### Dashboard Structure

```
┌─────────────────────────────────────────────┐
│ Topbar (60px) — logo left, status right     │
├──────────┬──────────────────────────────────┤
│ Sidebar  │ Tab Bar (chat|design|forge3d|...) │
│ (260px)  ├──────────────────────────────────┤
│          │ Tab Panel (flex: 1, overflow)     │
│ Sessions │                                   │
│ Providers│                                   │
│ Budget   │                                   │
└──────────┴──────────────────────────────────┘
```

- **Topbar**: 60px height, `--bg-secondary`, bottom border
- **Sidebar**: 260px fixed, `--bg-secondary`, right border, scrollable
- **Tab bar**: `--bg-secondary`, 2px accent bottom border on active
- **Tab panels**: Fill remaining space, flex column

### Component Patterns

**Card**: `background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: var(--spacing-md);`

**Section heading**: `font-size: 14px; font-weight: 600; color: var(--accent-primary); text-transform: uppercase; letter-spacing: 0.5px;`

**Input field**: `background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4-6px; color: var(--text-primary); focus: border-color: var(--accent-primary);`

**Primary button**: `background: var(--accent-primary); color: var(--bg-primary); border-radius: 6px; font-weight: 600; hover: translateY(-1px) + box-shadow;`

**Status badge**: `font-size: 0.75rem; color: var(--success|warning|error);`

### Animations

- **fadeIn**: opacity 0→1, translateY 10px→0, 0.3s ease (messages)
- **slideUp**: opacity 0→1, translateY 20px→0, 0.3s ease (plan viewer)
- **pulse**: opacity 0.3↔1, scale 0.8↔1, 1.4s ease (loading dots)
- **Transitions**: 0.2-0.3s ease for hover/focus states

## CSS File Organization

| File | Purpose | Scope |
|------|---------|-------|
| `dashboard.css` | Base theme, tokens, layout, chat, plan viewer | Global |
| `system-health.css` | Health tab panels and metrics | Health tab |
| `file-browser.css` | File browser component | File browser |
| `design-viewer.css` | Design tab layout | Design tab |
| `forge3d.css` | Forge3D tab, viewport, controls, gallery | Forge3D tab |

### When Adding New Styles

1. Use existing CSS variables — never hardcode colors or spacing
2. Add component-scoped styles to the relevant tab CSS file
3. Keep global utilities (`.hidden`, scrollbar) in `dashboard.css`
4. Follow existing border-radius: 4px (buttons, inputs) or 8px (cards, sections)
5. Maintain 6px corner radius for inputs/buttons, 8px for cards
6. Match existing shadow/elevation pattern (cards are flat with border, no box-shadow except buttons on hover)

## Accessibility Checklist

- All text meets WCAG AA contrast (4.5:1 body, 3:1 large)
- Color is not the sole indicator of meaning (online/offline also has text labels)
- Interactive elements have hover/focus states
- Font size never below 12px for readable text
- Keyboard-navigable tabs and buttons
