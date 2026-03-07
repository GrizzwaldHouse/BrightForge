---
name: BrightForge Module Creator
description: Scaffold a new BrightForge module following project conventions (ESM, singleton, self-test, logging).
---

# BrightForge Module Creator

Use when creating a new module for the BrightForge project. Ensures consistency with all established patterns.

## When to Use

- Adding a new core module to `src/core/`
- Adding a new Forge3D module to `src/forge3d/`
- Adding a new API route to `src/api/routes/`
- Adding a new frontend component to `public/js/`

## Module Template (src/core or src/forge3d)

Every module MUST follow this pattern:

```javascript
/**
 * ModuleName - Brief description
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date YYYY-MM-DD
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ModuleName {
  constructor() {
    // Initialize state
  }

  // Methods here
}

// Singleton + named export
const instance = new ModuleName();
export default instance;
export { ModuleName };

// Self-test block
if (process.argv.includes('--test')) {
  console.log('[MODULE] Running self-test...');
  // Tests here
  console.log('[MODULE] All tests passed!');
}
```

## Checklist

- [ ] ESM imports with `.js` extensions
- [ ] `fileURLToPath`/`dirname` for path resolution
- [ ] `[PREFIX]` logging tag chosen and documented
- [ ] Singleton + named class export
- [ ] `--test` self-test block at bottom
- [ ] npm script added to package.json
- [ ] YAML config if needed (loaded with `readFileSync` + `parse`)
- [ ] Import and use `telemetryBus` and `errorHandler` for observability
- [ ] No new dependencies (use native fetch, existing packages only)

## API Route Template

```javascript
import express from 'express';
import errorHandler from '../../core/error-handler.js';

const router = express.Router();

// Routes here

export default router;
```

Mount in `src/api/server.js` with `app.use('/api/name', routes);`

## Frontend Component Template

Frontend scripts are loaded via `<script>` tags (NOT ES modules). Classes must be exposed to `window` scope for cross-file access.

```javascript
/**
 * ComponentName - Brief description
 * @author Marcus Daley (GrizzwaldHouse)
 * @date YYYY-MM-DD
 */

class ComponentName {
  constructor(app) {
    this.app = app;
    console.log('[COMPONENT] ComponentName initialized');
  }

  async init() {
    // Load data, render
  }

  render() {
    // Build HTML, attach events
    // Re-initialize Lucide icons for new content:
    if (window.lucide) {
      window.lucide.createIcons({ nameAttr: 'data-lucide' });
    }
  }
}

// Expose to global scope (required for non-module scripts)
window.ComponentName = ComponentName;
```

### Frontend Checklist (LS-017)

- [ ] Class exposed via `window.ClassName = ClassName;` at end of file
- [ ] Consuming files declare `/* global ClassName */` at top for ESLint
- [ ] Script tag added to `index.html` BEFORE `app.js` (load order matters)
- [ ] XSS prevention: use `_escapeHtml()` for any user-supplied text in innerHTML
- [ ] Lucide icons: call `createIcons()` only after rendering new data-lucide elements
- [ ] Single quotes (ESLint enforces), semicolons required, 2-space indent
