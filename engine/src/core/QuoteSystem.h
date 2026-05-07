// ============================================================================
// QuoteSystem.h - BrightForge Engine Motivational Logging System
// ============================================================================
// PURPOSE:  Provides themed console output using quotes from favorite books
//           and anime. Acts as both a debugging aid and a morale booster.
//           Each message type (SUCCESS, WARNING, ERROR, DEBUG, INFO) pulls
//           from a different quote pool so you always know at a glance
//           what kind of message you are reading.
//
// USAGE:    #include "QuoteSystem.h"
//           QuoteSystem qs;
//           qs.Log("Shader compiled", QuoteSystem::MessageType::SUCCESS);
//
// SOURCES:  Harry Potter, Alice in Wonderland, Holes, Maya Angelou,
//           Naruto, Black Clover
//
// SECURITY: The QuoteSystem doubles as a code-integrity checkpoint.
//           Each subsystem can register a "security quote" at init time.
//           If the quote changes at runtime it means someone tampered
//           with memory. See ValidateIntegrity() below.
//
// NOTES:    - Thread-safe via mutex on all public methods
//           - Verbose mode is togglable at runtime
//           - Log output goes to both console and optional file
//           - All configurable values are at the top as constants
// ============================================================================
#pragma once

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <random>
#include <chrono>
#include <mutex>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <functional>

// ============================================================================
// CONFIGURABLE CONSTANTS - Change these to customize behavior
// ============================================================================
namespace QuoteConfig {
    // Toggle verbose logging globally (set false for release builds)
    static bool VERBOSE_MODE = true;

    // Toggle file logging
    static bool FILE_LOGGING_ENABLED = false;

    // Default log file path (only used if FILE_LOGGING_ENABLED is true)
    static const char* DEFAULT_LOG_FILE = "brightforge_engine.log";

    // Maximum log entries kept in memory ring buffer
    static constexpr int MAX_LOG_HISTORY = 500;

    // Color codes for console output (ANSI escape sequences)
    // Set USE_ANSI_COLORS to false on Windows cmd that does not support them
    static bool USE_ANSI_COLORS = true;

    static const char* COLOR_RESET   = "\033[0m";
    static const char* COLOR_GREEN   = "\033[32m";    // SUCCESS
    static const char* COLOR_YELLOW  = "\033[33m";    // WARNING
    static const char* COLOR_RED     = "\033[31m";    // ERROR
    static const char* COLOR_CYAN    = "\033[36m";    // DEBUG
    static const char* COLOR_BLUE    = "\033[34m";    // INFO
    static const char* COLOR_MAGENTA = "\033[35m";    // SECURITY
}

// ============================================================================
// QuoteSystem Class
// ============================================================================
class QuoteSystem {
public:
    // -----------------------------------------------------------------
    // MessageType - Determines which quote pool is sampled and what
    //               color/prefix the console line gets.
    // -----------------------------------------------------------------
    enum class MessageType {
        SUCCESS,    // Task completed - Harry Potter celebration quotes
        WARNING,    // Something odd - Alice in Wonderland curiosity quotes
        ERROR_MSG,  // Something broke - Holes persistence quotes
        DEBUG,      // Dev info - Naruto determination quotes
        INFO,       // General info - Maya Angelou wisdom quotes
        SECURITY    // Integrity check - Black Clover willpower quotes
    };

    // -----------------------------------------------------------------
    // LogEntry - A single timestamped log record kept in the ring buffer
    // -----------------------------------------------------------------
    struct LogEntry {
        std::string timestamp;
        std::string message;
        std::string quote;
        MessageType type;
    };

private:
    // Quote pools organized by message type
    std::unordered_map<int, std::vector<std::string>> mQuotePools;

    // Ring buffer of recent log entries
    std::vector<LogEntry> mLogHistory;
    int mLogIndex;

    // Security integrity map: subsystem name -> hash of registration quote
    std::unordered_map<std::string, size_t> mIntegrityHashes;

    // Random engine for quote selection
    std::mt19937 mRng;

    // Thread safety
    mutable std::mutex mMutex;

    // Optional file stream for persistent logging
    std::ofstream mLogFile;

