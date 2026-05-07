// ============================================================================
// EventBus.h - BrightForge Engine Decoupled Communication System
// ============================================================================
// PURPOSE:  Allows any engine subsystem to communicate with any other
//           subsystem without knowing it exists. Rendering does not include
//           UI headers. UI does not include rendering headers. They both
//           just post and listen for events through this bus.
//
// USAGE:
//   EventBus& bus = EventBus::Instance();
//   int subId = bus.Subscribe("file.loaded", [](const EventPayload& p) {
//       std::string path = std::get<std::string>(p.data);
//   });
//   bus.Publish("file.loaded", EventPayload::String("model.gltf"));
//
// THREAD SAFETY: All public methods are mutex-protected.
// ============================================================================
#pragma once

#include <string>
#include <functional>
#include <unordered_map>
#include <vector>
#include <variant>
#include <mutex>
#include <atomic>
#include <iostream>

// ============================================================================
// CONFIGURABLE CONSTANTS
// ============================================================================
namespace EventBusConfig {
    // Maximum subscribers per event name (guard against leaks)
    static constexpr int MAX_SUBSCRIBERS_PER_EVENT = 50;

    // Enable event trace logging (posts every event to console)
    static bool TRACE_EVENTS = false;
}

// ============================================================================
// EventPayload - Variant-typed data attached to an event
// ============================================================================
struct EventPayload {
    // The data can be one of these types
    std::variant<std::monostate, std::string, int, float, double, void*> data;

    // Factory methods for clean construction
    static EventPayload None()                          { return { std::monostate{} }; }
    static EventPayload String(const std::string& s)    { return { s }; }
    static EventPayload Int(int i)                      { return { i }; }
    static EventPayload Float(float f)                  { return { f }; }
    static EventPayload Double(double d)                { return { d }; }
    static EventPayload Pointer(void* p)                { return { p }; }

    // Type-safe getters with fallback defaults
    std::string GetString(const std::string& fallback = "") const {
        if (auto* val = std::get_if<std::string>(&data)) return *val;
        return fallback;
    }
    int GetInt(int fallback = 0) const {
        if (auto* val = std::get_if<int>(&data)) return *val;
        return fallback;
    }
    float GetFloat(float fallback = 0.0f) const {
        if (auto* val = std::get_if<float>(&data)) return *val;
        return fallback;
    }
    double GetDouble(double fallback = 0.0) const {
        if (auto* val = std::get_if<double>(&data)) return *val;
        return fallback;
    }
    void* GetPointer(void* fallback = nullptr) const {
        if (auto* val = std::get_if<void*>(&data)) return *val;
        return fallback;
    }
};

// Callback type: receives the event name and payload
using EventCallback = std::function<void(const std::string& eventName,
                                          const EventPayload& payload)>;

// ============================================================================
// Subscription - Internal record of a subscriber
// ============================================================================
struct Subscription {
    int id;
    std::string eventName;    // The event this subscription listens to
    EventCallback callback;
    bool active;              // Can be deactivated without removal
};

// ============================================================================
// EventBus Class (Singleton)
// ============================================================================
class EventBus {
private:
    // Map from event name to list of subscriptions
    std::unordered_map<std::string, std::vector<Subscription>> mSubscriptions;

    // Wildcard subscribers (receive ALL events, used for debug tracing)
    std::vector<Subscription> mWildcardSubscriptions;

    // Auto-incrementing subscription ID
    std::atomic<int> mNextId;

    // Thread safety
    mutable std::mutex mMutex;

    // Private constructor for singleton
    EventBus() : mNextId(1) {}

public:
    // -----------------------------------------------------------------
    // Instance - Singleton accessor
    // -----------------------------------------------------------------
    static EventBus& Instance() {
        static EventBus instance;
        return instance;
    }

    // Delete copy/move
    EventBus(const EventBus&) = delete;
    EventBus& operator=(const EventBus&) = delete;

