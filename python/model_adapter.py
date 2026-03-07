# model_adapter.py
# Developer: Marcus Daley
# Date: March 5, 2026
# Purpose: ModelAdapter ABC and concrete adapters for Hunyuan3D and SDXL.
#          Extracts model-specific load/generate/unload logic from model_manager.py
#          so ModelManager only handles VRAM lifecycle, locks, and stats.

import time
import logging
from abc import ABC, abstractmethod
from pathlib import Path

logger = logging.getLogger('forge3d.model_adapter')


class ModelAdapter(ABC):
    """Abstract base class for model adapters.

    Each adapter encapsulates the load/generate/unload logic for a single
    model backend. The ModelManager orchestrates VRAM budget, locking, and
    state transitions around these adapters.
    """

    def __init__(self, config):
        self._config = config
        self._pipeline = None

    # -- Properties ----------------------------------------------------------

    @property
    @abstractmethod
    def name(self):
        """Unique identifier used in config and API params (e.g. 'hunyuan3d')."""

    @property
    @abstractmethod
    def model_type(self):
        """Category: 'mesh' or 'image'."""

    @property
    @abstractmethod
    def vram_requirement_gb(self):
        """Minimum VRAM needed to load this model."""

    # -- Lifecycle -----------------------------------------------------------

    @abstractmethod
    def load(self, device, dtype):
        """Load the model pipeline onto *device* with *dtype*.

        Returns True on success, False on failure.
        """

    @abstractmethod
    def generate(self, params):
        """Run inference.

        *params* is a dict whose keys depend on model_type:
          mesh  -> image (PIL), output_path, remove_background_fn
          image -> prompt, output_path, width, height, steps

        Returns a result dict with at least 'success' and model-specific keys.
        """

    def unload(self):
        """Release the pipeline from memory."""
        if self._pipeline is not None:
            del self._pipeline
            self._pipeline = None
            logger.info(f'[MODEL] {self.name} pipeline released')

    def is_loaded(self):
        """Whether the pipeline is currently in memory."""
        return self._pipeline is not None

    def get_info(self):
        """Return metadata for the GET /models endpoint."""
        return {
            'name': self.name,
            'model_type': self.model_type,
            'vram_requirement_gb': self.vram_requirement_gb,
            'loaded': self.is_loaded(),
            'repo_id': self._config.get('repo_id', 'unknown'),
        }


