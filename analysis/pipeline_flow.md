# BrightForge Rendering Pipeline Flow Analysis
**Developer:** Marcus Daley
**Date:** 2026-04-14
**Purpose:** Trace complete data flow from vertex input to pixel output in the software rasterizer pipeline

---

## Executive Summary

**Pipeline Type:** CPU-based software rasterizer (NO GPU acceleration)
**Rendering API:** Custom (no Vulkan/DirectX — those are Phase 2+ goals)
**Stages:** 7 (App Input → Vertex Shader → Projection → NDC → Screen Space → Rasterization → Pixel Output)
**Performance:** Single-threaded, no SIMD optimization
**Framebuffer:** 600x500 pixels (300,000 pixels), 32-bit ARGB color + float depth buffer

---

## Pipeline Stage Overview

```
┌─────────────────┐
│  Application    │  main.cpp: testManager.update()/render()
│     Logic       │  Constructs vertex/index arrays for cube/grid/stars
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Renderer.       │  Renderer.h: renderMesh(vertices, indices, isCube, mode)
│  renderMesh()   │  Sets vsWorld/vsView/vsProjection global matrices
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Vertex Shader   │  Shaders.cpp: vsWorldViewTransform() or vsLighting()
│  Transformation │  Applies world → view transformation
└────────┬────────┘  Color assignment for grid/cube
         │
         ▼
┌─────────────────┐
│  Projection +   │  Shaders.cpp: vsProjectionTransform()
│ Persp. Divide   │  Applies projection matrix, divides by w
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ NDC → Screen    │  GraphicsHelper.hpp: NDCToScreen(x, y)
│   Conversion    │  Maps [-1,1] NDC to [0,600]x[0,500] pixels
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Rasterization  │  LineDrawing.h: draw3DLine() or drawTriangle()
│  (Scan Conv.)   │  Bresenham for lines, barycentric for triangles
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Depth Test +    │  GraphicsHelper.hpp: drawPixel(x, y, depth, color)
│ Framebuffer Wr. │  if (depth <= mDepthBuffer[index]) write pixel
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Display Blit   │  main.cpp: RS_Update(graphics.getPixels(), kTotalPixels)
│                 │  Copies framebuffer to window (external RasterSurface API)
└─────────────────┘
```

---

## Stage 1: Application Logic (TestManager)

### Entry Point: `TestManager::render()`

**File:** TestManager.h, lines 255-290

**Responsibilities:**
1. Clear framebuffer via `graphic.clearBuffer(GraphicsConstrants::kColorDarkBlue)`
2. Determine current assignment stage (STAR_FIELD, DIRECTIONAL_LIGHT, POINT_LIGHT)
3. Call appropriate render functions:
   - `renderStarField()` — 3000 star vertices
   - `renderGrid()` — wireframe grid mesh
   - `renderLightingScene()` — cube + grid + light marker

**Data Flow:**

```cpp
// TestManager.h, line 264 (STAR_FIELD stage)
graphic.clearBuffer(GraphicsConstrants::kColorDarkBlue);
renderStarField();  // Processes mStarField (vector<Vertex>)
if (showGrid) renderGrid();  // Processes gridMesh (unique_ptr<Mesh>)
```

**Star Field Rendering (lines 455-591):**
```cpp
void renderStarField() {
    vsWorld = Matrix4x4::identity();  // Line 458

    for (size_t i = 0; i < mStarField.size(); ++i) {
        const Vertex& star = mStarField[i];

        // Manual view transformation (bypasses shader)
        Vector4 viewPos = camera->getViewMatrix().transformVector(star.position);

        // Frustum culling
        if (viewPos.z < 0.1f) continue;  // Behind camera

        // Manual projection transformation
        Vector4 projPos = renderer.getProjectionMatrix().transformVector(viewPos);

        // Perspective divide
        float ndcX = projPos.x / projPos.w;
        float ndcY = projPos.y / projPos.w;
        float ndcZ = projPos.z / projPos.w;

        // Manual NDC → screen space
        float screenX = ndcX;
        float screenY = ndcY;
        graphic.NDCToScreen(screenX, screenY);

        // Bypass normal pipeline — write directly to framebuffer
        graphic.drawDebugStar(
            static_cast<unsigned int>(screenX),
            static_cast<unsigned int>(screenY),
            ndcZ,
            star.color,
            starSize
        );
    }
}
```

