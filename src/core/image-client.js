/**
 * Image Client - AI Image Generation Provider Chain
 *
 * Supports: Pollinations.ai, Together AI, Gemini, Stability AI
 * Free-first provider chain with fallback support
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import errorHandler from './error-handler.js';
import telemetryBus from './telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load provider config
const configPath = join(__dirname, '../../config/image-providers.yaml');

class ImageClient {
  constructor(configOverride = null) {
    try {
      const configContent = readFileSync(configPath, 'utf8');
      this.config = parseYaml(configContent);
    } catch (error) {
      console.warn('[IMAGE] Could not load config, using defaults:', error.message);
      this.config = configOverride || this.getDefaultConfig();
    }

    this.providers = this.config.providers || {};
    this.taskRouting = this.config.task_routing || {};
    this.defaults = this.config.defaults || {};

    // Track usage
    this.usage = {
      totalImages: 0,
      totalCost: 0,
      byProvider: {}
    };
  }

  getDefaultConfig() {
    return {
      providers: {
        pollinations: {
          enabled: true,
          base_url: 'https://image.pollinations.ai',
          priority: 1,
          cost_per_image: 0
        }
      },
      defaults: {
        width: 1024,
        height: 1024,
        format: 'png',
        output_dir: 'output/images'
      }
    };
  }

  /**
   * Get API key from environment variable
   */
  getApiKey(provider) {
    const providerConfig = this.providers[provider];
    if (!providerConfig) return null;

    if (providerConfig.api_key) return providerConfig.api_key;
    if (providerConfig.api_key_env) {
      return process.env[providerConfig.api_key_env];
    }
    return null;
  }

  /**
   * Check if provider is available (enabled + has API key if needed)
   */
  isProviderAvailable(providerName) {
    const provider = this.providers[providerName];
    if (!provider || !provider.enabled) return false;

    // Pollinations doesn't need an API key
    if (providerName === 'pollinations') {
      return true;
    }

    const apiKey = this.getApiKey(providerName);
    return !!apiKey;
  }

  /**
   * Generate image using provider chain with fallback
   * @param {string} prompt - Image generation prompt
   * @param {Object} options - Generation options (width, height, model, etc.)
   * @returns {Promise<{url: string, path: string, provider: string, cost: number}>}
   */
  async generate(prompt, options = {}) {
    console.log(`[IMAGE] Generating image: "${prompt.substring(0, 50)}..."`);
    const endTimer = telemetryBus.startTimer('image_generation', { prompt: prompt.substring(0, 100) });

    // Determine task type and get preferred providers
    const taskType = options.edit ? 'image_editing' : 'image_generation';
    const routing = this.taskRouting[taskType] || this.taskRouting.image_generation;
    const preferredProviders = routing?.prefer || ['pollinations', 'together', 'gemini'];

    // Build provider chain by priority
    const availableProviders = Object.entries(this.providers)
      .filter(([name, config]) => config.enabled && this.isProviderAvailable(name))
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([name]) => name);

    // Try preferred providers first, then fallback to others
    const providerChain = [
      ...preferredProviders.filter(p => availableProviders.includes(p)),
      ...availableProviders.filter(p => !preferredProviders.includes(p))
    ];

    if (providerChain.length === 0) {
      const error = new Error('No image providers available. Check API keys and provider config.');
      errorHandler.report('image_error', error, { prompt });
      endTimer({ status: 'failed', error: 'no_providers' });
      throw error;
    }

    console.log(`[IMAGE] Provider chain: ${providerChain.join(' -> ')}`);

    // Try each provider in chain
    let lastError = null;
    for (const providerName of providerChain) {
      try {
        console.log(`[IMAGE] Trying provider: ${providerName}`);
        const result = await this.callProvider(providerName, prompt, options);

        // Track usage
        this.usage.totalImages++;
        this.usage.totalCost += result.cost;
        if (!this.usage.byProvider[providerName]) {
          this.usage.byProvider[providerName] = { images: 0, cost: 0 };
        }
        this.usage.byProvider[providerName].images++;
        this.usage.byProvider[providerName].cost += result.cost;

        console.log(`[IMAGE] Successfully generated image via ${providerName}`);
        endTimer({ status: 'success', provider: providerName, cost: result.cost });
        return result;
      } catch (error) {
        console.warn(`[IMAGE] Provider ${providerName} failed: ${error.message}`);
        errorHandler.report('provider_error', error, { provider: providerName, prompt });
        lastError = error;
        continue;
      }
    }

    // All providers failed
    const error = new Error(`All image providers failed. Last error: ${lastError?.message}`);
    errorHandler.report('image_error', error, { prompt, providerChain });
    endTimer({ status: 'failed', error: 'all_providers_failed' });
    throw error;
  }

  /**
   * Call a specific provider
   * @param {string} providerName - Provider to use
   * @param {string} prompt - Image prompt
   * @param {Object} options - Generation options
   * @returns {Promise<{url: string, path: string, provider: string, cost: number}>}
   */
  async callProvider(providerName, prompt, options = {}) {
    switch (providerName) {
    case 'pollinations':
      return await this._callPollinations(prompt, options);
    case 'together':
      return await this._callTogether(prompt, options);
    case 'gemini':
    case 'nano-banana':
      return await this._callGemini(prompt, options);
    case 'stability':
      return await this._callStability(prompt, options);
    default:
      throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  /**
   * Pollinations.ai - Free, zero-auth image generation
   */
  async _callPollinations(prompt, options) {
    const provider = this.providers.pollinations;
    const width = options.width || provider.default_width || 1024;
    const height = options.height || provider.default_height || 1024;
    const model = options.model || provider.models?.default || 'flux';

    const url = `${provider.base_url}/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=${model}`;

    console.log(`[IMAGE] Pollinations URL: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Pollinations API error: ${response.status} ${response.statusText}`);
    }

    // Download image bytes
    const imageBuffer = await response.arrayBuffer();
    const outputPath = await this.saveImage(Buffer.from(imageBuffer), 'pollinations', options);

    return {
      url,
      path: outputPath,
      provider: 'pollinations',
      cost: 0
    };
  }

  /**
   * Together AI - FLUX.1 Schnell Free
   */
  async _callTogether(prompt, options) {
    const provider = this.providers.together;
    const apiKey = this.getApiKey('together');
    if (!apiKey) throw new Error('TOGETHER_API_KEY not found');

    const width = options.width || provider.default_width || 1024;
    const height = options.height || provider.default_height || 768;
    const model = options.model || provider.models?.default;

    const requestBody = {
      model,
      prompt,
      width,
      height,
      steps: options.steps || 4,
      n: 1
    };

    const response = await fetch(provider.base_url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Together API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL in Together API response');

    // Download image
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const outputPath = await this.saveImage(Buffer.from(imageBuffer), 'together', options);

    return {
      url: imageUrl,
      path: outputPath,
      provider: 'together',
      cost: 0
    };
  }

  /**
   * Gemini "Nano Banana" — image generation via generateContent
   * Uses responseModalities: ["TEXT", "IMAGE"] to produce inline PNG
   */
  async _callGemini(prompt, options) {
    const provider = this.providers.gemini;
    const apiKey = this.getApiKey('gemini');
    if (!apiKey) throw new Error('GEMINI_API_KEY not found');

    const model = options.model || provider.models?.image_gen || provider.models?.default || 'gemini-2.0-flash-exp';
    const url = `${provider.base_url}/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [{
        parts: [{
          text: `Generate an image: ${prompt}`
        }]
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        temperature: options.temperature || 0.9
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Extract inline image data from response parts
    const candidates = data.candidates || [];
    if (candidates.length === 0) {
      throw new Error('Gemini returned no candidates');
    }

    const parts = candidates[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart) {
      const textPart = parts.find(p => p.text);
      const reason = textPart ? textPart.text.substring(0, 200) : 'No image data in response';
      throw new Error(`Gemini did not return an image: ${reason}`);
    }

    // Decode base64 image data
    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const mimeType = imagePart.inlineData.mimeType;
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';

    // Save to disk
    const savedPath = await this.saveImage(imageBuffer, 'gemini', {
      ...options,
      format: ext
    });

    console.log(`[IMAGE] Nano Banana (Gemini) generated image: ${savedPath}`);

    // Also extract any accompanying text
    const textPart = parts.find(p => p.text);
    if (textPart) {
      console.log(`[IMAGE] Gemini description: ${textPart.text.substring(0, 120)}`);
    }

    return {
      path: savedPath,
      url: null,  // Gemini returns inline data, not URLs
      provider: 'gemini',
      alias: 'nano-banana',
      cost: provider.cost_per_image || 0,
      model,
      format: ext,
      description: textPart?.text || null
    };
  }

  /**
   * Stability AI - Premium fallback
   */
  async _callStability(prompt, options) {
    const provider = this.providers.stability;
    const apiKey = this.getApiKey('stability');
    if (!apiKey) throw new Error('STABILITY_API_KEY not found');

    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('output_format', options.format || 'png');

    const response = await fetch(provider.base_url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'image/*'
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stability API error: ${response.status} ${errorText}`);
    }

    const imageBuffer = await response.arrayBuffer();
    const outputPath = await this.saveImage(Buffer.from(imageBuffer), 'stability', options);

    return {
      url: null,
      path: outputPath,
      provider: 'stability',
      cost: provider.cost_per_image || 0.03
    };
  }

  /**
   * Save image to disk
   * @param {Buffer} imageBuffer - Image bytes
   * @param {string} provider - Provider name
   * @param {Object} options - Options (outputPath override)
   * @returns {Promise<string>} Absolute path to saved image
   */
  async saveImage(imageBuffer, provider, options = {}) {
    const outputDir = options.outputDir || this.defaults.output_dir || 'output/images';
    const timestamp = Date.now();
    const filename = options.filename || `${provider}-${timestamp}.png`;
    const outputPath = options.outputPath || join(process.cwd(), outputDir, filename);

    // Ensure directory exists
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(outputPath, imageBuffer);
    console.log(`[IMAGE] Saved to: ${outputPath}`);
    return outputPath;
  }

  /**
   * Get usage summary
   */
  getUsageSummary() {
    return {
      totalImages: this.usage.totalImages,
      totalCost: this.usage.totalCost,
      providers: this.usage.byProvider
    };
  }
}