    // -----------------------------------------------------------------
    // InitializeQuotePools - Populates all quote vectors.
    //   Called once from the constructor.
    //   Each pool maps to a MessageType so the right flavor of quote
    //   appears for the right situation.
    //
    // WHY SEPARATE POOLS:
    //   A developer scanning console output can instantly tell SUCCESS
    //   from ERROR just by recognizing the quote style, even before
    //   reading the actual message. Harry Potter = good. Holes = bad.
    // -----------------------------------------------------------------
    void InitializeQuotePools() {
        // SUCCESS quotes - Harry Potter (celebration, triumph)
        mQuotePools[static_cast<int>(MessageType::SUCCESS)] = {
            "Mischief Managed!",
            "After all this time? Always.",
            "It does not do to dwell on dreams and forget to live.",
            "Happiness can be found even in the darkest of times, if one only remembers to turn on the light.",
            "We did it! The task is complete, just like finding the Snitch!",
            "I solemnly swear that this function is up to no good... and it worked!",
            "Dobby is a free elf! And this task is free of errors!",
            "10 points to your house for completing this task!",
            "The wand chooses the wizard, and this code chose to work!",
            "Nitwit! Blubber! Oddment! Tweak! Task complete!"
        };

        // WARNING quotes - Alice in Wonderland (curiosity, strangeness)
        mQuotePools[static_cast<int>(MessageType::WARNING)] = {
            "Curiouser and curiouser!",
            "I think of six impossible things before breakfast... this warning is one of them.",
            "We are all mad here. But this warning deserves attention.",
            "If you do not know where you are going, any road will get you there... but check this warning first.",
            "Begin at the beginning and go on till you come to the end; then stop. But first, read this warning.",
            "Who in the world am I? Ah, that is the great puzzle. And so is this warning.",
            "It would be so nice if something made sense for a change... like this warning.",
            "Why, sometimes I have believed as many as six impossible bugs before breakfast.",
            "Off with their heads! ...Just kidding, but seriously check this warning.",
            "The rabbit hole goes deeper. Investigate this warning."
        };

        // ERROR quotes - Holes (persistence through hardship)
        mQuotePools[static_cast<int>(MessageType::ERROR_MSG)] = {
            "You will have to fill in the holes yourself. Something went wrong.",
            "If only, if only, the woodpecker sighs... if only this function had not failed.",
            "I can fix it. I am pretty good at fixing things. Let us debug this.",
            "You take a bad boy, make him dig holes all day in the hot sun, it makes him a good boy. Debug time.",
            "The lizards will not bite you... but this error might. Check the logs.",
            "There is no lake at Camp Green Lake, and there is no success in this function call.",
            "Dig deeper. The error is buried in the stack trace.",
            "Stanley Yelnats would not give up, and neither should we. Retry initiated.",
            "The curse is real, but so is the fix. Check your parameters.",
            "Zero found water. You can find this bug. Keep digging."
        };

        // DEBUG quotes - Naruto (determination, never give up)
        mQuotePools[static_cast<int>(MessageType::DEBUG)] = {
            "Believe it! Debugging in progress!",
            "I am not gonna run away, I never go back on my word! Checking the pipeline...",
            "A smile is the easiest way out of a difficult situation. But first, check these values.",
            "When people are protecting something truly special to them, they truly can become as strong as they can be. Protecting the codebase now.",
            "If you do not like your destiny, do not accept it. Fix the bug instead!",
            "The next generation will always surpass the previous one. Refactoring...",
            "Hard work is worthless for those that do not believe in themselves. This debug log believes in you.",
            "I will become Hokage! But first, let me trace this variable.",
            "Those who break the rules are trash, but those who abandon their comrades are worse than trash. Check your dependencies.",
            "Dattebayo! Debug checkpoint reached!"
        };

        // INFO quotes - Maya Angelou (wisdom, encouragement)
        mQuotePools[static_cast<int>(MessageType::INFO)] = {
            "There is no greater agony than bearing an untold story inside you. Here is your info.",
            "We delight in the beauty of the butterfly, but rarely admit the changes it has gone through. System update.",
            "If you are always trying to be normal, you will never know how amazing you can be. Engine status report.",
            "I have learned that people will forget what you said, people will forget what you did, but people will never forget how you made them feel. Logging info.",
            "Nothing will work unless you do. Pipeline active.",
            "Life is not measured by the number of breaths we take, but by the moments that take our breath away. Checkpoint reached.",
            "You may not control all the events that happen to you, but you can decide not to be reduced by them. System nominal.",
            "Try to be a rainbow in someone else's cloud. Info logged.",
            "Do the best you can until you know better. Then when you know better, do better. Updating state.",
            "Courage is the most important of all the virtues. Proceeding with operation."
        };

        // SECURITY quotes - Black Clover (willpower, anti-magic determination)
        mQuotePools[static_cast<int>(MessageType::SECURITY)] = {
            "I will not give up! I will become the Wizard King! Integrity check passed!",
            "Surpassing your limits right here, right now! Security validated!",
            "Not giving up is my magic! Memory integrity confirmed!",
            "I will never stop moving forward! Subsystem hash verified!",
            "The magic is in never giving up! Security checkpoint clear!",
            "Even without magic, I will become the Wizard King! Anti-tamper check passed!",
            "My grimoire is my promise! Code integrity sealed!",
            "Black bulls never back down! Security scan complete!",
            "Limits are meant to be surpassed! Validation successful!",
            "I will protect everyone! Memory guard active!"
        };
    }

