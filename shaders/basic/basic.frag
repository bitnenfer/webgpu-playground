#version 450

layout(location = 0) in vec3 fragNormal;
layout(location = 1) in vec2 fragTexCoord;

layout(location = 0) out vec4 fragColor;

void main()
{
	// Sky
	vec3 N = normalize(fragNormal);
	float skyNdotL = max(dot(N, vec3(0, 1, 0)), 0.0);
	vec3 skyColor = skyNdotL * (vec3(0.5, 0.5, 0.8) * 0.5);

	// Sun
	vec3 sunDir = normalize(vec3(0.5, 0.1, 0.8));
	float sunNdotL = max(dot(N, sunDir), 0.0);
	vec3 kD = (vec3(0.5, 0.4, 0.3) * 1.78) * sunNdotL;


	vec3 kA = vec3(0.13, 0.1, 0.1);
	vec3 finalColor = skyColor + kA + kD;

	fragColor = vec4(finalColor,1);
}