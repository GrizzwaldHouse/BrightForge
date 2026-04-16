#!/usr/bin/env python3
"""
Model Scanner - Standalone utility for model file analysis.

Provides SHA256 hashing and safetensors header analysis.
Invoked from Node.js via child_process.execFile.

Usage:
    py -3 model_scanner.py --hash <filepath>
    py -3 model_scanner.py --batch-hash <json_file>
    py -3 model_scanner.py --analyze <filepath>
    py -3 model_scanner.py --test
"""

import argparse
import hashlib
import json
import os
import struct
import sys
import time


def hash_file(filepath, chunk_size=8192 * 1024):
    """Compute SHA256 hash of a file, reading in chunks."""
    if not os.path.isfile(filepath):
        return {"error": f"File not found: {filepath}", "path": filepath}

    sha256 = hashlib.sha256()
    size = os.path.getsize(filepath)
    bytes_read = 0

    try:
        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                sha256.update(chunk)
                bytes_read += len(chunk)

        return {
            "path": filepath,
            "sha256": sha256.hexdigest(),
            "size_bytes": size
        }
    except PermissionError:
        return {"error": f"Permission denied: {filepath}", "path": filepath}
    except Exception as e:
        return {"error": str(e), "path": filepath}


def batch_hash(json_file):
    """Hash multiple files listed in a JSON file."""
    if not os.path.isfile(json_file):
        return {"error": f"JSON file not found: {json_file}"}

    try:
        with open(json_file, "r", encoding="utf-8") as f:
            file_list = json.load(f)
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {e}"}

    if not isinstance(file_list, list):
        return {"error": "JSON must contain an array of file paths"}

    results = []
    for filepath in file_list:
        result = hash_file(filepath)
        results.append(result)

    return {
        "total": len(file_list),
        "successful": sum(1 for r in results if "sha256" in r),
        "failed": sum(1 for r in results if "error" in r),
        "results": results
    }


def analyze_safetensors(filepath):
    """Read safetensors header and extract metadata."""
    if not os.path.isfile(filepath):
        return {"error": f"File not found: {filepath}", "path": filepath}

    if not filepath.lower().endswith(".safetensors"):
        return {"error": "Not a safetensors file", "path": filepath}

    try:
        with open(filepath, "rb") as f:
            # Safetensors format: 8-byte little-endian header length, then JSON header
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8:
                return {"error": "File too small for safetensors format", "path": filepath}

            header_size = struct.unpack("<Q", header_size_bytes)[0]

            # Sanity check: header shouldn't be larger than 100MB
            if header_size > 100 * 1024 * 1024:
                return {"error": f"Header size too large: {header_size}", "path": filepath}

            header_bytes = f.read(header_size)
            if len(header_bytes) < header_size:
                return {"error": "Truncated header", "path": filepath}

            header = json.loads(header_bytes.decode("utf-8"))

        # Extract metadata
        metadata = header.pop("__metadata__", {})

        # Count tensors and analyze dtypes
        tensor_count = len(header)
        dtypes = {}
        total_params = 0

        for tensor_name, tensor_info in header.items():
            dtype = tensor_info.get("dtype", "unknown")
            shape = tensor_info.get("shape", [])
            dtypes[dtype] = dtypes.get(dtype, 0) + 1

            # Calculate parameter count from shape
            if shape:
                params = 1
                for dim in shape:
                    params *= dim
                total_params += params

        # Try to determine architecture from tensor names
        architecture = _detect_architecture(header)

        return {
            "path": filepath,
            "size_bytes": os.path.getsize(filepath),
            "header_size": header_size,
            "tensor_count": tensor_count,
            "total_parameters": total_params,
            "dtypes": dtypes,
            "architecture": architecture,
            "metadata": metadata
        }

    except json.JSONDecodeError:
        return {"error": "Invalid JSON in safetensors header", "path": filepath}
    except PermissionError:
        return {"error": f"Permission denied: {filepath}", "path": filepath}
    except Exception as e:
        return {"error": str(e), "path": filepath}


def _detect_architecture(header):
    """Detect model architecture from tensor names."""
    tensor_names = set(header.keys())
    sample = list(tensor_names)[:50]
    name_str = " ".join(sample).lower()

    if "model.layers" in name_str and "self_attn" in name_str:
        if "mlp.gate_proj" in name_str:
            return "llama"
        if "mlp.dense" in name_str:
            return "phi"
        return "transformer"
    if "transformer.h" in name_str or "transformer.wte" in name_str:
        return "gpt2"
    if "encoder.layer" in name_str and "decoder.layer" in name_str:
        return "t5"
    if "encoder.layer" in name_str:
        return "bert"
    if "model.decoder.layers" in name_str:
        return "opt"
    if "language_model" in name_str:
        return "vision-language"
    if "unet" in name_str or "down_blocks" in name_str:
        return "diffusion"
    if "text_model" in name_str and "vision_model" in name_str:
        return "clip"

    return "unknown"


