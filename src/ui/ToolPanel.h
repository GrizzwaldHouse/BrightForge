/** ToolPanel.h - Left sidebar panel with tool selection buttons
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "../core/EventBus.h"
#include <string>
#include <vector>
#include <unordered_map>

namespace BrightForge {
namespace UI {

// Tool button configuration
struct ToolButton {
    ToolType tool;
    std::string icon;
    std::string tooltip;
    std::string section;
    bool enabled;

    ToolButton()
        : tool(ToolType::SELECT)
        , enabled(true)
    {}

    ToolButton(ToolType t, const std::string& i, const std::string& tt, const std::string& s)
        : tool(t), icon(i), tooltip(tt), section(s), enabled(true)
    {}
};

// Collapsible section in tool panel
struct ToolSection {
    std::string name;
    bool collapsed;
    std::vector<ToolButton> buttons;

    ToolSection() : collapsed(false) {}
    ToolSection(const std::string& n) : name(n), collapsed(false) {}
};

class ToolPanel {
public:
    ToolPanel(Core::EventBus& eventBus, const PanelConfig& config);
    ~ToolPanel();

    // Tool management
    void AddTool(ToolType tool, const std::string& icon, const std::string& tooltip, const std::string& section = "General");
    void RemoveTool(ToolType tool);
    void SetActiveTool(ToolType tool);
    ToolType GetActiveTool() const { return m_activeTool; }

    // Section management
    void AddSection(const std::string& name);
    void CollapseSection(const std::string& name, bool collapsed);
    bool IsSectionCollapsed(const std::string& name) const;

    // Input handlers
    void OnClick(float x, float y);
    void OnMouseMove(float x, float y);

    // Visual state
    const PanelConfig& GetConfig() const { return m_config; }
    void SetConfig(const PanelConfig& config);
    int GetHoveredButtonIndex() const { return m_hoveredButtonIndex; }
    const ToolButton* GetHoveredButton() const;

    // Panel visibility
    void SetVisible(bool visible);
    bool IsVisible() const { return m_config.visible; }

    // Layout
    Rect GetButtonRect(int buttonIndex) const;
    Rect GetSectionHeaderRect(const std::string& sectionName) const;

    // Update method
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    PanelConfig m_config;
    ToolType m_activeTool;

    // Tool organization
    std::vector<ToolSection> m_sections;
    std::unordered_map<std::string, size_t> m_sectionIndices;

    // Interaction state
    int m_hoveredButtonIndex;
    int m_pressedButtonIndex;

    // Scroll state
    float m_scrollOffset;

    // Event subscriptions
    size_t m_toolChangedSubscription;

    // Internal helpers
    void InitializeDefaultTools();
    int GetButtonIndexAtPosition(float x, float y) const;
    std::string GetSectionAtPosition(float x, float y) const;
    void OnToolClicked(ToolType tool);
    void OnSectionHeaderClicked(const std::string& sectionName);
    void OnToolChangedEvent(const Core::Event& event);
    ToolSection* FindSection(const std::string& name);
    const ToolSection* FindSection(const std::string& name) const;
    void PublishToolChanged(ToolType tool);
    void CalculateLayout();

    // Layout constants
    static constexpr float SECTION_HEADER_HEIGHT = 32.0f;
    static constexpr float BUTTON_SIZE = 48.0f;
    static constexpr float BUTTON_PADDING = 4.0f;
    static constexpr float SECTION_PADDING = 8.0f;
    static constexpr int BUTTONS_PER_ROW = 2;
};

// Implementation

inline ToolPanel::ToolPanel(Core::EventBus& eventBus, const PanelConfig& config)
    : m_eventBus(eventBus)
    , m_config(config)
    , m_activeTool(ToolType::SELECT)
    , m_hoveredButtonIndex(-1)
    , m_pressedButtonIndex(-1)
    , m_scrollOffset(0.0f)
{
    InitializeDefaultTools();

    // Subscribe to external tool changes
    m_toolChangedSubscription = m_eventBus.Subscribe("tool.changed",
        [this](const Core::Event& e) { OnToolChangedEvent(e); });
}

inline ToolPanel::~ToolPanel() {
    m_eventBus.Unsubscribe("tool.changed", m_toolChangedSubscription);
}

inline void ToolPanel::AddTool(ToolType tool, const std::string& icon,
                                const std::string& tooltip, const std::string& section) {
    // Find or create section
    ToolSection* targetSection = FindSection(section);

    if (!targetSection) {
        AddSection(section);
        targetSection = FindSection(section);
    }

    // Guard: section must exist
    if (!targetSection) {
        return;
    }

    // Add button to section
    targetSection->buttons.emplace_back(tool, icon, tooltip, section);

    CalculateLayout();
}

inline void ToolPanel::RemoveTool(ToolType tool) {
    for (auto& section : m_sections) {
        auto it = std::remove_if(section.buttons.begin(), section.buttons.end(),
            [tool](const ToolButton& btn) { return btn.tool == tool; });

        if (it != section.buttons.end()) {
            section.buttons.erase(it, section.buttons.end());
            CalculateLayout();
            return;
        }
    }
}

inline void ToolPanel::SetActiveTool(ToolType tool) {
    if (m_activeTool == tool) {
        return;
    }

    m_activeTool = tool;
    PublishToolChanged(tool);
}

inline void ToolPanel::AddSection(const std::string& name) {
    // Guard: prevent duplicate sections
    if (FindSection(name)) {
        return;
    }

    m_sections.emplace_back(name);
    m_sectionIndices[name] = m_sections.size() - 1;
}

inline void ToolPanel::CollapseSection(const std::string& name, bool collapsed) {
    ToolSection* section = FindSection(name);
    if (section) {
        section->collapsed = collapsed;
        CalculateLayout();
    }
}

inline bool ToolPanel::IsSectionCollapsed(const std::string& name) const {
    const ToolSection* section = FindSection(name);
    return section ? section->collapsed : false;
}

inline void ToolPanel::OnClick(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    // Check for section header click
    std::string sectionName = GetSectionAtPosition(x, y);
    if (!sectionName.empty()) {
        OnSectionHeaderClicked(sectionName);
        return;
    }

    // Check for button click
    int buttonIndex = GetButtonIndexAtPosition(x, y);
    if (buttonIndex >= 0) {
        // Find button by flat index
        int currentIndex = 0;
        for (const auto& section : m_sections) {
            if (section.collapsed) continue;

            for (const auto& button : section.buttons) {
                if (currentIndex == buttonIndex) {
                    OnToolClicked(button.tool);
                    return;
                }
                currentIndex++;
            }
        }
    }
}

inline void ToolPanel::OnMouseMove(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    m_hoveredButtonIndex = GetButtonIndexAtPosition(x, y);
}

inline const ToolButton* ToolPanel::GetHoveredButton() const {
    if (m_hoveredButtonIndex < 0) {
        return nullptr;
    }

    int currentIndex = 0;
    for (const auto& section : m_sections) {
        if (section.collapsed) continue;

        for (const auto& button : section.buttons) {
            if (currentIndex == m_hoveredButtonIndex) {
                return &button;
            }
            currentIndex++;
        }
    }

    return nullptr;
}

inline void ToolPanel::SetConfig(const PanelConfig& config) {
    m_config = config;
    CalculateLayout();
}

inline void ToolPanel::SetVisible(bool visible) {
    m_config.visible = visible;

    Core::EventData data;
    data.SetString("panel", "ToolPanel");
    data.SetBool("visible", visible);
    m_eventBus.Publish("ui.panel.visibility", data);
}

inline Rect ToolPanel::GetButtonRect(int buttonIndex) const {
    // Guard: validate index
    if (buttonIndex < 0) {
        return Rect();
    }

    float y = SECTION_PADDING - m_scrollOffset;

    int currentIndex = 0;

    for (const auto& section : m_sections) {
        // Section header
        y += SECTION_HEADER_HEIGHT;

        if (section.collapsed) {
            continue;
        }

        // Buttons in section
        for (size_t i = 0; i < section.buttons.size(); ++i) {
            if (currentIndex == buttonIndex) {
                int row = static_cast<int>(i) / BUTTONS_PER_ROW;
                int col = static_cast<int>(i) % BUTTONS_PER_ROW;

                float x = BUTTON_PADDING + col * (BUTTON_SIZE + BUTTON_PADDING);
                float buttonY = y + row * (BUTTON_SIZE + BUTTON_PADDING);

                return Rect(x, buttonY, BUTTON_SIZE, BUTTON_SIZE);
            }
            currentIndex++;
        }

        // Add height for buttons
        int rows = (static_cast<int>(section.buttons.size()) + BUTTONS_PER_ROW - 1) / BUTTONS_PER_ROW;
        y += rows * (BUTTON_SIZE + BUTTON_PADDING) + SECTION_PADDING;
    }

    return Rect();
}

inline Rect ToolPanel::GetSectionHeaderRect(const std::string& sectionName) const {
    float y = SECTION_PADDING - m_scrollOffset;

    for (const auto& section : m_sections) {
        if (section.name == sectionName) {
            return Rect(0.0f, y, m_config.width, SECTION_HEADER_HEIGHT);
        }

        y += SECTION_HEADER_HEIGHT;

        if (!section.collapsed) {
            int rows = (static_cast<int>(section.buttons.size()) + BUTTONS_PER_ROW - 1) / BUTTONS_PER_ROW;
            y += rows * (BUTTON_SIZE + BUTTON_PADDING) + SECTION_PADDING;
        }
    }

    return Rect();
}

inline void ToolPanel::Update(float deltaTime) {
    // Animation updates would go here
}

inline void ToolPanel::InitializeDefaultTools() {
    // Transform Tools section
    AddSection("Transform Tools");
    AddTool(ToolType::SELECT, "cursor", "Select (V)", "Transform Tools");
    AddTool(ToolType::MOVE, "move", "Move (G)", "Transform Tools");
    AddTool(ToolType::ROTATE, "rotate-cw", "Rotate (R)", "Transform Tools");
    AddTool(ToolType::SCALE, "maximize", "Scale (S)", "Transform Tools");

    // Selection Modes section
    AddSection("Selection Modes");
    // These would map to selection mode changes, not tools

    // Sculpt Tools section
    AddSection("Sculpt Tools");
    AddTool(ToolType::SCULPT_SMOOTH, "circle", "Smooth", "Sculpt Tools");
    AddTool(ToolType::SCULPT_INFLATE, "plus-circle", "Inflate", "Sculpt Tools");
    AddTool(ToolType::SCULPT_PINCH, "minimize-2", "Pinch", "Sculpt Tools");
    AddTool(ToolType::SCULPT_FLATTEN, "minus-circle", "Flatten", "Sculpt Tools");
}

inline int ToolPanel::GetButtonIndexAtPosition(float x, float y) const {
    int currentIndex = 0;

    for (const auto& section : m_sections) {
        if (section.collapsed) continue;

        for (size_t i = 0; i < section.buttons.size(); ++i) {
            Rect buttonRect = GetButtonRect(currentIndex);
            if (buttonRect.Contains(x, y)) {
                return currentIndex;
            }
            currentIndex++;
        }
    }

    return -1;
}

inline std::string ToolPanel::GetSectionAtPosition(float x, float y) const {
    for (const auto& section : m_sections) {
        Rect headerRect = GetSectionHeaderRect(section.name);
        if (headerRect.Contains(x, y)) {
            return section.name;
        }
    }

    return "";
}

inline void ToolPanel::OnToolClicked(ToolType tool) {
    SetActiveTool(tool);

    Core::EventData logData;
    logData.SetString("message", "Tool selected: " + std::to_string(static_cast<int>(tool)));
    logData.SetString("level", "INFO");
    m_eventBus.Publish("log.message", logData);
}

inline void ToolPanel::OnSectionHeaderClicked(const std::string& sectionName) {
    ToolSection* section = FindSection(sectionName);
    if (section) {
        section->collapsed = !section->collapsed;
        CalculateLayout();
    }
}

inline void ToolPanel::OnToolChangedEvent(const Core::Event& event) {
    const Core::EventData& data = event.GetData();
    int toolType = data.GetInt("tool");
    m_activeTool = static_cast<ToolType>(toolType);
}

inline ToolSection* ToolPanel::FindSection(const std::string& name) {
    auto it = m_sectionIndices.find(name);
    if (it != m_sectionIndices.end() && it->second < m_sections.size()) {
        return &m_sections[it->second];
    }
    return nullptr;
}

inline const ToolSection* ToolPanel::FindSection(const std::string& name) const {
    auto it = m_sectionIndices.find(name);
    if (it != m_sectionIndices.end() && it->second < m_sections.size()) {
        return &m_sections[it->second];
    }
    return nullptr;
}

inline void ToolPanel::PublishToolChanged(ToolType tool) {
    Core::EventData data;
    data.SetInt("tool", static_cast<int>(tool));
    m_eventBus.Publish("tool.changed", data);
}

inline void ToolPanel::CalculateLayout() {
    // Layout recalculation happens on-demand during rendering
    // This method is a hook for future optimizations
}

} // namespace UI
} // namespace BrightForge
