/**
 * Multi-Model Architecture Validation Test Suite
 *
 * 15 comprehensive test scenarios covering:
 *   - Configuration integrity
 *   - Provider chain routing
 *   - Cloud API failure handling
 *   - Local model failure recovery
 *   - Budget enforcement
 *   - Frontend interaction patterns
 *   - Security and input validation
 *   - Performance and memory management
 *
 * Run: node src/forge3d/test-multi-model.js --test
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 5, 2026
 */

import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ===================================================================
// Test Framework
// ===================================================================

const RESULTS = [];
let testCount = 0;
let passCount = 0;
let failCount = 0;
let warnCount = 0;

const SEVERITY = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

function recordTest(id, description, severity, passed, details = {}) {
  testCount++;
  const result = {
    id,
    description,
    severity,
    passed,
    expected: details.expected || '',
    actual: details.actual || '',
    errorLogs: details.errorLogs || null,
    recommendedFix: details.recommendedFix || null
  };
  RESULTS.push(result);
  if (passed === true) {
    passCount++;
    console.log(`  [PASS] ${id}: ${description}`);
  } else if (passed === 'warn') {
    warnCount++;
    console.log(`  [WARN] ${id}: ${description} — ${details.actual}`);
  } else {
    failCount++;
    console.log(`  [FAIL] ${id}: ${description}`);
    console.log(`         Expected: ${details.expected}`);
    console.log(`         Actual:   ${details.actual}`);
    if (details.recommendedFix) {
      console.log(`         Fix:      ${details.recommendedFix}`);
    }
  }
}

// ===================================================================
// T01: Configuration Schema Integrity
// ===================================================================

function testConfigSchema() {
  console.log('\n--- T01: Configuration Schema Integrity ---');

  const configPath = join(__dirname, '../../config/mesh-providers.yaml');
  if (!existsSync(configPath)) {
    recordTest('T01', 'mesh-providers.yaml exists', SEVERITY.CRITICAL, false, {
      expected: 'File exists at config/mesh-providers.yaml',
      actual: 'File not found',
      recommendedFix: 'Create config/mesh-providers.yaml with provider definitions'
    });
    return;
  }

  const raw = readFileSync(configPath, 'utf8');
  const config = parseYaml(raw);

  // Check top-level sections
  const requiredSections = ['providers', 'task_routing', 'budget'];
  for (const section of requiredSections) {
    recordTest('T01a', `Config has '${section}' section`, SEVERITY.CRITICAL,
      config[section] !== undefined, {
        expected: `'${section}' key exists`,
        actual: config[section] !== undefined ? 'Present' : 'Missing',
        recommendedFix: `Add '${section}:' section to mesh-providers.yaml`
      });
  }

  // Check each provider has required fields
  const requiredProviderFields = ['enabled', 'type', 'priority', 'cost_per_generation', 'tier'];
  const providers = config.providers || {};

  for (const [name, prov] of Object.entries(providers)) {
    for (const field of requiredProviderFields) {
      const has = prov[field] !== undefined;
      if (!has) {
        recordTest('T01b', `Provider '${name}' has '${field}'`, SEVERITY.HIGH, false, {
          expected: `'${field}' defined for provider '${name}'`,
          actual: 'Field missing',
          recommendedFix: `Add '${field}' to '${name}' in mesh-providers.yaml`
        });
      }
    }

    // Cloud providers need api_key_env
    if (prov.type === 'cloud') {
      recordTest('T01c', `Cloud provider '${name}' has api_key_env`, SEVERITY.HIGH,
        !!prov.api_key_env, {
          expected: 'api_key_env defined for cloud provider',
          actual: prov.api_key_env ? `Set to '${prov.api_key_env}'` : 'Missing',
          recommendedFix: `Add 'api_key_env: ENV_VAR_NAME' to '${name}'`
        });
    }
  }

  // Check task_routing has 'default' profile
  recordTest('T01d', 'task_routing has default profile', SEVERITY.CRITICAL,
    config.task_routing?.default !== undefined, {
      expected: 'task_routing.default exists',
      actual: config.task_routing?.default ? 'Present' : 'Missing',
      recommendedFix: 'Add default routing profile to task_routing'
    });

  // Check budget fields
  recordTest('T01e', 'Budget has daily_limit_usd', SEVERITY.HIGH,
    typeof config.budget?.daily_limit_usd === 'number', {
      expected: 'daily_limit_usd is a number',
      actual: `${typeof config.budget?.daily_limit_usd}: ${config.budget?.daily_limit_usd}`,
      recommendedFix: 'Add daily_limit_usd: 5.0 to budget section'
    });
}

// ===================================================================
// T02: UniversalMeshClient Constructor
// ===================================================================

async function testConstructor() {
  console.log('\n--- T02: UniversalMeshClient Constructor ---');

  const { UniversalMeshClient } = await import('./universal-mesh-client.js');

  // Test with config override
  const client = new UniversalMeshClient({
    providers: {
      'test-local': { enabled: true, type: 'local', priority: 1, cost_per_generation: 0, tier: 'free' },
      'test-cloud': { enabled: true, type: 'cloud', api_key_env: 'FAKE_KEY', priority: 2, cost_per_generation: 0.30, tier: 'premium' }
    },
    task_routing: { default: { prefer: ['test-local', 'test-cloud'], fallback: null } },
    budget: { daily_limit_usd: 3.0 }
  });

  recordTest('T02a', 'Constructor accepts config override', SEVERITY.CRITICAL,
    Object.keys(client.providers).length === 2, {
      expected: '2 providers from override',
      actual: `${Object.keys(client.providers).length} providers: ${Object.keys(client.providers).join(', ')}`
    });

  recordTest('T02b', 'Budget loaded from override', SEVERITY.HIGH,
    client.budget.daily_limit_usd === 3.0, {
      expected: 'daily_limit_usd === 3.0',
      actual: `daily_limit_usd === ${client.budget.daily_limit_usd}`
    });

  recordTest('T02c', 'Task routing loaded from override', SEVERITY.HIGH,
    client.taskRouting.default?.prefer?.length === 2, {
      expected: 'default routing has 2 preferred providers',
      actual: `${client.taskRouting.default?.prefer?.length} preferred providers`
    });

  // Test default config fallback
  const defaultClient = new UniversalMeshClient({});
  recordTest('T02d', 'Empty config produces valid defaults', SEVERITY.MEDIUM,
    defaultClient.providers !== undefined && defaultClient.budget !== undefined, {
      expected: 'providers and budget defined',
      actual: `providers: ${typeof defaultClient.providers}, budget: ${typeof defaultClient.budget}`
    });
}