    // -----------------------------------------------------------------
    // Subscribe - Register a callback for a specific event name
    //   Use "*" for wildcard (receives all events)
    //   RETURNS: Subscription ID for later unsubscribe
    // -----------------------------------------------------------------
    int Subscribe(const std::string& eventName, EventCallback callback) {
        std::lock_guard<std::mutex> lock(mMutex);

        int id = mNextId.fetch_add(1);

        Subscription sub;
        sub.id = id;
        sub.eventName = eventName;
        sub.callback = callback;
        sub.active = true;

        if (eventName == "*") {
            mWildcardSubscriptions.push_back(sub);
        } else {
            auto& subs = mSubscriptions[eventName];

            // Guard clause: check for subscription leak
            if (static_cast<int>(subs.size()) >= EventBusConfig::MAX_SUBSCRIBERS_PER_EVENT) {
                std::cerr << "[EventBus] WARNING: Max subscribers reached for '"
                          << eventName << "'. Possible subscription leak!" << std::endl;
                return -1;
            }

            subs.push_back(sub);
        }

        return id;
    }

    // -----------------------------------------------------------------
    // Unsubscribe - Remove a subscription by its ID
    //   RETURNS: true if found and removed, false if not found
    // -----------------------------------------------------------------
    bool Unsubscribe(int subscriptionId) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Check wildcards first
        for (auto it = mWildcardSubscriptions.begin();
             it != mWildcardSubscriptions.end(); ++it) {
            if (it->id == subscriptionId) {
                mWildcardSubscriptions.erase(it);
                return true;
            }
        }

        // Check named subscriptions
        for (auto& pair : mSubscriptions) {
            auto& subs = pair.second;
            for (auto it = subs.begin(); it != subs.end(); ++it) {
                if (it->id == subscriptionId) {
                    subs.erase(it);
                    return true;
                }
            }
        }

        return false;
    }

    // -----------------------------------------------------------------
    // Publish - Fire an event to all matching subscribers
    //   Exceptions in callbacks are caught and logged, not propagated.
    // -----------------------------------------------------------------
    void Publish(const std::string& eventName,
                 const EventPayload& payload = EventPayload::None()) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Trace logging (for development debugging)
        if (EventBusConfig::TRACE_EVENTS) {
            std::cout << "[EventBus TRACE] " << eventName << std::endl;
        }

        // Deliver to named subscribers
        auto it = mSubscriptions.find(eventName);
        if (it != mSubscriptions.end()) {
            for (auto& sub : it->second) {
                if (!sub.active) continue;
                try {
                    sub.callback(eventName, payload);
                } catch (const std::exception& e) {
                    std::cerr << "[EventBus] Exception in subscriber "
                              << sub.id << " for '" << eventName
                              << "': " << e.what() << std::endl;
                } catch (...) {
                    std::cerr << "[EventBus] Unknown exception in subscriber "
                              << sub.id << " for '" << eventName << "'"
                              << std::endl;
                }
            }
        }

        // Deliver to wildcard subscribers
        for (auto& sub : mWildcardSubscriptions) {
            if (!sub.active) continue;
            try {
                sub.callback(eventName, payload);
            } catch (...) {
                // Swallow wildcard subscriber exceptions
            }
        }
    }

    // -----------------------------------------------------------------
    // SetSubscriptionActive - Temporarily enable/disable without removing
    // -----------------------------------------------------------------
    void SetSubscriptionActive(int subscriptionId, bool active) {
        std::lock_guard<std::mutex> lock(mMutex);

        for (auto& sub : mWildcardSubscriptions) {
            if (sub.id == subscriptionId) { sub.active = active; return; }
        }
        for (auto& pair : mSubscriptions) {
            for (auto& sub : pair.second) {
                if (sub.id == subscriptionId) { sub.active = active; return; }
            }
        }
    }

    // -----------------------------------------------------------------
    // GetSubscriberCount - Returns how many active subscribers exist
    //                      for a given event name.
    // -----------------------------------------------------------------
    int GetSubscriberCount(const std::string& eventName) const {
        std::lock_guard<std::mutex> lock(mMutex);

        if (eventName == "*") {
            return static_cast<int>(mWildcardSubscriptions.size());
        }

        auto it = mSubscriptions.find(eventName);
        if (it == mSubscriptions.end()) return 0;

        int count = 0;
        for (const auto& sub : it->second) {
            if (sub.active) count++;
        }
        return count;
    }

    // -----------------------------------------------------------------
    // ClearAll - Remove every subscription. Use during shutdown.
    // -----------------------------------------------------------------
    void ClearAll() {
        std::lock_guard<std::mutex> lock(mMutex);
        mSubscriptions.clear();
        mWildcardSubscriptions.clear();
    }

    // -----------------------------------------------------------------
    // PrintStats - Dump subscription counts per event name
    // -----------------------------------------------------------------
    void PrintStats() const {
        std::lock_guard<std::mutex> lock(mMutex);

        std::cout << "\n===== EventBus Stats =====" << std::endl;
        std::cout << "Wildcard subscribers: "
                  << mWildcardSubscriptions.size() << std::endl;

        for (const auto& pair : mSubscriptions) {
            int activeCount = 0;
            for (const auto& sub : pair.second) {
                if (sub.active) activeCount++;
            }
            std::cout << "  [" << pair.first << "] "
                      << activeCount << " active / "
                      << pair.second.size() << " total" << std::endl;
        }
        std::cout << "==========================" << std::endl;
    }
};

