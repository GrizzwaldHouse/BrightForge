/**
 * quality-gates.js - Deterministic tests for the UV and mesh-quality gates.
 *
 * The Python bridge is stubbed, so these tests check the Node gate logic:
 * a gate passes only on measured evidence, and missing or unverified
 * evidence fails (review findings P1, 2026-11-07). Real geometry
 * measurements are covered by python/tests/test_mesh_quality.py.
 *
 * Run: node src/tests/quality-gates.js
 */

import modelBridge from '../forge3d/model-bridge.js';
import * as validateUvs from '../forge3d/pipeline/stages/validate-uvs.js';
import * as qualityCheck from '../forge3d/pipeline/stages/quality-check.js';
import { isMainModule } from '../core/is-main-module.js';

const MESH = Buffer.from('fixture-mesh');
const UNWRAPPED = Buffer.from('fixture-unwrapped');
const MEASURED_OK = {
  success: true, face_count: 12, vertex_count: 8, is_manifold: true, is_watertight: true,
  topology: { status: 'measured', boundary_edges: 0, non_manifold_edges: 0, degenerate_faces: 0, duplicate_faces: 0 }
};

export async function runQualityGateTests(log = console.log) {
  let passed = 0;
  let failed = 0;
  const check = (cond, label) => { if (cond) { passed++; log(`  PASS: ${label}`); } else { failed++; log(`  FAIL: ${label}`); } };
  const saved = { state: modelBridge.state, validateUVs: modelBridge.validateUVs, autoUnwrapUVs: modelBridge.autoUnwrapUVs, getMeshReport: modelBridge.getMeshReport };
  modelBridge.state = 'running';

  try {
    log('\n[1] UV gate');
    modelBridge.validateUVs = async (buf) => (buf === UNWRAPPED ? { has_uvs: false } : { has_uvs: false });
    modelBridge.autoUnwrapUVs = async () => MESH; // returns the input unchanged (old placeholder behaviour)
    let r = await validateUvs.execute({ meshBuffer: MESH }, { auto_unwrap: true, required: true });
    check(r.success === false, 'unwrap that returns no UVs fails a required gate');

    const ctx = { meshBuffer: MESH };
    r = await validateUvs.execute(ctx, { auto_unwrap: true, required: false });
    check(r.success === true && ctx.uvValid === false && r.result.has_uvs === false, 'unverified unwrap never sets uvValid in graceful mode');

    modelBridge.autoUnwrapUVs = async () => { throw new Error('Auto UV unwrap failed: xatlas is not installed'); };
    r = await validateUvs.execute({ meshBuffer: MESH }, { auto_unwrap: true, required: true });
    check(r.success === false, 'unsupported unwrap (501) fails a required gate');

    modelBridge.autoUnwrapUVs = async () => UNWRAPPED;
    modelBridge.validateUVs = async (buf) => (buf === UNWRAPPED
      ? { has_uvs: true, uv_count: 24, overlap: { status: 'measured', max_overlap_ratio: 0 } }
      : { has_uvs: false });
    const ok = { meshBuffer: MESH };
    r = await validateUvs.execute(ok, { auto_unwrap: true, required: true });
    check(r.success === true && ok.uvValid === true && ok.meshBuffer === UNWRAPPED && r.result.uv_count === 24, 'verified unwrap passes and replaces the mesh');

    log('\n[2] Mesh quality gate');
    const gate = async (report, cfg) => { modelBridge.getMeshReport = async () => report; return qualityCheck.execute({ meshBuffer: MESH }, cfg); };
    check((await gate(MEASURED_OK, { require_manifold: true, require_watertight: true })).success === true, 'measured manifold watertight mesh passes');
    const { is_manifold: _m, ...noManifold } = MEASURED_OK;
    check((await gate(noManifold, { require_manifold: true })).success === false, 'missing is_manifold fails when required');
    check((await gate({ ...MEASURED_OK, topology: { status: 'partial' } }, { require_manifold: true })).success === false, 'unmeasured topology fails when required');
    check((await gate({ ...MEASURED_OK, is_manifold: false, topology: { ...MEASURED_OK.topology, non_manifold_edges: 1 } }, { require_manifold: true })).success === false, 'non-manifold mesh fails');
    check((await gate({ ...MEASURED_OK, is_watertight: false, topology: { ...MEASURED_OK.topology, boundary_edges: 4 } }, { require_watertight: true })).success === false, 'open mesh fails a watertight requirement');
    check((await gate({ success: false, error: 'load failed' }, {})).success === false, 'failed report never passes');
    check((await gate({ ...MEASURED_OK, topology: { ...MEASURED_OK.topology, degenerate_faces: 2 } }, { reject_degenerate: true })).success === false, 'degenerate faces fail when rejected');
  } finally {
    Object.assign(modelBridge, saved);
  }

  log(`\n[QUALITY-GATES] ${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (isMainModule(import.meta.url)) {
  runQualityGateTests().then((ok) => process.exit(ok ? 0 : 1), (err) => {
    console.error('[QUALITY-GATES] Crashed:', err);
    process.exit(1);
  });
}