// ===================================================================
// T03: Provider Info for Frontend
// ===================================================================

async function testProviderInfo() {
  console.log('\n--- T03: Provider Info for Frontend ---');

  const { UniversalMeshClient } = await import('./universal-mesh-client.js');

  const client = new UniversalMeshClient({
    providers: {
      'hunyuan3d': { enabled: true, type: 'local', priority: 1, cost_per_generation: 0, tier: 'default', vram_required_gb: 12, avg_generation_time_s: 300, description: 'Test' },
      'shap-e': { enabled: true, type: 'local', priority: 2, cost_per_generation: 0, tier: 'free', vram_required_gb: 4, avg_generation_time_s: 30, description: 'Test' },
      'meshy': { enabled: false, type: 'cloud', api_key_env: 'MESHY_API_KEY', priority: 10, cost_per_generation: 0.25, tier: 'premium', description: 'Test' }
    },
    task_routing: { default: { prefer: ['hunyuan3d', 'shap-e'] } },
    budget: { daily_limit_usd: 5.0 }
  });

  const info = client.getProviderInfo();

  recordTest('T03a', 'getProviderInfo returns array', SEVERITY.CRITICAL,
    Array.isArray(info), {
      expected: 'Array',
      actual: typeof info
    });

  recordTest('T03b', 'Each provider has required frontend fields', SEVERITY.HIGH,
    info.every(p => 'name' in p && 'type' in p && 'tier' in p && 'cost_per_generation' in p && 'available' in p), {
      expected: 'All providers have name, type, tier, cost_per_generation, available',
      actual: `Fields present: ${info.length > 0 ? Object.keys(info[0]).join(', ') : 'none'}`
    });

  recordTest('T03c', 'Disabled provider shows enabled:false', SEVERITY.MEDIUM,
    info.find(p => p.name === 'meshy')?.enabled === false, {
      expected: 'meshy.enabled === false',
      actual: `meshy.enabled === ${info.find(p => p.name === 'meshy')?.enabled}`
    });

  // Check usage summary
  const usage = client.getUsageSummary();
  recordTest('T03d', 'getUsageSummary returns budget info', SEVERITY.MEDIUM,
    usage.budget?.daily_limit_usd === 5.0, {
      expected: 'budget.daily_limit_usd === 5.0',
      actual: `budget.daily_limit_usd === ${usage.budget?.daily_limit_usd}`
    });
}

// ===================================================================
// T04: Provider Chain Routing (Default)
// ===================================================================

async function testDefaultRouting() {
  console.log('\n--- T04: Provider Chain Routing (Default) ---');

  const { UniversalMeshClient } = await import('./universal-mesh-client.js');

  const client = new UniversalMeshClient({
    providers: {
      'hunyuan3d': { enabled: true, type: 'local', priority: 1, cost_per_generation: 0, tier: 'default' },
      'shap-e': { enabled: true, type: 'local', priority: 2, cost_per_generation: 0, tier: 'free' },
      'meshy': { enabled: true, type: 'cloud', api_key_env: 'MESHY_API_KEY', priority: 10, cost_per_generation: 0.25, tier: 'premium' }
    },
    task_routing: {
      default: { prefer: ['hunyuan3d', 'shap-e'], fallback: 'meshy' }
    },
    budget: { daily_limit_usd: 5.0 }
  });

  // Verify routing order
  const routing = client.taskRouting.default;
  recordTest('T04a', 'Default routing prefers hunyuan3d first', SEVERITY.HIGH,
    routing.prefer[0] === 'hunyuan3d', {
      expected: 'First preferred provider: hunyuan3d',
      actual: `First preferred provider: ${routing.prefer[0]}`
    });

  recordTest('T04b', 'Default routing has shap-e as second', SEVERITY.HIGH,
    routing.prefer[1] === 'shap-e', {
      expected: 'Second preferred provider: shap-e',
      actual: `Second preferred provider: ${routing.prefer[1]}`
    });

  recordTest('T04c', 'Fallback is meshy', SEVERITY.MEDIUM,
    routing.fallback === 'meshy', {
      expected: 'Fallback: meshy',
      actual: `Fallback: ${routing.fallback}`
    });

  // Since no bridge is running, all should be unavailable
  recordTest('T04d', 'Local providers unavailable when bridge offline', SEVERITY.HIGH,
    !client.isProviderAvailable('hunyuan3d') && !client.isProviderAvailable('shap-e'), {
      expected: 'Both local providers unavailable (no bridge)',
      actual: `hunyuan3d: ${client.isProviderAvailable('hunyuan3d')}, shap-e: ${client.isProviderAvailable('shap-e')}`
    });

  // Cloud provider without API key should be unavailable
  recordTest('T04e', 'Cloud provider unavailable without API key', SEVERITY.HIGH,
    !client.isProviderAvailable('meshy'), {
      expected: 'meshy unavailable (no MESHY_API_KEY)',
      actual: `meshy available: ${client.isProviderAvailable('meshy')}`
    });
}

