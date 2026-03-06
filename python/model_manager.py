# model_manager.py
# Developer: Marcus Daley
# Date: March 5, 2026
# Purpose: VRAM-aware lifecycle management for AI model adapters.
#          Enforces single-model mutex to prevent OOM on 16GB GPUs.
#          Uses adapter pattern for pluggable model backends.

import gc
import os
import time
import threading
import logging
import yaml
from pathlib import Path
from enum import Enum

from model_adapter import HunyuanAdapter, SDXLAdapter

logger = logging.getLogger('forge3d.model_manager')

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


# Kept for backward compatibility with external references
class ModelState(str, Enum):
    UNLOADED = 'unloaded'
    LOADING = 'loading'
    READY = 'ready'
    GENERATING = 'generating'
    UNLOADING = 'unloading'
    ERROR = 'error'


class ModelManager:
    """VRAM-aware model lifecycle manager.

    Enforces single-model-at-a-time policy to prevent OOM.
    Provides mutex-protected generation to prevent race conditions.
    Uses adapter pattern: each model backend is a ModelAdapter subclass.
    """

    def __init__(self, models_dir=None, vram_buffer_gb=None):
        _default_models_dir = _cfg('paths', 'models_dir', 'data/models')
        self.models_dir = Path(models_dir if models_dir is not None else _default_models_dir)
        self.vram_buffer_gb = (
            vram_buffer_gb if vram_buffer_gb is not None
            else CONFIG.get('vram', {}).get('buffer_gb', 2.0)
        )

        # Adapter registry: name -> adapter instance
        self._adapters = {}
        self._active_adapter = None
        self._register_adapters()

        # Single generation mutex — prevents concurrent GPU work
        self._generation_lock = threading.Lock()
        # Model swap mutex — prevents concurrent load/unload
        self._model_lock = threading.Lock()

        # Stats
        self.generation_count = 0
        self.total_generation_time = 0.0
        # Restart Python after N generations to prevent VRAM fragmentation
        self._restart_threshold = CONFIG.get('vram', {}).get('generation_count_before_restart', 20)

        # Device detection (cached after first call)
        self._device = None

        # Background removal model (lazy-loaded)
        self._rembg_session = None

    def _register_adapters(self):
        """Build adapter instances from config."""
        models_cfg = CONFIG.get('models', {})

        hunyuan_cfg = models_cfg.get('hunyuan3d', {})
        self._adapters['hunyuan3d'] = HunyuanAdapter(hunyuan_cfg)

        sdxl_cfg = models_cfg.get('sdxl', {})
        self._adapters['sdxl'] = SDXLAdapter(sdxl_cfg)

        # Shap-E: conditional registration (package may not be installed)
        shap_e_cfg = models_cfg.get('shap_e', {})
        if shap_e_cfg.get('enabled', True):
            try:
                from shap_e_adapter import ShapEAdapter
                self._adapters['shap-e'] = ShapEAdapter(shap_e_cfg)
            except ImportError:
                logger.warning('[MODEL] shap-e package not installed, adapter disabled')

        logger.info(f'[MODEL] Registered {len(self._adapters)} adapters: {list(self._adapters.keys())}')

    def _get_device(self):
        """Get the best available compute device ('cuda' or 'cpu').

        Tests that CUDA is actually usable (not just detected) to handle cases
        like unsupported GPU architectures (e.g. sm_120 Blackwell with cu124).
        """
        if self._device is not None:
            return self._device

        try:
            import torch
            if torch.cuda.is_available():
                # Verify GPU is actually usable by running a small tensor op
                torch.zeros(1, device='cuda')
                self._device = 'cuda'
                logger.info(f'[MODEL] Using CUDA device: {torch.cuda.get_device_name(0)}')
            else:
                self._device = 'cpu'
                logger.warning('[MODEL] CUDA not available, using CPU (generation will be slow)')
                self._log_gpu_setup_instructions()
        except Exception as e:
            self._device = 'cpu'
            logger.warning(f'[MODEL] CUDA test failed ({e}), falling back to CPU')
            self._log_gpu_setup_instructions()

        return self._device

    def _log_gpu_setup_instructions(self):
        """Log actionable instructions for enabling GPU support."""
        try:
            import torch
            torch_version = torch.__version__
            cuda_version = getattr(torch.version, 'cuda', 'N/A')
        except ImportError:
            torch_version = 'unknown'
            cuda_version = 'N/A'

        logger.warning(
            f'[MODEL] Current PyTorch {torch_version} (CUDA {cuda_version}) '
            f'does not support this GPU.'
        )
        logger.warning(
            '[MODEL] For RTX 5080 (Blackwell) GPU support, install PyTorch nightly:'
        )
        logger.warning(
            '[MODEL]   pip install --pre torch torchvision '
            '--index-url https://download.pytorch.org/whl/nightly/cu128'
        )
        logger.warning(
            '[MODEL]   Note: Requires Python 3.12 (nightly may not support 3.13)'
        )

    def get_vram_info(self):
        """Get current VRAM usage info."""
        try:
            import torch
            if self._get_device() != 'cuda':
                return {'available': False}

            props = torch.cuda.get_device_properties(0)
            total = props.total_memory
            allocated = torch.cuda.memory_allocated(0)
            reserved = torch.cuda.memory_reserved(0)
            free = total - reserved

            return {
                'available': True,
                'total_mb': total / (1024 * 1024),
                'allocated_mb': allocated / (1024 * 1024),
                'reserved_mb': reserved / (1024 * 1024),
                'free_mb': free / (1024 * 1024),
                'total_gb': total / (1024 ** 3),
                'free_gb': free / (1024 ** 3),
                'usage_pct': (reserved / total) * 100 if total > 0 else 0,
                'device_name': props.name,
            }
        except Exception as e:
            logger.error(f'[MODEL] VRAM query failed: {e}')
            return {'available': False, 'error': str(e)}

    def _clear_vram(self):
        """Aggressively clear VRAM between operations."""
        gc.collect()
        if self._get_device() == 'cuda':
            import torch
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        logger.info('[MODEL] VRAM cache cleared')

    def _check_vram_budget(self, required_gb):
        """Check if enough free VRAM for a model load."""
        vram = self.get_vram_info()
        if not vram.get('available'):
            logger.warning('[MODEL] Cannot check VRAM — CUDA unavailable')
            return True  # Proceed anyway, let it fail naturally

        free_gb = vram['free_gb']
        needed = required_gb + self.vram_buffer_gb

        if free_gb < needed:
            logger.warning(
                f'[MODEL] Insufficient VRAM: {free_gb:.1f} GB free, '
                f'need {needed:.1f} GB ({required_gb:.1f} + {self.vram_buffer_gb:.1f} buffer)'
            )
            return False
        return True

    def _ensure_adapter_loaded(self, name):
        """Ensure the named adapter is loaded, unloading others first.

        Acquires _model_lock internally. Does NOT touch _generation_lock.

        Returns the adapter on success, raises RuntimeError on failure.
        """
        import torch

        adapter = self._adapters.get(name)
        if adapter is None:
            raise RuntimeError(f'Unknown model adapter: {name}')

        with self._model_lock:
            if adapter.is_loaded():
                logger.info(f'[MODEL] {name} already loaded')
                return adapter

            # Unload the currently active adapter to free VRAM
            if self._active_adapter is not None:
                active = self._adapters.get(self._active_adapter)
                if active is not None and active.is_loaded():
                    logger.info(f'[MODEL] Unloading {self._active_adapter} to make room for {name}...')
                    active.unload()
                self._clear_vram()

            device = self._get_device()

            if device == 'cuda':
                if not self._check_vram_budget(adapter.vram_requirement_gb):
                    raise RuntimeError(f'Not enough VRAM for {name}')

            dtype = torch.float16 if device == 'cuda' else torch.float32
            success = adapter.load(device, dtype)

            if not success:
                self._clear_vram()
                raise RuntimeError(f'Failed to load {name}')

            self._active_adapter = name

            if device == 'cuda':
                vram = self.get_vram_info()
                logger.info(
                    f'[MODEL] {name} loaded on CUDA. '
                    f'VRAM: {vram.get("allocated_mb", 0):.0f} MB allocated'
                )
            else:
                logger.info(f'[MODEL] {name} loaded on CPU (generation will be slow)')

            return adapter

    def get_available_models(self):
        """Return info for all registered adapters (for GET /models)."""
        return [adapter.get_info() for adapter in self._adapters.values()]

    def get_status(self):
        """Get status of all models."""
        states = {}
        for name, adapter in self._adapters.items():
            if adapter.is_loaded():
                state = ModelState.READY.value
            else:
                state = ModelState.UNLOADED.value
            states[name] = {
                'state': state,
                'loaded': adapter.is_loaded(),
            }

        return {
            'models': states,
            'generation_count': self.generation_count,
            'avg_generation_time': (
                self.total_generation_time / self.generation_count
                if self.generation_count > 0 else 0
            ),
            'vram': self.get_vram_info(),
            'needs_restart': self.generation_count >= self._restart_threshold,
        }

    def _get_rembg_session(self):
        """Lazy-load the rembg background removal session."""
        if self._rembg_session is None:
            try:
                from rembg import new_session
                logger.info('[MODEL] Loading rembg background removal model...')
                self._rembg_session = new_session('u2net')
                logger.info('[MODEL] rembg loaded')
            except ImportError:
                logger.warning('[MODEL] rembg not installed — background removal disabled')
                return None
            except Exception as e:
                logger.warning(f'[MODEL] rembg load failed (non-fatal): {e}')
                return None
        return self._rembg_session

    def _remove_background(self, image):
        """Remove background from an image using rembg.

        Args:
            image: PIL Image.

        Returns:
            PIL Image with background removed (RGBA), or original if rembg unavailable.
        """
        remove_bg = CONFIG.get('models', {}).get('hunyuan3d', {}).get('remove_background', True)
        if not remove_bg:
            return image

        session = self._get_rembg_session()
        if session is None:
            return image

        try:
            from rembg import remove
            logger.info('[MODEL] Removing image background...')
            result = remove(image, session=session)
            logger.info('[MODEL] Background removed')
            return result
        except Exception as e:
            logger.warning(f'[MODEL] Background removal failed (non-fatal): {e}')
            return image

    def generate_mesh(self, image_data, output_path, model=None):
        """Generate 3D mesh from image using the specified mesh adapter.

        Args:
            image_data: PIL Image or path to image file.
            output_path: Path to write output .glb file.
            model: Adapter name (default from config).

        Returns:
            dict with 'success', 'output_path', 'generation_time', 'vram_after'.
        """
        if model is None:
            registry = CONFIG.get('model_registry', {})
            model = registry.get('default_mesh_model', 'hunyuan3d')

        if not self._generation_lock.acquire(blocking=False):
            return {'success': False, 'error': 'Another generation is in progress'}

        try:
            adapter = self._ensure_adapter_loaded(model)

            params = {
                'image': image_data,
                'output_path': output_path,
                'remove_background_fn': self._remove_background,
            }

            result = adapter.generate(params)

            self.generation_count += 1
            self.total_generation_time += result.get('generation_time', 0)
            self._clear_vram()
            result['vram_after'] = self.get_vram_info()
            return result

        except RuntimeError as e:
            logger.error(f'[MODEL] Mesh generation failed: {e}')
            return {'success': False, 'error': str(e)}
        except Exception as e:
            logger.error(f'[MODEL] Mesh generation failed: {e}')
            return {'success': False, 'error': str(e)}

        finally:
            self._generation_lock.release()

    def generate_image(self, prompt, output_path, width=1024, height=1024, steps=25, model=None):
        """Generate image from text prompt using the specified image adapter.

        Args:
            prompt: Text description of desired image.
            output_path: Path to write output PNG file.
            width: Image width (default 1024).
            height: Image height (default 1024).
            steps: Number of inference steps (default 25).
            model: Adapter name (default from config).

        Returns:
            dict with 'success', 'output_path', 'generation_time', 'vram_after'.
        """
        if model is None:
            registry = CONFIG.get('model_registry', {})
            model = registry.get('default_image_model', 'sdxl')

        if not self._generation_lock.acquire(blocking=False):
            return {'success': False, 'error': 'Another generation is in progress'}

        try:
            adapter = self._ensure_adapter_loaded(model)

            params = {
                'prompt': prompt,
                'output_path': output_path,
                'width': width,
                'height': height,
                'steps': steps,
            }

            result = adapter.generate(params)

            self.generation_count += 1
            self.total_generation_time += result.get('generation_time', 0)
            self._clear_vram()
            result['vram_after'] = self.get_vram_info()
            return result

        except RuntimeError as e:
            logger.error(f'[MODEL] Image generation failed: {e}')
            return {'success': False, 'error': str(e)}
        except Exception as e:
            logger.error(f'[MODEL] Image generation failed: {e}')
            return {'success': False, 'error': str(e)}

        finally:
            self._generation_lock.release()

    def generate_full_pipeline(self, prompt, output_dir, steps=25, image_model=None, mesh_model=None):
        """Full text-to-3D pipeline: image generation -> mesh generation.

        Acquires _generation_lock ONCE for the entire pipeline. Calls
        _ensure_adapter_loaded() + adapter.generate() directly for each
        stage, avoiding the release/re-acquire race condition.

        Args:
            prompt: Text description of desired 3D object.
            output_dir: Directory for output files.
            steps: Image generation inference steps.
            image_model: Image adapter name (default from config).
            mesh_model: Mesh adapter name (default from config).

        Returns:
            dict with stage results.
        """
        registry = CONFIG.get('model_registry', {})
        if image_model is None:
            image_model = registry.get('default_image_model', 'sdxl')
        if mesh_model is None:
            mesh_model = registry.get('default_mesh_model', 'hunyuan3d')

        if not self._generation_lock.acquire(blocking=False):
            return {'success': False, 'error': 'Another generation is in progress', 'stage': 'blocked'}

        try:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)

            total_start = time.time()
            result = {'success': False, 'stages': {}}

            # Stage 1: Text -> Image
            logger.info(f'[MODEL] === Stage 1/2: Text -> Image ({image_model}) ===')
            image_path = output_dir / 'generated_image.png'

            image_adapter = self._ensure_adapter_loaded(image_model)
            stage1 = image_adapter.generate({
                'prompt': prompt,
                'output_path': image_path,
                'steps': steps,
            })

            self.generation_count += 1
            self.total_generation_time += stage1.get('generation_time', 0)
            result['stages']['image'] = stage1

            if not stage1.get('success'):
                result['error'] = f'Image generation failed: {stage1.get("error")}'
                result['stage'] = 'image'
                return result

            # Stage 2: Image -> Textured Mesh
            logger.info(f'[MODEL] === Stage 2/2: Image -> Textured Mesh ({mesh_model}) ===')
            mesh_path = output_dir / 'generated_mesh.glb'

            mesh_adapter = self._ensure_adapter_loaded(mesh_model)
            stage2 = mesh_adapter.generate({
                'image': image_path,
                'output_path': mesh_path,
                'remove_background_fn': self._remove_background,
            })

            self.generation_count += 1
            self.total_generation_time += stage2.get('generation_time', 0)
            result['stages']['mesh'] = stage2

            if not stage2.get('success'):
                result['error'] = f'Mesh generation failed: {stage2.get("error")}'
                result['stage'] = 'mesh'
                return result

            # Success
            total_time = time.time() - total_start
            result['success'] = True
            result['total_time'] = round(total_time, 2)
            result['image_path'] = str(image_path)
            result['mesh_path'] = str(mesh_path)
            result['fbx_path'] = stage2.get('fbx_path')
            result['vram_after'] = self.get_vram_info()
            result['textured'] = stage2.get('textured', False)

            logger.info(f'[MODEL] Full pipeline complete in {total_time:.1f}s')
            return result

        except Exception as e:
            logger.error(f'[MODEL] Full pipeline failed: {e}')
            return {'success': False, 'error': str(e), 'stage': 'unknown'}

        finally:
            self._generation_lock.release()

    def optimize_mesh(self, input_path, target_faces, output_path=None):
        """Optimize a mesh by reducing face count via quadric decimation.

        Args:
            input_path: Path to input GLB/PLY/OBJ file.
            target_faces: Target face count after optimization.
            output_path: Output path (defaults to input with _optimized suffix).

        Returns:
            dict with 'success', 'output_path', 'original_faces', 'optimized_faces', 'reduction_pct'.
        """
        try:
            import trimesh

            input_path = Path(input_path)
            if output_path is None:
                output_path = input_path.parent / f'{input_path.stem}_optimized{input_path.suffix}'
            else:
                output_path = Path(output_path)

            logger.info(f'[MODEL] Optimizing mesh: {input_path} -> target {target_faces} faces')

            mesh = trimesh.load(str(input_path), force='mesh')
            original_faces = len(mesh.faces)

            if target_faces >= original_faces:
                logger.info(f'[MODEL] Mesh already has {original_faces} faces (target: {target_faces}), skipping')
                output_path = input_path
                return {
                    'success': True,
                    'output_path': str(output_path),
                    'original_faces': original_faces,
                    'optimized_faces': original_faces,
                    'reduction_pct': 0.0,
                    'file_size_bytes': input_path.stat().st_size,
                    'skipped': True,
                }

            optimized = mesh.simplify_quadric_decimation(target_faces)

            output_path.parent.mkdir(parents=True, exist_ok=True)
            optimized.export(str(output_path), file_type='glb')

            optimized_faces = len(optimized.faces)
            reduction = ((original_faces - optimized_faces) / original_faces) * 100 if original_faces > 0 else 0

            logger.info(
                f'[MODEL] Mesh optimized: {original_faces} -> {optimized_faces} faces '
                f'({reduction:.1f}% reduction)'
            )

            return {
                'success': True,
                'output_path': str(output_path),
                'original_faces': original_faces,
                'optimized_faces': optimized_faces,
                'reduction_pct': round(reduction, 1),
                'file_size_bytes': output_path.stat().st_size,
                'skipped': False,
            }

        except Exception as e:
            logger.error(f'[MODEL] Mesh optimization failed: {e}')
            return {'success': False, 'error': str(e)}

    def generate_lod_chain(self, input_path, output_dir, levels=None):
        """Generate LOD (Level of Detail) chain from a mesh.

        Args:
            input_path: Path to input GLB file.
            output_dir: Directory for LOD output files.
            levels: List of reduction ratios (default [1.0, 0.5, 0.25]).

        Returns:
            dict with 'success', 'levels' array of {level, path, faces, file_size}.
        """
        if levels is None:
            levels = [1.0, 0.5, 0.25]

        try:
            import trimesh

            input_path = Path(input_path)
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)

            mesh = trimesh.load(str(input_path), force='mesh')
            original_faces = len(mesh.faces)

            logger.info(f'[MODEL] Generating LOD chain: {original_faces} faces, {len(levels)} levels')

            lod_results = []
            lod_names = ['high', 'mid', 'low', 'lowest']

            for i, ratio in enumerate(levels):
                name = lod_names[i] if i < len(lod_names) else f'lod{i}'
                target = max(4, int(original_faces * ratio))
                out_path = output_dir / f'mesh_{name}.glb'

                if ratio >= 1.0:
                    mesh.export(str(out_path), file_type='glb')
                    faces = original_faces
                else:
                    decimated = mesh.simplify_quadric_decimation(target)
                    decimated.export(str(out_path), file_type='glb')
                    faces = len(decimated.faces)

                lod_results.append({
                    'level': name,
                    'ratio': ratio,
                    'path': str(out_path),
                    'faces': faces,
                    'file_size': out_path.stat().st_size,
                })

                logger.info(f'[MODEL] LOD {name}: {faces} faces ({out_path.stat().st_size} bytes)')

            return {
                'success': True,
                'levels': lod_results,
                'original_faces': original_faces,
            }

        except Exception as e:
            logger.error(f'[MODEL] LOD generation failed: {e}')
            return {'success': False, 'error': str(e)}

    def mesh_quality_report(self, input_path):
        """Generate a quality report for a mesh.

        Args:
            input_path: Path to input GLB file.

        Returns:
            dict with vertex_count, face_count, bounding_box, estimated_vram, recommendations.
        """
        try:
            import trimesh
            import numpy as np

            input_path = Path(input_path)
            mesh = trimesh.load(str(input_path), force='mesh')

            vertex_count = len(mesh.vertices)
            face_count = len(mesh.faces)
            bounds = mesh.bounding_box.extents.tolist()
            file_size = input_path.stat().st_size

            # ~32 bytes per vertex (position + normal + UV + tangent)
            estimated_vram_mb = (vertex_count * 32) / (1024 * 1024)

            recommendations = {}
            presets = {
                'mobile': 2000,
                'web': 5000,
                'desktop': 10000,
                'unreal': 50000,
            }

            for platform, target in presets.items():
                if face_count <= target:
                    recommendations[platform] = {
                        'status': 'ok',
                        'message': f'Good for {platform} ({face_count} faces <= {target} target)',
                    }
                else:
                    reduction = round(((face_count - target) / face_count) * 100, 1)
                    recommendations[platform] = {
                        'status': 'reduce',
                        'message': f'Reduce to {target} faces ({reduction}% reduction needed)',
                        'target_faces': target,
                    }

            is_watertight = bool(mesh.is_watertight)
            is_manifold = bool(np.all(mesh.edges_unique_length > 0)) if len(mesh.edges_unique_length) > 0 else False

            logger.info(
                f'[MODEL] Quality report: {vertex_count} verts, {face_count} faces, '
                f'{estimated_vram_mb:.1f} MB est. VRAM'
            )

            return {
                'success': True,
                'vertex_count': vertex_count,
                'face_count': face_count,
                'bounding_box': {
                    'width': round(bounds[0], 3),
                    'height': round(bounds[1], 3),
                    'depth': round(bounds[2], 3),
                },
                'file_size_bytes': file_size,
                'estimated_vram_mb': round(estimated_vram_mb, 2),
                'is_watertight': is_watertight,
                'is_manifold': is_manifold,
                'recommendations': recommendations,
            }

        except Exception as e:
            logger.error(f'[MODEL] Quality report failed: {e}')
            return {'success': False, 'error': str(e)}

    def shutdown(self):
        """Clean shutdown — unload all model adapters."""
        logger.info('[MODEL] Shutting down model manager...')
        with self._model_lock:
            for name, adapter in self._adapters.items():
                if adapter.is_loaded():
                    adapter.unload()
            self._active_adapter = None
            self._clear_vram()
        logger.info('[MODEL] Model manager shut down')


# Singleton
model_manager = ModelManager()