    // -----------------------------------------------------------------
    // GetTimestamp - Returns current time as a formatted string
    //   Format: [YYYY-MM-DD HH:MM:SS.mmm]
    //   RETURNS: String with bracketed timestamp
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
        ss << "[" << std::put_time(&tm_buf, "%Y-%m-%d %H:%M:%S")
           << "." << std::setfill('0') << std::setw(3) << ms.count() << "]";
        return ss.str();
    }

    // -----------------------------------------------------------------
    // GetRandomQuote - Picks a random quote from the pool matching
    //                  the given MessageType.
    //   PARAM type: Which quote pool to draw from
    //   RETURNS:    A random quote string, or fallback if pool is empty
    // -----------------------------------------------------------------
    std::string GetRandomQuote(MessageType type) {
        auto it = mQuotePools.find(static_cast<int>(type));
        if (it == mQuotePools.end() || it->second.empty()) {
            return "No quote available. The story continues...";
        }
        std::uniform_int_distribution<size_t> dist(0, it->second.size() - 1);
        return it->second[dist(mRng)];
    }

    // -----------------------------------------------------------------
    // GetPrefix - Returns the colored tag prefix for a message type
    //   PARAM type: The message type
    //   RETURNS:    String like "[SUCCESS]" with optional ANSI color
    // -----------------------------------------------------------------
    std::string GetPrefix(MessageType type) const {
        const char* color = QuoteConfig::COLOR_RESET;
        const char* label = "UNKNOWN";

        switch (type) {
            case MessageType::SUCCESS:
                color = QuoteConfig::COLOR_GREEN;
                label = "SUCCESS";
                break;
            case MessageType::WARNING:
                color = QuoteConfig::COLOR_YELLOW;
                label = "WARNING";
                break;
            case MessageType::ERROR_MSG:
                color = QuoteConfig::COLOR_RED;
                label = "ERROR";
                break;
            case MessageType::DEBUG:
                color = QuoteConfig::COLOR_CYAN;
                label = "DEBUG";
                break;
            case MessageType::INFO:
                color = QuoteConfig::COLOR_BLUE;
                label = "INFO";
                break;
            case MessageType::SECURITY:
                color = QuoteConfig::COLOR_MAGENTA;
                label = "SECURITY";
                break;
        }

        std::stringstream ss;
        if (QuoteConfig::USE_ANSI_COLORS) {
            ss << color << "[" << label << "]" << QuoteConfig::COLOR_RESET;
        } else {
            ss << "[" << label << "]";
        }
        return ss.str();
    }

    // -----------------------------------------------------------------
    // HashString - Simple FNV-1a hash for integrity checking
    //   PARAM str: The string to hash
    //   RETURNS:   size_t hash value
    //   WHY FNV:   Fast, good distribution, no crypto overhead needed.
    //              We are detecting accidental corruption, not attacks.
    // -----------------------------------------------------------------
    size_t HashString(const std::string& str) const {
        size_t hash = 14695981039346656037ULL;  // FNV offset basis
        for (char c : str) {
            hash ^= static_cast<size_t>(c);
            hash *= 1099511628211ULL;           // FNV prime
        }
        return hash;
    }

