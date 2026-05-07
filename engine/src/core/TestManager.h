// ============================================================================
// TestManager.h - BrightForge Engine Subsystem Test Runner
// ============================================================================
// PURPOSE:  Centralized test runner that validates every engine subsystem
//           independently. Run this before starting the main loop to catch
//           missing files, broken pipelines, and configuration errors early.
//
// USAGE:    TestManager tm;
//           tm.RunAll();  // Runs every registered test
//           tm.RunSuite("Renderer");  // Run one suite only
//
// DESIGN:   Tests are registered as lambdas so any subsystem can add
//           its own tests without modifying this file. Uses the
//           QuoteSystem for themed pass/fail output.
//
// NOTES:    - Each test returns bool (pass/fail)
//           - Failed tests do not abort; all tests run, then summary
//           - Toggle individual suites on/off for focused debugging
// ============================================================================
#pragma once

#include "QuoteSystem.h"
#include "DebugWindow.h"
#include <functional>
#include <string>
#include <vector>
#include <unordered_map>
#include <iostream>

// ============================================================================
// CONFIGURABLE CONSTANTS
// ============================================================================
namespace TestConfig {
    // If true, stops running tests in a suite after the first failure
    static bool STOP_ON_FIRST_FAILURE = false;

    // If true, prints detailed output for passing tests too
    static bool VERBOSE_PASS = true;
}

// ============================================================================
// TestCase - A single named test with a callable
// ============================================================================
struct TestCase {
    std::string name;
    std::function<bool()> testFunc;
};

// ============================================================================
// TestSuite - A named group of related tests
// ============================================================================
struct TestSuite {
    std::string name;
    bool enabled;
    std::vector<TestCase> tests;

    TestSuite() : enabled(true) {}
};

// ============================================================================
// TestManager Class
// ============================================================================
class TestManager {
private:
    std::unordered_map<std::string, TestSuite> mSuites;
    QuoteSystem mQuotes;  // Own instance for test output
    int mTotalRun;
    int mTotalPassed;
    int mTotalFailed;

public:
    TestManager() : mTotalRun(0), mTotalPassed(0), mTotalFailed(0) {}

    // -----------------------------------------------------------------
    // RegisterSuite - Creates a named test suite
    // -----------------------------------------------------------------
    void RegisterSuite(const std::string& name) {
        if (mSuites.find(name) == mSuites.end()) {
            TestSuite suite;
            suite.name = name;
            mSuites[name] = suite;
        }
    }

    // -----------------------------------------------------------------
    // AddTest - Adds a test case to a suite
    // -----------------------------------------------------------------
    void AddTest(const std::string& suiteName,
                 const std::string& testName,
                 std::function<bool()> testFunc) {
        RegisterSuite(suiteName);
        TestCase tc;
        tc.name = testName;
        tc.testFunc = testFunc;
        mSuites[suiteName].tests.push_back(tc);
    }

    // -----------------------------------------------------------------
    // ToggleSuite - Enable or disable an entire test suite
    // -----------------------------------------------------------------
    void ToggleSuite(const std::string& name, bool enabled) {
        auto it = mSuites.find(name);
        if (it != mSuites.end()) {
            it->second.enabled = enabled;
        }
    }

