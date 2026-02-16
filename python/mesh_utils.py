"""
ForgePipeline Mesh Utilities

Basic mesh validation and info extraction for generated GLB files.
"""

import logging
from pathlib import Path

logger = logging.getLogger('forge3d.mesh_utils')


def validate_mesh(file_path):
    """Validate a generated mesh file.

    Args:
        file_path: Path to .glb or .gltf file.

    Returns:
        dict with 'valid', 'vertex_count', 'face_count', 'file_size', 'errors'.
    """
    file_path = Path(file_path)
    result = {
        'valid': False,
        'file_path': str(file_path),
        'vertex_count': 0,
        'face_count': 0,
        'file_size_bytes': 0,
        'bounds': None,
        'errors': [],
    }

    if not file_path.exists():
        result['errors'].append(f'File not found: {file_path}')
        return result

    result['file_size_bytes'] = file_path.stat().st_size

    # Minimum file size check (GLB header is 12 bytes)
    if result['file_size_bytes'] < 100:
        result['errors'].append(f'File too small ({result["file_size_bytes"]} bytes)')
        return result

    try:
        import trimesh

        mesh = trimesh.load(str(file_path), force='mesh')

        result['vertex_count'] = len(mesh.vertices)
        result['face_count'] = len(mesh.faces)
        result['bounds'] = {
            'min': mesh.bounds[0].tolist(),
            'max': mesh.bounds[1].tolist(),
        }

        # Validation checks
        if result['vertex_count'] == 0:
            result['errors'].append('Mesh has no vertices')
        if result['face_count'] == 0:
            result['errors'].append('Mesh has no faces')
        if not mesh.is_watertight:
            # Not an error for AI-generated meshes, just a note
            logger.info(f'[MESH] Mesh is not watertight (normal for AI-generated)')

        result['valid'] = len(result['errors']) == 0

        logger.info(
            f'[MESH] Validated: {result["vertex_count"]} verts, '
            f'{result["face_count"]} faces, '
            f'{result["file_size_bytes"]} bytes, '
            f'valid={result["valid"]}'
        )

    except Exception as e:
        result['errors'].append(f'Load error: {str(e)}')
        logger.error(f'[MESH] Validation failed: {e}')

    return result


def get_mesh_info(file_path):
    """Get detailed info about a mesh file without full validation."""
    file_path = Path(file_path)

    if not file_path.exists():
        return {'error': f'File not found: {file_path}'}

    info = {
        'file_path': str(file_path),
        'file_size_bytes': file_path.stat().st_size,
        'format': file_path.suffix.lower(),
    }

    try:
        import trimesh
        mesh = trimesh.load(str(file_path), force='mesh')
        info['vertex_count'] = len(mesh.vertices)
        info['face_count'] = len(mesh.faces)
        info['is_watertight'] = mesh.is_watertight
        info['euler_number'] = mesh.euler_number
        info['bounds'] = {
            'min': mesh.bounds[0].tolist(),
            'max': mesh.bounds[1].tolist(),
            'extents': mesh.extents.tolist(),
        }
        info['centroid'] = mesh.centroid.tolist()
        info['volume'] = float(mesh.volume) if mesh.is_watertight else None
    except Exception as e:
        info['error'] = str(e)

    return info
