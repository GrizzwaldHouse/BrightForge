/**
 * Forge3D Viewer - Three.js GLB/glTF 3D Preview
 *
 * Loads and displays 3D meshes with orbit controls,
 * grid ground plane, lighting, and wireframe toggle.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

/* global THREE */

class Forge3DViewer {
  constructor(containerId, config = {}) {
    this.container = document.getElementById(containerId);
    this._config = config;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.currentModel = null;
    this.wireframeMode = false;
    this.animationId = null;
    this.initialized = false;

    // Feature 1: Auto-rotate state
    this._autoRotate = false;
    this._autoRotateResumeTimeout = null;

    // Feature 3: Environment preset refs
    this._ambientLight = null;
    this._directionalLight = null;
    this._fillLight = null;
    this._grid = null;
    this._envPresets = new Map([
      ['dark', {
        bg: 0x1a1a2e,
        ambient: { color: 0xffffff, intensity: 0.5 },
        directional: { color: 0xffffff, intensity: 1.0 },
        fill: { color: 0x8888ff, intensity: 0.3 },
        gridVisible: true
      }],
      ['light', {
        bg: 0xd0d0d8,
        ambient: { color: 0xffffff, intensity: 0.8 },
        directional: { color: 0xffffff, intensity: 0.6 },
        fill: { color: 0xaaaaff, intensity: 0.2 },
        gridVisible: true
      }],
      ['gradient', {
        bg: 0x0d1b2a,
        ambient: { color: 0x88ccff, intensity: 0.6 },
        directional: { color: 0xffeedd, intensity: 0.9 },
        fill: { color: 0x4466aa, intensity: 0.4 },
        gridVisible: false
      }],
      ['studio', {
        bg: 0x222222,
        ambient: { color: 0xffffff, intensity: 0.7 },
        directional: { color: 0xfff5e6, intensity: 1.2 },
        fill: { color: 0xccccff, intensity: 0.5 },
        gridVisible: false
      }],
      ['wireframe-grid', {
        bg: 0x000000,
        ambient: { color: 0x00ff88, intensity: 0.4 },
        directional: { color: 0x00ff88, intensity: 0.8 },
        fill: { color: 0x0088ff, intensity: 0.3 },
        gridVisible: true
      }]
    ]);

    // Feature 4: Mesh info overlay element
    this._overlayEl = null;

    // Feature 6: Reference image overlay
    this._refImageEl = null;
  }

  /**
   * Read a nested config value with a default fallback.
   * @param {object} config - Config object to read from
   * @param {string} path - Dot-separated key path (e.g. 'camera.fov')
   * @param {*} defaultVal - Value to return when path is missing
   */
  _opt(config, path, defaultVal) {
    const parts = path.split('.');
    let val = config;
    for (const p of parts) {
      if (val == null || typeof val !== 'object') return defaultVal;
      val = val[p];
    }
    return val != null ? val : defaultVal;
  }