class HunyuanAdapter(ModelAdapter):
    """Hunyuan3D 2.1 adapter for image-to-3D textured mesh generation."""

    @property
    def name(self):
        return 'hunyuan3d'

    @property
    def model_type(self):
        return 'mesh'

    @property
    def vram_requirement_gb(self):
        return self._config.get('required_vram_gb', 12.0)

    def load(self, device, dtype):
        repo_id = self._config.get('repo_id', 'tencent/Hunyuan3D-2')

        logger.info(f'[MODEL] Loading Hunyuan3D 2.1 on {device} (this may take several minutes on first run)...')

        pipeline = None
        load_method = None

        # Attempt 1: hy3dgen standalone package
        try:
            from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
            logger.info('[MODEL] Loading Hunyuan3D via hy3dgen package...')
            pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                repo_id,
                torch_dtype=dtype,
                use_safetensors=True,
            )
            load_method = 'hy3dgen'
        except ImportError:
            logger.info('[MODEL] hy3dgen package not found, trying diffusers...')

        # Attempt 2: diffusers native pipeline
        if pipeline is None:
            try:
                from diffusers import Hunyuan3DPipeline
                logger.info('[MODEL] Loading Hunyuan3D via diffusers...')
                pipeline = Hunyuan3DPipeline.from_pretrained(
                    repo_id,
                    torch_dtype=dtype,
                    use_safetensors=True,
                )
                load_method = 'diffusers'
            except (ImportError, AttributeError):
                logger.info('[MODEL] Hunyuan3DPipeline not in diffusers, trying AutoPipeline...')

        # Attempt 3: trust_remote_code fallback
        if pipeline is None:
            try:
                from diffusers import DiffusionPipeline
                logger.info('[MODEL] Loading Hunyuan3D via DiffusionPipeline (trust_remote_code)...')
                pipeline = DiffusionPipeline.from_pretrained(
                    repo_id,
                    torch_dtype=dtype,
                    use_safetensors=True,
                    trust_remote_code=True,
                )
                load_method = 'diffusion_pipeline'
            except Exception as fallback_err:
                logger.error(f'[MODEL] All Hunyuan3D load methods failed: {fallback_err}')
                return False

        pipeline = pipeline.to(device)

        # Memory optimizations on GPU
        if device == 'cuda' and hasattr(pipeline, 'enable_attention_slicing'):
            pipeline.enable_attention_slicing()

        self._pipeline = pipeline
        logger.info(f'[MODEL] Hunyuan3D loaded on {device} via {load_method}')
        return True

    def generate(self, params):
        """Generate a textured 3D mesh from an image.

        Expected params keys:
            image          - PIL Image (already preprocessed by caller)
            output_path    - str or Path for the output GLB
            remove_background_fn - callable(PIL.Image) -> PIL.Image (optional)
        """
        from PIL import Image

        image = params['image']
        output_path = Path(params['output_path'])

        if isinstance(image, (str, Path)):
            image = Image.open(image).convert('RGB')
        else:
            image = image.convert('RGB')

        # Resize to model's expected input
        input_dims = self._config.get('input_dimensions', [512, 512])
        image = image.resize(tuple(input_dims), Image.LANCZOS)

        # Background removal if a function was provided
        remove_bg_fn = params.get('remove_background_fn')
        if remove_bg_fn is not None:
            image = remove_bg_fn(image)

        steps = self._config.get('inference_steps', 50)
        guidance = self._config.get('guidance_scale', 5.5)

        start = time.time()
        result = self._pipeline(
            image=image,
            num_inference_steps=steps,
            guidance_scale=guidance,
        )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._export_result(result, output_path)
        elapsed = time.time() - start

        logger.info(f'[MODEL] Mesh generated in {elapsed:.1f}s -> {output_path}')

        # FBX conversion (non-fatal)
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
            'file_size_bytes': output_path.stat().st_size,
            'fbx_size_bytes': fbx_size,
            'model': self.name,
            'textured': True,
        }

    def _export_result(self, result, output_path):
        """Export Hunyuan3D pipeline result to GLB.

        Handles multiple possible output formats from different pipeline
        implementations (hy3dgen, diffusers, trust_remote_code).
        """
        import trimesh

        # Format 1: result has .meshes attribute (hy3dgen)
        if hasattr(result, 'meshes') and result.meshes:
            mesh_data = result.meshes[0]
            if hasattr(mesh_data, 'export'):
                mesh_data.export(str(output_path))
                logger.info('[MODEL] Exported via mesh.export()')
                return

        # Format 2: result has .mesh attribute
        if hasattr(result, 'mesh') and result.mesh is not None:
            mesh_data = result.mesh
            if hasattr(mesh_data, 'export'):
                mesh_data.export(str(output_path))
                logger.info('[MODEL] Exported via result.mesh.export()')
                return

        # Format 3: result is a dict with 'mesh' or 'glb' key
        if isinstance(result, dict):
            if 'glb' in result:
                output_path.write_bytes(result['glb'])
                logger.info('[MODEL] Exported from dict glb bytes')
                return
            if 'mesh' in result and hasattr(result['mesh'], 'export'):
                result['mesh'].export(str(output_path))
                logger.info('[MODEL] Exported from dict mesh.export()')
                return

        # Format 4: result.images contains mesh objects (diffusers-style)
        if hasattr(result, 'images') and result.images:
            mesh_output = result.images[0]
            if hasattr(mesh_output, 'export'):
                mesh_output.export(str(output_path))
                logger.info('[MODEL] Exported via images[0].export()')
                return

            if hasattr(mesh_output, 'vertices') and hasattr(mesh_output, 'faces'):
                mesh = trimesh.Trimesh(
                    vertices=mesh_output.vertices,
                    faces=mesh_output.faces,
                )
                mesh.export(str(output_path), file_type='glb')
                logger.info('[MODEL] Exported via trimesh from vertices/faces')
                return

        # Format 5: result itself is exportable
        if hasattr(result, 'export'):
            result.export(str(output_path))
            logger.info('[MODEL] Exported via result.export()')
            return

        raise ValueError(
            f'Unsupported Hunyuan3D output format: {type(result)}. '
            f'Attributes: {[a for a in dir(result) if not a.startswith("_")]}'
        )


class SDXLAdapter(ModelAdapter):
    """SDXL adapter for text-to-image generation."""

    @property
    def name(self):
        return 'sdxl'

    @property
    def model_type(self):
        return 'image'

    @property
    def vram_requirement_gb(self):
        return self._config.get('required_vram_gb', 8.0)

    def load(self, device, dtype):
        from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler

        repo_id = self._config.get('repo_id', 'stabilityai/stable-diffusion-xl-base-1.0')

        logger.info(f'[MODEL] Loading SDXL on {device} (this may take a minute)...')

        # Always request fp16 variant (smaller download)
        pipeline = StableDiffusionXLPipeline.from_pretrained(
            repo_id,
            torch_dtype=dtype,
            variant='fp16',
            use_safetensors=True,
        )

        # DPM++ scheduler for faster inference
        pipeline.scheduler = DPMSolverMultistepScheduler.from_config(
            pipeline.scheduler.config
        )

        pipeline = pipeline.to(device)
        pipeline.enable_attention_slicing()

        self._pipeline = pipeline
        logger.info(f'[MODEL] SDXL loaded on {device}')
        return True

    def generate(self, params):
        """Generate an image from a text prompt.

        Expected params keys:
            prompt      - str
            output_path - str or Path for the output PNG
            width       - int (default 1024)
            height      - int (default 1024)
            steps       - int (default 25)
        """
        prompt = params['prompt']
        output_path = Path(params['output_path'])
        width = params.get('width', 1024)
        height = params.get('height', 1024)
        steps = params.get('steps', 25)
        guidance = self._config.get('guidance_scale', 7.5)

        start = time.time()

        logger.info(f'[MODEL] Generating image: "{prompt[:80]}..."')

        result = self._pipeline(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=guidance,
        )

        image = result.images[0]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(str(output_path), 'PNG')

        elapsed = time.time() - start
        logger.info(f'[MODEL] Image generated in {elapsed:.1f}s -> {output_path}')

        return {
            'success': True,
            'output_path': str(output_path),
            'generation_time': round(elapsed, 2),
            'width': width,
            'height': height,
            'file_size_bytes': output_path.stat().st_size,
        }
