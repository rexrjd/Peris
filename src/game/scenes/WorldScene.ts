import * as Phaser from 'phaser'
import type { Army, Player, Settlement } from '../../types/game'

type MoveHandler = (x: number, y: number) => void

type WorldState = {
  players: Player[]
  settlements: Settlement[]
  armies: Army[]
}

export const WORLD_WIDTH = 1200
export const WORLD_HEIGHT = 760

export function armyPosition(army: Army, nowMs = Date.now()) {
  if (army.status !== 'moving') {
    return { x: army.target_x, y: army.target_y, progress: 1, moving: false }
  }

  const departure = new Date(army.departure_at).getTime()
  const arrival = new Date(army.arrival_at).getTime()
  const duration = Math.max(1, arrival - departure)
  const progress = Phaser.Math.Clamp((nowMs - departure) / duration, 0, 1)

  return {
    x: Phaser.Math.Linear(army.start_x, army.target_x, progress),
    y: Phaser.Math.Linear(army.start_y, army.target_y, progress),
    progress,
    moving: progress < 1,
  }
}

function ownerTint(ownerId: string) {
  let hash = 0
  for (let i = 0; i < ownerId.length; i += 1) hash = (hash * 31 + ownerId.charCodeAt(i)) >>> 0
  const palette = [0xb65f57, 0x6f83bd, 0x9a6bb0, 0x4b9278, 0xb5814d, 0x8a715d]
  return palette[hash % palette.length]
}

export class WorldScene extends Phaser.Scene {
  private settlementMarkers = new Map<number, Phaser.GameObjects.Container>()
  private armyMarkers = new Map<number, Phaser.GameObjects.Container>()
  private currentPlayerId = ''
  private state: WorldState = { players: [], settlements: [], armies: [] }
  private onMove: MoveHandler
  private commandMode = false
  private routeLayer?: Phaser.GameObjects.Graphics
  private statusText?: Phaser.GameObjects.Text

  constructor(onMove: MoveHandler) {
    super('world')
    this.onMove = onMove
  }

