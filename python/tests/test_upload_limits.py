"""Upload limits in config.yaml must admit the meshes the pipeline produces.

A Hunyuan3D shape is about 28 MB before optimization; the optimize stage
failed on it when mesh uploads shared the 20 MB image limit (2026-11-08).
"""
import os
import unittest

import yaml

CONFIG = os.path.join(os.path.dirname(__file__), '..', 'config.yaml')
# Largest raw generator output observed so far, with headroom.
OBSERVED_MESH_BYTES = 28 * 1024 * 1024


class UploadLimitTests(unittest.TestCase):
    def setUp(self):
        with open(CONFIG, encoding='utf-8') as f:
            self.gen = yaml.safe_load(f)['generation']

    def test_mesh_limit_exists_and_admits_generated_meshes(self):
        self.assertIn('max_mesh_upload_size_bytes', self.gen)
        self.assertGreater(self.gen['max_mesh_upload_size_bytes'], OBSERVED_MESH_BYTES)

    def test_mesh_limit_not_smaller_than_image_limit(self):
        self.assertGreaterEqual(self.gen['max_mesh_upload_size_bytes'], self.gen['max_upload_size_bytes'])


if __name__ == '__main__':
    unittest.main()
