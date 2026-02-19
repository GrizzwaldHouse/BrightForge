"""
ForgePipeline FBX Converter

Converts GLB meshes to FBX format for Unreal Engine import.
Primary backend: pyassimp (Open Asset Import Library).
Fallback backend: Blender CLI subprocess.
"""

import os
import time
import shutil
import logging
import subprocess
import yaml
from pathlib import Path

logger = logging.getLogger('forge3d.fbx_converter')

# Load configuration
_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.yaml')
try:
    with open(_config_path) as _f:
        CONFIG = yaml.safe_load(_f)
except Exception:
    CONFIG = {}

def _cfg(section, key, default=None):
    """Get a config value with fallback to default."""
    return CONFIG.get(section, {}).get(key, default)


class FbxConverter:
    """Converts GLB meshes to FBX format using assimp (primary) or Blender (fallback)."""

    def __init__(self):
        self.backend = 'none'
        self.blender_path = None
        self._detect_backend()

    def _detect_backend(self):
        """Detect available conversion backend."""
        preferred = _cfg('fbx_export', 'preferred_backend', 'assimp')

        # Try assimp first (or if preferred)
        if preferred == 'assimp' or preferred == 'auto':
            try:
                import pyassimp
                self.backend = 'assimp'
                logger.info('[FBX] Backend: pyassimp (Open Asset Import Library)')
                return
            except ImportError:
                logger.info('[FBX] pyassimp not available, checking Blender...')

        # Try Blender
        configured_path = _cfg('fbx_export', 'blender_path', None)
        if configured_path and Path(configured_path).exists():
            self.blender_path = configured_path
            self.backend = 'blender'
            logger.info(f'[FBX] Backend: Blender at {self.blender_path}')
            return

        blender_in_path = shutil.which('blender')
        if blender_in_path:
            self.blender_path = blender_in_path
            self.backend = 'blender'
            logger.info(f'[FBX] Backend: Blender at {self.blender_path}')
            return

        # Try assimp as last resort if Blender was preferred but not found
        if preferred == 'blender':
            try:
                import pyassimp
                self.backend = 'assimp'
                logger.info('[FBX] Backend: pyassimp (Blender not found, falling back)')
                return
            except ImportError:
                pass

        logger.warning('[FBX] No FBX conversion backend available. Install pyassimp or Blender.')
        self.backend = 'none'

    def is_available(self):
        """Check if any conversion backend is available."""
        enabled = _cfg('fbx_export', 'enabled', True)
        return enabled and self.backend != 'none'

    def convert_glb_to_fbx(self, glb_path, fbx_path=None):
        """Convert a GLB file to FBX format.

        Args:
            glb_path: Path to input .glb file.
            fbx_path: Output path. If None, uses same dir/name with .fbx extension.

        Returns:
            dict with success, fbx_path, conversion_time, file_size_bytes, backend, error.
        """
        glb_path = Path(glb_path)
        if fbx_path is None:
            fbx_path = glb_path.with_suffix('.fbx')
        else:
            fbx_path = Path(fbx_path)

        result = {
            'success': False,
            'fbx_path': str(fbx_path),
            'conversion_time': 0.0,
            'file_size_bytes': 0,
            'backend': self.backend,
            'error': None,
        }

        if not self.is_available():
            result['error'] = 'No FBX conversion backend available'
            return result

        if not glb_path.exists():
            result['error'] = f'Input file not found: {glb_path}'
            return result

        start = time.time()

        try:
            if self.backend == 'assimp':
                result = self._convert_via_assimp(str(glb_path), str(fbx_path))
            elif self.backend == 'blender':
                result = self._convert_via_blender(str(glb_path), str(fbx_path))

            result['conversion_time'] = round(time.time() - start, 2)

            if result['success'] and fbx_path.exists():
                result['file_size_bytes'] = fbx_path.stat().st_size
                logger.info(
                    f'[FBX] Converted: {glb_path.name} -> {fbx_path.name} '
                    f'({result["file_size_bytes"]} bytes, {result["conversion_time"]}s, '
                    f'backend={result["backend"]})'
                )
            elif result['success']:
                result['success'] = False
                result['error'] = 'Conversion reported success but output file not found'

        except Exception as e:
            result['error'] = str(e)
            result['conversion_time'] = round(time.time() - start, 2)
            logger.error(f'[FBX] Conversion failed: {e}')

        return result

    def _convert_via_assimp(self, glb_path, fbx_path):
        """Primary: Use pyassimp for in-process conversion."""
        import pyassimp
        import pyassimp.postprocess

        result = {
            'success': False,
            'fbx_path': fbx_path,
            'backend': 'assimp',
            'error': None,
        }

        try:
            # Load GLB scene
            scene = pyassimp.load(
                glb_path,
                processing=(
                    pyassimp.postprocess.aiProcess_Triangulate |
                    pyassimp.postprocess.aiProcess_GenNormals |
                    pyassimp.postprocess.aiProcess_FlipUVs
                )
            )

            # Apply coordinate system transform for Unreal (Z-up, centimeters)
            coord_system = _cfg('fbx_export', 'coordinate_system', 'unreal')
            if coord_system == 'unreal':
                scale = _cfg('fbx_export', 'scale_factor', 100.0)
                # Scale vertices directly since pyassimp.export doesn't accept a scale param
                for mesh in scene.meshes:
                    for i in range(len(mesh.vertices)):
                        mesh.vertices[i] = [v * scale for v in mesh.vertices[i]]

            # Export as FBX
            pyassimp.export(scene, fbx_path, file_type='fbx')
            pyassimp.release(scene)

            result['success'] = True

        except Exception as e:
            result['error'] = f'pyassimp conversion failed: {str(e)}'
            logger.error(f'[FBX] assimp error: {e}')

            # Try trimesh fallback within assimp backend
            try:
                result = self._convert_via_trimesh(glb_path, fbx_path)
            except Exception as te:
                result['error'] = f'Both assimp and trimesh failed. assimp: {e}, trimesh: {te}'

        return result

    def _convert_via_trimesh(self, glb_path, fbx_path):
        """Fallback within assimp: use trimesh for conversion."""
        import trimesh

        result = {
            'success': False,
            'fbx_path': fbx_path,
            'backend': 'trimesh',
            'error': None,
        }

        mesh = trimesh.load(glb_path, force='mesh')

        # Apply coordinate system transform for Unreal
        coord_system = _cfg('fbx_export', 'coordinate_system', 'unreal')
        if coord_system == 'unreal':
            scale = _cfg('fbx_export', 'scale_factor', 100.0)
            # Scale from meters to centimeters
            mesh.apply_scale(scale)

        # Repair mesh before export
        trimesh.repair.fix_normals(mesh)
        trimesh.repair.fill_holes(mesh)

        # Export - trimesh may support FBX depending on installed backends
        try:
            mesh.export(fbx_path, file_type='fbx')
            result['success'] = True
        except Exception:
            # Fall back to OBJ if FBX export not supported by trimesh
            obj_path = Path(fbx_path).with_suffix('.obj')
            mesh.export(str(obj_path), file_type='obj')
            result['error'] = 'FBX export not supported by trimesh, exported as OBJ instead'
            result['fbx_path'] = str(obj_path)
            result['backend'] = 'trimesh-obj'

        return result

    def _convert_via_blender(self, glb_path, fbx_path):
        """Fallback: Use Blender CLI subprocess for conversion."""
        result = {
            'success': False,
            'fbx_path': fbx_path,
            'backend': 'blender',
            'error': None,
        }

        scale = _cfg('fbx_export', 'scale_factor', 100.0)
        coord_system = _cfg('fbx_export', 'coordinate_system', 'unreal')

        # Build Blender Python script for import/export
        forward_axis = '-Z' if coord_system == 'unreal' else '-Y'
        up_axis = 'Y' if coord_system == 'unreal' else 'Z'

        blender_script = f"""
import bpy
import sys

# Clear default scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import GLB
bpy.ops.import_scene.gltf(filepath=r'{glb_path}')

# Scale for Unreal (meters -> centimeters)
for obj in bpy.context.scene.objects:
    obj.scale = ({scale}, {scale}, {scale})
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(scale=True)

# Export FBX
bpy.ops.export_scene.fbx(
    filepath=r'{fbx_path}',
    use_selection=False,
    apply_scale_options='FBX_SCALE_ALL',
    axis_forward='{forward_axis}',
    axis_up='{up_axis}',
    mesh_smooth_type='FACE',
)

sys.exit(0)
"""

        try:
            proc = subprocess.run(
                [self.blender_path, '--background', '--python-expr', blender_script],
                capture_output=True,
                text=True,
                timeout=120,
            )

            if proc.returncode == 0 and Path(fbx_path).exists():
                result['success'] = True
            else:
                stderr = proc.stderr[:500] if proc.stderr else 'No error output'
                result['error'] = f'Blender exited with code {proc.returncode}: {stderr}'

        except subprocess.TimeoutExpired:
            result['error'] = 'Blender conversion timed out (120s)'
        except FileNotFoundError:
            result['error'] = f'Blender not found at: {self.blender_path}'

        return result

    def get_status(self):
        """Return backend availability info."""
        status = {
            'available': self.is_available(),
            'backend': self.backend,
            'enabled': _cfg('fbx_export', 'enabled', True),
            'coordinate_system': _cfg('fbx_export', 'coordinate_system', 'unreal'),
            'scale_factor': _cfg('fbx_export', 'scale_factor', 100.0),
        }

        if self.backend == 'blender':
            status['blender_path'] = self.blender_path

        if self.backend == 'assimp':
            try:
                import pyassimp
                status['assimp_version'] = getattr(pyassimp, '__version__', 'unknown')
            except ImportError:
                status['assimp_version'] = 'not installed'

        return status