public:
    // -----------------------------------------------------------------
    // Constructor - Seeds RNG, initializes quote pools and ring buffer
    // -----------------------------------------------------------------
    QuoteSystem()
        : mLogIndex(0)
    {
        // Seed with high-resolution clock for unique sequences each run
        auto seed = static_cast<unsigned int>(
            std::chrono::high_resolution_clock::now().time_since_epoch().count());
        mRng.seed(seed);

        mLogHistory.resize(QuoteConfig::MAX_LOG_HISTORY);
        InitializeQuotePools();

        // Open log file if file logging is enabled
        if (QuoteConfig::FILE_LOGGING_ENABLED) {
            mLogFile.open(QuoteConfig::DEFAULT_LOG_FILE, std::ios::app);
        }
    }

    // -----------------------------------------------------------------
    // Destructor - Flushes and closes log file
    // -----------------------------------------------------------------
    ~QuoteSystem() {
        if (mLogFile.is_open()) {
            mLogFile.flush();
            mLogFile.close();
        }
    }

    // Prevent copying (file handle + mutex are not copyable)
    QuoteSystem(const QuoteSystem&) = delete;
    QuoteSystem& operator=(const QuoteSystem&) = delete;

    // -----------------------------------------------------------------
    // Log - Main logging method. Prints message with timestamp, prefix,
    //        a random thematic quote, and stores it in the ring buffer.
    //
    //   PARAM message: The actual information to log
    //   PARAM type:    Determines color, prefix, and quote pool
    //
    //   EXAMPLE:
    //     qs.Log("Vertex buffer created", QuoteSystem::MessageType::SUCCESS);
    //     // Output:
    //     // [2026-04-14 10:30:15.042] [SUCCESS] Vertex buffer created
    //     //   >> "Mischief Managed!"
    // -----------------------------------------------------------------
    void Log(const std::string& message, MessageType type) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Skip DEBUG messages when not in verbose mode
        if (type == MessageType::DEBUG && !QuoteConfig::VERBOSE_MODE) {
            return;
        }

        std::string timestamp = GetTimestamp();
        std::string prefix = GetPrefix(type);
        std::string quote = GetRandomQuote(type);

        // Console output
        std::cout << timestamp << " " << prefix << " " << message << std::endl;
        std::cout << "   >> \"" << quote << "\"" << std::endl;

        // File output (no ANSI colors in file)
        if (mLogFile.is_open()) {
            // Strip ANSI from prefix for file logging
            std::string cleanPrefix;
            switch (type) {
                case MessageType::SUCCESS:  cleanPrefix = "[SUCCESS]"; break;
                case MessageType::WARNING:  cleanPrefix = "[WARNING]"; break;
                case MessageType::ERROR_MSG:cleanPrefix = "[ERROR]"; break;
                case MessageType::DEBUG:    cleanPrefix = "[DEBUG]"; break;
                case MessageType::INFO:     cleanPrefix = "[INFO]"; break;
                case MessageType::SECURITY: cleanPrefix = "[SECURITY]"; break;
            }
            mLogFile << timestamp << " " << cleanPrefix << " " << message
                     << " >> \"" << quote << "\"" << std::endl;
        }

        // Store in ring buffer
        int idx = mLogIndex % QuoteConfig::MAX_LOG_HISTORY;
        mLogHistory[idx] = { timestamp, message, quote, type };
        mLogIndex++;
    }

    // -----------------------------------------------------------------
    // RegisterIntegrity - Registers a subsystem with a security quote.
    //   Store the hash of the quote. Later call ValidateIntegrity()
    //   to verify nothing changed unexpectedly.
    //
    //   PARAM subsystemName:  Unique name like "RenderPipeline"
    //   PARAM securityPhrase: A secret phrase that should never change
    // -----------------------------------------------------------------
    void RegisterIntegrity(const std::string& subsystemName,
                           const std::string& securityPhrase) {
        std::lock_guard<std::mutex> lock(mMutex);
        mIntegrityHashes[subsystemName] = HashString(securityPhrase);
        Log("Registered integrity check for: " + subsystemName,
            MessageType::SECURITY);
    }

    // -----------------------------------------------------------------
    // ValidateIntegrity - Re-hashes the phrase and compares to stored hash
    //   PARAM subsystemName:  Which subsystem to check
    //   PARAM securityPhrase: The phrase that was originally registered
    //   RETURNS: true if hash matches, false if tampered or not found
    // -----------------------------------------------------------------
    bool ValidateIntegrity(const std::string& subsystemName,
                           const std::string& securityPhrase) {
        std::lock_guard<std::mutex> lock(mMutex);
        auto it = mIntegrityHashes.find(subsystemName);
        if (it == mIntegrityHashes.end()) {
            std::cout << GetPrefix(MessageType::ERROR_MSG)
                      << " Integrity check failed: subsystem '"
                      << subsystemName << "' not registered!" << std::endl;
            return false;
        }
        size_t currentHash = HashString(securityPhrase);
        bool valid = (currentHash == it->second);
        if (valid) {
            Log("Integrity PASSED for: " + subsystemName,
                MessageType::SECURITY);
        } else {
            Log("INTEGRITY VIOLATION for: " + subsystemName
                + " - possible memory corruption or tampering!",
                MessageType::ERROR_MSG);
        }
        return valid;
    }

    // -----------------------------------------------------------------
    // SetVerbose - Toggle debug message visibility at runtime
    //   PARAM enabled: true = show DEBUG messages, false = suppress them
    // -----------------------------------------------------------------
    void SetVerbose(bool enabled) {
        QuoteConfig::VERBOSE_MODE = enabled;
        Log(enabled ? "Verbose mode ON" : "Verbose mode OFF",
            MessageType::INFO);
    }

    // -----------------------------------------------------------------
    // SetFileLogging - Toggle persistent file logging at runtime
    //   PARAM enabled:  true = write to file, false = console only
    //   PARAM filePath: Optional custom log file path
    // -----------------------------------------------------------------
    void SetFileLogging(bool enabled,
                        const std::string& filePath = "") {
        std::lock_guard<std::mutex> lock(mMutex);
        QuoteConfig::FILE_LOGGING_ENABLED = enabled;
        if (enabled) {
            std::string path = filePath.empty()
                ? QuoteConfig::DEFAULT_LOG_FILE : filePath;
            if (!mLogFile.is_open()) {
                mLogFile.open(path, std::ios::app);
            }
        } else {
            if (mLogFile.is_open()) {
                mLogFile.flush();
                mLogFile.close();
            }
        }
    }

    // -----------------------------------------------------------------
    // PrintHistory - Dumps the ring buffer to console for review.
    //   PARAM count: How many recent entries to show (0 = all stored)
    // -----------------------------------------------------------------
    void PrintHistory(int count = 0) const {
        std::lock_guard<std::mutex> lock(mMutex);
        int total = std::min(mLogIndex, QuoteConfig::MAX_LOG_HISTORY);
        int toShow = (count > 0 && count < total) ? count : total;

        std::cout << "\n========== BRIGHTFORGE LOG HISTORY ==========" << std::endl;
        std::cout << "Showing last " << toShow << " of " << total
                  << " entries" << std::endl;
        std::cout << "==============================================" << std::endl;

        int startIdx = (mLogIndex - toShow);
        if (startIdx < 0) startIdx = 0;

        for (int i = startIdx; i < mLogIndex && i < startIdx + toShow; i++) {
            int bufIdx = i % QuoteConfig::MAX_LOG_HISTORY;
            const LogEntry& entry = mLogHistory[bufIdx];
            if (entry.timestamp.empty()) continue;
            std::cout << entry.timestamp << " "
                      << GetPrefix(entry.type) << " "
                      << entry.message << std::endl;
            std::cout << "   >> \"" << entry.quote << "\"" << std::endl;
        }
        std::cout << "==============================================" << std::endl;
    }

    // -----------------------------------------------------------------
    // GetLogCount - Returns total number of log entries recorded
    // -----------------------------------------------------------------
    int GetLogCount() const {
        std::lock_guard<std::mutex> lock(mMutex);
        return mLogIndex;
    }

    // -----------------------------------------------------------------
    // AddCustomQuote - Lets users extend the quote pools at runtime
    //   PARAM type:  Which pool to add to
    //   PARAM quote: The new quote string
    // -----------------------------------------------------------------
    void AddCustomQuote(MessageType type, const std::string& quote) {
        std::lock_guard<std::mutex> lock(mMutex);
        mQuotePools[static_cast<int>(type)].push_back(quote);
    }
};

