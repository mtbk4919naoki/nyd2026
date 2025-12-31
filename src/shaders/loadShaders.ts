// シェーダーを読み込むユーティリティ

export async function loadShader(path: string): Promise<string> {
  const response = await fetch(path)
  return await response.text()
}

// シェーダーを同期的に読み込む（ビルド時にインライン化）
import bloomVert from './bloom.vert?raw'
import bloomFrag from './bloom.frag?raw'
import blurVert from './blur.vert?raw'
import blurFrag from './blur.frag?raw'
import arrowTrailVert from './arrowTrail.vert?raw'
import arrowTrailFrag from './arrowTrail.frag?raw'
import targetGlowVert from './targetGlow.vert?raw'
import targetGlowFrag from './targetGlow.frag?raw'
import particleVert from './particle.vert?raw'
import particleFrag from './particle.frag?raw'

export const shaders = {
  bloom: { vert: bloomVert, frag: bloomFrag },
  blur: { vert: blurVert, frag: blurFrag },
  arrowTrail: { vert: arrowTrailVert, frag: arrowTrailFrag },
  targetGlow: { vert: targetGlowVert, frag: targetGlowFrag },
  particle: { vert: particleVert, frag: particleFrag }
}

