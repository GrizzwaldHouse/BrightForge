// math_utils.hlsli
// Shared HLSL math utilities for BrightForge shaders
// Author: Marcus Daley
// Date: April 2026

#ifndef MATH_UTILS_HLSLI
#define MATH_UTILS_HLSLI

// Constants
static const float PI = 3.14159265359;
static const float TWO_PI = 6.28318530718;
static const float HALF_PI = 1.57079632679;
static const float EPSILON = 1e-6;

// Saturate clamps value to [0, 1] range
// Most HLSL compilers have this builtin, but define for compatibility
#ifndef saturate
float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float2 saturate(float2 x) {
    return clamp(x, float2(0.0, 0.0), float2(1.0, 1.0));
}

float3 saturate(float3 x) {
    return clamp(x, float3(0.0, 0.0, 0.0), float3(1.0, 1.0, 1.0));
}

float4 saturate(float4 x) {
    return clamp(x, float4(0.0, 0.0, 0.0, 0.0), float4(1.0, 1.0, 1.0, 1.0));
}
#endif

// Remap value from one range to another
// Example: RemapRange(0.5, 0, 1, 10, 20) = 15
float RemapRange(float value, float oldMin, float oldMax, float newMin, float newMax) {
    float oldRange = oldMax - oldMin;
    float newRange = newMax - newMin;
    return (((value - oldMin) * newRange) / oldRange) + newMin;
}

float2 RemapRange(float2 value, float2 oldMin, float2 oldMax, float2 newMin, float2 newMax) {
    return float2(
        RemapRange(value.x, oldMin.x, oldMax.x, newMin.x, newMax.x),
        RemapRange(value.y, oldMin.y, oldMax.y, newMin.y, newMax.y)
    );
}

float3 RemapRange(float3 value, float3 oldMin, float3 oldMax, float3 newMin, float3 newMax) {
    return float3(
        RemapRange(value.x, oldMin.x, oldMax.x, newMin.x, newMax.x),
        RemapRange(value.y, oldMin.y, oldMax.y, newMin.y, newMax.y),
        RemapRange(value.z, oldMin.z, oldMax.z, newMin.z, newMax.z)
    );
}

// Squared length of vector (faster than length when exact distance not needed)
float SquaredLength(float2 v) {
    return dot(v, v);
}

float SquaredLength(float3 v) {
    return dot(v, v);
}

float SquaredLength(float4 v) {
    return dot(v, v);
}

// Safe normalize — returns zero vector if input length is zero
float2 SafeNormalize(float2 v) {
    float len = length(v);
    return len > EPSILON ? v / len : float2(0.0, 0.0);
}

float3 SafeNormalize(float3 v) {
    float len = length(v);
    return len > EPSILON ? v / len : float3(0.0, 0.0, 0.0);
}

float4 SafeNormalize(float4 v) {
    float len = length(v);
    return len > EPSILON ? v / len : float4(0.0, 0.0, 0.0, 0.0);
}

// Linear interpolation (builtin in HLSL, but explicit for clarity)
float Lerp(float a, float b, float t) {
    return a + t * (b - a);
}

float2 Lerp(float2 a, float2 b, float t) {
    return a + t * (b - a);
}

float3 Lerp(float3 a, float3 b, float t) {
    return a + t * (b - a);
}

float4 Lerp(float4 a, float4 b, float t) {
    return a + t * (b - a);
}

// Smooth step interpolation (cubic hermite)
float SmoothStep(float edge0, float edge1, float x) {
    float t = saturate((x - edge0) / (edge1 - edge0));
    return t * t * (3.0 - 2.0 * t);
}

// Smoother step interpolation (quintic hermite)
float SmootherStep(float edge0, float edge1, float x) {
    float t = saturate((x - edge0) / (edge1 - edge0));
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Power-safe — prevents negative base with fractional exponent
float PowSafe(float base, float exponent) {
    return pow(max(abs(base), EPSILON), exponent);
}

// Convert RGB to luminance (perceptual weighting)
float Luminance(float3 rgb) {
    return dot(rgb, float3(0.2126, 0.7152, 0.0722));
}

// Convert degrees to radians
float ToRadians(float degrees) {
    return degrees * (PI / 180.0);
}

// Convert radians to degrees
float ToDegrees(float radians) {
    return radians * (180.0 / PI);
}

// Compute reflection vector
float3 Reflect(float3 incident, float3 normal) {
    return incident - 2.0 * dot(incident, normal) * normal;
}

// Compute refraction vector (Snell's law)
float3 Refract(float3 incident, float3 normal, float eta) {
    float cosI = -dot(incident, normal);
    float sinT2 = eta * eta * (1.0 - cosI * cosI);

    if (sinT2 > 1.0) {
        return float3(0.0, 0.0, 0.0); // Total internal reflection
    }

    float cosT = sqrt(1.0 - sinT2);
    return eta * incident + (eta * cosI - cosT) * normal;
}

// Check if value is NaN
bool IsNaN(float x) {
    return !(x == x);
}

// Check if value is infinite
bool IsInf(float x) {
    return isinf(x);
}

// Safe division (returns 0 if denominator is zero)
float SafeDivide(float numerator, float denominator) {
    return abs(denominator) > EPSILON ? numerator / denominator : 0.0;
}

#endif // MATH_UTILS_HLSLI
