/** DragDropZone.h - Handles OS-level drag-and-drop file operations
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "../core/EventBus.h"
#include <string>
#include <vector>
#include <unordered_set>
#include <chrono>

namespace BrightForge {
namespace UI {

// States for drag-drop lifecycle tracking
enum class DragDropState {
    IDLE,
    DRAG_HOVER,
    LOADING,
    SUCCESS,
    ERROR
};

class DragDropZone {
public:
    // Constructor requires EventBus for all communication and bounds for hit testing
    DragDropZone(Core::EventBus& eventBus, const Rect& bounds);
    ~DragDropZone();

    // OS drag-drop event handlers
    void OnDragEnter();
    void OnDrop(const std::vector<std::string>& paths);
    void OnDragLeave();

    // State queries
    bool IsLoading() const { return m_state == DragDropState::LOADING; }
    DragDropState GetState() const { return m_state; }
    const Rect& GetBounds() const { return m_bounds; }

    // Configuration
    void SetBounds(const Rect& bounds) { m_bounds = bounds; }
    void SetMaxQueueSize(size_t maxSize) { m_maxQueueSize = maxSize; }
    void AddSupportedExtension(const std::string& ext);
    void ClearSupportedExtensions();

    // Visual feedback accessors for renderer
    Color GetBorderColor() const;
    float GetBorderWidth() const;
    float GetOpacity() const;

    // Update method for animation states
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    Rect m_bounds;
    DragDropState m_state;

    // Supported file extensions (e.g., ".obj", ".fbx", ".gltf")
    std::unordered_set<std::string> m_supportedExtensions;

    // Drop queue for handling multiple files dropped simultaneously
    std::vector<std::string> m_dropQueue;
    size_t m_maxQueueSize;
    size_t m_currentLoadIndex;

    // Visual feedback state
    float m_hoverAnimationTime;
    float m_successFeedbackTimer;
    float m_errorFeedbackTimer;
    std::string m_lastErrorMessage;

    // Event subscription IDs for cleanup
    size_t m_fileLoadedSubscription;
    size_t m_fileErrorSubscription;

    // Internal helpers
    void SetState(DragDropState newState);
    bool IsExtensionSupported(const std::string& path) const;
    std::string GetFileExtension(const std::string& path) const;
    bool ValidatePath(const std::string& path) const;
    void ProcessNextInQueue();
    void OnFileLoaded(const Core::Event& event);
    void OnFileError(const Core::Event& event);
    void LogDrop(const std::string& path, bool accepted);

    // Constants for feedback timing
    static constexpr float HOVER_ANIMATION_SPEED = 3.0f;
    static constexpr float SUCCESS_FEEDBACK_DURATION = 1.5f;
    static constexpr float ERROR_FEEDBACK_DURATION = 3.0f;
    static constexpr float BORDER_GLOW_INTENSITY = 0.3f;
    static constexpr size_t DEFAULT_MAX_QUEUE_SIZE = 10;
};

// Implementation

inline DragDropZone::DragDropZone(Core::EventBus& eventBus, const Rect& bounds)
    : m_eventBus(eventBus)
    , m_bounds(bounds)
    , m_state(DragDropState::IDLE)
    , m_maxQueueSize(DEFAULT_MAX_QUEUE_SIZE)
    , m_currentLoadIndex(0)
    , m_hoverAnimationTime(0.0f)
    , m_successFeedbackTimer(0.0f)
    , m_errorFeedbackTimer(0.0f)
{
    // Default supported 3D formats
    m_supportedExtensions.insert(".obj");
    m_supportedExtensions.insert(".fbx");
    m_supportedExtensions.insert(".gltf");
    m_supportedExtensions.insert(".glb");
    m_supportedExtensions.insert(".stl");
    m_supportedExtensions.insert(".dae");
    m_supportedExtensions.insert(".ply");

    // Subscribe to file service events
    m_fileLoadedSubscription = m_eventBus.Subscribe("file.loaded",
        [this](const Core::Event& e) { OnFileLoaded(e); });

    m_fileErrorSubscription = m_eventBus.Subscribe("file.error",
        [this](const Core::Event& e) { OnFileError(e); });
}

inline DragDropZone::~DragDropZone() {
    m_eventBus.Unsubscribe("file.loaded", m_fileLoadedSubscription);
    m_eventBus.Unsubscribe("file.error", m_fileErrorSubscription);
}

inline void DragDropZone::OnDragEnter() {
    if (m_state == DragDropState::LOADING) {
        return; // ignore hover while processing
    }

    SetState(DragDropState::DRAG_HOVER);
    m_hoverAnimationTime = 0.0f;
}

inline void DragDropZone::OnDrop(const std::vector<std::string>& paths) {
    // Guard: reject if already loading
    if (m_state == DragDropState::LOADING) {
        LogDrop("", false);
        return;
    }

    // Guard: reject empty drop
    if (paths.empty()) {
        LogDrop("", false);
        return;
    }

    // Clear existing queue and reset
    m_dropQueue.clear();
    m_currentLoadIndex = 0;

    // Validate and filter paths
    for (const auto& path : paths) {
        // Guard: validate path is not empty
        if (path.empty()) {
            LogDrop(path, false);
            continue;
        }

        // Guard: validate extension
        if (!IsExtensionSupported(path)) {
            LogDrop(path, false);
            continue;
        }

        // Guard: validate path exists
        if (!ValidatePath(path)) {
            LogDrop(path, false);
            continue;
        }

        // Guard: enforce queue size limit
        if (m_dropQueue.size() >= m_maxQueueSize) {
            LogDrop(path, false);
            break;
        }

        m_dropQueue.push_back(path);
        LogDrop(path, true);
    }

    // Start processing queue
    if (!m_dropQueue.empty()) {
        SetState(DragDropState::LOADING);
        ProcessNextInQueue();
    }
}

inline void DragDropZone::OnDragLeave() {
    if (m_state == DragDropState::DRAG_HOVER) {
        SetState(DragDropState::IDLE);
    }
}

inline void DragDropZone::AddSupportedExtension(const std::string& ext) {
    m_supportedExtensions.insert(ext);
}

inline void DragDropZone::ClearSupportedExtensions() {
    m_supportedExtensions.clear();
}

inline Color DragDropZone::GetBorderColor() const {
    switch (m_state) {
        case DragDropState::DRAG_HOVER:
            return Colors::BORDER_ACTIVE;
        case DragDropState::LOADING:
            return Colors::INFO;
        case DragDropState::SUCCESS:
            return Colors::SUCCESS;
        case DragDropState::ERROR:
            return Colors::DANGER;
        default:
            return Colors::BORDER_DEFAULT;
    }
}

inline float DragDropZone::GetBorderWidth() const {
    if (m_state == DragDropState::DRAG_HOVER || m_state == DragDropState::LOADING) {
        return Theme::BORDER_WIDTH_THICK;
    }
    return Theme::BORDER_WIDTH_THIN;
}

inline float DragDropZone::GetOpacity() const {
    if (m_state == DragDropState::DRAG_HOVER) {
        // Pulsing opacity during hover
        float pulse = 0.5f + 0.5f * std::sin(m_hoverAnimationTime * HOVER_ANIMATION_SPEED);
        return 0.3f + pulse * BORDER_GLOW_INTENSITY;
    }
    return 1.0f;
}

inline void DragDropZone::Update(float deltaTime) {
    if (m_state == DragDropState::DRAG_HOVER) {
        m_hoverAnimationTime += deltaTime;
    }

    if (m_state == DragDropState::SUCCESS) {
        m_successFeedbackTimer -= deltaTime;
        if (m_successFeedbackTimer <= 0.0f) {
            SetState(DragDropState::IDLE);
        }
    }

    if (m_state == DragDropState::ERROR) {
        m_errorFeedbackTimer -= deltaTime;
        if (m_errorFeedbackTimer <= 0.0f) {
            SetState(DragDropState::IDLE);
        }
    }
}

inline void DragDropZone::SetState(DragDropState newState) {
    m_state = newState;

    if (newState == DragDropState::SUCCESS) {
        m_successFeedbackTimer = SUCCESS_FEEDBACK_DURATION;
    } else if (newState == DragDropState::ERROR) {
        m_errorFeedbackTimer = ERROR_FEEDBACK_DURATION;
    }
}

inline bool DragDropZone::IsExtensionSupported(const std::string& path) const {
    std::string ext = GetFileExtension(path);
    return m_supportedExtensions.find(ext) != m_supportedExtensions.end();
}

inline std::string DragDropZone::GetFileExtension(const std::string& path) const {
    size_t dotPos = path.find_last_of('.');
    if (dotPos == std::string::npos) {
        return "";
    }

    std::string ext = path.substr(dotPos);
    // Convert to lowercase for case-insensitive comparison
    for (char& c : ext) {
        c = std::tolower(static_cast<unsigned char>(c));
    }
    return ext;
}

inline bool DragDropZone::ValidatePath(const std::string& path) const {
    // Basic path validation - checks for dangerous patterns
    if (path.find("..") != std::string::npos) {
        return false; // path traversal attempt
    }

    // In production, would use filesystem API to verify file exists
    // For now, basic validation passes
    return !path.empty();
}

inline void DragDropZone::ProcessNextInQueue() {
    if (m_currentLoadIndex >= m_dropQueue.size()) {
        // Queue complete
        SetState(DragDropState::SUCCESS);
        return;
    }

    const std::string& path = m_dropQueue[m_currentLoadIndex];

    // Publish file.dropped event for FileService to handle
    Core::EventData data;
    data.SetString("path", path);
    data.SetInt("queueIndex", static_cast<int>(m_currentLoadIndex));
    data.SetInt("queueTotal", static_cast<int>(m_dropQueue.size()));
    m_eventBus.Publish("file.dropped", data);
}

inline void DragDropZone::OnFileLoaded(const Core::Event& event) {
    // Move to next file in queue
    m_currentLoadIndex++;
    ProcessNextInQueue();
}

inline void DragDropZone::OnFileError(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    m_lastErrorMessage = data.GetString("message");

    SetState(DragDropState::ERROR);
    m_dropQueue.clear();
    m_currentLoadIndex = 0;
}

inline void DragDropZone::LogDrop(const std::string& path, bool accepted) {
    if (accepted) {
        // INFO level logging for successful drops
        std::string msg = "Accepted drop: " + path;
        Core::EventData data;
        data.SetString("message", msg);
        data.SetString("level", "INFO");
        m_eventBus.Publish("log.message", data);
    } else {
        // WARNING level for rejections
        std::string msg = path.empty() ? "Drop rejected: queue full or loading" :
                          "Drop rejected: " + path;
        Core::EventData data;
        data.SetString("message", msg);
        data.SetString("level", "WARNING");
        m_eventBus.Publish("log.message", data);
    }
}

} // namespace UI
} // namespace BrightForge
