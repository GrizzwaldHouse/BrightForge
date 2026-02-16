#!/usr/bin/env python3
"""
ForgePipeline Environment Setup & Validator

Checks Python version, CUDA availability, GPU VRAM,
installs requirements, and downloads AI models.

Usage: python python/setup.py [--skip-models] [--models-dir <path>]
"""

import sys
import os
import subprocess
import argparse
import shutil
import hashlib
from pathlib import Path


# Minimum requirements
MIN_PYTHON = (3, 10)
MIN_VRAM_GB = 8
MODELS_DIR_DEFAULT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'models')

# Model registry: name -> (repo_id, subfolder, expected_size_mb)
MODELS = {
    'instantmesh': {
        'repo_id': 'TencentARC/InstantMesh',
        'description': 'Single-image to 3D mesh generation',
        'size_mb': 1500,
    },
}


def print_header(msg):
    print(f'\n{"=" * 60}')
    print(f'  {msg}')
    print(f'{"=" * 60}')


def print_ok(msg):
    print(f'  [OK] {msg}')


def print_warn(msg):
    print(f'  [WARN] {msg}')


def print_fail(msg):
    print(f'  [FAIL] {msg}')


def print_info(msg):
    print(f'  [INFO] {msg}')


def check_python():
    """Check Python version >= 3.10."""
    print_header('Checking Python Version')
    ver = sys.version_info
    print_info(f'Python {ver.major}.{ver.minor}.{ver.micro}')

    if (ver.major, ver.minor) < MIN_PYTHON:
        print_fail(f'Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+ required, you have {ver.major}.{ver.minor}')
        return False

    print_ok(f'Python {ver.major}.{ver.minor} meets minimum {MIN_PYTHON[0]}.{MIN_PYTHON[1]}')
    return True


def check_cuda():
    """Check CUDA availability via nvidia-smi."""
    print_header('Checking CUDA / GPU')

    # Check nvidia-smi
    nvidia_smi = shutil.which('nvidia-smi')
    if not nvidia_smi:
        print_fail('nvidia-smi not found. Install NVIDIA drivers.')
        print_info('Download from: https://www.nvidia.com/Download/index.aspx')
        return False, {}

    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=name,memory.total,driver_version,compute_cap',
             '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            print_fail(f'nvidia-smi failed: {result.stderr.strip()}')
            return False, {}

        line = result.stdout.strip().split('\n')[0]
        parts = [p.strip() for p in line.split(',')]
        gpu_info = {
            'name': parts[0],
            'vram_mb': int(float(parts[1])),
            'driver': parts[2],
            'compute_cap': parts[3],
        }

        print_ok(f'GPU: {gpu_info["name"]}')
        print_ok(f'VRAM: {gpu_info["vram_mb"]} MB ({gpu_info["vram_mb"] / 1024:.1f} GB)')
        print_ok(f'Driver: {gpu_info["driver"]}')
        print_ok(f'Compute Capability: {gpu_info["compute_cap"]}')

        vram_gb = gpu_info['vram_mb'] / 1024
        if vram_gb < MIN_VRAM_GB:
            print_warn(f'VRAM {vram_gb:.1f} GB is below recommended {MIN_VRAM_GB} GB')
            print_info('Generation may fail on large models. Consider closing other GPU apps.')
        else:
            print_ok(f'VRAM {vram_gb:.1f} GB meets minimum {MIN_VRAM_GB} GB')

        return True, gpu_info

    except subprocess.TimeoutExpired:
        print_fail('nvidia-smi timed out')
        return False, {}
    except Exception as e:
        print_fail(f'GPU check failed: {e}')
        return False, {}


def check_cuda_toolkit():
    """Check if CUDA toolkit is accessible."""
    print_header('Checking CUDA Toolkit')

    nvcc = shutil.which('nvcc')
    if nvcc:
        try:
            result = subprocess.run(['nvcc', '--version'], capture_output=True, text=True, timeout=10)
            for line in result.stdout.split('\n'):
                if 'release' in line.lower():
                    print_ok(f'CUDA Toolkit: {line.strip()}')
                    return True
        except Exception:
            pass

    print_warn('nvcc not found (CUDA toolkit may not be in PATH)')
    print_info('PyTorch bundles its own CUDA runtime, so this is usually fine.')
    print_info('If you encounter issues, install CUDA Toolkit from: https://developer.nvidia.com/cuda-downloads')
    return True  # Non-blocking — PyTorch bundles CUDA


def install_requirements():
    """Install Python dependencies."""
    print_header('Installing Python Dependencies')

    req_file = os.path.join(os.path.dirname(__file__), 'requirements.txt')
    if not os.path.exists(req_file):
        print_fail(f'requirements.txt not found at {req_file}')
        return False

    print_info('This may take several minutes (PyTorch is ~2.5 GB)...')

    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '-r', req_file,
             '--extra-index-url', 'https://download.pytorch.org/whl/cu124'],
            capture_output=False, text=True, timeout=600
        )
        if result.returncode != 0:
            print_fail('pip install failed. Check output above for errors.')
            return False

        print_ok('All dependencies installed successfully')
        return True

    except subprocess.TimeoutExpired:
        print_fail('Installation timed out after 10 minutes')
        return False
    except Exception as e:
        print_fail(f'Installation failed: {e}')
        return False


