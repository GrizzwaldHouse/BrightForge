"""
Mesh quality measurements: topology, UVs and UV unwrapping.

Every value here is measured from the mesh. When something cannot be
measured, the report says so with a reason instead of guessing:
  measured  - value computed from the data
  absent    - the data does not exist (for example, no UV layer)
  unknown   - the data exists but was not measured (with a reason)

Definitions used in topology reports (positions merged first, so UV and
normal seams do not count as holes):
  boundary edge      - an edge used by exactly one face
  non-manifold edge  - an edge used by three or more faces
  manifold surface   - no non-manifold edges (open boundaries allowed)
  watertight         - manifold surface with no boundary edges
  degenerate face    - triangle area at or below the configured epsilon
  duplicate face     - the same three vertices as another face

All thresholds come from the `quality` section of python/config.yaml.
"""

import os
import logging
import yaml
import numpy as np

logger = logging.getLogger('forge3d.mesh_quality')

_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.yaml')
try:
    with open(_config_path) as _f:
        _CONFIG = yaml.safe_load(_f) or {}
except Exception:
    _CONFIG = {}

QUALITY_DEFAULTS = {
    'degenerate_area_epsilon': 1e-12,
    'uv_overlap_resolution': 256,
    'uv_overlap_max_faces': 50000,
    'texel_density_texture_size': 1024,
}


def quality_cfg(key):
    """Quality setting from config.yaml, falling back to the module default."""
    return (_CONFIG.get('quality') or {}).get(key, QUALITY_DEFAULTS[key])


class UnwrapUnsupported(Exception):
    """Raised when UV unwrapping cannot be performed on this system."""


def iter_geometries(loaded):
    """Yield (name, Trimesh) for a loaded mesh or every geometry of a scene."""
    import trimesh
    if isinstance(loaded, trimesh.Scene):
        for name, geom in loaded.geometry.items():
            if isinstance(geom, trimesh.Trimesh):
                yield name, geom
    elif isinstance(loaded, trimesh.Trimesh):
        yield 'mesh', loaded


def topology_report_for(mesh):
    """Topology measurements for one Trimesh (see module definitions)."""
    import trimesh
    welded = trimesh.Trimesh(vertices=np.asarray(mesh.vertices), faces=np.asarray(mesh.faces), process=False)
    welded.merge_vertices()
    faces = np.asarray(welded.faces)
    vertices = np.asarray(welded.vertices)

    report = {
        'vertex_count': int(len(mesh.vertices)),
        'face_count': int(len(mesh.faces)),
        'finite_vertices': bool(np.all(np.isfinite(vertices))) if len(vertices) else False,
    }
    if len(faces) == 0:
        report.update({'boundary_edges': 0, 'non_manifold_edges': 0, 'degenerate_faces': 0,
                       'duplicate_faces': 0, 'is_manifold': False, 'is_watertight': False,
                       'status': 'absent', 'reason': 'mesh has no faces'})
        return report

    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    boundary = int(np.sum(counts == 1))
    non_manifold = int(np.sum(counts > 2))

    areas = welded.area_faces
    degenerate = int(np.sum(areas <= quality_cfg('degenerate_area_epsilon')))
    duplicate = int(len(faces) - len(np.unique(np.sort(faces, axis=1), axis=0)))

    report.update({
        'boundary_edges': boundary,
        'non_manifold_edges': non_manifold,
        'degenerate_faces': degenerate,
        'duplicate_faces': duplicate,
        'is_manifold': non_manifold == 0,
        'is_watertight': non_manifold == 0 and boundary == 0,
        'status': 'measured',
    })
    return report


def topology_report(loaded):
    """Per-geometry topology plus a combined summary (worst case wins)."""
    per = {name: topology_report_for(g) for name, g in iter_geometries(loaded)}
    if not per:
        return {'status': 'absent', 'reason': 'no triangle geometry found', 'geometries': {}}
    sums = ('boundary_edges', 'non_manifold_edges', 'degenerate_faces', 'duplicate_faces')
    summary = {k: sum(r.get(k, 0) for r in per.values()) for k in sums}
    summary.update({
        'is_manifold': all(r.get('is_manifold') for r in per.values()),
        'is_watertight': all(r.get('is_watertight') for r in per.values()),
        'finite_vertices': all(r.get('finite_vertices') for r in per.values()),
        'status': 'measured' if all(r.get('status') == 'measured' for r in per.values()) else 'partial',
        'geometries': per,
    })
    return summary


def _uv_of(mesh):
    uv = getattr(getattr(mesh, 'visual', None), 'uv', None)
    if uv is None:
        return None
    uv = np.asarray(uv)
    if uv.ndim != 2 or uv.shape[1] != 2 or len(uv) != len(mesh.vertices):
        return None
    return uv


