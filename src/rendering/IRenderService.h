/** IRenderService - Abstract rendering interface
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <cstdint>
#include <string>
#include "RenderConfig.h"

// Handle types for resource management
using MeshHandle = uint32_t;
using TextureHandle = uint32_t;

// Invalid handle sentinel value
constexpr MeshHandle INVALID_MESH_HANDLE = 0;
constexpr TextureHandle INVALID_TEXTURE_HANDLE = 0;

// Camera data structure
struct CameraData {
    float positionX = 0.0f;
    float positionY = 0.0f;
    float positionZ = 5.0f;
    float lookAtX = 0.0f;
    float lookAtY = 0.0f;
    float lookAtZ = 0.0f;
    float upX = 0.0f;
    float upY = 1.0f;
    float upZ = 0.0f;
    float fovDegrees = 65.0f;
    float aspectRatio = 16.0f / 9.0f;
    float nearPlane = 0.00001f;
    float farPlane = 10000.0f;
};

// Transform structure for object positioning
struct Transform {
    // Position
    float posX = 0.0f;
    float posY = 0.0f;
    float posZ = 0.0f;

    // Rotation (Euler angles in degrees)
    float rotX = 0.0f;
    float rotY = 0.0f;
    float rotZ = 0.0f;

    // Scale
    float scaleX = 1.0f;
    float scaleY = 1.0f;
    float scaleZ = 1.0f;
};

// Lighting configuration
struct LightingData {
    // Directional light (sun)
    float sunDirectionX = -0.5f;
    float sunDirectionY = -1.0f;
    float sunDirectionZ = -0.5f;
    float sunIntensity = 1.0f;
    float sunColorR = 1.0f;
    float sunColorG = 1.0f;
    float sunColorB = 1.0f;

    // Ambient light
    float ambientIntensity = 0.3f;
    float ambientColorR = 1.0f;
    float ambientColorG = 1.0f;
    float ambientColorB = 1.0f;
};

// Frame statistics for performance monitoring
struct FrameStats {
    float deltaTimeMs = 0.0f;
    float fpsAverage = 60.0f;
    uint32_t trianglesRendered = 0;
    uint32_t drawCallsSubmitted = 0;
    uint64_t vramUsedBytes = 0;
    uint64_t vramTotalBytes = 0;
    bool vsyncActive = false;
};

// Abstract rendering service interface
// Both Vulkan and software rasterizer backends implement this
class IRenderService {
public:
    virtual ~IRenderService() = default;

    // Lifecycle management
    virtual bool Initialize(const RenderConfig& config) = 0;
    virtual void Shutdown() = 0;

    // Frame management
    // BeginFrame prepares for rendering (clears buffers, acquires swap chain image)
    // EndFrame finalizes rendering (presents swap chain image, updates stats)
    virtual void BeginFrame() = 0;
    virtual void EndFrame() = 0;

    // Camera control
    // SetCamera updates the view and projection matrices for the current frame
    virtual void SetCamera(const CameraData& camera) = 0;

    // Mesh submission
    // SubmitMesh adds a mesh instance to the draw list with the given transform
    // The mesh is drawn during EndFrame
    virtual void SubmitMesh(MeshHandle mesh, const Transform& transform) = 0;

    // Lighting control
    // SetLighting updates lighting parameters for the current frame
    virtual void SetLighting(const LightingData& lighting) = 0;

    // Resource loading
    // LoadMesh parses a mesh file (GLTF, OBJ, etc.) and returns a handle
    // Returns INVALID_MESH_HANDLE on failure
    virtual MeshHandle LoadMesh(const std::string& path) = 0;

    // LoadTexture loads an image file (PNG, JPG, etc.) and returns a handle
    // Returns INVALID_TEXTURE_HANDLE on failure
    virtual TextureHandle LoadTexture(const std::string& path) = 0;

    // Resource cleanup
    virtual void UnloadMesh(MeshHandle handle) = 0;
    virtual void UnloadTexture(TextureHandle handle) = 0;

    // Performance monitoring
    // GetFrameStats returns current rendering statistics
    virtual FrameStats GetFrameStats() const = 0;
};
