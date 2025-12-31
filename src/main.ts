import './style.css'
import * as THREE from 'three'

// Viteのベースパスを考慮したパスを生成（テクスチャと音声ファイルで使用）
const baseUrl = import.meta.env.BASE_URL

// テクスチャローダー
const textureLoader = new THREE.TextureLoader()

// テクスチャの読み込み（publicフォルダのテクスチャを使用）

// 地面のテクスチャ（paper）
const groundTexture = textureLoader.load(`${baseUrl}paper_beiz_00063.jpg`)
groundTexture.wrapS = THREE.RepeatWrapping
groundTexture.wrapT = THREE.RepeatWrapping
groundTexture.repeat.set(20, 20) // テクスチャの繰り返し

// 山のテクスチャ（paper）
const mountainTexture = textureLoader.load(`${baseUrl}paper_beiz_00063.jpg`)
mountainTexture.wrapS = THREE.RepeatWrapping
mountainTexture.wrapT = THREE.RepeatWrapping
mountainTexture.repeat.set(2, 2)

// シーンのセットアップ
const scene = new THREE.Scene()

// 空のテクスチャ（sky）- スカイボックスとして使用
const skyTexture = textureLoader.load(`${baseUrl}sky_beiz_00008.jpg`)
// テクスチャを繰り返し表示できるように設定（半分のサイズで表示）
skyTexture.wrapS = THREE.RepeatWrapping
skyTexture.wrapT = THREE.RepeatWrapping
skyTexture.repeat.set(2, 2) // 2×2回繰り返して、半分のサイズで表示
// スカイボックス用の大きな球体を作成
const skyGeometry = new THREE.SphereGeometry(120, 32, 32) // 半径120mの球体（レンダリング距離内）
const skyMaterial = new THREE.MeshBasicMaterial({
  map: skyTexture,
  side: THREE.BackSide, // 内側から見る
  fog: false, // フォグの影響を受けない
  depthWrite: false, // 深度書き込みを無効化
  depthTest: false // 深度テストを無効化（常に背景として表示）
})
const sky = new THREE.Mesh(skyGeometry, skyMaterial)
// スカイボックスをシーンに追加し、アニメーションループでカメラの位置に同期
scene.add(sky)

// フォグを追加（地面の端が見えないように）
scene.fog = new THREE.Fog(0x87CEEB, 30, 120) // 色、近距離、遠距離（レンダリング距離に合わせて調整）

// カメラのセットアップ（FPS視点：騎手の視点）
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  150 // レンダリング距離を短く（地平線が見えないように）
)
// 騎手の視点：地面から1mの高さ
camera.position.set(0, 1, 0)

// カメラの進行速度（m/s）
const cameraSpeed = 5 // 秒速5m
let lastTime = performance.now()
let isCameraMoving = false // カメラの移動状態（開始時は停止）
let gameStarted = false // ゲーム開始フラグ
let gameEnded = false // ゲーム終了フラグ
let score = 0 // スコア
let gameTime = 0 // ゲーム開始からの経過時間（秒）

// デバッグモード（GETパラメータで切り替え）
const urlParams = new URLSearchParams(window.location.search)
const debugMode = urlParams.get('debug') === 'true'

// 弓矢の制御
let isCharging = false // チャージ中かどうか
let chargeStartTime = 0 // チャージ開始時刻
let chargeAmount = 0 // チャージ量（0-1）
const maxChargeTime = 3.0 // 最大チャージ時間（秒）
let releasePosition: { x: number; y: number } | null = null // クリック/タップを離した位置
const arrows: Array<{
  group: THREE.Group
  velocity: THREE.Vector3
  position: THREE.Vector3
  isStopped: boolean
  hitTarget: THREE.Group | null
  initialRotation: THREE.Euler // 発射時のカメラの回転
}> = [] // 発射された矢の配列
const gravity = -9.8 // 重力加速度（m/s²）
const baseArrowSpeed = 30 // 基本の矢の速度（m/s）

// 音声ファイル
const horseSound = new Audio(`${baseUrl}gyarop.mp3`)
horseSound.loop = true // 馬の足音はループ再生
horseSound.volume = 0.3 // 音量を控えめに

const arrowSound = new Audio(`${baseUrl}VSQSE_0381_Japanese_arrow_02.mp3`)
arrowSound.volume = 0.7

// 矢の効果音の前半と後半の時間を取得（後で設定）
let arrowSoundDuration = 0
// 発射音の終了位置（秒）- 前半のみ再生
const arrowSoundFireEndTime = 0 // 手動で調整可能
// 命中音の開始位置（秒）- 後半から再生
const arrowSoundHitStartTime = 1.0 // 手動で調整可能
arrowSound.addEventListener('loadedmetadata', () => {
  arrowSoundDuration = arrowSound.duration
})

// レンダラーのセットアップ
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
// オブジェクトのソートを無効化してちらつきを防ぐ
renderer.sortObjects = false

// canvasを#appに追加
const appElement = document.getElementById('app')
if (!appElement) {
  console.error('#app要素が見つかりません')
}
appElement?.appendChild(renderer.domElement)

// canvasが正しく追加されたか確認

// ライトの追加
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
scene.add(ambientLight)

