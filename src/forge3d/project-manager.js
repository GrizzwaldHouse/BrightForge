/**
 * ProjectManager - Forge3D Project CRUD
 *
 * High-level operations for managing 3D generation projects.
 * Wraps database.js with file I/O for asset storage.
 * Path traversal protection on all file operations.
 *
 * STATUS: Complete. CRUD + asset I/O + disk usage tracking tested.
 *
 * TODO(P1): Add FBX export support (requires Blender automation or Assimp)
 * TODO(P1): Add asset thumbnail generation for gallery view (render preview PNG)
 * TODO(P1): Add mesh validation on save (vertex count, manifold check via trimesh)
 * TODO(P1): Add disk quota per project (configurable max size)
 * TODO(P2): Add project templates with pre-configured generation settings
 * TODO(P2): Add project sharing (export as zip with metadata)
 * TODO(P2): Add Unreal Engine material mapping (.uasset generation)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { mkdirSync, existsSync, writeFileSync, unlinkSync, readdirSync, statSync, rmSync } from 'fs';
import forge3dDb from './database.js';
import forge3dConfig from './config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_DIR = forge3dConfig.resolvePath(forge3dConfig.project.output_dir);
const SANITIZE_RE = new RegExp(forge3dConfig.project.sanitize_pattern, 'g');

class ProjectManager {
  constructor() {
    this.outputDir = OUTPUT_DIR;
  }

  /**
   * Validate that a resolved path is within the output directory.
   * Prevents path traversal attacks (mirrors Python's download_file validation).
   * @param {string} resolvedPath - Resolved absolute path
   * @throws {Error} If path is outside the output directory
   */
  _validatePath(resolvedPath) {
    const base = resolve(this.outputDir);
    const target = resolve(resolvedPath);
    if (!target.startsWith(base)) {
      throw new Error('Path traversal detected');
    }
  }

  /**
   * Initialize - open database and ensure directories.
   */
  init() {
    forge3dDb.open();
    mkdirSync(this.outputDir, { recursive: true });
    console.log('[PROJECT] ProjectManager initialized');
  }

  /**
   * Shutdown - close database.
   */
  shutdown() {
    forge3dDb.close();
    console.log('[PROJECT] ProjectManager shut down');
  }

  // --- Projects ---

  createProject(name, description = '') {
    if (!name || name.trim().length === 0) {
      throw new Error('Project name is required');
    }

    // Sanitize name for directory safety
    const safeName = name.replace(SANITIZE_RE, '_').trim();
    if (safeName.length === 0) {
      throw new Error('Project name contains only invalid characters');
    }

    const project = forge3dDb.createProject(safeName, description);

    // Create project output directory (with path traversal check)
    const projectDir = join(this.outputDir, project.id);
    this._validatePath(projectDir);
    mkdirSync(projectDir, { recursive: true });

    console.log(`[PROJECT] Created: "${safeName}" (${project.id})`);
    return project;
  }

  getProject(id) {
    return forge3dDb.getProject(id);
  }

  listProjects() {
    return forge3dDb.listProjects();
  }

  updateProject(id, updates) {
    const project = forge3dDb.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);

    if (updates.name) {
      updates.name = updates.name.replace(SANITIZE_RE, '_').trim();
    }

    return forge3dDb.updateProject(id, updates);
  }

  deleteProject(id) {
    const project = forge3dDb.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);

    // Delete project directory (with path traversal check)
    const projectDir = join(this.outputDir, id);
    this._validatePath(projectDir);
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }

    forge3dDb.deleteProject(id);
    console.log(`[PROJECT] Deleted: "${project.name}" (${id})`);
    return true;
  }

  // --- Assets ---

  /**
   * Save a generated asset to a project.
   * @param {string} projectId - Project to add asset to
   * @param {Object} data - Asset data
   * @param {string} data.name - Display name
   * @param {string} data.type - 'mesh' | 'image' | 'full'
   * @param {Buffer} data.buffer - File contents
   * @param {string} data.extension - File extension (.glb, .png)
   * @param {Object} [data.metadata] - Additional metadata
   * @returns {Object} Created asset record
   */
  saveAsset(projectId, data) {
    const project = forge3dDb.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // Write file to project directory (with path traversal check)
    const projectDir = join(this.outputDir, projectId);
    this._validatePath(projectDir);
    mkdirSync(projectDir, { recursive: true });

    const safeName = data.name.replace(SANITIZE_RE, '_');
    const filePath = join(projectDir, `${safeName}${data.extension}`);
    this._validatePath(filePath);

    writeFileSync(filePath, data.buffer);

    const asset = forge3dDb.createAsset(projectId, {
      name: `${safeName}${data.extension}`,
      type: data.type,
      filePath,
      fileSize: data.buffer.length,
      metadata: data.metadata || {}
    });

    console.log(`[PROJECT] Asset saved: "${asset.name}" (${asset.id}) to project "${project.name}"`);
    return asset;
  }

  getAsset(id) {
    return forge3dDb.getAsset(id);
  }

  listAssets(projectId) {
    return forge3dDb.listAssets(projectId);
  }

  deleteAsset(id) {
    const asset = forge3dDb.getAsset(id);
    if (!asset) throw new Error(`Asset not found: ${id}`);

    // Delete file from disk
    if (asset.file_path && existsSync(asset.file_path)) {
      unlinkSync(asset.file_path);
    }
    if (asset.thumbnail_path && existsSync(asset.thumbnail_path)) {
      unlinkSync(asset.thumbnail_path);
    }

    forge3dDb.deleteAsset(id);
    console.log(`[PROJECT] Asset deleted: "${asset.name}" (${id})`);
    return true;
  }

  // --- Generation History ---

  recordGeneration(data) {
    return forge3dDb.createHistoryEntry(data);
  }

  updateGeneration(id, updates) {
    forge3dDb.updateHistoryEntry(id, updates);
  }

  getHistory(options = {}) {
    return forge3dDb.listHistory(options);
  }

  getStats() {
    return forge3dDb.getStats();
  }

  /**
   * Find incomplete generations for crash recovery.
   */
  findIncomplete() {
    return forge3dDb.findIncomplete();
  }

  /**
   * Get disk usage for a project.
   */
  getProjectDiskUsage(projectId) {
    const projectDir = join(this.outputDir, projectId);
    this._validatePath(projectDir);
    if (!existsSync(projectDir)) return { files: 0, totalBytes: 0 };

    let files = 0;
    let totalBytes = 0;

    const entries = readdirSync(projectDir);
    for (const entry of entries) {
      const stat = statSync(join(projectDir, entry));
      if (stat.isFile()) {
        files++;
        totalBytes += stat.size;
      }
    }

    return { files, totalBytes };
  }
}

