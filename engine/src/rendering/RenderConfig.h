// ============================================================================
// RenderConfig.h - BrightForge Engine Rendering Configuration
// ============================================================================
// All rendering parameters must come from this struct, never hardcoded.
// Load from JSON/INI at startup, or use the defaults below.
// ============================================================================
#pragma once

struct RenderConfig {
    // Window
    int windowWidth = 800;
    int windowHeight = 600;
    bool fullscreen = false;

    // Quality
    int msaaSamples = 1;
    bool enableVSync = true;
    float renderScale = 1.0f;

    // Lighting
    float ambientIntensity = 0.25f;
    float sunIntensity = 1.0f;

    // Camera
    float cameraSpeed = 0.3f;
    float fovDegrees = 65.0f;
    float nearPlane = 0.00001f;
    float farPlane = 10000.0f;

    // Debug
    bool wireframeMode = false;
    bool showNormals = false;
    bool showDepthBuffer = false;
    bool reversedZ = true;
};
