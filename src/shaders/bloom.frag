uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uIntensity;
uniform float uThreshold;

varying vec2 vUv;

void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    vec3 color = texel.rgb;
    
    // 輝度を計算
    float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
    
    // 閾値以上の部分を抽出
    if (brightness > uThreshold) {
        color = color * uIntensity;
    } else {
        color = vec3(0.0);
    }
    
    gl_FragColor = vec4(color, texel.a);
}

