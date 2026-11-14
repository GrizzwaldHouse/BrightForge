#!/usr/bin/env python3
"""Static-crate cube fixture + one-extra-triangle variant, compared three ways.

Compares:
  A. oracle    - pure-Python per-edge face incidence on the source index lists (no numpy/trimesh)
  B. model     - python/model_manager.py ModelManager.mesh_quality_report() on the exported GLB
  C. reference - trimesh's own flags (informational third-party cross-check, not an oracle)

No providers, no network, no model loading, no production file writes. Everything is written
under --out. Exit 0 only when every comparison matches.
"""
import argparse
import collections
import hashlib
import io
import json
import logging
import os
import platform
import re
import resource
import subprocess
import sys
import time
import tracemalloc
from dataclasses import dataclass, field

# ------------------------------------------------------------------ named configuration


@dataclass(frozen=True)
class FixtureConfig:
    crate_name: str = 'static_crate_cube'
    variant_name: str = 'static_crate_cube_plus_one_triangle'
    crate_edge_length: float = 1.0
    # vertex index = x + 2*y + 4*z for corner (x, y, z) in {0, 1}
    shared_edge: tuple = (0, 1)
    # new apex vertex as a multiple of crate_edge_length; off every cube face plane
    extra_apex_scale: tuple = (0.5, -0.5, -0.5)
    export_file_type: str = 'glb'
    correlation_prefix: str = 'fx'
    determinism_rebuilds: int = 1
    expected_cube_faces: int = 12
    expected_cube_vertices: int = 8
    expected_variant_faces: int = 13
    expected_variant_vertices: int = 9
    expected_variant_non_manifold: int = 1
    expected_variant_boundary: int = 2
    canary_secret: str = 'sk' + '-CANARY' + '0123456789abcdefghij'  # built at runtime so no key-shaped literal sits in source


CFG = FixtureConfig()

# 12 triangles, outward winding. Corners: i = x + 2y + 4z.
CUBE_FACES = (
    (0, 2, 1), (1, 2, 3),   # z = 0 (bottom)
    (4, 5, 6), (5, 7, 6),   # z = 1 (top)
    (0, 1, 4), (1, 5, 4),   # y = 0
    (2, 6, 3), (3, 6, 7),   # y = 1
    (0, 4, 2), (2, 4, 6),   # x = 0
    (1, 3, 5), (3, 7, 5),   # x = 1
)

# ------------------------------------------------------------------ redaction