// メインの方向光（真上より少し傾けた位置）
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9)
directionalLight.position.set(5, 15, 5) // 真上より少し傾けた位置
directionalLight.castShadow = true

// 影の設定
directionalLight.shadow.mapSize.width = 2048
directionalLight.shadow.mapSize.height = 2048
directionalLight.shadow.camera.near = 0.5
directionalLight.shadow.camera.far = 200
directionalLight.shadow.camera.left = -100
directionalLight.shadow.camera.right = 100
directionalLight.shadow.camera.top = 100
directionalLight.shadow.camera.bottom = -100
directionalLight.shadow.bias = -0.0001
directionalLight.shadow.normalBias = 0.02 // シャドウアクネを防ぐ

scene.add(directionalLight)

// 地面の作成
// 最初の的: スタートから30m
// 的の間隔: 20m
// 最後の的から地面の終わりまで: 30m（ルールは維持）
const firstTargetZ = -30 // 最初の的の位置（スタートから30m）
const targetInterval = 30 // 的の間隔（30m）
const lastTargetZ = firstTargetZ - (targetInterval * 2) // 最後の的の位置（-90m）
const groundEndZ = lastTargetZ - 20 // 地面の終わり（-110m、最後の的から20m）

// 地面を延長（フォグで端が見えないように）
// スタート地点側も延長するため、中心を調整
const startExtension = 50 // スタート地点側の延長（50m）
const endExtension = 250 // 終了地点側の延長（250m）
const extendedGroundLength = startExtension + Math.abs(groundEndZ) + endExtension // 全長
const groundWidth = 300 // 幅（左右、長さと同じ300mに延長）
const groundGeometry = new THREE.PlaneGeometry(groundWidth, extendedGroundLength)
const groundMaterial = new THREE.MeshStandardMaterial({ 
  map: groundTexture,
  color: 0x90EE90 // テクスチャの色調を調整
})
const ground = new THREE.Mesh(groundGeometry, groundMaterial)
ground.rotation.x = -Math.PI / 2
ground.position.y = 0
// 地面の中心を調整（スタート地点側も延長したため）
ground.position.z = -startExtension - Math.abs(groundEndZ) / 2
ground.receiveShadow = true
scene.add(ground)

// 山を作成する関数
function createMountain(position: { x: number; y: number; z: number }, scale: number): THREE.Mesh {
  // 山の形状（円錐）- セグメント数を増やして滑らかに
  const mountainGeometry = new THREE.ConeGeometry(scale * 0.5, scale, 16, 1) // セグメント数を8から16に増加
  const mountainMaterial = new THREE.MeshStandardMaterial({ 
    map: mountainTexture,
    color: 0x6B8E23, // オリーブ色（テクスチャの色調を調整）
    flatShading: false // 滑らかな表面にする
  })
  const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial)
  mountain.position.set(position.x, position.y + scale / 2, position.z) // 山の底が地面に
  mountain.castShadow = true // 影を落とす
  mountain.receiveShadow = true // 影を受ける
  return mountain
}

// 進行ルートの周りに山を配置
const courseStartZ = 0
const courseEndZ = -100
const mountainPositions: Array<{ x: number; y: number; z: number; scale: number }> = []

// コースの左側に山を配置
for (let z = courseStartZ; z >= courseEndZ; z -= 15) {
  const x = -12 + Math.random() * 3 // -12mから-9mの範囲（少し離す）
  const scale = 3 + Math.random() * 4 // 3mから7mの高さ
  mountainPositions.push({ x, y: 0, z, scale })
}

// コースの右側に山を配置（的の反対側）
for (let z = courseStartZ; z >= courseEndZ; z -= 15) {
  const x = 12 + Math.random() * 3 // 12mから15mの範囲（少し離す）
  const scale = 3 + Math.random() * 4 // 3mから7mの高さ
  mountainPositions.push({ x, y: 0, z, scale })
}

// 的の周りに山を配置
const targetPositions = [-30, -50, -70] // 3つの的の位置
targetPositions.forEach(targetZ => {
  // 的の後ろ（右側のさらに右）
  for (let i = 0; i < 3; i++) {
    const x = 10 + Math.random() * 4 // 10mから14mの範囲（少し離す）
    const z = targetZ + (Math.random() - 0.5) * 10 // 的の前後5mの範囲
    const scale = 2 + Math.random() * 3 // 2mから5mの高さ
    mountainPositions.push({ x, y: 0, z, scale })
  }
})

// 山をシーンに追加
mountainPositions.forEach(pos => {
  const mountain = createMountain(pos, pos.scale)
  scene.add(mountain)
})

// 大きな山を追加（コースと的の周辺を避けて配置）
const largeMountainPositions: Array<{ x: number; y: number; z: number; scale: number }> = []

// コースの左側の遠くに大きな山を配置
for (let z = -50; z >= -150; z -= 20) {
  const x = -18 + Math.random() * 5 // -18mから-13mの範囲（コースから離れた位置）
  const scale = 8 + Math.random() * 6 // 8mから14mの高さ（大きい山）
  largeMountainPositions.push({ x, y: 0, z, scale })
}

