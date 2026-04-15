// debug_ps.hlsl
// Debug visualization pixel shader for BrightForge
// Supports multiple visualization modes for debugging rendering issues
// Author: Marcus Daley
// Date: April 2026

#include "../Common/math_utils.hlsli"

// Input from vertex shader
struct PixelInput {
    float4 position    : SV_Position;
    float3 worldPos    : WORLDPOS;
    float3 worldNormal : NORMAL;
    float2 texcoord    : TEXCOORD0;
    float4 color       : COLOR0;
};

// Uniform buffer for debug settings
cbuffer DebugUniforms : register(b0) {
    uint debugMode;         // 0=normals, 1=depth, 2=wireframe, 3=UV, 4=vertex color, 5=world position
    float nearPlane;        // Camera near plane (for depth visualization)
    float farPlane;         // Camera far plane (for depth visualization)
    float wireframeWidth;   // Line width for wireframe rendering
    float3 wireframeColor;  // Color for wireframe lines
    float padding;
};

// Depth texture for depth visualization mode
Texture2D depthTexture : register(t0);
SamplerState depthSampler : register(s0);

// Visualize world-space normals as RGB
// Remaps from [-1, 1] to [0, 1] for display
float3 VisualizeNormals(float3 normal) {
    // Normalize to ensure unit length
    float3 N = SafeNormalize(normal);

    // Remap from [-1, 1] to [0, 1]
    return N * 0.5 + 0.5;
}

// Visualize depth buffer (reversed-Z aware)
// Reversed-Z: near=1.0 (white), far=0.0 (black)
float3 VisualizeDepth(float depth, float near, float far) {
    // In reversed-Z, depth=1.0 is near plane, depth=0.0 is far plane
    // We want near to be white, far to be black, so invert is NOT needed

    // Linear depth reconstruction (reversed-Z)
    float linearDepth = depth; // Already in [0, 1] range with reversed-Z

    // Grayscale output: near=white (1.0), far=black (0.0)
    return float3(linearDepth, linearDepth, linearDepth);
}

// Visualize UV coordinates as RG color
float3 VisualizeUV(float2 uv) {
    // UV in [0, 1] range maps to Red and Green channels
    // Blue channel set to 0 for clarity
    return float3(uv.x, uv.y, 0.0);
}

// Visualize vertex color
float3 VisualizeVertexColor(float4 color) {
    return color.rgb;
}

// Visualize world position as color
// Uses fractional part to create grid-like pattern
float3 VisualizeWorldPosition(float3 worldPos) {
    // Take fractional part of world coordinates
    float3 frac = frac(worldPos * 0.1); // Scale down for visible pattern
    return frac;
}

// Wireframe edge detection using screen-space derivatives
// Returns 1.0 on edges, 0.0 in interior
float WireframeEdge(float2 barycentricCoords, float lineWidth) {
    float3 bary = float3(barycentricCoords.x, barycentricCoords.y, 1.0 - barycentricCoords.x - barycentricCoords.y);

    // Compute derivatives for anti-aliasing
    float3 deltas = fwidth(bary);

    // Smooth edge detection
    float3 smoothing = smoothstep(float3(0.0, 0.0, 0.0), deltas * lineWidth, bary);
    float edgeFactor = min(min(smoothing.x, smoothing.y), smoothing.z);

    return 1.0 - edgeFactor;
}

// Pixel shader entry point
float4 PSMain(PixelInput input) : SV_Target {
    float3 outputColor;

    switch (debugMode) {
        case 0: // Normals
            outputColor = VisualizeNormals(input.worldNormal);
            break;

        case 1: // Depth
            {
                // Sample depth from depth texture
                float depth = depthTexture.Sample(depthSampler, input.texcoord).r;
                outputColor = VisualizeDepth(depth, nearPlane, farPlane);
            }
            break;

        case 2: // Wireframe
            {
                // Calculate barycentric coordinates from screen position
                // This is a simplified approach; proper wireframe needs geometry shader
                float2 bary = frac(input.position.xy);
                float edge = WireframeEdge(bary, wireframeWidth);

                // Blend between wireframe color and base surface
                float3 surfaceColor = VisualizeNormals(input.worldNormal); // Use normals as base
                outputColor = lerp(surfaceColor, wireframeColor, edge);
            }
            break;

        case 3: // UV coordinates
            outputColor = VisualizeUV(input.texcoord);
            break;

        case 4: // Vertex color
            outputColor = VisualizeVertexColor(input.color);
            break;

        case 5: // World position
            outputColor = VisualizeWorldPosition(input.worldPos);
            break;

        default: // Fallback: magenta error color
            outputColor = float3(1.0, 0.0, 1.0);
            break;
    }

    return float4(outputColor, 1.0);
}