// ============================================================================
// TestManager for QuoteSystem - Validates all features in isolation
// ============================================================================
class QuoteSystemTestManager {
public:
    // -----------------------------------------------------------------
    // RunAllTests - Exercises every public method of QuoteSystem
    //   RETURNS: true if all tests pass, false otherwise
    // -----------------------------------------------------------------
    static bool RunAllTests() {
        std::cout << "\n===== QUOTESYSTEM TEST SUITE =====" << std::endl;
        bool allPassed = true;

        allPassed &= TestBasicLogging();
        allPassed &= TestAllMessageTypes();
        allPassed &= TestIntegritySystem();
        allPassed &= TestVerboseToggle();
        allPassed &= TestHistory();
        allPassed &= TestCustomQuotes();

        std::cout << "\n===== TEST RESULTS: "
                  << (allPassed ? "ALL PASSED" : "SOME FAILED")
                  << " =====" << std::endl;
        return allPassed;
    }

private:
    static bool TestBasicLogging() {
        std::cout << "\n[TEST] Basic Logging..." << std::endl;
        QuoteSystem qs;
        qs.Log("Test message", QuoteSystem::MessageType::INFO);
        bool passed = (qs.GetLogCount() == 1);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - Log count check" << std::endl;
        return passed;
    }

    static bool TestAllMessageTypes() {
        std::cout << "\n[TEST] All Message Types..." << std::endl;
        QuoteSystem qs;
        qs.Log("Success test", QuoteSystem::MessageType::SUCCESS);
        qs.Log("Warning test", QuoteSystem::MessageType::WARNING);
        qs.Log("Error test", QuoteSystem::MessageType::ERROR_MSG);
        qs.Log("Debug test", QuoteSystem::MessageType::DEBUG);
        qs.Log("Info test", QuoteSystem::MessageType::INFO);
        qs.Log("Security test", QuoteSystem::MessageType::SECURITY);
        bool passed = (qs.GetLogCount() == 6);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - All 6 types logged" << std::endl;
        return passed;
    }

