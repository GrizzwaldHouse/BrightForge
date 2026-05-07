// ============================================================================
// IRenderService.h - BrightForge Engine Abstract Rendering Interface
// ============================================================================
// The key abstraction that lets UI and game logic talk to one interface
// without knowing which renderer (Vulkan or software) is active.
// ============================================================================
#pragma once

#include "RenderConfig.h"
#include <string>
#include <cstdint>

// Opaque handles for resources
using MeshHandle = uint32_t;
using TextureHandle = uint32_t;

struct CameraData {
    float position[3];
    float target[3];
    float up[3];
    float fovY;
    float aspectRatio;
    float nearPlane;
    float farPlane;
};

struct Transform {
    float worldMatrix[16];
};

struct LightingData {
    float sunDirection[3];
    float sunColor[3];
    float sunIntensity;
    float ambientColor[3];
    float ambientIntensity;
};

class IRenderService {
public:
    virtual ~IRenderService() = default;

    // Lifecycle
    virtual bool Initialize(const RenderConfig& config) = 0;
    virtual void Shutdown() = 0;

    // Frame management
    virtual void BeginFrame() = 0;
    virtual void EndFrame() = 0;

    // Scene commands
    virtual void SetCamera(const CameraData& camera) = 0;
    virtual void SubmitMesh(MeshHandle mesh, const Transform& transform) = 0;
    virtual void SetLighting(const LightingData& lighting) = 0;

    // Resource management
    virtual MeshHandle LoadMesh(const std::string& path) = 0;
    virtual TextureHandle LoadTexture(const std::string& path) = 0;
    virtual void UnloadMesh(MeshHandle handle) = 0;
    virtual void UnloadTexture(TextureHandle handle) = 0;
};
