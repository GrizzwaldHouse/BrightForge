"""
ForgePipeline Material Extractor

Extracts PBR textures from GLB files and generates UE5 material manifests.
Uses pygltflib for GLB parsing and Pillow for texture channel splitting.
"""

import os
import json
import logging
import yaml
from pathlib import Path

logger = logging.getLogger('forge3d.material_extractor')

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


class MaterialExtractor:
    """Extracts PBR materials and textures from GLB files for UE5 import."""

    def __init__(self):
        self._pygltflib_available = False
        self._pillow_available = False
        self._detect_dependencies()

    def _detect_dependencies(self):
        """Detect availability of required libraries."""
        try:
            import pygltflib
            self._pygltflib_available = True
            logger.info('[MATERIAL] pygltflib available')
        except ImportError:
            logger.warning('[MATERIAL] pygltflib not installed. Material extraction disabled.')

        try:
            from PIL import Image
            self._pillow_available = True
            logger.info('[MATERIAL] Pillow available')
        except ImportError:
            logger.warning('[MATERIAL] Pillow not installed. Channel splitting disabled.')

    def is_available(self):
        """Check if pygltflib is installed and material extraction is possible."""
        return self._pygltflib_available

    def extract_from_glb(self, glb_path, output_dir):
        """Extract all textures from a GLB file.

        Uses pygltflib to parse the GLB binary, find embedded textures,
        and write them to output_dir as separate files.

        Args:
            glb_path: Path to input .glb file
            output_dir: Directory to write extracted textures

        Returns:
            dict with keys: success, textures (list of paths), materials (list of material defs), error
        """
        result = {
            'success': False,
            'textures': [],
            'materials': [],
            'error': None,
        }

        if not self._pygltflib_available:
            result['error'] = 'pygltflib not installed'
            return result

        glb_path = Path(glb_path)
        output_dir = Path(output_dir)

        if not glb_path.exists():
            result['error'] = f'Input file not found: {glb_path}'
            return result

        output_dir.mkdir(parents=True, exist_ok=True)

        try:
            import pygltflib

            gltf = pygltflib.GLTF2.load(str(glb_path))
            blob = gltf.binary_blob()

            # Build accessor for buffer views -> texture data
            texture_paths = {}

            for idx, image_def in enumerate(gltf.images or []):
                if image_def.bufferView is not None and blob is not None:
                    buffer_view = gltf.bufferViews[image_def.bufferView]
                    offset = buffer_view.byteOffset or 0
                    length = buffer_view.byteLength
                    image_data = blob[offset:offset + length]

                    # Determine extension from MIME type
                    mime = image_def.mimeType or 'image/png'
                    ext = '.png' if 'png' in mime else '.jpg'
                    name = image_def.name or f'texture_{idx}'
                    # Sanitize filename
                    safe_name = ''.join(c if c.isalnum() or c in '-_' else '_' for c in name)
                    filename = f'{safe_name}{ext}'
                    out_path = output_dir / filename

                    out_path.write_bytes(image_data)
                    texture_paths[idx] = str(out_path)
                    result['textures'].append(str(out_path))
                    logger.info(f'[MATERIAL] Extracted texture: {filename} ({length} bytes)')

            # Parse materials
            for mat_idx, material in enumerate(gltf.materials or []):
                mat_def = {
                    'index': mat_idx,
                    'name': material.name or f'Material_{mat_idx}',
                    'baseColorFactor': [1.0, 1.0, 1.0, 1.0],
                    'metallicFactor': 1.0,
                    'roughnessFactor': 1.0,
                    'emissiveFactor': [0.0, 0.0, 0.0],
                    'baseColorTexture': None,
                    'normalTexture': None,
                    'metallicRoughnessTexture': None,
                    'emissiveTexture': None,
                    'occlusionTexture': None,
                }

                pbr = material.pbrMetallicRoughness
                if pbr:
                    if pbr.baseColorFactor is not None:
                        mat_def['baseColorFactor'] = list(pbr.baseColorFactor)
                    if pbr.metallicFactor is not None:
                        mat_def['metallicFactor'] = pbr.metallicFactor
                    if pbr.roughnessFactor is not None:
                        mat_def['roughnessFactor'] = pbr.roughnessFactor

                    # Resolve texture paths
                    if pbr.baseColorTexture is not None:
                        tex_idx = self._resolve_texture_image(gltf, pbr.baseColorTexture.index)
                        mat_def['baseColorTexture'] = texture_paths.get(tex_idx)
                    if pbr.metallicRoughnessTexture is not None:
                        tex_idx = self._resolve_texture_image(gltf, pbr.metallicRoughnessTexture.index)
                        mat_def['metallicRoughnessTexture'] = texture_paths.get(tex_idx)

                if material.normalTexture is not None:
                    tex_idx = self._resolve_texture_image(gltf, material.normalTexture.index)
                    mat_def['normalTexture'] = texture_paths.get(tex_idx)

                if material.emissiveTexture is not None:
                    tex_idx = self._resolve_texture_image(gltf, material.emissiveTexture.index)
                    mat_def['emissiveTexture'] = texture_paths.get(tex_idx)

                if material.emissiveFactor is not None:
                    mat_def['emissiveFactor'] = list(material.emissiveFactor)

                if material.occlusionTexture is not None:
                    tex_idx = self._resolve_texture_image(gltf, material.occlusionTexture.index)
                    mat_def['occlusionTexture'] = texture_paths.get(tex_idx)

                result['materials'].append(mat_def)
                logger.info(f'[MATERIAL] Parsed material: {mat_def["name"]}')

            result['success'] = True

        except Exception as e:
            result['error'] = f'GLB extraction failed: {str(e)}'
            logger.error(f'[MATERIAL] Extraction error: {e}')

        return result

    def _resolve_texture_image(self, gltf, texture_index):
        """Resolve a texture index to its source image index.

        Args:
            gltf: The loaded GLTF2 object
            texture_index: Index into gltf.textures

        Returns:
            Image index (int) or None
        """
        if texture_index is None:
            return None
        textures = gltf.textures or []
        if texture_index < len(textures):
            return textures[texture_index].source
        return None

    def split_orm_texture(self, orm_path, output_dir):
        """Split a packed ORM (Occlusion-Roughness-Metallic) texture into separate channels.

        glTF packs: R=AO, G=Roughness, B=Metallic into one image.
        UE5 needs them as separate grayscale images.

        Args:
            orm_path: Path to the packed ORM texture
            output_dir: Directory to write split channels

        Returns:
            dict with keys: success, ao_path, roughness_path, metallic_path, error
        """
        result = {
            'success': False,
            'ao_path': None,
            'roughness_path': None,
            'metallic_path': None,
            'error': None,
        }

        if not self._pillow_available:
            result['error'] = 'Pillow not installed'
            return result

        orm_path = Path(orm_path)
        output_dir = Path(output_dir)

        if not orm_path.exists():
            result['error'] = f'ORM texture not found: {orm_path}'
            return result

        output_dir.mkdir(parents=True, exist_ok=True)

        try:
            from PIL import Image

            img = Image.open(str(orm_path))

            # Ensure RGB (or RGBA — we only need first 3 channels)
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGB')

            channels = img.split()
            # R = Ambient Occlusion, G = Roughness, B = Metallic
            ao_channel = channels[0]
            roughness_channel = channels[1]
            metallic_channel = channels[2]

            stem = orm_path.stem

            ao_path = output_dir / f'{stem}_ao.png'
            roughness_path = output_dir / f'{stem}_roughness.png'
            metallic_path = output_dir / f'{stem}_metallic.png'

            ao_channel.save(str(ao_path))
            roughness_channel.save(str(roughness_path))
            metallic_channel.save(str(metallic_path))

            result['success'] = True
            result['ao_path'] = str(ao_path)
            result['roughness_path'] = str(roughness_path)
            result['metallic_path'] = str(metallic_path)

            logger.info(f'[MATERIAL] Split ORM texture: {orm_path.name} -> ao, roughness, metallic')

        except Exception as e:
            result['error'] = f'ORM split failed: {str(e)}'
            logger.error(f'[MATERIAL] ORM split error: {e}')

        return result

    def generate_ue5_manifest(self, glb_path, preset_name='ue5-standard'):
        """Generate a UE5 material manifest JSON from a GLB file.

        Creates a JSON sidecar that describes materials in UE5 terms:
        shading model, texture paths, material parameter values.

        Args:
            glb_path: Path to input .glb file
            preset_name: Material preset from config (ue5-standard, ue5-metallic, ue5-clay)

        Returns:
            dict with: success, manifest (the material data dict), error
        """
        result = {
            'success': False,
            'manifest': None,
            'error': None,
        }

        glb_path = Path(glb_path)
        if not glb_path.exists():
            result['error'] = f'Input file not found: {glb_path}'
            return result

        # Load preset from config
        presets = CONFIG.get('material_presets', {})
        preset = presets.get(preset_name)
        if preset is None:
            available = list(presets.keys()) if presets else []
            result['error'] = f'Unknown preset: {preset_name}. Available: {available}'
            return result

        try:
            # Extract materials from the GLB (uses a temp dir for textures)
            output_dir = glb_path.parent / f'{glb_path.stem}_materials'
            extraction = self.extract_from_glb(str(glb_path), str(output_dir))

            manifest = {
                'source_file': str(glb_path),
                'preset': preset_name,
                'shading_model': preset.get('shading_model', 'DefaultLit'),
                'materials': [],
            }

            if extraction['success'] and extraction['materials']:
                for mat_def in extraction['materials']:
                    ue5_material = {
                        'name': mat_def['name'],
                        'shading_model': preset.get('shading_model', 'DefaultLit'),
                        'base_color': mat_def['baseColorFactor'][:3],
                        'metallic': mat_def['metallicFactor'],
                        'roughness': mat_def['roughnessFactor'],
                        'emissive': mat_def['emissiveFactor'],
                        'textures': {
                            'base_color': mat_def.get('baseColorTexture'),
                            'normal': mat_def.get('normalTexture'),
                            'metallic_roughness': mat_def.get('metallicRoughnessTexture'),
                            'emissive': mat_def.get('emissiveTexture'),
                            'occlusion': mat_def.get('occlusionTexture'),
                        },
                    }
                    manifest['materials'].append(ue5_material)
            else:
                # No materials found in GLB — create a default material from the preset
                manifest['materials'].append({
                    'name': 'DefaultMaterial',
                    'shading_model': preset.get('shading_model', 'DefaultLit'),
                    'base_color': preset.get('base_color', [0.8, 0.8, 0.8]),
                    'metallic': preset.get('metallic', 0.0),
                    'roughness': preset.get('roughness', 0.5),
                    'emissive': preset.get('emissive', [0.0, 0.0, 0.0]),
                    'textures': {
                        'base_color': None,
                        'normal': None,
                        'metallic_roughness': None,
                        'emissive': None,
                        'occlusion': None,
                    },
                })

            # Write manifest JSON sidecar
            manifest_path = glb_path.with_suffix('.material.json')
            with open(str(manifest_path), 'w') as f:
                json.dump(manifest, f, indent=2)
            logger.info(f'[MATERIAL] Wrote manifest: {manifest_path.name}')

            result['success'] = True
            result['manifest'] = manifest
            result['manifest_path'] = str(manifest_path)

        except Exception as e:
            result['error'] = f'Manifest generation failed: {str(e)}'
            logger.error(f'[MATERIAL] Manifest error: {e}')

        return result

    def get_material_presets(self):
        """Return available material preset names from config."""
        presets = CONFIG.get('material_presets', {})
        return list(presets.keys())

    def get_status(self):
        """Return availability info."""
        status = {
            'available': self.is_available(),
            'pygltflib_installed': self._pygltflib_available,
            'pillow_installed': self._pillow_available,
            'presets': self.get_material_presets(),
        }

        if self._pygltflib_available:
            try:
                import pygltflib
                status['pygltflib_version'] = getattr(pygltflib, '__version__', 'unknown')
            except ImportError:
                status['pygltflib_version'] = 'not installed'

        return status


