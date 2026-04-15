/** VulkanContext - Vulkan device and instance management
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include "../core/QuoteSystem.h"
#include "../core/DebugWindow.h"

// Forward declarations for Vulkan types
// This allows the header to compile without Vulkan SDK installed
// In the .cpp file, these will be replaced with actual Vulkan headers
struct VkDevice_T;
struct VkPhysicalDevice_T;
struct VkInstance_T;

using VkDevice = VkDevice_T*;
using VkPhysicalDevice = VkPhysicalDevice_T*;
using VkInstance = VkInstance_T*;

// Forward declaration for GateWare Vulkan surface
namespace GW {
    namespace GRAPHICS {
        class GVulkanSurface;
    }
}

// VulkanContext owns the core Vulkan device handles
// Extracted from the monolithic renderer for better separation of concerns
class VulkanContext {
public:
    // Constructor takes a reference to the GateWare Vulkan surface
    // The surface must outlive this context
    explicit VulkanContext(GW::GRAPHICS::GVulkanSurface& surface)
        : mSurface(surface)
        , mDevice(nullptr)
        , mPhysicalDevice(nullptr)
        , mInstance(nullptr)
    {
        // Register debug channel for renderer subsystem
        DebugWindow::Instance().RegisterChannel("Renderer");
    }

    ~VulkanContext() {
        // Device cleanup is handled by GVulkanSurface
        // This context is non-owning, just a handle accessor
    }

    // Initialize by extracting device handles from the surface
    // This wraps the GetHandlesFromSurface pattern from the original renderer
    bool Initialize() {
        // Guard: surface is null
        if (!ExtractHandles()) {
            QuoteSystem::Instance().Log("VulkanContext: failed to extract device handles",
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Renderer", "Handle extraction failed", DebugWindow::DebugLevel::ERR);
            return false;
        }

        // Validate device features required for rendering
        if (!ValidateDeviceFeatures()) {
            QuoteSystem::Instance().Log("VulkanContext: device missing required features",
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Renderer", "Device feature validation failed", DebugWindow::DebugLevel::ERR);
            return false;
        }

        std::string deviceName = GetDeviceName();
        QuoteSystem::Instance().Log("VulkanContext initialized on device: " + deviceName,
            QuoteSystem::MessageType::SUCCESS);
        DebugWindow::Instance().Post("Renderer", "Context ready: " + deviceName, DebugWindow::DebugLevel::INFO);

        return true;
    }

    // Getters for Vulkan handles
    VkDevice GetDevice() const { return mDevice; }
    VkPhysicalDevice GetPhysicalDevice() const { return mPhysicalDevice; }
    VkInstance GetInstance() const { return mInstance; }

    // Get the name of the physical device for logging
    std::string GetDeviceName() const;

    // Validate that the device supports required features
    // Checks for bindless descriptors and descriptor indexing
    bool ValidateDeviceFeatures() const;

    // Prevent copy/move - this is a non-owning handle wrapper
    VulkanContext(const VulkanContext&) = delete;
    VulkanContext& operator=(const VulkanContext&) = delete;
    VulkanContext(VulkanContext&&) = delete;
    VulkanContext& operator=(VulkanContext&&) = delete;

private:
    // Extract device handles from GateWare surface
    // Returns true if all handles are valid
    bool ExtractHandles();

    // Member variables
    GW::GRAPHICS::GVulkanSurface& mSurface;
    VkDevice mDevice;
    VkPhysicalDevice mPhysicalDevice;
    VkInstance mInstance;
};

// Note on implementation:
// The .cpp file for this class will include actual Vulkan headers and GateWare headers.
// ExtractHandles() will call surface.GetDevice() and similar methods.
// ValidateDeviceFeatures() will query VkPhysicalDeviceFeatures2 with
// VkPhysicalDeviceDescriptorIndexingFeatures to check for:
// - descriptorBindingPartiallyBound
// - runtimeDescriptorArray
// - descriptorBindingVariableDescriptorCount
// These are required for the bindless texture system.
//
// GetDeviceName() will query VkPhysicalDeviceProperties.deviceName.
