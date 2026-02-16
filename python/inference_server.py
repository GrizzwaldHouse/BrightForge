"""
ForgePipeline Inference Server

FastAPI server for AI-powered 3D mesh generation.
Bridges Node.js BrightForge with Python GPU inference.

Endpoints:
  POST /generate/mesh   - Image -> GLB mesh
  POST /generate/image  - Text prompt -> PNG image
  POST /generate/full   - Text prompt -> Image -> GLB mesh (two-stage)
  GET  /health          - GPU status, model loaded state
  GET  /status          - VRAM usage, current operation

Usage: python python/inference_server.py [--port 8001] [--host 127.0.0.1]
"""

import os
import sys
import uuid
import time
import logging
import tempfile
import argparse
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
import uvicorn

from model_manager import model_manager, ModelState

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger('forge3d.server')

# Output directory
BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / 'data' / 'output'
TEMP_DIR = BASE_DIR / 'data' / 'temp'


@asynccontextmanager
async def lifespan(app):
    """Startup and shutdown lifecycle."""
    logger.info('[SERVER] ForgePipeline Inference Server starting...')

    # Create directories
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    # Clean up old temp files (>24 hours)
    cleanup_temp_files()

    # Log GPU info
    vram = model_manager.get_vram_info()
    if vram.get('available'):
        logger.info(
            f'[SERVER] GPU: {vram.get("device_name")} | '
            f'VRAM: {vram.get("total_gb", 0):.1f} GB total, '
            f'{vram.get("free_gb", 0):.1f} GB free'
        )
    else:
        logger.warning('[SERVER] No CUDA GPU detected. Generation will fail.')

    yield

    # Shutdown
    logger.info('[SERVER] Shutting down...')
    model_manager.shutdown()
    cleanup_temp_files(max_age_hours=0)  # Clean all temp files
    logger.info('[SERVER] Shutdown complete')


app = FastAPI(
    title='ForgePipeline Inference Server',
    version='0.1.0',
    lifespan=lifespan,
)


def cleanup_temp_files(max_age_hours=24):
    """Remove temp files older than max_age_hours."""
    if not TEMP_DIR.exists():
        return

    cutoff = time.time() - (max_age_hours * 3600)
    count = 0
    for f in TEMP_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink()
            count += 1

    if count > 0:
        logger.info(f'[SERVER] Cleaned up {count} temp files')


def generate_job_id():
    """Generate a unique job ID."""
    return str(uuid.uuid4())[:8]


# --- Health & Status Endpoints ---

@app.get('/health')
async def health():
    """Health check with GPU status."""
    vram = model_manager.get_vram_info()
    status = model_manager.get_status()

    return {
        'status': 'healthy',
        'gpu_available': vram.get('available', False),
        'gpu_name': vram.get('device_name', 'N/A'),
        'vram_total_gb': round(vram.get('total_gb', 0), 1),
        'vram_free_gb': round(vram.get('free_gb', 0), 1),
        'models': status['models'],
        'generation_count': status['generation_count'],
    }


@app.get('/status')
async def status():
    """Detailed status with VRAM breakdown."""
    return model_manager.get_status()


# --- Generation Endpoints ---

