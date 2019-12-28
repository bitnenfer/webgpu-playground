#version 450

layout(binding = 0) uniform Matrices {
	mat4 model;
	mat4 view;
	mat4 projection;
	mat4 invModelView;
};

layout(location = 0) in vec3 vertPosition;
layout(location = 1) in vec3 vertNormal;
layout(location = 2) in vec2 vertTexCoord;

layout(location = 0) out vec3 fragNormal;
layout(location = 1) out vec2 fragTexCoord;


void main()
{
	vec4 tPosition = projection * view * model * vec4(vertPosition, 1.0);
	fragNormal = (invModelView * vec4(normalize(vertNormal), 0.0)).xyz;
	fragTexCoord = vertTexCoord;
	gl_Position = tPosition;
}
