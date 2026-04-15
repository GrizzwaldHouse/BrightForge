/** StatusBar.h - Bottom status bar with tool info, stats, and messages
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "../core/EventBus.h"
#include <string>
#include <chrono>
#include <queue>

namespace BrightForge {
namespace UI {

// Status message severity levels
enum class MessageSeverity {
    INFO,
    WARNING,
    ERROR,
    SUCCESS
};

// Status message for display
struct StatusMessage {
    std::string text;
    MessageSeverity severity;
    std::chrono::steady_clock::time_point timestamp;
    float displayDuration;
    bool fading;

    StatusMessage()
        : severity(MessageSeverity::INFO)
        , displayDuration(3.0f)
        , fading(false)
    {}

    StatusMessage(const std::string& t, MessageSeverity s, float duration = 3.0f)
        : text(t)
        , severity(s)
        , timestamp(std::chrono::steady_clock::now())
        , displayDuration(duration)
        , fading(false)
    {}
};

// Progress bar state
struct ProgressState {
    float progress; // 0.0 to 1.0
    std::string label;
    bool visible;

    ProgressState()
        : progress(0.0f)
        , visible(false)
    {}
};

class StatusBar {
public:
    StatusBar(Core::EventBus& eventBus, float height = 24.0f);
    ~StatusBar();

    // Status display
    void SetToolName(const std::string& name);
    void SetSelectionCount(int count);
    void SetFPS(float fps);
    void SetMemoryUsage(size_t bytes);

    // Message queue
    void ShowMessage(const std::string& text, MessageSeverity severity = MessageSeverity::INFO,
                     float duration = 3.0f);
    void ClearMessages();

    // Progress bar
    void ShowProgress(const std::string& label, float progress);
    void HideProgress();
    void SetProgress(float progress);

    // Visual state
    float GetHeight() const { return m_height; }
    Rect GetBounds(float windowWidth, float windowHeight) const;
    void SetWidth(float width) { m_width = width; }
    Color GetMessageColor() const;
    float GetMessageOpacity() const;

    // Update method
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    float m_height;
    float m_width;

    // Status info
    std::string m_currentTool;
    int m_selectionCount;
    float m_fps;
    size_t m_memoryUsageBytes;

    // Message queue
    std::queue<StatusMessage> m_messageQueue;
    StatusMessage m_currentMessage;
    bool m_hasMessage;
    float m_messageOpacity;

    // Progress bar
    ProgressState m_progress;

    // Event subscriptions
    size_t m_toolChangedSubscription;
    size_t m_renderFrameEndSubscription;
    size_t m_fileErrorSubscription;

    // Internal helpers
    void ProcessMessageQueue(float deltaTime);
    void UpdateMessageFade(float deltaTime);
    void OnToolChanged(const Core::Event& event);
    void OnRenderFrameEnd(const Core::Event& event);
    void OnFileError(const Core::Event& event);
    std::string FormatMemorySize(size_t bytes) const;
    std::string GetToolDisplayName(ToolType tool) const;

    // Timing constants
    static constexpr float MESSAGE_FADE_DURATION = 0.5f;
    static constexpr float MESSAGE_FLASH_SPEED = 3.0f;
    static constexpr float ERROR_DISPLAY_DURATION = 5.0f;
    static constexpr float WARNING_DISPLAY_DURATION = 4.0f;
    static constexpr float INFO_DISPLAY_DURATION = 3.0f;
    static constexpr float SUCCESS_DISPLAY_DURATION = 2.0f;
};

// Implementation

inline StatusBar::StatusBar(Core::EventBus& eventBus, float height)
    : m_eventBus(eventBus)
    , m_height(height)
    , m_width(1920.0f)
    , m_currentTool("Select")
    , m_selectionCount(0)
    , m_fps(0.0f)
    , m_memoryUsageBytes(0)
    , m_hasMessage(false)
    , m_messageOpacity(0.0f)
{
    // Subscribe to relevant events
    m_toolChangedSubscription = m_eventBus.Subscribe("tool.changed",
        [this](const Core::Event& e) { OnToolChanged(e); });

    m_renderFrameEndSubscription = m_eventBus.Subscribe("render.frame_end",
        [this](const Core::Event& e) { OnRenderFrameEnd(e); });

    m_fileErrorSubscription = m_eventBus.Subscribe("file.error",
        [this](const Core::Event& e) { OnFileError(e); });
}

inline StatusBar::~StatusBar() {
    m_eventBus.Unsubscribe("tool.changed", m_toolChangedSubscription);
    m_eventBus.Unsubscribe("render.frame_end", m_renderFrameEndSubscription);
    m_eventBus.Unsubscribe("file.error", m_fileErrorSubscription);
}

inline void StatusBar::SetToolName(const std::string& name) {
    m_currentTool = name;
}

inline void StatusBar::SetSelectionCount(int count) {
    m_selectionCount = count;
}

inline void StatusBar::SetFPS(float fps) {
    m_fps = fps;
}

inline void StatusBar::SetMemoryUsage(size_t bytes) {
    m_memoryUsageBytes = bytes;
}

inline void StatusBar::ShowMessage(const std::string& text, MessageSeverity severity, float duration) {
    // Guard: skip empty messages
    if (text.empty()) {
        return;
    }

    // Adjust duration based on severity
    float displayDuration = duration;
    if (duration <= 0.0f) {
        switch (severity) {
            case MessageSeverity::ERROR:
                displayDuration = ERROR_DISPLAY_DURATION;
                break;
            case MessageSeverity::WARNING:
                displayDuration = WARNING_DISPLAY_DURATION;
                break;
            case MessageSeverity::SUCCESS:
                displayDuration = SUCCESS_DISPLAY_DURATION;
                break;
            default:
                displayDuration = INFO_DISPLAY_DURATION;
                break;
        }
    }

    StatusMessage msg(text, severity, displayDuration);
    m_messageQueue.push(msg);
}

inline void StatusBar::ClearMessages() {
    while (!m_messageQueue.empty()) {
        m_messageQueue.pop();
    }
    m_hasMessage = false;
    m_messageOpacity = 0.0f;
}

inline void StatusBar::ShowProgress(const std::string& label, float progress) {
    m_progress.label = label;
    m_progress.progress = std::max(0.0f, std::min(1.0f, progress));
    m_progress.visible = true;
}

inline void StatusBar::HideProgress() {
    m_progress.visible = false;
    m_progress.progress = 0.0f;
    m_progress.label.clear();
}

inline void StatusBar::SetProgress(float progress) {
    m_progress.progress = std::max(0.0f, std::min(1.0f, progress));
}

inline Rect StatusBar::GetBounds(float windowWidth, float windowHeight) const {
    return Rect(0.0f, windowHeight - m_height, windowWidth, m_height);
}

inline Color StatusBar::GetMessageColor() const {
    if (!m_hasMessage) {
        return Colors::TEXT_SECONDARY;
    }

    switch (m_currentMessage.severity) {
        case MessageSeverity::ERROR:
            return Colors::DANGER;
        case MessageSeverity::WARNING:
            return Colors::WARNING;
        case MessageSeverity::SUCCESS:
            return Colors::SUCCESS;
        default:
            return Colors::INFO;
    }
}

inline float StatusBar::GetMessageOpacity() const {
    return m_messageOpacity;
}

inline void StatusBar::Update(float deltaTime) {
    ProcessMessageQueue(deltaTime);
    UpdateMessageFade(deltaTime);
}

inline void StatusBar::ProcessMessageQueue(float deltaTime) {
    if (!m_hasMessage && !m_messageQueue.empty()) {
        // Start displaying next message
        m_currentMessage = m_messageQueue.front();
        m_messageQueue.pop();
        m_hasMessage = true;
        m_messageOpacity = 1.0f;
        m_currentMessage.fading = false;
    }

    if (m_hasMessage) {
        auto now = std::chrono::steady_clock::now();
        float elapsed = std::chrono::duration<float>(now - m_currentMessage.timestamp).count();

        // Start fading when display duration is reached
        if (elapsed >= m_currentMessage.displayDuration && !m_currentMessage.fading) {
            m_currentMessage.fading = true;
        }
    }
}

inline void StatusBar::UpdateMessageFade(float deltaTime) {
    if (!m_hasMessage) {
        return;
    }

    if (m_currentMessage.fading) {
        m_messageOpacity -= deltaTime / MESSAGE_FADE_DURATION;

        if (m_messageOpacity <= 0.0f) {
            m_messageOpacity = 0.0f;
            m_hasMessage = false;
        }
    } else if (m_currentMessage.severity == MessageSeverity::ERROR) {
        // Flash effect for errors
        float flash = std::sin(m_messageOpacity * MESSAGE_FLASH_SPEED);
        m_messageOpacity = 0.7f + flash * 0.3f;
    }
}

inline void StatusBar::OnToolChanged(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    int toolType = data.GetInt("tool");
    m_currentTool = GetToolDisplayName(static_cast<ToolType>(toolType));
}

inline void StatusBar::OnRenderFrameEnd(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    m_fps = data.GetFloat("fps");
    m_memoryUsageBytes = static_cast<size_t>(data.GetInt("memoryUsage"));
}

inline void StatusBar::OnFileError(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    std::string errorMessage = data.GetString("message");
    ShowMessage(errorMessage, MessageSeverity::ERROR);
}

inline std::string StatusBar::FormatMemorySize(size_t bytes) const {
    const char* units[] = {"B", "KB", "MB", "GB"};
    int unitIndex = 0;
    double size = static_cast<double>(bytes);

    while (size >= 1024.0 && unitIndex < 3) {
        size /= 1024.0;
        unitIndex++;
    }

    char buffer[64];
    snprintf(buffer, sizeof(buffer), "%.1f %s", size, units[unitIndex]);
    return std::string(buffer);
}

inline std::string StatusBar::GetToolDisplayName(ToolType tool) const {
    switch (tool) {
        case ToolType::SELECT:
            return "Select";
        case ToolType::MOVE:
            return "Move";
        case ToolType::ROTATE:
            return "Rotate";
        case ToolType::SCALE:
            return "Scale";
        case ToolType::SCULPT_SMOOTH:
            return "Sculpt: Smooth";
        case ToolType::SCULPT_INFLATE:
            return "Sculpt: Inflate";
        case ToolType::SCULPT_PINCH:
            return "Sculpt: Pinch";
        case ToolType::SCULPT_FLATTEN:
            return "Sculpt: Flatten";
        case ToolType::SCULPT_GRAB:
            return "Sculpt: Grab";
        case ToolType::SCULPT_CREASE:
            return "Sculpt: Crease";
        case ToolType::PAINT:
            return "Paint";
        case ToolType::MEASURE:
            return "Measure";
        case ToolType::ANNOTATE:
            return "Annotate";
        default:
            return "Unknown";
    }
}

} // namespace UI
} // namespace BrightForge
