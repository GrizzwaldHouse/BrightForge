// QuoteSystem.h
// Developer: Marcus Daley
// Date: April 2026
// Purpose: Themed logging system with literary quotes for different message types

#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <iostream>
#include <fstream>
#include <ctime>
#include <random>
#include <unordered_map>

class QuoteSystem {
public:
    enum class MessageType {
        SUCCESS,
        WARNING,
        ERROR_MSG,
        DEBUG,
        INFO,
        SECURITY
    };

    // Singleton accessor
    static QuoteSystem& Instance() {
        static QuoteSystem instance;
        return instance;
    }

    // Core logging function
    void Log(const std::string& message, MessageType type) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: suppress DEBUG messages if not verbose
        if (type == MessageType::DEBUG && !mVerboseMode) {
            return;
        }

        std::string quote = GetRandomQuote(type);
        std::string timestamp = GetTimestamp();
        std::string colorCode = GetColorCode(type);
        std::string resetCode = "\033[0m";

        // Build log entry
        std::string logEntry = "[" + timestamp + "] " + GetTypeString(type) + ": " + message;
        std::string displayEntry = colorCode + logEntry + " | " + quote + resetCode;

        // Output to console
        if (mUseAnsiColors) {
            std::cout << displayEntry << std::endl;
        } else {
            std::cout << logEntry << " | " << quote << std::endl;
        }

        // Write to file if enabled
        if (mFileLoggingEnabled && mLogFile.is_open()) {
            mLogFile << logEntry << " | " << quote << std::endl;
            mLogFile.flush();
        }

        // Store in ring buffer
        AddToHistory(logEntry + " | " + quote);
    }

    // Toggle verbose mode (enables/suppresses DEBUG messages)
    void SetVerbose(bool verbose) {
        std::lock_guard<std::mutex> lock(mMutex);
        mVerboseMode = verbose;
    }

    // Print last N entries from history
    void PrintHistory(size_t count = 10) {
        std::lock_guard<std::mutex> lock(mMutex);

        size_t start = (count >= mHistory.size()) ? 0 : mHistory.size() - count;
        std::cout << "\n=== Log History (Last " << (mHistory.size() - start) << " entries) ===\n";
        for (size_t i = start; i < mHistory.size(); ++i) {
            std::cout << mHistory[i] << std::endl;
        }
        std::cout << "=================================\n";
    }

    // Register security phrase for integrity checking
    void RegisterIntegrity(const std::string& subsystem, const std::string& phrase) {
        std::lock_guard<std::mutex> lock(mMutex);
        uint32_t hash = ComputeCRC32(phrase);
        mIntegrityHashes[subsystem] = hash;
    }

    // Validate security phrase hasn't been tampered with
    bool ValidateIntegrity(const std::string& subsystem, const std::string& phrase) {
        std::lock_guard<std::mutex> lock(mMutex);

        auto it = mIntegrityHashes.find(subsystem);
        if (it == mIntegrityHashes.end()) {
            Log("Subsystem '" + subsystem + "' not registered for integrity check", MessageType::WARNING);
            return false;
        }

        uint32_t currentHash = ComputeCRC32(phrase);
        bool valid = (currentHash == it->second);

        if (!valid) {
            Log("Integrity violation detected for subsystem: " + subsystem, MessageType::SECURITY);
        }

        return valid;
    }

    // Enable/disable ANSI color codes (for Windows cmd compatibility)
    void SetAnsiColors(bool enabled) {
        std::lock_guard<std::mutex> lock(mMutex);
        mUseAnsiColors = enabled;
    }

    // Enable file logging
    void EnableFileLogging(const std::string& filename = "brightforge_engine.log") {
        std::lock_guard<std::mutex> lock(mMutex);
        if (mLogFile.is_open()) {
            mLogFile.close();
        }
        mLogFile.open(filename, std::ios::app);
        mFileLoggingEnabled = mLogFile.is_open();
    }

    // Disable file logging
    void DisableFileLogging() {
        std::lock_guard<std::mutex> lock(mMutex);
        if (mLogFile.is_open()) {
            mLogFile.close();
        }
        mFileLoggingEnabled = false;
    }

    // Prevent copy/move
    QuoteSystem(const QuoteSystem&) = delete;
    QuoteSystem& operator=(const QuoteSystem&) = delete;
    QuoteSystem(QuoteSystem&&) = delete;
    QuoteSystem& operator=(QuoteSystem&&) = delete;