    // -----------------------------------------------------------------
    // RunSuite - Runs all tests in a single named suite
    //   RETURNS: true if all tests in the suite passed
    // -----------------------------------------------------------------
    bool RunSuite(const std::string& name) {
        auto it = mSuites.find(name);
        if (it == mSuites.end()) {
            mQuotes.Log("Test suite '" + name + "' not found!",
                        QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }

        TestSuite& suite = it->second;
        if (!suite.enabled) {
            mQuotes.Log("Suite '" + name + "' is disabled, skipping",
                        QuoteSystem::MessageType::WARNING);
            return true;
        }

        std::cout << "\n";
        std::cout << std::string(50, '-') << std::endl;
        std::cout << " TEST SUITE: " << name << std::endl;
        std::cout << std::string(50, '-') << std::endl;

        int passed = 0;
        int failed = 0;

        for (auto& tc : suite.tests) {
            mTotalRun++;
            bool result = false;

            try {
                result = tc.testFunc();
            } catch (const std::exception& e) {
                mQuotes.Log("EXCEPTION in test '" + tc.name + "': " + e.what(),
                            QuoteSystem::MessageType::ERROR_MSG);
                result = false;
            } catch (...) {
                mQuotes.Log("UNKNOWN EXCEPTION in test '" + tc.name + "'",
                            QuoteSystem::MessageType::ERROR_MSG);
                result = false;
            }

            if (result) {
                passed++;
                mTotalPassed++;
                if (TestConfig::VERBOSE_PASS) {
                    mQuotes.Log("PASS: " + tc.name,
                                QuoteSystem::MessageType::SUCCESS);
                }
            } else {
                failed++;
                mTotalFailed++;
                mQuotes.Log("FAIL: " + tc.name,
                            QuoteSystem::MessageType::ERROR_MSG);

                if (TestConfig::STOP_ON_FIRST_FAILURE) {
                    mQuotes.Log("Stopping suite (STOP_ON_FIRST_FAILURE = true)",
                                QuoteSystem::MessageType::WARNING);
                    break;
                }
            }
        }

        std::cout << std::string(50, '-') << std::endl;
        std::cout << " " << name << " Results: "
                  << passed << " passed, " << failed << " failed"
                  << " out of " << suite.tests.size() << std::endl;
        std::cout << std::string(50, '-') << std::endl;

        return (failed == 0);
    }

    // -----------------------------------------------------------------
    // RunAll - Runs every enabled suite in registration order
    //   RETURNS: true if every test in every suite passed
    // -----------------------------------------------------------------
    bool RunAll() {
        mTotalRun = 0;
        mTotalPassed = 0;
        mTotalFailed = 0;

        mQuotes.Log("Starting full test run...",
                     QuoteSystem::MessageType::INFO);

        std::cout << "\n";
        std::cout << std::string(60, '=') << std::endl;
        std::cout << "   BRIGHTFORGE ENGINE - FULL TEST RUN" << std::endl;
        std::cout << std::string(60, '=') << std::endl;

        bool allPassed = true;
        for (auto& pair : mSuites) {
            bool suiteResult = RunSuite(pair.first);
            if (!suiteResult) allPassed = false;
        }

        // Final summary
        std::cout << "\n";
        std::cout << std::string(60, '=') << std::endl;
        std::cout << "   FINAL RESULTS" << std::endl;
        std::cout << "   Total:  " << mTotalRun << std::endl;
        std::cout << "   Passed: " << mTotalPassed << std::endl;
        std::cout << "   Failed: " << mTotalFailed << std::endl;
        std::cout << std::string(60, '=') << std::endl;

        if (allPassed) {
            mQuotes.Log("ALL TESTS PASSED! Engine is ready.",
                        QuoteSystem::MessageType::SUCCESS);
        } else {
            mQuotes.Log("SOME TESTS FAILED. Check output above for details.",
                        QuoteSystem::MessageType::ERROR_MSG);
        }

        return allPassed;
    }

    // -----------------------------------------------------------------
    // GetResults - Returns pass/fail counts for external reporting
    // -----------------------------------------------------------------
    void GetResults(int& total, int& passed, int& failed) const {
        total = mTotalRun;
        passed = mTotalPassed;
        failed = mTotalFailed;
    }

    // -----------------------------------------------------------------
    // RegisterDefaultEngineTests - Pre-built tests that check common
    //   engine setup problems.
    // -----------------------------------------------------------------
    void RegisterDefaultEngineTests(
            const std::vector<std::string>& shaderPaths,
            const std::vector<std::string>& assetPaths) {

        // File existence tests for shaders
        for (const auto& path : shaderPaths) {
            AddTest("FileSystem", "Shader exists: " + path,
                [path]() {
                    std::ifstream f(path);
                    return f.good();
                });
        }

        // File existence tests for assets
        for (const auto& path : assetPaths) {
            AddTest("FileSystem", "Asset exists: " + path,
                [path]() {
                    std::ifstream f(path);
                    return f.good();
                });
        }

        // QuoteSystem self-test
        AddTest("Core", "QuoteSystem basic logging", []() {
            QuoteSystem qs;
            qs.Log("Test", QuoteSystem::MessageType::INFO);
            return qs.GetLogCount() == 1;
        });

        // QuoteSystem integrity test
        AddTest("Core", "QuoteSystem integrity system", []() {
            QuoteSystem qs;
            qs.RegisterIntegrity("test", "secret");
            return qs.ValidateIntegrity("test", "secret");
        });

        // DebugWindow channel test
        AddTest("Core", "DebugWindow channel registration", []() {
            DebugWindow& dbg = DebugWindow::Instance();
            dbg.RegisterChannel("TestChannel_Temp");
            dbg.Post("TestChannel_Temp", "Validation post", DebugLevel::INFO);
            return dbg.GetErrorCount("TestChannel_Temp") == 0;
        });
    }
};
