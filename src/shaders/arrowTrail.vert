uniform float uTime;
uniform float uSpeed;

varying vec3 vPosition;
varying vec3 vNormal;

void main() {
    vPosition = position;
    vNormal = normal;
    
    // 微細な動きを追加
    vec3 pos = position;
    pos += normal * sin(uTime * uSpeed + position.x * 10.0) * 0.01;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}

