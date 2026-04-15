/** BufferAllocator - Typed Vulkan buffer creation and tracking
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <vector>
#include <unordered_map>
#include <mutex>
#include <cstdint>
#include "../core/QuoteSystem.h"
#include "../core/DebugWindow.h"

// Forward declarations for Vulkan types
struct VkBuffer_T;
struct VkDeviceMemory_T;
struct VkDevice_T;
struct VkPhysicalDevice_T;

using VkBuffer = VkBuffer_T*;
using VkDeviceMemory = VkDeviceMemory_T*;
using VkDevice = VkDevice_T*;
using VkPhysicalDevice = VkPhysicalDevice_T*;

// Buffer handle type
using BufferHandle = uint32_t;
constexpr BufferHandle INVALID_BUFFER_HANDLE = 0;

// Memory usage warning threshold (80% of device limit)
constexpr float MEMORY_WARNING_THRESHOLD = 0.8f;

// Buffer metadata for tracking
struct BufferInfo {
    VkBuffer buffer;
    VkDeviceMemory memory;
    uint64_t size;
    bool isMapped;
    void* mappedPointer;

    BufferInfo()
        : buffer(nullptr)
        , memory(nullptr)
        , size(0)
        , isMapped(false)
        , mappedPointer(nullptr)
    {}
};

// BufferAllocator handles typed buffer creation and tracking
// Features:
// - Type-safe buffer creation (vertex, index, uniform)
// - Memory budget tracking with warnings at 80% usage
// - Reverse-order cleanup to prevent dependency issues
class BufferAllocator {
public:
    BufferAllocator(VkDevice device, VkPhysicalDevice physicalDevice)
        : mDevice(device)
        , mPhysicalDevice(physicalDevice)
        , mNextHandle(1)
        , mTotalAllocatedBytes(0)
        , mDeviceMemoryLimit(0)
    {
        DebugWindow::Instance().RegisterChannel("Renderer");
        QueryDeviceMemoryLimit();
        QuoteSystem::Instance().Log("BufferAllocator initialized (memory limit: " +
            std::to_string(mDeviceMemoryLimit / (1024 * 1024)) + " MB)",
            QuoteSystem::MessageType::INFO);
    }

    ~BufferAllocator() {
        DestroyAll();
    }

    // Create a vertex buffer
    BufferHandle CreateVertexBuffer(const void* data, uint64_t size) {
        // Guard: null data
        if (data == nullptr || size == 0) {
            QuoteSystem::Instance().Log("CreateVertexBuffer: null data or zero size",
                QuoteSystem::MessageType::WARNING);
            return INVALID_BUFFER_HANDLE;
        }

        BufferHandle handle = CreateBufferInternal(data, size, BufferType::VERTEX);

        if (handle != INVALID_BUFFER_HANDLE) {
            QuoteSystem::Instance().Log("Vertex buffer created (" + std::to_string(size) + " bytes)",
                QuoteSystem::MessageType::SUCCESS);
            DebugWindow::Instance().Post("Renderer", "Vertex buffer created", DebugWindow::DebugLevel::INFO);
        }

        return handle;
    }

    // Create an index buffer
    BufferHandle CreateIndexBuffer(const void* data, uint64_t size) {
        // Guard: null data
        if (data == nullptr || size == 0) {
            QuoteSystem::Instance().Log("CreateIndexBuffer: null data or zero size",
                QuoteSystem::MessageType::WARNING);
            return INVALID_BUFFER_HANDLE;
        }

        BufferHandle handle = CreateBufferInternal(data, size, BufferType::INDEX);

        if (handle != INVALID_BUFFER_HANDLE) {
            QuoteSystem::Instance().Log("Index buffer created (" + std::to_string(size) + " bytes)",
                QuoteSystem::MessageType::SUCCESS);
            DebugWindow::Instance().Post("Renderer", "Index buffer created", DebugWindow::DebugLevel::INFO);
        }

        return handle;
    }

    // Create a uniform buffer (no initial data, will be updated per-frame)
    BufferHandle CreateUniformBuffer(uint64_t size) {
        // Guard: zero size
        if (size == 0) {
            QuoteSystem::Instance().Log("CreateUniformBuffer: zero size",
                QuoteSystem::MessageType::WARNING);
            return INVALID_BUFFER_HANDLE;
        }

        BufferHandle handle = CreateBufferInternal(nullptr, size, BufferType::UNIFORM);

        if (handle != INVALID_BUFFER_HANDLE) {
            QuoteSystem::Instance().Log("Uniform buffer created (" + std::to_string(size) + " bytes)",
                QuoteSystem::MessageType::SUCCESS);
            DebugWindow::Instance().Post("Renderer", "Uniform buffer created", DebugWindow::DebugLevel::INFO);
        }

        return handle;
    }

    // Write data to a buffer at an offset
    bool WriteBuffer(BufferHandle handle, const void* data, uint64_t size, uint64_t offset = 0) {
        // Guard: invalid handle
        if (handle == INVALID_BUFFER_HANDLE) {
            QuoteSystem::Instance().Log("WriteBuffer: invalid handle", QuoteSystem::MessageType::WARNING);
            return false;
        }

        // Guard: null data
        if (data == nullptr || size == 0) {
            QuoteSystem::Instance().Log("WriteBuffer: null data or zero size", QuoteSystem::MessageType::WARNING);
            return false;
        }

        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: handle not found
        auto it = mBuffers.find(handle);
        if (it == mBuffers.end()) {
            QuoteSystem::Instance().Log("WriteBuffer: handle not found", QuoteSystem::MessageType::WARNING);
            return false;
        }

        BufferInfo& info = it->second;

        // Guard: write exceeds buffer size
        if (offset + size > info.size) {
            QuoteSystem::Instance().Log("WriteBuffer: write would exceed buffer size",
                QuoteSystem::MessageType::WARNING);
            return false;
        }

        bool success = WriteBufferInternal(info, data, size, offset);

        if (!success) {
            QuoteSystem::Instance().Log("WriteBuffer: write operation failed",
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Renderer", "Buffer write failed", DebugWindow::DebugLevel::ERR);
        }

        return success;
    }

    // Destroy a specific buffer
    void DestroyBuffer(BufferHandle handle) {
        // Guard: invalid handle
        if (handle == INVALID_BUFFER_HANDLE) {
            return;
        }

        std::lock_guard<std::mutex> lock(mMutex);

        auto it = mBuffers.find(handle);
        if (it == mBuffers.end()) {
            return;
        }

        BufferInfo& info = it->second;
        DestroyBufferInternal(info);

        mTotalAllocatedBytes -= info.size;
        mBuffers.erase(it);

        DebugWindow::Instance().Post("Renderer", "Buffer destroyed (handle " +
            std::to_string(handle) + ")",
            DebugWindow::DebugLevel::TRACE);
    }

    // Destroy all buffers in reverse order
    void DestroyAll() {
        std::lock_guard<std::mutex> lock(mMutex);

        // Destroy in reverse order to handle dependencies
        for (auto it = mBuffers.rbegin(); it != mBuffers.rend(); ++it) {
            DestroyBufferInternal(it->second);
        }

        if (!mBuffers.empty()) {
            QuoteSystem::Instance().Log("BufferAllocator destroyed " +
                std::to_string(mBuffers.size()) + " buffers (total: " +
                std::to_string(mTotalAllocatedBytes / (1024 * 1024)) + " MB)",
                QuoteSystem::MessageType::INFO);
        }

        mBuffers.clear();
        mTotalAllocatedBytes = 0;
        mNextHandle = 1;
    }

    // Get total allocated memory in bytes
    uint64_t GetMemoryUsage() const {
        std::lock_guard<std::mutex> lock(mMutex);
        return mTotalAllocatedBytes;
    }

    // Get number of allocated buffers
    uint32_t GetBufferCount() const {
        std::lock_guard<std::mutex> lock(mMutex);
        return static_cast<uint32_t>(mBuffers.size());
    }

    // Prevent copy/move
    BufferAllocator(const BufferAllocator&) = delete;
    BufferAllocator& operator=(const BufferAllocator&) = delete;
    BufferAllocator(BufferAllocator&&) = delete;
    BufferAllocator& operator=(BufferAllocator&&) = delete;

private:
    enum class BufferType {
        VERTEX,
        INDEX,
        UNIFORM
    };

    // Create a buffer of the specified type
    BufferHandle CreateBufferInternal(const void* data, uint64_t size, BufferType type) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Check memory budget before allocation
        uint64_t newTotal = mTotalAllocatedBytes + size;
        float usageRatio = static_cast<float>(newTotal) / static_cast<float>(mDeviceMemoryLimit);

        if (usageRatio >= MEMORY_WARNING_THRESHOLD && usageRatio < 1.0f) {
            DebugWindow::Instance().Post("Renderer", "Memory usage at " +
                std::to_string(static_cast<int>(usageRatio * 100.0f)) + "%",
                DebugWindow::DebugLevel::WARN);
            QuoteSystem::Instance().Log("Buffer memory usage approaching limit: " +
                std::to_string(static_cast<int>(usageRatio * 100.0f)) + "%",
                QuoteSystem::MessageType::WARNING);
        } else if (usageRatio >= 1.0f) {
            QuoteSystem::Instance().Log("Buffer memory limit exceeded",
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Renderer", "Memory limit exceeded", DebugWindow::DebugLevel::CRITICAL);
            return INVALID_BUFFER_HANDLE;
        }

        // Create the Vulkan buffer
        BufferInfo info;
        info.size = size;
        bool success = CreateVulkanBuffer(info, data, type);

        if (!success) {
            QuoteSystem::Instance().Log("CreateBufferInternal: Vulkan buffer creation failed",
                QuoteSystem::MessageType::ERROR_MSG);
            return INVALID_BUFFER_HANDLE;
        }

        // Assign handle and track
        BufferHandle handle = mNextHandle++;
        mBuffers[handle] = info;
        mTotalAllocatedBytes += size;

        return handle;
    }

    // Create the actual Vulkan buffer and memory
    bool CreateVulkanBuffer(BufferInfo& info, const void* data, BufferType type);

    // Write data to a buffer
    bool WriteBufferInternal(BufferInfo& info, const void* data, uint64_t size, uint64_t offset);

    // Destroy a buffer and its memory
    void DestroyBufferInternal(BufferInfo& info);

    // Query device memory limit
    void QueryDeviceMemoryLimit();

    // Member variables
    VkDevice mDevice;
    VkPhysicalDevice mPhysicalDevice;
    mutable std::mutex mMutex;
    std::unordered_map<BufferHandle, BufferInfo> mBuffers;
    BufferHandle mNextHandle;
    uint64_t mTotalAllocatedBytes;
    uint64_t mDeviceMemoryLimit;
};

// Note on implementation:
// The .cpp file will include actual Vulkan headers and implement:
//
// CreateVulkanBuffer() will:
// - Call vkCreateBuffer with appropriate VkBufferCreateInfo
// - Use VK_BUFFER_USAGE_VERTEX_BUFFER_BIT for vertex buffers
// - Use VK_BUFFER_USAGE_INDEX_BUFFER_BIT for index buffers
// - Use VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT for uniform buffers
// - Call vkAllocateMemory with VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
// - Call vkBindBufferMemory to bind the buffer to the allocated memory
// - If data is not null, map the memory and copy the data
//
// WriteBufferInternal() will:
// - Call vkMapMemory to get a CPU-visible pointer
// - Copy data using memcpy
// - Call vkUnmapMemory to unmap the buffer
//
// DestroyBufferInternal() will:
// - Call vkDestroyBuffer
// - Call vkFreeMemory
//
// QueryDeviceMemoryLimit() will:
// - Call vkGetPhysicalDeviceMemoryProperties
// - Sum up all heaps with VK_MEMORY_HEAP_DEVICE_LOCAL_BIT
