/** GizmoOverlay.h - Transform gizmo overlay for viewport manipulation
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "../core/EventBus.h"
#include <string>

namespace BrightForge {
namespace UI {

// Transform gizmo modes
enum class GizmoMode {
    TRANSLATE,  // Move arrows
    ROTATE,     // Rotation circles
    SCALE,      // Scale handles
    HIDDEN      // No gizmo visible
};

// Gizmo axis selection
enum class GizmoAxis {
    NONE,
    X,
    Y,
    Z,
    XY,  // Plane selection
    XZ,
    YZ,
    XYZ  // Universal scale
};

// Transform data structure
struct Transform {
    float positionX, positionY, positionZ;
    float rotationX, rotationY, rotationZ;
    float scaleX, scaleY, scaleZ;

    Transform()
        : positionX(0.0f), positionY(0.0f), positionZ(0.0f)
        , rotationX(0.0f), rotationY(0.0f), rotationZ(0.0f)
        , scaleX(1.0f), scaleY(1.0f), scaleZ(1.0f)
    {}
};

class GizmoOverlay {
public:
    GizmoOverlay(Core::EventBus& eventBus);
    ~GizmoOverlay();

    // Mode control
    void SetMode(GizmoMode mode);
    GizmoMode GetMode() const { return m_mode; }

    // Target object
    void SetTarget(const Transform& transform);
    void ClearTarget();
    bool HasTarget() const { return m_hasTarget; }
    const Transform& GetTarget() const { return m_targetTransform; }

    // Interaction handlers
    void OnMouseDown(float x, float y);
    void OnMouseMove(float x, float y);
    void OnMouseUp(float x, float y);

    // Visual state
    GizmoAxis GetActiveAxis() const { return m_activeAxis; }
    GizmoAxis GetHoveredAxis() const { return m_hoveredAxis; }
    bool IsDragging() const { return m_isDragging; }

    // Configuration
    void SetGizmoSize(float size) { m_gizmoSize = size; }
    void SetSnapEnabled(bool enabled) { m_snapEnabled = enabled; }
    void SetSnapIncrement(float increment) { m_snapIncrement = increment; }

    // Visual properties for rendering
    Color GetAxisColor(GizmoAxis axis) const;
    float GetAxisBrightness(GizmoAxis axis) const;
    float GetGizmoSize() const { return m_gizmoSize; }

    // Update method
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    GizmoMode m_mode;
    Transform m_targetTransform;
    bool m_hasTarget;

    // Interaction state
    GizmoAxis m_activeAxis;
    GizmoAxis m_hoveredAxis;
    bool m_isDragging;
    float m_dragStartX;
    float m_dragStartY;
    Transform m_dragStartTransform;

    // Configuration
    float m_gizmoSize;
    bool m_snapEnabled;
    float m_snapIncrement;

    // Event subscriptions
    size_t m_assetSelectedSubscription;
    size_t m_toolChangedSubscription;
    size_t m_transformChangedSubscription;

    // Internal helpers
    GizmoAxis HitTestGizmo(float x, float y) const;
    void ApplyTranslation(float deltaX, float deltaY);
    void ApplyRotation(float deltaX, float deltaY);
    void ApplyScale(float deltaX, float deltaY);
    void PublishTransformChanged();
    void OnAssetSelected(const Core::Event& event);
    void OnToolChanged(const Core::Event& event);
    void OnTransformChanged(const Core::Event& event);
    float SnapValue(float value) const;

    // Visual feedback
    float m_highlightPulse;

    // Gizmo constants
    static constexpr float DEFAULT_GIZMO_SIZE = 1.0f;
    static constexpr float HANDLE_SELECT_THRESHOLD = 20.0f;
    static constexpr float DEFAULT_SNAP_INCREMENT = 0.25f;
    static constexpr float ROTATION_SNAP_INCREMENT = 15.0f; // degrees
    static constexpr float SCALE_SENSITIVITY = 0.01f;
    static constexpr float TRANSLATE_SENSITIVITY = 0.1f;
    static constexpr float ROTATE_SENSITIVITY = 0.5f;
    static constexpr float HIGHLIGHT_PULSE_SPEED = 4.0f;
};

// Implementation

inline GizmoOverlay::GizmoOverlay(Core::EventBus& eventBus)
    : m_eventBus(eventBus)
    , m_mode(GizmoMode::HIDDEN)
    , m_hasTarget(false)
    , m_activeAxis(GizmoAxis::NONE)
    , m_hoveredAxis(GizmoAxis::NONE)
    , m_isDragging(false)
    , m_dragStartX(0.0f)
    , m_dragStartY(0.0f)
    , m_gizmoSize(DEFAULT_GIZMO_SIZE)
    , m_snapEnabled(false)
    , m_snapIncrement(DEFAULT_SNAP_INCREMENT)
    , m_highlightPulse(0.0f)
{
    // Subscribe to asset selection to attach gizmo
    m_assetSelectedSubscription = m_eventBus.Subscribe("asset.selected",
        [this](const Core::Event& e) { OnAssetSelected(e); });

    // Subscribe to tool changes to switch gizmo mode
    m_toolChangedSubscription = m_eventBus.Subscribe("tool.changed",
        [this](const Core::Event& e) { OnToolChanged(e); });

    // Subscribe to external transform changes
    m_transformChangedSubscription = m_eventBus.Subscribe("transform.changed",
        [this](const Core::Event& e) { OnTransformChanged(e); });
}

inline GizmoOverlay::~GizmoOverlay() {
    m_eventBus.Unsubscribe("asset.selected", m_assetSelectedSubscription);
    m_eventBus.Unsubscribe("tool.changed", m_toolChangedSubscription);
    m_eventBus.Unsubscribe("transform.changed", m_transformChangedSubscription);
}

inline void GizmoOverlay::SetMode(GizmoMode mode) {
    m_mode = mode;
    m_activeAxis = GizmoAxis::NONE;
    m_hoveredAxis = GizmoAxis::NONE;
}

inline void GizmoOverlay::SetTarget(const Transform& transform) {
    m_targetTransform = transform;
    m_hasTarget = true;
}

inline void GizmoOverlay::ClearTarget() {
    m_hasTarget = false;
    m_mode = GizmoMode::HIDDEN;
    m_activeAxis = GizmoAxis::NONE;
}

inline void GizmoOverlay::OnMouseDown(float x, float y) {
    // Guard: only interact if gizmo is visible and has target
    if (m_mode == GizmoMode::HIDDEN || !m_hasTarget) {
        return;
    }

    // Perform hit test against gizmo handles
    GizmoAxis hitAxis = HitTestGizmo(x, y);

    if (hitAxis != GizmoAxis::NONE) {
        m_isDragging = true;
        m_activeAxis = hitAxis;
        m_dragStartX = x;
        m_dragStartY = y;
        m_dragStartTransform = m_targetTransform;
    }
}

inline void GizmoOverlay::OnMouseMove(float x, float y) {
    if (!m_hasTarget || m_mode == GizmoMode::HIDDEN) {
        return;
    }

    if (m_isDragging) {
        float deltaX = x - m_dragStartX;
        float deltaY = y - m_dragStartY;

        // Apply transformation based on mode
        switch (m_mode) {
            case GizmoMode::TRANSLATE:
                ApplyTranslation(deltaX, deltaY);
                break;
            case GizmoMode::ROTATE:
                ApplyRotation(deltaX, deltaY);
                break;
            case GizmoMode::SCALE:
                ApplyScale(deltaX, deltaY);
                break;
            default:
                break;
        }

        PublishTransformChanged();
    } else {
        // Update hover state for visual feedback
        m_hoveredAxis = HitTestGizmo(x, y);
    }
}

inline void GizmoOverlay::OnMouseUp(float x, float y) {
    if (m_isDragging) {
        m_isDragging = false;
        m_activeAxis = GizmoAxis::NONE;

        // Publish final transform
        PublishTransformChanged();
    }
}

inline Color GizmoOverlay::GetAxisColor(GizmoAxis axis) const {
    switch (axis) {
        case GizmoAxis::X:
            return Colors::GIZMO_X_AXIS;
        case GizmoAxis::Y:
            return Colors::GIZMO_Y_AXIS;
        case GizmoAxis::Z:
            return Colors::GIZMO_Z_AXIS;
        case GizmoAxis::XY:
        case GizmoAxis::XZ:
        case GizmoAxis::YZ:
        case GizmoAxis::XYZ:
            return Colors::TEXT_PRIMARY; // White for plane/universal handles
        default:
            return Colors::TEXT_SECONDARY;
    }
}

inline float GizmoOverlay::GetAxisBrightness(GizmoAxis axis) const {
    // Active axis is brightest
    if (axis == m_activeAxis) {
        return 1.5f;
    }
    // Hovered axis is highlighted
    else if (axis == m_hoveredAxis) {
        return 1.2f;
    }
    // Default brightness
    return 1.0f;
}

inline void GizmoOverlay::Update(float deltaTime) {
    // Pulse animation for active axis
    if (m_activeAxis != GizmoAxis::NONE) {
        m_highlightPulse += deltaTime * HIGHLIGHT_PULSE_SPEED;
    } else {
        m_highlightPulse = 0.0f;
    }
}

inline GizmoAxis GizmoOverlay::HitTestGizmo(float x, float y) const {
    // Simplified hit testing - production would use proper ray-gizmo intersection
    // For now, use screen-space distance approximation

    // Would need viewport projection to convert 3D gizmo to 2D screen coords
    // Returning placeholder logic

    return GizmoAxis::NONE;
}

inline void GizmoOverlay::ApplyTranslation(float deltaX, float deltaY) {
    float sensitivity = TRANSLATE_SENSITIVITY;

    // Apply delta based on active axis
    switch (m_activeAxis) {
        case GizmoAxis::X:
            m_targetTransform.positionX = m_dragStartTransform.positionX + deltaX * sensitivity;
            if (m_snapEnabled) {
                m_targetTransform.positionX = SnapValue(m_targetTransform.positionX);
            }
            break;

        case GizmoAxis::Y:
            m_targetTransform.positionY = m_dragStartTransform.positionY - deltaY * sensitivity;
            if (m_snapEnabled) {
                m_targetTransform.positionY = SnapValue(m_targetTransform.positionY);
            }
            break;

        case GizmoAxis::Z:
            m_targetTransform.positionZ = m_dragStartTransform.positionZ + deltaY * sensitivity;
            if (m_snapEnabled) {
                m_targetTransform.positionZ = SnapValue(m_targetTransform.positionZ);
            }
            break;

        case GizmoAxis::XY:
            m_targetTransform.positionX = m_dragStartTransform.positionX + deltaX * sensitivity;
            m_targetTransform.positionY = m_dragStartTransform.positionY - deltaY * sensitivity;
            if (m_snapEnabled) {
                m_targetTransform.positionX = SnapValue(m_targetTransform.positionX);
                m_targetTransform.positionY = SnapValue(m_targetTransform.positionY);
            }
            break;

        case GizmoAxis::XZ:
            m_targetTransform.positionX = m_dragStartTransform.positionX + deltaX * sensitivity;
            m_targetTransform.positionZ = m_dragStartTransform.positionZ + deltaY * sensitivity;
            if (m_snapEnabled) {
                m_targetTransform.positionX = SnapValue(m_targetTransform.positionX);
                m_targetTransform.positionZ = SnapValue(m_targetTransform.positionZ);
            }
            break;

        case GizmoAxis::YZ:
            m_targetTransform.positionY = m_dragStartTransform.positionY - deltaY * sensitivity;
            m_targetTransform.positionZ = m_dragStartTransform.positionZ + deltaX * sensitivity;
            if (m_snapEnabled) {
                m_targetTransform.positionY = SnapValue(m_targetTransform.positionY);
                m_targetTransform.positionZ = SnapValue(m_targetTransform.positionZ);
            }
            break;

        default:
            break;
    }
}

inline void GizmoOverlay::ApplyRotation(float deltaX, float deltaY) {
    float sensitivity = ROTATE_SENSITIVITY;
    float rotationAmount = deltaX * sensitivity;

    if (m_snapEnabled) {
        rotationAmount = std::round(rotationAmount / ROTATION_SNAP_INCREMENT) * ROTATION_SNAP_INCREMENT;
    }

    switch (m_activeAxis) {
        case GizmoAxis::X:
            m_targetTransform.rotationX = m_dragStartTransform.rotationX + rotationAmount;
            break;
        case GizmoAxis::Y:
            m_targetTransform.rotationY = m_dragStartTransform.rotationY + rotationAmount;
            break;
        case GizmoAxis::Z:
            m_targetTransform.rotationZ = m_dragStartTransform.rotationZ + rotationAmount;
            break;
        default:
            break;
    }
}

inline void GizmoOverlay::ApplyScale(float deltaX, float deltaY) {
    float sensitivity = SCALE_SENSITIVITY;
    float scaleDelta = deltaY * sensitivity;

    // Guard: prevent negative scale
    float minScale = 0.01f;

    switch (m_activeAxis) {
        case GizmoAxis::X:
            m_targetTransform.scaleX = std::max(minScale, m_dragStartTransform.scaleX + scaleDelta);
            break;
        case GizmoAxis::Y:
            m_targetTransform.scaleY = std::max(minScale, m_dragStartTransform.scaleY + scaleDelta);
            break;
        case GizmoAxis::Z:
            m_targetTransform.scaleZ = std::max(minScale, m_dragStartTransform.scaleZ + scaleDelta);
            break;
        case GizmoAxis::XYZ:
            // Uniform scale
            m_targetTransform.scaleX = std::max(minScale, m_dragStartTransform.scaleX + scaleDelta);
            m_targetTransform.scaleY = std::max(minScale, m_dragStartTransform.scaleY + scaleDelta);
            m_targetTransform.scaleZ = std::max(minScale, m_dragStartTransform.scaleZ + scaleDelta);
            break;
        default:
            break;
    }
}

inline void GizmoOverlay::PublishTransformChanged() {
    Core::EventData data;
    data.SetFloat("posX", m_targetTransform.positionX);
    data.SetFloat("posY", m_targetTransform.positionY);
    data.SetFloat("posZ", m_targetTransform.positionZ);
    data.SetFloat("rotX", m_targetTransform.rotationX);
    data.SetFloat("rotY", m_targetTransform.rotationY);
    data.SetFloat("rotZ", m_targetTransform.rotationZ);
    data.SetFloat("scaleX", m_targetTransform.scaleX);
    data.SetFloat("scaleY", m_targetTransform.scaleY);
    data.SetFloat("scaleZ", m_targetTransform.scaleZ);
    m_eventBus.Publish("transform.changed", data);
}

inline void GizmoOverlay::OnAssetSelected(const Core::Event& event) {
    const Core::EventData& data = event.GetData();

    // Extract transform from event if available
    Transform transform;
    transform.positionX = data.GetFloat("posX");
    transform.positionY = data.GetFloat("posY");
    transform.positionZ = data.GetFloat("posZ");

    SetTarget(transform);

    // Set gizmo mode to translate by default
    if (m_mode == GizmoMode::HIDDEN) {
        SetMode(GizmoMode::TRANSLATE);
    }
}

inline void GizmoOverlay::OnToolChanged(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    int toolType = data.GetInt("tool");

    // Map tool to gizmo mode
    switch (static_cast<ToolType>(toolType)) {
        case ToolType::MOVE:
            SetMode(GizmoMode::TRANSLATE);
            break;
        case ToolType::ROTATE:
            SetMode(GizmoMode::ROTATE);
            break;
        case ToolType::SCALE:
            SetMode(GizmoMode::SCALE);
            break;
        case ToolType::SELECT:
            // Keep current mode
            break;
        default:
            // Hide gizmo for sculpt/paint tools
            SetMode(GizmoMode::HIDDEN);
            break;
    }
}

inline void GizmoOverlay::OnTransformChanged(const Core::Event& event) {
    // Update gizmo position when transform changes externally
    const Core::EventData& data = event.GetData();

    m_targetTransform.positionX = data.GetFloat("posX");
    m_targetTransform.positionY = data.GetFloat("posY");
    m_targetTransform.positionZ = data.GetFloat("posZ");
    m_targetTransform.rotationX = data.GetFloat("rotX");
    m_targetTransform.rotationY = data.GetFloat("rotY");
    m_targetTransform.rotationZ = data.GetFloat("rotZ");
    m_targetTransform.scaleX = data.GetFloat("scaleX");
    m_targetTransform.scaleY = data.GetFloat("scaleY");
    m_targetTransform.scaleZ = data.GetFloat("scaleZ");
}

inline float GizmoOverlay::SnapValue(float value) const {
    return std::round(value / m_snapIncrement) * m_snapIncrement;
}

} // namespace UI
} // namespace BrightForge