**Key Observation:** Star field rendering BYPASSES the standard pipeline (no vertex shader call). This is an optimization for rendering thousands of points without the overhead of the full transformation pipeline.

**Grid Rendering (lines 810-815):**
```cpp
void renderGrid() {
    vsWorld = Matrix4x4::identity();  // Line 813
    renderer.renderMesh(
        gridMesh->getVertices(),
        gridMesh->getIdices(),
        false,  // isCube = false (wireframe mode)
        Renderer::TestMode::DEPTH_BUFFER_TEST
    );
}
```

**Lighting Scene Rendering (lines 648-696):**
```cpp
void renderLightingScene() {
    graphic.clearBuffer(GraphicsConstrants::kColorDarkBlue);
    renderStarField();  // Background
    if (showGrid) renderGrid();

    vsWorld = Matrix4x4::identity();  // Line 665

    // Render debug cube (uses full pipeline)
    if (debugCube) {
        renderer.renderMesh(
            debugCube->getVertices(),
            debugCube->getIdices(),
            true,  // isCube = true (solid mesh)
            Renderer::TestMode::DEPTH_BUFFER_TEST
        );
    }

    // Render point light marker
    if (usePointLight && debugPointLightMarker) {
        Matrix4x4 lightTransform = Matrix4x4::translation(pointLightPos);
        vsWorld = lightTransform;  // Line 681

        renderer.renderMesh(
            debugPointLightMarker->getVertices(),
            debugPointLightMarker->getIdices(),
            true,
            Renderer::TestMode::DEPTH_BUFFER_TEST
        );
    }
}
```

---

## Stage 2: Renderer Mesh Processing

### Entry Point: `Renderer::renderMesh()`

**File:** Renderer.h, lines 138-198

**Function Signature:**
```cpp
void renderMesh(
    const std::vector<Vertex>& vertices,
    const std::vector<unsigned int>& indices,
    bool isCube,  // Determines solid vs wireframe rendering
    TestMode currentMode,  // Currently unused (architectural debt)
    const unsigned int* texture = nullptr,  // Optional texture buffer
    int texWidth = 0,
    int texHeight = 0
)
```

**Step-by-Step Flow:**

1. **Set Global State (lines 142-147):**
```cpp
::isCube = isCube;  // Global flag in Shaders.cpp

vsWorld = isCube ? mCubeWorldMatrix : mGridWorldMatrix;  // Line 145
vsView = mMainCamera->getViewMatrix();                    // Line 146
vsProjection = mProjectionMatrix;                         // Line 147
```

2. **Branch on Mesh Type:**

**Path A: Non-Cube Meshes (Grid — lines 150-188):**
```cpp
if (!isCube) {
    for (size_t i = 0; i + 2 < indices.size(); i += 3) {  // Triangle loop
        Vertex v0 = vertices[indices[i]];      // COPY vertices
        Vertex v1 = vertices[indices[i + 1]];
        Vertex v2 = vertices[indices[i + 2]];

        // Vertex shader: world + view transformation
        vsWorldViewTransform(v0);  // Line 160
        vsWorldViewTransform(v1);
        vsWorldViewTransform(v2);

        // Backface culling (if enabled)
        if (mRenderState.enableBackfaceCulling) {
            Vector4 edge1 = v1.position - v0.position;
            Vector4 edge2 = v2.position - v0.position;

            // Cross product for face normal
            float nx = edge1.y * edge2.z - edge1.z * edge2.y;  // Line 169
            float ny = edge1.z * edge2.x - edge1.x * edge2.z;
            float nz = edge1.x * edge2.y - edge1.y * edge2.x;

            // Dot product with vertex position (view space)
            if (nx * v0.position.x + ny * v0.position.y + nz * v0.position.z > 0) {
                continue;  // Skip back-facing triangle
            }
        }

        // Projection transform
        vsProjectionTransform(v0);  // Line 179
        vsProjectionTransform(v1);
        vsProjectionTransform(v2);

        // NDC → screen space
        mGraphics.NDCToScreen(v0.position.x, v0.position.y);  // Line 183
        mGraphics.NDCToScreen(v1.position.x, v1.position.y);
        mGraphics.NDCToScreen(v2.position.x, v2.position.y);

        // Note: Transformed vertices are NOT passed to rasterizer!
        // This path appears to be incomplete — triangles are transformed
        // but never drawn. Likely missing drawTriangle() call.
    }
}
```

