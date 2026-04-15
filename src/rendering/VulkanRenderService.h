/** VulkanRenderService - Vulkan implementation of IRenderService
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "IRenderService.h"
#include "VulkanContext.h"
#include "ShaderCompiler.h"
#include "DescriptorManager.h"
#include "BufferAllocator.h"
#include "../core/QuoteSystem.h"
#include "../core/DebugWindow.h"
#include <memory>
#include <vector>
#include <unordered_map>

// Forward declarations for Vulkan types
struct VkCommandBuffer_T;
struct VkPipeline_T;
struct VkPipelineLayout_T;
struct VkRenderPass_T;
struct VkFramebuffer_T;

using VkCommandBuffer = VkCommandBuffer_T*;
using VkPipeline = VkPipeline_T*;
using VkPipelineLayout = VkPipelineLayout_T*;
using VkRenderPass = VkRenderPass_T*;
using VkFramebuffer = VkFramebuffer_T*;

// Forward declaration for GateWare Vulkan surface
namespace GW {
    namespace GRAPHICS {
        class GVulkanSurface;
    }
}

// Draw command for mesh submission
struct DrawCommand {
    MeshHandle mesh;
    Transform transform;
};

// VulkanRenderService implements IRenderService using Vulkan API
// Features:
// - Reversed-Z depth buffer for improved precision
// - Event-driven camera and config updates
// - Separated update/record/submit phases
class VulkanRenderService : public IRenderService {
public:
    explicit VulkanRenderService(GW::GRAPHICS::GVulkanSurface& surface)
        : mSurface(surface)
        , mContext(nullptr)
        , mShaderCompiler(nullptr)
        , mDescriptorManager(nullptr)
        , mBufferAllocator(nullptr)
        , mPipeline(nullptr)
        , mPipelineLayout(nullptr)
        , mRenderPass(nullptr)
        , mCommandBuffer(nullptr)
        , mFrameNumber(0)
        , mIsInitialized(false)
    {
        DebugWindow::Instance().RegisterChannel("Renderer");
    }

    ~VulkanRenderService() override {
        Shutdown();
    }

    // IRenderService interface implementation

    bool Initialize(const RenderConfig& config) override {
        // Guard: already initialized
        if (mIsInitialized) {
            QuoteSystem::Instance().Log("VulkanRenderService: already initialized",
                QuoteSystem::MessageType::WARNING);
            return false;
        }

        QuoteSystem::Instance().Log("VulkanRenderService initialization starting...",
            QuoteSystem::MessageType::INFO);
        DebugWindow::Instance().Post("Renderer", "Initialization started", DebugWindow::DebugLevel::INFO);

        // Store configuration
        mConfig = config;

        // 10-step initialization sequence from BRIGHTFORGE_MASTER.md
        // Step 1: Extract device handles
        mContext = std::make_unique<VulkanContext>(mSurface);
        if (!mContext->Initialize()) {
            QuoteSystem::Instance().Log("Step 1 failed: VulkanContext initialization",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 2: Create subsystems
        mShaderCompiler = std::make_unique<ShaderCompiler>();
        mDescriptorManager = std::make_unique<DescriptorManager>(mContext->GetDevice());
        mBufferAllocator = std::make_unique<BufferAllocator>(mContext->GetDevice(), mContext->GetPhysicalDevice());

        QuoteSystem::Instance().Log("Subsystems created", QuoteSystem::MessageType::SUCCESS);

        // Step 3: Create render pass with reversed-Z depth
        if (!CreateRenderPass()) {
            QuoteSystem::Instance().Log("Step 3 failed: Render pass creation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 4: Compile shaders
        if (!CompileShaders()) {
            QuoteSystem::Instance().Log("Step 4 failed: Shader compilation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 5: Create descriptor set layouts
        if (!CreateDescriptorLayouts()) {
            QuoteSystem::Instance().Log("Step 5 failed: Descriptor layout creation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 6: Create pipeline layout
        if (!CreatePipelineLayout()) {
            QuoteSystem::Instance().Log("Step 6 failed: Pipeline layout creation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 7: Create graphics pipeline with reversed-Z settings
        if (!CreateGraphicsPipeline()) {
            QuoteSystem::Instance().Log("Step 7 failed: Graphics pipeline creation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 8: Create framebuffers
        if (!CreateFramebuffers()) {
            QuoteSystem::Instance().Log("Step 8 failed: Framebuffer creation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 9: Allocate command buffers
        if (!AllocateCommandBuffers()) {
            QuoteSystem::Instance().Log("Step 9 failed: Command buffer allocation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Step 10: Create synchronization primitives
        if (!CreateSyncObjects()) {
            QuoteSystem::Instance().Log("Step 10 failed: Sync object creation",
                QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        // Subscribe to events
        SubscribeToEvents();

        mIsInitialized = true;
        QuoteSystem::Instance().Log("VulkanRenderService initialization complete",
            QuoteSystem::MessageType::SUCCESS);
        DebugWindow::Instance().Post("Renderer", "Initialization complete", DebugWindow::DebugLevel::INFO);

        return true;
    }

    void Shutdown() override {
        // Guard: not initialized
        if (!mIsInitialized) {
            return;
        }

        QuoteSystem::Instance().Log("VulkanRenderService shutdown starting...",
            QuoteSystem::MessageType::INFO);

        // Wait for device to finish all operations
        WaitForDeviceIdle();

        // Destroy in reverse order of creation
        DestroySyncObjects();
        DestroyCommandBuffers();
        DestroyFramebuffers();
        DestroyGraphicsPipeline();
        DestroyPipelineLayout();
        DestroyDescriptorLayouts();
        DestroyRenderPass();

        // Destroy subsystems (RAII will handle cleanup)
        mBufferAllocator.reset();
        mDescriptorManager.reset();
        mShaderCompiler.reset();
        mContext.reset();

        mIsInitialized = false;
        QuoteSystem::Instance().Log("VulkanRenderService shutdown complete",
            QuoteSystem::MessageType::SUCCESS);
    }

    void BeginFrame() override {
        // Guard: not initialized
        if (!mIsInitialized) {
            return;
        }

        // Acquire next swap chain image
        AcquireNextImage();

        // Begin command buffer recording
        BeginCommandBuffer();

        // Begin render pass with reversed-Z clear values
        BeginRenderPass();

        // Bind pipeline
        BindPipeline();
    }

    void EndFrame() override {
        // Guard: not initialized
        if (!mIsInitialized) {
            return;
        }

        // End render pass
        EndRenderPass();

        // End command buffer recording
        EndCommandBuffer();

        // Submit command buffer to queue
        SubmitCommandBuffer();

        // Present swap chain image
        PresentFrame();

        // Update frame counter and stats
        mFrameNumber++;
        UpdateFrameStats();
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

        // Add to draw list for current frame
        DrawCommand cmd;
        cmd.mesh = mesh;
        cmd.transform = transform;
        mDrawList.push_back(cmd);
    }

    void SetLighting(const LightingData& lighting) override {
        mLightingData = lighting;
        UpdateLightingUniforms();
    }

    MeshHandle LoadMesh(const std::string& path) override {
        // Guard: empty path
        if (path.empty()) {
            QuoteSystem::Instance().Log("LoadMesh: empty path", QuoteSystem::MessageType::WARNING);
            return INVALID_MESH_HANDLE;
        }

        // Load mesh implementation will be added
        // For now, return invalid handle
        QuoteSystem::Instance().Log("LoadMesh not yet implemented: " + path,
            QuoteSystem::MessageType::WARNING);
        return INVALID_MESH_HANDLE;
    }

    TextureHandle LoadTexture(const std::string& path) override {
        // Guard: empty path
        if (path.empty()) {
            QuoteSystem::Instance().Log("LoadTexture: empty path", QuoteSystem::MessageType::WARNING);
            return INVALID_TEXTURE_HANDLE;
        }

        // Load texture implementation will be added
        // For now, return invalid handle
        QuoteSystem::Instance().Log("LoadTexture not yet implemented: " + path,
            QuoteSystem::MessageType::WARNING);
        return INVALID_TEXTURE_HANDLE;
    }

    void UnloadMesh(MeshHandle handle) override {
        // Guard: invalid handle
        if (handle == INVALID_MESH_HANDLE) {
            return;
        }

        // Mesh unload implementation will be added
    }

    void UnloadTexture(TextureHandle handle) override {
        // Guard: invalid handle
        if (handle == INVALID_TEXTURE_HANDLE) {
            return;
        }

        // Texture unload implementation will be added
    }

    FrameStats GetFrameStats() const override {
        return mFrameStats;
    }

    // Prevent copy/move
    VulkanRenderService(const VulkanRenderService&) = delete;
    VulkanRenderService& operator=(const VulkanRenderService&) = delete;
    VulkanRenderService(VulkanRenderService&&) = delete;
    VulkanRenderService& operator=(VulkanRenderService&&) = delete;

private:
    // Initialization steps
    bool CreateRenderPass();
    bool CompileShaders();
    bool CreateDescriptorLayouts();
    bool CreatePipelineLayout();
    bool CreateGraphicsPipeline();
    bool CreateFramebuffers();
    bool AllocateCommandBuffers();
    bool CreateSyncObjects();

    // Shutdown steps
    void WaitForDeviceIdle();
    void DestroySyncObjects();
    void DestroyCommandBuffers();
    void DestroyFramebuffers();
    void DestroyGraphicsPipeline();
    void DestroyPipelineLayout();
    void DestroyDescriptorLayouts();
    void DestroyRenderPass();

    // Frame rendering steps
    void AcquireNextImage();
    void BeginCommandBuffer();
    void BeginRenderPass();
    void BindPipeline();
    void EndRenderPass();
    void EndCommandBuffer();
    void SubmitCommandBuffer();
    void PresentFrame();

    // Update functions
    void UpdateCameraMatrices();
    void UpdateLightingUniforms();
    void UpdateFrameStats();

    // Event system integration
    void SubscribeToEvents();
    void OnCameraUpdated();
    void OnConfigChanged();

    // Member variables
    GW::GRAPHICS::GVulkanSurface& mSurface;
    RenderConfig mConfig;
    CameraData mCameraData;
    LightingData mLightingData;
    FrameStats mFrameStats;

    // Subsystems
    std::unique_ptr<VulkanContext> mContext;
    std::unique_ptr<ShaderCompiler> mShaderCompiler;
    std::unique_ptr<DescriptorManager> mDescriptorManager;
    std::unique_ptr<BufferAllocator> mBufferAllocator;

    // Vulkan objects
    VkPipeline mPipeline;
    VkPipelineLayout mPipelineLayout;
    VkRenderPass mRenderPass;
    VkCommandBuffer mCommandBuffer;
    std::vector<VkFramebuffer> mFramebuffers;

    // Draw state
    std::vector<DrawCommand> mDrawList;
    uint64_t mFrameNumber;
    bool mIsInitialized;
};

// Note on implementation:
// The .cpp file will implement all private methods with full Vulkan API calls.
//
// CreateRenderPass() will configure:
// - Depth attachment with VK_FORMAT_D32_SFLOAT
// - Clear value of 0.0f for reversed-Z
// - Load op CLEAR, store op STORE
//
// CreateGraphicsPipeline() will configure:
// - Depth test enabled with VK_COMPARE_OP_GREATER (reversed-Z)
// - Depth write enabled
// - Viewport with minDepth=1.0f, maxDepth=0.0f (reversed-Z)
// - Cull mode BACK, front face COUNTER_CLOCKWISE
//
// Event subscriptions will use EventBus:
// - Subscribe to "camera.updated" → OnCameraUpdated()
// - Subscribe to "config.changed" → OnConfigChanged()
// - Publish "render.frame_end" after PresentFrame()
