// test_headers.cpp
// Quick compilation test for the 4 foundational header files

#include "QuoteSystem.h"
#include "DebugWindow.h"
#include "TestManagerNew.h"
#include "EventBus.h"

int main() {
    // Test QuoteSystem
    QuoteSystem::Instance().Log("Testing QuoteSystem", QuoteSystem::MessageType::SUCCESS);
    QuoteSystem::Instance().RegisterIntegrity("engine", "brightforge_v1");
    bool valid = QuoteSystem::Instance().ValidateIntegrity("engine", "brightforge_v1");

    // Test DebugWindow
    DebugWindow::Instance().Post("Engine", "Testing DebugWindow", DebugWindow::DebugLevel::INFO);
    DebugWindow::Instance().PrintDashboard();

    // Test TestManagerNew
    TestManagerNew::Instance().RegisterSuite("BasicTests");
    TestManagerNew::Instance().AddTest("BasicTests", "Always Pass", []() { return true; });
    TestManagerNew::Instance().AddTest("BasicTests", "Always Fail", []() { return false; });
    TestManagerNew::Instance().RunSuite("BasicTests");

    // Test EventBus
    EventBus::Instance().Subscribe("test.event", [](const EventBus::EventPayload& payload) {
        if (std::holds_alternative<std::string>(payload)) {
            std::cout << "Received: " << std::get<std::string>(payload) << std::endl;
        }
    });
    EventBus::Instance().PublishString("test.event", "Hello from EventBus");

    std::cout << "\nAll header files compiled successfully!\n";
    return 0;
}
