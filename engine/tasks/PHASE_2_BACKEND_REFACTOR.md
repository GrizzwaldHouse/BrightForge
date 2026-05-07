# Phase 2: Backend Refactor - Task Breakdown

**Agents:** RenderingEngineer + FileSystemEngineer (parallel tracks)
**Prerequisite:** Phase 1 complete (all 6 analysis tasks done)
**Status:** PENDING

---

## Track A: Rendering Engineer Tasks

### Task 2.1: Extract Vulkan Context

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | RenderingEngineer |

### Description

Extract all Vulkan initialization and device management into a dedicated `VulkanContext` class that owns the core Vulkan handles.

### Steps

1. Create `VulkanContext` class with ownership of:
   - `VkInstance`
   - `VkPhysicalDevice`
   - `VkDevice`
   - `VkQueue` (graphics + present)
   - `VkSurfaceKHR`
   - `VkSwapchainKHR`
2. Move initialization logic out of `main.cpp` and `Renderer` into `VulkanContext`
3. Implement RAII cleanup in destructor (reverse order of creation)
4. Expose query methods for device properties and queue family indices
5. Remove all `extern` Vulkan handles from global scope

```cpp
class VulkanContext {
public:
    VulkanContext(const VulkanContextConfig& config);
    ~VulkanContext(); // RAII cleanup

    VkDevice device() const { return m_device; }
    VkPhysicalDevice physicalDevice() const { return m_physicalDevice; }
    VkInstance instance() const { return m_instance; }
    VkQueue graphicsQueue() const { return m_graphicsQueue; }
    VkQueue presentQueue() const { return m_presentQueue; }

    uint32_t graphicsQueueFamily() const;
    VkPhysicalDeviceProperties deviceProperties() const;
    VkPhysicalDeviceMemoryProperties memoryProperties() const;

private:
    VkInstance m_instance = VK_NULL_HANDLE;
    VkPhysicalDevice m_physicalDevice = VK_NULL_HANDLE;
    VkDevice m_device = VK_NULL_HANDLE;
    VkQueue m_graphicsQueue = VK_NULL_HANDLE;
    VkQueue m_presentQueue = VK_NULL_HANDLE;
    VkSurfaceKHR m_surface = VK_NULL_HANDLE;
    VkSwapchainKHR m_swapchain = VK_NULL_HANDLE;
};
```

### Acceptance Criteria

- [ ] All Vulkan handles owned by `VulkanContext`
- [ ] No `extern` Vulkan handles remain in global scope
- [ ] RAII cleanup verified (no leaks on destruction)
- [ ] Existing rendering still works with `VulkanContext` as the source of handles

---

### Task 2.2: Create ShaderCompiler Service

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | RenderingEngineer |

### Description

Merge the three separate shader compile functions into a single `ShaderCompiler` service with caching and retry support.

### Steps

1. Merge `CompileVertexShader`, `CompileFragmentShader`, and any other compile function into one:
   ```cpp
   class ShaderCompiler {
   public:
       ShaderCompiler(VkDevice device);

       VkShaderModule compile(
           VkShaderStageFlagBits stage,
           const std::string& source,
           const std::string& entryPoint = "main"
       );

       VkShaderModule compileFromFile(
           VkShaderStageFlagBits stage,
           const std::filesystem::path& path
       );

       void clearCache();

   private:
       VkDevice m_device;
       std::unordered_map<size_t, VkShaderModule> m_cache; // keyed by file content hash
       VkShaderModule compileInternal(VkShaderStageFlagBits stage, const std::vector<uint32_t>& spirv);
   };
   ```
2. Implement cache keyed by SHA-256 hash of source content
3. Add retry mechanism (up to 3 attempts) for transient compilation failures
4. Destroy cached shader modules in destructor
5. Remove old standalone compile functions

### Acceptance Criteria

- [ ] Single `compile()` method handles all shader stages
- [ ] Cache prevents redundant recompilation of identical sources
- [ ] Retry mechanism works for transient failures
- [ ] Old compile functions removed, all call sites updated

---

### Task 2.3: Create DescriptorManager

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | RenderingEngineer |

### Description

