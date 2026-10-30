"""Mesh post-processing regression tests (CPU only, no torch required).

Covers ModelManager.optimize_mesh and generate_lod_chain against a small,
deterministic fixture (test/fixtures/cube.glb subdivided to 768 faces):

- decimation actually reduces faces (trimesh >= 4 reads the first positional
  argument as `percent`, so the face count must be passed by name)
- the output file exists, parses, has finite coordinates and sane bounds
- when no reduction is needed the requested output file is still written
- LOD levels are written and get smaller

Run: python -m unittest discover -s python/tests -v
Requires: trimesh, numpy, pyyaml, fast-simplification
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python'))

import numpy as np  # noqa: E402
import trimesh  # noqa: E402
import model_manager as mm  # noqa: E402

FIXTURE = ROOT / 'test' / 'fixtures' / 'cube.glb'


def _manager():
    cls = getattr(mm, 'ModelManager', None)
    return cls() if cls else mm.model_manager


class MeshPostprocessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = Path(tempfile.mkdtemp(prefix='bf-mesh-'))
        dense = trimesh.load(str(FIXTURE), force='mesh').subdivide().subdivide().subdivide()
        cls.dense_path = cls.work / 'dense.glb'
        dense.export(str(cls.dense_path))
        cls.dense_faces = len(dense.faces)
        cls.mgr = _manager()

    def _assert_valid_mesh(self, path):
        self.assertTrue(path.exists(), f'{path} was not written')
        self.assertGreater(path.stat().st_size, 0)
        mesh = trimesh.load(str(path), force='mesh')
        self.assertGreater(len(mesh.vertices), 0)
        self.assertGreater(len(mesh.faces), 0)
        self.assertTrue(np.isfinite(mesh.vertices).all(), 'non-finite coordinates')
        extents = mesh.bounding_box.extents
        self.assertTrue((extents > 0).all() and (extents < 10).all(), f'unexpected bounds {extents}')
        return mesh

    def test_fixture_is_dense(self):
        self.assertEqual(self.dense_faces, 768)

    def test_optimize_reduces_faces(self):
        out = self.work / 'optimized.glb'
        res = self.mgr.optimize_mesh(str(self.dense_path), 100, str(out))
        self.assertTrue(res['success'], res.get('error'))
        self.assertFalse(res['skipped'])
        mesh = self._assert_valid_mesh(out)
        self.assertLess(len(mesh.faces), self.dense_faces)
        self.assertLessEqual(len(mesh.faces), 120)
        self.assertEqual(res['optimized_faces'], len(mesh.faces))
        self.assertEqual(Path(res['output_path']), out)

    def test_skip_still_writes_output(self):
        out = self.work / 'skipped.glb'
        res = self.mgr.optimize_mesh(str(self.dense_path), 5000, str(out))
        self.assertTrue(res['success'], res.get('error'))
        self.assertTrue(res['skipped'])
        self.assertEqual(Path(res['output_path']), out)
        self._assert_valid_mesh(out)

    def test_lod_levels_shrink(self):
        out_dir = self.work / 'lods'
        res = self.mgr.generate_lod_chain(str(self.dense_path), str(out_dir))
        self.assertTrue(res['success'], res.get('error'))
        faces = [lvl['faces'] for lvl in res['levels']]
        self.assertGreaterEqual(len(faces), 2)
        self.assertEqual(faces, sorted(faces, reverse=True))
        self.assertLess(faces[-1], faces[0])
        for lvl in res['levels']:
            self._assert_valid_mesh(Path(lvl['path']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
