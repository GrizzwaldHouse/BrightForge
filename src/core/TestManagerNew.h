// TestManagerNew.h
// Developer: Marcus Daley
// Date: April 2026
// Purpose: Enhanced test suite system with QuoteSystem integration and default engine tests

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <mutex>
#include <iostream>
#include <chrono>
#include <filesystem>
#include "QuoteSystem.h"

class TestManagerNew {
public:
    using TestFunction = std::function<bool()>;

    struct TestCase {
        std::string name;
        TestFunction testFunc;
        bool enabled;
        std::chrono::milliseconds executionTime;

        TestCase(const std::string& n, TestFunction fn)
            : name(n), testFunc(fn), enabled(true), executionTime(0) {}
    };

    struct TestSuite {
        std::string name;
        std::vector<TestCase> tests;
        bool enabled;
        size_t passedCount;
        size_t failedCount;

        TestSuite(const std::string& n)
            : name(n), enabled(true), passedCount(0), failedCount(0) {}
    };

    // Singleton accessor
    static TestManagerNew& Instance() {
        static TestManagerNew instance;
        return instance;
    }

    // Register a new test suite
    void RegisterSuite(const std::string& suiteName) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: suite already exists
        if (mSuites.find(suiteName) != mSuites.end()) {
            QuoteSystem::Instance().Log("Suite '" + suiteName + "' already registered",
                                        QuoteSystem::MessageType::WARNING);
            return;
        }

        mSuites[suiteName] = TestSuite(suiteName);
        QuoteSystem::Instance().Log("Registered test suite: " + suiteName,
                                    QuoteSystem::MessageType::INFO);
    }

    // Add a test to a suite
    void AddTest(const std::string& suiteName, const std::string& testName, TestFunction testFunc) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: suite doesn't exist
        auto it = mSuites.find(suiteName);
        if (it == mSuites.end()) {
            QuoteSystem::Instance().Log("Suite '" + suiteName + "' not found. Auto-registering.",
                                        QuoteSystem::MessageType::WARNING);
            mSuites[suiteName] = TestSuite(suiteName);
            it = mSuites.find(suiteName);
        }

        it->second.tests.emplace_back(testName, testFunc);
        QuoteSystem::Instance().Log("Added test '" + testName + "' to suite '" + suiteName + "'",
                                    QuoteSystem::MessageType::DEBUG);
    }

    // Run all enabled test suites
    void RunAll() {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: no suites registered
        if (mSuites.empty()) {
            QuoteSystem::Instance().Log("No test suites registered", QuoteSystem::MessageType::WARNING);
            return;
        }

        QuoteSystem::Instance().Log("Running all test suites...", QuoteSystem::MessageType::INFO);

        for (auto& [name, suite] : mSuites) {
            if (suite.enabled) {
                RunSuiteInternal(suite);
            }
        }

        PrintSummary();
    }

    // Run a specific test suite
    void RunSuite(const std::string& suiteName) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: suite doesn't exist
        auto it = mSuites.find(suiteName);
        if (it == mSuites.end()) {
            QuoteSystem::Instance().Log("Suite '" + suiteName + "' not found",
                                        QuoteSystem::MessageType::ERROR_MSG);
            return;
        }

        // Guard: suite disabled
        if (!it->second.enabled) {
            QuoteSystem::Instance().Log("Suite '" + suiteName + "' is disabled",
                                        QuoteSystem::MessageType::WARNING);
            return;
        }

        RunSuiteInternal(it->second);
        PrintSuiteSummary(it->second);
    }

    // Enable or disable a test suite
    void ToggleSuite(const std::string& suiteName, bool enabled) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Guard: suite doesn't exist
        auto it = mSuites.find(suiteName);
        if (it == mSuites.end()) {
            QuoteSystem::Instance().Log("Suite '" + suiteName + "' not found",
                                        QuoteSystem::MessageType::WARNING);
            return;
        }

        it->second.enabled = enabled;
        std::string status = enabled ? "enabled" : "disabled";
        QuoteSystem::Instance().Log("Suite '" + suiteName + "' " + status,
                                    QuoteSystem::MessageType::INFO);
    }

    // Get test results
    void GetResults(size_t& total, size_t& passed, size_t& failed) {
        std::lock_guard<std::mutex> lock(mMutex);

        total = 0;
        passed = 0;
        failed = 0;

        for (const auto& [name, suite] : mSuites) {
            total += suite.tests.size();
            passed += suite.passedCount;
            failed += suite.failedCount;
        }
    }

    // Register default engine file existence tests
    void RegisterDefaultEngineTests(const std::vector<std::string>& shaderPaths,
                                     const std::vector<std::string>& assetPaths) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Create shader existence tests
        RegisterSuite("ShaderFiles");
        for (const auto& path : shaderPaths) {
            std::string testName = "Check shader: " + path;
            AddTestInternal("ShaderFiles", testName, [path]() {
                return std::filesystem::exists(path);
            });
        }

        // Create asset existence tests
        RegisterSuite("AssetFiles");
        for (const auto& path : assetPaths) {
            std::string testName = "Check asset: " + path;
            AddTestInternal("AssetFiles", testName, [path]() {
                return std::filesystem::exists(path);
            });
        }

        QuoteSystem::Instance().Log("Registered default engine tests",
                                    QuoteSystem::MessageType::SUCCESS);
    }

    // Prevent copy/move
    TestManagerNew(const TestManagerNew&) = delete;
    TestManagerNew& operator=(const TestManagerNew&) = delete;
    TestManagerNew(TestManagerNew&&) = delete;
    TestManagerNew& operator=(TestManagerNew&&) = delete;

