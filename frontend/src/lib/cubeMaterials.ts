// different materials and textures for the cubes

import {
  CanvasTexture,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
} from 'three'

type DrawFn = (ctx: CanvasRenderingContext2D, size: number) => void

function canvasTexture(draw: DrawFn, size = 256, repeat = true): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  draw(ctx, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  if (repeat) {
    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
  }
  tex.anisotropy = 4
  return tex
}

const RUBIK_COLORS = ['#d1495b', '#2a9d8f', '#e9c46a', '#457b9d', '#f4a261', '#f4f1de']

function createRubikMaterial(): Material {
  const tex = canvasTexture(
    (ctx, s) => {
      const cell = s / 3
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.fillStyle = RUBIK_COLORS[(r * 3 + c) % RUBIK_COLORS.length]
          ctx.fillRect(c * cell, r * cell, cell, cell)
        }
      }
      ctx.strokeStyle = 'rgba(20, 20, 20, 0.85)'
      ctx.lineWidth = s * 0.018
      for (let i = 1; i < 3; i++) {
        ctx.beginPath()
        ctx.moveTo(0, i * cell)
        ctx.lineTo(s, i * cell)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(i * cell, 0)
        ctx.lineTo(i * cell, s)
        ctx.stroke()
      }
    },
    256,
    false
  )
  tex.magFilter = NearestFilter
  tex.minFilter = NearestFilter
  tex.generateMipmaps = false
  return new MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.1 })
}

function createGoldMaterial(): Material {
  const bump = canvasTexture(
    (ctx, s) => {
      ctx.fillStyle = '#888'
      ctx.fillRect(0, 0, s, s)
      for (let i = 0; i < 2600; i++) {
        const g = 90 + Math.random() * 165
        ctx.fillStyle = `rgb(${g},${g},${g})`
        ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5)
      }
    },
    256,
    true
  )
  return new MeshStandardMaterial({
    color: 0xd4a017,
    metalness: 1,
    roughness: 0.28,
    bumpMap: bump,
    bumpScale: 0.4,
  })
}

function createWoodMaterial(): Material {
  const tex = canvasTexture((ctx, s) => {
    ctx.fillStyle = '#7c4a23'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 140; i++) {
      const y = Math.random() * s
      const r = 85 + Math.random() * 45
      const g = 48 + Math.random() * 32
      const b = 12 + Math.random() * 22
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.08 + Math.random() * 0.18})`
      ctx.lineWidth = 0.6 + Math.random() * 2.4
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.bezierCurveTo(
        s * 0.25,
        y + (Math.random() - 0.5) * 10,
        s * 0.75,
        y + (Math.random() - 0.5) * 10,
        s,
        y + (Math.random() - 0.5) * 4
      )
      ctx.stroke()
    }
  })
  return new MeshStandardMaterial({ map: tex, roughness: 0.85 })
}

function createConcreteMaterial(): Material {
  const chips = ['#f5f0e6', '#2b2d42', '#8d99ae', '#e07a5f', '#3d405b', '#81b29a']
  const tex = canvasTexture((ctx, s) => {
    ctx.fillStyle = '#d8d3cc'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.06})`
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1)
    }
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = chips[i % chips.length]
      ctx.beginPath()
      ctx.arc(Math.random() * s, Math.random() * s, 3 + Math.random() * 7, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  return new MeshStandardMaterial({ map: tex, roughness: 0.95 })
}

function createVaporwaveMaterial(): Material {
  const tex = canvasTexture((ctx, s) => {
    const cell = s / 4
    const colors = ['#ff71ce', '#01cdfe']
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = colors[(r + c) % 2]
        ctx.fillRect(c * cell, r * cell, cell, cell)
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 2
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath()
      ctx.moveTo(i * cell, 0)
      ctx.lineTo(i * cell, s)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * cell)
      ctx.lineTo(s, i * cell)
      ctx.stroke()
    }
  })
  return new MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.3 })
}

function createHologramMaterial(): Material {
  const map = canvasTexture((ctx, s) => {
    const stops = ['#ff0000', '#ff8800', '#ffff00', '#00ff88', '#00ccff', '#8800ff', '#ff00cc']
    const grad = ctx.createLinearGradient(0, 0, s, s)
    stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, s, s)
  })
  return new MeshPhysicalMaterial({
    color: 0xffffff,
    map,
    iridescence: 1,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    metalness: 0.1,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  })
}

export function createCubeMaterials(): Material[] {
  return [
    createRubikMaterial(),
    createGoldMaterial(),
    createWoodMaterial(),
    createConcreteMaterial(),
    createVaporwaveMaterial(),
    createHologramMaterial(),
  ]
}

export function disposeCubeMaterials(materials: Material[]) {
  for (const mat of materials) {
    const meshMat = mat as MeshStandardMaterial
    for (const tex of [meshMat.map, meshMat.bumpMap]) {
      if (tex) tex.dispose()
    }
    mat.dispose()
  }
}
