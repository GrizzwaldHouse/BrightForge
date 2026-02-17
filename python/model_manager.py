"""
ForgePipeline Model Manager

VRAM-aware lifecycle management for AI models.
Enforces single-model mutex to prevent OOM on 16GB GPUs.

Models:
  - InstantMesh: Single-image to 3D mesh (~4-6 GB VRAM)
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
    INSTANTMESH = 'instantmesh'
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
            ModelType.INSTANTMESH: {'state': ModelState.UNLOADED, 'pipeline': None, 'load_count': 0},
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

    def get_vram_info(self):
        """Get current VRAM usage info."""
        try:
            import torch
            if not torch.cuda.is_available():
                return {'available': False}

            total = torch.cuda.get_device_properties(0).total_mem
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
                'device_name': torch.cuda.get_device_name(0),
            }
        except Exception as e:
            logger.error(f'[MODEL] VRAM query failed: {e}')
            return {'available': False, 'error': str(e)}

    def _clear_vram(self):
        """Aggressively clear VRAM between operations."""
        import torch
        gc.collect()
        if torch.cuda.is_available():
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

    def load_instantmesh(self):
        """Load InstantMesh model for image-to-3D generation."""
        import torch

        with self._model_lock:
            info = self._models[ModelType.INSTANTMESH]

            if info['state'] == ModelState.READY:
                logger.info('[MODEL] InstantMesh already loaded')
                return True

            # Unload any other model first
            self._unload_all()
            self._clear_vram()

            instantmesh_vram = CONFIG.get('models', {}).get('instantmesh', {}).get('required_vram_gb', 6.0)
            if not self._check_vram_budget(instantmesh_vram):
                logger.error('[MODEL] Not enough VRAM for InstantMesh')
                return False

            logger.info('[MODEL] Loading InstantMesh...')
            info['state'] = ModelState.LOADING

            try:
                from diffusers import DiffusionPipeline

                instantmesh_repo = CONFIG.get('models', {}).get('instantmesh', {}).get('repo_id', 'TencentARC/InstantMesh')
                model_path = self.models_dir / 'instantmesh'
                if not model_path.exists():
                    # Fall back to downloading from hub
                    logger.info('[MODEL] Model not cached locally, loading from HuggingFace...')
                    pipeline = DiffusionPipeline.from_pretrained(
                        instantmesh_repo,
                        torch_dtype=torch.float16,
                        trust_remote_code=True,
                    )
                else:
                    pipeline = DiffusionPipeline.from_pretrained(
                        str(model_path),
                        torch_dtype=torch.float16,
                        trust_remote_code=True,
                        local_files_only=True,
                    )

                pipeline = pipeline.to('cuda')

                info['pipeline'] = pipeline
                info['state'] = ModelState.READY
                info['load_count'] += 1

                vram = self.get_vram_info()
                logger.info(
                    f'[MODEL] InstantMesh loaded. '
                    f'VRAM: {vram.get("allocated_mb", 0):.0f} MB allocated'
                )
                return True

            except Exception as e:
                logger.error(f'[MODEL] InstantMesh load failed: {e}')
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

            sdxl_vram = CONFIG.get('models', {}).get('sdxl', {}).get('required_vram_gb', 8.0)
            if not self._check_vram_budget(sdxl_vram):
                logger.error('[MODEL] Not enough VRAM for SDXL')
                return False

            logger.info('[MODEL] Loading SDXL (this may take a minute)...')
            info['state'] = ModelState.LOADING

            try:
                from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler

                sdxl_repo = CONFIG.get('models', {}).get('sdxl', {}).get('repo_id', 'stabilityai/stable-diffusion-xl-base-1.0')
                pipeline = StableDiffusionXLPipeline.from_pretrained(
                    sdxl_repo,
                    torch_dtype=torch.float16,
                    variant='fp16',
                    use_safetensors=True,
                )

                # Use DPM++ scheduler for faster inference
                pipeline.scheduler = DPMSolverMultistepScheduler.from_config(
                    pipeline.scheduler.config
                )

                pipeline = pipeline.to('cuda')

                # Enable memory optimizations
                pipeline.enable_attention_slicing()

                info['pipeline'] = pipeline
                info['state'] = ModelState.READY
                info['load_count'] += 1

                vram = self.get_vram_info()
                logger.info(
                    f'[MODEL] SDXL loaded. '
                    f'VRAM: {vram.get("allocated_mb", 0):.0f} MB allocated'
                )
                return True

            except Exception as e:
                logger.error(f'[MODEL] SDXL load failed: {e}')
                info['state'] = ModelState.ERROR
                info['pipeline'] = None
                self._clear_vram()
                return False

    def generate_mesh(self, image_data, output_path):
        """Generate 3D mesh from image using InstantMesh.

        Args:
            image_data: PIL Image or path to image file.
            output_path: Path to write output .glb file.

        Returns:
            dict with 'success', 'output_path', 'generation_time', 'vram_after'.
        """
        if not self._generation_lock.acquire(blocking=False):
            return {'success': False, 'error': 'Another generation is in progress'}

        try:
            info = self._models[ModelType.INSTANTMESH]

            if info['state'] != ModelState.READY:
                if not self.load_instantmesh():
                    return {'success': False, 'error': 'Failed to load InstantMesh'}

            info['state'] = ModelState.GENERATING
            start = time.time()

            logger.info('[MODEL] Generating mesh from image...')

            from PIL import Image
            if isinstance(image_data, (str, Path)):
                image = Image.open(image_data).convert('RGB')
            else:
                image = image_data.convert('RGB')

            # Resize to model's expected input
            input_dims = CONFIG.get('models', {}).get('instantmesh', {}).get('input_dimensions', [256, 256])
            image = image.resize(tuple(input_dims), Image.LANCZOS)

            pipeline = info['pipeline']
            instantmesh_steps = CONFIG.get('models', {}).get('instantmesh', {}).get('inference_steps', 75)
            result = pipeline(image, num_inference_steps=instantmesh_steps)

            # Extract mesh and save as GLB
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            if hasattr(result, 'meshes') and result.meshes:
                mesh = result.meshes[0]
                mesh.export(str(output_path))
            elif hasattr(result, 'mesh'):
                result.mesh.export(str(output_path))
            else:
                # Fallback: try trimesh export
                import trimesh
                if hasattr(result, 'vertices') and hasattr(result, 'faces'):
                    mesh = trimesh.Trimesh(vertices=result.vertices, faces=result.faces)
                    mesh.export(str(output_path), file_type='glb')
                else:
                    return {'success': False, 'error': 'Model output format not recognized'}

            elapsed = time.time() - start
            self.generation_count += 1
            self.total_generation_time += elapsed

            info['state'] = ModelState.READY
            self._clear_vram()

            vram = self.get_vram_info()
            logger.info(f'[MODEL] Mesh generated in {elapsed:.1f}s -> {output_path}')

            return {
                'success': True,
                'output_path': str(output_path),
                'generation_time': round(elapsed, 2),
                'vram_after': vram,
                'file_size_bytes': output_path.stat().st_size,
            }

        except Exception as e:
            logger.error(f'[MODEL] Mesh generation failed: {e}')
            info = self._models[ModelType.INSTANTMESH]
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
        """Full text-to-3D pipeline: SDXL image -> InstantMesh mesh.

        This is the two-stage pipeline with sequential VRAM management:
        1. Load SDXL, generate image, unload SDXL
        2. Load InstantMesh, generate mesh from image, unload InstantMesh

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

            # Stage 2: Image -> Mesh (InstantMesh)
            logger.info('[MODEL] === Stage 2/2: Image -> Mesh (InstantMesh) ===')
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

    def shutdown(self):
        """Clean shutdown — unload all models."""
        logger.info('[MODEL] Shutting down model manager...')
        with self._model_lock:
            self._unload_all()
        logger.info('[MODEL] Model manager shut down')


# Singleton
model_manager = ModelManager()
