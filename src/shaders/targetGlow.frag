uniform float uTime;
uniform float uHitIntensity;
uniform vec3 uColor;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
    // 中心からの距離（リングの内側と外側でフェード）
    vec2 center = vec2(0.5);
    float dist = length(vUv - center);
    
    // リングの内側と外側でフェードアウト
    float innerEdge = 0.3;
    float outerEdge = 0.5;
    float fadeIn = smoothstep(innerEdge, innerEdge + 0.1, dist);
    float fadeOut = 1.0 - smoothstep(outerEdge - 0.1, outerEdge, dist);
    float ringMask = fadeIn * fadeOut;
    
    // パルスエフェクト（より強く）
    float pulse = sin(uTime * 3.0) * 0.4 + 0.8;
    
    // エッジグロー
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - dot(viewDir, normalize(vNormal)), 1.2);
    
    // 命中時の強烈なグロー
    float hitGlow = uHitIntensity * 3.0;
    
    vec3 finalColor = uColor * (pulse + fresnel * 0.8 + hitGlow) * 2.0; // 色を2倍に
    float alpha = (0.6 + fresnel * 0.4 + hitGlow * 0.5) * ringMask; // アルファを上げる
    
    gl_FragColor = vec4(finalColor, alpha);
}

