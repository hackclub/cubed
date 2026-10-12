<script lang="ts">
  /**
   * HexagonBackground
   * An interactive hexagon (honeycomb) grid background, rendered on a single
   * <canvas> for performance (was ~560 DOM divs before).
   *
   * Visuals match the original: honeycomb with 3px inset fill, springy scale
   * bounce + color shift on hover.
   *
   * Usage:
   *   <div class="h-screen overflow-hidden">
   *     <HexagonBackground client:load />
   *   </div>
   */
  let {
    class: className = '',
    hexagonSize = 75,
    hexagonMargin = 3,
  }: {
    class?: string;
    hexagonSize?: number;
    hexagonMargin?: number;
  } = $props()

  let containerEl = $state<HTMLDivElement>()
  let canvasEl = $state<HTMLCanvasElement>()

  // Hexagon geometry (same as before)
  const hexW = $derived(hexagonSize)
  const hexH = $derived(hexagonSize * 1.1)
  const rowPitch = $derived(hexagonSize * 0.8)
  const colStep = $derived(hexagonSize + hexagonMargin)
  const halfStep = $derived(colStep / 2)
  // Inner hexagon is the outer one inset by hexagonMargin on all sides
  const innerSx = $derived((hexW - 2 * hexagonMargin) / hexW)
  const innerSy = $derived((hexH - 2 * hexagonMargin) / hexH)

  // Hexagon vertices relative to center — matches the original CSS clip-path
  // polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)
  const LOCAL: Array<[number, number]> = $derived([
    [0, -hexH / 2],
    [hexW / 2, -hexH / 4],
    [hexW / 2, hexH / 4],
    [0, hexH / 2],
    [-hexW / 2, hexH / 4],
    [-hexW / 2, -hexH / 4],
  ])

  interface Hex {
    cx: number
    cy: number
  }

  const TARGET = 1.15
  const SPRING = 220
  const DAMPING = 18

  // Trail / lingering effect: hexagons you pass over slowly fade back.
  // Fuller on higher-end machines, reduced on low-spec ones for perf.
  interface TrailHex {
    idx: number
    t: number // 1 = freshly hovered (full color/size) → 0 = gone
  }
  const LOW_END =
    typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 8) < 4
  const TRAIL_LIFE = LOW_END ? 0.25 : 0.7
  const MAX_TRAIL = LOW_END ? 5 : 24

  // Light palette is the fallback when the theme CSS vars aren't available.
  interface Palette {
    bg: string
    outer: string
    inner: string
    hoverOuter: string
    hoverInner: string
    outerRgb: number[]
    innerRgb: number[]
    hoverOuterRgb: number[]
    hoverInnerRgb: number[]
  }
  const FALLBACK_PALETTE: Palette = {
    bg: '#f5f5f5',
    outer: '#e5e5e5',
    inner: '#fafafa',
    hoverOuter: '#737373',
    hoverInner: '#e5e5e5',
    outerRgb: [229, 229, 229],
    innerRgb: [250, 250, 250],
    hoverOuterRgb: [115, 115, 115],
    hoverInnerRgb: [229, 229, 229],
  }

  function hexToRgb(hex: string): number[] {
    const h = hex.trim().replace(/^#/, '')
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
      ]
    }
    if (h.length === 6) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    return [128, 128, 128]
  }

  function currentPalette(): Palette {
    if (typeof document === 'undefined') return FALLBACK_PALETTE
    const s = getComputedStyle(document.documentElement)
    const get = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb
    const outer = get('--c-hex-outer', FALLBACK_PALETTE.outer)
    const inner = get('--c-hex-inner', FALLBACK_PALETTE.inner)
    const hoverOuter = get('--c-hex-hover-outer', FALLBACK_PALETTE.hoverOuter)
    const hoverInner = get('--c-hex-hover-inner', FALLBACK_PALETTE.hoverInner)
    return {
      bg: get('--c-hex-bg', FALLBACK_PALETTE.bg),
      outer,
      inner,
      hoverOuter,
      hoverInner,
      outerRgb: hexToRgb(outer),
      innerRgb: hexToRgb(inner),
      hoverOuterRgb: hexToRgb(hoverOuter),
      hoverInnerRgb: hexToRgb(hoverInner),
    }
  }

  let hexagons: Hex[] = []
  let baseCanvas: HTMLCanvasElement | null = null
  let raf = 0
  let running = false
  let hoverIndex = -1
  let hoverScale = 1
  let hoverVel = 0
  let dpr = 1
  let reduceMotion = false
  let trail: TrailHex[] = []
  let pal: Palette = FALLBACK_PALETTE

  function lerpColor(a: number[], b: number[], t: number): string {
    const r = Math.round(a[0] + (b[0] - a[0]) * t)
    const g = Math.round(a[1] + (b[1] - a[1]) * t)
    const bl = Math.round(a[2] + (b[2] - a[2]) * t)
    return `rgb(${r}, ${g}, ${bl})`
  }

  function addTrail(idx: number) {
    // Don't re-add if already trailing (bumped back to fuller)
    const existing = trail.find((x) => x.idx === idx)
    if (existing) {
      existing.t = 1
      return
    }
    trail.push({ idx, t: 1 })
    if (trail.length > MAX_TRAIL) {
      trail.splice(0, trail.length - MAX_TRAIL)
    }
  }

  function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number) {
    ctx.beginPath()
    const [x0, y0] = LOCAL[0]
    ctx.moveTo(cx + x0 * sx, cy + y0 * sy)
    for (let i = 1; i < LOCAL.length; i++) {
      const [x, y] = LOCAL[i]
      ctx.lineTo(cx + x * sx, cy + y * sy)
    }
    ctx.closePath()
  }

  function drawHex(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number,
    outer: string,
    inner: string
  ) {
    // Outer layer (hexagon border color)
    hexPath(ctx, cx, cy, scale, scale)
    ctx.fillStyle = outer
    ctx.fill()
    // Inner layer (hexagon fill color, inset by the margin)
    hexPath(ctx, cx, cy, scale * innerSx, scale * innerSy)
    ctx.fillStyle = inner
    ctx.fill()
  }

  function rebuild() {
    if (!containerEl || !canvasEl) return

    const w = Math.max(containerEl.clientWidth, 1)
    const h = Math.max(containerEl.clientHeight, 1)
    dpr = Math.min(window.devicePixelRatio || 1, 2)

    canvasEl.width = Math.round(w * dpr)
    canvasEl.height = Math.round(h * dpr)
    canvasEl.style.width = `${w}px`
    canvasEl.style.height = `${h}px`

    pal = currentPalette()

    const cols = Math.ceil(w / colStep) + 3
    const rows = Math.ceil(h / rowPitch) + 3

    hexagons = []
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 1 ? halfStep : 0
      for (let c = 0; c < cols; c++) {
        hexagons.push({
          cx: c * colStep + offset + hexagonMargin + hexW / 2,
          cy: (r + 1) * rowPitch - hexH / 2,
        })
      }
    }

    // Pre-render the full static grid to an offscreen canvas
    if (!baseCanvas) {
      baseCanvas = document.createElement('canvas')
    }
    baseCanvas.width = canvasEl.width
    baseCanvas.height = canvasEl.height
    const bctx = baseCanvas.getContext('2d')!
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    bctx.fillStyle = pal.bg
    bctx.fillRect(0, 0, w, h)
    for (const hx of hexagons) {
      drawHex(bctx, hx.cx, hx.cy, 1, pal.outer, pal.inner)
    }

    // Initial paint of main canvas
    draw()
  }

  function draw() {
    const ctx = canvasEl!.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(baseCanvas!, 0, 0, canvasEl!.width, canvasEl!.height)

    // Lingering trail of recently hovered hexagons, fading out
    for (const tr of trail) {
      const hx = hexagons[tr.idx]
      const scale = 1 + (TARGET - 1) * tr.t
      drawHex(
        ctx,
        hx.cx,
        hx.cy,
        scale,
        lerpColor(pal.hoverOuterRgb, pal.outerRgb, 1 - tr.t),
        lerpColor(pal.hoverInnerRgb, pal.innerRgb, 1 - tr.t)
      )
    }

    if (hoverIndex >= 0 && hoverScale > 1.001) {
      const hx = hexagons[hoverIndex]
      drawHex(ctx, hx.cx, hx.cy, hoverScale, pal.hoverOuter, pal.hoverInner)
    }
  }

  function frame() {
    if (!running) return
    const target = hoverIndex >= 0 ? TARGET : 1
    if (reduceMotion) {
      hoverScale = target
      hoverVel = 0
    } else {
      hoverVel += (target - hoverScale) * SPRING * 0.016
      hoverVel *= Math.max(0, 1 - DAMPING * 0.016)
      hoverScale += hoverVel * 0.016
    }

    // Decay the trail
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].t -= 0.016 / TRAIL_LIFE
      if (trail[i].t <= 0) trail.splice(i, 1)
    }

    draw()
    const settled = Math.abs(hoverScale - target) < 0.002 && Math.abs(hoverVel) < 0.002
    if (settled && hoverIndex < 0 && trail.length === 0) {
      running = false
      return
    }
    raf = requestAnimationFrame(frame)
  }

  function startFrameLoop() {
    if (running) return
    running = true
    raf = requestAnimationFrame(frame)
  }

  function pointInHex(px: number, py: number, hx: Hex): boolean {
    const x = px - hx.cx
    const y = py - hx.cy
    // Quick bounding-box reject
    if (Math.abs(x) > hexW / 2 || Math.abs(y) > hexH / 2) return false
    let inside = false
    for (let i = 0, j = LOCAL.length - 1; i < LOCAL.length; j = i++) {
      const [xi, yi] = LOCAL[i]
      const [xj, yj] = LOCAL[j]
      const intersects =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (intersects) inside = !inside
    }
    return inside
  }

  function pickHex(px: number, py: number): number {
    for (let i = 0; i < hexagons.length; i++) {
      if (pointInHex(px, py, hexagons[i])) return i
    }
    return -1
  }

  function onPointerMove(e: PointerEvent) {
    if (!containerEl) return
    const rect = containerEl.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const idx = pickHex(px, py)
    if (idx !== hoverIndex) {
      // The hexagon we're leaving becomes part of the lingering trail
      if (hoverIndex >= 0) addTrail(hoverIndex)
      // Don't double-draw if a trailing hexagon becomes hovered again
      const dup = trail.findIndex((x) => x.idx === idx)
      if (dup !== -1) trail.splice(dup, 1)
      hoverIndex = idx
      startFrameLoop()
    }
  }

  function onPointerLeave() {
    if (hoverIndex !== -1) {
      addTrail(hoverIndex)
      hoverIndex = -1
      startFrameLoop()
    }
  }

  $effect(() => {
    if (!containerEl || !canvasEl) return
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const onMotion = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches
    }
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', onMotion)

    rebuild()

    const observer = new ResizeObserver(() => {
      rebuild()
    })
    observer.observe(containerEl)

    containerEl.addEventListener('pointermove', onPointerMove)
    containerEl.addEventListener('pointerleave', onPointerLeave)
    containerEl.addEventListener('pointercancel', onPointerLeave)

    return () => {
      window
        .matchMedia('(prefers-reduced-motion: reduce)')
        .removeEventListener('change', onMotion)
      observer.disconnect()
      containerEl?.removeEventListener('pointermove', onPointerMove)
      containerEl?.removeEventListener('pointerleave', onPointerLeave)
      containerEl?.removeEventListener('pointercancel', onPointerLeave)
      running = false
      cancelAnimationFrame(raf)
      baseCanvas = null
      hexagons = []
      trail = []
    }
  })
</script>

<div
  bind:this={containerEl}
  data-slot="hexagon-background"
  class="hexagon-background {className}"
  style="overflow: hidden;"
>
  <canvas
    bind:this={canvasEl}
    class="hexagon-canvas"
    style="display: block;"
  ></canvas>
</div>

<style>
  .hexagon-background {
    position: relative;
    width: 100%;
    height: 100%;
    /* Container / gap color (theme-aware light + dark) */
    background-color: var(--c-hex-bg);
  }

  .hexagon-canvas {
    position: absolute;
    inset: 0;
    pointer-events: none;
    cursor: default;
  }
</style>