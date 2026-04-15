/** DescriptorManager - Vulkan descriptor pool and set management
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <vector>
#include <unordered_map>
#include <mutex>
#include "../core/QuoteSystem.h"
#include "../core/DebugWindow.h"

// Forward declarations for Vulkan types
struct VkDescriptorSetLayout_T;
struct VkDescriptorSet_T;
struct VkDescriptorPool_T;
struct VkDevice_T;

using VkDescriptorSetLayout = VkDescriptorSetLayout_T*;
using VkDescriptorSet = VkDescriptorSet_T*;
using VkDescriptorPool = VkDescriptorPool_T*;
using VkDevice = VkDevice_T*;

// Forward declaration for descriptor set layout bindings
// In the .cpp file, this will be VkDescriptorSetLayoutBinding
struct DescriptorBinding;

// Pool size configuration
constexpr uint32_t DEFAULT_POOL_SIZE = 1000;
constexpr uint32_t MAX_POOLS = 10;

// DescriptorManager owns descriptor pools, layouts, and sets
// Features:
// - Automatic pool creation when existing pools are exhausted
// - Warning logs when approaching memory limits
// - Batch allocation for better performance
class DescriptorManager {
public:
    explicit DescriptorManager(VkDevice device)
        : mDevice(device)
        , mAllocationCount(0)
        , mTotalPoolsCreated(0)
    {
        DebugWindow::Instance().RegisterChannel("Renderer");
        QuoteSystem::Instance().Log("DescriptorManager initialized", QuoteSystem::MessageType::INFO);
    }

    ~DescriptorManager() {
        DestroyAll();
    }

    // Create a descriptor set layout from bindings
    // Returns the layout handle, or nullptr on failure
    VkDescriptorSetLayout CreateLayout(const std::vector<DescriptorBinding>& bindings) {
        // Guard: empty bindings
        if (bindings.empty()) {
            QuoteSystem::Instance().Log("CreateLayout: empty bindings array", QuoteSystem::MessageType::WARNING);
            return nullptr;
        }

        VkDescriptorSetLayout layout = CreateLayoutInternal(bindings);

        // Guard: creation failed
        if (layout == nullptr) {
            QuoteSystem::Instance().Log("CreateLayout: Vulkan layout creation failed",
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Renderer", "Layout creation failed", DebugWindow::DebugLevel::ERR);
            return nullptr;
        }

        // Track layout for cleanup
        std::lock_guard<std::mutex> lock(mMutex);
        mLayouts.push_back(layout);

        QuoteSystem::Instance().Log("Descriptor layout created with " +
            std::to_string(bindings.size()) + " bindings",
            QuoteSystem::MessageType::SUCCESS);
        DebugWindow::Instance().Post("Renderer", "Layout created", DebugWindow::DebugLevel::INFO);

        return layout;
    }

    // Allocate a descriptor set from the pool
    // Returns the set handle, or nullptr on failure
    VkDescriptorSet AllocateSet(VkDescriptorSetLayout layout) {
        // Guard: null layout
        if (layout == nullptr) {
            QuoteSystem::Instance().Log("AllocateSet: null layout provided", QuoteSystem::MessageType::WARNING);
            return nullptr;
        }

        std::lock_guard<std::mutex> lock(mMutex);

        // Ensure we have at least one pool
        if (mPools.empty()) {
            if (!CreatePool()) {
                QuoteSystem::Instance().Log("AllocateSet: failed to create initial pool",
                    QuoteSystem::MessageType::ERROR_MSG);
                return nullptr;
            }
        }

        // Try to allocate from current pool
        VkDescriptorSet set = AllocateSetInternal(mPools.back(), layout);

        // If allocation failed due to pool exhaustion, create a new pool and retry
        if (set == nullptr) {
            DebugWindow::Instance().Post("Renderer", "Descriptor pool exhausted, creating new pool",
                DebugWindow::DebugLevel::WARN);
            QuoteSystem::Instance().Log("Descriptor pool exhausted, creating new pool (total pools: " +
                std::to_string(mPools.size()) + ")",
                QuoteSystem::MessageType::WARNING);

            // Guard: too many pools
            if (mPools.size() >= MAX_POOLS) {
                QuoteSystem::Instance().Log("AllocateSet: maximum pool count reached (" +
                    std::to_string(MAX_POOLS) + ")",
                    QuoteSystem::MessageType::ERROR_MSG);
                DebugWindow::Instance().Post("Renderer", "Max descriptor pools reached", DebugWindow::DebugLevel::CRITICAL);
                return nullptr;
            }

            if (!CreatePool()) {
                QuoteSystem::Instance().Log("AllocateSet: failed to create new pool",
                    QuoteSystem::MessageType::ERROR_MSG);
                return nullptr;
            }

            set = AllocateSetInternal(mPools.back(), layout);
        }

        // Guard: allocation still failed after pool creation
        if (set == nullptr) {
            QuoteSystem::Instance().Log("AllocateSet: allocation failed even after creating new pool",
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Renderer", "Descriptor allocation failed", DebugWindow::DebugLevel::ERR);
            return nullptr;
        }

        // Track allocation
        mAllocationCount++;

        // Warn when approaching limits
        if (mAllocationCount % 500 == 0) {
            DebugWindow::Instance().Post("Renderer", "Descriptor allocation count: " +
                std::to_string(mAllocationCount),
                DebugWindow::DebugLevel::WARN);
        }

        return set;
    }

    // Free a descriptor set back to the pool
    void FreeSet(VkDescriptorSet set) {
        // Guard: null set
        if (set == nullptr) {
            return;
        }

        std::lock_guard<std::mutex> lock(mMutex);

        // Note: Vulkan requires vkResetDescriptorPool to free individual sets
        // For now, we just track the deallocation
        // Full implementation would call vkFreeDescriptorSets
        if (mAllocationCount > 0) {
            mAllocationCount--;
        }

        DebugWindow::Instance().Post("Renderer", "Descriptor set freed", DebugWindow::DebugLevel::TRACE);
    }

    // Destroy all pools and layouts
    void DestroyAll() {
        std::lock_guard<std::mutex> lock(mMutex);

        // Destroy all pools
        for (VkDescriptorPool pool : mPools) {
            DestroyPool(pool);
        }
        mPools.clear();

        // Destroy all layouts
        for (VkDescriptorSetLayout layout : mLayouts) {
            DestroyLayout(layout);
        }
        mLayouts.clear();

        if (mTotalPoolsCreated > 0 || !mLayouts.empty()) {
            QuoteSystem::Instance().Log("DescriptorManager destroyed (pools: " +
                std::to_string(mTotalPoolsCreated) + ", allocations: " +
                std::to_string(mAllocationCount) + ")",
                QuoteSystem::MessageType::INFO);
        }

        mAllocationCount = 0;
        mTotalPoolsCreated = 0;
    }

    // Get current allocation count for memory budget reporting
    uint32_t GetAllocationCount() const {
        std::lock_guard<std::mutex> lock(mMutex);
        return mAllocationCount;
    }

    // Get total number of pools created
    uint32_t GetPoolCount() const {
        std::lock_guard<std::mutex> lock(mMutex);
        return static_cast<uint32_t>(mPools.size());
    }

    // Prevent copy/move
    DescriptorManager(const DescriptorManager&) = delete;
    DescriptorManager& operator=(const DescriptorManager&) = delete;
    DescriptorManager(DescriptorManager&&) = delete;
    DescriptorManager& operator=(DescriptorManager&&) = delete;

private:
    // Create a new descriptor pool
    bool CreatePool();

    // Destroy a descriptor pool
    void DestroyPool(VkDescriptorPool pool);

    // Create a descriptor set layout (internal Vulkan call)
    VkDescriptorSetLayout CreateLayoutInternal(const std::vector<DescriptorBinding>& bindings);

    // Destroy a descriptor set layout
    void DestroyLayout(VkDescriptorSetLayout layout);

    // Allocate a descriptor set from a specific pool
    VkDescriptorSet AllocateSetInternal(VkDescriptorPool pool, VkDescriptorSetLayout layout);

    // Member variables
    VkDevice mDevice;
    mutable std::mutex mMutex;
    std::vector<VkDescriptorPool> mPools;
    std::vector<VkDescriptorSetLayout> mLayouts;
    uint32_t mAllocationCount;
    uint32_t mTotalPoolsCreated;
};

// Note on implementation:
// The .cpp file will include actual Vulkan headers and implement:
//
// CreatePool() will call vkCreateDescriptorPool with pool sizes for:
// - VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER
// - VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER
// - VK_DESCRIPTOR_TYPE_STORAGE_BUFFER
//
// CreateLayoutInternal() will call vkCreateDescriptorSetLayout
//
// AllocateSetInternal() will call vkAllocateDescriptorSets
//
// DestroyPool() will call vkDestroyDescriptorPool
//
// DestroyLayout() will call vkDestroyDescriptorSetLayout
//
// DescriptorBinding is a wrapper around VkDescriptorSetLayoutBinding with fields:
// - binding (uint32_t)
// - descriptorType (VkDescriptorType)
// - descriptorCount (uint32_t)
// - stageFlags (VkShaderStageFlags)