// コースの右側の遠くに大きな山を配置（的の反対側）
for (let z = -50; z >= -150; z -= 20) {
  const x = 18 + Math.random() * 5 // 18mから23mの範囲（コースから離れた位置）
  const scale = 8 + Math.random() * 6 // 8mから14mの高さ（大きい山）
  largeMountainPositions.push({ x, y: 0, z, scale })
}

// 進行方向の奥（終了地点側）に大きな山を配置
for (let x = -20; x <= 20; x += 10) {
  if (Math.abs(x) < 5) continue // コースの真上は避ける
  const z = -120 + Math.random() * 20 // -120mから-100mの範囲
  const scale = 8 + Math.random() * 6 // 8mから14mの高さ
  largeMountainPositions.push({ x, y: 0, z, scale })
}

// スタート地点側に大きな山を配置
for (let x = -20; x <= 20; x += 10) {
  if (Math.abs(x) < 5) continue // コースの真上は避ける
  const z = 20 + Math.random() * 20 // 20mから40mの範囲（スタート地点側）
  const scale = 8 + Math.random() * 6 // 8mから14mの高さ
  largeMountainPositions.push({ x, y: 0, z, scale })
}

// 的の周辺を避けて、さらに遠くに大きな山を配置
// 的の位置: z = -30, -50, -70, x = 3
const targetZs = [-30, -50, -70]
for (let z = -20; z >= -180; z -= 25) {
  // 的の位置を避ける
  const isNearTarget = targetZs.some(tz => Math.abs(z - tz) < 15)
  if (isNearTarget) continue
  
  // 左側に配置
  const xLeft = -15 + Math.random() * 3 // 少し離す
  const scaleLeft = 8 + Math.random() * 6
  largeMountainPositions.push({ x: xLeft, y: 0, z, scale: scaleLeft })
  
  // 右側に配置（的の反対側、x=-2より右）
  const xRight = 10 + Math.random() * 5 // 少し離す
  const scaleRight = 8 + Math.random() * 6
  largeMountainPositions.push({ x: xRight, y: 0, z, scale: scaleRight })
}

// 大きな山をシーンに追加
largeMountainPositions.forEach(pos => {
  const mountain = createMountain(pos, pos.scale)
  scene.add(mountain)
})

// カメラのリセット位置（元の地面の端を超えたら戻る位置）
const cameraResetZ = groundEndZ - 5 // 元の地面の端を少し超えたらリセット

// カメラの回転制御用の変数
let isDragging = false
let previousMousePosition = { x: 0, y: 0 }
let cameraRotation = { horizontal: 0, vertical: 0 } // 水平回転と垂直回転
let targetRotation = { horizontal: 0, vertical: 0 } // 目標回転（自動追従用）
let rotationVelocity = { horizontal: 0, vertical: 0 } // 回転速度（慣性用）
const rotationDamping = 0.5 // 慣性の減衰係数（小さいほど滑らか）
const rotationSpring = 0.25 // 目標への復帰力（大きいほど速く反応）
const rotationNoise = 0.0 // ブレの強さ

// 一番近い的を見つける関数
function findNearestTarget(): THREE.Group | null {
  if (targets.length === 0) return null
  
  let nearestTarget: THREE.Group | null = null
  let nearestDistance = Infinity
  
  targets.forEach(target => {
    const targetPosition = new THREE.Vector3()
    target.getWorldPosition(targetPosition)
    const distance = camera.position.distanceTo(targetPosition)
    
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestTarget = target
    }
  })
  
  return nearestTarget
}

// 的の方向を計算して目標回転を設定
function updateTargetRotation() {
  if (!gameStarted || gameEnded) {
    return
  }
  
  const nearestTarget = findNearestTarget()
  if (!nearestTarget) {
    return
  }
  
  const targetPosition = new THREE.Vector3()
  nearestTarget.getWorldPosition(targetPosition)
  
  // カメラから的への方向ベクトル
  const direction = new THREE.Vector3()
  direction.subVectors(targetPosition, camera.position).normalize()
  
  // 水平回転（Y軸周り）を計算
  // Three.jsでは、カメラの前方が-Z方向
  // カメラの初期方向は(0, 0, -1)なので、これを基準に計算
  // 的が右側（x>0）にある場合、右を向く必要がある
  // 符号を反転させて正しい方向を向くようにする
  const horizontalRotation = Math.atan2(-direction.x, -direction.z)
  
  // 垂直回転（X軸周り）を計算
  const horizontalDistance = Math.sqrt(direction.x * direction.x + direction.z * direction.z)
  const verticalRotation = Math.atan2(-direction.y, horizontalDistance)
  
  // 目標回転を設定（±60度に制限）
  targetRotation.horizontal = horizontalRotation
  targetRotation.vertical = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, verticalRotation))
}

