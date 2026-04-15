/** UITypes.h - Shared types and constants for UI components
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <cstdint>
#include <string>

namespace BrightForge {
namespace UI {

// Rectangular region in screen space
struct Rect {
    float x;
    float y;
    float width;
    float height;

    Rect() : x(0.0f), y(0.0f), width(0.0f), height(0.0f) {}
    Rect(float x_, float y_, float w_, float h_)
        : x(x_), y(y_), width(w_), height(h_) {}

    bool Contains(float px, float py) const {
        return px >= x && px <= (x + width) && py >= y && py <= (y + height);
    }

    bool Intersects(const Rect& other) const {
        return !(x + width < other.x || other.x + other.width < x ||
                 y + height < other.y || other.y + other.height < y);
    }
};

// RGBA color representation
struct Color {
    uint8_t r;
    uint8_t g;
    uint8_t b;
    uint8_t a;

    Color() : r(0), g(0), b(0), a(255) {}
    Color(uint8_t r_, uint8_t g_, uint8_t b_, uint8_t a_ = 255)
        : r(r_), g(g_), b(b_), a(a_) {}

    // Parse hex color strings like "#FF5733" or "FF5733"
    static Color FromHex(const std::string& hex) {
        std::string clean = hex;
        if (!clean.empty() && clean[0] == '#') {
            clean = clean.substr(1);
        }

        if (clean.length() != 6 && clean.length() != 8) {
            return Color(0, 0, 0, 255); // default to black on parse failure
        }

        uint8_t r = static_cast<uint8_t>(std::stoi(clean.substr(0, 2), nullptr, 16));
        uint8_t g = static_cast<uint8_t>(std::stoi(clean.substr(2, 2), nullptr, 16));
        uint8_t b = static_cast<uint8_t>(std::stoi(clean.substr(4, 2), nullptr, 16));
        uint8_t a = 255;

        if (clean.length() == 8) {
            a = static_cast<uint8_t>(std::stoi(clean.substr(6, 2), nullptr, 16));
        }

        return Color(r, g, b, a);
    }

    float GetRed() const { return r / 255.0f; }
    float GetGreen() const { return g / 255.0f; }
    float GetBlue() const { return b / 255.0f; }
    float GetAlpha() const { return a / 255.0f; }
};

// Mouse cursor visual states
enum class CursorMode {
    ARROW,      // Default pointer
    HAND,       // Hover over clickable item
    CROSSHAIR,  // Precision selection
    RESIZE_H,   // Horizontal resize
    RESIZE_V,   // Vertical resize
    RESIZE_DIAG_NE, // Diagonal resize northeast
    RESIZE_DIAG_NW, // Diagonal resize northwest
    MOVE,       // Object drag
    ROTATE,     // Rotation operation
    SCALE       // Scale operation
};

// Available manipulation tools
enum class ToolType {
    // Transform tools
    SELECT,
    MOVE,
    ROTATE,
    SCALE,

    // Sculpting tools
    SCULPT_SMOOTH,
    SCULPT_INFLATE,
    SCULPT_PINCH,
    SCULPT_FLATTEN,
    SCULPT_GRAB,
    SCULPT_CREASE,

    // Additional tools
    PAINT,
    MEASURE,
    ANNOTATE
};

// Mesh component selection modes
enum class SelectionMode {
    VERTEX,  // Select individual vertices
    EDGE,    // Select edges
    FACE,    // Select faces/polygons
    OBJECT   // Select entire objects
};

// Viewport camera modes
enum class ViewMode {
    PERSPECTIVE, // 3D perspective view
    TOP,         // Orthographic top view
    FRONT,       // Orthographic front view
    SIDE,        // Orthographic side view
    BOTTOM,      // Orthographic bottom view
    BACK,        // Orthographic back view
    CUSTOM       // User-defined view angle
};

// Panel/window configuration
struct PanelConfig {
    float width;
    float height;
    float minWidth;
    float minHeight;
    bool visible;
    std::string side; // "left", "right", "top", "bottom", "center"
    bool resizable;
    bool collapsible;
    std::string title;

    PanelConfig()
        : width(300.0f)
        , height(400.0f)
        , minWidth(100.0f)
        , minHeight(100.0f)
        , visible(true)
        , side("left")
        , resizable(true)
        , collapsible(true)
        , title("")
    {}
};

// Display modes for file/asset lists
enum class DisplayMode {
    GRID,  // Thumbnail grid view
    LIST   // Icon + name list view
};

// UI component visual states
enum class ComponentState {
    IDLE,
    HOVER,
    ACTIVE,
    DISABLED,
    FOCUSED,
    ERROR,
    SUCCESS,
    LOADING
};

// Common UI theme constants
namespace Theme {
    static constexpr float PADDING_SMALL = 4.0f;
    static constexpr float PADDING_MEDIUM = 8.0f;
    static constexpr float PADDING_LARGE = 16.0f;

    static constexpr float BORDER_RADIUS_SMALL = 2.0f;
    static constexpr float BORDER_RADIUS_MEDIUM = 4.0f;
    static constexpr float BORDER_RADIUS_LARGE = 8.0f;

    static constexpr float BORDER_WIDTH_THIN = 1.0f;
    static constexpr float BORDER_WIDTH_THICK = 2.0f;

    static constexpr float ICON_SIZE_SMALL = 16.0f;
    static constexpr float ICON_SIZE_MEDIUM = 24.0f;
    static constexpr float ICON_SIZE_LARGE = 32.0f;

    static constexpr float FONT_SIZE_SMALL = 11.0f;
    static constexpr float FONT_SIZE_MEDIUM = 13.0f;
    static constexpr float FONT_SIZE_LARGE = 16.0f;

    static constexpr float ANIMATION_DURATION_FAST = 0.15f;
    static constexpr float ANIMATION_DURATION_MEDIUM = 0.3f;
    static constexpr float ANIMATION_DURATION_SLOW = 0.5f;
}

// Predefined color palette
namespace Colors {
    static const Color PRIMARY = Color::FromHex("#4A90E2");
    static const Color SECONDARY = Color::FromHex("#7B68EE");
    static const Color SUCCESS = Color::FromHex("#5CB85C");
    static const Color WARNING = Color::FromHex("#F0AD4E");
    static const Color DANGER = Color::FromHex("#D9534F");
    static const Color INFO = Color::FromHex("#5BC0DE");

    static const Color BACKGROUND_DARK = Color::FromHex("#1E1E1E");
    static const Color BACKGROUND_MEDIUM = Color::FromHex("#2D2D2D");
    static const Color BACKGROUND_LIGHT = Color::FromHex("#3E3E3E");

    static const Color TEXT_PRIMARY = Color::FromHex("#FFFFFF");
    static const Color TEXT_SECONDARY = Color::FromHex("#B0B0B0");
    static const Color TEXT_DISABLED = Color::FromHex("#707070");

    static const Color BORDER_DEFAULT = Color::FromHex("#555555");
    static const Color BORDER_HOVER = Color::FromHex("#777777");
    static const Color BORDER_ACTIVE = Color::FromHex("#4A90E2");

    static const Color GIZMO_X_AXIS = Color::FromHex("#E74C3C");
    static const Color GIZMO_Y_AXIS = Color::FromHex("#2ECC71");
    static const Color GIZMO_Z_AXIS = Color::FromHex("#3498DB");
}

} // namespace UI
} // namespace BrightForge