// ============================================================================
// EventBus Test Suite - Validates all EventBus functionality
// ============================================================================
namespace EventBusTests {
    inline bool RunAll() {
        std::cout << "\n===== EventBus Test Suite =====" << std::endl;
        bool allPassed = true;

        // Test 1: Subscribe and publish
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            bool received = false;
            std::string receivedData;

            int subId = bus.Subscribe("test.event",
                [&](const std::string& _name, const EventPayload& p) {
                    received = true;
                    receivedData = p.GetString();
                });

            bus.Publish("test.event", EventPayload::String("hello"));

            bool passed = received && (receivedData == "hello") && (subId > 0);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Subscribe and publish" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 2: Unsubscribe stops delivery
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            int callCount = 0;

            int subId = bus.Subscribe("test.unsub",
                [&](const std::string&, const EventPayload&) { callCount++; });

            bus.Publish("test.unsub");
            bus.Unsubscribe(subId);
            bus.Publish("test.unsub");

            bool passed = (callCount == 1);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Unsubscribe stops delivery" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 3: Multiple subscribers
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            int countA = 0, countB = 0;

            bus.Subscribe("test.multi",
                [&](const std::string&, const EventPayload&) { countA++; });
            bus.Subscribe("test.multi",
                [&](const std::string&, const EventPayload&) { countB++; });

            bus.Publish("test.multi");

            bool passed = (countA == 1 && countB == 1);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Multiple subscribers both receive" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 4: Wildcard receives all events
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            int wildcardCount = 0;

            bus.Subscribe("*",
                [&](const std::string&, const EventPayload&) { wildcardCount++; });

            bus.Publish("event.alpha");
            bus.Publish("event.beta");
            bus.Publish("event.gamma");

            bool passed = (wildcardCount == 3);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Wildcard receives all events" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 5: Payload type safety
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            std::string gotString;
            int gotInt = -1;

            bus.Subscribe("test.types",
                [&](const std::string&, const EventPayload& p) {
                    gotString = p.GetString("default");
                    gotInt = p.GetInt(-1);
                });

            bus.Publish("test.types", EventPayload::String("actual"));

            bool passed = (gotString == "actual") && (gotInt == -1);
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Payload type safety with fallbacks" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        // Test 6: Exception in subscriber does not break others
        {
            EventBus& bus = EventBus::Instance();
            bus.ClearAll();
            bool secondCalled = false;

            bus.Subscribe("test.exception",
                [](const std::string&, const EventPayload&) {
                    throw std::runtime_error("intentional test exception");
                });
            bus.Subscribe("test.exception",
                [&](const std::string&, const EventPayload&) {
                    secondCalled = true;
                });

            bus.Publish("test.exception");

            bool passed = secondCalled;
            std::cout << (passed ? "  PASS" : "  FAIL")
                      << " - Exception does not break other subscribers" << std::endl;
            allPassed &= passed;
            bus.ClearAll();
        }

        std::cout << "\n===== EventBus: "
                  << (allPassed ? "ALL PASSED" : "SOME FAILED")
                  << " =====" << std::endl;
        return allPassed;
    }
}