**CRITICAL BUG:** Lines 150-188 transform triangles but never rasterize them. The transformed vertices are discarded at the end of the loop. This suggests the grid path is broken or incomplete.

**Path B: Cube Meshes (Wireframe — lines 190-197):**
```cpp
else {  // isCube == true
    for (size_t i = 0; i < indices.size(); i += 2) {  // Line pairs
        const Vertex& v0 = vertices[indices[i]];      // REFERENCE (no copy)
        const Vertex& v1 = vertices[indices[i + 1]];

        mLivingDrawing.draw3DLine(v0, v1);  // Line 195
    }
}
```

**Key Difference:** Cube rendering uses `draw3DLine()` which applies the vertex shader internally. Grid rendering transforms vertices but doesn't rasterize them.

---

## Stage 3: Vertex Shader Transformation

### Entry Point: Global `VertexShader` Function Pointer

**File:** Shaders.h, line 15 (declaration), Shaders.cpp, line 9 (definition)

**Function Pointer Assignment:**
```cpp
// Shaders.cpp, line 9
VertexShaderFunc VertexShader = vsWorldViewTransform;  // Default shader

// TestManager.h, line 301 (STAR_FIELD stage)
VertexShader = vsWorldViewTransform;

// TestManager.h, line 319 (DIRECTIONAL_LIGHT stage)
VertexShader = vsLighting;

// TestManager.h, line 333 (POINT_LIGHT stage)
VertexShader = vsLighting;
```

### Shader Option 1: `vsWorldViewTransform()` (Basic Transformation)

**File:** Shaders.cpp, lines 36-51

```cpp
void vsWorldViewTransform(Vertex& v) {
    // Color handling
    if (isCube) {
        v.color = v.color;  // Keep original color (line 40)
    } else {
        v.color = GraphicsConstrants::kColorWhite;  // Grid override (line 43)
    }

    // World transform: v' = M_world * v
    v.position = vsWorld.transformVector(v.position);  // Line 47

    // View transform: v'' = M_view * v'
    v.position = vsView.transformVector(v.position);  // Line 50
}
```

**Matrix Transformation (Matrix.h, lines 79-87):**
```cpp
Vector4 transformVector(const Vector4& v) const {
    Vector4 result;
    result.x = v.x * V[0] + v.y * V[4] + v.z * V[8]  + v.w * V[12];  // Line 82
    result.y = v.x * V[1] + v.y * V[5] + v.z * V[9]  + v.w * V[13];
    result.z = v.x * V[2] + v.y * V[6] + v.z * V[10] + v.w * V[14];
    result.w = v.x * V[3] + v.y * V[7] + v.z * V[11] + v.w * V[15];
    return result;
}
```

### Shader Option 2: `vsLighting()` (Lighting + Transformation)

**File:** Shaders.cpp, lines 78-157

**Step-by-Step:**

1. **Transform Position to World Space (line 84):**
```cpp
Vector4 worldPos = vsWorld.transformVector(v.position);
```

2. **Transform Normal to World Space (lines 87-92):**
```cpp
Vector4 normal = v.normal;
normal.w = 0.0f;  // Zero w for direction vectors
Vector4 worldNormal = vsWorld.transformVector(normal);
worldNormal.w = 0.0f;
worldNormal = MathUtils::normalize(worldNormal);
```

3. **Initialize with Ambient Light (lines 95-99):**
```cpp
unsigned int totalLightColor = GraphicsConstrants::kColorBlack;
if (useAmbientLight) {
    totalLightColor = scaleColor(originalColor, ambientIntensity);  // Line 98
}
```

4. **Add Directional Light (lines 102-117):**
```cpp
if (useDirectionalLight) {
    Vector4 negLightDir = Vector4(-directionalLightDir.x, -directionalLightDir.y, -directionalLightDir.z, 0.0f);
    negLightDir = MathUtils::normalize(negLightDir);

    // Lambertian diffuse: dot(N, L)
    float lightRatio = MathUtils::dotProduct(worldNormal, negLightDir);  // Line 109
    lightRatio = MathUtils::Saturate(lightRatio);  // Clamp [0,1]

    unsigned int dirLightColor = scaleColor(directionalLightColor, lightRatio);
    totalLightColor = MathUtils::combineColors(totalLightColor, dirLightColor);  // Line 116
}
```

