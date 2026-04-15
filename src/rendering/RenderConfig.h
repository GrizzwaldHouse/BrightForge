/** RenderConfig - Configuration struct for rendering parameters
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include <fstream>
#include <sstream>
#include "../core/QuoteSystem.h"

// Forward declaration for JSON parsing - would normally use a library like nlohmann/json
// For now we use simple key-value parsing
namespace RenderConfigIO {
    std::string LoadFileToString(const std::string& path);
    void SaveStringToFile(const std::string& path, const std::string& content);
    std::string ExtractValue(const std::string& json, const std::string& key);
    int ParseInt(const std::string& value);
    float ParseFloat(const std::string& value);
    bool ParseBool(const std::string& value);
}

struct RenderConfig {
    // Window configuration
    int windowWidth = 800;
    int windowHeight = 600;
    bool fullscreen = false;

    // Quality settings
    int msaaSamples = 1;
    bool enableVSync = true;
    float renderScale = 1.0f;

    // Lighting configuration
    float ambientIntensity = 0.3f;
    float sunIntensity = 1.0f;

    // Debug visualization
    bool wireframeMode = false;
    bool showNormals = false;
    bool showDepthBuffer = false;

    // Camera configuration - aggressive reversed-Z values for precision
    float nearPlane = 0.00001f;
    float farPlane = 10000.0f;
    float fovDegrees = 65.0f;
    float cameraSpeed = 0.3f;

    // Depth buffer mode
    bool useReversedZ = true;

    // Clear color
    std::string clearColorHex = "#800000";

    // Load configuration from JSON file
    // Returns true on success, false on failure
    static bool LoadFromFile(const std::string& path, RenderConfig& outConfig) {
        // Guard: empty path
        if (path.empty()) {
            QuoteSystem::Instance().Log("LoadFromFile: empty path provided", QuoteSystem::MessageType::WARNING);
            return false;
        }

        try {
            std::string json = RenderConfigIO::LoadFileToString(path);

            // Guard: empty file
            if (json.empty()) {
                QuoteSystem::Instance().Log("LoadFromFile: file is empty - " + path, QuoteSystem::MessageType::WARNING);
                return false;
            }

            // Parse each field with defaults as fallback
            outConfig.windowWidth = RenderConfigIO::ParseInt(RenderConfigIO::ExtractValue(json, "windowWidth"));
            outConfig.windowHeight = RenderConfigIO::ParseInt(RenderConfigIO::ExtractValue(json, "windowHeight"));
            outConfig.fullscreen = RenderConfigIO::ParseBool(RenderConfigIO::ExtractValue(json, "fullscreen"));
            outConfig.msaaSamples = RenderConfigIO::ParseInt(RenderConfigIO::ExtractValue(json, "msaaSamples"));
            outConfig.enableVSync = RenderConfigIO::ParseBool(RenderConfigIO::ExtractValue(json, "enableVSync"));
            outConfig.renderScale = RenderConfigIO::ParseFloat(RenderConfigIO::ExtractValue(json, "renderScale"));
            outConfig.ambientIntensity = RenderConfigIO::ParseFloat(RenderConfigIO::ExtractValue(json, "ambientIntensity"));
            outConfig.sunIntensity = RenderConfigIO::ParseFloat(RenderConfigIO::ExtractValue(json, "sunIntensity"));
            outConfig.wireframeMode = RenderConfigIO::ParseBool(RenderConfigIO::ExtractValue(json, "wireframeMode"));
            outConfig.showNormals = RenderConfigIO::ParseBool(RenderConfigIO::ExtractValue(json, "showNormals"));
            outConfig.showDepthBuffer = RenderConfigIO::ParseBool(RenderConfigIO::ExtractValue(json, "showDepthBuffer"));
            outConfig.nearPlane = RenderConfigIO::ParseFloat(RenderConfigIO::ExtractValue(json, "nearPlane"));
            outConfig.farPlane = RenderConfigIO::ParseFloat(RenderConfigIO::ExtractValue(json, "farPlane"));
            outConfig.fovDegrees = RenderConfigIO::ParseFloat(RenderConfigIO::ExtractValue(json, "fovDegrees"));
            outConfig.cameraSpeed = RenderConfigIO::ParseFloat(RenderConfigIO::ExtractValue(json, "cameraSpeed"));
            outConfig.useReversedZ = RenderConfigIO::ParseBool(RenderConfigIO::ExtractValue(json, "useReversedZ"));

            std::string colorHex = RenderConfigIO::ExtractValue(json, "clearColorHex");
            if (!colorHex.empty()) {
                outConfig.clearColorHex = colorHex;
            }

            // Validation checks
            bool valid = ValidateConfig(outConfig);
            if (!valid) {
                QuoteSystem::Instance().Log("LoadFromFile: validation failed for " + path, QuoteSystem::MessageType::ERROR_MSG);
                return false;
            }

            QuoteSystem::Instance().Log("RenderConfig loaded from " + path, QuoteSystem::MessageType::SUCCESS);
            return true;

        } catch (const std::exception& e) {
            QuoteSystem::Instance().Log("LoadFromFile exception: " + std::string(e.what()), QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }
    }

    // Save configuration to JSON file
    static bool SaveToFile(const std::string& path, const RenderConfig& config) {
        // Guard: empty path
        if (path.empty()) {
            QuoteSystem::Instance().Log("SaveToFile: empty path provided", QuoteSystem::MessageType::WARNING);
            return false;
        }

        try {
            std::stringstream ss;
            ss << "{\n";
            ss << "  \"windowWidth\": " << config.windowWidth << ",\n";
            ss << "  \"windowHeight\": " << config.windowHeight << ",\n";
            ss << "  \"fullscreen\": " << (config.fullscreen ? "true" : "false") << ",\n";
            ss << "  \"msaaSamples\": " << config.msaaSamples << ",\n";
            ss << "  \"enableVSync\": " << (config.enableVSync ? "true" : "false") << ",\n";
            ss << "  \"renderScale\": " << config.renderScale << ",\n";
            ss << "  \"ambientIntensity\": " << config.ambientIntensity << ",\n";
            ss << "  \"sunIntensity\": " << config.sunIntensity << ",\n";
            ss << "  \"wireframeMode\": " << (config.wireframeMode ? "true" : "false") << ",\n";
            ss << "  \"showNormals\": " << (config.showNormals ? "true" : "false") << ",\n";
            ss << "  \"showDepthBuffer\": " << (config.showDepthBuffer ? "true" : "false") << ",\n";
            ss << "  \"nearPlane\": " << config.nearPlane << ",\n";
            ss << "  \"farPlane\": " << config.farPlane << ",\n";
            ss << "  \"fovDegrees\": " << config.fovDegrees << ",\n";
            ss << "  \"cameraSpeed\": " << config.cameraSpeed << ",\n";
            ss << "  \"useReversedZ\": " << (config.useReversedZ ? "true" : "false") << ",\n";
            ss << "  \"clearColorHex\": \"" << config.clearColorHex << "\"\n";
            ss << "}\n";

            RenderConfigIO::SaveStringToFile(path, ss.str());
            QuoteSystem::Instance().Log("RenderConfig saved to " + path, QuoteSystem::MessageType::SUCCESS);
            return true;

        } catch (const std::exception& e) {
            QuoteSystem::Instance().Log("SaveToFile exception: " + std::string(e.what()), QuoteSystem::MessageType::ERROR_MSG);
            return false;
        }
    }

    // Validate configuration values are within acceptable ranges
    static bool ValidateConfig(const RenderConfig& config) {
        bool valid = true;

        // Validate window dimensions
        if (config.windowWidth <= 0 || config.windowHeight <= 0) {
            QuoteSystem::Instance().Log("Invalid window dimensions: " +
                std::to_string(config.windowWidth) + "x" + std::to_string(config.windowHeight),
                QuoteSystem::MessageType::WARNING);
            valid = false;
        }

        // Validate MSAA samples (must be power of 2)
        if (config.msaaSamples != 1 && config.msaaSamples != 2 &&
            config.msaaSamples != 4 && config.msaaSamples != 8 &&
            config.msaaSamples != 16) {
            QuoteSystem::Instance().Log("Invalid MSAA sample count (must be 1,2,4,8,16): " +
                std::to_string(config.msaaSamples), QuoteSystem::MessageType::WARNING);
            valid = false;
        }

        // Validate render scale
        if (config.renderScale <= 0.0f || config.renderScale > 2.0f) {
            QuoteSystem::Instance().Log("Invalid render scale (must be 0-2): " +
                std::to_string(config.renderScale), QuoteSystem::MessageType::WARNING);
            valid = false;
        }

        // Validate camera planes
        if (config.nearPlane <= 0.0f || config.farPlane <= config.nearPlane) {
            QuoteSystem::Instance().Log("Invalid near/far planes: near=" +
                std::to_string(config.nearPlane) + " far=" + std::to_string(config.farPlane),
                QuoteSystem::MessageType::WARNING);
            valid = false;
        }

        // Validate FOV
        if (config.fovDegrees <= 0.0f || config.fovDegrees >= 180.0f) {
            QuoteSystem::Instance().Log("Invalid FOV (must be 0-180): " +
                std::to_string(config.fovDegrees), QuoteSystem::MessageType::WARNING);
            valid = false;
        }

        return valid;
    }
};

// Simple JSON parsing utilities
namespace RenderConfigIO {
    inline std::string LoadFileToString(const std::string& path) {
        std::ifstream file(path);
        if (!file.is_open()) {
            return "";
        }
        std::stringstream buffer;
        buffer << file.rdbuf();
        return buffer.str();
    }

    inline void SaveStringToFile(const std::string& path, const std::string& content) {
        std::ofstream file(path);
        file << content;
    }

    inline std::string ExtractValue(const std::string& json, const std::string& key) {
        std::string searchKey = "\"" + key + "\":";
        size_t pos = json.find(searchKey);
        if (pos == std::string::npos) {
            return "";
        }

        pos += searchKey.length();
        while (pos < json.length() && std::isspace(json[pos])) {
            ++pos;
        }

        size_t endPos = pos;
        if (json[pos] == '"') {
            // String value
            ++pos;
            endPos = json.find('"', pos);
            return json.substr(pos, endPos - pos);
        } else {
            // Numeric or boolean value
            while (endPos < json.length() && json[endPos] != ',' && json[endPos] != '}' && json[endPos] != '\n') {
                ++endPos;
            }
            std::string value = json.substr(pos, endPos - pos);
            // Trim whitespace
            size_t start = 0;
            while (start < value.length() && std::isspace(value[start])) {
                ++start;
            }
            size_t end = value.length();
            while (end > start && std::isspace(value[end - 1])) {
                --end;
            }
            return value.substr(start, end - start);
        }
    }

    inline int ParseInt(const std::string& value) {
        if (value.empty()) return 0;
        return std::stoi(value);
    }

    inline float ParseFloat(const std::string& value) {
        if (value.empty()) return 0.0f;
        return std::stof(value);
    }

    inline bool ParseBool(const std::string& value) {
        if (value.empty()) return false;
        return value == "true" || value == "1";
    }
}
