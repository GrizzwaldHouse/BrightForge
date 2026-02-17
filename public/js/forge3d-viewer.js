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

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
    const ambientLight = new THREE.AmbientLight(parseInt(ambientColorStr, 16), ambientIntensity);
    this.scene.add(ambientLight);

    const dirColorStr = this._opt(cfg, 'lights.directional.color', '0xffffff');
    const dirIntensity = this._opt(cfg, 'lights.directional.intensity', 1.0);
    const directionalLight = new THREE.DirectionalLight(parseInt(dirColorStr, 16), dirIntensity);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = false;
    this.scene.add(directionalLight);

    const fillColorStr = this._opt(cfg, 'lights.fill.color', '0x8888ff');
    const fillIntensity = this._opt(cfg, 'lights.fill.intensity', 0.3);
    const fillLight = new THREE.DirectionalLight(parseInt(fillColorStr, 16), fillIntensity);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);

    // Grid
    const gridSize = this._opt(cfg, 'grid.size', 10);
    const gridDivisions = this._opt(cfg, 'grid.divisions', 20);
    const gridColor1Str = this._opt(cfg, 'grid.color1', '0x3a3a54');
    const gridColor2Str = this._opt(cfg, 'grid.color2', '0x252941');
    const grid = new THREE.GridHelper(
      gridSize, gridDivisions,
      parseInt(gridColor1Str, 16),
      parseInt(gridColor2Str, 16)
    );
    this.scene.add(grid);

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

  /**
   * Cleanup.
   */
  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._clearModel();
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
