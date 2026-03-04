"""
ForgePipeline Model Manager

VRAM-aware lifecycle management for AI models.
Enforces single-model mutex to prevent OOM on 16GB GPUs.

Models:
  - Shap-E: Single-image to 3D mesh (~2-4 GB VRAM)
  - SDXL: Text to image (~5-8 GB VRAM)
"""

import gc
import os
import time
import threading
import logging
import yaml
from pathlib import Path
from enum import Enum

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


class ModelType(str, Enum):
    SHAP_E = 'shap_e'
    SDXL = 'sdxl'


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
    """

    def __init__(self, models_dir=None, vram_buffer_gb=None):
        _default_models_dir = _cfg('paths', 'models_dir', 'data/models')
        self.models_dir = Path(models_dir if models_dir is not None else _default_models_dir)
        self.vram_buffer_gb = (
            vram_buffer_gb if vram_buffer_gb is not None
            else CONFIG.get('vram', {}).get('buffer_gb', 2.0)
        )

        # Model state tracking
        self._models = {
            ModelType.SHAP_E: {'state': ModelState.UNLOADED, 'pipeline': None, 'load_count': 0},
            ModelType.SDXL: {'state': ModelState.UNLOADED, 'pipeline': None, 'load_count': 0},
        }

        # Single generation mutex
        self._generation_lock = threading.Lock()
        self._model_lock = threading.Lock()

        # Stats
        self.generation_count = 0
        self.total_generation_time = 0.0
        # Restart Python after N generations to prevent VRAM fragmentation
        self._restart_threshold = CONFIG.get('vram', {}).get('generation_count_before_restart', 20)

        # Device detection (cached after first call)
        self._device = None

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

    def get_status(self):
        """Get status of all models."""
        states = {}
        for model_type, info in self._models.items():
            states[model_type.value] = {
                'state': info['state'].value,
                'load_count': info['load_count'],
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

    def _unload_all(self):
        """Unload all models from VRAM."""
        for model_type in ModelType:
            self._unload_model(model_type)

    def _unload_model(self, model_type):
        """Unload a specific model."""
        info = self._models[model_type]
        if info['state'] == ModelState.UNLOADED:
            return

        logger.info(f'[MODEL] Unloading {model_type.value}...')
        info['state'] = ModelState.UNLOADING

        try:
            if info['pipeline'] is not None:
                del info['pipeline']
                info['pipeline'] = None

            self._clear_vram()
            info['state'] = ModelState.UNLOADED
            logger.info(f'[MODEL] {model_type.value} unloaded')

        except Exception as e:
            logger.error(f'[MODEL] Failed to unload {model_type.value}: {e}')
            info['pipeline'] = None
            info['state'] = ModelState.ERROR
            self._clear_vram()

    def load_shap_e(self):
        """Load Shap-E model for image-to-3D mesh generation."""
        import torch

        with self._model_lock:
            info = self._models[ModelType.SHAP_E]

            if info['state'] == ModelState.READY:
                logger.info('[MODEL] Shap-E already loaded')
                return True

            # Unload any other model first
            self._unload_all()
            self._clear_vram()

            device = self._get_device()

            if device == 'cuda':
                shap_e_vram = CONFIG.get('models', {}).get('shap_e', {}).get('required_vram_gb', 4.0)
                if not self._check_vram_budget(shap_e_vram):
                    logger.error('[MODEL] Not enough VRAM for Shap-E')
                    return False

            logger.info(f'[MODEL] Loading Shap-E on {device}...')
            info['state'] = ModelState.LOADING

            try:
                from diffusers import ShapEImg2ImgPipeline

                shap_e_repo = CONFIG.get('models', {}).get('shap_e', {}).get('repo_id', 'openai/shap-e-img2img')
                model_path = self.models_dir / 'shap-e-img2img'

                if model_path.exists():
                    logger.info('[MODEL] Loading Shap-E from local cache...')
                    pipeline = ShapEImg2ImgPipeline.from_pretrained(
                        str(model_path),
                        local_files_only=True,
                    )
                elif device == 'cuda':
                    logger.info('[MODEL] Downloading Shap-E from HuggingFace (fp16)...')
                    pipeline = ShapEImg2ImgPipeline.from_pretrained(
                        shap_e_repo,
                        torch_dtype=torch.float16,
                        variant='fp16',
                    )
                else:
                    logger.info('[MODEL] Downloading Shap-E from HuggingFace...')
                    pipeline = ShapEImg2ImgPipeline.from_pretrained(
                        shap_e_repo,
                    )

                pipeline = pipeline.to(device)

                info['pipeline'] = pipeline
                info['state'] = ModelState.READY
                info['load_count'] += 1

                if device == 'cuda':
                    vram = self.get_vram_info()
                    logger.info(
                        f'[MODEL] Shap-E loaded on CUDA. '
                        f'VRAM: {vram.get("allocated_mb", 0):.0f} MB allocated'
                    )
                else:
                    logger.info('[MODEL] Shap-E loaded on CPU (generation will be slow)')
                return True

            except Exception as e:
                logger.error(f'[MODEL] Shap-E load failed: {e}')
                info['state'] = ModelState.ERROR
                info['pipeline'] = None
                self._clear_vram()
                return False

    def load_sdxl(self):
        """Load SDXL model for text-to-image generation."""
        import torch

        with self._model_lock:
            info = self._models[ModelType.SDXL]

            if info['state'] == ModelState.READY:
                logger.info('[MODEL] SDXL already loaded')
                return True

            # Unload any other model first
            self._unload_all()
            self._clear_vram()

            device = self._get_device()
            dtype = torch.float16 if device == 'cuda' else torch.float32

            if device == 'cuda':
                sdxl_vram = CONFIG.get('models', {}).get('sdxl', {}).get('required_vram_gb', 8.0)
                if not self._check_vram_budget(sdxl_vram):
                    logger.error('[MODEL] Not enough VRAM for SDXL')
                    return False

            logger.info(f'[MODEL] Loading SDXL on {device} (this may take a minute)...')
            info['state'] = ModelState.LOADING

            try:
                from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler

                sdxl_repo = CONFIG.get('models', {}).get('sdxl', {}).get('repo_id', 'stabilityai/stable-diffusion-xl-base-1.0')
                # Always download fp16 variant (smaller). from_pretrained
                # auto-converts to the requested torch_dtype on load.
                pipeline = StableDiffusionXLPipeline.from_pretrained(
                    sdxl_repo,
                    torch_dtype=dtype,
                    variant='fp16',
                    use_safetensors=True,
                )

                # Use DPM++ scheduler for faster inference
                pipeline.scheduler = DPMSolverMultistepScheduler.from_config(
                    pipeline.scheduler.config
                )

                pipeline = pipeline.to(device)

                # Enable memory optimizations
                pipeline.enable_attention_slicing()

                info['pipeline'] = pipeline
                info['state'] = ModelState.READY
                info['load_count'] += 1

                if device == 'cuda':
                    vram = self.get_vram_info()
                    logger.info(
                        f'[MODEL] SDXL loaded on CUDA. '
                        f'VRAM: {vram.get("allocated_mb", 0):.0f} MB allocated'
                    )
                else:
                    logger.info('[MODEL] SDXL loaded on CPU (generation will be slow)')
                return True

            except Exception as e:
                logger.error(f'[MODEL] SDXL load failed: {e}')
                info['state'] = ModelState.ERROR
                info['pipeline'] = None
                self._clear_vram()
                return False

    def generate_mesh(self, image_data, output_path):
        """Generate 3D mesh from image using Shap-E.

        Args:
            image_data: PIL Image or path to image file.
            output_path: Path to write output .glb file.

        Returns:
            dict with 'success', 'output_path', 'generation_time', 'vram_after'.
        """
        if not self._generation_lock.acquire(blocking=False):
            return {'success': False, 'error': 'Another generation is in progress'}

        try:
            info = self._models[ModelType.SHAP_E]

            if info['state'] != ModelState.READY:
                if not self.load_shap_e():
                    return {'success': False, 'error': 'Failed to load Shap-E'}

            info['state'] = ModelState.GENERATING
            start = time.time()

            logger.info('[MODEL] Generating mesh from image (Shap-E)...')

            from PIL import Image
            if isinstance(image_data, (str, Path)):
                image = Image.open(image_data).convert('RGB')
            else:
                image = image_data.convert('RGB')

            # Resize to model's expected input
            input_dims = CONFIG.get('models', {}).get('shap_e', {}).get('input_dimensions', [256, 256])
            image = image.resize(tuple(input_dims), Image.LANCZOS)

            pipeline = info['pipeline']
            shap_e_steps = CONFIG.get('models', {}).get('shap_e', {}).get('inference_steps', 64)
            shap_e_guidance = CONFIG.get('models', {}).get('shap_e', {}).get('guidance_scale', 3.0)
            shap_e_frame_size = CONFIG.get('models', {}).get('shap_e', {}).get('frame_size', 256)

            result = pipeline(
                image,
                guidance_scale=shap_e_guidance,
                num_inference_steps=shap_e_steps,
                frame_size=shap_e_frame_size,
                output_type='mesh',
            )

            # Export mesh: Shap-E -> PLY (intermediate) -> GLB via trimesh
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            import tempfile
            import trimesh
            import numpy as np
            from diffusers.utils import export_to_ply

            mesh_output = result.images[0]

            with tempfile.NamedTemporaryFile(suffix='.ply', delete=False, dir=str(output_path.parent)) as tmp:
                ply_path = tmp.name

            try:
                export_to_ply(mesh_output, ply_path)

                mesh = trimesh.load(ply_path)

                # Fix orientation (Shap-E outputs bottom-up by default)
                rot = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
                mesh = mesh.apply_transform(rot)

                mesh.export(str(output_path), file_type='glb')
            finally:
                # Clean up intermediate PLY
                if os.path.exists(ply_path):
                    os.unlink(ply_path)

            elapsed = time.time() - start
            self.generation_count += 1
            self.total_generation_time += elapsed

            info['state'] = ModelState.READY
            self._clear_vram()

            vram = self.get_vram_info()
            logger.info(f'[MODEL] Mesh generated in {elapsed:.1f}s -> {output_path}')

            # FBX conversion (non-fatal if it fails)
            fbx_path_result = None
            fbx_size = 0
            try:
                from fbx_converter import fbx_converter
                if fbx_converter.is_available():
                    fbx_out = output_path.with_suffix('.fbx')
                    fbx_result = fbx_converter.convert_glb_to_fbx(str(output_path), str(fbx_out))
                    if fbx_result['success']:
                        fbx_path_result = str(fbx_out)
                        fbx_size = fbx_result.get('file_size_bytes', 0)
                        logger.info(f'[MODEL] FBX exported: {fbx_out} ({fbx_size} bytes)')
                    else:
                        logger.warning(f'[MODEL] FBX conversion failed (non-fatal): {fbx_result.get("error")}')
                else:
                    logger.info('[MODEL] FBX converter not available, skipping FBX export')
            except ImportError:
                logger.info('[MODEL] fbx_converter module not found, skipping FBX export')
            except Exception as fbx_err:
                logger.warning(f'[MODEL] FBX conversion error (non-fatal): {fbx_err}')

            return {
                'success': True,
                'output_path': str(output_path),
                'fbx_path': fbx_path_result,
                'generation_time': round(elapsed, 2),
                'vram_after': vram,
                'file_size_bytes': output_path.stat().st_size,
                'fbx_size_bytes': fbx_size,
            }

        except Exception as e:
            logger.error(f'[MODEL] Mesh generation failed: {e}')
            info = self._models[ModelType.SHAP_E]
            info['state'] = ModelState.READY if info['pipeline'] else ModelState.ERROR
            return {'success': False, 'error': str(e)}

        finally:
            self._generation_lock.release()

    def generate_image(self, prompt, output_path, width=1024, height=1024, steps=25):
        """Generate image from text prompt using SDXL.

        Args:
            prompt: Text description of desired image.
            output_path: Path to write output PNG file.
            width: Image width (default 1024).
            height: Image height (default 1024).
            steps: Number of inference steps (default 25).

        Returns:
            dict with 'success', 'output_path', 'generation_time', 'vram_after'.
        """
        if not self._generation_lock.acquire(blocking=False):
            return {'success': False, 'error': 'Another generation is in progress'}

        try:
            info = self._models[ModelType.SDXL]

            if info['state'] != ModelState.READY:
                if not self.load_sdxl():
                    return {'success': False, 'error': 'Failed to load SDXL'}

            info['state'] = ModelState.GENERATING
            start = time.time()

            logger.info(f'[MODEL] Generating image: "{prompt[:80]}..."')

            pipeline = info['pipeline']
            sdxl_guidance = CONFIG.get('models', {}).get('sdxl', {}).get('guidance_scale', 7.5)
            result = pipeline(
                prompt=prompt,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=sdxl_guidance,
            )

            image = result.images[0]
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            image.save(str(output_path), 'PNG')

            elapsed = time.time() - start
            self.generation_count += 1
            self.total_generation_time += elapsed

            info['state'] = ModelState.READY
            self._clear_vram()

            vram = self.get_vram_info()
            logger.info(f'[MODEL] Image generated in {elapsed:.1f}s -> {output_path}')

            return {
                'success': True,
                'output_path': str(output_path),
                'generation_time': round(elapsed, 2),
                'width': width,
                'height': height,
                'vram_after': vram,
                'file_size_bytes': output_path.stat().st_size,
            }

        except Exception as e:
            logger.error(f'[MODEL] Image generation failed: {e}')
            info = self._models[ModelType.SDXL]
            info['state'] = ModelState.READY if info['pipeline'] else ModelState.ERROR
            return {'success': False, 'error': str(e)}

        finally:
            self._generation_lock.release()

    def generate_full_pipeline(self, prompt, output_dir, steps=25):
        """Full text-to-3D pipeline: SDXL image -> Shap-E mesh.

        This is the two-stage pipeline with sequential VRAM management:
        1. Load SDXL, generate image, unload SDXL
        2. Load Shap-E, generate mesh from image, unload Shap-E

        Args:
            prompt: Text description of desired 3D object.
            output_dir: Directory for output files.
            steps: SDXL inference steps.

        Returns:
            dict with stage results.
        """
        if not self._generation_lock.acquire(blocking=False):
            return {'success': False, 'error': 'Another generation is in progress', 'stage': 'blocked'}

        try:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)

            total_start = time.time()
            result = {'success': False, 'stages': {}}

            # Stage 1: Text -> Image (SDXL)
            logger.info('[MODEL] === Stage 1/2: Text -> Image (SDXL) ===')
            image_path = output_dir / 'generated_image.png'

            # Temporarily release the lock so generate_image can acquire it
            self._generation_lock.release()
            stage1 = self.generate_image(prompt, image_path, steps=steps)
            self._generation_lock.acquire()

            result['stages']['image'] = stage1

            if not stage1['success']:
                result['error'] = f'Image generation failed: {stage1.get("error")}'
                result['stage'] = 'image'
                return result

            # Stage 2: Image -> Mesh (Shap-E)
            logger.info('[MODEL] === Stage 2/2: Image -> Mesh (Shap-E) ===')
            mesh_path = output_dir / 'generated_mesh.glb'

            self._generation_lock.release()
            stage2 = self.generate_mesh(image_path, mesh_path)
            self._generation_lock.acquire()

            result['stages']['mesh'] = stage2

            if not stage2['success']:
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

            logger.info(f'[MODEL] Full pipeline complete in {total_time:.1f}s')
            return result

        except Exception as e:
            logger.error(f'[MODEL] Full pipeline failed: {e}')
            return {'success': False, 'error': str(e), 'stage': 'unknown'}

        finally:
            try:
                self._generation_lock.release()
            except RuntimeError:
                pass  # Already released

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

            # Quadric decimation
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
                    # Copy original
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

            # Estimated VRAM: ~32 bytes per vertex (position + normal + UV + tangent)
            estimated_vram_mb = (vertex_count * 32) / (1024 * 1024)

            # Recommendations per target platform
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
        """Clean shutdown — unload all models."""
        logger.info('[MODEL] Shutting down model manager...')
        with self._model_lock:
            self._unload_all()
        logger.info('[MODEL] Model manager shut down')


# Singleton
model_manager = ModelManager()
