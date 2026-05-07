# Skill: BrightForge Rendering Pipeline

## Overview

BrightForge provides two rendering paths. Vulkan is the primary GPU-accelerated pipeline. The software renderer exists for testing and education. Both implement the `IRenderService` interface, allowing the engine to swap between them without changing client code.

## Vulkan Pipeline Quick Reference

### Initialization Order

Follow this exact sequence when setting up the Vulkan pipeline:

1. Create Vulkan instance
2. Set up debug messenger
3. Create surface
4. Pick physical device
5. Create logical device and queues
6. Create swapchain
7. Create render pass
8. Create graphics pipeline (shaders, layout, pipeline object)
9. Create framebuffers
10. Create command pool and command buffers

### Shader Compilation Pattern

Use the unified `ShaderCompiler` for all shader loading:

```cpp
ShaderCompiler compiler;
auto vertModule = compiler.Compile("shaders/vert.glsl", ShaderStage::VERTEX);
auto fragModule = compiler.Compile("shaders/frag.glsl", ShaderStage::FRAGMENT);
```

### Frame Loop Pattern

```cpp
while (running) {
    AcquireNextImage();
    RecordCommandBuffer();
    SubmitQueue();
    PresentFrame();
}
```

### Cleanup Order

Cleanup is the reverse of initialization. Destroy resources in the opposite order they were created:

1. Command pool and command buffers
2. Framebuffers
3. Graphics pipeline, pipeline layout
4. Render pass
5. Swapchain (and image views)
6. Logical device
7. Surface
8. Debug messenger
9. Vulkan instance

## Existing Helper Functions to Reuse

### From `renderer.h`

| Function | Purpose |
|----------|---------|
| `CreateVkInstance()` | Create and configure the Vulkan instance |
| `CreateVkDebugMessenger()` | Set up validation layer debug callback |
| `CreateVkSurface()` | Create a window surface for presentation |
| `CreateVkPhysicalDevice()` | Select a suitable GPU |
| `CreateVkLogicalDevice()` | Create the logical device and retrieve queues |
| `CreateVkSwapchain()` | Create the swapchain and image views |
| `CreateVkRenderPass()` | Define attachment descriptions and subpasses |
| `CreateVkGraphicsPipeline()` | Build the full graphics pipeline |
| `CreateVkFramebuffers()` | Create framebuffers for each swapchain image |
| `CreateVkCommandPool()` | Create the command pool and allocate command buffers |

### From `Camera.h`

| Function | Purpose |
|----------|---------|
| `FreeLookCamera` | First-person camera with mouse look and WASD movement |

### From `GraphicsHelper.hpp`

| Function | Purpose |
|----------|---------|
| `NDCToScreen()` | Convert normalized device coordinates to screen-space pixels |
| `drawPixel()` | Plot a single pixel in the software framebuffer |

## Rules

1. **Never create a Vulkan resource without a corresponding destroy.** Every `CreateVk*` call must have a matching cleanup in the shutdown path.
2. **Always check `VkResult`.** Every Vulkan API call that returns `VkResult` must be checked. Log failures through QuoteSystem at `ERROR_MSG` level.
3. **All rendering parameters come from `RenderConfig`.** Do not hardcode resolution, format, present mode, or other settings. Read them from the config structure.
4. **Log every shader compilation.** Both success and failure of shader compilation must be logged through QuoteSystem.
5. **Register the `Renderer` channel with DebugWindow.** The rendering subsystem must call `RegisterChannel("Renderer")` during initialization.
6. **Call `CheckFileExists` for all shader files.** Before attempting to load or compile a shader, verify the file exists via DebugWindow's `CheckFileExists`.
