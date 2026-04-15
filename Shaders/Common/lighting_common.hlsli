// lighting_common.hlsli
// Shared lighting structures and functions for BrightForge shaders
// Author: Marcus Daley
// Date: April 2026

#ifndef LIGHTING_COMMON_HLSLI
#define LIGHTING_COMMON_HLSLI

#include "math_utils.hlsli"

// Directional light structure (sun, moon)
struct DirectionalLight {
    float3 direction;    // World-space direction (normalized)
    float intensity;     // Light intensity multiplier
    float3 color;        // RGB color
    float padding;       // Align to 16 bytes
};

// Point light structure (lamps, torches)
struct PointLight {
    float3 position;     // World-space position
    float radius;        // Maximum influence radius
    float3 color;        // RGB color
    float attenuation;   // Attenuation exponent (1.0 = linear, 2.0 = quadratic)
};

// Spot light structure (flashlights, spotlights)
struct SpotLight {
    float3 position;     // World-space position
    float innerAngle;    // Inner cone angle (radians)
    float3 direction;    // World-space direction (normalized)
    float outerAngle;    // Outer cone angle (radians)
    float3 color;        // RGB color
    float attenuation;   // Distance attenuation exponent
};

// Lighting result from light calculation
struct LightingResult {
    float3 diffuse;      // Diffuse contribution
    float3 specular;     // Specular contribution
};

// Calculate attenuation based on distance and radius
// Returns 1.0 at distance 0, smoothly falls to 0.0 at radius
float CalculateAttenuation(float distance, float radius, float exponent) {
    if (distance >= radius) {
        return 0.0;
    }

    // Smooth attenuation curve
    float normalized = distance / radius;
    float attenuation = 1.0 - pow(normalized, exponent);
    return saturate(attenuation);
}

// Calculate attenuation with default quadratic falloff
float CalculateAttenuation(float distance, float radius) {
    return CalculateAttenuation(distance, radius, 2.0);
}

// Lambertian diffuse lighting (basic diffuse)
float3 CalculateLambertDiffuse(float3 normal, float3 lightDir, float3 lightColor) {
    float NdotL = saturate(dot(normal, lightDir));
    return lightColor * NdotL;
}

// Blinn-Phong specular lighting
float3 CalculateBlinnPhongSpecular(
    float3 normal,
    float3 lightDir,
    float3 viewDir,
    float3 lightColor,
    float shininess
) {
    float3 halfDir = SafeNormalize(lightDir + viewDir);
    float NdotH = saturate(dot(normal, halfDir));
    float specular = pow(NdotH, shininess);
    return lightColor * specular;
}

// Calculate directional light contribution (sun, moon)
LightingResult CalculateDirectionalLight(
    float3 normal,
    float3 viewDir,
    DirectionalLight light,
    float shininess
) {
    LightingResult result;

    // Light direction is stored pointing away from light, so negate
    float3 lightDir = -normalize(light.direction);

    // Diffuse component
    result.diffuse = CalculateLambertDiffuse(normal, lightDir, light.color) * light.intensity;

    // Specular component
    result.specular = CalculateBlinnPhongSpecular(normal, lightDir, viewDir, light.color, shininess) * light.intensity;

    return result;
}

// Calculate point light contribution
LightingResult CalculatePointLight(
    float3 worldPos,
    float3 normal,
    float3 viewDir,
    PointLight light,
    float shininess
) {
    LightingResult result;

    // Vector from surface to light
    float3 lightVec = light.position - worldPos;
    float distance = length(lightVec);
    float3 lightDir = lightVec / distance; // Normalized

    // Attenuation
    float attenuation = CalculateAttenuation(distance, light.radius, light.attenuation);

    if (attenuation <= EPSILON) {
        result.diffuse = float3(0.0, 0.0, 0.0);
        result.specular = float3(0.0, 0.0, 0.0);
        return result;
    }

    // Diffuse component
    result.diffuse = CalculateLambertDiffuse(normal, lightDir, light.color) * attenuation;

    // Specular component
    result.specular = CalculateBlinnPhongSpecular(normal, lightDir, viewDir, light.color, shininess) * attenuation;

    return result;
}

// Calculate spot light contribution
LightingResult CalculateSpotLight(
    float3 worldPos,
    float3 normal,
    float3 viewDir,
    SpotLight light,
    float shininess
) {
    LightingResult result;

    // Vector from surface to light
    float3 lightVec = light.position - worldPos;
    float distance = length(lightVec);
    float3 lightDir = lightVec / distance; // Normalized

    // Distance attenuation
    float attenuation = CalculateAttenuation(distance, 100.0, light.attenuation); // TODO: add radius to SpotLight

    // Spot cone attenuation
    float3 spotDir = normalize(light.direction);
    float cosAngle = dot(-lightDir, spotDir);
    float spotAttenuation = SmoothStep(cos(light.outerAngle), cos(light.innerAngle), cosAngle);

    float totalAttenuation = attenuation * spotAttenuation;

    if (totalAttenuation <= EPSILON) {
        result.diffuse = float3(0.0, 0.0, 0.0);
        result.specular = float3(0.0, 0.0, 0.0);
        return result;
    }

    // Diffuse component
    result.diffuse = CalculateLambertDiffuse(normal, lightDir, light.color) * totalAttenuation;

    // Specular component
    result.specular = CalculateBlinnPhongSpecular(normal, lightDir, viewDir, light.color, shininess) * totalAttenuation;

    return result;
}

// Fresnel-Schlick approximation (for PBR)
float3 FresnelSchlick(float cosTheta, float3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

// Fresnel with roughness (for IBL)
float3 FresnelSchlickRoughness(float cosTheta, float3 F0, float roughness) {
    return F0 + (max(float3(1.0 - roughness, 1.0 - roughness, 1.0 - roughness), F0) - F0) * pow(1.0 - cosTheta, 5.0);
}

// GGX/Trowbridge-Reitz normal distribution function
float DistributionGGX(float3 N, float3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = saturate(dot(N, H));
    float NdotH2 = NdotH * NdotH;

    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;

    return a2 / max(denom, EPSILON);
}

// Smith's method for geometry shadowing (Schlick-GGX)
float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;

    float denom = NdotV * (1.0 - k) + k;
    return NdotV / max(denom, EPSILON);
}

// Smith's geometry function (combining view and light)
float GeometrySmith(float3 N, float3 V, float3 L, float roughness) {
    float NdotV = saturate(dot(N, V));
    float NdotL = saturate(dot(N, L));
    float ggx1 = GeometrySchlickGGX(NdotV, roughness);
    float ggx2 = GeometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

// Cook-Torrance BRDF specular term
float3 CookTorranceBRDF(
    float3 N,
    float3 V,
    float3 L,
    float3 F0,
    float roughness
) {
    float3 H = SafeNormalize(V + L);

    // Normal distribution
    float NDF = DistributionGGX(N, H, roughness);

    // Geometry shadowing
    float G = GeometrySmith(N, V, L, roughness);

    // Fresnel
    float3 F = FresnelSchlick(saturate(dot(H, V)), F0);

    // Cook-Torrance denominator
    float NdotL = saturate(dot(N, L));
    float NdotV = saturate(dot(N, V));
    float denom = 4.0 * NdotV * NdotL;

    return (NDF * G * F) / max(denom, EPSILON);
}

#endif // LIGHTING_COMMON_HLSLI