private:
    static constexpr int64_t MAX_TEST_DURATION_MS = 100;

    TestManagerNew() = default;

    // Internal test execution (assumes lock already held)
    void AddTestInternal(const std::string& suiteName, const std::string& testName, TestFunction testFunc) {
        auto it = mSuites.find(suiteName);
        if (it != mSuites.end()) {
            it->second.tests.emplace_back(testName, testFunc);
        }
    }

    void RunSuiteInternal(TestSuite& suite) {
        suite.passedCount = 0;
        suite.failedCount = 0;

        QuoteSystem::Instance().Log("Running suite: " + suite.name, QuoteSystem::MessageType::INFO);

        for (auto& test : suite.tests) {
            // Guard: test disabled
            if (!test.enabled) {
                continue;
            }

            auto startTime = std::chrono::high_resolution_clock::now();
            bool passed = false;

            try {
                passed = test.testFunc();
            } catch (const std::exception& e) {
                QuoteSystem::Instance().Log("Test '" + test.name + "' threw exception: " + e.what(),
                                            QuoteSystem::MessageType::ERROR_MSG);
                passed = false;
            } catch (...) {
                QuoteSystem::Instance().Log("Test '" + test.name + "' threw unknown exception",
                                            QuoteSystem::MessageType::ERROR_MSG);
                passed = false;
            }

            auto endTime = std::chrono::high_resolution_clock::now();
            test.executionTime = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime);

            // Guard: test took too long
            if (test.executionTime.count() > MAX_TEST_DURATION_MS) {
                QuoteSystem::Instance().Log("Test '" + test.name + "' exceeded time limit (" +
                                            std::to_string(test.executionTime.count()) + "ms)",
                                            QuoteSystem::MessageType::WARNING);
            }

            // Log result
            if (passed) {
                ++suite.passedCount;
                QuoteSystem::Instance().Log("PASSED: " + test.name + " (" +
                                            std::to_string(test.executionTime.count()) + "ms)",
                                            QuoteSystem::MessageType::SUCCESS);
            } else {
                ++suite.failedCount;
                QuoteSystem::Instance().Log("FAILED: " + test.name, QuoteSystem::MessageType::ERROR_MSG);
            }
        }
    }

    void PrintSuiteSummary(const TestSuite& suite) {
        size_t total = suite.passedCount + suite.failedCount;
        std::cout << "\n=== Suite Summary: " << suite.name << " ===\n";
        std::cout << "Total:  " << total << "\n";
        std::cout << "Passed: " << suite.passedCount << "\n";
        std::cout << "Failed: " << suite.failedCount << "\n";
        std::cout << "==============================\n\n";
    }

    void PrintSummary() {
        size_t totalTests = 0;
        size_t totalPassed = 0;
        size_t totalFailed = 0;

        for (const auto& [name, suite] : mSuites) {
            totalTests += suite.tests.size();
            totalPassed += suite.passedCount;
            totalFailed += suite.failedCount;
        }

        std::cout << "\n========================================\n";
        std::cout << "        All Suites Summary             \n";
        std::cout << "========================================\n";
        std::cout << "Total Tests:  " << totalTests << "\n";
        std::cout << "Passed:       " << totalPassed << "\n";
        std::cout << "Failed:       " << totalFailed << "\n";
        std::cout << "========================================\n\n";

        if (totalFailed == 0) {
            QuoteSystem::Instance().Log("All tests passed!", QuoteSystem::MessageType::SUCCESS);
        } else {
            QuoteSystem::Instance().Log(std::to_string(totalFailed) + " test(s) failed",
                                        QuoteSystem::MessageType::ERROR_MSG);
        }
    }

    // Member variables
    std::mutex mMutex;
    std::unordered_map<std::string, TestSuite> mSuites;
};
