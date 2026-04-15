/** MenuBar.h - Top menu bar with application commands
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

// Menu item types
enum class MenuItemType {
    ACTION,     // Triggers an event
    TOGGLE,     // Boolean state toggle
    SEPARATOR,  // Visual separator
    SUBMENU     // Opens submenu
};

// Individual menu item
struct MenuItem {
    std::string id;
    std::string label;
    std::string shortcut;
    MenuItemType type;
    bool enabled;
    bool checked; // For toggle items
    std::vector<MenuItem> submenuItems;

    MenuItem()
        : type(MenuItemType::ACTION)
        , enabled(true)
        , checked(false)
    {}

    MenuItem(const std::string& id_, const std::string& label_,
             const std::string& shortcut_ = "", MenuItemType type_ = MenuItemType::ACTION)
        : id(id_), label(label_), shortcut(shortcut_), type(type_)
        , enabled(true), checked(false)
    {}
};

// Top-level menu
struct Menu {
    std::string name;
    std::vector<MenuItem> items;

    Menu() {}
    Menu(const std::string& n) : name(n) {}
};

class MenuBar {
public:
    MenuBar(Core::EventBus& eventBus, float height = 32.0f);
    ~MenuBar();

    // Menu management
    void AddMenu(const std::string& name);
    void AddMenuItem(const std::string& menuName, const MenuItem& item);
    void AddSeparator(const std::string& menuName);
    void SetMenuItemEnabled(const std::string& menuName, const std::string& itemId, bool enabled);
    void SetMenuItemChecked(const std::string& menuName, const std::string& itemId, bool checked);

    // Input handlers
    void OnClick(float x, float y);
    void OnMouseMove(float x, float y);

    // Visual state
    float GetHeight() const { return m_height; }
    Rect GetBounds() const { return Rect(0.0f, 0.0f, m_width, m_height); }
    void SetWidth(float width) { m_width = width; }
    int GetHoveredMenuIndex() const { return m_hoveredMenuIndex; }
    int GetOpenMenuIndex() const { return m_openMenuIndex; }

    // Quick-access toolbar
    void AddQuickAccessButton(const std::string& id, const std::string& icon, const std::string& tooltip);
    void OnQuickAccessClick(const std::string& id);

    // Update method
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    float m_height;
    float m_width;

    // Menu structure
    std::vector<Menu> m_menus;
    std::vector<MenuItem> m_quickAccessButtons;

    // Interaction state
    int m_hoveredMenuIndex;
    int m_openMenuIndex;
    int m_hoveredItemIndex;

    // Internal helpers
    void InitializeDefaultMenus();
    int GetMenuIndexAtPosition(float x, float y) const;
    int GetMenuItemIndexAtPosition(const Menu& menu, float x, float y) const;
    void OnMenuItemClicked(const std::string& menuName, const MenuItem& item);
    void PublishMenuAction(const std::string& actionId);
    Menu* FindMenu(const std::string& name);
    MenuItem* FindMenuItem(const std::string& menuName, const std::string& itemId);
    Rect GetMenuRect(int menuIndex) const;
    Rect GetMenuItemRect(const Menu& menu, int itemIndex) const;

    // Layout constants
    static constexpr float MENU_PADDING = 12.0f;
    static constexpr float MENU_ITEM_HEIGHT = 28.0f;
    static constexpr float SEPARATOR_HEIGHT = 8.0f;
    static constexpr float QUICK_ACCESS_SIZE = 24.0f;
    static constexpr float QUICK_ACCESS_PADDING = 4.0f;
};

// Implementation

inline MenuBar::MenuBar(Core::EventBus& eventBus, float height)
    : m_eventBus(eventBus)
    , m_height(height)
    , m_width(1920.0f)
    , m_hoveredMenuIndex(-1)
    , m_openMenuIndex(-1)
    , m_hoveredItemIndex(-1)
{
    InitializeDefaultMenus();
}

inline MenuBar::~MenuBar() {
    // No subscriptions to clean up
}

inline void MenuBar::AddMenu(const std::string& name) {
    // Guard: prevent duplicate menus
    if (FindMenu(name)) {
        return;
    }

    m_menus.emplace_back(name);
}

inline void MenuBar::AddMenuItem(const std::string& menuName, const MenuItem& item) {
    Menu* menu = FindMenu(menuName);
    if (menu) {
        menu->items.push_back(item);
    }
}

inline void MenuBar::AddSeparator(const std::string& menuName) {
    MenuItem separator;
    separator.type = MenuItemType::SEPARATOR;
    AddMenuItem(menuName, separator);
}

inline void MenuBar::SetMenuItemEnabled(const std::string& menuName,
                                         const std::string& itemId, bool enabled) {
    MenuItem* item = FindMenuItem(menuName, itemId);
    if (item) {
        item->enabled = enabled;
    }
}

inline void MenuBar::SetMenuItemChecked(const std::string& menuName,
                                         const std::string& itemId, bool checked) {
    MenuItem* item = FindMenuItem(menuName, itemId);
    if (item && item->type == MenuItemType::TOGGLE) {
        item->checked = checked;
    }
}

inline void MenuBar::OnClick(float x, float y) {
    // Check for menu click
    int menuIndex = GetMenuIndexAtPosition(x, y);

    if (menuIndex >= 0) {
        // Toggle menu open/close
        if (m_openMenuIndex == menuIndex) {
            m_openMenuIndex = -1;
        } else {
            m_openMenuIndex = menuIndex;
        }
        return;
    }

    // Check for menu item click if menu is open
    if (m_openMenuIndex >= 0 && m_openMenuIndex < static_cast<int>(m_menus.size())) {
        const Menu& menu = m_menus[m_openMenuIndex];
        int itemIndex = GetMenuItemIndexAtPosition(menu, x, y);

        if (itemIndex >= 0) {
            const MenuItem& item = menu.items[itemIndex];

            // Guard: skip disabled and separator items
            if (!item.enabled || item.type == MenuItemType::SEPARATOR) {
                return;
            }

            OnMenuItemClicked(menu.name, item);
            m_openMenuIndex = -1; // Close menu after selection
        }
    }

    // Check for quick access button click
    // Quick access buttons are positioned on right side of menu bar
    float quickAccessX = m_width - 200.0f; // Reserve 200px for buttons
    if (x >= quickAccessX && y <= m_height) {
        // Calculate which button was clicked
        int buttonIndex = static_cast<int>((x - quickAccessX) / (QUICK_ACCESS_SIZE + QUICK_ACCESS_PADDING));
        if (buttonIndex >= 0 && buttonIndex < static_cast<int>(m_quickAccessButtons.size())) {
            OnQuickAccessClick(m_quickAccessButtons[buttonIndex].id);
        }
    }
}

inline void MenuBar::OnMouseMove(float x, float y) {
    m_hoveredMenuIndex = GetMenuIndexAtPosition(x, y);

    // Update hovered item if menu is open
    if (m_openMenuIndex >= 0 && m_openMenuIndex < static_cast<int>(m_menus.size())) {
        const Menu& menu = m_menus[m_openMenuIndex];
        m_hoveredItemIndex = GetMenuItemIndexAtPosition(menu, x, y);
    }
}

inline void MenuBar::AddQuickAccessButton(const std::string& id,
                                           const std::string& icon,
                                           const std::string& tooltip) {
    MenuItem button(id, "", "", MenuItemType::ACTION);
    button.label = tooltip; // Store tooltip in label
    m_quickAccessButtons.push_back(button);
}

inline void MenuBar::OnQuickAccessClick(const std::string& id) {
    PublishMenuAction(id);
}

inline void MenuBar::Update(float deltaTime) {
    // Animation updates would go here
}

inline void MenuBar::InitializeDefaultMenus() {
    // File menu
    AddMenu("File");
    AddMenuItem("File", MenuItem("file.new", "New Project", "Ctrl+N"));
    AddMenuItem("File", MenuItem("file.open", "Open", "Ctrl+O"));
    AddMenuItem("File", MenuItem("file.save", "Save", "Ctrl+S"));
    AddSeparator("File");
    AddMenuItem("File", MenuItem("file.import", "Import Asset", "Ctrl+I"));
    AddMenuItem("File", MenuItem("file.export", "Export", "Ctrl+E"));
    AddSeparator("File");
    AddMenuItem("File", MenuItem("file.exit", "Exit", "Alt+F4"));

    // Edit menu
    AddMenu("Edit");
    AddMenuItem("Edit", MenuItem("edit.undo", "Undo", "Ctrl+Z"));
    AddMenuItem("Edit", MenuItem("edit.redo", "Redo", "Ctrl+Y"));
    AddSeparator("Edit");
    AddMenuItem("Edit", MenuItem("edit.preferences", "Preferences", "Ctrl+,"));

    // View menu
    AddMenu("View");
    MenuItem toggleToolPanel("view.toggle_toolpanel", "Tool Panel", "");
    toggleToolPanel.type = MenuItemType::TOGGLE;
    toggleToolPanel.checked = true;
    AddMenuItem("View", toggleToolPanel);

    MenuItem togglePropertyInspector("view.toggle_propertyinspector", "Property Inspector", "");
    togglePropertyInspector.type = MenuItemType::TOGGLE;
    togglePropertyInspector.checked = true;
    AddMenuItem("View", togglePropertyInspector);

    MenuItem toggleAssetBrowser("view.toggle_assetbrowser", "Asset Browser", "");
    toggleAssetBrowser.type = MenuItemType::TOGGLE;
    toggleAssetBrowser.checked = true;
    AddMenuItem("View", toggleAssetBrowser);

    AddSeparator("View");
    AddMenuItem("View", MenuItem("view.reset_layout", "Reset Layout", ""));

    MenuItem wireframeToggle("view.wireframe", "Wireframe", "W");
    wireframeToggle.type = MenuItemType::TOGGLE;
    wireframeToggle.checked = false;
    AddMenuItem("View", wireframeToggle);

    // Tools menu
    AddMenu("Tools");
    AddMenuItem("Tools", MenuItem("tool.select", "Select", "V"));
    AddMenuItem("Tools", MenuItem("tool.move", "Move", "G"));
    AddMenuItem("Tools", MenuItem("tool.rotate", "Rotate", "R"));
    AddMenuItem("Tools", MenuItem("tool.scale", "Scale", "S"));

    // Help menu
    AddMenu("Help");
    AddMenuItem("Help", MenuItem("help.documentation", "Documentation", "F1"));
    AddMenuItem("Help", MenuItem("help.about", "About", ""));

    // Quick access toolbar
    AddQuickAccessButton("file.import", "upload", "Import Asset");
    AddQuickAccessButton("file.save", "save", "Save");
    AddQuickAccessButton("edit.undo", "rotate-ccw", "Undo");
    AddQuickAccessButton("edit.redo", "rotate-cw", "Redo");
}

inline int MenuBar::GetMenuIndexAtPosition(float x, float y) const {
    // Guard: check if within menu bar bounds
    if (y > m_height) {
        return -1;
    }

    float currentX = MENU_PADDING;

    for (size_t i = 0; i < m_menus.size(); ++i) {
        const Menu& menu = m_menus[i];
        float menuWidth = menu.name.length() * 8.0f + 2 * MENU_PADDING; // Approximate text width

        if (x >= currentX && x <= currentX + menuWidth) {
            return static_cast<int>(i);
        }

        currentX += menuWidth;
    }

    return -1;
}

inline int MenuBar::GetMenuItemIndexAtPosition(const Menu& menu, float x, float y) const {
    // Menu dropdown appears below menu bar
    float currentY = m_height;

    for (size_t i = 0; i < menu.items.size(); ++i) {
        const MenuItem& item = menu.items[i];

        float itemHeight = (item.type == MenuItemType::SEPARATOR) ?
                          SEPARATOR_HEIGHT : MENU_ITEM_HEIGHT;

        Rect itemRect(0.0f, currentY, 200.0f, itemHeight); // Fixed width dropdown
        if (itemRect.Contains(x, y)) {
            return static_cast<int>(i);
        }

        currentY += itemHeight;
    }

    return -1;
}

inline void MenuBar::OnMenuItemClicked(const std::string& menuName, const MenuItem& item) {
    if (item.type == MenuItemType::TOGGLE) {
        // Toggle checked state
        SetMenuItemChecked(menuName, item.id, !item.checked);
    }

    PublishMenuAction(item.id);

    Core::EventData logData;
    logData.SetString("message", "Menu action: " + item.id);
    logData.SetString("level", "INFO");
    m_eventBus.Publish("log.message", logData);
}

inline void MenuBar::PublishMenuAction(const std::string& actionId) {
    Core::EventData data;
    data.SetString("action", actionId);

    // Map action IDs to specific events
    if (actionId == "file.import") {
        m_eventBus.Publish("menu.import", data);
    } else if (actionId == "file.save") {
        m_eventBus.Publish("menu.save", data);
    } else if (actionId == "file.new") {
        m_eventBus.Publish("menu.new", data);
    } else if (actionId == "file.open") {
        m_eventBus.Publish("menu.open", data);
    } else if (actionId == "file.export") {
        m_eventBus.Publish("menu.export", data);
    } else if (actionId == "file.exit") {
        m_eventBus.Publish("menu.exit", data);
    } else if (actionId == "edit.undo") {
        m_eventBus.Publish("menu.undo", data);
    } else if (actionId == "edit.redo") {
        m_eventBus.Publish("menu.redo", data);
    } else if (actionId == "edit.preferences") {
        m_eventBus.Publish("menu.preferences", data);
    } else if (actionId == "view.toggle_toolpanel") {
        data.SetString("panel", "ToolPanel");
        m_eventBus.Publish("menu.toggle_panel", data);
    } else if (actionId == "view.toggle_propertyinspector") {
        data.SetString("panel", "PropertyInspector");
        m_eventBus.Publish("menu.toggle_panel", data);
    } else if (actionId == "view.toggle_assetbrowser") {
        data.SetString("panel", "AssetBrowser");
        m_eventBus.Publish("menu.toggle_panel", data);
    } else if (actionId == "view.reset_layout") {
        m_eventBus.Publish("menu.reset_layout", data);
    } else if (actionId == "view.wireframe") {
        m_eventBus.Publish("menu.toggle_wireframe", data);
    } else if (actionId.find("tool.") == 0) {
        // Tool selection
        m_eventBus.Publish("menu.select_tool", data);
    } else if (actionId == "help.documentation") {
        m_eventBus.Publish("menu.help", data);
    } else if (actionId == "help.about") {
        m_eventBus.Publish("menu.about", data);
    }
}

inline Menu* MenuBar::FindMenu(const std::string& name) {
    for (auto& menu : m_menus) {
        if (menu.name == name) {
            return &menu;
        }
    }
    return nullptr;
}

inline MenuItem* MenuBar::FindMenuItem(const std::string& menuName, const std::string& itemId) {
    Menu* menu = FindMenu(menuName);
    if (!menu) {
        return nullptr;
    }

    for (auto& item : menu->items) {
        if (item.id == itemId) {
            return &item;
        }
    }

    return nullptr;
}

inline Rect MenuBar::GetMenuRect(int menuIndex) const {
    // Guard: validate index
    if (menuIndex < 0 || menuIndex >= static_cast<int>(m_menus.size())) {
        return Rect();
    }

    float currentX = MENU_PADDING;

    for (int i = 0; i < menuIndex; ++i) {
        float menuWidth = m_menus[i].name.length() * 8.0f + 2 * MENU_PADDING;
        currentX += menuWidth;
    }

    float menuWidth = m_menus[menuIndex].name.length() * 8.0f + 2 * MENU_PADDING;
    return Rect(currentX, 0.0f, menuWidth, m_height);
}

inline Rect MenuBar::GetMenuItemRect(const Menu& menu, int itemIndex) const {
    // Guard: validate index
    if (itemIndex < 0 || itemIndex >= static_cast<int>(menu.items.size())) {
        return Rect();
    }

    float currentY = m_height;

    for (int i = 0; i < itemIndex; ++i) {
        const MenuItem& item = menu.items[i];
        float itemHeight = (item.type == MenuItemType::SEPARATOR) ?
                          SEPARATOR_HEIGHT : MENU_ITEM_HEIGHT;
        currentY += itemHeight;
    }

    const MenuItem& item = menu.items[itemIndex];
    float itemHeight = (item.type == MenuItemType::SEPARATOR) ?
                      SEPARATOR_HEIGHT : MENU_ITEM_HEIGHT;

    return Rect(0.0f, currentY, 200.0f, itemHeight);
}

} // namespace UI
} // namespace BrightForge