def run_tests():
    """Self-test block."""
    import tempfile

    print("Testing model_scanner.py...\n")
    passed = 0
    total = 0

    # Test 1: hash_file on a known string
    total += 1
    print("[TEST] Test 1: SHA256 hash of known content...")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".bin") as tmp:
        tmp.write(b"hello world")
        tmp_path = tmp.name

    try:
        result = hash_file(tmp_path)
        expected = hashlib.sha256(b"hello world").hexdigest()
        assert result["sha256"] == expected, f"Hash mismatch: {result['sha256']} != {expected}"
        assert result["size_bytes"] == 11, f"Size mismatch: {result['size_bytes']}"
        print("[TEST] Test 1: PASSED")
        passed += 1
    finally:
        os.unlink(tmp_path)

    # Test 2: hash_file on nonexistent file
    total += 1
    print("\n[TEST] Test 2: Hash of nonexistent file...")
    result = hash_file("/nonexistent/file.bin")
    assert "error" in result, "Should return error for missing file"
    print("[TEST] Test 2: PASSED")
    passed += 1

    # Test 3: batch_hash
    total += 1
    print("\n[TEST] Test 3: Batch hash...")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".bin", mode="wb") as tmp1:
        tmp1.write(b"file1")
        path1 = tmp1.name
    with tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w") as tmp_json:
        json.dump([path1, "/nonexistent.bin"], tmp_json)
        json_path = tmp_json.name

    try:
        result = batch_hash(json_path)
        assert result["total"] == 2, f"Total should be 2, got {result['total']}"
        assert result["successful"] == 1, f"Successful should be 1, got {result['successful']}"
        assert result["failed"] == 1, f"Failed should be 1, got {result['failed']}"
        print("[TEST] Test 3: PASSED")
        passed += 1
    finally:
        os.unlink(path1)
        os.unlink(json_path)

    # Test 4: analyze non-safetensors file
    total += 1
    print("\n[TEST] Test 4: Analyze non-safetensors file...")
    result = analyze_safetensors("test.bin")
    assert "error" in result, "Should reject non-safetensors"
    print("[TEST] Test 4: PASSED")
    passed += 1

    # Test 5: analyze valid safetensors
    total += 1
    print("\n[TEST] Test 5: Analyze synthetic safetensors...")
    header = {
        "__metadata__": {"format": "pt", "source": "test"},
        "model.layers.0.self_attn.q_proj.weight": {
            "dtype": "F16",
            "shape": [4096, 4096],
            "data_offsets": [0, 33554432]
        },
        "model.layers.0.mlp.gate_proj.weight": {
            "dtype": "F16",
            "shape": [11008, 4096],
            "data_offsets": [33554432, 123731968]
        }
    }
    header_json = json.dumps(header).encode("utf-8")
    header_size = struct.pack("<Q", len(header_json))

    with tempfile.NamedTemporaryFile(delete=False, suffix=".safetensors") as tmp:
        tmp.write(header_size)
        tmp.write(header_json)
        # Write fake tensor data
        tmp.write(b"\x00" * 1024)
        st_path = tmp.name

    try:
        result = analyze_safetensors(st_path)
        assert "error" not in result, f"Should succeed: {result.get('error')}"
        assert result["tensor_count"] == 2, f"Should have 2 tensors, got {result['tensor_count']}"
        assert result["architecture"] == "llama", f"Should detect llama, got {result['architecture']}"
        assert result["total_parameters"] == 4096 * 4096 + 11008 * 4096
        assert result["metadata"]["format"] == "pt"
        print("[TEST] Test 5: PASSED")
        passed += 1
    finally:
        os.unlink(st_path)

    # Test 6: architecture detection
    total += 1
    print("\n[TEST] Test 6: Architecture detection patterns...")
    assert _detect_architecture({"transformer.h.0.attn": {}}) == "gpt2"
    assert _detect_architecture({"encoder.layer.0.a": {}, "decoder.layer.0.a": {}}) == "t5"
    assert _detect_architecture({"unet.down_blocks.0": {}}) == "diffusion"
    assert _detect_architecture({"random_key": {}}) == "unknown"
    print("[TEST] Test 6: PASSED")
    passed += 1

    print(f"\n[TEST] All {passed}/{total} tests PASSED!")
    print("model_scanner.py test PASSED")


def main():
    parser = argparse.ArgumentParser(description="Model file scanner utility")
    parser.add_argument("--hash", metavar="FILEPATH", help="SHA256 hash a single file")
    parser.add_argument("--batch-hash", metavar="JSON_FILE", help="Hash files listed in JSON")
    parser.add_argument("--analyze", metavar="FILEPATH", help="Analyze safetensors header")
    parser.add_argument("--test", action="store_true", help="Run self-tests")

    args = parser.parse_args()

    if args.test:
        run_tests()
        return

    if args.hash:
        result = hash_file(args.hash)
        print(json.dumps(result))
    elif args.batch_hash:
        result = batch_hash(args.batch_hash)
        print(json.dumps(result))
    elif args.analyze:
        result = analyze_safetensors(args.analyze)
        print(json.dumps(result))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
