"""Mesh quality measurement tests (CPU only, no torch required).

The review's bounded experiment (2026-11-07): one closed triangulated cube
plus controlled derivatives, each changing one defect condition:
  - baseline cube: manifold, watertight, no degenerate or duplicate faces
  - extra triangle on an existing edge: non-manifold edge detected
  - one face removed: open boundary, manifold but not watertight
  - no UV layer: has_uvs False, reported as absent (not success)
  - xatlas unwrap: produces UVs that re-validate as measured

Run: python -m unittest discover -s python/tests -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python'))

import numpy as np  # noqa: E402
import trimesh  # noqa: E402
import mesh_quality as mq  # noqa: E402


def cube():
    return trimesh.creation.box(extents=[1.0, 1.0, 1.0])


class TopologyTests(unittest.TestCase):
    def test_baseline_cube_is_manifold_and_watertight(self):
        r = mq.topology_report(cube())
        self.assertEqual(r['status'], 'measured')
        self.assertTrue(r['is_manifold'])
        self.assertTrue(r['is_watertight'])
        self.assertEqual(r['boundary_edges'], 0)
        self.assertEqual(r['non_manifold_edges'], 0)
        self.assertEqual(r['degenerate_faces'], 0)
        self.assertEqual(r['duplicate_faces'], 0)

    def test_edge_shared_by_three_faces_is_non_manifold(self):
        m = cube()
        a, b = m.faces[0][0], m.faces[0][1]
        extra_vertex = len(m.vertices)
        vertices = np.vstack([m.vertices, [[0.0, 0.0, 2.0]]])
        faces = np.vstack([m.faces, [[a, b, extra_vertex]]])
        r = mq.topology_report(trimesh.Trimesh(vertices=vertices, faces=faces, process=False))
        self.assertGreaterEqual(r['non_manifold_edges'], 1)
        self.assertFalse(r['is_manifold'])
        self.assertFalse(r['is_watertight'])

    def test_missing_face_is_open_not_watertight(self):
        m = cube()
        r = mq.topology_report(trimesh.Trimesh(vertices=m.vertices, faces=m.faces[1:], process=False))
        self.assertTrue(r['is_manifold'])
        self.assertFalse(r['is_watertight'])
        self.assertEqual(r['boundary_edges'], 3)

    def test_degenerate_and_duplicate_faces_are_counted(self):
        m = cube()
        faces = np.vstack([m.faces, m.faces[:1], [[0, 0, 1]]])
        r = mq.topology_report(trimesh.Trimesh(vertices=m.vertices, faces=faces, process=False))
        self.assertGreaterEqual(r['duplicate_faces'], 1)
        self.assertGreaterEqual(r['degenerate_faces'], 1)

    def test_uv_seams_do_not_count_as_holes(self):
        unwrapped = mq.unwrap(cube())
        self.assertGreater(len(unwrapped.vertices), 8)  # seams split vertices
        self.assertTrue(mq.topology_report(unwrapped)['is_watertight'])


class UvTests(unittest.TestCase):
    def test_no_uv_layer_is_absent(self):
        r = mq.uv_report(cube())
        self.assertFalse(r['has_uvs'])
        self.assertEqual(r['geometries']['mesh']['status'], 'absent')
        self.assertEqual(r['overlap']['status'], 'absent')

    def test_unwrap_produces_measured_uvs(self):
        r = mq.uv_report(mq.unwrap(cube()))
        self.assertTrue(r['has_uvs'])
        self.assertEqual(r['overlap']['status'], 'measured')
        self.assertLess(r['overlap']['max_overlap_ratio'], 0.01)
        geo = r['geometries']['mesh']
        self.assertTrue(geo['uv_finite'])
        self.assertEqual(geo['texel_density']['status'], 'measured')

    def test_overlapping_uvs_are_detected(self):
        m = cube()
        uv = np.tile(np.array([[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]), (len(m.vertices) // 3 + 1, 1))[:len(m.vertices)]
        m.visual = trimesh.visual.TextureVisuals(uv=uv)
        r = mq.uv_report(m)
        self.assertGreater(r['overlap']['max_overlap_ratio'], 0.0)

    def test_overlap_beyond_face_limit_is_unknown(self):
        original = mq.QUALITY_DEFAULTS['uv_overlap_max_faces']
        mq._CONFIG.setdefault('quality', {})
        saved = mq._CONFIG['quality'].get('uv_overlap_max_faces')
        mq._CONFIG['quality']['uv_overlap_max_faces'] = 1
        try:
            r = mq.uv_report(mq.unwrap(cube()))
            self.assertEqual(r['overlap']['status'], 'unknown')
        finally:
            if saved is None:
                mq._CONFIG['quality'].pop('uv_overlap_max_faces', None)
            else:
                mq._CONFIG['quality']['uv_overlap_max_faces'] = saved
        self.assertEqual(mq.QUALITY_DEFAULTS['uv_overlap_max_faces'], original)

    def test_glb_round_trip_keeps_unwrapped_uvs(self):
        import tempfile
        import os
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'u.glb')
            mq.unwrap(cube()).export(path, file_type='glb')
            r = mq.uv_report(trimesh.load(path))
            self.assertTrue(r['has_uvs'])


if __name__ == '__main__':
    unittest.main()
