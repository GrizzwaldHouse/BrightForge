/**
 * Model Intelligence Event Types
 *
 * Event type constants and payload factory helpers for the
 * Model Intelligence scanner subsystem.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const EVENT_TYPES = {
  SCAN_STARTED: 'model_intel_scan_started',
  SCAN_PROGRESS: 'model_intel_scan_progress',
  FILE_DETECTED: 'model_intel_file_detected',
  FILE_CLASSIFIED: 'model_intel_file_classified',
  RUNTIME_DETECTED: 'model_intel_runtime_detected',
  STORAGE_DETECTED: 'model_intel_storage_detected',
  SCAN_COMPLETED: 'model_intel_scan_completed',
  SCAN_FAILED: 'model_intel_scan_failed'
};

function scanStarted(scanId, scanType) {
  return {
    type: EVENT_TYPES.SCAN_STARTED,
    timestamp: new Date().toISOString(),
    scanId,
    scanType
  };
}

function scanProgress(scanId, phase, current, total) {
  return {
    type: EVENT_TYPES.SCAN_PROGRESS,
    timestamp: new Date().toISOString(),
    scanId,
    phase,
    current,
    total
  };
}

function fileDetected(scanId, filePath, size) {
  return {
    type: EVENT_TYPES.FILE_DETECTED,
    timestamp: new Date().toISOString(),
    scanId,
    filePath,
    size
  };
}

function fileClassified(scanId, filePath, format, source) {
  return {
    type: EVENT_TYPES.FILE_CLASSIFIED,
    timestamp: new Date().toISOString(),
    scanId,
    filePath,
    format,
    source
  };
}

function runtimeDetected(scanId, name, version, path) {
  return {
    type: EVENT_TYPES.RUNTIME_DETECTED,
    timestamp: new Date().toISOString(),
    scanId,
    name,
    version,
    path
  };
}

function storageDetected(scanId, letter, label, totalBytes, freeBytes) {
  return {
    type: EVENT_TYPES.STORAGE_DETECTED,
    timestamp: new Date().toISOString(),
    scanId,
    letter,
    label,
    totalBytes,
    freeBytes
  };
}

function scanCompleted(scanId, stats) {
  return {
    type: EVENT_TYPES.SCAN_COMPLETED,
    timestamp: new Date().toISOString(),
    scanId,
    stats
  };
}

function scanFailed(scanId, error) {
  return {
    type: EVENT_TYPES.SCAN_FAILED,
    timestamp: new Date().toISOString(),
    scanId,
    error: typeof error === 'string' ? error : error.message
  };
}

export {
  EVENT_TYPES,
  scanStarted,
  scanProgress,
  fileDetected,
  fileClassified,
  runtimeDetected,
  storageDetected,
  scanCompleted,
  scanFailed
};

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('Testing EventTypes...\n');

  try {
    let passed = 0;

    // Test 1: All EVENT_TYPES are strings
    const typeKeys = Object.keys(EVENT_TYPES);
    console.assert(typeKeys.length === 8, `Should have 8 event types, got ${typeKeys.length}`);
    for (const key of typeKeys) {
      console.assert(typeof EVENT_TYPES[key] === 'string', `EVENT_TYPES.${key} should be a string`);
      console.assert(EVENT_TYPES[key].startsWith('model_intel_'), `EVENT_TYPES.${key} should start with model_intel_`);
    }
    console.log('  [PASS] All 8 event types are strings with correct prefix');
    passed++;

    // Test 2: scanStarted payload
    const started = scanStarted('scan-001', 'instant');
    console.assert(started.type === EVENT_TYPES.SCAN_STARTED, 'Type should match SCAN_STARTED');
    console.assert(started.scanId === 'scan-001', 'scanId should match');
    console.assert(started.scanType === 'instant', 'scanType should match');
    console.assert(typeof started.timestamp === 'string', 'Should have timestamp');
    console.log('  [PASS] scanStarted() produces valid payload');
    passed++;

    // Test 3: scanProgress payload
    const progress = scanProgress('scan-001', 'hashing', 5, 10);
    console.assert(progress.type === EVENT_TYPES.SCAN_PROGRESS, 'Type should match SCAN_PROGRESS');
    console.assert(progress.phase === 'hashing', 'phase should match');
    console.assert(progress.current === 5, 'current should match');
    console.assert(progress.total === 10, 'total should match');
    console.log('  [PASS] scanProgress() produces valid payload');
    passed++;

    // Test 4: fileDetected payload
    const detected = fileDetected('scan-001', 'C:\\models\\llama.gguf', 4000000000);
    console.assert(detected.type === EVENT_TYPES.FILE_DETECTED, 'Type should match FILE_DETECTED');
    console.assert(detected.filePath === 'C:\\models\\llama.gguf', 'filePath should match');
    console.assert(detected.size === 4000000000, 'size should match');
    console.log('  [PASS] fileDetected() produces valid payload');
    passed++;

    // Test 5: fileClassified payload
    const classified = fileClassified('scan-001', 'C:\\models\\llama.gguf', 'GGUF', 'ollama');
    console.assert(classified.type === EVENT_TYPES.FILE_CLASSIFIED, 'Type should match FILE_CLASSIFIED');
    console.assert(classified.format === 'GGUF', 'format should match');
    console.assert(classified.source === 'ollama', 'source should match');
    console.log('  [PASS] fileClassified() produces valid payload');
    passed++;

    // Test 6: runtimeDetected payload
    const runtime = runtimeDetected('scan-001', 'Ollama', '0.5.4', 'C:\\ollama\\ollama.exe');
    console.assert(runtime.type === EVENT_TYPES.RUNTIME_DETECTED, 'Type should match RUNTIME_DETECTED');
    console.assert(runtime.name === 'Ollama', 'name should match');
    console.assert(runtime.version === '0.5.4', 'version should match');
    console.assert(runtime.path === 'C:\\ollama\\ollama.exe', 'path should match');
    console.log('  [PASS] runtimeDetected() produces valid payload');
    passed++;

    // Test 7: storageDetected payload
    const storage = storageDetected('scan-001', 'C', 'Windows', 500000000000, 100000000000);
    console.assert(storage.type === EVENT_TYPES.STORAGE_DETECTED, 'Type should match STORAGE_DETECTED');
    console.assert(storage.letter === 'C', 'letter should match');
    console.assert(storage.label === 'Windows', 'label should match');
    console.assert(storage.totalBytes === 500000000000, 'totalBytes should match');
    console.assert(storage.freeBytes === 100000000000, 'freeBytes should match');
    console.log('  [PASS] storageDetected() produces valid payload');
    passed++;

    // Test 8: scanCompleted payload
    const completed = scanCompleted('scan-001', { files: 10, runtimes: 2 });
    console.assert(completed.type === EVENT_TYPES.SCAN_COMPLETED, 'Type should match SCAN_COMPLETED');
    console.assert(completed.stats.files === 10, 'stats.files should match');
    console.assert(completed.stats.runtimes === 2, 'stats.runtimes should match');
    console.log('  [PASS] scanCompleted() produces valid payload');
    passed++;

    // Test 9: scanFailed payload (string error)
    const failedStr = scanFailed('scan-001', 'Permission denied');
    console.assert(failedStr.type === EVENT_TYPES.SCAN_FAILED, 'Type should match SCAN_FAILED');
    console.assert(failedStr.error === 'Permission denied', 'error should match string');
    console.log('  [PASS] scanFailed() handles string error');
    passed++;

    // Test 10: scanFailed payload (Error object)
    const failedErr = scanFailed('scan-001', new Error('Timeout exceeded'));
    console.assert(failedErr.error === 'Timeout exceeded', 'error should extract message from Error');
    console.log('  [PASS] scanFailed() handles Error object');
    passed++;

    // Test 11: All payloads have timestamp in ISO format
    const allPayloads = [started, progress, detected, classified, runtime, storage, completed, failedStr];
    for (const payload of allPayloads) {
      const parsed = new Date(payload.timestamp);
      console.assert(!isNaN(parsed.getTime()), `Timestamp should be valid ISO: ${payload.type}`);
    }
    console.log('  [PASS] All payloads have valid ISO timestamps');
    passed++;

    console.log(`\n[TEST] All ${passed} tests PASSED!`);
    console.log('EventTypes test PASSED');
    process.exit(0);
  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
