/** PropertyInspector.h - Right sidebar showing selected object properties
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include "UITypes.h"
#include "GizmoOverlay.h"
#include "../core/EventBus.h"
#include <string>
#include <vector>
#include <unordered_map>

namespace BrightForge {
namespace UI {

// Property types for inspector fields
enum class PropertyType {
    FLOAT,
    INT,
    BOOL,
    COLOR,
    STRING,
    VECTOR3,
    READONLY_TEXT
};

// Individual property field
struct PropertyField {
    std::string name;
    std::string displayName;
    PropertyType type;
    std::string section;
    bool readOnly;

    // Value storage (union would be better, but keeping simple)
    float floatValue;
    int intValue;
    bool boolValue;
    Color colorValue;
    std::string stringValue;

    PropertyField()
        : type(PropertyType::FLOAT)
        , readOnly(false)
        , floatValue(0.0f)
        , intValue(0)
        , boolValue(false)
    {}
};

// Material properties matching FragmentShader_PBR.hlsl
struct MaterialProperties {
    Color albedoColor;
    float metallic;
    float roughness;
    Color emissiveColor;
    float emissiveIntensity;

    MaterialProperties()
        : albedoColor(255, 255, 255, 255)
        , metallic(0.0f)
        , roughness(0.5f)
        , emissiveColor(0, 0, 0, 255)
        , emissiveIntensity(0.0f)
    {}
};

// Asset information section
struct AssetInfo {
    size_t vertexCount;
    size_t faceCount;
    std::string format;
    size_t fileSizeBytes;
    std::string path;

    AssetInfo()
        : vertexCount(0)
        , faceCount(0)
        , fileSizeBytes(0)
    {}
};

class PropertyInspector {
public:
    PropertyInspector(Core::EventBus& eventBus, const PanelConfig& config);
    ~PropertyInspector();

    // Panel configuration
    void SetConfig(const PanelConfig& config);
    const PanelConfig& GetConfig() const { return m_config; }
    void SetVisible(bool visible);
    bool IsVisible() const { return m_config.visible; }

    // Property management
    void AddProperty(const PropertyField& field);
    void UpdateProperty(const std::string& name, const PropertyField& field);
    void ClearProperties();

    // Input handlers
    void OnClick(float x, float y);
    void OnMouseMove(float x, float y);
    void OnValueChanged(const std::string& propertyName, float value);
    void OnValueChanged(const std::string& propertyName, int value);
    void OnValueChanged(const std::string& propertyName, bool value);
    void OnValueChanged(const std::string& propertyName, const Color& value);

    // Visual state
    Rect GetPropertyRect(const std::string& propertyName) const;
    int GetHoveredPropertyIndex() const { return m_hoveredPropertyIndex; }

    // Section management
    void CollapseSection(const std::string& section, bool collapsed);
    bool IsSectionCollapsed(const std::string& section) const;

    // Update method
    void Update(float deltaTime);

private:
    Core::EventBus& m_eventBus;
    PanelConfig m_config;

    // Current object state
    Transform m_transform;
    MaterialProperties m_material;
    AssetInfo m_assetInfo;
    bool m_hasSelection;

    // Property organization
    std::vector<PropertyField> m_properties;
    std::unordered_map<std::string, size_t> m_propertyIndices;
    std::unordered_map<std::string, bool> m_collapsedSections;

    // Interaction state
    int m_hoveredPropertyIndex;
    int m_editingPropertyIndex;
    float m_scrollOffset;

    // Event subscriptions
    size_t m_assetSelectedSubscription;
    size_t m_transformChangedSubscription;

    // Internal helpers
    void InitializeDefaultProperties();
    void PopulateFromSelection();
    void OnAssetSelected(const Core::Event& event);
    void OnTransformChanged(const Core::Event& event);
    void PublishPropertyChanged(const std::string& name);
    int GetPropertyIndexAtPosition(float x, float y) const;
    std::string GetSectionAtPosition(float x, float y) const;
    void UpdateTransformDisplay();
    void UpdateMaterialDisplay();
    void UpdateAssetInfoDisplay();

    // Layout constants
    static constexpr float SECTION_HEADER_HEIGHT = 32.0f;
    static constexpr float PROPERTY_ROW_HEIGHT = 28.0f;
    static constexpr float SECTION_PADDING = 8.0f;
    static constexpr float LABEL_WIDTH_RATIO = 0.4f;
};

// Implementation

inline PropertyInspector::PropertyInspector(Core::EventBus& eventBus, const PanelConfig& config)
    : m_eventBus(eventBus)
    , m_config(config)
    , m_hasSelection(false)
    , m_hoveredPropertyIndex(-1)
    , m_editingPropertyIndex(-1)
    , m_scrollOffset(0.0f)
{
    InitializeDefaultProperties();

    // Subscribe to selection events
    m_assetSelectedSubscription = m_eventBus.Subscribe("asset.selected",
        [this](const Core::Event& e) { OnAssetSelected(e); });

    // Subscribe to transform updates
    m_transformChangedSubscription = m_eventBus.Subscribe("transform.changed",
        [this](const Core::Event& e) { OnTransformChanged(e); });
}

inline PropertyInspector::~PropertyInspector() {
    m_eventBus.Unsubscribe("asset.selected", m_assetSelectedSubscription);
    m_eventBus.Unsubscribe("transform.changed", m_transformChangedSubscription);
}

inline void PropertyInspector::SetConfig(const PanelConfig& config) {
    m_config = config;
}

inline void PropertyInspector::SetVisible(bool visible) {
    m_config.visible = visible;

    Core::EventData data;
    data.SetString("panel", "PropertyInspector");
    data.SetBool("visible", visible);
    m_eventBus.Publish("ui.panel.visibility", data);
}

inline void PropertyInspector::AddProperty(const PropertyField& field) {
    // Guard: prevent duplicate properties
    if (m_propertyIndices.find(field.name) != m_propertyIndices.end()) {
        UpdateProperty(field.name, field);
        return;
    }

    m_properties.push_back(field);
    m_propertyIndices[field.name] = m_properties.size() - 1;
}

inline void PropertyInspector::UpdateProperty(const std::string& name, const PropertyField& field) {
    auto it = m_propertyIndices.find(name);
    if (it != m_propertyIndices.end() && it->second < m_properties.size()) {
        m_properties[it->second] = field;
    }
}

inline void PropertyInspector::ClearProperties() {
    m_properties.clear();
    m_propertyIndices.clear();
    InitializeDefaultProperties();
}

inline void PropertyInspector::OnClick(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    // Check for section header click
    std::string section = GetSectionAtPosition(x, y);
    if (!section.empty()) {
        bool isCollapsed = IsSectionCollapsed(section);
        CollapseSection(section, !isCollapsed);
        return;
    }

    // Check for property click
    int propertyIndex = GetPropertyIndexAtPosition(x, y);
    if (propertyIndex >= 0 && propertyIndex < static_cast<int>(m_properties.size())) {
        const PropertyField& prop = m_properties[propertyIndex];

        // Guard: don't allow editing read-only properties
        if (prop.readOnly) {
            return;
        }

        m_editingPropertyIndex = propertyIndex;
    }
}

inline void PropertyInspector::OnMouseMove(float x, float y) {
    // Guard: check visibility
    if (!m_config.visible) {
        return;
    }

    m_hoveredPropertyIndex = GetPropertyIndexAtPosition(x, y);
}

inline void PropertyInspector::OnValueChanged(const std::string& propertyName, float value) {
    auto it = m_propertyIndices.find(propertyName);
    if (it == m_propertyIndices.end()) {
        return;
    }

    PropertyField& prop = m_properties[it->second];

    // Guard: validate property type
    if (prop.type != PropertyType::FLOAT) {
        return;
    }

    prop.floatValue = value;
    PublishPropertyChanged(propertyName);

    // Update internal state for transform properties
    if (propertyName == "transform.positionX") m_transform.positionX = value;
    else if (propertyName == "transform.positionY") m_transform.positionY = value;
    else if (propertyName == "transform.positionZ") m_transform.positionZ = value;
    else if (propertyName == "transform.rotationX") m_transform.rotationX = value;
    else if (propertyName == "transform.rotationY") m_transform.rotationY = value;
    else if (propertyName == "transform.rotationZ") m_transform.rotationZ = value;
    else if (propertyName == "transform.scaleX") m_transform.scaleX = value;
    else if (propertyName == "transform.scaleY") m_transform.scaleY = value;
    else if (propertyName == "transform.scaleZ") m_transform.scaleZ = value;
    // Update material properties
    else if (propertyName == "material.metallic") m_material.metallic = value;
    else if (propertyName == "material.roughness") m_material.roughness = value;
    else if (propertyName == "material.emissiveIntensity") m_material.emissiveIntensity = value;
}

inline void PropertyInspector::OnValueChanged(const std::string& propertyName, int value) {
    auto it = m_propertyIndices.find(propertyName);
    if (it == m_propertyIndices.end()) {
        return;
    }

    PropertyField& prop = m_properties[it->second];

    // Guard: validate property type
    if (prop.type != PropertyType::INT) {
        return;
    }

    prop.intValue = value;
    PublishPropertyChanged(propertyName);
}

inline void PropertyInspector::OnValueChanged(const std::string& propertyName, bool value) {
    auto it = m_propertyIndices.find(propertyName);
    if (it == m_propertyIndices.end()) {
        return;
    }

    PropertyField& prop = m_properties[it->second];

    // Guard: validate property type
    if (prop.type != PropertyType::BOOL) {
        return;
    }

    prop.boolValue = value;
    PublishPropertyChanged(propertyName);
}

inline void PropertyInspector::OnValueChanged(const std::string& propertyName, const Color& value) {
    auto it = m_propertyIndices.find(propertyName);
    if (it == m_propertyIndices.end()) {
        return;
    }

    PropertyField& prop = m_properties[it->second];

    // Guard: validate property type
    if (prop.type != PropertyType::COLOR) {
        return;
    }

    prop.colorValue = value;
    PublishPropertyChanged(propertyName);

    // Update material color properties
    if (propertyName == "material.albedoColor") {
        m_material.albedoColor = value;
    } else if (propertyName == "material.emissiveColor") {
        m_material.emissiveColor = value;
    }
}

inline void PropertyInspector::CollapseSection(const std::string& section, bool collapsed) {
    m_collapsedSections[section] = collapsed;
}

inline bool PropertyInspector::IsSectionCollapsed(const std::string& section) const {
    auto it = m_collapsedSections.find(section);
    return it != m_collapsedSections.end() ? it->second : false;
}

inline Rect PropertyInspector::GetPropertyRect(const std::string& propertyName) const {
    auto it = m_propertyIndices.find(propertyName);
    if (it == m_propertyIndices.end()) {
        return Rect();
    }

    float y = SECTION_PADDING - m_scrollOffset;
    std::string currentSection;

    for (size_t i = 0; i <= it->second; ++i) {
        const PropertyField& prop = m_properties[i];

        // Section header
        if (prop.section != currentSection) {
            currentSection = prop.section;
            y += SECTION_HEADER_HEIGHT;

            if (IsSectionCollapsed(currentSection)) {
                // Skip to next section
                while (i < m_properties.size() && m_properties[i].section == currentSection) {
                    if (m_properties[i].name == propertyName) {
                        return Rect(); // Property is in collapsed section
                    }
                    ++i;
                }
                --i;
                continue;
            }
        }

        if (i == it->second) {
            return Rect(0.0f, y, m_config.width, PROPERTY_ROW_HEIGHT);
        }

        y += PROPERTY_ROW_HEIGHT;
    }

    return Rect();
}

inline void PropertyInspector::Update(float deltaTime) {
    // Animation updates would go here
}

inline void PropertyInspector::InitializeDefaultProperties() {
    // Transform section
    PropertyField field;

    // Position X
    field.name = "transform.positionX";
    field.displayName = "Position X";
    field.type = PropertyType::FLOAT;
    field.section = "Transform";
    field.readOnly = false;
    field.floatValue = 0.0f;
    AddProperty(field);

    // Position Y
    field.name = "transform.positionY";
    field.displayName = "Position Y";
    field.floatValue = 0.0f;
    AddProperty(field);

    // Position Z
    field.name = "transform.positionZ";
    field.displayName = "Position Z";
    field.floatValue = 0.0f;
    AddProperty(field);

    // Rotation X
    field.name = "transform.rotationX";
    field.displayName = "Rotation X";
    field.floatValue = 0.0f;
    AddProperty(field);

    // Rotation Y
    field.name = "transform.rotationY";
    field.displayName = "Rotation Y";
    field.floatValue = 0.0f;
    AddProperty(field);

    // Rotation Z
    field.name = "transform.rotationZ";
    field.displayName = "Rotation Z";
    field.floatValue = 0.0f;
    AddProperty(field);

    // Scale X
    field.name = "transform.scaleX";
    field.displayName = "Scale X";
    field.floatValue = 1.0f;
    AddProperty(field);

    // Scale Y
    field.name = "transform.scaleY";
    field.displayName = "Scale Y";
    field.floatValue = 1.0f;
    AddProperty(field);

    // Scale Z
    field.name = "transform.scaleZ";
    field.displayName = "Scale Z";
    field.floatValue = 1.0f;
    AddProperty(field);

    // Material section
    field.section = "Material";

    // Albedo Color
    field.name = "material.albedoColor";
    field.displayName = "Albedo Color";
    field.type = PropertyType::COLOR;
    field.colorValue = Color(255, 255, 255, 255);
    AddProperty(field);

    // Metallic
    field.name = "material.metallic";
    field.displayName = "Metallic";
    field.type = PropertyType::FLOAT;
    field.floatValue = 0.0f;
    AddProperty(field);

    // Roughness
    field.name = "material.roughness";
    field.displayName = "Roughness";
    field.floatValue = 0.5f;
    AddProperty(field);

    // Emissive Color
    field.name = "material.emissiveColor";
    field.displayName = "Emissive Color";
    field.type = PropertyType::COLOR;
    field.colorValue = Color(0, 0, 0, 255);
    AddProperty(field);

    // Emissive Intensity
    field.name = "material.emissiveIntensity";
    field.displayName = "Emissive Intensity";
    field.type = PropertyType::FLOAT;
    field.floatValue = 0.0f;
    AddProperty(field);

    // Info section (read-only)
    field.section = "Info";
    field.readOnly = true;

    // Vertex Count
    field.name = "info.vertexCount";
    field.displayName = "Vertex Count";
    field.type = PropertyType::READONLY_TEXT;
    field.stringValue = "0";
    AddProperty(field);

    // Face Count
    field.name = "info.faceCount";
    field.displayName = "Face Count";
    field.stringValue = "0";
    AddProperty(field);

    // Format
    field.name = "info.format";
    field.displayName = "Format";
    field.stringValue = "";
    AddProperty(field);

    // File Size
    field.name = "info.fileSize";
    field.displayName = "File Size";
    field.stringValue = "0 bytes";
    AddProperty(field);
}

inline void PropertyInspector::PopulateFromSelection() {
    UpdateTransformDisplay();
    UpdateMaterialDisplay();
    UpdateAssetInfoDisplay();
}

inline void PropertyInspector::OnAssetSelected(const Core::Event& event) {
    const Core::EventData& data = event.GetData();

    m_hasSelection = true;

    // Extract asset info
    m_assetInfo.path = data.GetString("path");
    m_assetInfo.format = data.GetString("format");
    m_assetInfo.vertexCount = static_cast<size_t>(data.GetInt("vertexCount"));
    m_assetInfo.faceCount = static_cast<size_t>(data.GetInt("faceCount"));

    PopulateFromSelection();
}

inline void PropertyInspector::OnTransformChanged(const Core::Event& event) {
    const Core::EventData& data = event.GetData();

    // Update transform from event
    m_transform.positionX = data.GetFloat("posX");
    m_transform.positionY = data.GetFloat("posY");
    m_transform.positionZ = data.GetFloat("posZ");
    m_transform.rotationX = data.GetFloat("rotX");
    m_transform.rotationY = data.GetFloat("rotY");
    m_transform.rotationZ = data.GetFloat("rotZ");
    m_transform.scaleX = data.GetFloat("scaleX");
    m_transform.scaleY = data.GetFloat("scaleY");
    m_transform.scaleZ = data.GetFloat("scaleZ");

    UpdateTransformDisplay();
}

inline void PropertyInspector::PublishPropertyChanged(const std::string& name) {
    Core::EventData data;
    data.SetString("propertyName", name);

    auto it = m_propertyIndices.find(name);
    if (it != m_propertyIndices.end()) {
        const PropertyField& prop = m_properties[it->second];

        switch (prop.type) {
            case PropertyType::FLOAT:
                data.SetFloat("value", prop.floatValue);
                break;
            case PropertyType::INT:
                data.SetInt("value", prop.intValue);
                break;
            case PropertyType::BOOL:
                data.SetBool("value", prop.boolValue);
                break;
            default:
                break;
        }
    }

    m_eventBus.Publish("property.changed", data);
}

inline int PropertyInspector::GetPropertyIndexAtPosition(float x, float y) const {
    float currentY = SECTION_PADDING - m_scrollOffset;
    std::string currentSection;

    for (size_t i = 0; i < m_properties.size(); ++i) {
        const PropertyField& prop = m_properties[i];

        // Section header
        if (prop.section != currentSection) {
            currentSection = prop.section;
            currentY += SECTION_HEADER_HEIGHT;

            if (IsSectionCollapsed(currentSection)) {
                // Skip collapsed section
                while (i < m_properties.size() && m_properties[i].section == currentSection) {
                    ++i;
                }
                --i;
                continue;
            }
        }

        Rect propRect(0.0f, currentY, m_config.width, PROPERTY_ROW_HEIGHT);
        if (propRect.Contains(x, y)) {
            return static_cast<int>(i);
        }

        currentY += PROPERTY_ROW_HEIGHT;
    }

    return -1;
}

inline std::string PropertyInspector::GetSectionAtPosition(float x, float y) const {
    float currentY = SECTION_PADDING - m_scrollOffset;
    std::string lastSection;

    for (const auto& prop : m_properties) {
        if (prop.section != lastSection) {
            lastSection = prop.section;

            Rect headerRect(0.0f, currentY, m_config.width, SECTION_HEADER_HEIGHT);
            if (headerRect.Contains(x, y)) {
                return lastSection;
            }

            currentY += SECTION_HEADER_HEIGHT;

            if (IsSectionCollapsed(lastSection)) {
                continue;
            }
        }

        currentY += PROPERTY_ROW_HEIGHT;
    }

    return "";
}

inline void PropertyInspector::UpdateTransformDisplay() {
    OnValueChanged("transform.positionX", m_transform.positionX);
    OnValueChanged("transform.positionY", m_transform.positionY);
    OnValueChanged("transform.positionZ", m_transform.positionZ);
    OnValueChanged("transform.rotationX", m_transform.rotationX);
    OnValueChanged("transform.rotationY", m_transform.rotationY);
    OnValueChanged("transform.rotationZ", m_transform.rotationZ);
    OnValueChanged("transform.scaleX", m_transform.scaleX);
    OnValueChanged("transform.scaleY", m_transform.scaleY);
    OnValueChanged("transform.scaleZ", m_transform.scaleZ);
}

inline void PropertyInspector::UpdateMaterialDisplay() {
    OnValueChanged("material.albedoColor", m_material.albedoColor);
    OnValueChanged("material.metallic", m_material.metallic);
    OnValueChanged("material.roughness", m_material.roughness);
    OnValueChanged("material.emissiveColor", m_material.emissiveColor);
    OnValueChanged("material.emissiveIntensity", m_material.emissiveIntensity);
}

inline void PropertyInspector::UpdateAssetInfoDisplay() {
    auto updateReadonlyText = [this](const std::string& name, const std::string& value) {
        auto it = m_propertyIndices.find(name);
        if (it != m_propertyIndices.end()) {
            m_properties[it->second].stringValue = value;
        }
    };

    updateReadonlyText("info.vertexCount", std::to_string(m_assetInfo.vertexCount));
    updateReadonlyText("info.faceCount", std::to_string(m_assetInfo.faceCount));
    updateReadonlyText("info.format", m_assetInfo.format);
    updateReadonlyText("info.fileSize", std::to_string(m_assetInfo.fileSizeBytes) + " bytes");
}

} // namespace UI
} // namespace BrightForge
