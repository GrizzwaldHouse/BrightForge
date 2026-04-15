// DebugWindow.h
// Developer: Marcus Daley
// Date: April 2026
// Purpose: Channel-based debug output system with per-channel filtering and history

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <iostream>
#include <filesystem>

class DebugWindow {
public:
    enum class DebugLevel {
        TRACE,
        INFO,
        WARN,
        ERR,
        CRITICAL
    };

    struct DebugMessage {
        std::string timestamp;
        std::string message;
        DebugLevel level;

        DebugMessage(const std::string& ts, const std::string& msg, DebugLevel lvl)
            : timestamp(ts), message(msg), level(lvl) {}
    };

    struct ChannelStats {
        size_t traceCount = 0;
        size_t infoCount = 0;
        size_t warnCount = 0;
        size_t errorCount = 0;
        size_t criticalCount = 0;
        bool enabled = true;
        std::vector<DebugMessage> history;
    };

    // Singleton accessor
    static DebugWindow& Instance() {
        static DebugWindow instance;
        return instance;
    }

    // Register a new debug channel
    void RegisterChannel(const std::string& channelName) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: channel already exists
        if (mChannels.find(channelName) != mChannels.end()) {
            return;
        }

        mChannels[channelName] = ChannelStats();
    }

    // Post a message to a channel
    void Post(const std::string& channel, const std::string& message, DebugLevel level = DebugLevel::INFO) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: channel doesn't exist
        auto it = mChannels.find(channel);
        if (it == mChannels.end()) {
            std::cerr << "[WARN] Channel '" << channel << "' not registered. Auto-registering.\n";
            mChannels[channel] = ChannelStats();
            it = mChannels.find(channel);
        }

        ChannelStats& stats = it->second;

        // Guard: channel disabled
        if (!stats.enabled) {
            return;
        }

        // Increment level counter
        IncrementLevelCount(stats, level);

        // Store in history (ring buffer)
        std::string timestamp = GetTimestamp();
        if (stats.history.size() >= MAX_CHANNEL_HISTORY) {
            stats.history.erase(stats.history.begin());
        }
        stats.history.emplace_back(timestamp, message, level);

        // Output to console with color coding
        std::string colorCode = GetColorForLevel(level);
        std::string levelStr = GetLevelString(level);
        std::cout << colorCode << "[" << timestamp << "][" << channel << "][" << levelStr << "] "
                  << message << "\033[0m" << std::endl;
    }

    // Check if a file exists and log result
    void CheckFileExists(const std::string& channel, const std::string& path) {
        bool exists = std::filesystem::exists(path);
        DebugLevel level = exists ? DebugLevel::INFO : DebugLevel::WARN;
        std::string msg = path + (exists ? " [EXISTS]" : " [NOT FOUND]");
        Post(channel, msg, level);
    }

    // Print dashboard showing all channels with status summary
    void PrintDashboard() {
        std::lock_guard<std::mutex> lock(mMutex);

        std::cout << "\n======================================\n";
        std::cout << "        Debug Channel Dashboard       \n";
        std::cout << "======================================\n";

        // Guard: no channels registered
        if (mChannels.empty()) {
            std::cout << "No channels registered.\n";
            std::cout << "======================================\n";
            return;
        }

        for (const auto& [name, stats] : mChannels) {
            std::string status = stats.enabled ? "\033[32mENABLED\033[0m" : "\033[31mDISABLED\033[0m";
            size_t totalMessages = stats.traceCount + stats.infoCount + stats.warnCount +
                                   stats.errorCount + stats.criticalCount;

            std::cout << "\n[" << name << "] " << status << "\n";
            std::cout << "  Total Messages: " << totalMessages << "\n";
            std::cout << "  TRACE:    " << stats.traceCount << "\n";
            std::cout << "  INFO:     " << stats.infoCount << "\n";
            std::cout << "  WARN:     " << stats.warnCount << "\n";
            std::cout << "  ERROR:    " << stats.errorCount << "\n";
            std::cout << "  CRITICAL: " << stats.criticalCount << "\n";
        }

        std::cout << "======================================\n\n";
    }

    // Enable or disable a specific channel
    void ToggleChannel(const std::string& channel, bool enabled) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: channel doesn't exist
        auto it = mChannels.find(channel);
        if (it == mChannels.end()) {
            std::cerr << "[WARN] Channel '" << channel << "' not found. Cannot toggle.\n";
            return;
        }

        it->second.enabled = enabled;
        std::cout << "[DEBUG] Channel '" << channel << "' "
                  << (enabled ? "enabled" : "disabled") << "\n";
    }

    // Print last N messages for a specific channel
    void PrintChannelHistory(const std::string& channel, size_t count = 10) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: channel doesn't exist
        auto it = mChannels.find(channel);
        if (it == mChannels.end()) {
            std::cerr << "[WARN] Channel '" << channel << "' not found.\n";
            return;
        }

        const std::vector<DebugMessage>& history = it->second.history;
        size_t start = (count >= history.size()) ? 0 : history.size() - count;

        std::cout << "\n=== " << channel << " History (Last " << (history.size() - start) << " messages) ===\n";
        for (size_t i = start; i < history.size(); ++i) {
            const DebugMessage& msg = history[i];
            std::string colorCode = GetColorForLevel(msg.level);
            std::string levelStr = GetLevelString(msg.level);
            std::cout << colorCode << "[" << msg.timestamp << "][" << levelStr << "] "
                      << msg.message << "\033[0m" << std::endl;
        }
        std::cout << "========================================\n\n";
    }

    // Prevent copy/move
    DebugWindow(const DebugWindow&) = delete;
    DebugWindow& operator=(const DebugWindow&) = delete;
    DebugWindow(DebugWindow&&) = delete;
    DebugWindow& operator=(DebugWindow&&) = delete;