Centralize all descriptor set management into a `DescriptorManager` that owns pools, layouts, and sets, with automatic pool exhaustion handling.

### Steps

1. Create `DescriptorManager` class:
   ```cpp
   class DescriptorManager {
   public:
       DescriptorManager(VkDevice device, uint32_t maxSets = 1000);
       ~DescriptorManager();

       VkDescriptorSetLayout createLayout(const std::vector<VkDescriptorSetLayoutBinding>& bindings);
       VkDescriptorSet allocateSet(VkDescriptorSetLayout layout);
       void freeSet(VkDescriptorSet set);

       void updateSet(VkDescriptorSet set, const std::vector<VkWriteDescriptorSet>& writes);

   private:
       VkDevice m_device;
       std::vector<VkDescriptorPool> m_pools;
       VkDescriptorPool m_currentPool = VK_NULL_HANDLE;
       uint32_t m_maxSetsPerPool;

       VkDescriptorPool createPool();
       void handlePoolExhaustion(); // allocate new pool, add to m_pools
   };
   ```
2. Handle `VK_ERROR_OUT_OF_POOL_MEMORY` by allocating a new pool automatically
3. Track allocated sets for bulk cleanup
4. Move all raw `vkAllocateDescriptorSets` calls to use this manager

### Acceptance Criteria

- [ ] All descriptor operations go through `DescriptorManager`
- [ ] Pool exhaustion handled gracefully (new pool allocated)
- [ ] No raw `vkAllocateDescriptorSets` / `vkCreateDescriptorPool` calls remain outside the manager
- [ ] Clean destruction of all pools

---

### Task 2.4: Create BufferAllocator

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | RenderingEngineer |

### Description

Wrap `GvkHelper::create_buffer` in a `BufferAllocator` with memory budget tracking and typed allocation helpers.

### Steps

1. Create `BufferAllocator` class:
   ```cpp
   class BufferAllocator {
   public:
       BufferAllocator(VkDevice device, VkPhysicalDevice physDevice);
       ~BufferAllocator();

       struct BufferAllocation {
           VkBuffer buffer;
           VkDeviceMemory memory;
           VkDeviceSize size;
           void* mapped = nullptr; // non-null if persistently mapped
       };

       BufferAllocation createVertexBuffer(const void* data, VkDeviceSize size);
       BufferAllocation createIndexBuffer(const void* data, VkDeviceSize size);
       BufferAllocation createUniformBuffer(VkDeviceSize size);
       BufferAllocation createStagingBuffer(VkDeviceSize size);

       void destroy(BufferAllocation& allocation);

       VkDeviceSize totalAllocated() const { return m_totalAllocated; }
       VkDeviceSize budgetLimit() const { return m_budgetLimit; }
       void setBudgetLimit(VkDeviceSize limit) { m_budgetLimit = limit; }

   private:
       VkDevice m_device;
       VkPhysicalDevice m_physDevice;
       VkDeviceSize m_totalAllocated = 0;
       VkDeviceSize m_budgetLimit = 0; // 0 = unlimited
   };
   ```
2. Wrap existing `GvkHelper::create_buffer` calls
3. Track total memory allocated and enforce optional budget limit
4. Log warnings when approaching budget threshold (80%)

### Acceptance Criteria

- [ ] All buffer creation goes through `BufferAllocator`
- [ ] Memory budget tracking is accurate
- [ ] Budget warning logged at 80% threshold
- [ ] All allocations properly freed on destruction

---

### Task 2.5: Implement RenderService Interface

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Tasks 2.1, 2.2, 2.3, 2.4 |
| Agent | RenderingEngineer |

### Description

Define an abstract `IRenderService` interface and implement it with `VulkanRenderService`, composing the context, compiler, descriptor manager, and buffer allocator.

### Steps

1. Define the interface:
   ```cpp
   class IRenderService {
   public:
       virtual ~IRenderService() = default;

       virtual bool initialize(const RenderConfig& config) = 0;
       virtual void shutdown() = 0;

       virtual void beginFrame() = 0;
       virtual void endFrame() = 0;
       virtual void drawMesh(const MeshData& mesh, const Material& material, const glm::mat4& transform) = 0;
       virtual void resize(uint32_t width, uint32_t height) = 0;

       virtual void setCamera(const CameraState& camera) = 0;
       virtual void setLighting(const LightingState& lighting) = 0;
   };
   ```