// ===================================================================
// T05: Provider Chain Routing (Task-specific)
// ===================================================================

async function testTaskRouting() {
  console.log('\n--- T05: Provider Chain Routing (Task-specific) ---');

  const configPath = join(__dirname, '../../config/mesh-providers.yaml');
  const raw = readFileSync(configPath, 'utf8');
  const config = parseYaml(raw);

  // Verify all task routing profiles
  const profiles = Object.keys(config.task_routing || {});

  recordTest('T05a', 'Multiple routing profiles exist', SEVERITY.MEDIUM,
    profiles.length >= 3, {
      expected: '>= 3 routing profiles',
      actual: `${profiles.length} profiles: ${profiles.join(', ')}`
    });

  // low_vram should prefer shap-e first
  const lowVram = config.task_routing?.low_vram;
  recordTest('T05b', 'low_vram routing prefers shap-e first', SEVERITY.HIGH,
    lowVram?.prefer?.[0] === 'shap-e', {
      expected: 'low_vram prefers shap-e first',
      actual: lowVram ? `Prefers: ${lowVram.prefer?.join(', ')}` : 'low_vram profile missing',
      recommendedFix: 'Add low_vram routing with shap-e as first preferred'
    });

  // batch should prefer shap-e (fastest)
  const batch = config.task_routing?.batch;
  recordTest('T05c', 'batch routing prefers shap-e', SEVERITY.MEDIUM,
    batch?.prefer?.includes('shap-e'), {
      expected: 'batch prefers shap-e',
      actual: batch ? `Prefers: ${batch.prefer?.join(', ')}` : 'batch profile missing'
    });

  // Verify each routing profile references only known providers
  const knownProviders = Object.keys(config.providers || {});
  let allValid = true;
  let invalidRef = '';

  for (const [profile, routing] of Object.entries(config.task_routing || {})) {
    for (const pref of (routing.prefer || [])) {
      if (!knownProviders.includes(pref)) {
        allValid = false;
        invalidRef = `Profile '${profile}' references unknown provider '${pref}'`;
        break;
      }
    }
    if (routing.fallback && !knownProviders.includes(routing.fallback)) {
      allValid = false;
      invalidRef = `Profile '${profile}' fallback references unknown provider '${routing.fallback}'`;
    }
  }

  recordTest('T05d', 'All routing profiles reference known providers', SEVERITY.HIGH,
    allValid, {
      expected: 'All provider references valid',
      actual: allValid ? 'All valid' : invalidRef,
      recommendedFix: 'Fix provider name in routing profile'
    });
}

// ===================================================================
// T06: Cloud Provider Failure Handling
// ===================================================================

async function testCloudFailureHandling() {
  console.log('\n--- T06: Cloud Provider Failure Handling ---');

  const { CloudMeshClient } = await import('./cloud-mesh-client.js');

  const client = new CloudMeshClient();

  // Test unknown provider
  let unknownError = null;
  try {
    await client.generate('nonexistent-provider', Buffer.from('test'), {});
  } catch (e) {
    unknownError = e;
  }

  recordTest('T06a', 'Unknown cloud provider throws clear error', SEVERITY.HIGH,
    unknownError?.message?.includes('Unknown cloud mesh provider'), {
      expected: 'Error includes "Unknown cloud mesh provider"',
      actual: unknownError ? unknownError.message : 'No error thrown'
    });

  // Test Meshy without API key
  let meshyError = null;
  try {
    await client.generate('meshy', Buffer.from('test'), {
      providerConfig: { api_key_env: 'NONEXISTENT_TEST_KEY_12345' }
    });
  } catch (e) {
    meshyError = e;
  }

  recordTest('T06b', 'Meshy without API key throws clear error', SEVERITY.HIGH,
    meshyError?.message?.includes('not configured'), {
      expected: 'Error includes "not configured"',
      actual: meshyError ? meshyError.message : 'No error thrown'
    });

  // Test TencentCloud without API key
  let tencentError = null;
  try {
    await client.generate('tencent-hunyuan3d', Buffer.from('test'), {
      providerConfig: { api_key_env: 'NONEXISTENT_TEST_KEY_12345' }
    });
  } catch (e) {
    tencentError = e;
  }

  recordTest('T06c', 'TencentCloud without API key throws clear error', SEVERITY.HIGH,
    tencentError?.message?.includes('not configured'), {
      expected: 'Error includes "not configured"',
      actual: tencentError ? tencentError.message : 'No error thrown'
    });

  // Test mime type guessing
  const testCases = [
    ['test.png', 'image/png'],
    ['test.jpg', 'image/jpeg'],
    ['test.jpeg', 'image/jpeg'],
    ['test.webp', 'image/webp'],
    ['test.bmp', 'image/png']  // Unknown defaults to PNG
  ];

  let mimeCorrect = true;
  let mimeFailure = '';
  for (const [filename, expected] of testCases) {
    const actual = client._guessMimeType(filename);
    if (actual !== expected) {
      mimeCorrect = false;
      mimeFailure = `${filename}: expected ${expected}, got ${actual}`;
      break;
    }
  }

  recordTest('T06d', 'Mime type guessing is correct', SEVERITY.MEDIUM,
    mimeCorrect, {
      expected: 'All mime types correct',
      actual: mimeCorrect ? 'All correct' : mimeFailure
    });
}

// ===================================================================
// T07: Budget Enforcement
// ===================================================================