  create() {
    this.cameras.main.setBackgroundColor('#263126')
    this.drawTerrain()
    this.drawGrid()

    this.routeLayer = this.add.graphics().setDepth(9)

    this.statusText = this.add
      .text(22, 20, 'Select MOVE ARMY to issue a command', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#f2e9cf',
        backgroundColor: '#10160fde',
        padding: { x: 12, y: 8 },
      })
      .setDepth(40)

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.commandMode) return
      const x = Phaser.Math.Clamp(Math.round(pointer.worldX), 45, WORLD_WIDTH - 45)
      const y = Phaser.Math.Clamp(Math.round(pointer.worldY), 55, WORLD_HEIGHT - 45)
      this.onMove(x, y)
    })

    this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        this.renderArmies()
        this.renderRoutes()
      },
    })

    this.renderWorld()
  }

  setWorldState(players: Player[], settlements: Settlement[], armies: Army[], currentPlayerId: string) {
    this.state = { players, settlements, armies }
    this.currentPlayerId = currentPlayerId
    if (this.sys.isActive()) this.renderWorld()
  }

  setCommandMode(active: boolean) {
    this.commandMode = active
    if (this.input?.manager?.canvas) {
      this.input.manager.canvas.style.cursor = active ? 'crosshair' : 'default'
    }
    this.statusText?.setText(active ? 'Choose a destination on the world map' : 'Select MOVE ARMY to issue a command')
    this.statusText?.setBackgroundColor(active ? '#4c3d19e8' : '#10160fde')
  }

  private playerName(ownerId: string) {
    return this.state.players.find((player) => player.id === ownerId)?.display_name ?? 'Unknown'
  }

  private renderWorld() {
    this.renderSettlements()
    this.renderArmies()
    this.renderRoutes()
  }

  private renderSettlements() {
    const alive = new Set(this.state.settlements.map((settlement) => settlement.id))

    for (const [id, marker] of this.settlementMarkers) {
      if (!alive.has(id)) {
        marker.destroy(true)
        this.settlementMarkers.delete(id)
      }
    }

    for (const settlement of this.state.settlements) {
      let marker = this.settlementMarkers.get(settlement.id)
      if (!marker) {
        marker = this.createSettlementMarker(settlement)
        this.settlementMarkers.set(settlement.id, marker)
      }
      marker.setPosition(settlement.x, settlement.y)
    }
  }

  private renderArmies() {
    const alive = new Set(this.state.armies.map((army) => army.id))

    for (const [id, marker] of this.armyMarkers) {
      if (!alive.has(id)) {
        marker.destroy(true)
        this.armyMarkers.delete(id)
      }
    }

    for (const army of this.state.armies) {
      let marker = this.armyMarkers.get(army.id)
      if (!marker) {
        marker = this.createArmyMarker(army)
        this.armyMarkers.set(army.id, marker)
      }

      const position = armyPosition(army)
      marker.setPosition(position.x, position.y)
    }
  }

  private renderRoutes() {
    if (!this.routeLayer) return
    this.routeLayer.clear()

    for (const army of this.state.armies) {
      const position = armyPosition(army)
      if (!position.moving) continue

      const mine = army.owner_id === this.currentPlayerId
      const color = mine ? 0xe5c972 : ownerTint(army.owner_id)

      this.routeLayer.lineStyle(mine ? 3 : 2, color, mine ? 0.9 : 0.45)
      this.routeLayer.beginPath()
      this.routeLayer.moveTo(position.x, position.y)
      this.routeLayer.lineTo(army.target_x, army.target_y)
      this.routeLayer.strokePath()

      if (mine) {
        this.routeLayer.lineStyle(2, 0xf3e4a2, 0.9)
        this.routeLayer.strokeCircle(army.target_x, army.target_y, 12)
        this.routeLayer.lineBetween(army.target_x - 17, army.target_y, army.target_x + 17, army.target_y)
        this.routeLayer.lineBetween(army.target_x, army.target_y - 17, army.target_x, army.target_y + 17)
      }
    }
  }

  private createSettlementMarker(settlement: Settlement) {
    const mine = settlement.owner_id === this.currentPlayerId
    const color = mine ? 0xd1ad54 : ownerTint(settlement.owner_id)
    const container = this.add.container(settlement.x, settlement.y)

    const shadow = this.add.ellipse(5, 13, 58, 24, 0x000000, 0.3)
    const wall = this.add.rectangle(0, 0, 42, 38, color)
    wall.setStrokeStyle(3, mine ? 0xffe597 : 0xe2d1ba)
    const keep = this.add.rectangle(0, -6, 20, 28, 0x29303a)
    const towerLeft = this.add.rectangle(-16, -9, 10, 28, 0x3d443e)
    const towerRight = this.add.rectangle(16, -9, 10, 28, 0x3d443e)
    const flag = this.add.triangle(15, -35, 0, 0, 0, 15, 21, 7, mine ? 0xffda67 : color)
    const label = this.add
      .text(0, -61, `${settlement.name}\n${mine ? 'YOUR REALM' : this.playerName(settlement.owner_id)}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        fontStyle: mine ? 'bold' : 'normal',
        align: 'center',
        color: mine ? '#ffe49b' : '#ffffff',
        backgroundColor: '#0e130ddd',
        padding: { x: 7, y: 4 },
      })
      .setOrigin(0.5)

    container.add([shadow, wall, keep, towerLeft, towerRight, flag, label])
    container.setDepth(12)
    return container
  }

  private createArmyMarker(army: Army) {
    const mine = army.owner_id === this.currentPlayerId
    const position = armyPosition(army)
    const color = mine ? 0x4b7fd1 : ownerTint(army.owner_id)
    const container = this.add.container(position.x, position.y)

    const shadow = this.add.circle(4, 6, 20, 0x000000, 0.3)
    const ring = this.add.circle(0, 0, 19, color)
    ring.setStrokeStyle(3, mine ? 0xbcd6ff : 0xf1d6cf)
    const sword = this.add.text(0, -2, '⚔', {
      fontFamily: 'Segoe UI Symbol, sans-serif',
      fontSize: '23px',
      color: '#ffffff',
    }).setOrigin(0.5)
    const label = this.add
      .text(0, 31, mine ? army.name : `${this.playerName(army.owner_id)} · army`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        fontStyle: mine ? 'bold' : 'normal',
        color: '#ffffff',
        backgroundColor: '#0e130dd5',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)

    container.add([shadow, ring, sword, label])
    container.setDepth(mine ? 24 : 20)
    return container
  }

  private drawGrid() {
    const grid = this.add.graphics().setDepth(2)
    grid.lineStyle(1, 0xb6c3ac, 0.07)
    for (let x = 0; x <= WORLD_WIDTH; x += 50) grid.lineBetween(x, 0, x, WORLD_HEIGHT)
    for (let y = 0; y <= WORLD_HEIGHT; y += 50) grid.lineBetween(0, y, WORLD_WIDTH, y)
  }

  private drawTerrain() {
    const g = this.add.graphics().setDepth(1)

    g.fillStyle(0x364334)
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)

    // Subtle realm regions.
    const regions = [
      [80, 100, 390, 260, 0x3b4a37],
      [710, 95, 405, 250, 0x46503a],
      [85, 440, 400, 245, 0x334536],
      [705, 440, 405, 245, 0x3e4934],
    ] as const
    for (const [x, y, w, h, color] of regions) {
      g.fillStyle(color, 0.6)
      g.fillRoundedRect(x, y, w, h, 28)
    }

    // Forests.
    g.fillStyle(0x1f3527, 0.95)
    for (const [x, y, r] of [[170, 170, 82], [255, 135, 65], [1010, 570, 105], [940, 620, 70]] as const) {
      g.fillCircle(x, y, r)
    }

    // Mountain range.
    g.fillStyle(0x7e8376, 0.82)
    g.fillTriangle(515, 210, 575, 92, 635, 210)
    g.fillTriangle(575, 220, 655, 70, 730, 220)
    g.fillTriangle(655, 205, 715, 105, 780, 205)
    g.fillStyle(0xb8b8aa, 0.7)
    g.fillTriangle(551, 139, 575, 92, 600, 139)
    g.fillTriangle(625, 126, 655, 70, 684, 126)

    // River.
    g.lineStyle(42, 0x4d7387, 0.9)
    g.beginPath()
    g.moveTo(-20, 565)
    g.lineTo(180, 530)
    g.lineTo(370, 550)
    g.lineTo(540, 510)
    g.lineTo(735, 540)
    g.lineTo(930, 505)
    g.lineTo(1220, 462)
    g.strokePath()
    g.lineStyle(3, 0x91adba, 0.45)
    g.beginPath()
    g.moveTo(-20, 553)
    g.lineTo(180, 518)
    g.lineTo(370, 538)
    g.lineTo(540, 498)
    g.lineTo(735, 528)
    g.lineTo(930, 493)
    g.lineTo(1220, 450)
    g.strokePath()

    // Roads meeting at the central ruins.
    g.lineStyle(6, 0x8e8066, 0.42)
    const roads = [
      [170, 290, 585, 380],
      [1025, 285, 615, 380],
      [220, 650, 585, 395],
      [990, 655, 615, 395],
    ] as const
    for (const [x1, y1, x2, y2] of roads) g.lineBetween(x1, y1, x2, y2)

    // Central neutral landmark.
    g.fillStyle(0x6f6756, 0.9)
    g.fillCircle(600, 386, 36)
    g.fillStyle(0x272a25, 0.9)
    g.fillRect(584, 358, 32, 45)
    this.add.text(600, 425, 'Old Crown Ruins', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      color: '#c8bda5',
      backgroundColor: '#10140fbb',
      padding: { x: 5, y: 2 },
    }).setOrigin(0.5).setDepth(3)

    g.lineStyle(2, 0x65705f, 0.5)
    g.strokeRect(8, 8, WORLD_WIDTH - 16, WORLD_HEIGHT - 16)
  }
}
