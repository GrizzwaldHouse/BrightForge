# shap_e_adapter.py
# Developer: Marcus Daley
# Date: March 5, 2026
# Purpose: Shap-E adapter for lightweight image-to-3D mesh generation.
#          Implements ModelAdapter ABC for OpenAI's Shap-E model.
#          Lower VRAM requirement than Hunyuan3D, used as automatic fallback.

import time
import logging
from pathlib import Path

from model_adapter import ModelAdapter

logger = logging.getLogger('forge3d.shap_e_adapter')


class ShapEAdapter(ModelAdapter):
    """Shap-E adapter for image-conditioned 3D mesh generation.

    Uses OpenAI's Shap-E model (image300M + transmitter) to generate
    3D meshes from input images. Lighter weight than Hunyuan3D (~4GB VRAM
    vs ~12GB), making it suitable as a fallback when VRAM is constrained.

    Output is untextured geometry exported as GLB via trimesh.
    """

    def __init__(self, config):
        super().__init__(config)
        self._transmitter = None
        self._image_model = None
        self._diffusion = None

    @property
    def name(self):
        return 'shap-e'

    @property
    def model_type(self):
        return 'mesh'

    @property
    def vram_requirement_gb(self):
        return self._config.get('required_vram_gb', 4.0)

    def load(self, device, dtype):
        logger.info(f'[MODEL] Loading Shap-E on {device} (first run downloads ~1GB from HuggingFace)...')

        try:
            from shap_e.models.download import load_model, load_config
            from shap_e.diffusion.gaussian_diffusion import diffusion_from_config
        except ImportError:
            logger.error('[MODEL] shap-e package not installed. Install with: pip install shap-e')
            return False

        try:
            # Load transmitter (decodes latents to meshes)
            self._transmitter = load_model('transmitter', device=device)
            logger.info('[MODEL] Shap-E transmitter loaded')

            # Load image-conditioned model
            self._image_model = load_model('image300M', device=device)
            logger.info('[MODEL] Shap-E image300M model loaded')

            # Load diffusion config
            self._diffusion = diffusion_from_config(load_config('diffusion'))
            logger.info('[MODEL] Shap-E diffusion config loaded')

            # Store as _pipeline for base class is_loaded() check
            self._pipeline = self._image_model

            logger.info(f'[MODEL] Shap-E fully loaded on {device}')
            return True

        except Exception as e:
            logger.error(f'[MODEL] Shap-E load failed: {e}')
            self._cleanup_partial()
            return False

    def generate(self, params):
        """Generate a 3D mesh from an image.

        Expected params keys:
            image          - PIL Image (already preprocessed by caller)
            output_path    - str or Path for the output GLB
            remove_background_fn - callable(PIL.Image) -> PIL.Image (optional)

        Returns a result dict with 'success' and model-specific keys.
        """
        import torch
        from PIL import Image

        image = params['image']
        output_path = Path(params['output_path'])

        if isinstance(image, (str, Path)):
            image = Image.open(image).convert('RGB')
        else:
            image = image.convert('RGB')

        # Resize to standard input dimensions
        input_dims = self._config.get('input_dimensions', [256, 256])
        image = image.resize(tuple(input_dims), Image.LANCZOS)

        # Background removal if provided
        remove_bg_fn = params.get('remove_background_fn')
        if remove_bg_fn is not None:
            image = remove_bg_fn(image)

        inference_steps = self._config.get('inference_steps', 64)
        guidance = self._config.get('guidance_scale', 15.0)

        start = time.time()

        try:
            from shap_e.diffusion.sample import sample_latents
            from shap_e.util.notebooks import decode_latent_mesh
        except ImportError as e:
            raise RuntimeError(f'Shap-E sampling modules not available: {e}')

        logger.info(f'[MODEL] Generating mesh with Shap-E ({inference_steps} steps, guidance={guidance})...')

        # Determine device from transmitter
        device = next(self._transmitter.parameters()).device

        # Sample latents conditioned on image
        latents = sample_latents(
            batch_size=1,
            model=self._image_model,
            diffusion=self._diffusion,
            guidance_scale=guidance,
            model_kwargs=dict(images=[image]),
            progress=True,
            clip_denoised=True,
            use_fp16=(device.type == 'cuda'),
            use_karras=True,
            karras_steps=inference_steps,
            sigma_min=1e-3,
            sigma_max=160,
            s_churn=0,
        )

        # Decode first latent to triangle mesh
        tri_mesh = decode_latent_mesh(self._transmitter, latents[0]).tri_mesh()

        # Export via trimesh
        self._export_mesh(tri_mesh, output_path)

        elapsed = time.time() - start
        logger.info(f'[MODEL] Shap-E mesh generated in {elapsed:.1f}s -> {output_path}')

        # FBX conversion (non-fatal, same pattern as HunyuanAdapter)
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
            'textured': False,
        }

    def _export_mesh(self, tri_mesh, output_path):
        """Export Shap-E TriMesh to GLB via trimesh."""
        import trimesh

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        mesh = trimesh.Trimesh(
            vertices=tri_mesh.verts,
            faces=tri_mesh.faces,
        )

        # Assign vertex colors if available
        if hasattr(tri_mesh, 'vertex_colors') and tri_mesh.vertex_colors is not None:
            try:
                import numpy as np
                colors = np.array(tri_mesh.vertex_colors)
                if colors.shape[0] == len(mesh.vertices):
                    # Convert float [0,1] to uint8 [0,255] if needed
                    if colors.max() <= 1.0:
                        colors = (colors * 255).astype(np.uint8)
                    # Ensure RGBA
                    if colors.shape[1] == 3:
                        alpha = np.full((colors.shape[0], 1), 255, dtype=np.uint8)
                        colors = np.hstack([colors, alpha])
                    mesh.visual.vertex_colors = colors
                    logger.info('[MODEL] Applied vertex colors to Shap-E mesh')
            except Exception as vc_err:
                logger.warning(f'[MODEL] Vertex color application failed (non-fatal): {vc_err}')

        mesh.export(str(output_path), file_type='glb')
        logger.info(f'[MODEL] Exported Shap-E mesh: {len(mesh.vertices)} verts, {len(mesh.faces)} faces')

    def unload(self):
        """Release all Shap-E models from memory."""
        self._cleanup_partial()
        super().unload()

    def _cleanup_partial(self):
        """Clean up partially loaded models."""
        if self._transmitter is not None:
            del self._transmitter
            self._transmitter = None
        if self._image_model is not None:
            del self._image_model
            self._image_model = None
        if self._diffusion is not None:
            del self._diffusion
            self._diffusion = None

    def get_info(self):
        """Return metadata for the GET /models endpoint."""
        info = super().get_info()
        info['textured'] = False
        info['description'] = 'Lightweight image-to-3D (untextured geometry)'
        info['capabilities'] = ['text_to_mesh', 'image_to_mesh']
        info['input_types'] = ['image', 'text']
        info['output_formats'] = ['glb', 'fbx']
        return info
