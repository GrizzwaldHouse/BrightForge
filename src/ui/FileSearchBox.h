/** FileSearchBox.h - Text input component for asset search and filtering
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "../core/EventBus.h"
#include <string>
#include <chrono>
#include <unordered_set>

namespace BrightForge {
namespace UI {

class FileSearchBox {
public:
    FileSearchBox(Core::EventBus& eventBus, const Rect& bounds);
    ~FileSearchBox();

    // Text input management
    void SetQuery(const std::string& text);
    std::string GetQuery() const { return m_query; }
    void ClearQuery();

    // Type filtering (e.g., "type:mesh", "type:texture")
    void SetTypeFilter(const std::string& format);
    void ClearFilter();
    std::string GetTypeFilter() const { return m_typeFilter; }
    bool HasActiveFilter() const { return !m_typeFilter.empty(); }

    // Focus management
    void OnFocus();
    void OnBlur();
    bool IsFocused() const { return m_focused; }

    // Input event handlers
    void OnTextInput(const std::string& text);
    void OnKeyDown(int keyCode);
    void OnBackspace();
    void OnClear();

    // Visual state accessors
    const Rect& GetBounds() const { return m_bounds; }
    void SetBounds(const Rect& bounds) { m_bounds = bounds; }
    ComponentState GetState() const { return m_state; }
    Color GetBorderColor() const;
    float GetCursorBlinkPhase() const;

    // Update for debouncing and animations
    void Update(float deltaTime);

    // Configuration
    void SetDebounceDelay(float seconds) { m_debounceDelaySeconds = seconds; }
    void SetPlaceholderText(const std::string& text) { m_placeholderText = text; }
    std::string GetPlaceholderText() const;

private:
    Core::EventBus& m_eventBus;
    Rect m_bounds;
    ComponentState m_state;

    // Search query state
    std::string m_query;
    std::string m_typeFilter;
    std::string m_placeholderText;
    bool m_focused;

    // Debouncing for search queries
    float m_timeSinceLastInput;
    float m_debounceDelaySeconds;
    bool m_pendingQuery;
    std::string m_lastPublishedQuery;

    // Cursor animation
    float m_cursorBlinkTimer;
    bool m_cursorVisible;

    // Event subscription IDs
    size_t m_indexUpdatedSubscription;

    // Internal helpers
    void PublishSearchQuery();
    void UpdateState();
    void OnIndexUpdated(const Core::Event& event);
    bool IsSpecialKey(int keyCode) const;

    // Keyboard shortcut constants
    static constexpr int KEY_F = 70;
    static constexpr int KEY_CTRL = 17;
    static constexpr int KEY_ESCAPE = 27;
    static constexpr int KEY_BACKSPACE = 8;
    static constexpr int KEY_DELETE = 46;

    // Timing constants
    static constexpr float DEFAULT_DEBOUNCE_DELAY = 0.2f; // 200ms
    static constexpr float CURSOR_BLINK_RATE = 1.0f; // 1 second cycle
};

// Implementation

inline FileSearchBox::FileSearchBox(Core::EventBus& eventBus, const Rect& bounds)
    : m_eventBus(eventBus)
    , m_bounds(bounds)
    , m_state(ComponentState::IDLE)
    , m_placeholderText("Search assets...")
    , m_focused(false)
    , m_timeSinceLastInput(0.0f)
    , m_debounceDelaySeconds(DEFAULT_DEBOUNCE_DELAY)
    , m_pendingQuery(false)
    , m_cursorBlinkTimer(0.0f)
    , m_cursorVisible(true)
{
    // Subscribe to index updates to know when results may change
    m_indexUpdatedSubscription = m_eventBus.Subscribe("index.updated",
        [this](const Core::Event& e) { OnIndexUpdated(e); });
}

inline FileSearchBox::~FileSearchBox() {
    m_eventBus.Unsubscribe("index.updated", m_indexUpdatedSubscription);
}

inline void FileSearchBox::SetQuery(const std::string& text) {
    if (m_query == text) {
        return; // no change
    }

    m_query = text;
    m_timeSinceLastInput = 0.0f;
    m_pendingQuery = true;
    UpdateState();
}

inline void FileSearchBox::ClearQuery() {
    SetQuery("");
}

inline void FileSearchBox::SetTypeFilter(const std::string& format) {
    if (m_typeFilter == format) {
        return; // no change
    }

    m_typeFilter = format;
    m_timeSinceLastInput = 0.0f;
    m_pendingQuery = true;
    UpdateState();
}

inline void FileSearchBox::ClearFilter() {
    SetTypeFilter("");
}

inline void FileSearchBox::OnFocus() {
    m_focused = true;
    m_state = ComponentState::FOCUSED;
    m_cursorVisible = true;
    m_cursorBlinkTimer = 0.0f;

    Core::EventData data;
    data.SetString("component", "FileSearchBox");
    m_eventBus.Publish("ui.focus", data);
}

inline void FileSearchBox::OnBlur() {
    m_focused = false;
    UpdateState();

    Core::EventData data;
    data.SetString("component", "FileSearchBox");
    m_eventBus.Publish("ui.blur", data);
}

inline void FileSearchBox::OnTextInput(const std::string& text) {
    if (!m_focused) {
        return;
    }

    m_query += text;
    m_timeSinceLastInput = 0.0f;
    m_pendingQuery = true;
    m_cursorVisible = true;
    m_cursorBlinkTimer = 0.0f;
}

inline void FileSearchBox::OnKeyDown(int keyCode) {
    if (!m_focused) {
        // Handle global shortcuts even when not focused
        if (keyCode == KEY_F) {
            // Ctrl+F shortcut to focus
            OnFocus();
        }
        return;
    }

    if (keyCode == KEY_ESCAPE) {
        OnBlur();
    } else if (keyCode == KEY_BACKSPACE) {
        OnBackspace();
    } else if (keyCode == KEY_DELETE) {
        OnClear();
    }
}

inline void FileSearchBox::OnBackspace() {
    if (!m_query.empty()) {
        m_query.pop_back();
        m_timeSinceLastInput = 0.0f;
        m_pendingQuery = true;
        m_cursorVisible = true;
        m_cursorBlinkTimer = 0.0f;
    }
}

inline void FileSearchBox::OnClear() {
    ClearQuery();
    ClearFilter();
}

inline Color FileSearchBox::GetBorderColor() const {
    switch (m_state) {
        case ComponentState::FOCUSED:
            return Colors::BORDER_ACTIVE;
        case ComponentState::HOVER:
            return Colors::BORDER_HOVER;
        case ComponentState::DISABLED:
            return Colors::BORDER_DEFAULT;
        default:
            return Colors::BORDER_DEFAULT;
    }
}

inline float FileSearchBox::GetCursorBlinkPhase() const {
    if (!m_focused || !m_cursorVisible) {
        return 0.0f;
    }
    return 1.0f;
}

inline std::string FileSearchBox::GetPlaceholderText() const {
    if (!m_query.empty()) {
        return "";
    }

    if (!m_typeFilter.empty()) {
        return "Filtering: " + m_typeFilter;
    }

    return m_placeholderText;
}

inline void FileSearchBox::Update(float deltaTime) {
    // Debounce timer
    if (m_pendingQuery) {
        m_timeSinceLastInput += deltaTime;
        if (m_timeSinceLastInput >= m_debounceDelaySeconds) {
            PublishSearchQuery();
            m_pendingQuery = false;
        }
    }

    // Cursor blink animation
    if (m_focused) {
        m_cursorBlinkTimer += deltaTime;
        if (m_cursorBlinkTimer >= CURSOR_BLINK_RATE) {
            m_cursorVisible = !m_cursorVisible;
            m_cursorBlinkTimer = 0.0f;
        }
    }
}

inline void FileSearchBox::PublishSearchQuery() {
    // Guard: don't republish identical query
    if (m_query == m_lastPublishedQuery && m_typeFilter.empty()) {
        return;
    }

    m_lastPublishedQuery = m_query;

    Core::EventData data;
    data.SetString("query", m_query);
    data.SetString("typeFilter", m_typeFilter);
    data.SetBool("hasFilter", !m_typeFilter.empty());
    data.SetInt("queryLength", static_cast<int>(m_query.length()));

    m_eventBus.Publish("search.query", data);

    // Log search event
    if (!m_query.empty() || !m_typeFilter.empty()) {
        Core::EventData logData;
        logData.SetString("message", "Search query: " + m_query +
                          (m_typeFilter.empty() ? "" : " [Filter: " + m_typeFilter + "]"));
        logData.SetString("level", "INFO");
        m_eventBus.Publish("log.message", logData);
    }
}

inline void FileSearchBox::UpdateState() {
    if (m_focused) {
        m_state = ComponentState::FOCUSED;
    } else if (!m_query.empty() || !m_typeFilter.empty()) {
        m_state = ComponentState::ACTIVE;
    } else {
        m_state = ComponentState::IDLE;
    }
}

inline void FileSearchBox::OnIndexUpdated(const Core::Event& event) {
    // Refresh search results when index changes
    if (!m_query.empty() || !m_typeFilter.empty()) {
        m_timeSinceLastInput = 0.0f;
        m_pendingQuery = true;
    }
}

inline bool FileSearchBox::IsSpecialKey(int keyCode) const {
    return keyCode == KEY_ESCAPE || keyCode == KEY_BACKSPACE ||
           keyCode == KEY_DELETE || keyCode == KEY_CTRL;
}

} // namespace UI
} // namespace BrightForge