2. Implement `VulkanRenderService : public IRenderService`:
   - Owns `VulkanContext`, `ShaderCompiler`, `DescriptorManager`, `BufferAllocator`
   - Implements frame lifecycle (begin/end)
   - Handles swapchain recreation on resize
3. Update all call sites to use `IRenderService*` instead of direct Vulkan calls
4. Remove the `extern` globals that were providing render state

### Acceptance Criteria

- [ ] `IRenderService` interface is clean and backend-agnostic
- [ ] `VulkanRenderService` composes all four sub-services
- [ ] No direct Vulkan calls remain outside the render service
- [ ] Swapchain recreation works on window resize

---

### Task 2.6: Config-Driven Rendering

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Task 2.5 |
| Agent | RenderingEngineer |

### Description

Replace all hardcoded rendering values with a `RenderConfig` struct loaded from configuration.

### Steps

1. Define `RenderConfig`:
   ```cpp
   struct RenderConfig {
       uint32_t width = 1280;
       uint32_t height = 720;
       bool vsync = true;
       uint32_t maxFramesInFlight = 2;
       float nearPlane = 0.1f;
       float farPlane = 1000.0f;
       VkSampleCountFlagBits msaaSamples = VK_SAMPLE_COUNT_1_BIT;
       VkPresentModeKHR presentMode = VK_PRESENT_MODE_FIFO_KHR;
       VkClearColorValue clearColor = {{0.0f, 0.0f, 0.0f, 1.0f}};
       float depthClearValue = 1.0f;
       VkCompareOp depthCompareOp = VK_COMPARE_OP_LESS;
   };
   ```
2. Replace every hardcoded value in the renderer with a `RenderConfig` field
3. Support loading config from a YAML or JSON file
4. Allow runtime config changes that trigger pipeline recreation

### Acceptance Criteria

- [ ] Zero hardcoded rendering values remain in renderer code
- [ ] Config loads from file at startup
- [ ] Runtime config changes propagate correctly
- [ ] Default config produces identical output to current hardcoded behavior

---

## Track B: FileSystem Engineer Tasks

### Task 2.7: Design File Ingestion System

| Field | Value |
|-------|-------|
| Priority | HIGH |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | FileSystemEngineer |

### Description

Create a `FileService` that handles loading 3D model files with format validation based on magic bytes rather than file extensions.

### Steps

1. Create `FileService` class:
   ```cpp
   class FileService {
   public:
       struct FileResult {
           bool success;
           std::string error;
           std::vector<uint8_t> data;
           std::string detectedFormat; // "obj", "fbx", "gltf", "glb", etc.
       };

       FileResult loadFile(const std::filesystem::path& path);
       bool isSupported(const std::filesystem::path& path);

   private:
       std::string detectFormat(const std::vector<uint8_t>& header);
       bool validateMagicBytes(const std::vector<uint8_t>& header, const std::string& expectedFormat);
   };
   ```
2. Implement magic byte detection for supported formats:
   - **OBJ**: Text-based, detect by `v ` / `vn ` / `f ` line prefixes
   - **FBX**: Magic bytes `4B 61 79 64 61 72 61 20` ("Kaydara ")
   - **glTF**: JSON with `"asset"` key
   - **GLB**: Magic bytes `67 6C 54 46` ("glTF") + version uint32
   - **STL**: Binary starts with 80-byte header + triangle count, or ASCII starts with `solid`
3. Reject files that fail magic byte validation even if extension matches
4. Return structured errors for unsupported or corrupt files

### Acceptance Criteria

- [ ] Format detection works by content, not extension
- [ ] All five formats detected correctly
- [ ] Corrupt/mismatched files rejected with clear error messages
- [ ] File data loaded into memory with proper error handling

---

### Task 2.8: Create Asset Index

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Phase 1 complete |
| Agent | FileSystemEngineer |

### Description

Build a searchable catalog of loaded assets backed by SQLite.

### Steps

