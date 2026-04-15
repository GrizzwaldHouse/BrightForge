/** Viewport.h - 3D render surface with camera control and tool integration
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "../core/EventBus.h"
#include <string>

namespace BrightForge {
namespace UI {

// Camera control modes
enum class CameraControlMode {
    ORBIT,      // Default: orbit around target
    PAN,        // Middle mouse: pan camera
    ZOOM,       // Scroll wheel: zoom in/out
    FLY,        // WASD: free fly mode
    LOCKED      // No camera control (for tool use)
};

// Camera data structure for publishing
struct CameraData {
    float positionX, positionY, positionZ;
    float targetX, targetY, targetZ;
    float upX, upY, upZ;
    float fov;
    float nearPlane;
    float farPlane;
    ViewMode viewMode;

    CameraData()
        : positionX(0.0f), positionY(5.0f), positionZ(10.0f)
        , targetX(0.0f), targetY(0.0f), targetZ(0.0f)
        , upX(0.0f), upY(1.0f), upZ(0.0f)
        , fov(60.0f)
        , nearPlane(0.1f)
        , farPlane(1000.0f)
        , viewMode(ViewMode::PERSPECTIVE)
    {}
};

// Frame statistics for FPS overlay
struct FrameStats {
    float fps;
    float frameTimeMs;
    int drawCalls;
    int triangles;
    int vertices;

    FrameStats()
        : fps(0.0f), frameTimeMs(0.0f), drawCalls(0), triangles(0), vertices(0)
    {}
};

class Viewport {
public:
    Viewport(Core::EventBus& eventBus, const Rect& bounds);
    ~Viewport();

    // Mouse input handlers
    void OnMouseMove(float x, float y);
    void OnMouseDown(int button, float x, float y);
    void OnMouseUp(int button, float x, float y);
    void OnMouseWheel(float delta);

    // Keyboard input handlers
    void OnKeyDown(int keyCode);
    void OnKeyUp(int keyCode);

    // Resize handling
    void OnResize(float width, float height);
    const Rect& GetBounds() const { return m_bounds; }

    // Camera control
    void SetViewMode(ViewMode mode);
    ViewMode GetViewMode() const { return m_camera.viewMode; }
    void ResetCamera();
    const CameraData& GetCameraData() const { return m_camera; }
    void SetCameraControlMode(CameraControlMode mode) { m_controlMode = mode; }

    // Tool mode
    void SetActiveTool(ToolType tool);
    ToolType GetActiveTool() const { return m_activeTool; }

    // Visual state
    bool IsOrbiting() const { return m_isOrbiting; }
    bool IsPanning() const { return m_isPanning; }
    CursorMode GetCursorMode() const;

    // FPS overlay
    void SetShowFPS(bool show) { m_showFPS = show; }
    bool IsShowingFPS() const { return m_showFPS; }
    const FrameStats& GetFrameStats() const { return m_frameStats; }

    // Object highlighting
    void SetHighlightedObject(const std::string& objectId);
    void ClearHighlight();

    // Update method
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    Rect m_bounds;
    CameraData m_camera;
    CameraControlMode m_controlMode;
    ToolType m_activeTool;

    // Mouse interaction state
    bool m_isOrbiting;
    bool m_isPanning;
    bool m_isSelecting;
    float m_lastMouseX;
    float m_lastMouseY;
    int m_mouseButtonDown;

    // Keyboard state for fly mode
    bool m_keyW, m_keyA, m_keyS, m_keyD;
    bool m_keyQ, m_keyE;

    // FPS overlay
    bool m_showFPS;
    FrameStats m_frameStats;

    // Highlighted object
    std::string m_highlightedObjectId;
    bool m_hasHighlight;

    // Event subscriptions
    size_t m_toolChangedSubscription;
    size_t m_assetSelectedSubscription;
    size_t m_renderFrameEndSubscription;

    // Internal helpers
    void UpdateOrbitCamera(float deltaX, float deltaY);
    void UpdatePanCamera(float deltaX, float deltaY);
    void UpdateZoomCamera(float delta);
    void UpdateFlyCamera(float deltaTime);
    void PublishCameraUpdate();
    void PublishViewportResized();
    void OnToolChanged(const Core::Event& event);
    void OnAssetSelected(const Core::Event& event);
    void OnRenderFrameEnd(const Core::Event& event);
    float GetOrbitSensitivity() const;
    float GetPanSensitivity() const;
    float GetZoomSensitivity() const;
    float GetFlySensitivity() const;

    // Mouse button constants
    static constexpr int MOUSE_LEFT = 0;
    static constexpr int MOUSE_MIDDLE = 1;
    static constexpr int MOUSE_RIGHT = 2;

    // Camera constants
    static constexpr float ORBIT_SENSITIVITY = 0.005f;
    static constexpr float PAN_SENSITIVITY = 0.01f;
    static constexpr float ZOOM_SENSITIVITY = 0.1f;
    static constexpr float FLY_SENSITIVITY = 5.0f;
    static constexpr float MIN_ZOOM_DISTANCE = 1.0f;
    static constexpr float MAX_ZOOM_DISTANCE = 100.0f;
};

// Implementation

inline Viewport::Viewport(Core::EventBus& eventBus, const Rect& bounds)
    : m_eventBus(eventBus)
    , m_bounds(bounds)
    , m_controlMode(CameraControlMode::ORBIT)
    , m_activeTool(ToolType::SELECT)
    , m_isOrbiting(false)
    , m_isPanning(false)
    , m_isSelecting(false)
    , m_lastMouseX(0.0f)
    , m_lastMouseY(0.0f)
    , m_mouseButtonDown(-1)
    , m_keyW(false), m_keyA(false), m_keyS(false), m_keyD(false)
    , m_keyQ(false), m_keyE(false)
    , m_showFPS(true)
    , m_hasHighlight(false)
{
    // Subscribe to tool changes
    m_toolChangedSubscription = m_eventBus.Subscribe("tool.changed",
        [this](const Core::Event& e) { OnToolChanged(e); });

    m_assetSelectedSubscription = m_eventBus.Subscribe("asset.selected",
        [this](const Core::Event& e) { OnAssetSelected(e); });

    m_renderFrameEndSubscription = m_eventBus.Subscribe("render.frame_end",
        [this](const Core::Event& e) { OnRenderFrameEnd(e); });

    // Publish initial camera state
    PublishCameraUpdate();
}

inline Viewport::~Viewport() {
    m_eventBus.Unsubscribe("tool.changed", m_toolChangedSubscription);
    m_eventBus.Unsubscribe("asset.selected", m_assetSelectedSubscription);
    m_eventBus.Unsubscribe("render.frame_end", m_renderFrameEndSubscription);
}

inline void Viewport::OnMouseMove(float x, float y) {
    float deltaX = x - m_lastMouseX;
    float deltaY = y - m_lastMouseY;

    m_lastMouseX = x;
    m_lastMouseY = y;

    // Guard: skip if no mouse button down
    if (m_mouseButtonDown < 0) {
        return;
    }

    // Route based on control mode and button
    if (m_isOrbiting) {
        UpdateOrbitCamera(deltaX, deltaY);
        PublishCameraUpdate();
    } else if (m_isPanning) {
        UpdatePanCamera(deltaX, deltaY);
        PublishCameraUpdate();
    } else if (m_isSelecting && m_activeTool != ToolType::SELECT) {
        // Forward to tool system for sculpt/paint operations
        Core::EventData data;
        data.SetFloat("x", x);
        data.SetFloat("y", y);
        data.SetFloat("deltaX", deltaX);
        data.SetFloat("deltaY", deltaY);
        m_eventBus.Publish("viewport.tool_drag", data);
    }
}

inline void Viewport::OnMouseDown(int button, float x, float y) {
    m_mouseButtonDown = button;
    m_lastMouseX = x;
    m_lastMouseY = y;

    if (button == MOUSE_LEFT && m_controlMode != CameraControlMode::LOCKED) {
        m_isOrbiting = true;
    } else if (button == MOUSE_MIDDLE) {
        m_isPanning = true;
    } else if (button == MOUSE_RIGHT) {
        m_isSelecting = true;

        // Publish viewport click for object selection
        Core::EventData data;
        data.SetFloat("x", x);
        data.SetFloat("y", y);
        data.SetInt("button", button);
        m_eventBus.Publish("viewport.click", data);
    }
}

inline void Viewport::OnMouseUp(int button, float x, float y) {
    m_mouseButtonDown = -1;

    if (button == MOUSE_LEFT) {
        m_isOrbiting = false;
    } else if (button == MOUSE_MIDDLE) {
        m_isPanning = false;
    } else if (button == MOUSE_RIGHT) {
        m_isSelecting = false;
    }
}

inline void Viewport::OnMouseWheel(float delta) {
    UpdateZoomCamera(delta);
    PublishCameraUpdate();
}

inline void Viewport::OnKeyDown(int keyCode) {
    // Track WASD keys for fly mode
    switch (keyCode) {
        case 'W': m_keyW = true; break;
        case 'A': m_keyA = true; break;
        case 'S': m_keyS = true; break;
        case 'D': m_keyD = true; break;
        case 'Q': m_keyQ = true; break;
        case 'E': m_keyE = true; break;
    }

    // Forward to tool system
    Core::EventData data;
    data.SetInt("keyCode", keyCode);
    m_eventBus.Publish("viewport.keydown", data);
}

inline void Viewport::OnKeyUp(int keyCode) {
    switch (keyCode) {
        case 'W': m_keyW = false; break;
        case 'A': m_keyA = false; break;
        case 'S': m_keyS = false; break;
        case 'D': m_keyD = false; break;
        case 'Q': m_keyQ = false; break;
        case 'E': m_keyE = false; break;
    }
}

inline void Viewport::OnResize(float width, float height) {
    m_bounds.width = width;
    m_bounds.height = height;
    PublishViewportResized();
}

inline void Viewport::SetViewMode(ViewMode mode) {
    m_camera.viewMode = mode;

    // Reset camera position for orthographic views
    if (mode == ViewMode::TOP) {
        m_camera.positionX = 0.0f;
        m_camera.positionY = 10.0f;
        m_camera.positionZ = 0.0f;
    } else if (mode == ViewMode::FRONT) {
        m_camera.positionX = 0.0f;
        m_camera.positionY = 0.0f;
        m_camera.positionZ = 10.0f;
    } else if (mode == ViewMode::SIDE) {
        m_camera.positionX = 10.0f;
        m_camera.positionY = 0.0f;
        m_camera.positionZ = 0.0f;
    }

    PublishCameraUpdate();
}

inline void Viewport::ResetCamera() {
    m_camera = CameraData();
    PublishCameraUpdate();
}

inline void Viewport::SetActiveTool(ToolType tool) {
    m_activeTool = tool;

    // Lock camera for sculpt tools
    if (tool == ToolType::SCULPT_SMOOTH || tool == ToolType::SCULPT_INFLATE ||
        tool == ToolType::SCULPT_PINCH || tool == ToolType::SCULPT_FLATTEN) {
        m_controlMode = CameraControlMode::LOCKED;
    } else {
        m_controlMode = CameraControlMode::ORBIT;
    }
}

inline CursorMode Viewport::GetCursorMode() const {
    if (m_isOrbiting) return CursorMode::ROTATE;
    if (m_isPanning) return CursorMode::MOVE;

    switch (m_activeTool) {
        case ToolType::MOVE:
            return CursorMode::MOVE;
        case ToolType::ROTATE:
            return CursorMode::ROTATE;
        case ToolType::SCALE:
            return CursorMode::SCALE;
        case ToolType::SELECT:
            return CursorMode::ARROW;
        default:
            return CursorMode::CROSSHAIR;
    }
}

inline void Viewport::SetHighlightedObject(const std::string& objectId) {
    m_highlightedObjectId = objectId;
    m_hasHighlight = true;

    Core::EventData data;
    data.SetString("objectId", objectId);
    data.SetBool("highlight", true);
    m_eventBus.Publish("viewport.highlight", data);
}

inline void Viewport::ClearHighlight() {
    if (!m_hasHighlight) return;

    m_hasHighlight = false;
    m_highlightedObjectId.clear();

    Core::EventData data;
    data.SetBool("highlight", false);
    m_eventBus.Publish("viewport.highlight", data);
}

inline void Viewport::Update(float deltaTime) {
    // Update fly camera if in fly mode
    if (m_controlMode == CameraControlMode::FLY) {
        UpdateFlyCamera(deltaTime);
    }
}

inline void Viewport::UpdateOrbitCamera(float deltaX, float deltaY) {
    float sensitivity = GetOrbitSensitivity();

    // Calculate rotation angles
    float yaw = deltaX * sensitivity;
    float pitch = deltaY * sensitivity;

    // Apply rotation to camera position around target
    // Simplified orbit - production would use proper quaternion math
    float radius = 10.0f; // distance from target
    m_camera.positionX += yaw;
    m_camera.positionY += pitch;
}

inline void Viewport::UpdatePanCamera(float deltaX, float deltaY) {
    float sensitivity = GetPanSensitivity();

    m_camera.positionX -= deltaX * sensitivity;
    m_camera.positionY += deltaY * sensitivity;

    m_camera.targetX -= deltaX * sensitivity;
    m_camera.targetY += deltaY * sensitivity;
}

inline void Viewport::UpdateZoomCamera(float delta) {
    float sensitivity = GetZoomSensitivity();

    // Move camera toward/away from target
    float dirX = m_camera.targetX - m_camera.positionX;
    float dirY = m_camera.targetY - m_camera.positionY;
    float dirZ = m_camera.targetZ - m_camera.positionZ;

    float distance = std::sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

    // Guard: enforce min/max zoom distance
    if (distance < MIN_ZOOM_DISTANCE && delta > 0.0f) return;
    if (distance > MAX_ZOOM_DISTANCE && delta < 0.0f) return;

    float normX = dirX / distance;
    float normY = dirY / distance;
    float normZ = dirZ / distance;

    float zoomAmount = delta * sensitivity;

    m_camera.positionX += normX * zoomAmount;
    m_camera.positionY += normY * zoomAmount;
    m_camera.positionZ += normZ * zoomAmount;
}

inline void Viewport::UpdateFlyCamera(float deltaTime) {
    float speed = GetFlySensitivity() * deltaTime;

    // Forward/backward
    if (m_keyW) m_camera.positionZ -= speed;
    if (m_keyS) m_camera.positionZ += speed;

    // Left/right
    if (m_keyA) m_camera.positionX -= speed;
    if (m_keyD) m_camera.positionX += speed;

    // Up/down
    if (m_keyQ) m_camera.positionY -= speed;
    if (m_keyE) m_camera.positionY += speed;

    if (m_keyW || m_keyS || m_keyA || m_keyD || m_keyQ || m_keyE) {
        PublishCameraUpdate();
    }
}

inline void Viewport::PublishCameraUpdate() {
    Core::EventData data;
    data.SetFloat("posX", m_camera.positionX);
    data.SetFloat("posY", m_camera.positionY);
    data.SetFloat("posZ", m_camera.positionZ);
    data.SetFloat("targetX", m_camera.targetX);
    data.SetFloat("targetY", m_camera.targetY);
    data.SetFloat("targetZ", m_camera.targetZ);
    data.SetFloat("upX", m_camera.upX);
    data.SetFloat("upY", m_camera.upY);
    data.SetFloat("upZ", m_camera.upZ);
    data.SetFloat("fov", m_camera.fov);
    data.SetInt("viewMode", static_cast<int>(m_camera.viewMode));
    m_eventBus.Publish("camera.updated", data);
}

inline void Viewport::PublishViewportResized() {
    Core::EventData data;
    data.SetFloat("width", m_bounds.width);
    data.SetFloat("height", m_bounds.height);
    data.SetFloat("aspectRatio", m_bounds.width / m_bounds.height);
    m_eventBus.Publish("viewport.resized", data);
}

inline void Viewport::OnToolChanged(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    int toolType = data.GetInt("tool");
    SetActiveTool(static_cast<ToolType>(toolType));
}

inline void Viewport::OnAssetSelected(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    std::string objectId = data.GetString("path");
    SetHighlightedObject(objectId);
}

inline void Viewport::OnRenderFrameEnd(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    m_frameStats.fps = data.GetFloat("fps");
    m_frameStats.frameTimeMs = data.GetFloat("frameTimeMs");
    m_frameStats.drawCalls = data.GetInt("drawCalls");
    m_frameStats.triangles = data.GetInt("triangles");
    m_frameStats.vertices = data.GetInt("vertices");
}

inline float Viewport::GetOrbitSensitivity() const {
    return ORBIT_SENSITIVITY;
}

inline float Viewport::GetPanSensitivity() const {
    return PAN_SENSITIVITY;
}

inline float Viewport::GetZoomSensitivity() const {
    return ZOOM_SENSITIVITY;
}

inline float Viewport::GetFlySensitivity() const {
    return FLY_SENSITIVITY;
}

} // namespace UI
} // namespace BrightForge