5. **Add Point Light with Attenuation (lines 120-150):**
```cpp
if (usePointLight) {
    Vector4 pointLightDirection = worldPos - pointLightPos;  // Line 123
    float pointLightDistance = MathUtils::vec3Length(pointLightDirection);  // Line 126

    // Range attenuation: 1 - clamp(distance/radius, 0, 1)
    float rangeAttenuation = 1.0f - std::min(pointLightDistance / pointLightRadius, 1.0f);  // Line 129
    float attenSquared = rangeAttenuation * rangeAttenuation;  // Quadratic falloff

    pointLightDirection = MathUtils::normalize(pointLightDirection);
    Vector4 negPointLightDir = Vector4(-pointLightDirection.x, -pointLightDirection.y, -pointLightDirection.z, 0.0f);

    // Lambertian diffuse
    float pointLightRatio = MathUtils::dotProduct(worldNormal, negPointLightDir);  // Line 139
    pointLightRatio = MathUtils::Saturate(pointLightRatio);

    // Combine ratio with attenuation
    float finalPointLightRatio = pointLightRatio * attenSquared;  // Line 143
    unsigned int pointLightContribution = scaleColor(pointLightColor, finalPointLightRatio);
    totalLightColor = MathUtils::combineColors(totalLightColor, pointLightContribution);
}
```

6. **Store Lighting Result (line 153):**
```cpp
v.color = totalLightColor;
```

7. **Continue with View Transform (line 156):**
```cpp
v.position = vsView.transformVector(worldPos);
```

**Lighting Model:** Phong-style diffuse (no specular component)

---

## Stage 4: Projection Transform + Perspective Divide

### Entry Point: `vsProjectionTransform()`

**File:** Shaders.cpp, lines 53-65

```cpp
void vsProjectionTransform(Vertex& v) {
    // Apply projection matrix
    v.position = vsProjection.transformVector(v.position);  // Line 56

    // Perspective divide (convert homogeneous to Cartesian)
    if (std::abs(v.position.w) > 0.00001f) {  // Avoid divide-by-zero
        float invW = 1.0f / v.position.w;
        v.position.x *= invW;  // Line 61
        v.position.y *= invW;
        v.position.z *= invW;
    }
}
```

**Projection Matrix Construction (Renderer.h, lines 96-118):**
```cpp
void setProjection(float fovY, float aspectRatio, float nearPlane, float farPlane) {
    float f = 1.0f / std::tan(fovY / 2.0f);  // Line 99
    float rangeInv = 1.0f / (farPlane - nearPlane);

    mProjectionMatrix = Matrix4x4::identity();

    mProjectionMatrix[0] = f / aspectRatio;  // X scale (line 105)
    mProjectionMatrix[5] = f;                // Y scale (line 108)
    mProjectionMatrix[10] = (farPlane + nearPlane) * rangeInv;  // Z buffer mapping
    mProjectionMatrix[11] = -1.0f;           // W = -Z (perspective)
    mProjectionMatrix[14] = 2.0f * farPlane * nearPlane * rangeInv;  // Z offset
    mProjectionMatrix[15] = 0.0f;

    vsProjection = mProjectionMatrix;  // Write to global (line 117)
}
```

**Projection Matrix Layout:**
```
┌                                          ┐
│  f/aspect      0           0         0   │
│      0         f           0         0   │
│      0         0    (far+near)/    -1    │
│                      (far-near)          │
│      0         0   2*far*near/     0     │
│                     (far-near)           │
└                                          ┘
```

**Output:** Normalized Device Coordinates (NDC)
- X: [-1, 1] (left to right)
- Y: [-1, 1] (bottom to top)
- Z: [0, 1] (near to far) — depth buffer range
- W: 1.0 (after perspective divide)

---

## Stage 5: NDC → Screen Space Conversion

### Entry Point: `GraphicsHelper::NDCToScreen()`

**File:** GraphicsHelper.hpp, lines 154-157

```cpp
void NDCToScreen(float& x, float& y) {
    x = (x + 1.0f) * (width * 0.5f);   // Line 155: [-1,1] → [0, 600]
    y = (1.0f - y) * (height * 0.5f);  // Line 156: [-1,1] → [0, 500], flip Y
}
```