1. Design SQLite schema:
   ```sql
   CREATE TABLE assets (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       path TEXT NOT NULL UNIQUE,
       format TEXT NOT NULL,
       file_size INTEGER NOT NULL,
       vertex_count INTEGER,
       face_count INTEGER,
       has_normals BOOLEAN DEFAULT 0,
       has_uvs BOOLEAN DEFAULT 0,
       thumbnail_path TEXT,
       tags TEXT, -- comma-separated
       imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       last_accessed DATETIME
   );

   CREATE INDEX idx_assets_name ON assets(name);
   CREATE INDEX idx_assets_format ON assets(format);
   CREATE INDEX idx_assets_tags ON assets(tags);
   ```
2. Implement `AssetIndex` class:
   ```cpp
   class AssetIndex {
   public:
       AssetIndex(const std::filesystem::path& dbPath);

       int addAsset(const AssetMetadata& meta);
       void removeAsset(int id);
       std::vector<AssetMetadata> search(const std::string& query);
       std::vector<AssetMetadata> listByFormat(const std::string& format);
       std::optional<AssetMetadata> getById(int id);
       void updateLastAccessed(int id);
   };
   ```
3. Support full-text search on name and tags
4. Auto-populate metadata (vertex count, face count) during import

### Acceptance Criteria

- [ ] SQLite database created and migrated on first run
- [ ] Assets indexed with full metadata
- [ ] Search returns results by name, format, or tags
- [ ] Last-accessed timestamp updated on load

---

### Task 2.9: Drag-and-Drop Backend

| Field | Value |
|-------|-------|
| Priority | MED |
| Status | PENDING |
| Dependencies | Tasks 2.7, 2.8 |
| Agent | FileSystemEngineer |

### Description

Implement a `DropHandler` backend that processes dropped files through the `FileService` and `AssetIndex`, with batch support and async loading.

### Steps

1. Create `DropHandler`:
   ```cpp
   class DropHandler {
   public:
       DropHandler(FileService& fileService, AssetIndex& assetIndex);

       struct DropResult {
           int totalFiles;
           int successCount;
           int failCount;
           std::vector<std::string> errors;
           std::vector<int> assetIds; // IDs of successfully imported assets
       };

       // Synchronous single file
       DropResult handleDrop(const std::filesystem::path& path);

       // Batch drop (multiple files or directory)
       DropResult handleBatchDrop(const std::vector<std::filesystem::path>& paths);

       // Async loading with progress callback
       void handleDropAsync(
           const std::vector<std::filesystem::path>& paths,
           std::function<void(int current, int total)> progressCallback,
           std::function<void(DropResult)> completionCallback
       );

   private:
       FileService& m_fileService;
       AssetIndex& m_assetIndex;
   };
   ```
2. Support single file drops, multi-file drops, and directory drops (recurse)
3. Async loading runs on a worker thread with progress reporting
4. Each file goes through: validate -> load -> index -> report

### Acceptance Criteria

- [ ] Single file drop works end-to-end
- [ ] Batch drops processed correctly with aggregate results
- [ ] Async loading reports progress without blocking UI thread
- [ ] Failed files do not block processing of remaining files

---

## Testing Requirements

All tasks in Phase 2 must include TestManager test cases.

### Rendering Engineer Tests