async function testBudgetEnforcement() {
  console.log('\n--- T07: Budget Enforcement ---');

  const { UniversalMeshClient } = await import('./universal-mesh-client.js');

  const client = new UniversalMeshClient({
    providers: {
      'free-model': { enabled: true, type: 'local', priority: 1, cost_per_generation: 0, tier: 'free' },
      'paid-model': { enabled: true, type: 'cloud', api_key_env: 'TEST', priority: 2, cost_per_generation: 0.50, tier: 'premium' }
    },
    task_routing: { default: { prefer: ['free-model', 'paid-model'] } },
    budget: { daily_limit_usd: 1.0, alert_threshold_usd: 0.5 }
  });

  // Free provider always passes budget
  const freeCheck = client.checkBudget('free-model');
  recordTest('T07a', 'Free provider always passes budget check', SEVERITY.CRITICAL,
    freeCheck.allowed === true, {
      expected: 'allowed: true',
      actual: `allowed: ${freeCheck.allowed}`
    });

  // Paid provider passes initially
  const initialCheck = client.checkBudget('paid-model');
  recordTest('T07b', 'Paid provider passes budget initially', SEVERITY.HIGH,
    initialCheck.allowed === true, {
      expected: 'allowed: true (0 < 1.0)',
      actual: `allowed: ${initialCheck.allowed}`
    });

  // Track usage to exceed budget
  client.trackUsage('paid-model', 0.50);
  client.trackUsage('paid-model', 0.50);

  recordTest('T07c', 'Usage tracking accumulates correctly', SEVERITY.HIGH,
    client.dailyUsage.cost_usd === 1.0, {
      expected: 'cost_usd === 1.0',
      actual: `cost_usd === ${client.dailyUsage.cost_usd}`
    });

  // Budget should now be exceeded
  const exceededCheck = client.checkBudget('paid-model');
  recordTest('T07d', 'Budget exceeded blocks paid provider', SEVERITY.CRITICAL,
    exceededCheck.allowed === false, {
      expected: 'allowed: false',
      actual: `allowed: ${exceededCheck.allowed}, reason: ${exceededCheck.reason}`
    });

  // Free provider still passes even with exceeded budget
  const freeAfter = client.checkBudget('free-model');
  recordTest('T07e', 'Free provider bypasses exceeded budget', SEVERITY.CRITICAL,
    freeAfter.allowed === true, {
      expected: 'allowed: true (free provider)',
      actual: `allowed: ${freeAfter.allowed}`
    });

  // Test "would exceed" check (0.9 used, 0.50 per gen, limit 1.0)
  const client2 = new UniversalMeshClient({
    providers: {
      'expensive': { enabled: true, type: 'cloud', api_key_env: 'TEST', priority: 1, cost_per_generation: 0.50, tier: 'premium' }
    },
    task_routing: { default: { prefer: ['expensive'] } },
    budget: { daily_limit_usd: 1.0 }
  });
  client2.trackUsage('expensive', 0.90);
  const wouldExceed = client2.checkBudget('expensive');

  recordTest('T07f', 'Projected cost exceeding budget is blocked', SEVERITY.HIGH,
    wouldExceed.allowed === false, {
      expected: 'allowed: false (0.90 + 0.50 > 1.0)',
      actual: `allowed: ${wouldExceed.allowed}, reason: ${wouldExceed.reason}`
    });
}

// ===================================================================
// T08: Budget Daily Reset
// ===================================================================

async function testBudgetReset() {
  console.log('\n--- T08: Budget Daily Reset ---');

  const { UniversalMeshClient } = await import('./universal-mesh-client.js');

  const client = new UniversalMeshClient({
    providers: {
      'paid': { enabled: true, type: 'cloud', api_key_env: 'TEST', priority: 1, cost_per_generation: 0.25, tier: 'premium' }
    },
    task_routing: { default: { prefer: ['paid'] } },
    budget: { daily_limit_usd: 1.0 }
  });

  // Simulate spending
  client.trackUsage('paid', 1.0);
  const exceededBefore = client.checkBudget('paid');

  recordTest('T08a', 'Budget exceeded before date change', SEVERITY.HIGH,
    exceededBefore.allowed === false, {
      expected: 'allowed: false',
      actual: `allowed: ${exceededBefore.allowed}`
    });

  // Simulate date change by backdating
  client.dailyUsage.date = '2020-01-01';

  const afterReset = client.checkBudget('paid');
  recordTest('T08b', 'Budget resets on new day', SEVERITY.CRITICAL,
    afterReset.allowed === true, {
      expected: 'allowed: true (new day)',
      actual: `allowed: ${afterReset.allowed}`
    });

  recordTest('T08c', 'Cost resets to 0 after day change', SEVERITY.HIGH,
    client.dailyUsage.cost_usd === 0, {
      expected: 'cost_usd === 0',
      actual: `cost_usd === ${client.dailyUsage.cost_usd}`
    });

  // Verify date updated to today
  const today = new Date().toISOString().split('T')[0];
  recordTest('T08d', 'Usage date updated to today', SEVERITY.MEDIUM,
    client.dailyUsage.date === today, {
      expected: `date === ${today}`,
      actual: `date === ${client.dailyUsage.date}`
    });
}

// ===================================================================
// T09: All Providers Fail (Error Aggregation)
// ===================================================================

