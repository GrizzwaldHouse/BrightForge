/** FileList.h - Displays asset search results with grid/list view modes
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "../core/EventBus.h"
#include <string>
#include <vector>

namespace BrightForge {
namespace UI {

// Asset information structure for display
struct AssetInfo {
    std::string path;
    std::string name;
    std::string format;
    size_t vertexCount;
    size_t faceCount;
    size_t fileSizeBytes;
    std::string thumbnailPath;
    bool hasErrors;

    AssetInfo()
        : vertexCount(0)
        , faceCount(0)
        , fileSizeBytes(0)
        , hasErrors(false)
    {}
};

// Context menu action types
enum class ContextMenuAction {
    RENAME,
    DELETE,
    PROPERTIES,
    DUPLICATE,
    EXPORT,
    RELOAD,
    SHOW_IN_EXPLORER
};

class FileList {
public:
    FileList(Core::EventBus& eventBus, const Rect& bounds, DisplayMode mode);
    ~FileList();

    // Item management
    void SetItems(const std::vector<AssetInfo>& items);
    const std::vector<AssetInfo>& GetItems() const { return m_items; }
    size_t GetItemCount() const { return m_items.size(); }

    // Selection
    int GetSelectedIndex() const { return m_selectedIndex; }
    const AssetInfo* GetSelectedItem() const;
    void SetSelectedIndex(int index);
    void ClearSelection();

    // Display mode
    void SetDisplayMode(DisplayMode mode);
    DisplayMode GetDisplayMode() const { return m_displayMode; }

    // Input handlers
    void OnClick(float x, float y);
    void OnDoubleClick(int index);
    void OnRightClick(int index, float x, float y);
    void OnKeyDown(int keyCode);
    void OnMouseMove(float x, float y);

    // Visual state
    const Rect& GetBounds() const { return m_bounds; }
    void SetBounds(const Rect& bounds);
    int GetHoveredIndex() const { return m_hoveredIndex; }
    Rect GetItemRect(int index) const;

    // Scrolling
    void SetScrollOffset(float offset);
    float GetScrollOffset() const { return m_scrollOffset; }
    float GetMaxScrollOffset() const;
    void ScrollToItem(int index);

    // Configuration
    void SetItemsPerRow(int count) { m_itemsPerRow = count; }
    void SetItemSize(float width, float height);

    // Update method
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    Rect m_bounds;
    DisplayMode m_displayMode;

    // Items and selection
    std::vector<AssetInfo> m_items;
    int m_selectedIndex;
    int m_hoveredIndex;

    // Layout configuration
    float m_itemWidth;
    float m_itemHeight;
    int m_itemsPerRow;
    float m_scrollOffset;

    // Context menu state
    bool m_contextMenuOpen;
    Rect m_contextMenuBounds;
    int m_contextMenuTargetIndex;

    // Event subscriptions
    size_t m_searchQuerySubscription;
    size_t m_indexUpdatedSubscription;

    // Internal helpers
    int GetItemIndexAtPosition(float x, float y) const;
    void CalculateLayout();
    void OnSearchQuery(const Core::Event& event);
    void OnIndexUpdated(const Core::Event& event);
    void HandleContextMenuAction(ContextMenuAction action, int itemIndex);
    void PublishSelectionEvent(const AssetInfo& item);

    // Keyboard navigation
    void NavigateUp();
    void NavigateDown();
    void NavigateLeft();
    void NavigateRight();
    void ConfirmSelection();

    // Key codes
    static constexpr int KEY_UP = 38;
    static constexpr int KEY_DOWN = 40;
    static constexpr int KEY_LEFT = 37;
    static constexpr int KEY_RIGHT = 39;
    static constexpr int KEY_ENTER = 13;
    static constexpr int KEY_DELETE = 46;
    static constexpr int KEY_F2 = 113;

    // Layout constants
    static constexpr float GRID_ITEM_WIDTH = 120.0f;
    static constexpr float GRID_ITEM_HEIGHT = 140.0f;
    static constexpr float LIST_ITEM_HEIGHT = 40.0f;
    static constexpr float ITEM_PADDING = 8.0f;
    static constexpr float SCROLL_SPEED = 20.0f;
};

// Implementation

inline FileList::FileList(Core::EventBus& eventBus, const Rect& bounds, DisplayMode mode)
    : m_eventBus(eventBus)
    , m_bounds(bounds)
    , m_displayMode(mode)
    , m_selectedIndex(-1)
    , m_hoveredIndex(-1)
    , m_itemWidth(GRID_ITEM_WIDTH)
    , m_itemHeight(mode == DisplayMode::GRID ? GRID_ITEM_HEIGHT : LIST_ITEM_HEIGHT)
    , m_itemsPerRow(1)
    , m_scrollOffset(0.0f)
    , m_contextMenuOpen(false)
    , m_contextMenuTargetIndex(-1)
{
    CalculateLayout();

    // Subscribe to search events
    m_searchQuerySubscription = m_eventBus.Subscribe("search.query",
        [this](const Core::Event& e) { OnSearchQuery(e); });

    m_indexUpdatedSubscription = m_eventBus.Subscribe("index.updated",
        [this](const Core::Event& e) { OnIndexUpdated(e); });
}

inline FileList::~FileList() {
    m_eventBus.Unsubscribe("search.query", m_searchQuerySubscription);
    m_eventBus.Unsubscribe("index.updated", m_indexUpdatedSubscription);
}

inline void FileList::SetItems(const std::vector<AssetInfo>& items) {
    m_items = items;

    // Preserve selection if item still exists
    if (m_selectedIndex >= static_cast<int>(m_items.size())) {
        m_selectedIndex = -1;
    }

    CalculateLayout();
}

inline const AssetInfo* FileList::GetSelectedItem() const {
    if (m_selectedIndex < 0 || m_selectedIndex >= static_cast<int>(m_items.size())) {
        return nullptr;
    }
    return &m_items[m_selectedIndex];
}

inline void FileList::SetSelectedIndex(int index) {
    // Guard: validate index
    if (index < -1 || index >= static_cast<int>(m_items.size())) {
        return;
    }

    m_selectedIndex = index;

    if (index >= 0) {
        ScrollToItem(index);
    }
}

inline void FileList::ClearSelection() {
    m_selectedIndex = -1;
}

inline void FileList::SetDisplayMode(DisplayMode mode) {
    if (m_displayMode == mode) {
        return;
    }

    m_displayMode = mode;
    m_itemHeight = (mode == DisplayMode::GRID) ? GRID_ITEM_HEIGHT : LIST_ITEM_HEIGHT;
    CalculateLayout();
}

inline void FileList::SetBounds(const Rect& bounds) {
    m_bounds = bounds;
    CalculateLayout();
}

inline void FileList::OnClick(float x, float y) {
    int index = GetItemIndexAtPosition(x, y);
    SetSelectedIndex(index);

    if (index >= 0) {
        PublishSelectionEvent(m_items[index]);
    }
}

inline void FileList::OnDoubleClick(int index) {
    // Guard: validate index
    if (index < 0 || index >= static_cast<int>(m_items.size())) {
        return;
    }

    const AssetInfo& item = m_items[index];

    // Publish asset selection event for viewport to load
    Core::EventData data;
    data.SetString("path", item.path);
    data.SetString("name", item.name);
    data.SetString("format", item.format);
    m_eventBus.Publish("asset.selected", data);

    Core::EventData logData;
    logData.SetString("message", "Asset selected: " + item.name);
    logData.SetString("level", "INFO");
    m_eventBus.Publish("log.message", logData);
}

inline void FileList::OnRightClick(int index, float x, float y) {
    // Guard: validate index
    if (index < 0 || index >= static_cast<int>(m_items.size())) {
        return;
    }

    m_contextMenuOpen = true;
    m_contextMenuTargetIndex = index;
    m_contextMenuBounds = Rect(x, y, 150.0f, 200.0f);

    // Publish context menu event for UI system to render
    Core::EventData data;
    data.SetInt("itemIndex", index);
    data.SetFloat("x", x);
    data.SetFloat("y", y);
    m_eventBus.Publish("ui.contextmenu.open", data);
}

inline void FileList::OnKeyDown(int keyCode) {
    switch (keyCode) {
        case KEY_UP:
            NavigateUp();
            break;
        case KEY_DOWN:
            NavigateDown();
            break;
        case KEY_LEFT:
            NavigateLeft();
            break;
        case KEY_RIGHT:
            NavigateRight();
            break;
        case KEY_ENTER:
            ConfirmSelection();
            break;
        case KEY_DELETE:
            if (m_selectedIndex >= 0) {
                HandleContextMenuAction(ContextMenuAction::DELETE, m_selectedIndex);
            }
            break;
        case KEY_F2:
            if (m_selectedIndex >= 0) {
                HandleContextMenuAction(ContextMenuAction::RENAME, m_selectedIndex);
            }
            break;
    }
}

inline void FileList::OnMouseMove(float x, float y) {
    int newHoveredIndex = GetItemIndexAtPosition(x, y);
    if (newHoveredIndex != m_hoveredIndex) {
        m_hoveredIndex = newHoveredIndex;
    }
}

inline Rect FileList::GetItemRect(int index) const {
    // Guard: validate index
    if (index < 0 || index >= static_cast<int>(m_items.size())) {
        return Rect();
    }

    if (m_displayMode == DisplayMode::GRID) {
        int row = index / m_itemsPerRow;
        int col = index % m_itemsPerRow;

        float x = m_bounds.x + col * (m_itemWidth + ITEM_PADDING);
        float y = m_bounds.y + row * (m_itemHeight + ITEM_PADDING) - m_scrollOffset;

        return Rect(x, y, m_itemWidth, m_itemHeight);
    } else {
        float x = m_bounds.x;
        float y = m_bounds.y + index * (m_itemHeight + ITEM_PADDING) - m_scrollOffset;

        return Rect(x, y, m_bounds.width, m_itemHeight);
    }
}

inline void FileList::SetScrollOffset(float offset) {
    float maxOffset = GetMaxScrollOffset();
    m_scrollOffset = std::max(0.0f, std::min(offset, maxOffset));
}

inline float FileList::GetMaxScrollOffset() const {
    if (m_items.empty()) {
        return 0.0f;
    }

    float totalHeight;
    if (m_displayMode == DisplayMode::GRID) {
        int rows = (static_cast<int>(m_items.size()) + m_itemsPerRow - 1) / m_itemsPerRow;
        totalHeight = rows * (m_itemHeight + ITEM_PADDING);
    } else {
        totalHeight = m_items.size() * (m_itemHeight + ITEM_PADDING);
    }

    return std::max(0.0f, totalHeight - m_bounds.height);
}

inline void FileList::ScrollToItem(int index) {
    Rect itemRect = GetItemRect(index);

    // Scroll if item is above visible area
    if (itemRect.y < m_bounds.y) {
        SetScrollOffset(m_scrollOffset - (m_bounds.y - itemRect.y));
    }
    // Scroll if item is below visible area
    else if (itemRect.y + itemRect.height > m_bounds.y + m_bounds.height) {
        SetScrollOffset(m_scrollOffset + (itemRect.y + itemRect.height - m_bounds.y - m_bounds.height));
    }
}

inline void FileList::SetItemSize(float width, float height) {
    m_itemWidth = width;
    m_itemHeight = height;
    CalculateLayout();
}

inline void FileList::Update(float deltaTime) {
    // Animation updates would go here
    // Currently no animations needed
}

inline int FileList::GetItemIndexAtPosition(float x, float y) const {
    // Guard: check if position is within bounds
    if (!m_bounds.Contains(x, y)) {
        return -1;
    }

    for (size_t i = 0; i < m_items.size(); ++i) {
        Rect itemRect = GetItemRect(static_cast<int>(i));
        if (itemRect.Contains(x, y)) {
            return static_cast<int>(i);
        }
    }

    return -1;
}

inline void FileList::CalculateLayout() {
    if (m_displayMode == DisplayMode::GRID) {
        m_itemsPerRow = std::max(1, static_cast<int>(m_bounds.width / (m_itemWidth + ITEM_PADDING)));
    } else {
        m_itemsPerRow = 1;
    }
}

inline void FileList::OnSearchQuery(const Core::Event& event) {
    // Filter display based on search query
    // Actual filtering is done by AssetIndex, this just refreshes display
    const Core::EventData& data = event.GetData();
    std::string query = data.GetString("query");

    // Request filtered results from index
    Core::EventData requestData;
    requestData.SetString("query", query);
    m_eventBus.Publish("index.query", requestData);
}

inline void FileList::OnIndexUpdated(const Core::Event& event) {
    // Index has changed, refresh display
    // Items will be updated via SetItems() called by parent component
}

inline void FileList::HandleContextMenuAction(ContextMenuAction action, int itemIndex) {
    // Guard: validate index
    if (itemIndex < 0 || itemIndex >= static_cast<int>(m_items.size())) {
        return;
    }

    const AssetInfo& item = m_items[itemIndex];

    Core::EventData data;
    data.SetString("path", item.path);
    data.SetInt("itemIndex", itemIndex);

    switch (action) {
        case ContextMenuAction::RENAME:
            m_eventBus.Publish("file.rename", data);
            break;
        case ContextMenuAction::DELETE:
            m_eventBus.Publish("file.delete", data);
            break;
        case ContextMenuAction::PROPERTIES:
            m_eventBus.Publish("file.properties", data);
            break;
        case ContextMenuAction::DUPLICATE:
            m_eventBus.Publish("file.duplicate", data);
            break;
        case ContextMenuAction::EXPORT:
            m_eventBus.Publish("file.export", data);
            break;
        case ContextMenuAction::RELOAD:
            m_eventBus.Publish("file.reload", data);
            break;
        case ContextMenuAction::SHOW_IN_EXPLORER:
            m_eventBus.Publish("file.show_in_explorer", data);
            break;
    }

    m_contextMenuOpen = false;
}

inline void FileList::PublishSelectionEvent(const AssetInfo& item) {
    Core::EventData data;
    data.SetString("path", item.path);
    data.SetString("name", item.name);
    data.SetString("format", item.format);
    data.SetInt("vertexCount", static_cast<int>(item.vertexCount));
    data.SetInt("faceCount", static_cast<int>(item.faceCount));
    m_eventBus.Publish("file.selected", data);
}

inline void FileList::NavigateUp() {
    if (m_items.empty()) return;

    if (m_displayMode == DisplayMode::GRID) {
        int newIndex = m_selectedIndex - m_itemsPerRow;
        if (newIndex >= 0) {
            SetSelectedIndex(newIndex);
        }
    } else {
        if (m_selectedIndex > 0) {
            SetSelectedIndex(m_selectedIndex - 1);
        }
    }
}

inline void FileList::NavigateDown() {
    if (m_items.empty()) return;

    if (m_displayMode == DisplayMode::GRID) {
        int newIndex = m_selectedIndex + m_itemsPerRow;
        if (newIndex < static_cast<int>(m_items.size())) {
            SetSelectedIndex(newIndex);
        }
    } else {
        if (m_selectedIndex < static_cast<int>(m_items.size()) - 1) {
            SetSelectedIndex(m_selectedIndex + 1);
        }
    }
}

inline void FileList::NavigateLeft() {
    if (m_items.empty() || m_displayMode != DisplayMode::GRID) return;

    if (m_selectedIndex > 0) {
        SetSelectedIndex(m_selectedIndex - 1);
    }
}

inline void FileList::NavigateRight() {
    if (m_items.empty() || m_displayMode != DisplayMode::GRID) return;

    if (m_selectedIndex < static_cast<int>(m_items.size()) - 1) {
        SetSelectedIndex(m_selectedIndex + 1);
    }
}

inline void FileList::ConfirmSelection() {
    if (m_selectedIndex >= 0) {
        OnDoubleClick(m_selectedIndex);
    }
}

} // namespace UI
} // namespace BrightForge
