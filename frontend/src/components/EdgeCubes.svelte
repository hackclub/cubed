<script lang="ts">
  import { onMount } from 'svelte'
  import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Euler,
    Group,
    MathUtils,
    Mesh,
    PerspectiveCamera,
    Quaternion,
    Scene,
    Vector3,
    WebGLRenderer,
    type Material,
  } from 'three'
  import { createCubeMaterials, disposeCubeMaterials } from '../lib/cubeMaterials'

  interface CubeData {
    mesh: Mesh
    basePosition: Vector3
    spinAxis: Vector3
    spinSpeed: number
    floatPhase: number
    floatFreq: number
    floatAmp: number
    driftOffset: number
    idleQuat: Quaternion
  }

  let canvas: HTMLCanvasElement

  let renderer: WebGLRenderer
  let scene: Scene
  let camera: PerspectiveCamera
  let group: Group
  let cubes: CubeData[] = []
  let materials: Material[] = []

  let rafId = 0
  let lastT = 0
  let running = false
  let ro: ResizeObserver | null = null

  const CAMERA_Z = 10
  const FOV = 45
  const CUBE_SIZE = 1.6
  const DESKTOP_COUNT = 6
  const MOBILE_COUNT = 4
  let isDesktop = true
  let mq: MediaQueryList

  const VISIBLE_HEIGHT = 2 * Math.tan(MathUtils.degToRad(FOV) / 2) * CAMERA_Z

  // Predefined positions forming an arch/C on each side (in world coordinates at z=0)
  // Left side (negative X): 3 positions forming an arch
  // Right side (positive X): 3 positions mirroring left
  const DESKTOP_POSITIONS: Vector3[] = [
    // Left side arch (bottom to top) — C shape: middle furthest out, top/bottom curve in
    new Vector3(-4.0, -2.8, 0),
    new Vector3(-6.8, 0, -0.8),
    new Vector3(-4.0, 2.8, 0.5),
    // Right side arch (bottom to top) — mirrored
    new Vector3(4.0, -2.8, -0.5),
    new Vector3(6.8, 0, 0.8),
    new Vector3(4.0, 2.8, 0),
  ]

  // Mobile: 2 per side (bottom and top of arch)
  const MOBILE_POSITIONS: Vector3[] = [
    new Vector3(-4.0, -2.8, 0),
    new Vector3(-4.0, 2.8, 0.5),
    new Vector3(4.0, -2.8, -0.5),
    new Vector3(4.0, 2.8, 0),
  ]

  function initThree() {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(new Color(0x000000), 0)

    scene = new Scene()
    scene.add(new AmbientLight(0xffffff, 0.8))

    const key = new DirectionalLight(0xffffff, 2.5)
    key.position.set(4, 6, 8)
    scene.add(key)

    const fill = new DirectionalLight(0xcfe8ff, 0.7)
    fill.position.set(-5, -3, 4)
    scene.add(fill)

    const rim = new DirectionalLight(0xfbbf24, 0.5)
    rim.position.set(0, -5, 6)
    scene.add(rim)

    camera = new PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 100)
    camera.position.set(0, 0, CAMERA_Z)
    camera.lookAt(0, 0, 0)

    group = new Group()
    scene.add(group)

    materials = createCubeMaterials()
    layoutCubes()
  }

  function layoutCubes() {
    for (const cube of cubes) {
      cube.mesh.geometry.dispose()
    }
    group.clear()
    cubes = []

    const count = isDesktop ? DESKTOP_COUNT : MOBILE_COUNT
    const positions = isDesktop ? DESKTOP_POSITIONS : MOBILE_POSITIONS

    // Randomly shuffle material order so each slot gets a random texture each load
    const shuffled = [...materials]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    for (let i = 0; i < count; i++) {
      const geometry = new BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
      const material = shuffled[i % shuffled.length]
      const mesh = new Mesh(geometry, material)

      const pos = positions[i]
      mesh.position.copy(pos)

      // Random initial orientation (subtle tilt)
      mesh.quaternion.setFromEuler(
        new Euler(
          (Math.random() - 0.5) * Math.PI * 0.4,
          (Math.random() - 0.5) * Math.PI * 0.4,
          (Math.random() - 0.5) * Math.PI * 0.4,
          'XYZ'
        )
      )

      group.add(mesh)

      // Random spin axis and speed
      const spinAxis = new Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize()
      const spinSpeed = 0.12 + Math.random() * 0.15

      cubes.push({
        mesh,
        basePosition: pos.clone(),
        spinAxis,
        spinSpeed,
        floatPhase: Math.random() * Math.PI * 2,
        floatFreq: 0.5 + Math.random() * 0.4,
        floatAmp: 0.15 + Math.random() * 0.1,
        driftOffset: Math.random() * Math.PI * 2,
        idleQuat: mesh.quaternion.clone(),
      })
    }
  }

  function resize() {
    const w = Math.max(canvas.clientWidth, 1)
    const h = Math.max(canvas.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function update(dt: number, t: number) {
    for (const cube of cubes) {
      // Continuous spin on random axis
      const spinQ = new Quaternion().setFromAxisAngle(cube.spinAxis, cube.spinSpeed * dt)
      cube.idleQuat.multiply(spinQ)

      // Gentle vertical float
      const bob = Math.sin(t * cube.floatFreq + cube.floatPhase) * cube.floatAmp
      cube.mesh.position.y = cube.basePosition.y + bob

      // Subtle horizontal drift
      const drift = Math.sin(t * 0.15 + cube.driftOffset) * 0.03
      cube.mesh.position.x = cube.basePosition.x + drift

      cube.mesh.quaternion.copy(cube.idleQuat)
    }
    renderer.render(scene, camera)
  }

  function frame(now: number) {
    if (!running) return
    const dt = Math.min((now - lastT) / 1000, 0.05)
    lastT = now
    update(dt, now / 1000)
    rafId = requestAnimationFrame(frame)
  }

  function onVisibility() {
    if (document.hidden) {
      running = false
      cancelAnimationFrame(rafId)
    } else if (!running) {
      running = true
      lastT = performance.now()
      rafId = requestAnimationFrame(frame)
    }
  }

  onMount(() => {
    if (typeof window === 'undefined') return

    mq = window.matchMedia('(min-width: 768px)')
    isDesktop = mq.matches
    const onMq = (e: MediaQueryListEvent) => {
      isDesktop = e.matches
      layoutCubes()
    }
    mq.addEventListener('change', onMq)

    initThree()

    ro = new ResizeObserver(() => resize())
    ro.observe(canvas)

    document.addEventListener('visibilitychange', onVisibility)

    running = true
    lastT = performance.now()
    rafId = requestAnimationFrame(frame)

    return () => {
      running = false
      cancelAnimationFrame(rafId)
      mq.removeEventListener('change', onMq)
      document.removeEventListener('visibilitychange', onVisibility)
      ro?.disconnect()
      for (const cube of cubes) {
        cube.mesh.geometry.dispose()
      }
      renderer.dispose()
      disposeCubeMaterials(materials)
      cubes = []
    }
  })
</script>

<div class="pointer-events-none fixed inset-0 z-0">
  <canvas bind:this={canvas} class="h-full w-full pointer-events-none" style="touch-action: none;"></canvas>
</div>