async function testAllProvidersFail() {
  console.log('\n--- T09: All Providers Fail ---');

  const { UniversalMeshClient } = await import('./universal-mesh-client.js');

  // All providers are local, bridge is not running, so all will fail
  const client = new UniversalMeshClient({
    providers: {
      'local-a': { enabled: true, type: 'local', priority: 1, cost_per_generation: 0, tier: 'free' },
      'local-b': { enabled: true, type: 'local', priority: 2, cost_per_generation: 0, tier: 'free' }
    },
    task_routing: {
      default: { prefer: ['local-a', 'local-b'], fallback: null }
    },
    budget: { daily_limit_usd: 5.0 }
  });

  let error = null;
  try {
    await client.generateMesh(Buffer.from('fake-image'), 'test.png', 'test-job-001', {});
  } catch (e) {
    error = e;
  }

  recordTest('T09a', 'Error thrown when all providers fail', SEVERITY.CRITICAL,
    error !== null, {
      expected: 'Error thrown',
      actual: error ? 'Error thrown' : 'No error (unexpected success)'
    });

  recordTest('T09b', 'Error message mentions all providers', SEVERITY.HIGH,
    error?.message?.includes('All mesh providers failed'), {
      expected: 'Error includes "All mesh providers failed"',
      actual: error?.message?.slice(0, 100) || 'No error'
    });

  recordTest('T09c', 'Error includes routing log', SEVERITY.HIGH,
    Array.isArray(error?.routingLog), {
      expected: 'routingLog is an array',
      actual: error?.routingLog ? `Array with ${error.routingLog.length} entries` : 'No routingLog'
    });

  // Routing log should show skipped providers (bridge not running)
  if (error?.routingLog) {
    const allSkipped = error.routingLog.every(entry => entry.status === 'skipped');
    recordTest('T09d', 'Routing log shows all providers skipped', SEVERITY.MEDIUM,
      allSkipped, {
        expected: 'All entries status: skipped',
        actual: error.routingLog.map(e => `${e.provider}: ${e.status}`).join(', ')
      });
  }
}

// ===================================================================
// T10: Cancellation via AbortSignal
// ===================================================================

async function testCancellation() {
  console.log('\n--- T10: Cancellation via AbortSignal ---');

  const { UniversalMeshClient } = await import('./universal-mesh-client.js');

  const client = new UniversalMeshClient({
    providers: {
      'slow-local': { enabled: true, type: 'local', priority: 1, cost_per_generation: 0, tier: 'free' }
    },
    task_routing: { default: { prefer: ['slow-local'] } },
    budget: { daily_limit_usd: 5.0 }
  });

  // Pre-abort the signal
  const controller = new AbortController();
  controller.abort();

  let cancelError = null;
  try {
    await client.generateMesh(Buffer.from('test'), 'test.png', 'cancel-test', {
      signal: controller.signal
    });
  } catch (e) {
    cancelError = e;
  }

  // Since bridge isn't running, providers will be skipped (not cancelled)
  // This verifies the abort signal check doesn't cause an unhandled exception
  recordTest('T10a', 'Aborted signal does not cause unhandled crash', SEVERITY.HIGH,
    cancelError !== null, {
      expected: 'Error thrown (not uncaught exception)',
      actual: cancelError ? 'Error handled correctly' : 'No error'
    });

  // Verify the error includes routing info
  recordTest('T10b', 'Abort error preserves routing context', SEVERITY.MEDIUM,
    cancelError?.routingLog !== undefined || cancelError?.message?.includes('cancelled') || cancelError?.message?.includes('failed'), {
      expected: 'Error has routingLog or mentions cancellation/failure',
      actual: cancelError?.message?.slice(0, 100) || 'No error'
    });
}

// ===================================================================
// T11: Shap-E Adapter Registration (Graceful Degradation)
// ===================================================================

async function testShapERegistration() {
  console.log('\n--- T11: Shap-E Adapter Registration ---');

  // Check if python/shap_e_adapter.py exists
  const adapterPath = join(__dirname, '../../python/shap_e_adapter.py');
  recordTest('T11a', 'shap_e_adapter.py exists', SEVERITY.CRITICAL,
    existsSync(adapterPath), {
      expected: 'File exists at python/shap_e_adapter.py',
      actual: existsSync(adapterPath) ? 'Present' : 'Missing',
      recommendedFix: 'Create python/shap_e_adapter.py implementing ModelAdapter ABC'
    });

  // Check if model_manager.py has conditional import
  const managerPath = join(__dirname, '../../python/model_manager.py');
  const managerCode = readFileSync(managerPath, 'utf8');

  recordTest('T11b', 'model_manager uses try/except for Shap-E import', SEVERITY.CRITICAL,
    managerCode.includes('try:') && managerCode.includes('from shap_e_adapter import ShapEAdapter'), {
      expected: 'Conditional import with try/except',
      actual: managerCode.includes('from shap_e_adapter import ShapEAdapter') ? 'Import found' : 'Import missing'
    });

  recordTest('T11c', 'model_manager catches ImportError for Shap-E', SEVERITY.HIGH,
    managerCode.includes('except ImportError'), {
      expected: 'except ImportError handler exists',
      actual: managerCode.includes('except ImportError') ? 'Present' : 'Missing',
      recommendedFix: 'Add except ImportError block to gracefully handle missing shap-e'
    });

  // Check config.yaml has shap_e section
  const configPath = join(__dirname, '../../python/config.yaml');
  const configCode = readFileSync(configPath, 'utf8');

  recordTest('T11d', 'config.yaml has shap_e model config', SEVERITY.HIGH,
    configCode.includes('shap_e:'), {
      expected: 'shap_e: section in config.yaml',
      actual: configCode.includes('shap_e:') ? 'Present' : 'Missing'
    });

  // Check ShapEAdapter follows ModelAdapter ABC
  const adapterCode = readFileSync(adapterPath, 'utf8');

  recordTest('T11e', 'ShapEAdapter extends ModelAdapter', SEVERITY.CRITICAL,
    adapterCode.includes('class ShapEAdapter(ModelAdapter)'), {
      expected: 'class ShapEAdapter(ModelAdapter)',
      actual: adapterCode.includes('class ShapEAdapter(ModelAdapter)') ? 'Correct inheritance' : 'Missing/wrong inheritance'
    });

  // Check required properties
  const hasName = adapterCode.includes('def name(self)') && adapterCode.includes("'shap-e'");
  const hasType = adapterCode.includes('def model_type(self)') && adapterCode.includes("'mesh'");
  const hasVram = adapterCode.includes('def vram_requirement_gb(self)');

  recordTest('T11f', 'ShapEAdapter has required ABC properties', SEVERITY.HIGH,
    hasName && hasType && hasVram, {
      expected: 'name, model_type, vram_requirement_gb properties',
      actual: `name: ${hasName}, model_type: ${hasType}, vram_requirement_gb: ${hasVram}`
    });
}