private:
    // Ring buffer size for history
    static constexpr size_t MAX_LOG_HISTORY = 500;

    // Constructor initializes quote pools
    QuoteSystem() : mVerboseMode(false), mUseAnsiColors(true), mFileLoggingEnabled(false) {
        InitializeQuotes();
        mRandomEngine.seed(static_cast<unsigned int>(std::time(nullptr)));
    }

    ~QuoteSystem() {
        if (mLogFile.is_open()) {
            mLogFile.close();
        }
    }

    void InitializeQuotes() {
        // Harry Potter (SUCCESS)
        mQuotes[MessageType::SUCCESS] = {
            "Mischief Managed!",
            "I solemnly swear I am up to no good",
            "It does not do to dwell on dreams and forget to live",
            "Happiness can be found even in the darkest of times",
            "After all this time? Always."
        };

        // Alice in Wonderland (WARNING)
        mQuotes[MessageType::WARNING] = {
            "Curiouser and curiouser!",
            "We're all mad here",
            "It's no use going back to yesterday",
            "Begin at the beginning"
        };

        // Holes (ERROR_MSG)
        mQuotes[MessageType::ERROR_MSG] = {
            "I can fix that",
            "If only, if only, the woodpecker sighs",
            "You have to go there to know there",
            "The warden owns the shade"
        };

        // Naruto (DEBUG)
        mQuotes[MessageType::DEBUG] = {
            "Believe it!",
            "I'm not gonna run away",
            "Hard work is worthless for those that don't believe in themselves",
            "The pain of being alone"
        };

        // Maya Angelou (INFO)
        mQuotes[MessageType::INFO] = {
            "Still I rise",
            "When you know better, you do better",
            "There is no greater agony than bearing an untold story inside you",
            "We delight in the beauty of the butterfly"
        };

        // Black Clover (SECURITY)
        mQuotes[MessageType::SECURITY] = {
            "I'll surpass my limits",
            "Not giving up is my magic",
            "The only one who can decide your worth is you"
        };
    }

    std::string GetRandomQuote(MessageType type) {
        auto& pool = mQuotes[type];
        if (pool.empty()) {
            return "No quote available";
        }
        std::uniform_int_distribution<size_t> dist(0, pool.size() - 1);
        return pool[dist(mRandomEngine)];
    }

    std::string GetColorCode(MessageType type) {
        // Guard: return empty if colors disabled
        if (!mUseAnsiColors) {
            return "";
        }

        switch (type) {
            case MessageType::SUCCESS:   return "\033[32m"; // Green
            case MessageType::WARNING:   return "\033[33m"; // Yellow
            case MessageType::ERROR_MSG: return "\033[31m"; // Red
            case MessageType::DEBUG:     return "\033[36m"; // Cyan
            case MessageType::INFO:      return "\033[37m"; // White
            case MessageType::SECURITY:  return "\033[35m"; // Magenta
            default:                     return "\033[37m";
        }
    }

    std::string GetTypeString(MessageType type) {
        switch (type) {
            case MessageType::SUCCESS:   return "SUCCESS";
            case MessageType::WARNING:   return "WARNING";
            case MessageType::ERROR_MSG: return "ERROR";
            case MessageType::DEBUG:     return "DEBUG";
            case MessageType::INFO:      return "INFO";
            case MessageType::SECURITY:  return "SECURITY";
            default:                     return "UNKNOWN";
        }
    }

    std::string GetTimestamp() {
        std::time_t now = std::time(nullptr);
        char buffer[20];
        std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", std::localtime(&now));
        return std::string(buffer);
    }

    void AddToHistory(const std::string& entry) {
        if (mHistory.size() >= MAX_LOG_HISTORY) {
            mHistory.erase(mHistory.begin());
        }
        mHistory.push_back(entry);
    }

    // CRC32 implementation for integrity checking
    uint32_t ComputeCRC32(const std::string& data) {
        static constexpr uint32_t CRC32_POLYNOMIAL = 0xEDB88320;
        uint32_t crc = 0xFFFFFFFF;

        for (char c : data) {
            crc ^= static_cast<uint8_t>(c);
            for (int i = 0; i < 8; ++i) {
                crc = (crc >> 1) ^ ((crc & 1) ? CRC32_POLYNOMIAL : 0);
            }
        }

        return ~crc;
    }

    // Member variables
    std::mutex mMutex;
    std::unordered_map<MessageType, std::vector<std::string>> mQuotes;
    std::vector<std::string> mHistory;
    std::unordered_map<std::string, uint32_t> mIntegrityHashes;
    std::mt19937 mRandomEngine;
    std::ofstream mLogFile;
    bool mVerboseMode;
    bool mUseAnsiColors;
    bool mFileLoggingEnabled;
};