// カメラの回転を更新する関数（慣性付き）
function updateCameraRotation(deltaTime: number = 0.016) {
  // デバッグモードでない場合、または手動操作中でない場合、自動追従を有効化
  if ((!debugMode || !isDragging) && gameStarted && !gameEnded) {
    updateTargetRotation()
    
    // 目標回転との差を計算
    let deltaHorizontal = targetRotation.horizontal - cameraRotation.horizontal
    let deltaVertical = targetRotation.vertical - cameraRotation.vertical
    
    // 角度を-πからπの範囲に正規化
    while (deltaHorizontal > Math.PI) deltaHorizontal -= 2 * Math.PI
    while (deltaHorizontal < -Math.PI) deltaHorizontal += 2 * Math.PI
    
    // スプリングとダンパーを使った物理シミュレーション
    const springForceH = deltaHorizontal * rotationSpring
    const springForceV = deltaVertical * rotationSpring
    
    // 速度を更新（デルタタイムを考慮）
    rotationVelocity.horizontal += springForceH * deltaTime * 60
    rotationVelocity.vertical += springForceV * deltaTime * 60
    
    // 減衰を適用
    rotationVelocity.horizontal *= (1 - rotationDamping)
    rotationVelocity.vertical *= (1 - rotationDamping)
    
    // ランダムなブレを追加
    rotationVelocity.horizontal += (Math.random() - 0.5) * rotationNoise
    rotationVelocity.vertical += (Math.random() - 0.5) * rotationNoise
    
    // 回転を更新
    cameraRotation.horizontal += rotationVelocity.horizontal
    cameraRotation.vertical += rotationVelocity.vertical
    
    // 垂直回転を制限
    cameraRotation.vertical = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraRotation.vertical))
  }
  
  // 水平回転（Y軸周り）
  const horizontalRotation = cameraRotation.horizontal
  // 垂直回転（X軸周り）- 上下の制限を設ける（±60度）
  const verticalRotation = cameraRotation.vertical
  
  // カメラの方向ベクトルを計算
  const direction = new THREE.Vector3(0, 0, -1)
  direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), horizontalRotation)
  direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), verticalRotation)
  
  // カメラの位置から方向を見る
  const lookAtPoint = new THREE.Vector3()
  lookAtPoint.copy(camera.position).add(direction)
  camera.lookAt(lookAtPoint)
}

// 初期カメラ回転を設定（前方を見る）
updateCameraRotation()

// 的を作成する関数
function createTarget(position: { x: number; y: number; z: number }): THREE.Group {
  const targetGroup = new THREE.Group()
  
  // 的の板（50cmの円盤、厚さ5cm）- 1.5倍サイズ
  const boardRadius = 0.25 * 1.5 // 50cm * 1.5 = 0.375m (半径)
  const boardThickness = 0.05
  const boardGeometry = new THREE.CylinderGeometry(boardRadius, boardRadius, boardThickness, 32)
  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }) // 茶色の板
  const board = new THREE.Mesh(boardGeometry, boardMaterial)
  board.rotation.z = Math.PI / 2 // 板を鉛直にする（Y軸周りに90度回転）
  board.castShadow = true
  board.receiveShadow = true
  targetGroup.add(board)
  
  // 模様を1つのメッシュに統合してちらつきを根本的に解決
  const patternThickness = 0.01 // 模様の厚み（1cm）
  const patternOffsetX = -0.05 // カメラ側にオフセット（X方向）
  
  // 模様を1つのShapeに統合（外側から内側へ順番に）
  const patternShape = new THREE.Shape()
  
  // 外側の白いリング
  patternShape.absarc(0, 0, boardRadius, 0, Math.PI * 2, false)
  const outerHole = new THREE.Path()
  outerHole.absarc(0, 0, boardRadius * 0.6, 0, Math.PI * 2, true)
  patternShape.holes.push(outerHole)
  
  // 中間の黒いリング
  const middleRing = new THREE.Shape()
  middleRing.absarc(0, 0, boardRadius * 0.6, 0, Math.PI * 2, false)
  const middleHole = new THREE.Path()
  middleHole.absarc(0, 0, boardRadius * 0.3, 0, Math.PI * 2, true)
  middleRing.holes.push(middleHole)
  
  // 内側の白いリング
  const innerRing = new THREE.Shape()
  innerRing.absarc(0, 0, boardRadius * 0.3, 0, Math.PI * 2, false)
  const innerHole = new THREE.Path()
  innerHole.absarc(0, 0, 0.05 * 1.5, 0, Math.PI * 2, true) // 1.5倍サイズ
  innerRing.holes.push(innerHole)
  
  // 中心の黒い円
  const centerShape = new THREE.Shape()
  centerShape.absarc(0, 0, 0.05 * 1.5, 0, Math.PI * 2, false) // 1.5倍サイズ
  
  // 各パーツを別々のメッシュとして作成（色が異なるため）
  // 外側の白いリング
  const outerExtrudeSettings = {
    depth: patternThickness,
    bevelEnabled: false
  }
  const outerGeometry = new THREE.ExtrudeGeometry(patternShape, outerExtrudeSettings)
  const outerMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial)
  outerMesh.rotation.y = Math.PI / 2
  outerMesh.position.set(patternOffsetX, 0, 0)
  targetGroup.add(outerMesh)
  
  // 中間の黒いリング
  const middleGeometry = new THREE.ExtrudeGeometry(middleRing, outerExtrudeSettings)
  const middleMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 })
  const middleMesh = new THREE.Mesh(middleGeometry, middleMaterial)
  middleMesh.rotation.y = Math.PI / 2
  middleMesh.position.set(patternOffsetX, 0, patternThickness * 0.1) // わずかに前に
  targetGroup.add(middleMesh)
  
  // 内側の白いリング
  const innerGeometry = new THREE.ExtrudeGeometry(innerRing, outerExtrudeSettings)
  const innerMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial)
  innerMesh.rotation.y = Math.PI / 2
  innerMesh.position.set(patternOffsetX, 0, patternThickness * 0.2) // さらに前に
  targetGroup.add(innerMesh)
  
  // 中心の黒い円
  const centerGeometry = new THREE.ExtrudeGeometry(centerShape, outerExtrudeSettings)
  const centerMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 })
  const centerMesh = new THREE.Mesh(centerGeometry, centerMaterial)
  centerMesh.rotation.y = Math.PI / 2
  centerMesh.position.set(patternOffsetX, 0, patternThickness * 0.3) // 最も前に
  targetGroup.add(centerMesh)
  
  // 的の支柱（地面から的の中心まで）
  const poleHeight = position.y // 的の高さに合わせる
  const poleGeometry = new THREE.CylinderGeometry(0.03, 0.03, poleHeight, 8)
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 })
  const pole = new THREE.Mesh(poleGeometry, poleMaterial)
  pole.position.y = -poleHeight / 2 // 支柱の中心を地面に合わせる
  pole.castShadow = true
  targetGroup.add(pole)
  
  // 位置を設定
  targetGroup.position.set(position.x, position.y, position.z)
  
  return targetGroup
}

