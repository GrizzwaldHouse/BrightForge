/** SoftwareRenderService - Software rasterizer implementation of IRenderService
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "IRenderService.h"
#include "../core/QuoteSystem.h"
#include "../core/DebugWindow.h"
#include <memory>
#include <vector>
#include <unordered_map>

// Forward declarations for existing software rasterizer components
// These will be included in the .cpp file
class GraphicsHelper;
class Renderer;

// Depth mode enumeration for software rasterizer
enum class DepthMode {
    STANDARD,   // Clear to max, compare LESS (traditional)
    REVERSED    // Clear to 0, compare GREATER (modern, matches Vulkan path)
};

// Software mesh data
struct SoftwareMesh {
    std::vector<float> vertices;
    std::vector<uint32_t> indices;
    uint32_t vertexStride;
};

// Draw command for software rasterizer
struct SoftwareDrawCommand {
    MeshHandle mesh;
    Transform transform;
};

// SoftwareRenderService bridges the existing software rasterizer into IRenderService
// This adapts GraphicsHelper + Renderer + LineDrawing + Shaders to the new architecture
// NO global mutable state - all shader state is member variables
class SoftwareRenderService : public IRenderService {
public:
    SoftwareRenderService()
        : mGraphicsHelper(nullptr)
        , mRenderer(nullptr)
        , mNextMeshHandle(1)
        , mNextTextureHandle(1)
        , mIsInitialized(false)
        , mDepthMode(DepthMode::STANDARD)
        , mFrameNumber(0)
    {
        DebugWindow::Instance().RegisterChannel("Renderer");
    }

    ~SoftwareRenderService() override {
        Shutdown();
    }

    // IRenderService interface implementation

    bool Initialize(const RenderConfig& config) override {
        // Guard: already initialized
        if (mIsInitialized) {
            QuoteSystem::Instance().Log("SoftwareRenderService: already initialized",
                QuoteSystem::MessageType::WARNING);
            return false;
        }

        QuoteSystem::Instance().Log("SoftwareRenderService initialization starting...",
            QuoteSystem::MessageType::INFO);
        DebugWindow::Instance().Post("Renderer", "Software renderer init started", DebugWindow::DebugLevel::INFO);

        // Store configuration
        mConfig = config;

        // Set depth mode based on config
        mDepthMode = config.useReversedZ ? DepthMode::REVERSED : DepthMode::STANDARD;

        // Initialize graphics helper
        if (!InitializeGraphicsHelper()) {
            QuoteSystem::Instance().Log("Failed to initialize GraphicsHelper",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Initialize renderer
        if (!InitializeRenderer()) {
            QuoteSystem::Instance().Log("Failed to initialize Renderer",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Initialize shader state
        InitializeShaderState();

        // Initialize camera with config values
        mCameraData.fovDegrees = config.fovDegrees;
        mCameraData.nearPlane = config.nearPlane;
        mCameraData.farPlane = config.farPlane;
        mCameraData.aspectRatio = static_cast<float>(config.windowWidth) / static_cast<float>(config.windowHeight);
        UpdateCameraMatrices();

        // Initialize lighting
        UpdateLightingState();

        mIsInitialized = true;
        QuoteSystem::Instance().Log("SoftwareRenderService initialization complete (depth mode: " +
            DepthModeToString(mDepthMode) + ")",
            QuoteSystem::MessageType::SUCCESS);
        DebugWindow::Instance().Post("Renderer", "Software renderer ready", DebugWindow::DebugLevel::INFO);

        return true;
    }

    void Shutdown() override {
        // Guard: not initialized
        if (!mIsInitialized) {
            return;
        }

        QuoteSystem::Instance().Log("SoftwareRenderService shutdown starting...",
            QuoteSystem::MessageType::INFO);

        // Unload all meshes
        for (auto& pair : mMeshes) {
            // Mesh data will be cleaned up by RAII
        }
        mMeshes.clear();

        // Unload all textures
        mTextures.clear();

        // Destroy renderer and graphics helper (RAII)
        mRenderer.reset();
        mGraphicsHelper.reset();

        mIsInitialized = false;
        QuoteSystem::Instance().Log("SoftwareRenderService shutdown complete",
            QuoteSystem::MessageType::SUCCESS);
    }

    void BeginFrame() override {
        // Guard: not initialized
        if (!mIsInitialized) {
            return;
        }

        // Clear the pixel buffer with configured color
        ClearFramebuffer();

        // Clear draw list from previous frame
        mDrawList.clear();
    }

    void EndFrame() override {
        // Guard: not initialized
        if (!mIsInitialized) {
            return;
        }

        // Render all submitted meshes
        RenderDrawList();

        // Update frame stats
        UpdateFrameStats();

        // Increment frame counter
        mFrameNumber++;
    }

    void SetCamera(const CameraData& camera) override {
        mCameraData = camera;
        UpdateCameraMatrices();
    }

    void SubmitMesh(MeshHandle mesh, const Transform& transform) override {
        // Guard: invalid mesh
        if (mesh == INVALID_MESH_HANDLE) {
            return;
        }

        // Guard: mesh not loaded
        if (mMeshes.find(mesh) == mMeshes.end()) {
            QuoteSystem::Instance().Log("SubmitMesh: mesh handle not found",
                QuoteSystem::MessageType::WARNING);
            return;
        }

        // Add to draw list
        SoftwareDrawCommand cmd;
        cmd.mesh = mesh;
        cmd.transform = transform;
        mDrawList.push_back(cmd);
    }

    void SetLighting(const LightingData& lighting) override {
        mLightingData = lighting;
        UpdateLightingState();
    }

    MeshHandle LoadMesh(const std::string& path) override {
        // Guard: empty path
        if (path.empty()) {
            QuoteSystem::Instance().Log("LoadMesh: empty path", QuoteSystem::MessageType::WARNING);
            return INVALID_MESH_HANDLE;
        }

        // Parse mesh file (GLTF, OBJ, etc.)
        SoftwareMesh mesh;
        if (!ParseMeshFile(path, mesh)) {
            QuoteSystem::Instance().Log("LoadMesh: failed to parse - " + path,
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Renderer", "Mesh load failed: " + path, DebugWindow::DebugLevel::ERR);
            return INVALID_MESH_HANDLE;
        }

        // Assign handle and store
        MeshHandle handle = mNextMeshHandle++;
        mMeshes[handle] = mesh;

        QuoteSystem::Instance().Log("Mesh loaded: " + path + " (handle " + std::to_string(handle) + ")",
            QuoteSystem::MessageType::SUCCESS);
        DebugWindow::Instance().Post("Renderer", "Mesh loaded: " + path, DebugWindow::DebugLevel::INFO);

        return handle;
    }

    TextureHandle LoadTexture(const std::string& path) override {
        // Guard: empty path
        if (path.empty()) {
            QuoteSystem::Instance().Log("LoadTexture: empty path", QuoteSystem::MessageType::WARNING);
            return INVALID_TEXTURE_HANDLE;
        }

        // Parse texture file (PNG, JPG, etc.)
        // For now, just assign a handle
        TextureHandle handle = mNextTextureHandle++;
        mTextures[handle] = path;

        QuoteSystem::Instance().Log("Texture loaded: " + path + " (handle " + std::to_string(handle) + ")",
            QuoteSystem::MessageType::SUCCESS);
        DebugWindow::Instance().Post("Renderer", "Texture loaded: " + path, DebugWindow::DebugLevel::INFO);

        return handle;
    }

    void UnloadMesh(MeshHandle handle) override {
        // Guard: invalid handle
        if (handle == INVALID_MESH_HANDLE) {
            return;
        }

        auto it = mMeshes.find(handle);
        if (it != mMeshes.end()) {
            mMeshes.erase(it);
            DebugWindow::Instance().Post("Renderer", "Mesh unloaded (handle " +
                std::to_string(handle) + ")",
                DebugWindow::DebugLevel::TRACE);
        }
    }

    void UnloadTexture(TextureHandle handle) override {
        // Guard: invalid handle
        if (handle == INVALID_TEXTURE_HANDLE) {
            return;
        }

        auto it = mTextures.find(handle);
        if (it != mTextures.end()) {
            mTextures.erase(it);
            DebugWindow::Instance().Post("Renderer", "Texture unloaded (handle " +
                std::to_string(handle) + ")",
                DebugWindow::DebugLevel::TRACE);
        }
    }

    FrameStats GetFrameStats() const override {
        return mFrameStats;
    }

    // Software rasterizer specific methods

    // Set depth mode (can be changed at runtime)
    void SetDepthMode(DepthMode mode) {
        mDepthMode = mode;
        QuoteSystem::Instance().Log("Depth mode changed to " + DepthModeToString(mode),
            QuoteSystem::MessageType::INFO);
    }

    DepthMode GetDepthMode() const {
        return mDepthMode;
    }

    // Prevent copy/move
    SoftwareRenderService(const SoftwareRenderService&) = delete;
    SoftwareRenderService& operator=(const SoftwareRenderService&) = delete;
    SoftwareRenderService(SoftwareRenderService&&) = delete;
    SoftwareRenderService& operator=(SoftwareRenderService&&) = delete;

private:
    // Initialization helpers
    bool InitializeGraphicsHelper();
    bool InitializeRenderer();
    void InitializeShaderState();

    // Frame rendering
    void ClearFramebuffer();
    void RenderDrawList();

    // Update functions
    void UpdateCameraMatrices();
    void UpdateLightingState();
    void UpdateFrameStats();

    // Mesh parsing
    bool ParseMeshFile(const std::string& path, SoftwareMesh& outMesh);

    // Depth mode conversion
    static std::string DepthModeToString(DepthMode mode) {
        switch (mode) {
            case DepthMode::STANDARD: return "STANDARD";
            case DepthMode::REVERSED: return "REVERSED";
            default:                  return "UNKNOWN";
        }
    }

    // Member variables
    RenderConfig mConfig;
    CameraData mCameraData;
    LightingData mLightingData;
    FrameStats mFrameStats;

    // Graphics subsystems
    std::unique_ptr<GraphicsHelper> mGraphicsHelper;
    std::unique_ptr<Renderer> mRenderer;

    // Resource storage
    std::unordered_map<MeshHandle, SoftwareMesh> mMeshes;
    std::unordered_map<TextureHandle, std::string> mTextures;

    // Handle counters
    MeshHandle mNextMeshHandle;
    TextureHandle mNextTextureHandle;

    // Draw state
    std::vector<SoftwareDrawCommand> mDrawList;
    uint64_t mFrameNumber;
    bool mIsInitialized;

    // Depth configuration
    DepthMode mDepthMode;

    // Shader state (encapsulated, no globals)
    // These replace the global mutable state from the original Shaders.h
    struct ShaderState {
        // World/View/Projection matrices
        float worldMatrix[16];
        float viewMatrix[16];
        float projectionMatrix[16];

        // Lighting parameters
        float sunDirection[3];
        float sunIntensity;
        float ambientIntensity;

        ShaderState() {
            // Initialize to identity/defaults
            for (int i = 0; i < 16; ++i) {
                worldMatrix[i] = (i % 5 == 0) ? 1.0f : 0.0f;
                viewMatrix[i] = (i % 5 == 0) ? 1.0f : 0.0f;
                projectionMatrix[i] = (i % 5 == 0) ? 1.0f : 0.0f;
            }
            sunDirection[0] = -0.5f;
            sunDirection[1] = -1.0f;
            sunDirection[2] = -0.5f;
            sunIntensity = 1.0f;
            ambientIntensity = 0.3f;
        }
    } mShaderState;
};

// Note on implementation:
// The .cpp file will include GraphicsHelper.hpp, Renderer.h, LineDrawing.h, and Shaders.h.
//
// InitializeGraphicsHelper() will create a GraphicsHelper instance with window dimensions
// from config and call setDepthMode() to configure reversed-Z if enabled.
//
// InitializeRenderer() will create a Renderer instance and configure it with the
// GraphicsHelper instance.
//
// ClearFramebuffer() will call GraphicsHelper::clearBuffer() with the clear color
// parsed from mConfig.clearColorHex.
//
// RenderDrawList() will iterate mDrawList and for each command:
// - Look up the mesh data from mMeshes
// - Build a world matrix from the transform
// - Call Renderer::renderMesh() with the mesh data and matrices
//
// UpdateCameraMatrices() will compute view and projection matrices from mCameraData
// and store them in mShaderState for use by the vertex shader.
//
// UpdateLightingState() will copy mLightingData into mShaderState for use by the
// pixel shader.
//
// The depth mode switching logic from BRIGHTFORGE_MASTER.md will be implemented in
// GraphicsHelper by adding a setDepthMode() method that controls clearBuffer() and
// drawPixel() behavior.
