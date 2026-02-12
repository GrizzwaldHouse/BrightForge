/**
 * Design Engine - AI-Powered Design Generation
 *
 * Orchestrates ImageClient (images) + LLMClient (layout) to generate
 * complete HTML designs with embedded images.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import imageClient from './image-client.js';
import { UniversalLLMClient } from './llm-client.js';
import errorHandler from './error-handler.js';
import telemetryBus from './telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DesignEngine {
  constructor() {
    this.imageClient = imageClient;
    this.llmClient = new UniversalLLMClient();
    this.stylesDir = join(__dirname, '../../config/styles');
    this.promptPath = join(__dirname, '../../src/prompts/design-system.txt');
    this.outputDir = 'output/designs';
  }

  /**
   * Generate complete design from prompt
   * @param {string} prompt - Design brief/requirements
   * @param {Object} options - Options (styleName, imageCount, outputDir)
   * @returns {Promise<{html: string, images: Array, layout: string, cost: number}>}
   */
  async generateDesign(prompt, options = {}) {
    console.log(`[DESIGN] Generating design: "${prompt.substring(0, 50)}..."`);
    const endTimer = telemetryBus.startTimer('design_generation', { prompt: prompt.substring(0, 100) });

    try {
      // 1. Load style
      const styleName = options.styleName || 'default';
      const style = this.loadStyle(styleName);
      console.log(`[DESIGN] Using style: ${styleName}`);

      // 2. Parse design specs (how many images needed, what kind)
      const imageSpecs = this._parseImageSpecs(prompt, options);
      console.log(`[DESIGN] Parsed ${imageSpecs.length} image requirements`);

      // 3. Generate images
      const images = await this.generateImages(imageSpecs);
      console.log(`[DESIGN] Generated ${images.length} images`);

      // 4. Generate HTML layout with LLM
      const layout = await this.generateLayout(prompt, images, style);
      console.log(`[DESIGN] Generated HTML layout (${layout.length} chars)`);

      // 5. Combine images into HTML
      const html = this.combineDesign(layout, images);

      // Calculate total cost
      const imageCost = images.reduce((sum, img) => sum + img.cost, 0);
      const llmCost = 0; // TODO: Track LLM cost from generateLayout
      const totalCost = imageCost + llmCost;

      console.log(`[DESIGN] Design complete! Total cost: $${totalCost.toFixed(4)}`);
      endTimer({ status: 'success', images: images.length, cost: totalCost });

      return {
        html,
        images,
        layout,
        style: styleName,
        cost: totalCost,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`[DESIGN] Design generation failed: ${error.message}`);
      errorHandler.report('design_error', error, { prompt });
      endTimer({ status: 'failed', error: error.message });
      throw error;
    }
  }

  /**
   * Parse image requirements from prompt
   * @private
   */
  _parseImageSpecs(prompt, options) {
    const imageCount = options.imageCount || this._inferImageCount(prompt);
    const specs = [];

    // Generate contextual image prompts based on main prompt
    if (imageCount === 1) {
      specs.push({
        prompt: `Hero image for: ${prompt}`,
        role: 'hero',
        width: options.width || 1024,
        height: options.height || 768
      });
    } else {
      // Multiple images - create varied prompts
      for (let i = 0; i < imageCount; i++) {
        const role = i === 0 ? 'hero' : 'supporting';
        specs.push({
          prompt: `${role} image ${i + 1} for: ${prompt}`,
          role,
          width: role === 'hero' ? 1024 : 512,
          height: role === 'hero' ? 768 : 512
        });
      }
    }

    return specs;
  }

  /**
   * Infer image count from prompt keywords
   * @private
   */
  _inferImageCount(prompt) {
    const lower = prompt.toLowerCase();
    if (lower.includes('gallery') || lower.includes('portfolio')) return 6;
    if (lower.includes('feature') && lower.includes('comparison')) return 3;
    if (lower.includes('landing') || lower.includes('homepage')) return 3;
    if (lower.includes('blog') || lower.includes('article')) return 2;
    return 1; // Default: single hero image
  }

  /**
   * Generate multiple images in batch
   * @param {Array} specs - Image specifications
   * @returns {Promise<Array>} Generated images with paths
   */
  async generateImages(specs) {
    console.log(`[DESIGN] Generating ${specs.length} images...`);
    const images = [];

    for (const spec of specs) {
      try {
        const result = await this.imageClient.generate(spec.prompt, {
          width: spec.width,
          height: spec.height
        });
        images.push({
          ...result,
          role: spec.role,
          alt: spec.prompt
        });
      } catch (error) {
        console.warn(`[DESIGN] Image generation failed for "${spec.prompt}": ${error.message}`);
        errorHandler.report('image_generation_error', error, { spec });
        // Continue with other images even if one fails
      }
    }

    return images;
  }

  /**
   * Generate HTML layout using LLM
   * @param {string} prompt - Design brief
   * @param {Array} images - Generated images with paths
   * @param {string} style - Style guide markdown
   * @returns {Promise<string>} Generated HTML
   */
  async generateLayout(prompt, images, style) {
    console.log('[DESIGN] Generating HTML layout with LLM...');

    // Load design system prompt
    const systemPrompt = readFileSync(this.promptPath, 'utf8');

    // Build user prompt with style guide and image paths
    const imagePaths = images.map((img, i) =>
      `Image ${i + 1} (${img.role}): ${img.path} - ${img.alt}`
    ).join('\n');

    const userPrompt = `Design Brief: ${prompt}

Style Guide:
${style}

Available Images:
${imagePaths}

Generate a complete HTML page that implements this design using the provided style guide and images.
`;

    // Call LLM
    const response = await this.llmClient.generate(userPrompt, {
      systemPrompt,
      taskType: 'generate_code'
    });

    // Extract HTML from response (may be wrapped in markdown code block)
    const html = this._extractHTML(response.content);
    return html;
  }

  /**
   * Extract HTML from LLM response (handles markdown code blocks)
   * @private
   */
  _extractHTML(content) {
    // Check if wrapped in markdown code block
    const codeBlockMatch = content.match(/```html\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1];
    }

    // Check for DOCTYPE as start of HTML
    const doctypeIndex = content.indexOf('<!DOCTYPE');
    if (doctypeIndex >= 0) {
      return content.substring(doctypeIndex);
    }

    // Return as-is if already HTML
    return content;
  }

  /**
   * Combine layout and images into final HTML
   * @param {string} layout - HTML layout from LLM
   * @param {Array} images - Generated images
   * @returns {string} Complete HTML with embedded image paths
   */
  combineDesign(layout, images) {
    // Images are already referenced by path in the layout
    // Just ensure paths are absolute for portability
    let html = layout;

    // Convert relative image paths to absolute
    for (const img of images) {
      const relativePath = img.path.replace(/\\/g, '/');
      html = html.replace(new RegExp(img.path, 'g'), relativePath);
    }

    return html;
  }

  /**
   * Export design to disk
   * @param {Object} design - Design object from generateDesign()
   * @param {string} outputDir - Output directory (optional)
   * @returns {Promise<string>} Path to exported HTML file
   */
  async exportDesign(design, outputDir = null) {
    const dir = outputDir || this.outputDir;
    const timestamp = Date.now();
    const filename = `design-${timestamp}.html`;
    const outputPath = join(process.cwd(), dir, filename);

    // Ensure directory exists
    const outDir = dirname(outputPath);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }

    // Write HTML file
    writeFileSync(outputPath, design.html, 'utf8');
    console.log(`[DESIGN] Exported to: ${outputPath}`);

    // Write metadata JSON
    const metaPath = outputPath.replace('.html', '.meta.json');
    const metadata = {
      timestamp: design.timestamp,
      style: design.style,
      images: design.images.map(img => ({
        path: img.path,
        provider: img.provider,
        role: img.role,
        alt: img.alt
      })),
      cost: design.cost
    };
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return outputPath;
  }

  /**
   * Load style guide from markdown file
   * @param {string} styleName - Style name (default, blue-glass, dark-industrial)
   * @returns {string} Style guide markdown content
   */
  loadStyle(styleName) {
    const stylePath = join(this.stylesDir, `${styleName}.md`);
    if (!existsSync(stylePath)) {
      throw new Error(`Style not found: ${styleName}. Available: ${this.getAvailableStyles().join(', ')}`);
    }
    return readFileSync(stylePath, 'utf8');
  }

  /**
   * Get list of available styles
   * @returns {Array<string>} Style names
   */
  getAvailableStyles() {
    if (!existsSync(this.stylesDir)) return [];
    return readdirSync(this.stylesDir)
      .filter(file => file.endsWith('.md'))
      .map(file => basename(file, '.md'));
  }
}

// Singleton export
const designEngine = new DesignEngine();
export { DesignEngine, designEngine };
export default designEngine;

/**
 * Self-test
 */
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--test')) {
  (async () => {
    console.log('\n=== Testing DesignEngine ===\n');

    const engine = new DesignEngine();

    // Test 1: List available styles
    console.log('[TEST 1] Available styles:');
    const styles = engine.getAvailableStyles();
    styles.forEach(style => console.log(`  - ${style}`));

    // Test 2: Load default style
    console.log('\n[TEST 2] Loading default style...');
    try {
      const style = engine.loadStyle('default');
      console.log(`✓ Style loaded (${style.length} characters)`);
      console.log(`  First 100 chars: ${style.substring(0, 100)}...`);
    } catch (error) {
      console.error(`✗ Failed to load style: ${error.message}`);
    }

    // Test 3: Generate simple design (if image providers available)
    const hasProviders = imageClient.isProviderAvailable('pollinations');
    if (hasProviders) {
      console.log('\n[TEST 3] Generating simple design...');
      console.log('(This will take 30-60 seconds - generating images + layout)');
      try {
        const design = await engine.generateDesign('Create a simple landing page for a coffee shop', {
          styleName: 'default',
          imageCount: 1
        });
        console.log('✓ Design generated successfully!');
        console.log(`  Images: ${design.images.length}`);
        console.log(`  HTML length: ${design.html.length} characters`);
        console.log(`  Cost: $${design.cost.toFixed(4)}`);

        // Export design
        const exportPath = await engine.exportDesign(design);
        console.log(`  Exported to: ${exportPath}`);
      } catch (error) {
        console.error(`✗ Design generation failed: ${error.message}`);
      }
    } else {
      console.log('\n[TEST 3] Skipped - no image providers available');
    }

    console.log('\n=== DesignEngine Tests Complete ===\n');
  })();
}
