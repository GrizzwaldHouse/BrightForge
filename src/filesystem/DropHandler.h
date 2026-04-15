/**
 * DropHandler - OS file drop event processor with batch support
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <atomic>
#include "FormatValidator.h"
#include "FileService.h"
#include "../core/QuoteSystem.h"
#include "../core/EventBus.h"

namespace BrightForge {

// Drop statistics
struct DropStats {
    size_t totalDrops;
    size_t accepted;
    size_t rejected;
    size_t pending;

    DropStats()
        : totalDrops(0)
        , accepted(0)
        , rejected(0)
        , pending(0)
    {}
};

class DropHandler {
public:
    DropHandler(FileService& fileService)
        : m_fileService(fileService)
        , m_validator()
        , m_isProcessing(false)
        , m_stats()
    {
        QuoteSystem::Get().Log("SUCCESS", "DropHandler", "Initialized with batch support and rate limiting");
    }

    ~DropHandler() = default;

    // Handle file drop from OS (supports batch drops)
    void HandleDrop(const std::vector<std::string>& paths) {
        if (paths.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "DropHandler", "Cannot handle empty drop");
            return;
        }

        // Rate limiting: don't accept new drops while processing
        if (m_isProcessing.load()) {
            QuoteSystem::Get().Log("WARNING", "DropHandler",
                "Drop in progress, queuing " + std::to_string(paths.size()) + " files");
            QueueDrop(paths);
            return;
        }

        m_isProcessing.store(true);

        QuoteSystem::Get().Log("SUCCESS", "DropHandler",
            "Processing batch drop: " + std::to_string(paths.size()) + " files");

        size_t batchAccepted = 0;
        size_t batchRejected = 0;

        for (const std::string& path : paths) {
            if (ProcessSingleDrop(path)) {
                batchAccepted++;
            } else {
                batchRejected++;
            }
        }

        // Update statistics
        {
            std::lock_guard<std::mutex> lock(m_statsMutex);
            m_stats.totalDrops += paths.size();
            m_stats.accepted += batchAccepted;
            m_stats.rejected += batchRejected;
        }

        QuoteSystem::Get().Log("SUCCESS", "DropHandler",
            "Batch complete: " + std::to_string(batchAccepted) + " accepted, " +
            std::to_string(batchRejected) + " rejected");

        m_isProcessing.store(false);

        // Process any queued drops
        ProcessQueuedDrops();
    }

    // Get current drop statistics
    DropStats GetStats() const {
        std::lock_guard<std::mutex> lock(m_statsMutex);
        return m_stats;
    }

    // Reset statistics
    void ResetStats() {
        std::lock_guard<std::mutex> lock(m_statsMutex);
        m_stats = DropStats();
        QuoteSystem::Get().Log("SUCCESS", "DropHandler", "Reset drop statistics");
    }

    // Check if currently processing a drop
    bool IsProcessing() const {
        return m_isProcessing.load();
    }

    // Get pending queue size
    size_t GetQueueSize() const {
        std::lock_guard<std::mutex> lock(m_queueMutex);
        return m_dropQueue.size();
    }

private:
    FileService& m_fileService;
    FormatValidator m_validator;
    std::atomic<bool> m_isProcessing;

    DropStats m_stats;
    mutable std::mutex m_statsMutex;

    std::vector<std::vector<std::string>> m_dropQueue;
    mutable std::mutex m_queueMutex;

    // Process a single file drop
    bool ProcessSingleDrop(const std::string& path) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "DropHandler", "Skipping empty path");
            return false;
        }

        // Validate format at system boundary
        AssetFormat format = m_validator.ValidateFormat(path);

        if (!FormatValidator::IsSupported(format)) {
            QuoteSystem::Get().Log("WARNING", "DropHandler",
                "Rejected unsupported format: " + path);
            return false;
        }

        // Publish drop event before queuing for load
        PublishDropEvent(path, format);

        // Queue for async loading (doesn't block render loop)
        m_fileService.LoadAsync(path, [this, path](AssetHandle handle, bool success, const std::string& error) {
            OnLoadComplete(path, handle, success, error);
        });

        QuoteSystem::Get().Log("SUCCESS", "DropHandler",
            "Accepted " + FormatValidator::GetFormatName(format) + ": " + path);

        return true;
    }

    // Queue drops received while processing
    void QueueDrop(const std::vector<std::string>& paths) {
        std::lock_guard<std::mutex> lock(m_queueMutex);
        m_dropQueue.push_back(paths);

        {
            std::lock_guard<std::mutex> statsLock(m_statsMutex);
            m_stats.pending += paths.size();
        }

        QuoteSystem::Get().Log("SUCCESS", "DropHandler",
            "Queued " + std::to_string(paths.size()) + " files (" +
            std::to_string(m_dropQueue.size()) + " batches pending)");
    }

    // Process queued drops after current batch completes
    void ProcessQueuedDrops() {
        std::vector<std::vector<std::string>> queue;

        {
            std::lock_guard<std::mutex> lock(m_queueMutex);
            if (m_dropQueue.empty()) {
                return;
            }

            queue = std::move(m_dropQueue);
            m_dropQueue.clear();
        }

        QuoteSystem::Get().Log("SUCCESS", "DropHandler",
            "Processing " + std::to_string(queue.size()) + " queued batches");

        for (const auto& batch : queue) {
            {
                std::lock_guard<std::mutex> statsLock(m_statsMutex);
                m_stats.pending -= batch.size();
            }
            HandleDrop(batch);
        }
    }

    // Publish file.dropped event
    void PublishDropEvent(const std::string& path, AssetFormat format) {
        EventData data;
        // Future: populate EventData with path and format
        EventBus::Get().Publish("file.dropped", data);
    }

    // Callback when async load completes
    void OnLoadComplete(const std::string& path, AssetHandle handle, bool success, const std::string& error) {
        if (success) {
            QuoteSystem::Get().Log("SUCCESS", "DropHandler",
                "Async load complete (handle " + std::to_string(handle) + "): " + path);
        } else {
            QuoteSystem::Get().Log("ERROR_MSG", "DropHandler",
                "Async load failed: " + path + " - " + error);
        }
    }
};

} // namespace BrightForge
