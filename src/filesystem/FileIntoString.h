/**
 * FileIntoString - Simple file reading utilities
 * @author Marcus Daley
 * @date April 2026
 */

#pragma once

#include <string>
#include <fstream>
#include <sstream>
#include <filesystem>
#include <chrono>
#include "../core/QuoteSystem.h"

namespace BrightForge {

class FileIntoString {
public:
    FileIntoString() = default;
    ~FileIntoString() = default;

    // Read entire file into string
    static std::string ReadFile(const std::string& path) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Cannot read empty path");
            return "";
        }

        if (!FileExists(path)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "File not found: " + path);
            return "";
        }

        std::ifstream file(path, std::ios::in | std::ios::binary);
        if (!file.is_open()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Failed to open file: " + path);
            return "";
        }

        std::stringstream buffer;
        buffer << file.rdbuf();
        std::string contents = buffer.str();

        file.close();

        QuoteSystem::Get().Log("SUCCESS", "FileIntoString",
            "Read " + std::to_string(contents.size()) + " bytes: " + path);

        return contents;
    }

    // Check if file exists
    static bool FileExists(const std::string& path) {
        if (path.empty()) {
            return false;
        }

        bool exists = std::filesystem::exists(path);

        if (!exists) {
            QuoteSystem::Get().Log("WARNING", "FileIntoString", "File not found: " + path);
        }

        return exists;
    }

    // Get file size in bytes
    static size_t GetFileSize(const std::string& path) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Cannot get size of empty path");
            return 0;
        }

        if (!FileExists(path)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "File not found: " + path);
            return 0;
        }

        std::error_code ec;
        size_t size = std::filesystem::file_size(path, ec);

        if (ec) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString",
                "Failed to get file size: " + path + " - " + ec.message());
            return 0;
        }

        QuoteSystem::Get().Log("SUCCESS", "FileIntoString",
            "File size: " + std::to_string(size) + " bytes - " + path);

        return size;
    }

    // Get last modification time as formatted string
    static std::string GetLastModified(const std::string& path) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Cannot get modification time of empty path");
            return "";
        }

        if (!FileExists(path)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "File not found: " + path);
            return "";
        }

        std::error_code ec;
        auto ftime = std::filesystem::last_write_time(path, ec);

        if (ec) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString",
                "Failed to get modification time: " + path + " - " + ec.message());
            return "";
        }

        // Convert to system_clock time_point for formatting
        auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
            ftime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now()
        );

        auto timeT = std::chrono::system_clock::to_time_t(sctp);

        char buffer[64];
        if (std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", std::localtime(&timeT)) == 0) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Failed to format timestamp");
            return "";
        }

        std::string timestamp(buffer);

        QuoteSystem::Get().Log("SUCCESS", "FileIntoString",
            "Last modified: " + timestamp + " - " + path);

        return timestamp;
    }

    // Read file with size limit (prevents loading huge files into memory)
    static std::string ReadFileWithLimit(const std::string& path, size_t maxBytes) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Cannot read empty path");
            return "";
        }

        if (!FileExists(path)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "File not found: " + path);
            return "";
        }

        size_t fileSize = GetFileSize(path);
        if (fileSize > maxBytes) {
            QuoteSystem::Get().Log("WARNING", "FileIntoString",
                "File exceeds limit (" + std::to_string(fileSize) + " > " +
                std::to_string(maxBytes) + " bytes): " + path);
            return "";
        }

        return ReadFile(path);
    }

    // Read first N lines from file
    static std::string ReadLines(const std::string& path, size_t maxLines) {
        if (path.empty()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Cannot read empty path");
            return "";
        }

        if (!FileExists(path)) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "File not found: " + path);
            return "";
        }

        std::ifstream file(path);
        if (!file.is_open()) {
            QuoteSystem::Get().Log("ERROR_MSG", "FileIntoString", "Failed to open file: " + path);
            return "";
        }

        std::stringstream buffer;
        std::string line;
        size_t lineCount = 0;

        while (lineCount < maxLines && std::getline(file, line)) {
            buffer << line << '\n';
            lineCount++;
        }

        file.close();

        std::string contents = buffer.str();

        QuoteSystem::Get().Log("SUCCESS", "FileIntoString",
            "Read " + std::to_string(lineCount) + " lines (" +
            std::to_string(contents.size()) + " bytes): " + path);

        return contents;
    }
};

} // namespace BrightForge
