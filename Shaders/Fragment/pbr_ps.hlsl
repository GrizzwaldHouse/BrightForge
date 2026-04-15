// pbr_ps.hlsl
// Physically-Based Rendering (PBR) pixel shader for BrightForge
// Implements Cook-Torrance BRDF with image-based lighting (IBL)
// Supports metallic-roughness workflow
// Author: Marcus Daley
// Date: April 2026

#include "../Common/math_utils.hlsli"
#include "../Common/lighting_common.hlsli"

// Input from vertex shader
struct PixelInput {
    float4 position    : SV_Position;
    float3 worldPos    : WORLDPOS;
    float3 worldNormal : NORMAL;
    float2 texcoord    : TEXCOORD0;
    float4 color       : COLOR0;
};

// Uniform buffer for material properties
cbuffer MaterialUniforms : register(b0) {
    float3 albedo;          // Base color (RGB)
    float metallic;         // Metallic value [0, 1]
    float3 emissive;        // Emissive color
    float roughness;        // Roughness value [0, 1]
    float ao;               // Ambient occlusion [0, 1]
    float3 padding;
};

// Uniform buffer for lighting
cbuffer LightingUniforms : register(b1) {
    DirectionalLight sun;
    float3 cameraPos;       // Camera world position for view direction
    float useIBL;           // 1.0 = use IBL, 0.0 = use flat ambient
    float3 ambientColor;    // Fallback ambient color
    float ambientIntensity; // Ambient light intensity
};

// Textures
Texture2D albedoMap      : register(t0);
Texture2D normalMap      : register(t1);
Texture2D metallicMap    : register(t2);
Texture2D roughnessMap   : register(t3);
Texture2D aoMap          : register(t4);
TextureCube irradianceMap : register(t5);  // IBL diffuse
TextureCube prefilteredMap : register(t6); // IBL specular

SamplerState textureSampler : register(s0);

// Pixel shader entry point
float4 PSMain(PixelInput input) : SV_Target {
    // Normalize interpolated normal
    float3 N = SafeNormalize(input.worldNormal);

    // View direction (camera to surface)
    float3 V = SafeNormalize(cameraPos - input.worldPos);

    // Sample material properties from textures (or use uniforms)
    float3 albedoColor = albedoMap.Sample(textureSampler, input.texcoord).rgb * albedo;
    float metallicValue = metallicMap.Sample(textureSampler, input.texcoord).r * metallic;
    float roughnessValue = roughnessMap.Sample(textureSampler, input.texcoord).r * roughness;
    float aoValue = aoMap.Sample(textureSampler, input.texcoord).r * ao;

    // Calculate base reflectivity (F0) for dielectrics and metals
    // Dielectrics have F0 around 0.04, metals use albedo as F0
    float3 F0 = float3(0.04, 0.04, 0.04);
    F0 = lerp(F0, albedoColor, metallicValue);

    // Reflectance equation output
    float3 Lo = float3(0.0, 0.0, 0.0);

    // Directional light contribution (sun)
    {
        float3 L = -normalize(sun.direction);
        float3 H = SafeNormalize(V + L);

        // Cook-Torrance BRDF
        float NDF = DistributionGGX(N, H, roughnessValue);
        float G = GeometrySmith(N, V, L, roughnessValue);
        float3 F = FresnelSchlick(saturate(dot(H, V)), F0);

        float3 specular = (NDF * G * F) / max(4.0 * saturate(dot(N, V)) * saturate(dot(N, L)), EPSILON);

        // Diffuse component (energy conservation: kD = 1 - kS)
        float3 kS = F; // Specular reflection coefficient
        float3 kD = float3(1.0, 1.0, 1.0) - kS;
        kD *= 1.0 - metallicValue; // Metals have no diffuse

        float NdotL = saturate(dot(N, L));
        float3 diffuse = kD * albedoColor / PI;

        // Add to outgoing light
        Lo += (diffuse + specular) * sun.color * sun.intensity * NdotL;
    }

    // Ambient lighting (IBL or flat ambient)
    float3 ambient;
    if (useIBL > 0.5) {
        // Image-Based Lighting (IBL)
        float3 F = FresnelSchlickRoughness(saturate(dot(N, V)), F0, roughnessValue);

        float3 kS = F;
        float3 kD = float3(1.0, 1.0, 1.0) - kS;
        kD *= 1.0 - metallicValue;

        // Diffuse IBL
        float3 irradiance = irradianceMap.Sample(textureSampler, N).rgb;
        float3 diffuse = irradiance * albedoColor;

        // Specular IBL
        float3 R = Reflect(-V, N);
        float maxReflectionLOD = 4.0; // Max mip level of prefiltered cubemap
        float3 prefilteredColor = prefilteredMap.SampleLevel(textureSampler, R, roughnessValue * maxReflectionLOD).rgb;
        float3 specular = prefilteredColor * F;

        ambient = (kD * diffuse + specular) * aoValue;
    } else {
        // Flat ambient fallback
        ambient = ambientColor * albedoColor * ambientIntensity * aoValue;
    }

    // Combine direct lighting and ambient
    float3 finalColor = ambient + Lo;

    // Add emissive
    finalColor += emissive;

    // HDR tone mapping (simple Reinhard)
    finalColor = finalColor / (finalColor + float3(1.0, 1.0, 1.0));

    // Gamma correction (assume output is sRGB)
    finalColor = pow(finalColor, float3(1.0 / 2.2, 1.0 / 2.2, 1.0 / 2.2));

    return float4(finalColor, 1.0);
}