  /**
   * Initialize Three.js scene.
   */
  init() {
    if (this.initialized) return;
    if (!this.container) {
      console.error('[VIEWER] Container not found');
      return;
    }

    const width = this.container.clientWidth || 600;
    const height = this.container.clientHeight || 400;

    const cfg = this._config;

    // Scene
    this.scene = new THREE.Scene();
    const bgColorStr = this._opt(cfg, 'background_color', '0x1a1a2e');
    this.scene.background = new THREE.Color(parseInt(bgColorStr, 16));

    // Camera
    const fov = this._opt(cfg, 'camera.fov', 45);
    const near = this._opt(cfg, 'camera.near', 0.1);
    const far = this._opt(cfg, 'camera.far', 1000);
    const camPos = this._opt(cfg, 'camera.default_position', [3, 2, 3]);
    this.camera = new THREE.PerspectiveCamera(fov, width / height, near, far);
    this.camera.position.set(camPos[0], camPos[1], camPos[2]);
    this.camera.lookAt(0, 0, 0);

    // Renderer (preserveDrawingBuffer for screenshot export)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // Orbit controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = this._opt(cfg, 'orbit_controls.damping_factor', 0.05);
    this.controls.minDistance = this._opt(cfg, 'orbit_controls.min_distance', 0.5);
    this.controls.maxDistance = this._opt(cfg, 'orbit_controls.max_distance', 50);

    // Lighting
    const ambientColorStr = this._opt(cfg, 'lights.ambient.color', '0xffffff');
    const ambientIntensity = this._opt(cfg, 'lights.ambient.intensity', 0.5);
    this._ambientLight = new THREE.AmbientLight(parseInt(ambientColorStr, 16), ambientIntensity);
    this.scene.add(this._ambientLight);

    const dirColorStr = this._opt(cfg, 'lights.directional.color', '0xffffff');
    const dirIntensity = this._opt(cfg, 'lights.directional.intensity', 1.0);
    this._directionalLight = new THREE.DirectionalLight(parseInt(dirColorStr, 16), dirIntensity);
    this._directionalLight.position.set(5, 10, 7);
    this._directionalLight.castShadow = false;
    this.scene.add(this._directionalLight);

    const fillColorStr = this._opt(cfg, 'lights.fill.color', '0x8888ff');
    const fillIntensity = this._opt(cfg, 'lights.fill.intensity', 0.3);
    this._fillLight = new THREE.DirectionalLight(parseInt(fillColorStr, 16), fillIntensity);
    this._fillLight.position.set(-5, 3, -5);
    this.scene.add(this._fillLight);

    // Grid
    const gridSize = this._opt(cfg, 'grid.size', 10);
    const gridDivisions = this._opt(cfg, 'grid.divisions', 20);
    const gridColor1Str = this._opt(cfg, 'grid.color1', '0x3a3a54');
    const gridColor2Str = this._opt(cfg, 'grid.color2', '0x252941');
    this._grid = new THREE.GridHelper(
      gridSize, gridDivisions,
      parseInt(gridColor1Str, 16),
      parseInt(gridColor2Str, 16)
    );
    this.scene.add(this._grid);

    // Feature 1: Auto-rotate pause on user interaction
    this.controls.addEventListener('start', () => {
      if (this._autoRotate) {
        this.controls.autoRotate = false;
        if (this._autoRotateResumeTimeout) clearTimeout(this._autoRotateResumeTimeout);
        this._autoRotateResumeTimeout = setTimeout(() => {
          if (this._autoRotate) this.controls.autoRotate = true;
        }, 3000);
      }
    });

    // Feature 3: Restore saved environment preference
    const savedEnv = localStorage.getItem('forge3d-env');
    if (savedEnv && this._envPresets.has(savedEnv)) {
      this.setEnvironment(savedEnv);
    }

    // Feature 4: Mesh info overlay
    this._createOverlayElement();

    // Handle resize
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this.container);

    // Start render loop
    this._animate();

