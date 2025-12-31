import './style.css'
import * as THREE from 'three'

// シーンのセットアップ
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87CEEB) // 空色の背景

// フォグを追加（地面の端が見えないように）
scene.fog = new THREE.Fog(0x87CEEB, 50, 200) // 色、近距離、遠距離

// カメラのセットアップ（FPS視点：騎手の視点）
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
// 騎手の視点：地面から1mの高さ
camera.position.set(0, 1, 0)

// カメラの進行速度（m/s）
const cameraSpeed = 5 // 秒速5m
let lastTime = performance.now()
let isCameraMoving = true // カメラの移動状態

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
console.log('Canvas要素:', renderer.domElement)
console.log('Canvasサイズ:', renderer.domElement.width, 'x', renderer.domElement.height)

// ライトの追加
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
directionalLight.position.set(10, 10, 5)
directionalLight.castShadow = true
scene.add(directionalLight)

// 地面の作成
// 最初の的: スタートから30m
// 的の間隔: 20m
// 最後の的から地面の終わりまで: 30m（ルールは維持）
const firstTargetZ = -30 // 最初の的の位置（スタートから30m）
const targetInterval = 20 // 的の間隔（20m）
const lastTargetZ = firstTargetZ - (targetInterval * 2) // 最後の的の位置（-70m）
const groundEndZ = lastTargetZ - 30 // 地面の終わり（-100m、ルール通り）

// 地面を延長（フォグで端が見えないように）
const extendedGroundLength = 300 // 延長後の地面の長さ（300m）
const groundWidth = 300 // 幅（左右、長さと同じ300mに延長）
const groundGeometry = new THREE.PlaneGeometry(groundWidth, extendedGroundLength)
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x90EE90 })
const ground = new THREE.Mesh(groundGeometry, groundMaterial)
ground.rotation.x = -Math.PI / 2
ground.position.y = 0
ground.position.z = -extendedGroundLength / 2 // 地面の中心を原点に合わせる
ground.receiveShadow = true
scene.add(ground)

// 山を作成する関数
function createMountain(position: { x: number; y: number; z: number }, scale: number): THREE.Mesh {
  // 山の形状（円錐）
  const mountainGeometry = new THREE.ConeGeometry(scale * 0.5, scale, 8, 1)
  const mountainMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x6B8E23, // オリーブ色
    flatShading: true
  })
  const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial)
  mountain.position.set(position.x, position.y + scale / 2, position.z) // 山の底が地面に
  mountain.castShadow = true
  mountain.receiveShadow = true
  return mountain
}

// 進行ルートの周りに山を配置
const courseStartZ = 0
const courseEndZ = -100
const mountainPositions: Array<{ x: number; y: number; z: number; scale: number }> = []

// コースの左側に山を配置
for (let z = courseStartZ; z >= courseEndZ; z -= 15) {
  const x = -8 + Math.random() * 3 // -8mから-5mの範囲
  const scale = 3 + Math.random() * 4 // 3mから7mの高さ
  mountainPositions.push({ x, y: 0, z, scale })
}

// コースの右側に山を配置（的の反対側）
for (let z = courseStartZ; z >= courseEndZ; z -= 15) {
  const x = 8 + Math.random() * 3 // 8mから11mの範囲
  const scale = 3 + Math.random() * 4 // 3mから7mの高さ
  mountainPositions.push({ x, y: 0, z, scale })
}