```cpp
// Task 2.1
TestManager::add("VulkanContext_creates_device", []() {
    VulkanContext ctx(defaultConfig());
    ASSERT(ctx.device() != VK_NULL_HANDLE);
    ASSERT(ctx.physicalDevice() != VK_NULL_HANDLE);
});

TestManager::add("VulkanContext_cleanup_no_leaks", []() {
    { VulkanContext ctx(defaultConfig()); }
    // Validation layers should report no leaks
});

// Task 2.2
TestManager::add("ShaderCompiler_vertex_and_fragment", []() {
    ShaderCompiler compiler(device);
    auto vert = compiler.compile(VK_SHADER_STAGE_VERTEX_BIT, vertSource);
    auto frag = compiler.compile(VK_SHADER_STAGE_FRAGMENT_BIT, fragSource);
    ASSERT(vert != VK_NULL_HANDLE);
    ASSERT(frag != VK_NULL_HANDLE);
});

TestManager::add("ShaderCompiler_cache_hit", []() {
    ShaderCompiler compiler(device);
    auto first = compiler.compile(VK_SHADER_STAGE_VERTEX_BIT, vertSource);
    auto second = compiler.compile(VK_SHADER_STAGE_VERTEX_BIT, vertSource);
    ASSERT(first == second); // same module returned from cache
});

// Task 2.3
TestManager::add("DescriptorManager_allocate_set", []() {
    DescriptorManager mgr(device);
    auto layout = mgr.createLayout({{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_VERTEX_BIT}});
    auto set = mgr.allocateSet(layout);
    ASSERT(set != VK_NULL_HANDLE);
});

TestManager::add("DescriptorManager_pool_exhaustion_recovery", []() {
    DescriptorManager mgr(device, 2); // max 2 sets per pool
    mgr.allocateSet(layout);
    mgr.allocateSet(layout);
    auto third = mgr.allocateSet(layout); // should trigger new pool
    ASSERT(third != VK_NULL_HANDLE);
});

// Task 2.4
TestManager::add("BufferAllocator_tracks_memory", []() {
    BufferAllocator alloc(device, physDevice);
    auto buf = alloc.createVertexBuffer(data, 1024);
    ASSERT(alloc.totalAllocated() >= 1024);
    alloc.destroy(buf);
});

// Task 2.5
TestManager::add("VulkanRenderService_frame_lifecycle", []() {
    VulkanRenderService svc;
    svc.initialize(defaultConfig());
    svc.beginFrame();
    svc.endFrame();
    svc.shutdown();
});

// Task 2.6
TestManager::add("RenderConfig_loads_from_file", []() {
    RenderConfig config = RenderConfig::loadFromFile("test_config.yaml");
    ASSERT(config.width == 1920);
    ASSERT(config.vsync == true);
});
```

### FileSystem Engineer Tests

```cpp
// Task 2.7
TestManager::add("FileService_detect_glb_magic_bytes", []() {
    FileService fs;
    auto result = fs.loadFile("test_assets/cube.glb");
    ASSERT(result.success);
    ASSERT(result.detectedFormat == "glb");
});

TestManager::add("FileService_reject_corrupt_file", []() {
    FileService fs;
    auto result = fs.loadFile("test_assets/corrupt.fbx");
    ASSERT(!result.success);
    ASSERT(!result.error.empty());
});

// Task 2.8
TestManager::add("AssetIndex_search_by_name", []() {
    AssetIndex index(":memory:");
    index.addAsset({.name = "TestCube", .format = "obj"});
    auto results = index.search("cube");
    ASSERT(results.size() == 1);
});

// Task 2.9
TestManager::add("DropHandler_batch_partial_failure", []() {
    DropHandler handler(fileService, assetIndex);
    auto result = handler.handleBatchDrop({"valid.obj", "invalid.xyz"});
    ASSERT(result.successCount == 1);
    ASSERT(result.failCount == 1);
});
```

---

## Phase 2 Summary

| Task | Track | Priority | Dependencies | Agent |
|------|-------|----------|--------------|-------|
| 2.1 Extract Vulkan Context | A | HIGH | Phase 1 | RenderingEngineer |
| 2.2 Create ShaderCompiler Service | A | HIGH | Phase 1 | RenderingEngineer |
| 2.3 Create DescriptorManager | A | HIGH | Phase 1 | RenderingEngineer |
| 2.4 Create BufferAllocator | A | MED | Phase 1 | RenderingEngineer |
| 2.5 Implement RenderService Interface | A | HIGH | 2.1-2.4 | RenderingEngineer |
| 2.6 Config-Driven Rendering | A | MED | 2.5 | RenderingEngineer |
| 2.7 Design File Ingestion System | B | HIGH | Phase 1 | FileSystemEngineer |
| 2.8 Create Asset Index | B | MED | Phase 1 | FileSystemEngineer |
| 2.9 Drag-and-Drop Backend | B | MED | 2.7, 2.8 | FileSystemEngineer |

**Note:** Tracks A and B can execute in parallel. Track A tasks 2.1-2.4 can also run in parallel; 2.5 blocks on all four.
