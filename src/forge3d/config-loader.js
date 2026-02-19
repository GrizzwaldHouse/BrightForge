/**
 * Forge3D Config Loader
 *
 * Loads config/forge3d.yaml and provides typed access to all settings.
 * Mirrors the pattern from src/core/llm-client.js.
 * Singleton + named export.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 2026
 */

import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '../../config/forge3d.yaml');

class Forge3DConfig {
  constructor(configOverride = null) {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf8');
      const parsed = parseYaml(raw);
      this.config = configOverride ? this._deepMerge(parsed, configOverride) : parsed;
      console.log('[CONFIG] Loaded config/forge3d.yaml');
    } catch (err) {
      console.warn(`[CONFIG] Could not load forge3d.yaml: ${err.message}`);
      this.config = configOverride || {};
    }

    // Flatten to properties with defaults
    this.pythonServer = this._section('python_server', {
      default_port: 8001,
      default_host: '127.0.0.1',
      port_range_start: 8001,
      port_range_end: 8010,
      startup_timeout_ms: 30000,
      startup_poll_ms: 1000,
      max_restart_attempts: 3,
      restart_cooldown_ms: 5000,
      shutdown_grace_ms: 5000,
      command_timeout_ms: 15000
    });

    this.healthCheck = this._section('health_check', {
      interval_ms: 10000,
      timeout_ms: 5000,
      max_consecutive_failures: 3
    });

    this.generation = this._section('generation', {
      timeout_ms: 180000,
      full_pipeline_multiplier: 2,
      max_image_size_bytes: 20 * 1024 * 1024,
      min_prompt_length: 3,
      max_prompt_length: 2000,
      download_timeout_ms: 30000
    });

    this.database = this._section('database', {
      path: 'data/forge3d.db',
      journal_mode: 'WAL',
      busy_timeout_ms: 5000
    });

    this.project = this._section('project', {
      output_dir: 'data/output',
      sanitize_pattern: '[<>:"/\\\\|?*]'
    });

    this.queue = this._section('queue', {
      process_interval_ms: 100,
      max_size: 20,
      max_retries: 2,
      temp_dir: 'data/temp',
      temp_max_age_ms: 3600000
    });

    this.api = this._section('api', {
      raw_body_limit: '20mb',
      history_default_limit: 50
    });

    this.session = this._section('session', {
      id_length: 12,
      default_list_limit: 20,
      cleanup_max_age_ms: 3600000,
      progress: {
        image_start_pct: 10,
        mesh_start_pct: 10,
        mesh_end_pct: 100,
        mesh_after_image_pct: 80
      }
    });

    this.viewer = this._section('viewer', {
      default_width: 600,
      default_height: 400,
      background_color: '0x1a1a2e',
      camera: { fov: 45, near: 0.1, far: 1000, default_position: [3, 2, 3] },
      frame_distance_multiplier: 1.5,
      frame_position_offsets: [0.7, 0.5, 0.7],
      orbit_controls: { damping_factor: 0.05, min_distance: 0.5, max_distance: 50 },
      lights: {
        ambient: { color: '0x888fff', intensity: 0.5 },
        directional: { color: '0xffffff', intensity: 1.0, position: [5, 10, 7] },
        fill: { color: '0x8888ff', intensity: 0.3, position: [-5, 3, -5] }
      },
      grid: { size: 10, divisions: 20, color1: '0x3a3a54', color2: '0x252941' }
    });

    this.fbxExport = this._section('fbx_export', {
      enabled: true,
      auto_convert: true,
      coordinate_system: 'unreal'
    });

    this.ui = this._section('ui', {
      generation_polling_ms: 2000,
      vram_polling_ms: 10000,
      vram_thresholds: { ok_pct: 70, warn_pct: 85 }
    });
  }

  /**
   * Resolve a project-root-relative path to absolute.
   * @param {string} relativePath - e.g. "data/forge3d.db"
   * @returns {string} Absolute path
   */
  resolvePath(relativePath) {
    return join(__dirname, '../..', relativePath);
  }

  /**
   * Get a config section with defaults merged.
   * @param {string} key - Top-level YAML key
   * @param {Object} defaults - Default values
   * @returns {Object} Merged config
   */
  _section(key, defaults) {
    const raw = this.config[key] || {};
    return this._deepMerge(defaults, raw);
  }

  /**
   * Deep merge source into target (source wins).
   */
  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = this._deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  /**
   * Return the full viewer + UI config for the frontend API endpoint.
   */
  getClientConfig() {
    return {
      viewer: this.viewer,
      ui: this.ui,
      generation: {
        max_image_size_bytes: this.generation.max_image_size_bytes,
        min_prompt_length: this.generation.min_prompt_length
      }
    };
  }
}

// Singleton
const forge3dConfig = new Forge3DConfig();
export default forge3dConfig;
export { Forge3DConfig };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[CONFIG] Running self-test...');

  const cfg = new Forge3DConfig();

  // Verify sections loaded
  console.assert(cfg.pythonServer.default_port === 8001, 'Default port should be 8001');
  console.assert(cfg.healthCheck.interval_ms === 10000, 'Health interval should be 10000');
  console.assert(cfg.generation.timeout_ms === 180000, 'Gen timeout should be 180000');
  console.assert(cfg.database.path === 'data/forge3d.db', 'DB path should match');
  console.assert(cfg.project.output_dir === 'data/output', 'Output dir should match');
  console.assert(cfg.queue.max_size === 20, 'Queue max size should be 20');
  console.assert(cfg.api.raw_body_limit === '20mb', 'Body limit should be 20mb');
  console.assert(cfg.session.id_length === 12, 'Session ID length should be 12');
  console.assert(cfg.viewer.camera.fov === 45, 'Camera FOV should be 45');
  console.assert(cfg.ui.generation_polling_ms === 2000, 'Polling should be 2000');

  // Test resolvePath
  const absPath = cfg.resolvePath('data/forge3d.db');
  console.assert(absPath.includes('data'), 'Resolved path should contain data');

  // Test getClientConfig
  const client = cfg.getClientConfig();
  console.assert(client.viewer.camera.fov === 45, 'Client config should have viewer');
  console.assert(client.ui.generation_polling_ms === 2000, 'Client config should have UI');

  // Test deep merge with override
  const custom = new Forge3DConfig({ python_server: { default_port: 9999 } });
  console.assert(custom.pythonServer.default_port === 9999, 'Override should take priority');
  console.assert(custom.pythonServer.default_host === '127.0.0.1', 'Non-overridden defaults should remain');

  console.log('[CONFIG] Self-test passed');
  process.exit(0);
}
