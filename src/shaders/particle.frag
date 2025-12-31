uniform float uTime;
uniform float uLife;
uniform vec3 uColor;
uniform float uSize;

varying vec2 vUv;

void main() {
    // 中心からの距離
    float dist = length(vUv - vec2(0.5));
    
    // 円形のパーティクル
    if (dist > 0.5) discard;
    
    // フェードアウト
    float alpha = (1.0 - uLife) * (1.0 - dist * 2.0);
    
    // パルスエフェクト
    float pulse = sin(uTime * 20.0) * 0.2 + 0.8;
    
    vec3 finalColor = uColor * pulse;
    
    gl_FragColor = vec4(finalColor, alpha);
}

