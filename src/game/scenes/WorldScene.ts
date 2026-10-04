import * as Phaser from 'phaser'
import type { Player } from '../../types/game'

type MoveHandler = (x: number, y: number) => void

export class WorldScene extends Phaser.Scene {
  private playerMarkers = new Map<string, Phaser.GameObjects.Container>()
  private currentPlayerId = ''
  private pendingPlayers: Player[] = []
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
      .text(22, 20, 'Click the map to move your player', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#f0ead8',
        backgroundColor: '#11170fcf',
        padding: { x: 12, y: 8 },
      })
      .setDepth(20)

    this.renderPlayers()
  }

  setPlayers(players: Player[], currentPlayerId: string) {
    this.pendingPlayers = players
    this.currentPlayerId = currentPlayerId
    if (this.sys.isActive()) this.renderPlayers()
  }

  private renderPlayers() {
    const alive = new Set(this.pendingPlayers.map((player) => player.id))

    for (const [id, marker] of this.playerMarkers) {
      if (!alive.has(id)) {
        marker.destroy(true)
        this.playerMarkers.delete(id)
      }
    }

    for (const player of this.pendingPlayers) {
      let marker = this.playerMarkers.get(player.id)
      if (!marker) {
        marker = this.createPlayerMarker(player)
        this.playerMarkers.set(player.id, marker)
      }

      this.tweens.killTweensOf(marker)
      this.tweens.add({
        targets: marker,
        x: player.x,
        y: player.y,
        duration: 350,
        ease: 'Sine.easeOut',
      })
    }
  }

  private createPlayerMarker(player: Player) {
    const mine = player.id === this.currentPlayerId
    const container = this.add.container(player.x, player.y)
    const shadow = this.add.circle(4, 5, 22, 0x000000, 0.3)
    const ring = this.add.circle(0, 0, 20, mine ? 0x4f78bd : 0xb95d53)
    const center = this.add.circle(0, 0, 8, mine ? 0xe4ecff : 0xffe5df)
    const label = this.add
      .text(0, -36, mine ? `${player.display_name} (you)` : player.display_name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor: '#11170fcf',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)

    container.add([shadow, ring, center, label])
    container.setDepth(mine ? 12 : 10)
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