**Transformation:**
- Input: NDC x ∈ [-1, 1], y ∈ [-1, 1]
- Output: Screen x ∈ [0, 600), y ∈ [0, 500)
- Y-flip: NDC +1 (top) → screen 0 (top), NDC -1 (bottom) → screen 500 (bottom)

**Example:**
- NDC (0, 0) → Screen (300, 250) — center of screen
- NDC (-1, -1) → Screen (0, 500) — bottom-left corner
- NDC (1, 1) → Screen (600, 0) — top-right corner

---

## Stage 6: Rasterization

### Path A: Line Rasterization (`draw3DLine()`)

**File:** LineDrawing.h, lines 68-127

```cpp
void draw3DLine(const Vertex& start, const Vertex& end) {
    Vertex v1 = start;  // Copy vertices
    Vertex v2 = end;

    // Apply vertex shader
    if (VertexShader) {
        VertexShader(v1);  // Line 77 (world + view transform)
        VertexShader(v2);
    }

    // Extract screen coords (already in view space from shader)
    float x1 = v1.position.x, y1 = v1.position.y;  // Line 81
    float x2 = v2.position.x, y2 = v2.position.y;
    float z1 = v1.position.z, z2 = v2.position.z;

    // NDC → screen space
    graphics.NDCToScreen(x1, y1);  // Line 86
    graphics.NDCToScreen(x2, y2);

    // Bresenham-style line drawing
    int dX = static_cast<int>(x2) - static_cast<int>(x1);  // Line 90
    int dY = static_cast<int>(y2) - static_cast<int>(y1);

    float stepsNeeded = static_cast<float>(std::max(std::abs(dX), std::abs(dY)));  // Line 94
    if (stepsNeeded == 0) {
        graphics.drawPixel(static_cast<unsigned int>(x1), static_cast<unsigned int>(y1), z1, v1.color);
        return;
    }

    // Linear interpolation setup
    float xIncrement = static_cast<float>(dX) / stepsNeeded;  // Line 105
    float yIncrement = static_cast<float>(dY) / stepsNeeded;
    float zIncrement = (z2 - z1) / stepsNeeded;  // Depth interpolation

    float x = x1, y = y1, z = z1;
    for (int step = 0; step <= stepsNeeded; step++) {
        graphics.drawPixel(
            static_cast<unsigned int>(x + 0.5f),  // Round to nearest pixel
            static_cast<unsigned int>(y + 0.5f),
            z,  // Interpolated depth
            v1.color  // Constant color (no color interpolation)
        );

        x += xIncrement;  // Line 123
        y += yIncrement;
        z += zIncrement;
    }
}
```

**Algorithm:** Bresenham-inspired (DDA-style linear interpolation)

### Path B: Triangle Rasterization (`drawTriangle()`)

**File:** LineDrawing.h, lines 152-263

**Step 1: Bounding Box Calculation (lines 158-175):**
```cpp
// Find axis-aligned bounding box
int minX = std::min({static_cast<int>(v0.position.x), static_cast<int>(v1.position.x), static_cast<int>(v2.position.x)});
int maxX = std::max({...});
int minY = std::min({...});
int maxY = std::max({...});

// Clip to screen boundaries
minX = std::max(minX, 0);  // Line 172
maxX = std::min(maxX, static_cast<int>(graphics.getWidth()) - 1);
minY = std::max(minY, 0);
maxY = std::min(maxY, static_cast<int>(graphics.getHeight()) - 1);
```