def _uv_overlap_ratio(uv, faces, resolution):
    """Fraction of covered UV pixels that more than one triangle covers."""
    counts = np.zeros((resolution, resolution), dtype=np.uint16)
    tris = uv[faces] * resolution
    for tri in tris:
        lo = np.floor(tri.min(axis=0)).astype(int)
        hi = np.ceil(tri.max(axis=0)).astype(int)
        lo = np.clip(lo, 0, resolution - 1)
        hi = np.clip(hi, 0, resolution)
        if hi[0] <= lo[0] or hi[1] <= lo[1]:
            continue
        xs, ys = np.meshgrid(np.arange(lo[0], hi[0]) + 0.5, np.arange(lo[1], hi[1]) + 0.5)
        (x0, y0), (x1, y1), (x2, y2) = tri
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-15:
            continue
        a = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / den
        b = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / den
        inside = (a > 0) & (b > 0) & (1 - a - b > 0)
        counts[lo[1]:hi[1], lo[0]:hi[0]] += inside.astype(np.uint16)
    covered = int(np.sum(counts > 0))
    if covered == 0:
        return 0.0, 0
    return float(np.sum(counts > 1) / covered), covered


def uv_report_for(mesh):
    """UV measurements for one Trimesh."""
    uv = _uv_of(mesh)
    if uv is None:
        return {'has_uvs': False, 'status': 'absent', 'reason': 'no UV layer matching the vertices'}

    faces = np.asarray(mesh.faces)
    report = {
        'has_uvs': True,
        'uv_count': int(len(uv)),
        'uv_finite': bool(np.all(np.isfinite(uv))),
        'uv_min': uv.min(axis=0).tolist(),
        'uv_max': uv.max(axis=0).tolist(),
        'uv_in_unit_square': bool(np.all((uv >= 0) & (uv <= 1))),
    }

    tri = uv[faces]
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    uv_area = float(np.sum(np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])) / 2.0)
    surface_area = float(mesh.area)
    report['uv_area'] = uv_area
    if surface_area > 0 and uv_area > 0:
        size = quality_cfg('texel_density_texture_size')
        report['texel_density'] = {'status': 'measured', 'texture_size': size,
                                   'texels_per_unit': float(np.sqrt(uv_area / surface_area) * size)}
    else:
        report['texel_density'] = {'status': 'unknown', 'reason': 'zero UV or surface area'}

    max_faces = quality_cfg('uv_overlap_max_faces')
    if len(faces) > max_faces:
        report['overlap'] = {'status': 'unknown', 'reason': f'{len(faces)} faces exceeds uv_overlap_max_faces ({max_faces})'}
    else:
        resolution = quality_cfg('uv_overlap_resolution')
        ratio, covered = _uv_overlap_ratio(np.clip(uv, 0, 1), faces, resolution)
        report['overlap'] = {'status': 'measured', 'resolution': resolution,
                             'overlap_ratio': ratio, 'covered_pixels': covered}
    report['status'] = 'measured'
    return report


def uv_report(loaded):
    """Per-geometry UV report plus a summary. has_uvs is true only if every geometry has UVs."""
    per = {name: uv_report_for(g) for name, g in iter_geometries(loaded)}
    if not per:
        return {'has_uvs': False, 'status': 'absent', 'reason': 'no triangle geometry found', 'geometries': {}}
    overlaps = [r['overlap'] for r in per.values() if r.get('has_uvs')]
    measured = [o['overlap_ratio'] for o in overlaps if o.get('status') == 'measured']
    if overlaps and len(measured) == len(overlaps):
        overlap = {'status': 'measured', 'max_overlap_ratio': max(measured)}
    elif overlaps:
        overlap = {'status': 'unknown', 'reason': 'overlap not measured for every geometry'}
    else:
        overlap = {'status': 'absent', 'reason': 'no UVs'}
    return {
        'has_uvs': all(r.get('has_uvs') for r in per.values()),
        'uv_count': sum(r.get('uv_count', 0) for r in per.values()),
        'overlap': overlap,
        'status': 'measured' if all(r.get('status') == 'measured' for r in per.values()) else 'partial',
        'geometries': per,
    }


def unwrap(loaded):
    """Generate UVs with xatlas for every geometry. Returns the unwrapped mesh or scene.

    Raises UnwrapUnsupported if xatlas is unavailable or any geometry fails.
    The caller must re-validate the result with uv_report().
    """
    import trimesh
    try:
        import xatlas  # noqa: F401
    except ImportError as exc:
        raise UnwrapUnsupported('xatlas is not installed (pip install xatlas)') from exc

    def _one(mesh):
        try:
            return mesh.unwrap()
        except Exception as exc:
            raise UnwrapUnsupported(f'xatlas unwrap failed: {exc}') from exc

    if isinstance(loaded, trimesh.Scene):
        scene = loaded.copy()
        for name, geom in list(scene.geometry.items()):
            if isinstance(geom, trimesh.Trimesh):
                scene.geometry[name] = _one(geom)
        return scene
    if isinstance(loaded, trimesh.Trimesh):
        return _one(loaded)
    raise UnwrapUnsupported(f'unsupported geometry type: {type(loaded).__name__}')
