uniform sampler2D tDiffuse;
uniform vec2 uDirection;
uniform vec2 uResolution;

varying vec2 vUv;

void main() {
    vec4 color = vec4(0.0);
    // ブラー強度を下げる（オフセットを小さく）
    vec2 off1 = vec2(0.8) * uDirection;
    vec2 off2 = vec2(1.6) * uDirection;
    
    color += texture2D(tDiffuse, vUv) * 0.4; // 中心の重みを上げる
    color += texture2D(tDiffuse, vUv + off1 / uResolution) * 0.25;
    color += texture2D(tDiffuse, vUv - off1 / uResolution) * 0.25;
    color += texture2D(tDiffuse, vUv + off2 / uResolution) * 0.05;
    color += texture2D(tDiffuse, vUv - off2 / uResolution) * 0.05;
    
    gl_FragColor = color;
}