    this.initialized = true;
    console.log('[VIEWER] Three.js viewer initialized');
  }

  /**
   * Load a GLB file from URL or buffer.
   * @param {string|ArrayBuffer} source - URL string or ArrayBuffer
   */
  async loadModel(source) {
    if (!this.initialized) this.init();

    // Remove current model
    this._clearModel();

    const loader = new THREE.GLTFLoader();

    try {
      let gltf;

      if (typeof source === 'string') {
        gltf = await new Promise((resolve, reject) => {
          loader.load(source, resolve, undefined, reject);
        });
      } else {
        // ArrayBuffer
        gltf = await new Promise((resolve, reject) => {
          loader.parse(source, '', resolve, reject);
        });
      }

      this.currentModel = gltf.scene;
      this.scene.add(this.currentModel);

      // Auto-frame the model
      this._frameModel(this.currentModel);

      // Feature 4: Update mesh info overlay
      this.updateMeshOverlay();

      console.log('[VIEWER] Model loaded');
      return true;

    } catch (err) {
      console.error('[VIEWER] Failed to load model:', err);
      return false;
    }
  }

  /**
   * Load model from API endpoint.
   * @param {string} sessionId - Forge session ID
   */
  async loadFromSession(sessionId) {
    const url = `/api/forge3d/download/${sessionId}`;
    return this.loadModel(url);
  }

  /**
   * Toggle wireframe mode.
   */
  toggleWireframe() {
    this.wireframeMode = !this.wireframeMode;

    if (this.currentModel) {
      this.currentModel.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => { m.wireframe = this.wireframeMode; });
          } else {
            child.material.wireframe = this.wireframeMode;
          }
        }
      });
    }

    return this.wireframeMode;
  }

  /**
   * Reset camera to default position.
   */
  resetCamera() {
    if (this.currentModel) {
      this._frameModel(this.currentModel);
    } else {
      const camPos = this._opt(this._config, 'camera.default_position', [3, 2, 3]);
      this.camera.position.set(camPos[0], camPos[1], camPos[2]);
      this.camera.lookAt(0, 0, 0);
      this.controls.target.set(0, 0, 0);
    }
    this.controls.update();
  }

  /**
   * Get model info.
   */
  getModelInfo() {
    if (!this.currentModel) return null;

    let vertices = 0;
    let triangles = 0;
    let meshes = 0;

    this.currentModel.traverse((child) => {
      if (child.isMesh) {
        meshes++;
        const geo = child.geometry;
        vertices += geo.attributes.position ? geo.attributes.position.count : 0;
        triangles += geo.index ? geo.index.count / 3 : vertices / 3;
      }
    });

    return { vertices, triangles, meshes };
  }

  /**
   * Auto-frame camera to fit model.
   */
  _frameModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    const frameMultiplier = this._opt(this._config, 'frame_distance_multiplier', 1.5);
    const distance = maxDim / (2 * Math.tan(fov / 2)) * frameMultiplier;

    this.camera.position.set(
      center.x + distance * 0.7,
      center.y + distance * 0.5,
      center.z + distance * 0.7
    );
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  /**
   * Remove current model from scene.
   */
  _clearModel() {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else if (child.material) {
            child.material.dispose();
          }
        }
      });
      this.currentModel = null;
    }
    // Feature 4: Hide mesh info overlay
    if (this._overlayEl) this._overlayEl.classList.add('hidden');
  }

  /**
   * Render loop.
   */
  _animate() {
    this.animationId = requestAnimationFrame(() => this._animate());
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handle container resize.
   */
  _onResize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // =============================================
  // Feature 1: Turntable Auto-Rotate
  // =============================================

  /**
   * Enable or disable turntable auto-rotation.
   * @param {boolean} enabled
   */
  setAutoRotate(enabled) {
    this._autoRotate = enabled;
    if (this.controls) {
      this.controls.autoRotate = enabled;
      this.controls.autoRotateSpeed = 1.0;
    }
    if (!enabled && this._autoRotateResumeTimeout) {
      clearTimeout(this._autoRotateResumeTimeout);
      this._autoRotateResumeTimeout = null;
    }
    console.log('[VIEWER] Auto-rotate:', enabled);
  }

  /**
   * Get current auto-rotate state.
   * @returns {boolean}
   */
  getAutoRotate() {
    return this._autoRotate;
  }

  // =============================================
  // Feature 2: Screenshot / Export
  // =============================================

  /**
   * Capture a screenshot of the current viewport.
   * @param {string} [filename] - Download filename
   */
  captureScreenshot(filename) {
    if (!this.renderer || !this.scene || !this.camera) return;

    // Force a fresh render
    this.renderer.render(this.scene, this.camera);

    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    const name = filename || `forge3d-${Date.now()}.png`;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    console.log('[VIEWER] Screenshot captured:', name);
  }

  // =============================================
  // Feature 3: Background / Environment Switcher
  // =============================================

  /**
   * Apply an environment preset.
   * @param {string} presetName - One of: dark, light, gradient, studio, wireframe-grid
   */
  setEnvironment(presetName) {
    const preset = this._envPresets.get(presetName);
    if (!preset) {
      console.warn('[VIEWER] Unknown env preset:', presetName);
      return;
    }

    // Background
    if (this.scene) {
      this.scene.background = new THREE.Color(preset.bg);
    }

    // Lights
    if (this._ambientLight) {
      this._ambientLight.color.setHex(preset.ambient.color);
      this._ambientLight.intensity = preset.ambient.intensity;
    }
    if (this._directionalLight) {
      this._directionalLight.color.setHex(preset.directional.color);
      this._directionalLight.intensity = preset.directional.intensity;
    }
    if (this._fillLight) {
      this._fillLight.color.setHex(preset.fill.color);
      this._fillLight.intensity = preset.fill.intensity;
    }

    // Grid visibility
    if (this._grid) {
      this._grid.visible = preset.gridVisible;
    }

    // Persist preference
    localStorage.setItem('forge3d-env', presetName);
    console.log('[VIEWER] Environment set:', presetName);
  }

  /**
   * Get list of available environment preset names.
   * @returns {string[]}
   */
  getEnvironmentPresets() {
    return Array.from(this._envPresets.keys());
  }

  // =============================================
  // Feature 4: Mesh Info Overlay
  // =============================================

  /**
   * Create the mesh info overlay element and append to container.
   */
  _createOverlayElement() {
    if (!this.container) return;
    this._overlayEl = document.createElement('div');
    this._overlayEl.className = 'mesh-info-overlay hidden';
    this.container.appendChild(this._overlayEl);
  }

  /**
   * Update the mesh info overlay with current model data.
   */
  updateMeshOverlay() {
    if (!this._overlayEl || !this.currentModel) return;

    const info = this.getModelInfo();
    if (!info) {
      this._overlayEl.classList.add('hidden');
      return;
    }

    // Bounding box dimensions
    const box = new THREE.Box3().setFromObject(this.currentModel);
    const size = box.getSize(new THREE.Vector3());
    const dimX = size.x.toFixed(2);
    const dimY = size.y.toFixed(2);
    const dimZ = size.z.toFixed(2);

    this._overlayEl.innerHTML = [
      `<span class="mesh-info-label">Vertices</span><span class="mesh-info-value">${info.vertices.toLocaleString()}</span>`,
      `<span class="mesh-info-label">Triangles</span><span class="mesh-info-value">${info.triangles.toLocaleString()}</span>`,
      `<span class="mesh-info-label">Meshes</span><span class="mesh-info-value">${info.meshes}</span>`,
      `<span class="mesh-info-label">Bounds</span><span class="mesh-info-value">${dimX} x ${dimY} x ${dimZ}</span>`
    ].join('');

    this._overlayEl.classList.remove('hidden');
  }

  // =============================================
  // Feature 6: Reference Image Overlay
  // =============================================

  /**
   * Show a reference image overlaid on the viewport.
   * @param {string} dataUrl - Image data URL
   */
  setReferenceImage(dataUrl) {
    if (!this.container) return;

    if (!this._refImageEl) {
      this._refImageEl = document.createElement('img');
      this._refImageEl.className = 'ref-image-overlay';
      this.container.appendChild(this._refImageEl);
    }

    this._refImageEl.src = dataUrl;
    this._refImageEl.classList.remove('hidden');
    console.log('[VIEWER] Reference image set');
  }

  /**
   * Remove the reference image overlay.
   */
  clearReferenceImage() {
    if (this._refImageEl) {
      this._refImageEl.classList.add('hidden');
      this._refImageEl.src = '';
    }
    console.log('[VIEWER] Reference image cleared');
  }

  /**
   * Set reference image opacity.
   * @param {number} value - Opacity 0-100
   */
  setReferenceOpacity(value) {
    if (this._refImageEl) {
      this._refImageEl.style.opacity = value / 100;
    }
  }

  /**
   * Capture a thumbnail of the current viewport (256x256).
   * @returns {string|null} Base64 data URL or null
   */
  captureThumbnail() {
    if (!this.renderer || !this.scene || !this.camera) return null;

    // Force render
    this.renderer.render(this.scene, this.camera);

    const canvas = this.renderer.domElement;
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 256;
    thumbCanvas.height = 256;
    const ctx = thumbCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 256, 256);
    return thumbCanvas.toDataURL('image/png');
  }

  /**
   * Cleanup.
   */
  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._autoRotateResumeTimeout) clearTimeout(this._autoRotateResumeTimeout);
    this._clearModel();
    if (this._overlayEl && this._overlayEl.parentNode) {
      this._overlayEl.parentNode.removeChild(this._overlayEl);
    }
    if (this._refImageEl && this._refImageEl.parentNode) {
      this._refImageEl.parentNode.removeChild(this._refImageEl);
    }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    this.initialized = false;
  }
}

export { Forge3DViewer };
