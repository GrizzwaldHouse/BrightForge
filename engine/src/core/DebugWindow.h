// ============================================================================
// DebugWindow.h - BrightForge Engine Pipeline Debug Monitor
// ============================================================================
// PURPOSE:  Provides a structured, categorized debug output system that
//           keeps the console organized so any developer can quickly scan
//           the pipeline state, find missing files, and trace failures.
//
// DESIGN:   Messages are grouped into "channels" (Renderer, FileSystem,
//           UI, etc). Each channel can be toggled independently. Output
//           uses visual separators and indentation for easy scanning.
//
// USAGE:    DebugWindow& dbg = DebugWindow::Instance();
//           dbg.RegisterChannel("Renderer");
//           dbg.Post("Renderer", "Pipeline initialized", DebugLevel::INFO);
//           dbg.PrintDashboard();
//
// NOTES:    - Singleton pattern so every subsystem shares one instance
//           - Channels auto-create on first Post if not registered
//           - File attachment checker built in (see CheckFileExists)
//           - All constants at top for easy customization
// ============================================================================
#pragma once

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <sstream>
#include <fstream>
#include <chrono>
#include <iomanip>
#include <algorithm>

// ============================================================================
// CONFIGURABLE CONSTANTS
// ============================================================================
namespace DebugConfig {
    // Maximum messages per channel before oldest are discarded
    static constexpr int MAX_MESSAGES_PER_CHANNEL = 100;

    // Dashboard refresh separator width
    static constexpr int SEPARATOR_WIDTH = 60;

    // Default channels to register automatically
    static const char* DEFAULT_CHANNELS[] = {
        "Engine",
        "Renderer",
        "FileSystem",
        "Shaders",
        "UI",
        "Input",
        "Audio",
        "Physics",
        "Network"
    };
    static constexpr int NUM_DEFAULT_CHANNELS = 9;

    // ANSI colors for debug levels (disable if terminal does not support)
    static bool USE_COLORS = true;
}

// ============================================================================
// DebugLevel - Severity tiers for channel messages
// ============================================================================
enum class DebugLevel {
    TRACE,      // Ultra-verbose, usually off
    INFO,       // General operational info
    WARN,       // Something unexpected but recoverable
    ERR,        // Something failed
    CRITICAL    // System cannot continue
};

// ============================================================================
// DebugMessage - A single message in a channel's history
// ============================================================================
struct DebugMessage {
    std::string timestamp;
    std::string content;
    DebugLevel level;
};

// ============================================================================
// DebugChannel - A named group of messages with toggle state
// ============================================================================
struct DebugChannel {
    std::string name;
    bool enabled;
    std::vector<DebugMessage> messages;
    int totalPosted;     // Lifetime count (even after ring buffer wraps)
    int errorCount;      // Lifetime error + critical count
    int warningCount;    // Lifetime warning count

    DebugChannel()
        : enabled(true), totalPosted(0), errorCount(0), warningCount(0) {}
};

// ============================================================================
// DebugWindow Class (Singleton)
// ============================================================================
class DebugWindow {
private:
    std::unordered_map<std::string, DebugChannel> mChannels;
    mutable std::mutex mMutex;

    // Private constructor for singleton
    DebugWindow() {
        // Auto-register default channels
        for (int i = 0; i < DebugConfig::NUM_DEFAULT_CHANNELS; i++) {
            RegisterChannel(DebugConfig::DEFAULT_CHANNELS[i]);
        }
    }

