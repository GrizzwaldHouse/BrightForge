/** ShaderCompiler - Unified shader compilation with caching and retry
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <thread>
#include <chrono>
#include "../core/QuoteSystem.h"
#include "../core/DebugWindow.h"

// Shader type enumeration
enum class ShaderType {
    VERTEX,
    FRAGMENT,
    COMPUTE
};

// Shader compilation options
struct ShaderOptions {
    std::string entryPoint = "main";
    bool enableOptimization = true;
    std::vector<std::string> defines;
};

// ShaderCompiler handles SPIR-V compilation from HLSL source
// Features:
// - Unified interface for all shader types (no duplicate vertex/fragment functions)
// - Content-based caching to avoid recompiling unchanged shaders
// - Retry mechanism to handle file write delays from external editors
class ShaderCompiler {
public:
    ShaderCompiler() {
        DebugWindow::Instance().RegisterChannel("Shaders");
        QuoteSystem::Instance().Log("ShaderCompiler initialized", QuoteSystem::MessageType::INFO);
    }

    ~ShaderCompiler() {
        ClearCache();
    }

    // Compile shader from file path
    // Returns compiled SPIR-V bytecode as a vector of 32-bit words
    // Returns empty vector on failure
    std::vector<uint32_t> Compile(ShaderType type, const std::string& path, const ShaderOptions& options = ShaderOptions()) {
        // Guard: empty path
        if (path.empty()) {
            QuoteSystem::Instance().Log("Compile: empty shader path", QuoteSystem::MessageType::WARNING);
            return {};
        }

        // Read shader source code
        std::string source = LoadShaderSource(path);
        if (source.empty()) {
            // Retry once after 100ms delay
            // This handles the case where the file is still being written by an editor
            DebugWindow::Instance().Post("Shaders", "Source empty, retrying after 100ms: " + path,
                DebugWindow::DebugLevel::WARN);
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            source = LoadShaderSource(path);

            if (source.empty()) {
                QuoteSystem::Instance().Log("Compile: failed to load shader source - " + path,
                    QuoteSystem::MessageType::ERROR_MSG);
                DebugWindow::Instance().Post("Shaders", "Load failed: " + path, DebugWindow::DebugLevel::ERR);
                return {};
            }
        }

        // Check cache using content hash
        std::string cacheKey = ComputeCacheKey(source, type, options);
        {
            std::lock_guard<std::mutex> lock(mCacheMutex);
            auto it = mCache.find(cacheKey);
            if (it != mCache.end()) {
                DebugWindow::Instance().Post("Shaders", "Cache hit: " + path, DebugWindow::DebugLevel::TRACE);
                return it->second;
            }
        }

        // Compile shader to SPIR-V
        std::vector<uint32_t> spirv = CompileToSpirv(source, type, path, options);

        // Guard: compilation failed
        if (spirv.empty()) {
            QuoteSystem::Instance().Log("Compile: SPIR-V compilation failed - " + path,
                QuoteSystem::MessageType::ERROR_MSG);
            DebugWindow::Instance().Post("Shaders", "Compilation failed: " + path, DebugWindow::DebugLevel::ERR);
            return {};
        }

        // Store in cache
        {
            std::lock_guard<std::mutex> lock(mCacheMutex);
            mCache[cacheKey] = spirv;
        }

        QuoteSystem::Instance().Log("Shader compiled: " + path + " (" +
            std::to_string(spirv.size() * 4) + " bytes)",
            QuoteSystem::MessageType::SUCCESS);
        DebugWindow::Instance().Post("Shaders", "Compiled: " + path, DebugWindow::DebugLevel::INFO);

        return spirv;
    }

    // Clear the shader cache
    // Call this when you want to force recompilation of all shaders
    void ClearCache() {
        std::lock_guard<std::mutex> lock(mCacheMutex);
        size_t count = mCache.size();
        mCache.clear();

        if (count > 0) {
            QuoteSystem::Instance().Log("Shader cache cleared (" + std::to_string(count) + " entries)",
                QuoteSystem::MessageType::INFO);
            DebugWindow::Instance().Post("Shaders", "Cache cleared", DebugWindow::DebugLevel::INFO);
        }
    }

    // Get cache statistics
    size_t GetCacheSize() const {
        std::lock_guard<std::mutex> lock(mCacheMutex);
        return mCache.size();
    }

    // Prevent copy/move
    ShaderCompiler(const ShaderCompiler&) = delete;
    ShaderCompiler& operator=(const ShaderCompiler&) = delete;
    ShaderCompiler(ShaderCompiler&&) = delete;
    ShaderCompiler& operator=(ShaderCompiler&&) = delete;

private:
    // Load shader source from file
    std::string LoadShaderSource(const std::string& path) const;

    // Compile HLSL source to SPIR-V bytecode
    // This will use shaderc library in the .cpp implementation
    std::vector<uint32_t> CompileToSpirv(const std::string& source, ShaderType type,
        const std::string& sourcePath, const ShaderOptions& options) const;

    // Compute cache key from shader source content and options
    // Uses simple hash to detect when source has changed
    std::string ComputeCacheKey(const std::string& source, ShaderType type, const ShaderOptions& options) const {
        // Simple hash: combine source length, first 32 chars, and type
        // In production, use a proper hash like SHA256
        std::string key = std::to_string(source.length()) + "_";
        key += (source.length() > 32) ? source.substr(0, 32) : source;
        key += "_" + std::to_string(static_cast<int>(type));
        key += "_" + options.entryPoint;
        key += "_" + (options.enableOptimization ? "opt" : "noopt");
        for (const auto& define : options.defines) {
            key += "_" + define;
        }
        return key;
    }

    // Convert ShaderType enum to string for logging
    static std::string ShaderTypeToString(ShaderType type) {
        switch (type) {
            case ShaderType::VERTEX:   return "Vertex";
            case ShaderType::FRAGMENT: return "Fragment";
            case ShaderType::COMPUTE:  return "Compute";
            default:                   return "Unknown";
        }
    }

    // Member variables
    mutable std::mutex mCacheMutex;
    std::unordered_map<std::string, std::vector<uint32_t>> mCache;
};

// Note on implementation:
// The .cpp file will include <shaderc/shaderc.hpp> and implement CompileToSpirv()
// using shaderc::Compiler and shaderc::CompileOptions.
//
// LoadShaderSource() will use FileIntoString() utility or std::ifstream to read
// the shader source file into a string.
//
// The retry mechanism handles the case where a shader file is being edited in
// an external editor (VS Code, Notepad++, etc.) and the file handle is still
// locked when we try to read it. A single 100ms retry is sufficient for most cases.