// 的の周りに山を配置
const targetPositions = [-30, -50, -70] // 3つの的の位置
targetPositions.forEach(targetZ => {
  // 的の後ろ（右側のさらに右）
  for (let i = 0; i < 3; i++) {
    const x = 6 + Math.random() * 4 // 6mから10mの範囲
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

// カメラのリセット位置（元の地面の端を超えたら戻る位置）
const cameraResetZ = groundEndZ - 5 // 元の地面の端を少し超えたらリセット

// カメラの回転制御用の変数
let isDragging = false
let previousMousePosition = { x: 0, y: 0 }
let cameraRotation = { horizontal: 0, vertical: 0 } // 水平回転と垂直回転

// カメラの回転を更新する関数
function updateCameraRotation() {
  // 水平回転（Y軸周り）
  const horizontalRotation = cameraRotation.horizontal
  // 垂直回転（X軸周り）- 上下の制限を設ける（±60度）
  const verticalRotation = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraRotation.vertical))
  
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
  
  // 的の板（50cmの円盤、厚さ5cm）
  const boardRadius = 0.25 // 50cm = 0.5m / 2
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
  innerHole.absarc(0, 0, 0.05, 0, Math.PI * 2, true)
  innerRing.holes.push(innerHole)
  
  // 中心の黒い円
  const centerShape = new THREE.Shape()
  centerShape.absarc(0, 0, 0.05, 0, Math.PI * 2, false)
  
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

// 3つの的を配置（進行方向に向かって右側、地面から1mの高さ）
// 最初の的: スタートから40m、20m間隔で配置
const targets: THREE.Group[] = []

// 1つ目の的（スタートから40m、右側）
const target1 = createTarget({ x: 3, y: 1, z: firstTargetZ })
scene.add(target1)
targets.push(target1)

// 2つ目の的（1つ目から20m先、右側）
const target2 = createTarget({ x: 3, y: 1, z: firstTargetZ - targetInterval })
scene.add(target2)
targets.push(target2)

// 3つ目の的（2つ目から20m先、右側）
const target3 = createTarget({ x: 3, y: 1, z: firstTargetZ - (targetInterval * 2) })
scene.add(target3)
targets.push(target3)

// マウスイベント（PC用）
renderer.domElement.addEventListener('mousedown', (e) => {
  isDragging = true
  previousMousePosition = { x: e.clientX, y: e.clientY }
  renderer.domElement.style.cursor = 'grabbing'
})

renderer.domElement.addEventListener('mousemove', (e) => {
  if (!isDragging) return
  
  const deltaX = e.clientX - previousMousePosition.x
  const deltaY = e.clientY - previousMousePosition.y
  
  // 感度調整
  const sensitivity = 0.005
  cameraRotation.horizontal -= deltaX * sensitivity
  cameraRotation.vertical -= deltaY * sensitivity
  
  updateCameraRotation()
  
  previousMousePosition = { x: e.clientX, y: e.clientY }
})

renderer.domElement.addEventListener('mouseup', () => {
  isDragging = false
  renderer.domElement.style.cursor = 'grab'
})

renderer.domElement.addEventListener('mouseleave', () => {
  isDragging = false
  renderer.domElement.style.cursor = 'grab'
})

// タッチイベント（モバイル用）
let previousTouchPosition: { x: number; y: number } | null = null

renderer.domElement.addEventListener('touchstart', (e) => {
  e.preventDefault()
  if (e.touches.length === 1) {
    const touch = e.touches[0]
    previousTouchPosition = { x: touch.clientX, y: touch.clientY }
    isDragging = true
  }
})

renderer.domElement.addEventListener('touchmove', (e) => {
  e.preventDefault()
  if (!isDragging || !previousTouchPosition || e.touches.length !== 1) return
  
  const touch = e.touches[0]
  const deltaX = touch.clientX - previousTouchPosition.x
  const deltaY = touch.clientY - previousTouchPosition.y
  
  // 感度調整
  const sensitivity = 0.005
  cameraRotation.horizontal -= deltaX * sensitivity
  cameraRotation.vertical -= deltaY * sensitivity
  
  updateCameraRotation()
  
  previousTouchPosition = { x: touch.clientX, y: touch.clientY }
})

renderer.domElement.addEventListener('touchend', (e) => {
  e.preventDefault()
  isDragging = false
  previousTouchPosition = null
})

renderer.domElement.addEventListener('touchcancel', (e) => {
  e.preventDefault()
  isDragging = false
  previousTouchPosition = null
})

// カーソルスタイルの初期設定
renderer.domElement.style.cursor = 'grab'

// スペースキーでカメラの移動を停止/再開
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    isCameraMoving = !isCameraMoving
    console.log('カメラ移動:', isCameraMoving ? '再開' : '停止')
  }
})

// アニメーションループ
function animate() {
  requestAnimationFrame(animate)
  
  // 時間の差分を計算（デルタタイム）
  const currentTime = performance.now()
  const deltaTime = (currentTime - lastTime) / 1000 // 秒単位に変換
  lastTime = currentTime
  
  // カメラを進行方向（-Z方向）に移動（停止中でない場合のみ）
  if (isCameraMoving) {
    camera.position.z -= cameraSpeed * deltaTime
  }
  camera.position.y = 1 // 高さを1mに固定
  
  // 地面の端を超えたら最初の位置に戻る
  if (camera.position.z <= cameraResetZ) {
    camera.position.z = 0 // 最初の位置に戻る
  }
  
  // カメラの回転を更新（進行方向を見る）
  updateCameraRotation()
  
  renderer.render(scene, camera)
}

// ウィンドウリサイズの処理
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// アニメーション開始
animate()

// デバッグ情報
console.log('流鏑馬ゲーム - WebGL環境が正常にセットアップされました！')
console.log('カメラ位置:', camera.position)
console.log('カメラ回転:', camera.rotation)
console.log('レンダラーサイズ:', renderer.getSize(new THREE.Vector2()))
console.log('シーン内のオブジェクト数:', scene.children.length)