private:
    static constexpr size_t MAX_CHANNEL_HISTORY = 100;

    // Default channels registered on construction
    DebugWindow() {
        RegisterDefaultChannels();
    }

    void RegisterDefaultChannels() {
        // Engine subsystem channels
        RegisterChannel("Engine");
        RegisterChannel("Renderer");
        RegisterChannel("FileSystem");
        RegisterChannel("Shaders");
        RegisterChannel("UI");
        RegisterChannel("Input");
        RegisterChannel("Audio");
        RegisterChannel("Physics");
        RegisterChannel("Network");
    }

    void IncrementLevelCount(ChannelStats& stats, DebugLevel level) {
        switch (level) {
            case DebugLevel::TRACE:    ++stats.traceCount; break;
            case DebugLevel::INFO:     ++stats.infoCount; break;
            case DebugLevel::WARN:     ++stats.warnCount; break;
            case DebugLevel::ERR:      ++stats.errorCount; break;
            case DebugLevel::CRITICAL: ++stats.criticalCount; break;
        }
    }

    std::string GetColorForLevel(DebugLevel level) {
        switch (level) {
            case DebugLevel::TRACE:    return "\033[90m"; // Gray
            case DebugLevel::INFO:     return "\033[37m"; // White
            case DebugLevel::WARN:     return "\033[33m"; // Yellow
            case DebugLevel::ERR:      return "\033[31m"; // Red
            case DebugLevel::CRITICAL: return "\033[35m"; // Magenta
            default:                   return "\033[37m";
        }
    }

    std::string GetLevelString(DebugLevel level) {
        switch (level) {
            case DebugLevel::TRACE:    return "TRACE";
            case DebugLevel::INFO:     return "INFO";
            case DebugLevel::WARN:     return "WARN";
            case DebugLevel::ERR:      return "ERROR";
            case DebugLevel::CRITICAL: return "CRITICAL";
            default:                   return "UNKNOWN";
        }
    }

    std::string GetTimestamp() {
        std::time_t now = std::time(nullptr);
        char buffer[20];
        std::strftime(buffer, sizeof(buffer), "%H:%M:%S", std::localtime(&now));
        return std::string(buffer);
    }

    // Member variables
    std::mutex mMutex;
    std::unordered_map<std::string, ChannelStats> mChannels;
};
