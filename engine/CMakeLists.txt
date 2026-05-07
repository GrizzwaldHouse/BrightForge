cmake_minimum_required(VERSION 3.20)
project(BrightForgeEngine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(BRIGHTFORGE_ENABLE_VULKAN "Build the Vulkan renderer (requires Vulkan SDK + GateWare)" OFF)

# Infrastructure demo — no external dependencies
add_executable(brightforge_engine_demo src/main.cpp)
target_include_directories(brightforge_engine_demo PRIVATE
    src/core
    src/rendering
)

# Platform-specific threading
find_package(Threads REQUIRED)
target_link_libraries(brightforge_engine_demo PRIVATE Threads::Threads)

if(BRIGHTFORGE_ENABLE_VULKAN)
    message(WARNING
        "Vulkan backend is not yet ported. "
        "See engine/README.md for the porting checklist. "
        "Building demo without Vulkan for now."
    )
endif()
