// EventBus.h
// Developer: Marcus Daley
// Date: April 2026
// Purpose: Typed, decoupled event system with wildcard subscriptions and variant payload support

#pragma once

#include <string>
#include <functional>
#include <unordered_map>
#include <vector>
#include <mutex>
#include <variant>
#include <iostream>

class EventBus {
public:
    // Variant payload supporting multiple types
    using EventPayload = std::variant<std::monostate, std::string, int, float, void*>;
    using EventCallback = std::function<void(const EventPayload&)>;

    // Singleton accessor
    static EventBus& Instance() {
        static EventBus instance;
        return instance;
    }

    // Subscribe to an event and return subscription ID
    size_t Subscribe(const std::string& eventName, EventCallback callback) {
        std::lock_guard<std::mutex> lock(mMutex);

        size_t subscriptionId = mNextSubscriptionId++;
        mSubscriptions[eventName].emplace_back(subscriptionId, callback);

        std::cout << "[EVENT-BUS] Subscribed to '" << eventName << "' (ID: " << subscriptionId << ")\n";
        return subscriptionId;
    }

    // Unsubscribe using subscription ID
    void Unsubscribe(size_t subscriptionId) {
        std::lock_guard<std::mutex> lock(mMutex);

        for (auto& [eventName, subscribers] : mSubscriptions) {
            auto it = std::remove_if(subscribers.begin(), subscribers.end(),
                [subscriptionId](const Subscription& sub) {
                    return sub.id == subscriptionId;
                });

            if (it != subscribers.end()) {
                subscribers.erase(it, subscribers.end());
                std::cout << "[EVENT-BUS] Unsubscribed ID: " << subscriptionId << " from '" << eventName << "'\n";
                return;
            }
        }

        std::cerr << "[EVENT-BUS][WARN] Subscription ID " << subscriptionId << " not found\n";
    }

    // Publish an event to all subscribers
    void Publish(const std::string& eventName, const EventPayload& payload = std::monostate{}) {
        std::lock_guard<std::mutex> lock(mMutex);

        // Notify specific event subscribers
        auto it = mSubscriptions.find(eventName);
        if (it != mSubscriptions.end()) {
            for (const auto& sub : it->second) {
                try {
                    sub.callback(payload);
                } catch (const std::exception& e) {
                    std::cerr << "[EVENT-BUS][ERROR] Exception in subscriber for '" << eventName
                              << "': " << e.what() << "\n";
                } catch (...) {
                    std::cerr << "[EVENT-BUS][ERROR] Unknown exception in subscriber for '" << eventName << "'\n";
                }
            }
        }

        // Notify wildcard subscribers (for debugging)
        auto wildcardIt = mSubscriptions.find("*");
        if (wildcardIt != mSubscriptions.end()) {
            EventPayload debugPayload = eventName; // Pass event name to wildcard subscribers
            for (const auto& sub : wildcardIt->second) {
                try {
                    sub.callback(debugPayload);
                } catch (...) {
                    // Suppress wildcard errors to prevent spam
                }
            }
        }
    }

    // Helper methods for common payload types
    void PublishString(const std::string& eventName, const std::string& value) {
        Publish(eventName, value);
    }

    void PublishInt(const std::string& eventName, int value) {
        Publish(eventName, value);
    }

    void PublishFloat(const std::string& eventName, float value) {
        Publish(eventName, value);
    }

    void PublishVoid(const std::string& eventName) {
        Publish(eventName, std::monostate{});
    }

    // Prevent copy/move
    EventBus(const EventBus&) = delete;
    EventBus& operator=(const EventBus&) = delete;
    EventBus(EventBus&&) = delete;
    EventBus& operator=(EventBus&&) = delete;

private:
    struct Subscription {
        size_t id;
        EventCallback callback;

        Subscription(size_t i, EventCallback cb) : id(i), callback(cb) {}
    };

    EventBus() : mNextSubscriptionId(1) {
        InitializeEventCatalog();
    }

    // Document known events for reference (no enforcement)
    void InitializeEventCatalog() {
        // File system events
        mEventCatalog.push_back("file.dropped");
        mEventCatalog.push_back("file.loaded");
        mEventCatalog.push_back("file.error");

        // Asset events
        mEventCatalog.push_back("asset.selected");

        // Tool events
        mEventCatalog.push_back("tool.changed");

        // Camera events
        mEventCatalog.push_back("camera.updated");

        // Render events
        mEventCatalog.push_back("render.frame_start");
        mEventCatalog.push_back("render.frame_end");

        // Config events
        mEventCatalog.push_back("config.changed");

        std::cout << "[EVENT-BUS] Initialized with " << mEventCatalog.size() << " documented events\n";
    }

    // Member variables
    std::mutex mMutex;
    std::unordered_map<std::string, std::vector<Subscription>> mSubscriptions;
    std::vector<std::string> mEventCatalog;
    size_t mNextSubscriptionId;
};

// Event catalog documentation (reference only)
//
// file.dropped      - Payload: std::string (file path)
// file.loaded       - Payload: std::string (file path)
// file.error        - Payload: std::string (error message)
// asset.selected    - Payload: std::string (asset ID)
// tool.changed      - Payload: std::string (tool name)
// camera.updated    - Payload: void* (camera object pointer)
// render.frame_start - Payload: int (frame number)
// render.frame_end   - Payload: int (frame number)
// config.changed    - Payload: std::string (config key)
