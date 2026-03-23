# material_builder.py
# Developer: Marcus Daley
# Date: 2026-03-07
# Purpose: Material descriptor creation from PBR texture sets.
#          Binds texture paths to PBR channels and applies material presets.

import logging
from pathlib import Path

logger = logging.getLogger('forge3d.material_builder')

# Default material presets
DEFAULT_PRESETS = {
    'default_pbr': {
        'shading_model': 'PBR',
        'channels': {
            'albedo': {'slot': 'base_color', 'required': True},
            'normal': {'slot': 'normal', 'required': False},
            'roughness': {'slot': 'roughness', 'required': False},
            'metallic': {'slot': 'metallic', 'required': False},
            'ao': {'slot': 'ambient_occlusion', 'required': False}
        },
        'defaults': {
            'base_color': [0.8, 0.8, 0.8],
            'roughness': 0.5,
            'metallic': 0.0
        }
    },
    'ue5_standard': {
        'shading_model': 'DefaultLit',
        'channels': {
            'albedo': {'slot': 'BaseColor', 'required': True},
            'normal': {'slot': 'Normal', 'required': False},
            'roughness': {'slot': 'Roughness', 'required': False},
            'metallic': {'slot': 'Metallic', 'required': False},
            'ao': {'slot': 'AmbientOcclusion', 'required': False}
        },
        'defaults': {
            'BaseColor': [0.8, 0.8, 0.8],
            'Roughness': 0.5,
            'Metallic': 0.0
        },
        'unreal_specific': {
            'two_sided': False,
            'blend_mode': 'Opaque'
        }
    },
    'unity_standard': {
        'shading_model': 'Standard',
        'channels': {
            'albedo': {'slot': 'Albedo', 'required': True},
            'normal': {'slot': 'NormalMap', 'required': False},
            'roughness': {'slot': 'Smoothness', 'required': False},  # Note: Unity uses smoothness not roughness
            'metallic': {'slot': 'Metallic', 'required': False},
            'ao': {'slot': 'Occlusion', 'required': False}
        },
        'defaults': {
            'Albedo': [1.0, 1.0, 1.0],
            'Smoothness': 0.5,
            'Metallic': 0.0
        },
        'unity_specific': {
            'smoothness_invert_roughness': True  # Unity uses smoothness = 1 - roughness
        }
    }
}


class MaterialBuilder:
    """
    Material descriptor builder.

    Combines texture paths with material presets to create engine-ready
    material descriptors (JSON format).
    """

    def __init__(self, presets=None):
        self.presets = presets or DEFAULT_PRESETS

    def build_material(self, textures, preset_name='default_pbr'):
        """
        Build a material descriptor from a texture set.

        Args:
            textures: Dict mapping texture types to file paths, e.g.:
                      {'albedo': '/path/to/albedo.png', 'normal': '/path/to/normal.png', ...}
            preset_name: Material preset name ('default_pbr', 'ue5_standard', 'unity_standard')

        Returns:
            Dict material descriptor with:
            {
                'shading_model': 'PBR',
                'textures': {'base_color': '/path/to/albedo.png', ...},
                'defaults': {...},
                'metadata': {...}
            }
        """
        preset = self.presets.get(preset_name)
        if not preset:
            logger.warning(f'[MATERIAL] Unknown preset "{preset_name}", using default_pbr')
            preset = self.presets['default_pbr']

        logger.info(f'[MATERIAL] Building material with preset: {preset_name}')

        material = {
            'shading_model': preset['shading_model'],
            'textures': {},
            'defaults': preset.get('defaults', {}),
            'metadata': {
                'preset': preset_name,
                'texture_count': 0
            }
        }

        # Map texture types to material slots
        channels = preset.get('channels', {})
        for tex_type, tex_path in textures.items():
            if tex_type not in channels:
                logger.warning(f'[MATERIAL] Texture type "{tex_type}" not in preset, skipping')
                continue

            slot_info = channels[tex_type]
            slot_name = slot_info['slot']

            # Verify file exists
            if not Path(tex_path).exists():
                if slot_info.get('required'):
                    # HIGH SECURITY: Redact absolute path from error message
                    raise FileNotFoundError(f'Required texture missing: {Path(tex_path).name}')
                # HIGH SECURITY: Redact absolute path from logs
                logger.warning(f'[MATERIAL] Texture file missing: {Path(tex_path).name}')
                continue

            material['textures'][slot_name] = tex_path
            material['metadata']['texture_count'] += 1

        # Add engine-specific parameters
        if 'unreal_specific' in preset:
            material['unreal'] = preset['unreal_specific']
        if 'unity_specific' in preset:
            material['unity'] = preset['unity_specific']

        # Validate required textures
        for tex_type, slot_info in channels.items():
            if slot_info.get('required') and slot_info['slot'] not in material['textures']:
                raise ValueError(f'Required texture missing: {tex_type} ({slot_info["slot"]})')

        logger.info(f'[MATERIAL] Material built with {material["metadata"]["texture_count"]} textures')
        return material


# Singleton instance
material_builder = MaterialBuilder()
