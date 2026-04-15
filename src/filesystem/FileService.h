/**
 * FileService - Central file loading service with async queue
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <mutex>
#include <chrono>
#include <filesystem>
#include "FormatValidator.h"
#include "../core/QuoteSystem.h"
#include "../core/EventBus.h"

namespace BrightForge {

// Asset handle type
using AssetHandle = uint32_t;

// Invalid handle constant
static constexpr AssetHandle INVALID_HANDLE = 0;

// Asset information structure
struct AssetInfo {
    AssetHandle handle;
    std::string path;
    AssetFormat format;
    size_t sizeBytes;
    double loadTimeMs;
    std::chrono::system_clock::time_point loadedAt;

    AssetInfo()
        : handle(INVALID_HANDLE)
        , path("")
        , format(AssetFormat::UNKNOWN)
        , sizeBytes(0)
        , loadTimeMs(0.0)
        , loadedAt(std::chrono::system_clock::now())
    {}
};

// Async load callback signature
using LoadCallback = std::function<void(AssetHandle, bool success, const std::string& errorMsg)>;

class FileService {
public:
    FileService()
        : m_nextHandle(1)
        , m_validator()
    {
        // Register debug channel
        QuoteSystem::Get().Log("SUCCESS", "FileService", "Initialized with DebugWindow channel 'FileSystem'");

        // Subscribe to file.dropped events
        EventBus::Get().Subscribe("file.dropped", [this](const EventData& data) {
            OnFileDropped(data);
        });
    }

    ~FileService() {
        Clear();
    }

    // Synchronous load - validates format and loads file immediately
    AssetHandle Load(const std::string& path) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileService", "Cannot load empty path");
            PublishError(path, "Empty path provided");
            return INVALID_HANDLE;
        }

        if (!std::filesystem::exists(path)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileService", "File not found: " + path);
            PublishError(path, "File not found");
            return INVALID_HANDLE;
        }

        // Validate format at system boundary
        AssetFormat format = m_validator.ValidateFormat(path);
        if (!FormatValidator::IsSupported(format)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileService", "Unsupported format: " + path);
            PublishError(path, "Unsupported format");
            return INVALID_HANDLE;
        }

        auto startTime = std::chrono::high_resolution_clock::now();

        // Load file data (placeholder - actual loading depends on format)
        size_t fileSize = std::filesystem::file_size(path);

        auto endTime = std::chrono::high_resolution_clock::now();
        double loadTimeMs = std::chrono::duration<double, std::milli>(endTime - startTime).count();

        // Create asset info
        AssetInfo info;
        info.handle = GenerateHandle();
        info.path = path;
        info.format = format;
        info.sizeBytes = fileSize;
        info.loadTimeMs = loadTimeMs;
        info.loadedAt = std::chrono::system_clock::now();

        // Store in registry
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_loadedAssets[info.handle] = info;
        }

        QuoteSystem::Get().Log("SUCCESS", "FileService",
            "Loaded " + FormatValidator::GetFormatName(format) +
            " (" + std::to_string(fileSize) + " bytes) in " +
            std::to_string(loadTimeMs) + "ms: " + path);

        PublishLoaded(info);
        return info.handle;
    }

    // Asynchronous load - queues for background loading
    void LoadAsync(const std::string& path, LoadCallback callback) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileService", "Cannot queue empty path");
            if (callback) {
                callback(INVALID_HANDLE, false, "Empty path provided");
            }
            return;
        }

        // Queue for async processing (simple immediate execution for now)
        // Future: add thread pool or job queue
        QuoteSystem::Get().Log("SUCCESS", "FileService", "Queuing async load: " + path);

        AssetHandle handle = Load(path);
        bool success = (handle != INVALID_HANDLE);

        if (callback) {
            callback(handle, success, success ? "" : "Load failed");
        }
    }

    // Get all loaded assets
    std::vector<AssetInfo> GetLoadedAssets() const {
        std::lock_guard<std::mutex> lock(m_mutex);

        std::vector<AssetInfo> assets;
        assets.reserve(m_loadedAssets.size());

        for (const auto& [handle, info] : m_loadedAssets) {
            assets.push_back(info);
        }

        return assets;
    }

    // Unload asset and free resources
    bool Unload(AssetHandle handle) {
        if (handle == INVALID_HANDLE) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileService", "Cannot unload invalid handle");
            return false;
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        auto it = m_loadedAssets.find(handle);
        if (it == m_loadedAssets.end()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileService", "Handle not found: " + std::to_string(handle));
            return false;
        }

        std::string path = it->second.path;
        m_loadedAssets.erase(it);

        QuoteSystem::Get().Log("SUCCESS", "FileService", "Unloaded handle " + std::to_string(handle) + ": " + path);
        return true;
    }

    // Get asset info by handle
    bool GetAssetInfo(AssetHandle handle, AssetInfo& outInfo) const {
        if (handle == INVALID_HANDLE) {
            return false;
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        auto it = m_loadedAssets.find(handle);
        if (it == m_loadedAssets.end()) {
            return false;
        }

        outInfo = it->second;
        return true;
    }

    // Clear all loaded assets
    void Clear() {
        std::lock_guard<std::mutex> lock(m_mutex);

        size_t count = m_loadedAssets.size();
        m_loadedAssets.clear();

        if (count > 0) {
            QuoteSystem::Get().Log("SUCCESS", "FileService", "Cleared " + std::to_string(count) + " assets");
        }
    }

    // Get total loaded asset count
    size_t GetLoadedCount() const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_loadedAssets.size();
    }

private:
    AssetHandle m_nextHandle;
    FormatValidator m_validator;
    std::unordered_map<AssetHandle, AssetInfo> m_loadedAssets;
    mutable std::mutex m_mutex;

    AssetHandle GenerateHandle() {
        return m_nextHandle++;
    }

    void OnFileDropped(const EventData& data) {
        // Handle file.dropped event (path should be in data)
        // Future: extract path from EventData and queue for loading
        QuoteSystem::Get().Log("SUCCESS", "FileService", "Received file.dropped event");
    }

    void PublishLoaded(const AssetInfo& info) {
        EventData data;
        // Future: populate EventData with asset info
        EventBus::Get().Publish("file.loaded", data);
    }

    void PublishError(const std::string& path, const std::string& error) {
        EventData data;
        // Future: populate EventData with error details
        EventBus::Get().Publish("file.error", data);
    }
};

} // namespace BrightForge