def verify_torch_cuda():
    """Verify PyTorch can see CUDA after installation."""
    print_header('Verifying PyTorch + CUDA')

    try:
        result = subprocess.run(
            [sys.executable, '-c',
             'import torch; print(f"PyTorch {torch.__version__}"); '
             'print(f"CUDA available: {torch.cuda.is_available()}"); '
             'print(f"CUDA version: {torch.version.cuda}"); '
             'print(f"GPU count: {torch.cuda.device_count()}"); '
             'print(f"GPU name: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else "N/A"}")'],
            capture_output=True, text=True, timeout=30
        )

        for line in result.stdout.strip().split('\n'):
            if 'available: True' in line:
                print_ok(line.strip())
            elif 'available: False' in line:
                print_fail(line.strip())
                print_info('PyTorch installed but cannot access GPU.')
                print_info('Try: pip install torch --extra-index-url https://download.pytorch.org/whl/cu124')
                return False
            else:
                print_ok(line.strip())

        return 'available: True' in result.stdout

    except Exception as e:
        print_fail(f'PyTorch verification failed: {e}')
        return False


def download_models(models_dir):
    """Download required AI models from Hugging Face."""
    print_header('Downloading AI Models')

    models_path = Path(models_dir)
    models_path.mkdir(parents=True, exist_ok=True)

    print_info(f'Models directory: {models_path}')

    for name, info in MODELS.items():
        model_dir = models_path / name
        marker = model_dir / '.download_complete'

        if marker.exists():
            print_ok(f'{name}: Already downloaded')
            continue

        print_info(f'Downloading {name} (~{info["size_mb"]} MB)...')
        print_info(f'  Repo: {info["repo_id"]}')
        print_info(f'  Description: {info["description"]}')

        try:
            result = subprocess.run(
                [sys.executable, '-c',
                 f'from huggingface_hub import snapshot_download; '
                 f'snapshot_download("{info["repo_id"]}", '
                 f'local_dir=r"{model_dir}", '
                 f'ignore_patterns=["*.md", "*.txt", "examples/*"])'],
                capture_output=False, text=True, timeout=1800  # 30 min max
            )

            if result.returncode != 0:
                print_fail(f'{name}: Download failed')
                continue

            # Write completion marker
            marker.write_text('ok')
            print_ok(f'{name}: Downloaded successfully')

        except subprocess.TimeoutExpired:
            print_fail(f'{name}: Download timed out (30 min)')
        except Exception as e:
            print_fail(f'{name}: Download error: {e}')

    return True


def create_data_dirs():
    """Create runtime data directories."""
    print_header('Creating Data Directories')

    base = Path(os.path.dirname(os.path.dirname(__file__)))
    dirs = [
        base / 'data',
        base / 'data' / 'models',
        base / 'data' / 'output',
        base / 'data' / 'temp',
    ]

    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        print_ok(f'Created: {d}')

    # Add .gitkeep to empty dirs
    for d in dirs:
        gitkeep = d / '.gitkeep'
        if not any(d.iterdir()) or (len(list(d.iterdir())) == 1 and gitkeep.exists()):
            gitkeep.touch()

    return True


def main():
    parser = argparse.ArgumentParser(description='ForgePipeline Environment Setup')
    parser.add_argument('--skip-models', action='store_true', help='Skip model downloads')
    parser.add_argument('--skip-install', action='store_true', help='Skip pip install')
    parser.add_argument('--models-dir', default=MODELS_DIR_DEFAULT, help='Model storage directory')
    parser.add_argument('--check-only', action='store_true', help='Only check environment, no installs')
    args = parser.parse_args()

    print('\n' + '=' * 60)
    print('  ForgePipeline Environment Setup')
    print('  AI-Powered 3D Generation System')
    print('=' * 60)

    errors = []

    # 1. Check Python
    if not check_python():
        errors.append('Python version too old')

    # 2. Check GPU
    cuda_ok, gpu_info = check_cuda()
    if not cuda_ok:
        errors.append('No NVIDIA GPU detected')

    # 3. Check CUDA toolkit
    check_cuda_toolkit()

    if args.check_only:
        if errors:
            print_header('SETUP CHECK FAILED')
            for e in errors:
                print_fail(e)
            return 1
        print_header('SETUP CHECK PASSED')
        return 0

    # 4. Create data directories
    create_data_dirs()

    # 5. Install dependencies
    if not args.skip_install:
        if not install_requirements():
            errors.append('Dependency installation failed')
        else:
            # Verify PyTorch + CUDA
            if not verify_torch_cuda():
                errors.append('PyTorch cannot access CUDA')
    else:
        print_info('Skipping dependency installation (--skip-install)')

    # 6. Download models
    if not args.skip_models:
        download_models(args.models_dir)
    else:
        print_info('Skipping model downloads (--skip-models)')

    # Summary
    if errors:
        print_header('SETUP COMPLETED WITH ERRORS')
        for e in errors:
            print_fail(e)
        print_info('Fix the issues above and re-run setup.')
        return 1

    print_header('SETUP COMPLETE')
    print_ok('Environment is ready for ForgePipeline')
    print_info('Start the inference server with:')
    print_info('  python python/inference_server.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