// 矢を作成する関数
function createArrow(): THREE.Group {
  const arrowGroup = new THREE.Group()
  
  // 矢の軸（細い円柱）- Z軸方向（-Zが前方）に配置
  const shaftGeometry = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 8)
  const shaftMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }) // 茶色
  const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial)
  shaft.rotation.x = Math.PI / 2 // X軸周りに90度回転して横向きにする
  shaft.position.z = -0.25 // 中心から少し前に（-Z方向）
  arrowGroup.add(shaft)
  
  // 矢じり（三角錐）- 先端に配置
  const headGeometry = new THREE.ConeGeometry(0.015, 0.05, 8)
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 }) // 灰色
  const head = new THREE.Mesh(headGeometry, headMaterial)
  head.rotation.x = Math.PI / 2 // X軸周りに90度回転して横向きにする
  head.position.z = -0.5 // 先端に配置（-Z方向）
  arrowGroup.add(head)
  
  // 矢羽（2枚）
  const fletchingGeometry = new THREE.BoxGeometry(0.02, 0.05, 0.01)
  const fletchingMaterial = new THREE.MeshStandardMaterial({ color: 0xFF0000 }) // 赤
  const fletching1 = new THREE.Mesh(fletchingGeometry, fletchingMaterial)
  fletching1.position.z = 0
  fletching1.position.y = 0.02
  arrowGroup.add(fletching1)
  const fletching2 = new THREE.Mesh(fletchingGeometry, fletchingMaterial)
  fletching2.position.z = 0
  fletching2.position.y = -0.02
  arrowGroup.add(fletching2)
  
  arrowGroup.castShadow = true
  return arrowGroup
}

// チャージ量を計算（後ほど遅くなる）
function calculateChargeAmount(elapsedTime: number): number {
  // 最初は速く、後ほど遅くなる非線形なチャージ
  // 0-1の範囲で、最初の1秒で0.7、次の1秒で0.25、最後の1秒で0.05
  if (elapsedTime < 1.0) {
    return Math.min(0.7 * (elapsedTime / 1.0), 0.7)
  } else if (elapsedTime < 2.0) {
    return 0.7 + 0.25 * ((elapsedTime - 1.0) / 1.0)
  } else {
    return 0.95 + 0.05 * Math.min((elapsedTime - 2.0) / 1.0, 1.0)
  }
}

// チャージを開始
function startCharging() {
  if (!gameStarted || gameEnded || isCharging) return
  isCharging = true
  chargeStartTime = gameTime
  chargeAmount = 0
  releasePosition = null
}