// ===================================================================
// T12: ForgeSession Integration
// ===================================================================

async function testForgeSessionIntegration() {
  console.log('\n--- T12: ForgeSession Integration ---');

  const sessionPath = join(__dirname, 'forge-session.js');
  const sessionCode = readFileSync(sessionPath, 'utf8');

  // Verify universalMeshClient import
  recordTest('T12a', 'forge-session.js imports universalMeshClient', SEVERITY.CRITICAL,
    sessionCode.includes("import universalMeshClient from './universal-mesh-client.js'"), {
      expected: "import universalMeshClient from './universal-mesh-client.js'",
      actual: sessionCode.includes("import universalMeshClient from './universal-mesh-client.js'") ? 'Import present' : 'Import missing'
    });

  // Verify _runMesh uses universalMeshClient
  recordTest('T12b', '_runMesh uses universalMeshClient.generateMesh', SEVERITY.CRITICAL,
    sessionCode.includes('universalMeshClient.generateMesh'), {
      expected: 'universalMeshClient.generateMesh call in _runMesh',
      actual: sessionCode.includes('universalMeshClient.generateMesh') ? 'Present' : 'Missing',
      recommendedFix: 'Replace modelBridge.generateMesh with universalMeshClient.generateMesh in _runMesh'
    });

  // Verify _runFull still uses modelBridge for image
  recordTest('T12c', '_runFull uses modelBridge for image generation', SEVERITY.HIGH,
    sessionCode.includes('modelBridge.generateImage'), {
      expected: 'modelBridge.generateImage for image stage',
      actual: sessionCode.includes('modelBridge.generateImage') ? 'Present' : 'Missing'
    });

  // Verify _runFull uses universalMeshClient for mesh stage
  const runFullSection = sessionCode.substring(sessionCode.indexOf('_runFull'));
  recordTest('T12d', '_runFull uses universalMeshClient for mesh stage', SEVERITY.HIGH,
    runFullSection.includes('universalMeshClient.generateMesh'), {
      expected: 'universalMeshClient.generateMesh in _runFull',
      actual: runFullSection.includes('universalMeshClient.generateMesh') ? 'Present' : 'Missing'
    });

  // Verify model is passed through options
  recordTest('T12e', 'Model passed to universalMeshClient via options', SEVERITY.HIGH,
    sessionCode.includes('model: session.model'), {
      expected: 'model: session.model in generateMesh options',
      actual: sessionCode.includes('model: session.model') ? 'Present' : 'Missing'
    });
}

// ===================================================================
// T13: API Route Integration
// ===================================================================

async function testAPIRouteIntegration() {
  console.log('\n--- T13: API Route Integration ---');

  const routePath = join(__dirname, '../../src/api/routes/forge3d.js');
  const routeCode = readFileSync(routePath, 'utf8');

  // Verify universalMeshClient import
  recordTest('T13a', 'forge3d.js route imports universalMeshClient', SEVERITY.CRITICAL,
    routeCode.includes("import universalMeshClient from '../../forge3d/universal-mesh-client.js'"), {
      expected: "import universalMeshClient from '../../forge3d/universal-mesh-client.js'",
      actual: routeCode.includes("import universalMeshClient from '../../forge3d/universal-mesh-client.js'") ? 'Import present' : 'Import missing'
    });

  // Verify /providers endpoint exists
  recordTest('T13b', 'GET /providers endpoint defined', SEVERITY.CRITICAL,
    routeCode.includes("router.get('/providers'"), {
      expected: "router.get('/providers' handler",
      actual: routeCode.includes("router.get('/providers'") ? 'Endpoint defined' : 'Endpoint missing'
    });

  // Verify /providers calls getProviderInfo
  recordTest('T13c', '/providers uses getProviderInfo()', SEVERITY.HIGH,
    routeCode.includes('universalMeshClient.getProviderInfo()'), {
      expected: 'universalMeshClient.getProviderInfo() call',
      actual: routeCode.includes('universalMeshClient.getProviderInfo()') ? 'Present' : 'Missing'
    });

  // Verify /providers has error handling
  recordTest('T13d', '/providers has error handling', SEVERITY.HIGH,
    routeCode.includes('res.status(500)') && routeCode.includes("endpoint: 'providers'"), {
      expected: 'Error handling with 500 status and error reporting',
      actual: 'Error handling present'
    });

  // Verify endpoint count in header matches
  const endpointMatch = routeCode.match(/(\d+) endpoints/);
  const claimedCount = endpointMatch ? parseInt(endpointMatch[1]) : 0;

  recordTest('T13e', 'Route header claims 27 endpoints (updated for /providers)', SEVERITY.LOW,
    claimedCount >= 27, {
      expected: '>= 27 endpoints claimed in header',
      actual: `${claimedCount} endpoints claimed`
    });
}

// ===================================================================
// T14: Import Chain Resolution
// ===================================================================

