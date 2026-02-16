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
  constructor(containerId) {
    this.container = document.getElementById(containerId);
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

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(3, 2, 3);
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
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 50;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = false;
    this.scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);

    // Grid
    const grid = new THREE.GridHelper(10, 20, 0x3a3a54, 0x252941);
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
      this.camera.position.set(3, 2, 3);
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
    const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.5;

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