@app.post('/generate/mesh')
async def generate_mesh(
    image: UploadFile = File(...),
    job_id: str = Form(default=None),
):
    """Generate 3D mesh from uploaded image.

    Accepts: PNG, JPG image file
    Returns: GLB mesh file
    """
    if job_id is None:
        job_id = generate_job_id()

    logger.info(f'[SERVER] Mesh generation request: job={job_id}, file={image.filename}')

    # Validate file type
    if image.content_type and image.content_type not in ('image/png', 'image/jpeg', 'image/webp'):
        raise HTTPException(400, f'Unsupported image type: {image.content_type}. Use PNG, JPG, or WebP.')

    # Validate file size (max 20MB)
    contents = await image.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(400, 'Image too large. Maximum 20 MB.')

    # Save upload to temp
    temp_image = TEMP_DIR / f'{job_id}_input.png'
    temp_image.write_bytes(contents)

    # Output path
    output_path = OUTPUT_DIR / f'{job_id}.glb'

    try:
        from PIL import Image as PILImage
        img = PILImage.open(temp_image)

        # Validate dimensions
        if max(img.size) > 4096:
            raise HTTPException(400, f'Image too large: {img.size}. Maximum 4096x4096.')

        result = model_manager.generate_mesh(img, output_path)

        if not result['success']:
            raise HTTPException(500, f'Generation failed: {result.get("error")}')

        # Return the GLB file
        return FileResponse(
            str(output_path),
            media_type='model/gltf-binary',
            filename=f'{job_id}.glb',
            headers={
                'X-Job-Id': job_id,
                'X-Generation-Time': str(result['generation_time']),
                'X-File-Size': str(result['file_size_bytes']),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[SERVER] Mesh generation error: {e}')
        raise HTTPException(500, f'Internal error: {str(e)}')

    finally:
        # Clean up temp input
        if temp_image.exists():
            temp_image.unlink()


@app.post('/generate/image')
async def generate_image(
    prompt: str = Form(...),
    width: int = Form(default=1024),
    height: int = Form(default=1024),
    steps: int = Form(default=25),
    job_id: str = Form(default=None),
):
    """Generate image from text prompt using SDXL.

    Returns: PNG image file
    """
    if job_id is None:
        job_id = generate_job_id()

    logger.info(f'[SERVER] Image generation request: job={job_id}, prompt="{prompt[:80]}"')

    # Validate dimensions
    if width < 512 or width > 2048 or height < 512 or height > 2048:
        raise HTTPException(400, 'Dimensions must be between 512 and 2048')

    if steps < 10 or steps > 100:
        raise HTTPException(400, 'Steps must be between 10 and 100')

    # Validate prompt
    if not prompt or len(prompt.strip()) < 3:
        raise HTTPException(400, 'Prompt must be at least 3 characters')

    if len(prompt) > 2000:
        raise HTTPException(400, 'Prompt must be under 2000 characters')

    output_path = OUTPUT_DIR / f'{job_id}.png'

    try:
        result = model_manager.generate_image(
            prompt=prompt.strip(),
            output_path=output_path,
            width=width,
            height=height,
            steps=steps,
        )

        if not result['success']:
            raise HTTPException(500, f'Generation failed: {result.get("error")}')

        return FileResponse(
            str(output_path),
            media_type='image/png',
            filename=f'{job_id}.png',
            headers={
                'X-Job-Id': job_id,
                'X-Generation-Time': str(result['generation_time']),
                'X-File-Size': str(result['file_size_bytes']),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[SERVER] Image generation error: {e}')
        raise HTTPException(500, f'Internal error: {str(e)}')


@app.post('/generate/full')
async def generate_full(
    prompt: str = Form(...),
    steps: int = Form(default=25),
    job_id: str = Form(default=None),
):
    """Full text-to-3D pipeline: Text -> SDXL Image -> InstantMesh Mesh.

    Two-stage pipeline with sequential VRAM management.
    Returns: JSON with paths to both image and mesh.
    """
    if job_id is None:
        job_id = generate_job_id()

    logger.info(f'[SERVER] Full pipeline request: job={job_id}, prompt="{prompt[:80]}"')

    # Validate prompt
    if not prompt or len(prompt.strip()) < 3:
        raise HTTPException(400, 'Prompt must be at least 3 characters')

    if len(prompt) > 2000:
        raise HTTPException(400, 'Prompt must be under 2000 characters')

    output_dir = OUTPUT_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = model_manager.generate_full_pipeline(
            prompt=prompt.strip(),
            output_dir=output_dir,
            steps=steps,
        )

        if not result['success']:
            raise HTTPException(
                500,
                f'Pipeline failed at stage "{result.get("stage")}": {result.get("error")}'
            )

        return JSONResponse({
            'success': True,
            'job_id': job_id,
            'total_time': result['total_time'],
            'image_path': f'/download/{job_id}/generated_image.png',
            'mesh_path': f'/download/{job_id}/generated_mesh.glb',
            'stages': result['stages'],
            'vram_after': result['vram_after'],
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[SERVER] Full pipeline error: {e}')
        raise HTTPException(500, f'Internal error: {str(e)}')


@app.get('/download/{job_id}/{filename}')
async def download_file(job_id: str, filename: str):
    """Download a generated file by job ID."""
    # Sanitize inputs
    if '..' in job_id or '..' in filename or '/' in job_id or '\\' in job_id:
        raise HTTPException(400, 'Invalid path')

    # Check both flat and nested output locations
    file_path = OUTPUT_DIR / job_id / filename
    if not file_path.exists():
        file_path = OUTPUT_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, 'File not found')

    # Verify path is within output directory
    try:
        file_path.resolve().relative_to(OUTPUT_DIR.resolve())
    except ValueError:
        raise HTTPException(403, 'Access denied')

    # Determine media type
    suffix = file_path.suffix.lower()
    media_types = {
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
    }
    media_type = media_types.get(suffix, 'application/octet-stream')

    return FileResponse(str(file_path), media_type=media_type, filename=filename)


def main():
    parser = argparse.ArgumentParser(description='ForgePipeline Inference Server')
    parser.add_argument('--port', type=int, default=8001, help='Server port (default: 8001)')
    parser.add_argument('--host', default='127.0.0.1', help='Bind address (default: 127.0.0.1)')
    parser.add_argument('--reload', action='store_true', help='Auto-reload on code changes')
    args = parser.parse_args()

    logger.info(f'[SERVER] Starting on {args.host}:{args.port}')

    uvicorn.run(
        'inference_server:app',
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level='info',
    )


if __name__ == '__main__':
    main()
