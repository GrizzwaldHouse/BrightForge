/**
 * forge-bg.js — Viking forge Spline 3D background for Terminal Forge dashboard.
 * Embeds brightforge-forge.splinecode as a translucent canvas behind the UI panels.
 * Adapts from C:\ClaudeSkills\AgenticOS splineSync pattern.
 */

class ForgeBg {
  constructor() {
    this._app = null;
    this._canvas = null;
    this._container = null;
    this._ready = false;
  }

  async init(containerEl) {
    this._container = containerEl;

    // Check WebGL2 support — fall back to CSS gradient if unavailable
    if (!this._detectWebGL()) {
      this._applyGradientFallback(containerEl);
      return;
    }

    // Create transparent canvas element
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0.18;
      pointer-events: none;
      z-index: 0;
    `;
    containerEl.style.position = 'relative';
    containerEl.insertBefore(this._canvas, containerEl.firstChild);

    // Lazy-load Spline runtime — don't block UI paint
    try {
      const { Application } = await import('https://unpkg.com/@splinetool/runtime@latest/build/runtime.js');
      this._app = new Application(this._canvas);
      await this._app.load('/spline/brightforge-forge.splinecode');
      this._ready = true;
      console.log('[FORGE-BG] Spline scene loaded');
    } catch (err) {
      console.warn('[FORGE-BG] Spline unavailable, using CSS fallback:', err.message);
      this._applyGradientFallback(containerEl);
    }
  }

  // Called when a generation job starts
  setForgeActive(active) {
    if (!this._ready) return;
    this._app.setVariable('forge_active', active);
    this._app.setVariable('ember_intensity', active ? 0.7 : 0.25);
    this._app.setVariable('spark_rate', active ? 28 : 4);
  }

  // Called on error states
  setAlertMode(active) {
    if (!this._ready) return;
    this._app.setVariable('alert_mode', active);
  }

  // Adjust overall opacity (user preference)
  setOpacity(value) {
    if (this._canvas) {
      this._canvas.style.opacity = Math.max(0, Math.min(1, value));
    }
    if (this._ready) {
      this._app.setVariable('scene_opacity', value);
    }
  }

  _detectWebGL() {
    try {
      const c = document.createElement('canvas');
      return c.getContext('webgl2') !== null;
    } catch {
      return false;
    }
  }

  // CSS-only fallback — subtle radial amber glow, no Spline needed
  _applyGradientFallback(containerEl) {
    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      background:
        radial-gradient(ellipse 60% 40% at 70% 75%,
          oklch(16% 0.05 74 / 0.22) 0%,
          transparent 70%),
        radial-gradient(ellipse 30% 20% at 65% 90%,
          oklch(22% 0.08 74 / 0.15) 0%,
          transparent 60%);
    `;
    containerEl.style.position = 'relative';
    containerEl.insertBefore(el, containerEl.firstChild);
    console.log('[FORGE-BG] CSS gradient fallback applied');
  }
}

const forgeBg = new ForgeBg();
export default forgeBg;
export { ForgeBg };