// Singleton export
const imageClient = new ImageClient();
export { ImageClient, imageClient };
export default imageClient;

/**
 * Self-test
 */
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--test')) {
  (async () => {
    console.log('\n=== Testing ImageClient ===\n');

    const client = new ImageClient();

    // Test 1: Provider availability
    console.log('[TEST 1] Provider availability:');
    const providers = Object.keys(client.providers);
    for (const name of providers) {
      const available = client.isProviderAvailable(name);
      console.log(`  ${name}: ${available ? '✓ available' : '✗ unavailable'}`);
    }

    // Test 2: Generate image (only if providers available)
    const availableProviders = providers.filter(p => client.isProviderAvailable(p));
    if (availableProviders.length > 0) {
      console.log(`\n[TEST 2] Generating test image via ${availableProviders[0]}...`);
      try {
        const result = await client.generate('A serene mountain landscape at sunset', {
          width: 512,
          height: 512
        });
        console.log('✓ Image generated successfully');
        console.log(`  Provider: ${result.provider}`);
        console.log(`  Path: ${result.path}`);
        console.log(`  Cost: $${result.cost.toFixed(4)}`);
      } catch (error) {
        console.error(`✗ Image generation failed: ${error.message}`);
      }

      // Test 3: Usage summary
      console.log('\n[TEST 3] Usage summary:');
      const summary = client.getUsageSummary();
      console.log(`  Total images: ${summary.totalImages}`);
      console.log(`  Total cost: $${summary.totalCost.toFixed(4)}`);
    } else {
      console.log('\n[TEST 2] Skipped - no providers available');
      console.log('Set TOGETHER_API_KEY, GEMINI_API_KEY, or enable Pollinations to test');
    }

    console.log('\n=== ImageClient Tests Complete ===\n');
  })();
}