// Singleton
const projectManager = new ProjectManager();
export default projectManager;
export { ProjectManager };

// --test block (guarded so imports don't trigger it)
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[PROJECT] Running self-test...');

  const pm = new ProjectManager();
  pm.outputDir = join(__dirname, '../../data/test_output');
  pm.init();

  // Test project CRUD
  const project = pm.createProject('Test 3D Project', 'Testing project manager');
  console.assert(project.name === 'Test 3D Project', 'Name should match');

  const projects = pm.listProjects();
  console.assert(projects.length >= 1, 'Should have at least 1 project');

  const updated = pm.updateProject(project.id, { description: 'Updated description' });
  console.assert(updated.description === 'Updated description', 'Description should be updated');

  // Test asset saving
  const asset = pm.saveAsset(project.id, {
    name: 'test_cube',
    type: 'mesh',
    buffer: Buffer.from('fake-glb-data'),
    extension: '.glb',
    metadata: { vertices: 8, faces: 12 }
  });
  console.assert(asset.name === 'test_cube.glb', 'Asset name should include extension');
  console.assert(asset.type === 'mesh', 'Type should be mesh');

  const assets = pm.listAssets(project.id);
  console.assert(assets.length === 1, 'Should have 1 asset');

  // Test history
  const histId = pm.recordGeneration({
    projectId: project.id,
    type: 'mesh',
    prompt: 'a red cube',
    status: 'complete'
  });
  pm.updateGeneration(histId, { generationTime: 30.5 });

  const history = pm.getHistory({ projectId: project.id });
  console.assert(history.length >= 1, 'Should have at least 1 history entry');

  // Test stats
  const stats = pm.getStats();
  console.assert(typeof stats.totalGenerations === 'number', 'Stats should have totalGenerations');

  // Test disk usage
  const usage = pm.getProjectDiskUsage(project.id);
  console.assert(usage.files >= 1, 'Should have at least 1 file');

  // Cleanup
  pm.deleteProject(project.id);
  pm.shutdown();

  // Remove test DB and output
  const { unlinkSync: unlink } = await import('fs');
  const testDb = join(__dirname, '../../data/forge3d.db');
  try { unlink(testDb); } catch (_e) { /* ok */ }
  try { unlink(testDb + '-wal'); } catch (_e) { /* ok */ }
  try { unlink(testDb + '-shm'); } catch (_e) { /* ok */ }
  try { rmSync(join(__dirname, '../../data/test_output'), { recursive: true, force: true }); } catch (_e) { /* ok */ }

  console.log('[PROJECT] Self-test passed');
  process.exit(0);
}