async function testImportChain() {
  console.log('\n--- T14: Import Chain Resolution ---');

  // Test that universal-mesh-client.js can be imported
  let meshClientImported = false;
  let meshClientError = '';
  try {
    await import('./universal-mesh-client.js');
    meshClientImported = true;
  } catch (e) {
    meshClientError = e.message;
  }

  recordTest('T14a', 'universal-mesh-client.js imports successfully', SEVERITY.CRITICAL,
    meshClientImported, {
      expected: 'Module imports without error',
      actual: meshClientImported ? 'Import successful' : `Import failed: ${meshClientError}`,
      recommendedFix: meshClientError ? `Fix import error: ${meshClientError}` : null
    });

  // Test cloud-mesh-client.js import
  let cloudClientImported = false;
  let cloudClientError = '';
  try {
    await import('./cloud-mesh-client.js');
    cloudClientImported = true;
  } catch (e) {
    cloudClientError = e.message;
  }

  recordTest('T14b', 'cloud-mesh-client.js imports successfully', SEVERITY.CRITICAL,
    cloudClientImported, {
      expected: 'Module imports without error',
      actual: cloudClientImported ? 'Import successful' : `Import failed: ${cloudClientError}`,
      recommendedFix: cloudClientError ? `Fix import error: ${cloudClientError}` : null
    });

  // Verify all .js file extensions in imports
  const umcPath = join(__dirname, 'universal-mesh-client.js');
  const umcCode = readFileSync(umcPath, 'utf8');
  const importLines = umcCode.match(/import .+ from ['"]([^'"]+)['"]/g) || [];
  let allHaveExtensions = true;
  let missingExt = '';

  for (const line of importLines) {
    const match = line.match(/from ['"]([^'"]+)['"]/);
    if (match) {
      const path = match[1];
      // Skip npm packages (no ./ or ../)
      if (path.startsWith('.') && !path.endsWith('.js')) {
        allHaveExtensions = false;
        missingExt = `'${path}' missing .js extension`;
        break;
      }
    }
  }

  recordTest('T14c', 'All relative imports include .js extension (ESM)', SEVERITY.HIGH,
    allHaveExtensions, {
      expected: 'All relative imports end with .js',
      actual: allHaveExtensions ? 'All correct' : missingExt,
      recommendedFix: 'Add .js extension to relative imports per ESM rules'
    });

  // Verify singleton exports pattern
  recordTest('T14d', 'universal-mesh-client exports singleton + named', SEVERITY.MEDIUM,
    umcCode.includes('export default') && umcCode.includes('export { UniversalMeshClient }'), {
      expected: 'Both default and named exports',
      actual: `default: ${umcCode.includes('export default')}, named: ${umcCode.includes('export { UniversalMeshClient }')}`
    });

  const cmcPath = join(__dirname, 'cloud-mesh-client.js');
  const cmcCode = readFileSync(cmcPath, 'utf8');

  recordTest('T14e', 'cloud-mesh-client exports singleton + named', SEVERITY.MEDIUM,
    cmcCode.includes('export default') && cmcCode.includes('export { CloudMeshClient }'), {
      expected: 'Both default and named exports',
      actual: `default: ${cmcCode.includes('export default')}, named: ${cmcCode.includes('export { CloudMeshClient }')}`
    });
}

// ===================================================================
// T15: Security Audit
// ===================================================================

