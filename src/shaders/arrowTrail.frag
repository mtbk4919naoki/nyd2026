uniform float uTime;
uniform float uLife;
uniform vec3 uColor;

varying vec3 vPosition;
varying vec3 vNormal;

void main() {
    // フェードアウト（寿命に応じて）
    float alpha = 1.0 - uLife;
    
    // パルスエフェクト
    float pulse = sin(uTime * 10.0) * 0.3 + 0.7;
    
    // エッジグロー
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - dot(viewDir, normalize(vNormal)), 2.0);
    
    vec3 finalColor = uColor * pulse * (1.0 + fresnel * 2.0);
    
    gl_FragColor = vec4(finalColor, alpha * 0.8);
}

