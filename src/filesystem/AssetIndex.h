/**
 * AssetIndex - Searchable catalog of loaded assets
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <mutex>
#include <algorithm>
#include "FileService.h"
#include "../core/QuoteSystem.h"
#include "../core/EventBus.h"

namespace BrightForge {

// SQLite schema for future persistent index:
// CREATE TABLE assets (
//     id INTEGER PRIMARY KEY,
//     name TEXT NOT NULL,
//     type TEXT NOT NULL,
//     path TEXT UNIQUE NOT NULL,
//     format TEXT NOT NULL,
//     size_bytes INTEGER,
//     last_modified TEXT,
//     tags TEXT
// );
// CREATE INDEX idx_type ON assets(type);

struct IndexedAsset {
    AssetHandle handle;
    std::string name;
    std::string path;
    AssetFormat format;
    size_t sizeBytes;
    std::string lastModified;
    std::unordered_set<std::string> tags;

    IndexedAsset()
        : handle(INVALID_HANDLE)
        , name("")
        , path("")
        , format(AssetFormat::UNKNOWN)
        , sizeBytes(0)
        , lastModified("")
    {}
};

class AssetIndex {
public:
    AssetIndex() {
        QuoteSystem::Get().Log("SUCCESS", "AssetIndex", "Initialized in-memory catalog");

        // Subscribe to file.loaded events to auto-index
        EventBus::Get().Subscribe("file.loaded", [this](const EventData& data) {
            OnFileLoaded(data);
        });
    }

    ~AssetIndex() {
        Clear();
    }

    // Add asset to index
    bool AddAsset(const AssetInfo& info) {
        if (info.handle == INVALID_HANDLE) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot index invalid handle");
            return false;
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        // Check if already indexed
        if (m_assets.find(info.handle) != m_assets.end()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Handle already indexed: " + std::to_string(info.handle));
            return false;
        }

        // Create indexed entry
        IndexedAsset indexed;
        indexed.handle = info.handle;
        indexed.path = info.path;
        indexed.format = info.format;
        indexed.sizeBytes = info.sizeBytes;

        // Extract filename from path
        std::filesystem::path filePath(info.path);
        indexed.name = filePath.filename().string();

        // Format timestamp
        auto timeT = std::chrono::system_clock::to_time_t(info.loadedAt);
        char buffer[64];
        std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", std::localtime(&timeT));
        indexed.lastModified = buffer;

        m_assets[info.handle] = indexed;

        // Add to type index for fast format-based searches
        m_typeIndex[info.format].insert(info.handle);

        QuoteSystem::Get().Log("SUCCESS", "AssetIndex",
            "Indexed " + indexed.name + " (handle " + std::to_string(info.handle) + ")");

        return true;
    }

    // Remove asset from index
    bool RemoveAsset(AssetHandle handle) {
        if (handle == INVALID_HANDLE) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot remove invalid handle");
            return false;
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        auto it = m_assets.find(handle);
        if (it == m_assets.end()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Handle not found: " + std::to_string(handle));
            return false;
        }

        // Remove from type index
        AssetFormat format = it->second.format;
        m_typeIndex[format].erase(handle);

        // Remove from tag index
        for (const auto& tag : it->second.tags) {
            m_tagIndex[tag].erase(handle);
        }

        std::string name = it->second.name;
        m_assets.erase(it);

        QuoteSystem::Get().Log("SUCCESS", "AssetIndex", "Removed " + name + " from index");
        return true;
    }

    // Search by name substring
    std::vector<IndexedAsset> Search(const std::string& query) const {
        if (query.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot search with empty query");
            return {};
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        std::vector<IndexedAsset> results;
        std::string lowerQuery = ToLower(query);

        for (const auto& [handle, asset] : m_assets) {
            std::string lowerName = ToLower(asset.name);
            if (lowerName.find(lowerQuery) != std::string::npos) {
                results.push_back(asset);
            }
        }

        QuoteSystem::Get().Log("SUCCESS", "AssetIndex",
            "Search '" + query + "' returned " + std::to_string(results.size()) + " results");

        return results;
    }

    // Search by asset format
    std::vector<IndexedAsset> SearchByType(AssetFormat format) const {
        std::lock_guard<std::mutex> lock(m_mutex);

        std::vector<IndexedAsset> results;

        auto it = m_typeIndex.find(format);
        if (it == m_typeIndex.end()) {
            return results;
        }

        for (AssetHandle handle : it->second) {
            auto assetIt = m_assets.find(handle);
            if (assetIt != m_assets.end()) {
                results.push_back(assetIt->second);
            }
        }

        QuoteSystem::Get().Log("SUCCESS", "AssetIndex",
            "Type search '" + FormatValidator::GetFormatName(format) +
            "' returned " + std::to_string(results.size()) + " results");

        return results;
    }

    // Search by tag
    std::vector<IndexedAsset> SearchByTag(const std::string& tag) const {
        if (tag.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot search with empty tag");
            return {};
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        std::vector<IndexedAsset> results;

        auto it = m_tagIndex.find(tag);
        if (it == m_tagIndex.end()) {
            return results;
        }

        for (AssetHandle handle : it->second) {
            auto assetIt = m_assets.find(handle);
            if (assetIt != m_assets.end()) {
                results.push_back(assetIt->second);
            }
        }

        QuoteSystem::Get().Log("SUCCESS", "AssetIndex",
            "Tag search '" + tag + "' returned " + std::to_string(results.size()) + " results");

        return results;
    }

    // Add tag to asset
    bool AddTag(AssetHandle handle, const std::string& tag) {
        if (handle == INVALID_HANDLE) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot tag invalid handle");
            return false;
        }

        if (tag.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot add empty tag");
            return false;
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        auto it = m_assets.find(handle);
        if (it == m_assets.end()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Handle not found: " + std::to_string(handle));
            return false;
        }

        it->second.tags.insert(tag);
        m_tagIndex[tag].insert(handle);

        QuoteSystem::Get().Log("SUCCESS", "AssetIndex",
            "Added tag '" + tag + "' to " + it->second.name);

        return true;
    }

    // Remove tag from asset
    bool RemoveTag(AssetHandle handle, const std::string& tag) {
        if (handle == INVALID_HANDLE) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot untag invalid handle");
            return false;
        }

        if (tag.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Cannot remove empty tag");
            return false;
        }

        std::lock_guard<std::mutex> lock(m_mutex);

        auto it = m_assets.find(handle);
        if (it == m_assets.end()) {
            QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "Handle not found: " + std::to_string(handle));
            return false;
        }

        it->second.tags.erase(tag);
        m_tagIndex[tag].erase(handle);

        QuoteSystem::Get().Log("SUCCESS", "AssetIndex",
            "Removed tag '" + tag + "' from " + it->second.name);

        return true;
    }

    // Get all indexed assets
    std::vector<IndexedAsset> GetAll() const {
        std::lock_guard<std::mutex> lock(m_mutex);

        std::vector<IndexedAsset> all;
        all.reserve(m_assets.size());

        for (const auto& [handle, asset] : m_assets) {
            all.push_back(asset);
        }

        return all;
    }

    // Get total indexed asset count
    size_t GetCount() const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_assets.size();
    }

    // Clear entire index
    void Clear() {
        std::lock_guard<std::mutex> lock(m_mutex);

        size_t count = m_assets.size();
        m_assets.clear();
        m_typeIndex.clear();
        m_tagIndex.clear();

        if (count > 0) {
            QuoteSystem::Get().Log("SUCCESS", "AssetIndex", "Cleared " + std::to_string(count) + " indexed assets");
        }
    }

    // Future: Save index to SQLite database
    bool SaveToSQLite(const std::string& path) const {
        // TODO: Implement SQLite persistence
        QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "SQLite persistence not yet implemented");
        return false;
    }

    // Future: Load index from SQLite database
    bool LoadFromSQLite(const std::string& path) {
        // TODO: Implement SQLite persistence
        QuoteSystem::Get().Log("ERROR_MSG", "AssetIndex", "SQLite persistence not yet implemented");
        return false;
    }

private:
    std::unordered_map<AssetHandle, IndexedAsset> m_assets;
    std::unordered_map<AssetFormat, std::unordered_set<AssetHandle>> m_typeIndex;
    std::unordered_map<std::string, std::unordered_set<AssetHandle>> m_tagIndex;
    mutable std::mutex m_mutex;

    void OnFileLoaded(const EventData& data) {
        // Future: extract AssetInfo from EventData and auto-index
        QuoteSystem::Get().Log("SUCCESS", "AssetIndex", "Received file.loaded event");
    }

    static std::string ToLower(const std::string& str) {
        std::string lower = str;
        std::transform(lower.begin(), lower.end(), lower.begin(),
            [](unsigned char c) { return std::tolower(c); });
        return lower;
    }
};

} // namespace BrightForge