**Step 2: Per-Pixel Loop + Barycentric Test (lines 178-262):**
```cpp
for (int y = minY; y <= maxY; y++) {
    for (int x = minX; x <= maxX; x++) {
        // Calculate barycentric coordinates
        BarycentricCoords coords = calculateBarycentricCoords(x, y, v0, v1, v2);  // Line 181

        // Inside-triangle test (with epsilon for edge overlap)
        const float EPSILON = -0.00001f;  // Line 185
        if (coords.alpha >= EPSILON && coords.beta >= EPSILON && coords.gamma >= EPSILON) {

            // Interpolate depth
            float depth = coords.alpha * v0.position.z +
                          coords.beta * v1.position.z +
                          coords.gamma * v2.position.z;  // Line 188

            unsigned int pixelColor;

            if (texture && texWidth > 0 && texHeight > 0) {
                // PERSPECTIVE-CORRECT TEXTURE MAPPING (lines 196-232)

                // Divide UVs by W before interpolation
                float invW0 = 1.0f / v0.position.w;  // Line 198
                float invW1 = 1.0f / v1.position.w;
                float invW2 = 1.0f / v2.position.w;

                float u_over_w = coords.alpha * (v0.u * invW0) +
                                 coords.beta * (v1.u * invW1) +
                                 coords.gamma * (v2.u * invW2);  // Line 204
                float v_over_w = coords.alpha * (v0.v * invW0) +
                                 coords.beta * (v1.v * invW1) +
                                 coords.gamma * (v2.v * invW2);

                // Interpolate 1/W
                float interpolated_invW = coords.alpha * invW0 +
                                          coords.beta * invW1 +
                                          coords.gamma * invW2;  // Line 212

                // Recover final UVs: UV = (UV/W) / (1/W)
                float u = u_over_w / interpolated_invW;  // Line 217
                float v = v_over_w / interpolated_invW;

                // Clamp to [0, 0.9999]
                u = std::max(0.0f, std::min(u, 0.9999f));  // Line 221
                v = std::max(0.0f, std::min(v, 0.9999f));

                // Texture fetch
                int texX = static_cast<int>(u * texWidth);  // Line 225
                int texY = static_cast<int>(v * texHeight);
                pixelColor = texture[texY * texWidth + texX];  // Line 229
                pixelColor = graphics.BGRAtoARGB(pixelColor);  // Format conversion
            } else {
                // VERTEX COLOR INTERPOLATION (lines 235-256)

                // Extract RGB components
                unsigned int r0 = (v0.color >> 16) & 0xFF;  // Line 237
                unsigned int g0 = (v0.color >> 8) & 0xFF;
                unsigned int b0 = v0.color & 0xFF;

                unsigned int r1 = (v1.color >> 16) & 0xFF;
                unsigned int g1 = (v1.color >> 8) & 0xFF;
                unsigned int b1 = v1.color & 0xFF;

                unsigned int r2 = (v2.color >> 16) & 0xFF;
                unsigned int g2 = (v2.color >> 8) & 0xFF;
                unsigned int b2 = v2.color & 0xFF;

                // Barycentric interpolation
                unsigned int r = static_cast<unsigned int>(coords.alpha * r0 + coords.beta * r1 + coords.gamma * r2);  // Line 250
                unsigned int g = static_cast<unsigned int>(coords.alpha * g0 + coords.beta * g1 + coords.gamma * g2);
                unsigned int b = static_cast<unsigned int>(coords.alpha * b0 + coords.beta * b1 + coords.gamma * b2);

                pixelColor = 0xFF000000 | (r << 16) | (g << 8) | b;  // Line 255
            }

            // Write pixel with depth test
            graphics.drawPixel(x, y, depth, pixelColor);  // Line 259
        }
    }
}
```

**Barycentric Coordinate Calculation (lines 129-149):**
```cpp
BarycentricCoords calculateBarycentricCoords(int x, int y, const Vertex& v0, const Vertex& v1, const Vertex& v2) {
    float x0 = v0.position.x, y0 = v0.position.y;
    float x1 = v1.position.x, y1 = v1.position.y;
    float x2 = v2.position.x, y2 = v2.position.y;

    // Triangle area using cross product
    float area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);  // Line 136

    if (std::abs(area) < 0.00001f) {
        return {0.0f, 0.0f, 0.0f};  // Degenerate triangle
    }

    // Barycentric coordinates
    float beta = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / area;  // Line 144
    float gamma = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / area;
    float alpha = 1.0f - beta - gamma;

    return {alpha, beta, gamma};  // Line 148
}
```

---

## Stage 7: Depth Test + Framebuffer Write

### Entry Point: `GraphicsHelper::drawPixel()`

**File:** GraphicsHelper.hpp, lines 90-101

```cpp
void drawPixel(unsigned int x, unsigned int y, float depth, unsigned int color) {
    if (x >= width || y >= height) return;  // Bounds check (line 92)

    unsigned int index = y * width + x;  // 1D buffer index (line 94)

    // Depth test (Z-buffer algorithm)
    if (depth <= mDepthBuffer[index]) {  // Line 96 (less-or-equal test)
        pixels[index] = color;           // Write color to framebuffer
        mDepthBuffer[index] = depth;     // Update depth buffer
    }
}
```

