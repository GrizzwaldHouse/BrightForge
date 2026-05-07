// ============================================================================
// main.cpp - BrightForge Engine Infrastructure Demo
// ============================================================================
// Exercises all four infrastructure systems (QuoteSystem, DebugWindow,
// TestManager, EventBus) without requiring Vulkan, GateWare, or any GPU.
// Build and run this to verify the base compiles and passes self-tests.
// ============================================================================

#include "QuoteSystem.h"
#include "DebugWindow.h"
#include "TestManager.h"
#include "EventBus.h"

#include <iostream>
#include <string>

int main() {
    std::cout << "\n";
    std::cout << "============================================" << std::endl;
    std::cout << "   BRIGHTFORGE ENGINE - Infrastructure Demo" << std::endl;
    std::cout << "============================================\n" << std::endl;

    // --- 1. QuoteSystem: log one message of each type ---
    QuoteSystem qs;
    qs.Log("Engine starting up", QuoteSystem::MessageType::INFO);
    qs.Log("All core modules loaded", QuoteSystem::MessageType::SUCCESS);
    qs.Log("No Vulkan SDK detected (expected in demo mode)", QuoteSystem::MessageType::WARNING);
    qs.Log("Tracing infrastructure init sequence", QuoteSystem::MessageType::DEBUG);
    qs.Log("Simulated shader compilation failure", QuoteSystem::MessageType::ERROR_MSG);
    qs.Log("Core integrity baseline established", QuoteSystem::MessageType::SECURITY);

    // --- 2. Integrity system: register, validate, tamper ---
    qs.RegisterIntegrity("RenderPipeline", "I solemnly swear I am up to no good");

    bool valid = qs.ValidateIntegrity("RenderPipeline", "I solemnly swear I am up to no good");
    std::cout << "\n[DEMO] Integrity check (correct phrase): "
              << (valid ? "PASSED" : "FAILED") << std::endl;

    bool tampered = qs.ValidateIntegrity("RenderPipeline", "mischief managed");
    std::cout << "[DEMO] Integrity check (tampered phrase): "
              << (tampered ? "PASSED (BAD!)" : "DETECTED TAMPERING (correct)") << "\n" << std::endl;

    // --- 3. DebugWindow: register channels, check files ---
    DebugWindow& dbg = DebugWindow::Instance();
    dbg.RegisterChannel("Demo");
    dbg.Post("Demo", "Infrastructure demo started", DebugLevel::INFO);
    dbg.Post("Renderer", "Vulkan backend not yet ported", DebugLevel::WARN);

    dbg.CheckFileExists("Shaders", "shaders/VertexShader.hlsl.TODO");
    dbg.CheckFileExists("Shaders", "shaders/VertexShader.hlsl");

    // --- 4. Run embedded self-tests ---
    std::cout << "\n--- QuoteSystem Self-Tests ---" << std::endl;
    bool qsTests = QuoteSystemTestManager::RunAllTests();

    std::cout << "\n--- EventBus Self-Tests ---" << std::endl;
    bool ebTests = EventBusTests::RunAll();

    // --- 5. EventBus: subscribe, publish, confirm delivery ---
    EventBus& bus = EventBus::Instance();
    bus.ClearAll();

    bool eventReceived = false;
    std::string receivedPath;

    bus.Subscribe("file.dropped",
        [&](const std::string& _name, const EventPayload& p) {
            eventReceived = true;
            receivedPath = p.GetString();
        });

    bus.Publish("file.dropped", EventPayload::String("Models/bottle.gltf"));

    std::cout << "\n[DEMO] EventBus file.dropped test: "
              << (eventReceived ? "RECEIVED" : "NOT RECEIVED")
              << " (path: " << receivedPath << ")" << std::endl;

    bus.PrintStats();

    // --- 6. Final dashboard ---
    dbg.Post("Demo", "All infrastructure demos complete", DebugLevel::INFO);
    dbg.PrintDashboard();

    // --- Summary ---
    std::cout << "\n============================================" << std::endl;
    std::cout << "   DEMO SUMMARY" << std::endl;
    std::cout << "   QuoteSystem tests: " << (qsTests ? "ALL PASSED" : "SOME FAILED") << std::endl;
    std::cout << "   EventBus tests:    " << (ebTests ? "ALL PASSED" : "SOME FAILED") << std::endl;
    std::cout << "   Event delivery:    " << (eventReceived ? "OK" : "FAILED") << std::endl;
    std::cout << "   Integrity detect:  " << (!tampered ? "OK" : "FAILED") << std::endl;
    std::cout << "============================================" << std::endl;

    bool allOk = qsTests && ebTests && eventReceived && !tampered;
    std::cout << "\n   " << (allOk ? "All systems nominal. Ready for Vulkan integration."
                                   : "Some checks failed. Review output above.") << "\n" << std::endl;

    return allOk ? 0 : 1;
}
