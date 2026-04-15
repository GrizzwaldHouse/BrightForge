// unlit_ps.hlsl
// Unlit pixel shader for BrightForge
// Renders solid color or textured surface with no lighting calculations
// Used for debug visualization, UI elements, and wireframe rendering
// Author: Marcus Daley
// Date: April 2026

#include "../Common/math_utils.hlsli"

// Input from vertex shader
struct PixelInput {
    float4 position : SV_Position;
    float3 worldPos : WORLDPOS;
    float3 worldNormal : NORMAL;
    float2 texcoord : TEXCOORD0;
    float4 color    : COLOR0;
};

// Uniform buffer for material properties
cbuffer MaterialUniforms : register(b0) {
    float4 baseColor;       // Solid color (RGBA)
    float useTexture;       // 1.0 = use texture, 0.0 = use baseColor
    float alphaThreshold;   // Alpha test threshold (for transparency)
    float2 padding;
};

// Texture and sampler
Texture2D albedoTexture : register(t0);
SamplerState textureSampler : register(s0);

// Pixel shader entry point
float4 PSMain(PixelInput input) : SV_Target {
    float4 finalColor;

    // Choose between texture and solid color
    if (useTexture > 0.5) {
        // Sample texture
        float4 texColor = albedoTexture.Sample(textureSampler, input.texcoord);

        // Multiply by vertex color for tinting
        finalColor = texColor * input.color;
    } else {
        // Use solid base color multiplied by vertex color
        finalColor = baseColor * input.color;
    }

    // Alpha test (discard transparent pixels)
    if (finalColor.a < alphaThreshold) {
        discard;
    }

    return finalColor;
}