**Depth Buffer:**
- **Type:** `std::vector<float>`
- **Size:** 300,000 floats (600 × 500 pixels × 4 bytes/float = 1.2 MB)
- **Initialization:** `std::numeric_limits<float>::max()` (GraphicsHelper.hpp, line 40)
- **Comparison:** Less-or-equal (allows Z-fighting on equal depths)

**Framebuffer:**
- **Type:** `unsigned int*` (dynamically allocated array)
- **Size:** 300,000 × 4 bytes = 1.2 MB
- **Format:** ARGB (0xAARRGGBB)

**Buffer Clear (lines 83-88):**
```cpp
void clearBuffer(unsigned int color) {
    std::fill(pixels, pixels + (width * height), color);  // Line 86
    std::fill(mDepthBuffer.begin(), mDepthBuffer.end(), std::numeric_limits<float>::max());  // Line 87
}
```

---

## Stage 8: Display Blit

### Entry Point: `RS_Update()` (External Library)

**File:** main.cpp, line 29

```cpp
while (RS_Update(graphics.getPixels(), GraphicsConstrants::kTotalPixels)) {
    testManager.update();
    testManager.render();
    Sleep(1);  // ~1ms delay (non-blocking)
}
```

**`RS_Update()` Responsibilities (inferred):**
1. Copy 1.2 MB framebuffer from `graphics.getPixels()` to window surface
2. Handle window events (close, resize, etc.)
3. Return `false` when window closes (loop exit condition)

**Performance:**
- **Framerate:** Uncapped (only limited by `Sleep(1)` and rendering speed)
- **V-Sync:** Unknown (depends on RasterSurface implementation)

---

## Data Flow Summary

```
Input: vector<Vertex> (position, normal, color, UV)
       vector<unsigned int> (triangle indices)

       ↓

COPY vertices (Renderer.h:155-157 for triangles, pass by reference for lines)

       ↓

SET GLOBAL STATE:
  vsWorld, vsView, vsProjection, isCube

       ↓

VERTEX SHADER (vsWorldViewTransform or vsLighting):
  - Transform position: local → world → view
  - Calculate lighting (if vsLighting)
  - Store color in vertex.color

       ↓

PROJECTION SHADER (vsProjectionTransform):
  - Transform position: view → clip space
  - Perspective divide: clip → NDC

       ↓

NDC → SCREEN SPACE:
  - Scale/offset: NDC [-1,1] → screen [0,600)×[0,500)
  - Flip Y axis

       ↓

RASTERIZATION:
  - Lines: Bresenham DDA (linear interpolation)
  - Triangles: Scan bounding box + barycentric test

       ↓

ATTRIBUTE INTERPOLATION:
  - Depth (linear in screen space)
  - Color (barycentric for triangles, constant for lines)
  - UV (perspective-correct for textures)

       ↓

DEPTH TEST:
  if (depth <= depthBuffer[x,y]) → PASS

       ↓

FRAMEBUFFER WRITE:
  pixels[x + y*width] = color
  depthBuffer[x + y*width] = depth

       ↓

Output: 600×500 ARGB framebuffer → RS_Update() → Window
```

---

## Performance Characteristics

### Bottlenecks

1. **CPU-Bound:**
   - Single-threaded rasterization (no SIMD, no multi-core utilization)
   - Barycentric test for every pixel in triangle bounding box
   - No spatial acceleration (e.g., tile-based rendering)

2. **Memory-Bound:**
   - Depth buffer: 300,000 float reads + writes per frame
   - Framebuffer: 300,000 uint32 writes per frame
   - No cache optimization (linear scan, poor locality)

3. **Vertex Shader:**
   - 4x4 matrix multiply per vertex: 64 FLOPs (not optimized with SIMD)
   - Lighting: ~50 FLOPs per vertex (normalize, dot products, color ops)

### Scalability Issues

- **Resolution:** 600×500 = 300K pixels is manageable. At 1920×1080 = 2M pixels, performance would degrade 6.7×
- **Triangle Count:** No spatial culling — all triangles processed even if off-screen
- **Overdraw:** No early-Z rejection — fragments are shaded even if occluded

### Optimization Opportunities

1. **SIMD Vectorization:**
   - Process 4 vertices in parallel using SSE/AVX
   - Horizontal scan line rasterization (4 pixels at a time)

