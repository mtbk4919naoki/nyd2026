uniform float uTime;
uniform float uLife;
uniform vec3 uVelocity;
uniform float uSize;

attribute vec3 aOffset;

varying vec2 vUv;

void main() {
    vUv = uv;
    
    // パーティクルの位置を計算
    vec3 pos = position * uSize;
    pos += aOffset + uVelocity * uLife;
    
    // カメラに向ける（ビルボード）
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * (300.0 / -mvPosition.z);
}