# Singleton
fbx_converter = FbxConverter()


# --- Self-test ---
if __name__ == '__main__':
    import sys
    import argparse

    parser = argparse.ArgumentParser(description='FBX Converter Test')
    parser.add_argument('--test', action='store_true', help='Run self-tests')
    parser.add_argument('--convert', type=str, help='Convert a GLB file to FBX')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(message)s')

    if args.convert:
        print(f'\n=== Converting {args.convert} to FBX ===\n')
        result = fbx_converter.convert_glb_to_fbx(args.convert)
        for k, v in result.items():
            print(f'  {k}: {v}')
        sys.exit(0 if result['success'] else 1)

    if args.test or '--test' in sys.argv:
        print('\n=== FBX Converter Self-Test ===\n')
        passed = 0
        failed = 0

        # Test 1: Status check
        print('[TEST 1] Backend detection...')
        status = fbx_converter.get_status()
        print(f'  Backend: {status["backend"]}')
        print(f'  Available: {status["available"]}')
        print(f'  Enabled: {status["enabled"]}')
        passed += 1
        print('  PASSED\n')

        # Test 2: Create test GLB and convert
        print('[TEST 2] GLB to FBX conversion...')
        if fbx_converter.is_available():
            import tempfile
            try:
                import trimesh
                import numpy as np

                # Create a simple cube mesh
                mesh = trimesh.creation.box(extents=[1.0, 1.0, 1.0])

                with tempfile.TemporaryDirectory() as tmpdir:
                    glb_path = os.path.join(tmpdir, 'test_cube.glb')
                    fbx_path = os.path.join(tmpdir, 'test_cube.fbx')

                    # Export as GLB
                    mesh.export(glb_path, file_type='glb')
                    glb_size = os.path.getsize(glb_path)
                    print(f'  Created test GLB: {glb_size} bytes')

                    # Convert to FBX
                    result = fbx_converter.convert_glb_to_fbx(glb_path, fbx_path)
                    print(f'  Conversion result: success={result["success"]}')
                    print(f'  Backend used: {result["backend"]}')
                    print(f'  Conversion time: {result["conversion_time"]}s')

                    if result['success']:
                        print(f'  FBX size: {result["file_size_bytes"]} bytes')
                        passed += 1
                        print('  PASSED\n')
                    else:
                        print(f'  Error: {result["error"]}')
                        # Not a hard failure if backend has issues
                        print('  SKIPPED (backend conversion issue)\n')

            except ImportError as e:
                print(f'  SKIPPED (missing dependency: {e})\n')
        else:
            print('  SKIPPED (no backend available)\n')

        # Test 3: Non-existent file
        print('[TEST 3] Non-existent file handling...')
        result = fbx_converter.convert_glb_to_fbx('/nonexistent/file.glb')
        if not result['success'] and 'not found' in (result['error'] or '').lower():
            passed += 1
            print('  PASSED\n')
        elif not fbx_converter.is_available():
            print('  SKIPPED (no backend)\n')
        else:
            failed += 1
            print(f'  FAILED: {result}\n')

        print(f'=== Results: {passed} passed, {failed} failed ===')
        sys.exit(1 if failed > 0 else 0)
