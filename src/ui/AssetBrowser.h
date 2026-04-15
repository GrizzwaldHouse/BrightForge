/** AssetBrowser.h - Composite panel for asset search, browsing, and drag-drop
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "FileSearchBox.h"
#include "FileList.h"
#include "DragDropZone.h"
#include "../core/EventBus.h"
#include <memory>

namespace BrightForge {
namespace UI {

class AssetBrowser {
public:
    AssetBrowser(Core::EventBus& eventBus, const PanelConfig& config);
    ~AssetBrowser();

    // Panel visibility and layout
    void SetVisible(bool visible);
    bool IsVisible() const { return m_config.visible; }
    const PanelConfig& GetConfig() const { return m_config; }
    void SetConfig(const PanelConfig& config);

    // Resize handling
    void OnResize(float width, float height);
    void OnDragResize(float delta, const std::string& edge);

    // Input forwarding
    void OnClick(float x, float y);
    void OnDoubleClick(float x, float y);
    void OnRightClick(float x, float y);
    void OnKeyDown(int keyCode);
    void OnMouseMove(float x, float y);
    void OnMouseWheel(float delta);

    // OS drag-drop events
    void OnDragEnter();
    void OnDrop(const std::vector<std::string>& paths);
    void OnDragLeave();

    // Child component accessors
    FileSearchBox& GetSearchBox() { return *m_searchBox; }
    FileList& GetFileList() { return *m_fileList; }
    DragDropZone& GetDragDropZone() { return *m_dragDropZone; }

    // Display mode toggle
    void ToggleDisplayMode();
    DisplayMode GetDisplayMode() const;

    // Update method
    void Update(float deltaTime);

    // Debug registration
    void RegisterDebugChannel();

private:
    Core::EventBus& m_eventBus;
    PanelConfig m_config;

    // Child components (composition pattern)
    std::unique_ptr<FileSearchBox> m_searchBox;
    std::unique_ptr<FileList> m_fileList;
    std::unique_ptr<DragDropZone> m_dragDropZone;

    // Layout state
    Rect m_searchBoxBounds;
    Rect m_fileListBounds;
    Rect m_dragDropBounds;
    float m_searchBoxHeight;

    // Resize state
    bool m_isResizing;
    std::string m_resizeEdge;
    float m_resizeStartWidth;
    float m_resizeStartHeight;

    // Event subscriptions for coordination
    size_t m_fileSelectedSubscription;
    size_t m_assetSelectedSubscription;
    size_t m_indexUpdatedSubscription;

    // Internal helpers
    void CalculateLayout();
    void UpdateChildBounds();
    bool IsInSearchBoxBounds(float x, float y) const;
    bool IsInFileListBounds(float x, float y) const;
    void OnFileSelected(const Core::Event& event);
    void OnAssetSelected(const Core::Event& event);
    void OnIndexUpdated(const Core::Event& event);
    void LogDebug(const std::string& message);

    // Layout constants
    static constexpr float SEARCH_BOX_HEIGHT = 40.0f;
    static constexpr float COMPONENT_SPACING = 8.0f;
    static constexpr float MIN_PANEL_WIDTH = 200.0f;
    static constexpr float MIN_PANEL_HEIGHT = 300.0f;
    static constexpr float RESIZE_HANDLE_WIDTH = 8.0f;
};

// Implementation

inline AssetBrowser::AssetBrowser(Core::EventBus& eventBus, const PanelConfig& config)
    : m_eventBus(eventBus)
    , m_config(config)
    , m_searchBoxHeight(SEARCH_BOX_HEIGHT)
    , m_isResizing(false)
    , m_resizeStartWidth(0.0f)
    , m_resizeStartHeight(0.0f)
{
    // Enforce minimum dimensions
    m_config.minWidth = std::max(m_config.minWidth, MIN_PANEL_WIDTH);
    m_config.minHeight = std::max(m_config.minHeight, MIN_PANEL_HEIGHT);
    m_config.width = std::max(m_config.width, m_config.minWidth);
    m_config.height = std::max(m_config.height, m_config.minHeight);

    // Calculate initial layout
    CalculateLayout();

    // Create child components (order matters for layering)
    m_searchBox = std::make_unique<FileSearchBox>(m_eventBus, m_searchBoxBounds);
    m_fileList = std::make_unique<FileList>(m_eventBus, m_fileListBounds, DisplayMode::GRID);
    m_dragDropZone = std::make_unique<DragDropZone>(m_eventBus, m_dragDropBounds);

    // Subscribe to events for coordination between children
    m_fileSelectedSubscription = m_eventBus.Subscribe("file.selected",
        [this](const Core::Event& e) { OnFileSelected(e); });

    m_assetSelectedSubscription = m_eventBus.Subscribe("asset.selected",
        [this](const Core::Event& e) { OnAssetSelected(e); });

    m_indexUpdatedSubscription = m_eventBus.Subscribe("index.updated",
        [this](const Core::Event& e) { OnIndexUpdated(e); });

    RegisterDebugChannel();

    LogDebug("AssetBrowser initialized");
}

inline AssetBrowser::~AssetBrowser() {
    m_eventBus.Unsubscribe("file.selected", m_fileSelectedSubscription);
    m_eventBus.Unsubscribe("asset.selected", m_assetSelectedSubscription);
    m_eventBus.Unsubscribe("index.updated", m_indexUpdatedSubscription);

    LogDebug("AssetBrowser destroyed");
}

inline void AssetBrowser::SetVisible(bool visible) {
    m_config.visible = visible;

    Core::EventData data;
    data.SetString("panel", "AssetBrowser");
    data.SetBool("visible", visible);
    m_eventBus.Publish("ui.panel.visibility", data);

    LogDebug(visible ? "Panel shown" : "Panel hidden");
}

inline void AssetBrowser::SetConfig(const PanelConfig& config) {
    m_config = config;
    CalculateLayout();
    UpdateChildBounds();
}

inline void AssetBrowser::OnResize(float width, float height) {
    // Guard: enforce minimum dimensions
    width = std::max(width, m_config.minWidth);
    height = std::max(height, m_config.minHeight);

    m_config.width = width;
    m_config.height = height;

    CalculateLayout();
    UpdateChildBounds();

    LogDebug("Resized to " + std::to_string(static_cast<int>(width)) + "x" +
             std::to_string(static_cast<int>(height)));
}

inline void AssetBrowser::OnDragResize(float delta, const std::string& edge) {
    // Guard: only allow resize if panel is resizable
    if (!m_config.resizable) {
        return;
    }

    if (edge == "right") {
        OnResize(m_config.width + delta, m_config.height);
    } else if (edge == "bottom") {
        OnResize(m_config.width, m_config.height + delta);
    } else if (edge == "left") {
        OnResize(m_config.width - delta, m_config.height);
    }
}

inline void AssetBrowser::OnClick(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    // Route click to appropriate child
    if (IsInSearchBoxBounds(x, y)) {
        m_searchBox->OnFocus();
    } else if (IsInFileListBounds(x, y)) {
        m_fileList->OnClick(x, y);
    }
}

inline void AssetBrowser::OnDoubleClick(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    if (IsInFileListBounds(x, y)) {
        int index = m_fileList->GetSelectedIndex();
        if (index >= 0) {
            m_fileList->OnDoubleClick(index);
        }
    }
}

inline void AssetBrowser::OnRightClick(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    if (IsInFileListBounds(x, y)) {
        // Find item at position and show context menu
        for (size_t i = 0; i < m_fileList->GetItemCount(); ++i) {
            Rect itemRect = m_fileList->GetItemRect(static_cast<int>(i));
            if (itemRect.Contains(x, y)) {
                m_fileList->OnRightClick(static_cast<int>(i), x, y);
                break;
            }
        }
    }
}

inline void AssetBrowser::OnKeyDown(int keyCode) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    // Forward to search box first (handles Ctrl+F shortcut)
    m_searchBox->OnKeyDown(keyCode);

    // If search box is focused, let it handle all keys
    if (m_searchBox->IsFocused()) {
        return;
    }

    // Otherwise forward to file list for navigation
    m_fileList->OnKeyDown(keyCode);
}

inline void AssetBrowser::OnMouseMove(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    if (IsInFileListBounds(x, y)) {
        m_fileList->OnMouseMove(x, y);
    }
}

inline void AssetBrowser::OnMouseWheel(float delta) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    // Scroll file list
    float newOffset = m_fileList->GetScrollOffset() - delta * 20.0f;
    m_fileList->SetScrollOffset(newOffset);
}

inline void AssetBrowser::OnDragEnter() {
    m_dragDropZone->OnDragEnter();
}

inline void AssetBrowser::OnDrop(const std::vector<std::string>& paths) {
    m_dragDropZone->OnDrop(paths);
}

inline void AssetBrowser::OnDragLeave() {
    m_dragDropZone->OnDragLeave();
}

inline void AssetBrowser::ToggleDisplayMode() {
    DisplayMode currentMode = m_fileList->GetDisplayMode();
    DisplayMode newMode = (currentMode == DisplayMode::GRID) ? DisplayMode::LIST : DisplayMode::GRID;
    m_fileList->SetDisplayMode(newMode);

    LogDebug("Display mode: " + std::string(newMode == DisplayMode::GRID ? "GRID" : "LIST"));
}

inline DisplayMode AssetBrowser::GetDisplayMode() const {
    return m_fileList->GetDisplayMode();
}

inline void AssetBrowser::Update(float deltaTime) {
    // Guard: skip update if not visible
    if (!m_config.visible) {
        return;
    }

    m_searchBox->Update(deltaTime);
    m_fileList->Update(deltaTime);
    m_dragDropZone->Update(deltaTime);
}

inline void AssetBrowser::RegisterDebugChannel() {
    Core::EventData data;
    data.SetString("channel", "UI");
    data.SetString("component", "AssetBrowser");
    m_eventBus.Publish("debug.register", data);
}

inline void AssetBrowser::CalculateLayout() {
    // Calculate bounds for each child component
    float panelX = 0.0f;
    float panelY = 0.0f;

    // Position based on panel side configuration
    if (m_config.side == "left") {
        panelX = 0.0f;
    } else if (m_config.side == "right") {
        // Would need window width to position - set by parent
        panelX = 0.0f;
    }

    // Search box at top
    m_searchBoxBounds = Rect(
        panelX + COMPONENT_SPACING,
        panelY + COMPONENT_SPACING,
        m_config.width - 2 * COMPONENT_SPACING,
        m_searchBoxHeight
    );

    // File list below search box
    float fileListY = panelY + m_searchBoxHeight + 2 * COMPONENT_SPACING;
    float fileListHeight = m_config.height - m_searchBoxHeight - 3 * COMPONENT_SPACING;

    m_fileListBounds = Rect(
        panelX + COMPONENT_SPACING,
        fileListY,
        m_config.width - 2 * COMPONENT_SPACING,
        fileListHeight
    );

    // Drag-drop zone overlays entire panel
    m_dragDropBounds = Rect(
        panelX,
        panelY,
        m_config.width,
        m_config.height
    );
}

inline void AssetBrowser::UpdateChildBounds() {
    m_searchBox->SetBounds(m_searchBoxBounds);
    m_fileList->SetBounds(m_fileListBounds);
    m_dragDropZone->SetBounds(m_dragDropBounds);
}

inline bool AssetBrowser::IsInSearchBoxBounds(float x, float y) const {
    return m_searchBoxBounds.Contains(x, y);
}

inline bool AssetBrowser::IsInFileListBounds(float x, float y) const {
    return m_fileListBounds.Contains(x, y);
}

inline void AssetBrowser::OnFileSelected(const Core::Event& event) {
    // File was selected in the list, update UI state
    LogDebug("File selected in list");
}

inline void AssetBrowser::OnAssetSelected(const Core::Event& event) {
    // Asset was double-clicked and loaded into viewport
    const Core::EventData& data = event.GetData();
    std::string name = data.GetString("name");
    LogDebug("Asset loaded: " + name);
}

inline void AssetBrowser::OnIndexUpdated(const Core::Event& event) {
    // Asset index was updated, children will refresh automatically
    LogDebug("Asset index updated");
}

inline void AssetBrowser::LogDebug(const std::string& message) {
    Core::EventData data;
    data.SetString("message", "[AssetBrowser] " + message);
    data.SetString("level", "DEBUG");
    data.SetString("channel", "UI");
    m_eventBus.Publish("log.message", data);
}

} // namespace UI
} // namespace BrightForge