2. **Multi-Threading:**
   - Tile-based rendering (divide screen into 64×64 tiles, process in parallel)
   - Separate depth buffer per thread, merge at end

3. **Culling:**
   - View frustum culling (currently done manually in star field, not in renderMesh)
   - Occlusion culling (depth pre-pass)

4. **Z-Buffer Optimization:**
   - Reverse-Z (use 1/Z for better precision distribution)
   - Hierarchical Z-buffer (early rejection of tile blocks)

---

## Vulkan Pipeline Comparison

**Current Software Rasterizer:**
```
CPU: Vertex Shader → Projection → Rasterization → Depth Test → Pixel Write
     (single-threaded, ~1-10K triangles/frame max)
```

**Future Vulkan Pipeline (Phase 2):**
```
GPU: Vertex Shader (parallel, 1000+ threads)
     ↓
     Tessellation (optional)
     ↓
     Geometry Shader (optional)
     ↓
     Rasterization (hardware, multi-gigapixel/sec)
     ↓
     Fragment Shader (parallel, 1000+ threads)
     ↓
     Depth/Stencil Test (hardware, early-Z)
     ↓
     Framebuffer (VRAM, 10+ GB/s bandwidth)
```

**Expected Speedup:** 100-1000× for typical game scenes (millions of triangles)

---

## Critical Issues

### Issue 1: Incomplete Grid Rendering Path

**Location:** Renderer.h, lines 150-188

**Problem:** Triangles are transformed but never rasterized. The transformed vertices `v0`, `v1`, `v2` are local variables that go out of scope at the end of the loop.

**Expected Code (Missing):**
```cpp
// After line 185 (NDCToScreen calls), should have:
lineDrawing.drawTriangle(v0, v1, v2);
```

**Impact:** Grid triangles are invisible (only wireframe lines work).

### Issue 2: Double View Transform in `draw3DLine()`

**Location:** LineDrawing.h, lines 68-127

**Problem:** `draw3DLine()` applies `VertexShader` (which includes view transform), but the shader expects vertices in local space. If vertices are already in view space (from `Renderer::renderMesh()`), they get transformed twice.

**Current Flow:**
```
Renderer.renderMesh() → vsWorldViewTransform(v) → view space
                     → draw3DLine(v) → VertexShader(v) again → double transform!
```

**Expected Flow:**
```
Renderer.renderMesh() → vsWorldViewTransform(v) → view space
                     → draw3DLine(v) → skip shader, only apply projection
```

**Workaround:** Cube rendering path (lines 190-197) passes UNTRANSFORMED vertices to `draw3DLine()`, so shader is applied correctly. But this is inconsistent with triangle path.

### Issue 3: Global State Race Conditions

**Problem:** All shader state (vsWorld, vsView, vsProjection) is global mutable. If multi-threaded rendering is ever added, race conditions will occur.

**Example:**
```cpp
// Thread 1
vsWorld = cubeMatrix;
renderer.renderMesh(cubeVerts, ...);  // May use Thread 2's matrix!

// Thread 2 (concurrent)
vsWorld = gridMatrix;
renderer.renderMesh(gridVerts, ...);
```

**Solution:** Encapsulate state in RenderContext struct, pass by value or const reference.

---

## Recommendations

### Phase 2 Prerequisites (Vulkan Integration)

1. **Separate Concerns:**
   - Software rasterizer → `SoftwareRenderer` class
   - Vulkan pipeline → `VulkanRenderer` class
   - Both implement `IRasterizer` interface

2. **Eliminate Global State:**
   - Create `RenderContext` struct with vsWorld/vsView/vsProjection
   - Pass context to all shader functions

3. **Fix Grid Rendering:**
   - Add `drawTriangle()` call after NDC conversion (Renderer.h:186)

4. **Unify Coordinate Spaces:**
   - Document which functions expect local/world/view/clip/NDC/screen space
   - Add assertions to catch coordinate space mismatches

5. **Performance Profiling:**
   - Add frame timing (currently only has `timer.Delta()` for camera animation)
   - Measure time per stage (vertex shader, rasterization, depth test)

---

**Next Steps:** Proceed to Task 1.3 (ui_audit.md) to document the current UI (console-based _kbhit/getch) and requirements for a 3D editor framework.