// チャージを終了して矢を発射
function releaseArrow(releaseX?: number, releaseY?: number) {
  if (!isCharging) return
  
  isCharging = false
  
  // チャージ量が0の場合は発射しない
  if (chargeAmount < 0.1) {
    chargeAmount = 0
    return
  }
  
  // クリック/タップを離した位置から方向を計算
  let direction: THREE.Vector3
  
  if (releaseX !== undefined && releaseY !== undefined) {
    // 画面座標を正規化デバイス座標（-1 to 1）に変換
    const mouse = new THREE.Vector2()
    mouse.x = (releaseX / window.innerWidth) * 2 - 1
    mouse.y = -(releaseY / window.innerHeight) * 2 + 1
    
    // レイキャスターを使用して3D空間の方向を取得
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    
    // カメラの前方方向を基準に、レイキャスターの方向を使用
    direction = raycaster.ray.direction.normalize()
  } else {
    // フォールバック: カメラの正面方向
    direction = new THREE.Vector3(0, 0, -1)
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraRotation.horizontal)
    direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), cameraRotation.vertical)
  }
  
  // 矢の速度を計算（チャージ量に応じて、さらに弱体化）
  // チャージ量が少ない時はより遅く、多い時は速く
  const speed = baseArrowSpeed * (0.1 + chargeAmount * 0.6) // 3-21 m/s（以前は6-30 m/s）
  const velocity = direction.multiplyScalar(speed)
  
  // 矢を作成
  const arrow = createArrow()
  arrow.position.copy(camera.position)
  
  // 矢の初期向きを速度方向に設定
  // 矢はX軸方向（右方向）を向いているので、速度方向に向ける
  const velocityNormalized = velocity.clone().normalize()
  const lookAtPoint = arrow.position.clone().add(velocityNormalized)
  arrow.lookAt(lookAtPoint)
  
  scene.add(arrow)
  
  // 矢のデータを保存
  arrows.push({
    group: arrow,
    velocity: velocity.clone(),
    position: camera.position.clone(),
    isStopped: false,
    hitTarget: null,
    initialRotation: camera.rotation.clone() // 発射時のカメラの回転を保存
  })
  
  chargeAmount = 0
  releasePosition = null
  
  // チャージゲージを0に戻す
  const chargeGaugeBar = document.getElementById('chargeGaugeBar')
  if (chargeGaugeBar) {
    chargeGaugeBar.style.height = '0%'
  }
  
  // 矢の発射音（前半のみ再生）
  if (arrowSoundDuration > 0) {
    const arrowSoundClone = arrowSound.cloneNode() as HTMLAudioElement
    arrowSoundClone.volume = arrowSound.volume
    arrowSoundClone.currentTime = 0
    // 手動で設定した終了位置まで再生
    const stopHandler = () => {
      if (arrowSoundClone.currentTime >= arrowSoundFireEndTime) {
        arrowSoundClone.pause()
        arrowSoundClone.removeEventListener('timeupdate', stopHandler)
      }
    }
    arrowSoundClone.addEventListener('timeupdate', stopHandler)
    arrowSoundClone.play().catch(e => console.log('音声再生エラー:', e))
  }
}

// 3つの的を配置（進行方向に向かって右側、地面から1mの高さ）
// 最初の的: スタートから40m、20m間隔で配置
const targets: THREE.Group[] = []

// 1つ目の的（スタートから30m、右側）- カメラから2m離す
const target1 = createTarget({ x: 3, y: 1, z: firstTargetZ })
scene.add(target1)
targets.push(target1)

// 2つ目の的（1つ目から30m先、右側）- カメラから3m離す
const target2 = createTarget({ x: 4, y: 1, z: firstTargetZ - targetInterval })
scene.add(target2)
targets.push(target2)

// 3つ目の的（2つ目から30m先、右側）- カメラから4m離す
const target3 = createTarget({ x: 5, y: 1, z: firstTargetZ - (targetInterval * 2) })
scene.add(target3)
targets.push(target3)

// 右クリックのコンテキストメニューを無効化
renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault()
})

// マウスイベント（PC用）
renderer.domElement.addEventListener('mousedown', (e) => {
  // 左クリックでチャージ開始
  if (e.button === 0) {
    e.preventDefault()
    startCharging()
    return
  }
  
  // デバッグモードの場合、右クリックでカメラ操作
  if (debugMode && e.button === 2) {
    e.preventDefault()
    isDragging = true
    previousMousePosition = { x: e.clientX, y: e.clientY }
    renderer.domElement.style.cursor = 'grabbing'
  }
})

// デバッグモードの場合のみカメラ操作を有効化
if (debugMode) {
  renderer.domElement.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    
    const deltaX = e.clientX - previousMousePosition.x
    const deltaY = e.clientY - previousMousePosition.y
    
    // 感度調整
    const sensitivity = 0.005
    cameraRotation.horizontal -= deltaX * sensitivity
    cameraRotation.vertical -= deltaY * sensitivity
    
    // 手動操作時は速度をリセット
    rotationVelocity.horizontal = 0
    rotationVelocity.vertical = 0
    
    updateCameraRotation()
    
    previousMousePosition = { x: e.clientX, y: e.clientY }
  })
}

renderer.domElement.addEventListener('mouseup', (e) => {
  // 左クリックでチャージ終了（発射）
  if (e.button === 0) {
    e.preventDefault()
    releaseArrow(e.clientX, e.clientY)
    return
  }
  
  // デバッグモードの場合、右クリックでカメラ操作終了
  if (debugMode && e.button === 2) {
    e.preventDefault()
    isDragging = false
    renderer.domElement.style.cursor = 'grab'
  }
})

if (debugMode) {
  renderer.domElement.addEventListener('mouseleave', () => {
    isDragging = false
    renderer.domElement.style.cursor = 'grab'
  })
  
  // カーソルスタイルの初期設定
  renderer.domElement.style.cursor = 'grab'
}

// タッチイベント（モバイル用）
let previousTouchPosition: { x: number; y: number } | null = null
let touchStartTime = 0
let touchStartPosition: { x: number; y: number } | null = null
const longPressTime = 300 // 長押し判定時間（ms）

renderer.domElement.addEventListener('touchstart', (e) => {
  e.preventDefault()
  if (e.touches.length === 1) {
    const touch = e.touches[0]
    touchStartTime = Date.now()
    touchStartPosition = { x: touch.clientX, y: touch.clientY }
    previousTouchPosition = { x: touch.clientX, y: touch.clientY }
    
    // タップでチャージ開始
    startCharging()
  }
})

