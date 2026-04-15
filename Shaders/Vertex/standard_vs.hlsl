// standard_vs.hlsl
// Standard vertex shader for BrightForge
// Transforms vertices from object space to clip space and passes data to fragment shader
// Author: Marcus Daley
// Date: April 2026

#include "../Common/math_utils.hlsli"

// Vertex input from mesh data
struct VertexInput {
    float3 position : POSITION;
    float3 normal   : NORMAL;
    float2 texcoord : TEXCOORD0;
    float4 color    : COLOR0;
};

// Output to fragment shader
struct VertexOutput {
    float4 position    : SV_Position;  // Clip-space position (required output)
    float3 worldPos    : WORLDPOS;     // World-space position for lighting
    float3 worldNormal : NORMAL;       // World-space normal for lighting
    float2 texcoord    : TEXCOORD0;    // Texture coordinates
    float4 color       : COLOR0;       // Vertex color
};

// Uniform buffer for transformation matrices
cbuffer TransformUniforms : register(b0) {
    float4x4 worldMatrix;
    float4x4 viewMatrix;
    float4x4 projectionMatrix;
    float4x4 normalMatrix;  // Inverse transpose of world matrix for normals
};

// Vertex shader entry point
VertexOutput VSMain(VertexInput input) {
    VertexOutput output;

    // Transform position to world space
    float4 worldPosition = mul(float4(input.position, 1.0), worldMatrix);
    output.worldPos = worldPosition.xyz;

    // Transform position to view space
    float4 viewPosition = mul(worldPosition, viewMatrix);

    // Transform position to clip space (reversed-Z: near=1.0, far=0.0)
    output.position = mul(viewPosition, projectionMatrix);

    // Transform normal to world space
    // Use normalMatrix (inverse transpose of world) to handle non-uniform scaling correctly
    float3 worldNormal = mul(input.normal, (float3x3)normalMatrix);
    output.worldNormal = SafeNormalize(worldNormal);

    // Pass through texture coordinates
    output.texcoord = input.texcoord;

    // Pass through vertex color
    output.color = input.color;

    return output;
}