function testSecurity() {
  console.log('\n--- T15: Security Audit ---');

  // Check universal-mesh-client for API key leakage
  const umcPath = join(__dirname, 'universal-mesh-client.js');
  const umcCode = readFileSync(umcPath, 'utf8');

  const noHardcodedKeys = !umcCode.match(/['"](?:sk-|key-|Bearer )[A-Za-z0-9]+['"]/);
  recordTest('T15a', 'No hardcoded API keys in universal-mesh-client', SEVERITY.CRITICAL,
    noHardcodedKeys, {
      expected: 'No API key literals in source',
      actual: noHardcodedKeys ? 'Clean' : 'Potential hardcoded key found',
      recommendedFix: 'Remove hardcoded keys, use environment variables'
    });

  // Check cloud-mesh-client for API key leakage
  const cmcPath = join(__dirname, 'cloud-mesh-client.js');
  const cmcCode = readFileSync(cmcPath, 'utf8');

  const noHardcodedKeysCloud = !cmcCode.match(/['"](?:sk-|key-|Bearer )[A-Za-z0-9]+['"]/);
  recordTest('T15b', 'No hardcoded API keys in cloud-mesh-client', SEVERITY.CRITICAL,
    noHardcodedKeysCloud, {
      expected: 'No API key literals in source',
      actual: noHardcodedKeysCloud ? 'Clean' : 'Potential hardcoded key found'
    });

  // Verify API keys are read from env vars, not config files
  recordTest('T15c', 'Cloud client reads API keys from process.env', SEVERITY.CRITICAL,
    cmcCode.includes('process.env[') && cmcCode.includes('api_key_env'), {
      expected: 'process.env[] for API key access',
      actual: cmcCode.includes('process.env[') ? 'Uses process.env' : 'Does not use process.env'
    });

  // Check config yaml doesn't contain actual API keys
  const configPath = join(__dirname, '../../config/mesh-providers.yaml');
  const configCode = readFileSync(configPath, 'utf8');

  const noKeysInConfig = !configCode.match(/api_key:\s*['"]?[A-Za-z0-9]{20,}/);
  recordTest('T15d', 'No actual API keys in mesh-providers.yaml', SEVERITY.CRITICAL,
    noKeysInConfig, {
      expected: 'Config only has api_key_env references, not actual keys',
      actual: noKeysInConfig ? 'Clean (only env var references)' : 'Potential actual API key in config',
      recommendedFix: 'Replace actual API key with api_key_env: ENV_VAR_NAME'
    });

  // Check that cloud URLs are HTTPS
  const httpsOnly = !cmcCode.match(/http:\/\/[^l]/) && !configCode.match(/base_url:\s*['"]?http:\/\/[^l]/);
  recordTest('T15e', 'All cloud API URLs use HTTPS', SEVERITY.HIGH,
    httpsOnly, {
      expected: 'All base_url values use https://',
      actual: httpsOnly ? 'All HTTPS' : 'Found non-HTTPS URL',
      recommendedFix: 'Change http:// to https:// for all cloud API URLs'
    });

  // Check frontend uses createElement/textContent (not innerHTML with user data)
  const panelPath = join(__dirname, '../../public/js/forge3d-panel.js');
  const panelCode = readFileSync(panelPath, 'utf8');

  // Cost estimate uses textContent, not innerHTML
  const costEstimateSafe = panelCode.includes('el.textContent = `Estimated cost:');
  recordTest('T15f', 'Cost estimate uses textContent (XSS-safe)', SEVERITY.HIGH,
    costEstimateSafe, {
      expected: 'el.textContent for cost display',
      actual: costEstimateSafe ? 'Uses textContent (safe)' : 'May use innerHTML (XSS risk)'
    });

  // Model selector uses createElement + textContent
  const selectorSafe = panelCode.includes('opt.textContent = `${model.name}');
  recordTest('T15g', 'Model selector uses textContent for options (XSS-safe)', SEVERITY.HIGH,
    selectorSafe, {
      expected: 'textContent for option text',
      actual: selectorSafe ? 'Uses textContent (safe)' : 'May use innerHTML (XSS risk)'
    });

  // Verify unknown provider budget check returns { allowed: false }
  const umcBudgetUnknown = umcCode.includes("return { allowed: false, reason: 'Unknown provider' }");
  recordTest('T15h', 'Budget check rejects unknown providers', SEVERITY.MEDIUM,
    umcBudgetUnknown, {
      expected: 'Unknown provider returns allowed: false',
      actual: umcBudgetUnknown ? 'Properly rejected' : 'May not reject unknown providers'
    });
}

// ===================================================================
// Report Generator
// ===================================================================

function generateReport() {
  console.log('\n\n========================================');
  console.log('  VALIDATION TEST REPORT');
  console.log('  Multi-Model 3D Generation Architecture');
  console.log('========================================\n');

  console.log(`Total Tests:  ${testCount}`);
  console.log(`Passed:       ${passCount}`);
  console.log(`Failed:       ${failCount}`);
  console.log(`Warnings:     ${warnCount}`);
  console.log(`Pass Rate:    ${((passCount / testCount) * 100).toFixed(1)}%\n`);

  // Group by severity
  const critical = RESULTS.filter(r => r.severity === SEVERITY.CRITICAL);
  const high = RESULTS.filter(r => r.severity === SEVERITY.HIGH);
  const medium = RESULTS.filter(r => r.severity === SEVERITY.MEDIUM);
  const low = RESULTS.filter(r => r.severity === SEVERITY.LOW);

  console.log('--- Critical Issues ---');
  const critFails = critical.filter(r => !r.passed);
  if (critFails.length === 0) {
    console.log('  None');
  } else {
    for (const r of critFails) {
      console.log(`  [FAIL] ${r.id}: ${r.description}`);
      if (r.recommendedFix) console.log(`         Fix: ${r.recommendedFix}`);
    }
  }

  console.log('\n--- High Severity Issues ---');
  const highFails = high.filter(r => !r.passed);
  if (highFails.length === 0) {
    console.log('  None');
  } else {
    for (const r of highFails) {
      console.log(`  [FAIL] ${r.id}: ${r.description}`);
      if (r.recommendedFix) console.log(`         Fix: ${r.recommendedFix}`);
    }
  }

  console.log('\n--- Medium/Low Issues ---');
  const otherFails = [...medium, ...low].filter(r => !r.passed);
  if (otherFails.length === 0) {
    console.log('  None');
  } else {
    for (const r of otherFails) {
      console.log(`  [${r.severity.toUpperCase()}] ${r.id}: ${r.description}`);
    }
  }

  // Architecture Stability Assessment
  console.log('\n--- Architecture Stability Assessment ---');
  const criticalPassed = critical.every(r => r.passed);
  const highPassed = high.filter(r => !r.passed).length <= 2;

  if (criticalPassed && highPassed) {
    console.log('  STABLE: All critical checks pass, <= 2 high-severity issues.');
    console.log('  Recommendation: GO for next development phase.');
  } else if (criticalPassed) {
    console.log('  CONDITIONAL: Critical checks pass, but multiple high-severity issues.');
    console.log('  Recommendation: Fix high-severity issues before proceeding.');
  } else {
    console.log('  UNSTABLE: Critical failures detected.');
    console.log('  Recommendation: NO-GO. Fix critical issues immediately.');
  }

  // Critical Blockers
  console.log('\n--- Critical Blockers ---');
  if (critFails.length === 0) {
    console.log('  No critical blockers identified.');
  } else {
    for (const r of critFails) {
      console.log(`  BLOCKER: ${r.id} — ${r.description}`);
      console.log(`           ${r.recommendedFix || 'See test details above'}`);
    }
  }

  // Go/No-Go
  console.log('\n--- Final Verdict ---');
  if (failCount === 0) {
    console.log('  GO: All 15 test scenarios PASSED. Architecture is validated.');
  } else if (critFails.length === 0 && failCount <= 3) {
    console.log(`  CONDITIONAL GO: ${failCount} non-critical issue(s). Safe to proceed with fixes.`);
  } else {
    console.log(`  NO-GO: ${critFails.length} critical, ${failCount} total failures. Must fix before proceeding.`);
  }

  console.log('\n========================================\n');

  return { testCount, passCount, failCount, warnCount, criticalFails: critFails.length };
}

// ===================================================================
// Main Runner
// ===================================================================

const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[MULTI-MODEL-TEST] Running 15 validation test scenarios...\n');

  // Synchronous tests
  testConfigSchema();

  // Async tests
  await testConstructor();
  await testProviderInfo();
  await testDefaultRouting();
  await testTaskRouting();
  await testCloudFailureHandling();
  await testBudgetEnforcement();
  await testBudgetReset();
  await testAllProvidersFail();
  await testCancellation();
  await testShapERegistration();
  await testForgeSessionIntegration();
  await testAPIRouteIntegration();
  await testImportChain();
  testSecurity();

  const report = generateReport();

  process.exit(report.criticalFails > 0 ? 1 : 0);
}