renderer.domElement.addEventListener('touchmove', (e) => {
  e.preventDefault()
  // タッチ移動中はチャージを継続（何もしない）
})

renderer.domElement.addEventListener('touchend', (e) => {
  e.preventDefault()
  
  // チャージ中なら矢を発射
  if (isCharging && e.changedTouches.length > 0) {
    const touch = e.changedTouches[0]
    releaseArrow(touch.clientX, touch.clientY)
  }
  
  isDragging = false
  previousTouchPosition = null
  touchStartPosition = null
})

renderer.domElement.addEventListener('touchcancel', (e) => {
  e.preventDefault()
  isDragging = false
  previousTouchPosition = null
})

// スペースキーでカメラの移動を停止/再開（デバッグモードのみ）
if (debugMode) {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      isCameraMoving = !isCameraMoving
    }
  })
}

// アニメーションループ
function animate() {
  requestAnimationFrame(animate)
  
  // 時間の差分を計算（デルタタイム）
  const currentTime = performance.now()
  const deltaTime = (currentTime - lastTime) / 1000 // 秒単位に変換
  lastTime = currentTime
  
  // カメラを進行方向（-Z方向）に移動（ゲーム開始中で停止中でない場合のみ）
  if (isCameraMoving && gameStarted && !gameEnded) {
    camera.position.z -= cameraSpeed * deltaTime
    gameTime += deltaTime // ゲーム時間を更新
    
    // 馬の足音を再生（まだ再生されていない場合）
    if (horseSound.paused && gameStarted) {
      horseSound.play().catch(e => console.log('音声再生エラー:', e))
    }
  } else {
    // ゲームが停止したら馬の足音も停止
    if (!horseSound.paused) {
      horseSound.pause()
    }
  }
  
  // 馬の走行を再現する上下動（全波整流したサイン波）
  // 全波整流: Math.abs(Math.sin(t))で、常に正の値になる
  const horseBounceFrequency = 1 // 上下動の周波数（Hz、馬の歩調）
  const horseBounceAmplitude = 0.15 // 上下動の振幅（m）
  const baseHeight = 1.0 // 基本の高さ（m）
  const horseBounce = Math.abs(Math.sin(gameTime * horseBounceFrequency * Math.PI * 2)) * horseBounceAmplitude
  camera.position.y = baseHeight + horseBounce
  
  // 終了地点に到達したら終了画面を表示
  if (camera.position.z <= cameraResetZ && gameStarted && !gameEnded) {
    gameEnded = true
    isCameraMoving = false
    showEndScreen()
  }
  
  // チャージ中の処理
  if (isCharging && gameStarted && !gameEnded) {
    const elapsedTime = gameTime - chargeStartTime
    chargeAmount = Math.min(calculateChargeAmount(elapsedTime), 1.0)
    
    // チャージゲージを更新
    const chargeGaugeBar = document.getElementById('chargeGaugeBar')
    if (chargeGaugeBar) {
      chargeGaugeBar.style.height = (chargeAmount * 100) + '%'
    }
  }
  
  // 矢の物理シミュレーション
  arrows.forEach((arrow, index) => {
    if (arrow.isStopped) return
    
    // 速度を更新（重力の影響）
    arrow.velocity.y += gravity * deltaTime
    
    // 位置を更新
    arrow.position.add(arrow.velocity.clone().multiplyScalar(deltaTime))
    arrow.group.position.copy(arrow.position)
    
    // 矢の向きを速度方向に合わせる（カメラの向きを基準に）
    if (arrow.velocity.length() > 0.1) {
      const velocityNormalized = arrow.velocity.clone().normalize()
      // 速度方向を向くように回転を計算
      const lookAtPoint = arrow.position.clone().add(velocityNormalized)
      arrow.group.lookAt(lookAtPoint)
    }
    
    // 的との衝突判定
    targets.forEach(target => {
      const targetPosition = new THREE.Vector3()
      target.getWorldPosition(targetPosition)
      const distance = arrow.position.distanceTo(targetPosition)
      const targetRadius = 0.25 * 1.5 // 的の半径（1.5倍サイズ）
      const innerRadius = targetRadius * 0.5 // 中央部分の半径（的の50%）
      
      if (distance < targetRadius + 0.1) {
        arrow.isStopped = true
        arrow.hitTarget = target
        
        const hitDirection = arrow.position.clone().sub(targetPosition)
        const hitDistance = hitDirection.length()
        
        let hitWorldPosition: THREE.Vector3
        if (hitDistance > 0) {
          hitDirection.normalize()
          const boardThickness = 0.05
          const actualHitDistance = Math.min(hitDistance, targetRadius)
          const surfaceOffset = hitDirection.multiplyScalar(actualHitDistance - boardThickness / 2)
          hitWorldPosition = targetPosition.clone().add(surfaceOffset)
        } else {
          hitWorldPosition = targetPosition.clone()
        }
        
        const targetWorldMatrix = new THREE.Matrix4()
        target.updateMatrixWorld(true)
        targetWorldMatrix.copy(target.matrixWorld)
        const targetInverseMatrix = new THREE.Matrix4().copy(targetWorldMatrix).invert()
        const hitLocalPosition = hitWorldPosition.clone().applyMatrix4(targetInverseMatrix)
        
        arrow.group.position.copy(hitLocalPosition)
        arrow.position.copy(hitWorldPosition)
        target.add(arrow.group)
        
        let points = 0
        if (distance < innerRadius) {
          points = 5
        } else {
          points = 3
        }
        score += points
        
        // 命中音（後半を再生）- 命中した時のみ再生
        if (arrowSoundDuration > 0) {
          const hitSound = arrowSound.cloneNode() as HTMLAudioElement
          hitSound.volume = arrowSound.volume
          // 手動で設定した開始位置から再生
          hitSound.currentTime = arrowSoundHitStartTime
          hitSound.play().catch(e => console.log('音声再生エラー:', e))
        }
      }
    })
    
    // 地面に当たった場合も停止
    if (arrow.position.y < 0.1) {
      arrow.isStopped = true
      arrow.position.y = 0.1
      arrow.group.position.copy(arrow.position)
    }
    
    // 遠くに行きすぎた矢を削除
    if (arrow.position.distanceTo(camera.position) > 200) {
      scene.remove(arrow.group)
      arrows.splice(index, 1)
    }
  })
  
  // カメラの回転を更新（進行方向を見る）
  updateCameraRotation(deltaTime)
  
  // スカイボックスをカメラの位置にのみ同期（回転は同期しない）
  sky.position.copy(camera.position)
  
  // シャドウカメラの位置をカメラの位置に合わせて更新（影が正しく表示されるように）
  directionalLight.shadow.camera.position.copy(camera.position)
  directionalLight.shadow.camera.position.y += 20 // 少し上に配置
  directionalLight.shadow.camera.updateProjectionMatrix()
  
  renderer.render(scene, camera)
}