    // -----------------------------------------------------------------
    // GetTimestamp - Formatted current time
    // -----------------------------------------------------------------
    std::string GetTimestamp() const {
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()) % 1000;
        std::stringstream ss;
        std::tm tm_buf;
#ifdef _WIN32
        localtime_s(&tm_buf, &time);
#else
        localtime_r(&time, &tm_buf);
#endif
        ss << std::put_time(&tm_buf, "%H:%M:%S")
           << "." << std::setfill('0') << std::setw(3) << ms.count();
        return ss.str();
    }

    // -----------------------------------------------------------------
    // LevelToString - Converts DebugLevel to display string
    // -----------------------------------------------------------------
    std::string LevelToString(DebugLevel level) const {
        switch (level) {
            case DebugLevel::TRACE:    return "TRACE";
            case DebugLevel::INFO:     return "INFO ";
            case DebugLevel::WARN:     return "WARN ";
            case DebugLevel::ERR:      return "ERROR";
            case DebugLevel::CRITICAL: return "CRIT ";
            default:                   return "?????";
        }
    }

    // -----------------------------------------------------------------
    // LevelColor - ANSI color for a debug level
    // -----------------------------------------------------------------
    std::string LevelColor(DebugLevel level) const {
        if (!DebugConfig::USE_COLORS) return "";
        switch (level) {
            case DebugLevel::TRACE:    return "\033[90m";   // gray
            case DebugLevel::INFO:     return "\033[37m";   // white
            case DebugLevel::WARN:     return "\033[33m";   // yellow
            case DebugLevel::ERR:      return "\033[31m";   // red
            case DebugLevel::CRITICAL: return "\033[31;1m"; // bold red
            default:                   return "";
        }
    }

    std::string ColorReset() const {
        return DebugConfig::USE_COLORS ? "\033[0m" : "";
    }

    // -----------------------------------------------------------------
    // PrintSeparator - Draws a visual line in the console
    // -----------------------------------------------------------------
    void PrintSeparator(char ch = '=') const {
        std::cout << std::string(DebugConfig::SEPARATOR_WIDTH, ch) << std::endl;
    }