# Singleton
material_extractor = MaterialExtractor()


# --- Self-test ---
if __name__ == '__main__':
    import sys
    import argparse

    parser = argparse.ArgumentParser(description='Material Extractor Test')
    parser.add_argument('--test', action='store_true', help='Run self-tests')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(message)s')

    if args.test or '--test' in sys.argv:
        import tempfile

        print('\n=== Material Extractor Self-Test ===\n')
        passed = 0
        failed = 0

        # Test 1: Status check
        print('[TEST 1] Dependency detection...')
        status = material_extractor.get_status()
        print(f'  pygltflib: {status["pygltflib_installed"]}')
        print(f'  Pillow: {status["pillow_installed"]}')
        print(f'  Available: {status["available"]}')
        print(f'  Presets: {status["presets"]}')
        passed += 1
        print('  PASSED\n')

        # Test 2: Extract from synthetic GLB (cube — no materials expected)
        print('[TEST 2] Extract from synthetic GLB...')
        try:
            import trimesh

            mesh = trimesh.creation.box(extents=[1.0, 1.0, 1.0])

            with tempfile.TemporaryDirectory() as tmpdir:
                glb_path = os.path.join(tmpdir, 'test_cube.glb')
                out_dir = os.path.join(tmpdir, 'textures')

                mesh.export(glb_path, file_type='glb')
                print(f'  Created test GLB: {os.path.getsize(glb_path)} bytes')

                result = material_extractor.extract_from_glb(glb_path, out_dir)
                print(f'  Success: {result["success"]}')
                print(f'  Textures found: {len(result["textures"])}')
                print(f'  Materials found: {len(result["materials"])}')

                if result['success']:
                    passed += 1
                    print('  PASSED\n')
                elif not material_extractor.is_available():
                    print('  SKIPPED (pygltflib not installed)\n')
                else:
                    failed += 1
                    print(f'  FAILED: {result["error"]}\n')

        except ImportError as e:
            print(f'  SKIPPED (missing dependency: {e})\n')

        # Test 3: Split ORM texture with synthetic image
        print('[TEST 3] ORM texture channel splitting...')
        if material_extractor._pillow_available:
            try:
                from PIL import Image

                with tempfile.TemporaryDirectory() as tmpdir:
                    # Create a synthetic ORM image (R=128, G=64, B=200)
                    img = Image.new('RGB', (64, 64), (128, 64, 200))
                    orm_path = os.path.join(tmpdir, 'test_orm.png')
                    img.save(orm_path)

                    result = material_extractor.split_orm_texture(orm_path, tmpdir)
                    print(f'  Success: {result["success"]}')

                    if result['success']:
                        # Verify the split channels exist and have correct values
                        ao_img = Image.open(result['ao_path'])
                        roughness_img = Image.open(result['roughness_path'])
                        metallic_img = Image.open(result['metallic_path'])

                        ao_pixel = ao_img.getpixel((0, 0))
                        roughness_pixel = roughness_img.getpixel((0, 0))
                        metallic_pixel = metallic_img.getpixel((0, 0))

                        print(f'  AO channel pixel: {ao_pixel} (expected ~128)')
                        print(f'  Roughness channel pixel: {roughness_pixel} (expected ~64)')
                        print(f'  Metallic channel pixel: {metallic_pixel} (expected ~200)')

                        if ao_pixel == 128 and roughness_pixel == 64 and metallic_pixel == 200:
                            passed += 1
                            print('  PASSED\n')
                        else:
                            failed += 1
                            print('  FAILED: pixel values do not match\n')
                    else:
                        failed += 1
                        print(f'  FAILED: {result["error"]}\n')

            except Exception as e:
                failed += 1
                print(f'  FAILED: {e}\n')
        else:
            print('  SKIPPED (Pillow not installed)\n')

        # Test 4: Generate UE5 manifest
        print('[TEST 4] UE5 manifest generation...')
        presets = material_extractor.get_material_presets()
        if presets:
            try:
                import trimesh

                mesh = trimesh.creation.box(extents=[1.0, 1.0, 1.0])

                with tempfile.TemporaryDirectory() as tmpdir:
                    glb_path = os.path.join(tmpdir, 'test_manifest.glb')
                    mesh.export(glb_path, file_type='glb')

                    result = material_extractor.generate_ue5_manifest(glb_path, presets[0])
                    print(f'  Preset: {presets[0]}')
                    print(f'  Success: {result["success"]}')

                    if result['success'] and result['manifest']:
                        manifest = result['manifest']
                        print(f'  Shading model: {manifest["shading_model"]}')
                        print(f'  Materials in manifest: {len(manifest["materials"])}')
                        passed += 1
                        print('  PASSED\n')
                    elif not material_extractor.is_available():
                        print('  SKIPPED (pygltflib not installed)\n')
                    else:
                        failed += 1
                        print(f'  FAILED: {result["error"]}\n')

            except ImportError as e:
                print(f'  SKIPPED (missing dependency: {e})\n')
        else:
            print('  SKIPPED (no presets in config)\n')

        # Test 5: Non-existent file handling
        print('[TEST 5] Non-existent file handling...')
        result = material_extractor.extract_from_glb('/nonexistent/file.glb', '/tmp/out')
        if not result['success'] and 'not found' in (result['error'] or '').lower():
            passed += 1
            print('  PASSED\n')
        elif not material_extractor.is_available():
            print('  SKIPPED (pygltflib not installed)\n')
        else:
            failed += 1
            print(f'  FAILED: {result}\n')

        print(f'=== Results: {passed} passed, {failed} failed ===')
        sys.exit(1 if failed > 0 else 0)
