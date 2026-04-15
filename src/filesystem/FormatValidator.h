/**
 * FormatValidator - File format validation at system boundary
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include <fstream>
#include <filesystem>
#include "../core/QuoteSystem.h"

namespace BrightForge {

// Supported asset formats
enum class AssetFormat {
    OBJ,
    FBX,
    GLTF,
    GLB,
    PNG,
    JPG,
    TGA,
    HDR,
    UNKNOWN
};

class FormatValidator {
public:
    FormatValidator() = default;
    ~FormatValidator() = default;

    // Validate file format by magic bytes (primary) and extension (fallback)
    AssetFormat ValidateFormat(const std::string& path) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FormatValidator", "Cannot validate empty path");
            return AssetFormat::UNKNOWN;
        }

        if (!std::filesystem::exists(path)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FormatValidator", "File does not exist: " + path);
            return AssetFormat::UNKNOWN;
        }

        AssetFormat format = CheckMagicBytes(path);

        // Fallback to extension if magic bytes didn't match
        if (format == AssetFormat::UNKNOWN) {
            format = CheckExtension(path);
        }

        std::string formatName = GetFormatName(format);
        if (format == AssetFormat::UNKNOWN) {
            QuoteSystem::Get().Log("ERROR_MSG", "FormatValidator", "Unsupported format: " + path);
        } else {
            QuoteSystem::Get().Log("SUCCESS", "FormatValidator", "Validated as " + formatName + ": " + path);
        }

        return format;
    }

    // Get human-readable format name
    static std::string GetFormatName(AssetFormat format) {
        switch (format) {
            case AssetFormat::OBJ:  return "Wavefront OBJ";
            case AssetFormat::FBX:  return "Autodesk FBX";
            case AssetFormat::GLTF: return "glTF JSON";
            case AssetFormat::GLB:  return "glTF Binary";
            case AssetFormat::PNG:  return "PNG Image";
            case AssetFormat::JPG:  return "JPEG Image";
            case AssetFormat::TGA:  return "Targa Image";
            case AssetFormat::HDR:  return "HDR Image";
            default:                return "Unknown";
        }
    }

    // Check if format is supported for loading
    static bool IsSupported(AssetFormat format) {
        return format != AssetFormat::UNKNOWN;
    }

private:
    // Magic byte signatures
    static constexpr uint32_t MAGIC_GLB = 0x46546C67; // "glTF" in little-endian
    static constexpr uint32_t MAGIC_PNG = 0x474E5089; // PNG signature in little-endian
    static constexpr uint16_t MAGIC_JPG = 0xD8FF;     // JPEG SOI marker
    static constexpr const char* MAGIC_HDR = "#?RADIANCE";
    static constexpr const char* MAGIC_FBX = "Kaydara FBX Binary";

    AssetFormat CheckMagicBytes(const std::string& path) {
        std::ifstream file(path, std::ios::binary);
        if (!file.is_open()) {
            return AssetFormat::UNKNOWN;
        }

        // Read first 32 bytes for magic byte checks
        unsigned char buffer[32] = {0};
        file.read(reinterpret_cast<char*>(buffer), sizeof(buffer));
        size_t bytesRead = file.gcount();

        if (bytesRead < 4) {
            return AssetFormat::UNKNOWN;
        }

        // Check GLB (4-byte signature)
        uint32_t signature32 = *reinterpret_cast<const uint32_t*>(buffer);
        if (signature32 == MAGIC_GLB) {
            return AssetFormat::GLB;
        }

        // Check PNG (4-byte signature)
        if (signature32 == MAGIC_PNG) {
            return AssetFormat::PNG;
        }

        // Check JPEG (2-byte signature)
        uint16_t signature16 = *reinterpret_cast<const uint16_t*>(buffer);
        if (signature16 == MAGIC_JPG) {
            return AssetFormat::JPG;
        }

        // Check HDR (text signature)
        if (bytesRead >= 11) {
            std::string headerStr(reinterpret_cast<const char*>(buffer), 11);
            if (headerStr == MAGIC_HDR) {
                return AssetFormat::HDR;
            }
        }

        // Check FBX (text signature)
        if (bytesRead >= 18) {
            std::string headerStr(reinterpret_cast<const char*>(buffer), 18);
            if (headerStr == MAGIC_FBX) {
                return AssetFormat::FBX;
            }
        }

        return AssetFormat::UNKNOWN;
    }

    AssetFormat CheckExtension(const std::string& path) {
        std::filesystem::path filePath(path);
        std::string ext = filePath.extension().string();

        // Convert to lowercase for comparison
        for (char& c : ext) {
            c = std::tolower(static_cast<unsigned char>(c));
        }

        if (ext == ".obj") return AssetFormat::OBJ;
        if (ext == ".fbx") return AssetFormat::FBX;
        if (ext == ".gltf") return AssetFormat::GLTF;
        if (ext == ".glb") return AssetFormat::GLB;
        if (ext == ".png") return AssetFormat::PNG;
        if (ext == ".jpg" || ext == ".jpeg") return AssetFormat::JPG;
        if (ext == ".tga") return AssetFormat::TGA;
        if (ext == ".hdr") return AssetFormat::HDR;

        return AssetFormat::UNKNOWN;
    }
};

} // namespace BrightForge