public:
    // -----------------------------------------------------------------
    // Instance - Singleton accessor
    // -----------------------------------------------------------------
    static DebugWindow& Instance() {
        static DebugWindow instance;
        return instance;
    }

    // Delete copy/move for singleton
    DebugWindow(const DebugWindow&) = delete;
    DebugWindow& operator=(const DebugWindow&) = delete;

    // -----------------------------------------------------------------
    // RegisterChannel - Creates a named channel for categorized output
    //   PARAM name: Channel identifier like "Renderer" or "FileSystem"
    //   NOTE: Safe to call multiple times; will not overwrite existing
    // -----------------------------------------------------------------
    void RegisterChannel(const std::string& name) {
        std::lock_guard<std::mutex> lock(mMutex);
        if (mChannels.find(name) == mChannels.end()) {
            DebugChannel ch;
            ch.name = name;
            mChannels[name] = ch;
        }
    }

    // -----------------------------------------------------------------
    // Post - Send a message to a specific channel
    //   PARAM channel: Target channel name (auto-creates if not found)
    //   PARAM message: The debug content
    //   PARAM level:   Severity (default INFO)
    // -----------------------------------------------------------------
    void Post(const std::string& channel, const std::string& message,
              DebugLevel level = DebugLevel::INFO) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Auto-create channel if it does not exist
        if (mChannels.find(channel) == mChannels.end()) {
            DebugChannel ch;
            ch.name = channel;
            mChannels[channel] = ch;
        }

        DebugChannel& ch = mChannels[channel];
        ch.totalPosted++;

        if (level == DebugLevel::ERR || level == DebugLevel::CRITICAL) {
            ch.errorCount++;
        }
        if (level == DebugLevel::WARN) {
            ch.warningCount++;
        }

        // Guard: skip storage and print if channel is disabled
        if (!ch.enabled) return;

        // Build the message entry
        DebugMessage msg;
        msg.timestamp = GetTimestamp();
        msg.content = message;
        msg.level = level;

        // Ring buffer eviction
        if (static_cast<int>(ch.messages.size()) >= DebugConfig::MAX_MESSAGES_PER_CHANNEL) {
            ch.messages.erase(ch.messages.begin());
        }
        ch.messages.push_back(msg);

        // Print to console with formatting
        std::cout << LevelColor(level)
                  << "[" << msg.timestamp << "] "
                  << "[" << channel << "] "
                  << "[" << LevelToString(level) << "] "
                  << message
                  << ColorReset() << std::endl;
    }

    // -----------------------------------------------------------------
    // ToggleChannel - Enable or disable a channel's output
    // -----------------------------------------------------------------
    void ToggleChannel(const std::string& channel, bool enabled) {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        if (it != mChannels.end()) {
            it->second.enabled = enabled;
        }
    }

    // -----------------------------------------------------------------
    // CheckFileExists - Verifies a file is present on disk and posts
    //                   a debug message with the result.
    //   PARAM channel:  Which channel to report to
    //   PARAM filePath: Path to check
    //   RETURNS: true if file exists, false otherwise
    // -----------------------------------------------------------------
    bool CheckFileExists(const std::string& channel,
                         const std::string& filePath) {
        std::ifstream f(filePath);
        bool exists = f.good();
        f.close();

        if (exists) {
            Post(channel, "File OK: " + filePath, DebugLevel::INFO);
        } else {
            Post(channel, "FILE MISSING: " + filePath
                 + " -- Check your project include paths!",
                 DebugLevel::ERR);
        }
        return exists;
    }

    // -----------------------------------------------------------------
    // PrintDashboard - Renders a summary view of all channels
    // -----------------------------------------------------------------
    void PrintDashboard() const {
        std::lock_guard<std::mutex> lock(mMutex);

        std::cout << std::endl;
        PrintSeparator('=');
        std::cout << "   BRIGHTFORGE DEBUG DASHBOARD" << std::endl;
        PrintSeparator('=');

        for (const auto& pair : mChannels) {
            const DebugChannel& ch = pair.second;
            std::string status = ch.enabled ? " ON" : "OFF";

            std::cout << " [" << status << "] " << ch.name
                      << " | Total: " << ch.totalPosted
                      << " | Errors: " << ch.errorCount
                      << " | Warnings: " << ch.warningCount
                      << std::endl;

            if (!ch.messages.empty()) {
                const DebugMessage& last = ch.messages.back();
                std::cout << "       Last: [" << last.timestamp << "] "
                          << last.content << std::endl;
            }
            PrintSeparator('-');
        }
        PrintSeparator('=');
    }

    // -----------------------------------------------------------------
    // PrintChannelHistory - Dumps all stored messages for one channel
    // -----------------------------------------------------------------
    void PrintChannelHistory(const std::string& channel,
                             int count = 0) const {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        if (it == mChannels.end()) {
            std::cout << "Channel '" << channel << "' not found." << std::endl;
            return;
        }

        const DebugChannel& ch = it->second;
        int total = static_cast<int>(ch.messages.size());
        int toShow = (count > 0 && count < total) ? count : total;
        int startIdx = total - toShow;

        std::cout << std::endl;
        PrintSeparator();
        std::cout << " Channel: " << channel << " (showing "
                  << toShow << " of " << total << ")" << std::endl;
        PrintSeparator();

        for (int i = startIdx; i < total; i++) {
            const DebugMessage& msg = ch.messages[i];
            std::cout << LevelColor(msg.level)
                      << "  [" << msg.timestamp << "] "
                      << "[" << LevelToString(msg.level) << "] "
                      << msg.content
                      << ColorReset() << std::endl;
        }
        PrintSeparator();
    }

    // -----------------------------------------------------------------
    // ClearChannel - Removes all stored messages from a channel
    // -----------------------------------------------------------------
    void ClearChannel(const std::string& channel) {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        if (it != mChannels.end()) {
            it->second.messages.clear();
        }
    }

    // -----------------------------------------------------------------
    // GetErrorCount - Returns lifetime error count for a channel
    // -----------------------------------------------------------------
    int GetErrorCount(const std::string& channel) const {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mChannels.find(channel);
        return (it != mChannels.end()) ? it->second.errorCount : -1;
    }
};