    static bool TestIntegritySystem() {
        std::cout << "\n[TEST] Integrity System..." << std::endl;
        QuoteSystem qs;
        qs.RegisterIntegrity("TestSubsystem", "I solemnly swear I am up to no good");

        bool valid = qs.ValidateIntegrity("TestSubsystem",
                                          "I solemnly swear I am up to no good");
        bool invalid = !qs.ValidateIntegrity("TestSubsystem",
                                             "tampered phrase");
        bool notFound = !qs.ValidateIntegrity("NonExistent", "anything");

        std::cout << (valid ? "  PASS" : "  FAIL")
                  << " - Valid phrase accepted" << std::endl;
        std::cout << (invalid ? "  PASS" : "  FAIL")
                  << " - Tampered phrase rejected" << std::endl;
        std::cout << (notFound ? "  PASS" : "  FAIL")
                  << " - Unregistered subsystem rejected" << std::endl;
        return valid && invalid && notFound;
    }

    static bool TestVerboseToggle() {
        std::cout << "\n[TEST] Verbose Toggle..." << std::endl;
        QuoteSystem qs;
        int before = qs.GetLogCount();
        qs.SetVerbose(false);
        qs.Log("Should be suppressed", QuoteSystem::MessageType::DEBUG);
        int afterSuppress = qs.GetLogCount();
        qs.SetVerbose(true);
        qs.Log("Should appear", QuoteSystem::MessageType::DEBUG);
        int afterRestore = qs.GetLogCount();

        bool passed = (afterSuppress == before + 1)
                   && (afterRestore == before + 3);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - Verbose toggle works" << std::endl;
        return passed;
    }

    static bool TestHistory() {
        std::cout << "\n[TEST] History Ring Buffer..." << std::endl;
        QuoteSystem qs;
        for (int i = 0; i < 10; i++) {
            qs.Log("Entry " + std::to_string(i), QuoteSystem::MessageType::INFO);
        }
        bool passed = (qs.GetLogCount() == 10);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - 10 entries recorded" << std::endl;
        qs.PrintHistory(3);
        return passed;
    }

    static bool TestCustomQuotes() {
        std::cout << "\n[TEST] Custom Quote Addition..." << std::endl;
        QuoteSystem qs;
        qs.AddCustomQuote(QuoteSystem::MessageType::SUCCESS,
                          "Custom submarine veteran quote: All ahead full!");
        for (int i = 0; i < 5; i++) {
            qs.Log("Custom quote test " + std::to_string(i),
                   QuoteSystem::MessageType::SUCCESS);
        }
        bool passed = (qs.GetLogCount() == 5);
        std::cout << (passed ? "  PASS" : "  FAIL")
                  << " - Custom quotes integrated" << std::endl;
        return passed;
    }
};