class Redactor:
    def __init__(self, roots):
        # longest first so nested paths collapse to the most specific label
        self.roots = sorted(roots, key=lambda kv: -len(kv[0]))
        self.patterns = [
            (re.compile(r'sk-[A-Za-z0-9_-]{8,}'), '<REDACTED:key>'),
            (re.compile(r'gh[pousr]_[A-Za-z0-9]{12,}'), '<REDACTED:token>'),
            (re.compile(r'AKIA[0-9A-Z]{12,}'), '<REDACTED:key>'),
            (re.compile(r'(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}'), 'Bearer <REDACTED>'),
            (re.compile(r'(?i)(api[_-]?key|token|secret|password)(\s*[=:]\s*)\S+'), r'\1\2<REDACTED>'),
            (re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'), '<REDACTED:email>'),
            (re.compile(r'\b\d{1,3}(?:\.\d{1,3}){3}\b'), '<REDACTED:ip>'),
        ]

    def __call__(self, text):
        for path, label in self.roots:
            if path:
                text = text.replace(path, label)
        for pat, repl in self.patterns:
            text = pat.sub(repl, text)
        return text


class CorrelationLog:
    """JSON-lines log; every record carries the correlation id and is redacted before storage."""

    def __init__(self, corr_id, redactor):
        self.corr_id, self.redact, self.records = corr_id, redactor, []

    def emit(self, stage, event, **fields):
        rec = {'corr': self.corr_id, 'stage': stage, 'event': event}
        rec.update(fields)
        self.records.append(json.loads(self.redact(json.dumps(rec, sort_keys=True, default=str))))

    def handler(self):
        outer = self

        class H(logging.Handler):
            def emit(self, record):
                outer.emit('logger:' + record.name, record.levelname.lower(), message=record.getMessage())
        h = H()
        h.setLevel(logging.DEBUG)
        return h

    def dump(self, path):
        with open(path, 'w') as f:
            for r in self.records:
                f.write(json.dumps(r, sort_keys=True) + '\n')


# ------------------------------------------------------------------ helpers


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def sh(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()


class Stages:
    def __init__(self, log):
        self.log, self.rows = log, []

    def run(self, name, fn):
        tracemalloc.start()
        t0 = time.perf_counter()
        self.log.emit(name, 'start')
        try:
            out = fn()
            status, err = 'ok', None
        except Exception as e:  # recorded, not swallowed: caller sees status
            out, status, err = None, 'error', '%s: %s' % (type(e).__name__, e)
        dt = time.perf_counter() - t0
        _cur, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        row = {'stage': name, 'status': status, 'seconds': round(dt, 6), 'py_peak_alloc_bytes': peak,
               'process_max_rss_kb_after': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
        if err:
            row['error'] = err
        self.rows.append(row)
        self.log.emit(name, 'end', status=status, seconds=row['seconds'], peak_bytes=peak, error=err)
        return out


# ------------------------------------------------------------------ fixtures


def cube_vertices(cfg):
    e = cfg.crate_edge_length
    return [(float(x) * e, float(y) * e, float(z) * e) for z in (0, 1) for y in (0, 1) for x in (0, 1)]


def build_crate(cfg):
    return cube_vertices(cfg), [tuple(f) for f in CUBE_FACES]


def build_variant(cfg):
    verts, faces = build_crate(cfg)
    a, b = cfg.shared_edge
    apex = tuple(s * cfg.crate_edge_length for s in cfg.extra_apex_scale)
    verts = verts + [apex]
    faces = faces + [(a, b, len(verts) - 1)]
    return verts, faces


def oracle_incidence(faces):
    """Per-edge face incidence with plain Python only."""
    inc = collections.Counter()
    for f in faces:
        for i in range(3):
            u, v = f[i], f[(i + 1) % 3]
            inc[(u, v) if u < v else (v, u)] += 1
    hist = collections.Counter(inc.values())
    boundary = sum(1 for c in inc.values() if c == 1)
    non_manifold = sum(1 for c in inc.values() if c > 2)
    return {
        'edge_count': len(inc),
        'histogram': {str(k): hist[k] for k in sorted(hist)},
        'boundary_edges': boundary,
        'non_manifold_edges': non_manifold,
        'non_manifold_edge_list': sorted([list(e) for e, c in inc.items() if c > 2]),
        'is_manifold': non_manifold == 0,
        'is_watertight': non_manifold == 0 and boundary == 0,
    }


def export_glb(verts, faces, path, cfg):
    import numpy as np
    import trimesh
    mesh = trimesh.Trimesh(vertices=np.asarray(verts, dtype=np.float64), faces=np.asarray(faces, dtype=np.int64),
                           process=False)
    data = mesh.export(file_type=cfg.export_file_type)
    with open(path, 'wb') as f:
        f.write(data)


# ------------------------------------------------------------------ main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True, help='disposable BrightForge checkout')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    repo, out = os.path.realpath(a.repo), os.path.realpath(a.out)
    os.makedirs(out, exist_ok=True)

    commit = sh('git rev-parse HEAD', repo)
    corr_id = '%s-%s' % (CFG.correlation_prefix, hashlib.sha256((commit + CFG.crate_name).encode()).hexdigest()[:12])
    redactor = Redactor([(out, '<OUT>'), (repo, '<REPO>'), (os.path.expanduser('~'), '<HOME>'),
                         (sys.prefix, '<VENV>'), (platform.node(), '<HOST>')])
    log = CorrelationLog(corr_id, redactor)
    for name in ('forge3d.model_manager', 'forge3d.mesh_quality'):
        lg = logging.getLogger(name)
        lg.setLevel(logging.DEBUG)
        lg.addHandler(log.handler())
    stages = Stages(log)
    result = {'correlation_id': corr_id, 'config': {k: (list(v) if isinstance(v, tuple) else v)
                                                      for k, v in CFG.__dict__.items() if k != 'canary_secret'},
              'comparisons': [], 'failures': [], 'skipped': []}

    # ---- provenance
    def provenance():
        status = sh('git status --porcelain --untracked-files=no', repo)
        return {
            'commit': commit, 'branch': sh('git rev-parse --abbrev-ref HEAD', repo),
            'tracked_changes_before_run': status.splitlines(),
            'python': sys.version.split()[0], 'platform': platform.platform(),
            'node': sh('node --version'), 'npm': sh('npm --version'),
            'pip_freeze': sh('"%s" -m pip freeze' % sys.executable).splitlines(),
            'network_interfaces_proc_net_dev': sorted(l.split(':')[0].strip() for l in open('/proc/net/dev').read().splitlines()[2:]),
            'provider_env_present': sorted(k for k in os.environ
                                           if re.search(r'(API_KEY|TOKEN|SECRET)', k)),
        }
    result['provenance'] = stages.run('provenance', provenance)

    # ---- redaction self-check (canary must not survive into stored logs)
    log.emit('redaction_selfcheck', 'probe', note='token=%s path=%s' % (CFG.canary_secret, out))

    # ---- build
    fx = {}
    fx['crate'] = stages.run('build_crate', lambda: build_crate(CFG))
    fx['variant'] = stages.run('build_variant', lambda: build_variant(CFG))

    # ---- oracle
    oracle = {}
    oracle['crate'] = stages.run('oracle_crate', lambda: oracle_incidence(fx['crate'][1]))
    oracle['variant'] = stages.run('oracle_variant', lambda: oracle_incidence(fx['variant'][1]))

    # ---- export + hash
    paths = {'crate': os.path.join(out, CFG.crate_name + '.glb'),
             'variant': os.path.join(out, CFG.variant_name + '.glb')}
    for k in ('crate', 'variant'):
        stages.run('export_' + k, lambda k=k: export_glb(fx[k][0], fx[k][1], paths[k], CFG))
    hashes = {}
    for k in ('crate', 'variant'):
        hashes[k] = stages.run('sha256_' + k, lambda k=k: sha256_file(paths[k]))

    # ---- determinism: rebuild into scratch names and compare hashes
    det = []
    for i in range(CFG.determinism_rebuilds):
        for k, builder in (('crate', build_crate), ('variant', build_variant)):
            p = os.path.join(out, '_rebuild_%d_%s.glb' % (i, k))
            v, f = builder(CFG)
            export_glb(v, f, p, CFG)
            det.append({'fixture': k, 'rebuild': i, 'sha256': sha256_file(p), 'equal': sha256_file(p) == hashes[k]})
            os.remove(p)
    result['determinism'] = det

    # ---- model_manager path (same call the production API makes), no model load
    sys.path.insert(0, os.path.join(repo, 'python'))
    mm_mod = stages.run('import_model_manager', lambda: __import__('model_manager'))
    mgr = stages.run('construct_model_manager',
                     lambda: mm_mod.ModelManager(models_dir=os.path.join(out, '_unused_models_dir')))
    reports = {}
    for k in ('crate', 'variant'):
        reports[k] = stages.run('mesh_quality_report_' + k, lambda k=k: mgr.mesh_quality_report(paths[k]))

    # ---- trimesh reference (informational)
    def trimesh_ref(k):
        import trimesh
        m = trimesh.load(paths[k], force='mesh')
        return {'is_watertight': bool(m.is_watertight), 'is_winding_consistent': bool(m.is_winding_consistent),
                'faces': int(len(m.faces)), 'vertices': int(len(m.vertices))}
    ref = {k: stages.run('trimesh_reference_' + k, lambda k=k: trimesh_ref(k)) for k in ('crate', 'variant')}

    # ---- compare
    def cmp(name, expected, actual, note=''):
        ok = expected == actual
        row = {'check': name, 'expected': expected, 'actual': actual, 'match': ok}
        if note:
            row['note'] = note
        result['comparisons'].append(row)
        if not ok:
            result['failures'].append(name)

    exp_counts = {'crate': (CFG.expected_cube_vertices, CFG.expected_cube_faces),
                  'variant': (CFG.expected_variant_vertices, CFG.expected_variant_faces)}
    for k in ('crate', 'variant'):
        r, o = reports[k], oracle[k]
        if not r or not r.get('success'):
            result['failures'].append('%s: mesh_quality_report failed: %s' % (k, (r or {}).get('error')))
            continue
        t = r['topology']
        cmp(k + ': vertex_count vs expected', exp_counts[k][0], r['vertex_count'])
        cmp(k + ': face_count vs expected', exp_counts[k][1], r['face_count'])
        cmp(k + ': boundary_edges model vs oracle', o['boundary_edges'], t['boundary_edges'])
        cmp(k + ': non_manifold_edges model vs oracle', o['non_manifold_edges'], t['non_manifold_edges'])
        cmp(k + ': is_manifold model vs oracle', o['is_manifold'], r['is_manifold'])
        cmp(k + ': is_watertight model vs oracle', o['is_watertight'], r['is_watertight'])
        cmp(k + ': top-level is_manifold equals topology.is_manifold', t['is_manifold'], r['is_manifold'])
        cmp(k + ': trimesh is_watertight vs oracle (reference only)', o['is_watertight'], ref[k]['is_watertight'])
        cmp(k + ': degenerate/duplicate faces', [0, 0], [t['degenerate_faces'], t['duplicate_faces']])
    cmp('variant: exactly one non-manifold edge', CFG.expected_variant_non_manifold,
        oracle['variant']['non_manifold_edges'])
    cmp('variant: non-manifold edge is the configured shared edge', [sorted(CFG.shared_edge)],
        oracle['variant']['non_manifold_edge_list'])
    cmp('variant: boundary edges from the added triangle', CFG.expected_variant_boundary,
        oracle['variant']['boundary_edges'])
    cmp('crate: every edge has incidence exactly 2', {'2': oracle['crate']['edge_count']},
        oracle['crate']['histogram'])
    cmp('determinism: rebuilt GLBs hash-identical', True, all(d['equal'] for d in det))
    cmp('fixtures differ by exactly one face', 1, (reports['variant'] or {}).get('face_count', 0)
        - (reports['crate'] or {}).get('face_count', 0))

    result['oracle'] = oracle
    result['model_manager_reports'] = reports
    result['trimesh_reference'] = ref
    result['sha256'] = {os.path.basename(paths[k]): hashes[k] for k in hashes}

    # ---- production-file check + redaction check
    result['tracked_changes_after_run'] = sh('git status --porcelain --untracked-files=no', repo).splitlines()
    if result['tracked_changes_after_run']:
        result['failures'].append('tracked files changed in the checkout')
    log_path = os.path.join(out, 'correlation.log.jsonl')
    log.dump(log_path)
    stored = open(log_path).read()
    leaked = [s for s in (CFG.canary_secret, out, repo, os.path.expanduser('~') + os.sep) if s and s in stored]
    cmp('redaction: canary secret and absolute paths absent from stored log', [], leaked)

    # ---- explicit skips
    result['skipped'] = [
        'UE 5.7 import or validation: not run, not claimed',
        'any provider/LLM/image/mesh model call: not run by design (no adapters loaded, network namespace empty)',
        'GPU/CUDA paths and Shap-E/Hunyuan/SDXL generation: not run',
        'UV unwrap (xatlas) and UV overlap report: not part of this comparison',
    ]
    result['stages'] = stages.rows
    result['peak_process_max_rss_kb'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result['verdict'] = 'PASS' if not result['failures'] and all(r['status'] == 'ok' for r in stages.rows) else 'FAIL'
    for r in stages.rows:
        if r['status'] != 'ok':
            result['failures'].append('stage %s: %s' % (r['stage'], r.get('error')))
    result['verdict'] = 'PASS' if not result['failures'] else 'FAIL'
    json.dump(result, open(os.path.join(out, 'report.json'), 'w'), indent=1, sort_keys=True)
    with open(os.path.join(out, 'hashes.sha256'), 'w') as f:
        for name, h in sorted(result['sha256'].items()):
            f.write('%s  %s\n' % (h, name))
    print(json.dumps({'verdict': result['verdict'], 'failures': result['failures'],
                      'checks': len(result['comparisons']),
                      'matched': sum(1 for c in result['comparisons'] if c['match'])}, indent=1))
    sys.exit(0 if result['verdict'] == 'PASS' else 1)


if __name__ == '__main__':
    main()