// ウィンドウリサイズの処理
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// 開始画面と終了画面の制御
const startScreen = document.getElementById('startScreen')!
const endScreen = document.getElementById('endScreen')!
const startButton = document.getElementById('startButton')!
const restartButton = document.getElementById('restartButton')!
const scoreValue = document.getElementById('scoreValue')!
const fortuneDisplay = document.getElementById('fortuneDisplay')!

// ゲーム開始
function startGame() {
  gameStarted = true
  gameEnded = false
  isCameraMoving = true
  gameTime = 0 // ゲーム時間をリセット
  isCharging = false // チャージをリセット
  chargeAmount = 0
  startScreen.style.display = 'none'
  // カメラを初期位置にリセット
  camera.position.set(0, 1, 0)
  // カメラ回転と速度をリセット
  cameraRotation = { horizontal: 0, vertical: 0 }
  targetRotation = { horizontal: 0, vertical: 0 }
  rotationVelocity = { horizontal: 0, vertical: 0 }
  score = 0
  // 既存の矢を削除（的のグループに追加された矢も含む）
  arrows.forEach(arrow => {
    // 矢が的のグループに追加されている場合は、まず的のグループから削除
    if (arrow.hitTarget) {
      arrow.hitTarget.remove(arrow.group)
    } else {
      // シーンに直接追加されている場合はシーンから削除
      scene.remove(arrow.group)
    }
    // 矢のグループを破棄
    arrow.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  })
  arrows.length = 0
  // 馬の足音を停止
  horseSound.pause()
  horseSound.currentTime = 0
}

// 終了画面を表示
function showEndScreen() {
  endScreen.style.display = 'flex'
  scoreValue.textContent = score.toString()
  
  // スコアに応じた運勢を表示
  let fortune = ''
  if (score === 0) {
    fortune = '凶'
  } else if (score <= 3) {
    fortune = '末吉'
  } else if (score <= 6) {
    fortune = '小吉'
  } else if (score <= 9) {
    fortune = '中吉'
  } else {
    fortune = '大吉'
  }
  fortuneDisplay.textContent = fortune
}

// ゲーム再開
function restartGame() {
  gameStarted = false
  gameEnded = false
  isCameraMoving = false
  gameTime = 0 // ゲーム時間をリセット
  endScreen.style.display = 'none'
  startScreen.style.display = 'flex'
  // カメラを初期位置にリセット
  camera.position.set(0, 1, 0)
  // カメラ回転と速度をリセット
  cameraRotation = { horizontal: 0, vertical: 0 }
  targetRotation = { horizontal: 0, vertical: 0 }
  rotationVelocity = { horizontal: 0, vertical: 0 }
  score = 0
  
  // 既存の矢を削除（的のグループに追加された矢も含む）
  arrows.forEach(arrow => {
    // 矢が的のグループに追加されている場合は、まず的のグループから削除
    if (arrow.hitTarget) {
      arrow.hitTarget.remove(arrow.group)
    } else {
      // シーンに直接追加されている場合はシーンから削除
      scene.remove(arrow.group)
    }
    // 矢のグループを破棄
    arrow.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  })
  arrows.length = 0
  
  // 馬の足音を停止
  horseSound.pause()
  horseSound.currentTime = 0
}

// ボタンイベント
startButton.addEventListener('click', startGame)
restartButton.addEventListener('click', restartGame)

// アニメーション開始
animate()
