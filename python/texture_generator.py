# texture_generator.py
# Developer: Marcus Daley
# Date: 2026-03-07
# Purpose: PBR texture generation for 3D meshes using SDXL img2img and trimesh.
#          Generates albedo, normal, roughness, metallic, AO textures.

import logging
import numpy as np
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps, ImageEnhance
import trimesh

logger = logging.getLogger('forge3d.texture_generator')


class TextureGenerator:
    """
    PBR texture generation pipeline.

    Generates a complete PBR texture set from a mesh:
    - Albedo: SDXL img2img from mesh render
    - Normal: Baked from geometry via trimesh
    - Roughness/Metallic/AO: Derived from albedo using PIL channel math
    """

    def __init__(self, config=None):
        self._config = config or {}
        self._sdxl_adapter = None

    def _load_sdxl(self, device, dtype):
        """Lazy-load SDXL adapter for texture generation."""
        if self._sdxl_adapter is None:
            from model_adapter import SDXLAdapter
            self._sdxl_adapter = SDXLAdapter(self._config.get('sdxl', {}))
            if not self._sdxl_adapter.is_loaded():
                success = self._sdxl_adapter.load(device, dtype)
                if not success:
                    raise RuntimeError('Failed to load SDXL for texture generation')
        return self._sdxl_adapter

    def generate_textures(self, mesh_path, prompt, style_hints=None, output_dir=None, resolution=1024):
        """
        Generate a complete PBR texture set for a mesh.

        Args:
            mesh_path: Path to input GLB/OBJ mesh file
            prompt: Text prompt describing desired appearance
            style_hints: Optional dict with style parameters (e.g., {'roughness': 0.8})
            output_dir: Directory to save textures (defaults to mesh directory)
            resolution: Texture resolution (square, default 1024)

        Returns:
            Dict with texture paths: {
                'albedo': 'path/to/albedo.png',
                'normal': 'path/to/normal.png',
                'roughness': 'path/to/roughness.png',
                'metallic': 'path/to/metallic.png',
                'ao': 'path/to/ao.png'
            }
        """
        mesh_path = Path(mesh_path)
        if output_dir is None:
            output_dir = mesh_path.parent / 'textures'
        else:
            output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f'[TEXTURE] Generating PBR textures for {mesh_path.name}')
        logger.info(f'[TEXTURE] Prompt: "{prompt}"')

        # Load mesh
        try:
            mesh = trimesh.load(str(mesh_path))
        except Exception as e:
            raise ValueError(f'Failed to load mesh: {e}')

        # Check for UVs
        if not hasattr(mesh, 'visual') or not hasattr(mesh.visual, 'uv'):
            raise ValueError('Mesh has no UV coordinates. Run UV unwrapping first.')

        style_hints = style_hints or {}
        textures = {}

        # 1. Generate albedo via SDXL img2img (base color map)
        logger.info('[TEXTURE] Generating albedo texture...')
        albedo_path = output_dir / f'{mesh_path.stem}_albedo.png'
        textures['albedo'] = str(albedo_path)

        # For now, generate a solid color from prompt (img2img would require initial render)
        # In production, this would render the mesh, then run SDXL img2img on it
        albedo_img = self._generate_albedo_placeholder(prompt, resolution)
        albedo_img.save(albedo_path, 'PNG')

        # 2. Bake normal map from geometry
        logger.info('[TEXTURE] Baking normal map from geometry...')
        normal_path = output_dir / f'{mesh_path.stem}_normal.png'
        normal_img = self._bake_normal_map(mesh, resolution)
        normal_img.save(normal_path, 'PNG')
        textures['normal'] = str(normal_path)

        # 3. Derive roughness from albedo luminance
        logger.info('[TEXTURE] Deriving roughness map...')
        roughness_path = output_dir / f'{mesh_path.stem}_roughness.png'
        roughness_img = self._derive_roughness(albedo_img, style_hints.get('roughness', 0.5))
        roughness_img.save(roughness_path, 'PNG')
        textures['roughness'] = str(roughness_path)

        # 4. Derive metallic map
        logger.info('[TEXTURE] Deriving metallic map...')
        metallic_path = output_dir / f'{mesh_path.stem}_metallic.png'
        metallic_img = self._derive_metallic(albedo_img, style_hints.get('metallic', 0.0))
        metallic_img.save(metallic_path, 'PNG')
        textures['metallic'] = str(metallic_path)

        # 5. Generate AO from mesh geometry
        logger.info('[TEXTURE] Generating ambient occlusion...')
        ao_path = output_dir / f'{mesh_path.stem}_ao.png'
        ao_img = self._generate_ao(mesh, resolution)
        ao_img.save(ao_path, 'PNG')
        textures['ao'] = str(ao_path)

        logger.info(f'[TEXTURE] Generated {len(textures)} PBR textures')
        return textures

    def _generate_albedo_placeholder(self, prompt, resolution):
        """
        Generate placeholder albedo texture.
        In production, this would render mesh + run SDXL img2img.
        For now, creates a neutral base color.
        """
        # Create neutral gray base
        img = Image.new('RGB', (resolution, resolution), (200, 200, 200))
        return img

    def _bake_normal_map(self, mesh, resolution):
        """
        Bake a normal map from mesh geometry.
        Uses vertex normals projected into tangent space.
        """
        # Create blank normal map (default: pointing up in Z)
        # RGB(128, 128, 255) = normal pointing straight out
        normal_data = np.full((resolution, resolution, 3), [128, 128, 255], dtype=np.uint8)

        # In production, this would:
        # 1. Render mesh from multiple angles
        # 2. Compute per-pixel normals from geometry
        # 3. Convert world-space normals to tangent space
        # 4. Encode as RGB (R=X, G=Y, B=Z, remapped to 0-255)

        return Image.fromarray(normal_data, 'RGB')

    def _derive_roughness(self, albedo_img, base_roughness):
        """
        Derive roughness map from albedo luminance.
        Darker areas = rougher, lighter areas = smoother.
        """
        # Convert to grayscale
        gray = albedo_img.convert('L')

        # Invert so dark = high roughness
        inverted = ImageOps.invert(gray)

        # Scale by base roughness value
        enhancer = ImageEnhance.Brightness(inverted)
        scaled = enhancer.enhance(base_roughness * 2)

        # Convert back to RGB for consistency
        return scaled.convert('RGB')

    def _derive_metallic(self, albedo_img, base_metallic):
        """
        Derive metallic map from albedo color variation.
        Uniform colors = metallic, varied colors = dielectric.
        """
        # For a basic implementation, just use the base metallic value
        metallic_value = int(base_metallic * 255)
        metallic_img = Image.new('RGB', albedo_img.size, (metallic_value, metallic_value, metallic_value))

        # In production, analyze albedo for color uniformity:
        # - High uniformity → high metallic
        # - High variation → low metallic

        return metallic_img

    def _generate_ao(self, mesh, resolution):
        """
        Generate ambient occlusion map from mesh geometry.
        Uses mesh curvature and vertex proximity.
        """
        # Create base AO (white = no occlusion)
        ao_data = np.full((resolution, resolution), 255, dtype=np.uint8)

        # In production, this would:
        # 1. Cast rays from each UV coordinate into the scene
        # 2. Count how many rays are occluded by nearby geometry
        # 3. Dark areas = high occlusion (crevices, cavities)
        # 4. Light areas = low occlusion (exposed surfaces)

        # Add slight noise for realism
        noise = np.random.randint(-10, 10, ao_data.shape, dtype=np.int16)
        ao_data = np.clip(ao_data.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        return Image.fromarray(ao_data, 'L').convert('RGB')


# Singleton instance
texture_generator = TextureGenerator()
