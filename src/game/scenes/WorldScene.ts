import * as Phaser from 'phaser'
import type { Army, Player, Settlement } from '../../types/game'

type MoveHandler = (x: number, y: number) => void

type WorldState = {
  players: Player[]
  settlements: Settlement[]
  armies: Army[]
}

export function armyPosition(army: Army, nowMs = Date.now()) {
  if (army.status !== 'moving') return { x: army.target_x, y: army.target_y, progress: 1 }

  const departure = new Date(army.departure_at).getTime()
  const arrival = new Date(army.arrival_at).getTime()
  const duration = Math.max(1, arrival - departure)
  const progress = Phaser.Math.Clamp((nowMs - departure) / duration, 0, 1)

  return {
    x: Phaser.Math.Linear(army.start_x, army.target_x, progress),
    y: Phaser.Math.Linear(army.start_y, army.target_y, progress),
    progress,
  }
}

export class WorldScene extends Phaser.Scene {
  private settlementMarkers = new Map<number, Phaser.GameObjects.Container>()
  private armyMarkers = new Map<number, Phaser.GameObjects.Container>()
  private currentPlayerId = ''
  private state: WorldState = { players: [], settlements: [], armies: [] }
  private onMove: MoveHandler

  constructor(onMove: MoveHandler) {
    super('world')
    this.onMove = onMove
  }

  create() {
    const width = 1100
    const height = 700

    const background = this.add.graphics()
    background.fillStyle(0x394735)
    background.fillRect(0, 0, width, height)

    this.drawGrid(width, height)
    this.drawTerrain()

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const x = Phaser.Math.Clamp(Math.round(pointer.worldX), 30, width - 30)
      const y = Phaser.Math.Clamp(Math.round(pointer.worldY), 30, height - 30)
      this.onMove(x, y)
    })

    this.add
      .text(22, 20, 'Click the map to send your army', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#f0ead8',
        backgroundColor: '#11170fcf',
        padding: { x: 12, y: 8 },
      })
      .setDepth(30)

    this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => this.renderArmies(),
    })

    this.renderWorld()
  }

  setWorldState(players: Player[], settlements: Settlement[], armies: Army[], currentPlayerId: string) {
    this.state = { players, settlements, armies }
    this.currentPlayerId = currentPlayerId
    if (this.sys.isActive()) this.renderWorld()
  }

  private playerName(ownerId: string) {
    return this.state.players.find((player) => player.id === ownerId)?.display_name ?? 'Unknown'
  }

  private renderWorld() {
    this.renderSettlements()
    this.renderArmies()
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

  private createSettlementMarker(settlement: Settlement) {
    const mine = settlement.owner_id === this.currentPlayerId
    const container = this.add.container(settlement.x, settlement.y)

    const shadow = this.add.ellipse(4, 10, 46, 20, 0x000000, 0.3)
    const outer = this.add.rectangle(0, 0, 34, 34, mine ? 0xc9a85d : 0x8d665f)
    outer.setStrokeStyle(3, mine ? 0xf3df9d : 0xc88c83)
    const keep = this.add.rectangle(0, -3, 18, 24, mine ? 0x273b58 : 0x593632)
    const flag = this.add.triangle(12, -24, 0, 0, 0, 14, 18, 7, mine ? 0xf0d67d : 0xd98379)
    const label = this.add
      .text(0, -48, `${settlement.name}\n${this.playerName(settlement.owner_id)}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        align: 'center',
        color: '#ffffff',
        backgroundColor: '#11170fdd',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)

    container.add([shadow, outer, keep, flag, label])
    container.setDepth(12)
    return container
  }

  private createArmyMarker(army: Army) {
    const mine = army.owner_id === this.currentPlayerId
    const position = armyPosition(army)
    const container = this.add.container(position.x, position.y)

    const shadow = this.add.circle(4, 5, 18, 0x000000, 0.28)
    const ring = this.add.circle(0, 0, 17, mine ? 0x4f78bd : 0xb95d53)
    const sword = this.add.text(0, -1, '⚔', {
      fontFamily: 'Segoe UI Symbol, sans-serif',
      fontSize: '22px',
      color: '#ffffff',
    }).setOrigin(0.5)
    const label = this.add
      .text(0, 29, mine ? `${army.name} (you)` : `${this.playerName(army.owner_id)} army`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#11170fcf',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)

    container.add([shadow, ring, sword, label])
    container.setDepth(mine ? 22 : 20)
    return container
  }

  private drawGrid(width: number, height: number) {
    const grid = this.add.graphics()
    grid.lineStyle(1, 0x8fa184, 0.12)

    for (let x = 0; x <= width; x += 50) grid.lineBetween(x, 0, x, height)
    for (let y = 0; y <= height; y += 50) grid.lineBetween(0, y, width, y)
  }

  private drawTerrain() {
    const terrain = this.add.graphics()

    terrain.fillStyle(0x263a2a, 0.85)
    terrain.fillCircle(170, 165, 115)
    terrain.fillCircle(260, 145, 90)
    terrain.fillCircle(910, 520, 135)

    terrain.fillStyle(0x79806f, 0.8)
    terrain.fillTriangle(615, 160, 675, 55, 735, 160)
    terrain.fillTriangle(680, 175, 755, 45, 820, 175)
    terrain.fillTriangle(760, 155, 820, 70, 875, 155)

    terrain.lineStyle(34, 0x516f84, 0.85)
    terrain.beginPath()
    terrain.moveTo(0, 560)
    terrain.lineTo(180, 525)
    terrain.lineTo(360, 545)
    terrain.lineTo(535, 505)
    terrain.lineTo(720, 535)
    terrain.lineTo(1100, 470)
    terrain.strokePath()
  }
}
