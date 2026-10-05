import * as Phaser from 'phaser'
import type { BattleFormation, FormationType, Player } from '../../types/game'

export const BATTLE_WIDTH = 1200
export const BATTLE_HEIGHT = 700

type MoveHandler = (formationId: number, x: number, y: number) => void
type AttackHandler = (formationId: number, targetFormationId: number) => void
type SelectHandler = (formationId: number) => void

type BattleState = {
  formations: BattleFormation[]
  players: Player[]
}

type FormationMarker = {
  container: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Rectangle
  count: Phaser.GameObjects.Text
  morale: Phaser.GameObjects.Rectangle
  status: Phaser.GameObjects.Text
  selection: Phaser.GameObjects.Rectangle
  facingArrow: Phaser.GameObjects.Triangle
}

const TYPE_LABEL: Record<FormationType, string> = {
  infantry: 'INFANTRY',
  archers: 'ARCHERS',
  cavalry: 'CAVALRY',
}

function unitColor(type: FormationType, mine: boolean) {
  if (mine) {
    if (type === 'infantry') return 0x5f87c7
    if (type === 'archers') return 0x6ea46d
    return 0xb18b4f
  }
  if (type === 'infantry') return 0xb25e58
  if (type === 'archers') return 0xa46b75
  return 0x9b6b45
}

function widthForFormation(formation: BattleFormation) {
  const max = Math.max(1, formation.initial_soldiers)
  const ratio = Phaser.Math.Clamp(formation.soldiers / max, 0.25, 1)
  const base = formation.unit_type === 'cavalry' ? 78 : formation.unit_type === 'archers' ? 94 : 112
  return Math.max(52, base * ratio)
}

export class BattleScene extends Phaser.Scene {
  private markers = new Map<number, FormationMarker>()
  private state: BattleState = { formations: [], players: [] }
  private currentPlayerId = ''
  private selectedFormationId: number | null = null
  private onMove: MoveHandler
  private onAttack: AttackHandler
  private onSelect: SelectHandler
  private orderGraphics?: Phaser.GameObjects.Graphics
  private instruction?: Phaser.GameObjects.Text

  constructor(onMove: MoveHandler, onAttack: AttackHandler, onSelect: SelectHandler) {
    super('battle')
    this.onMove = onMove
    this.onAttack = onAttack
    this.onSelect = onSelect
  }

  create() {
    this.cameras.main.setBackgroundColor('#303a2b')
    this.input.mouse?.disableContextMenu()
    this.drawTerrain()
    this.orderGraphics = this.add.graphics().setDepth(12)

    this.instruction = this.add
      .text(20, 18, 'LEFT CLICK your formation · RIGHT CLICK ground to move · RIGHT CLICK enemy to attack', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#f2ead9',
        backgroundColor: '#10140fe8',
        padding: { x: 10, y: 7 },
      })
      .setDepth(100)

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.rightButtonDown() || this.selectedFormationId === null) return
      // Interactive formation markers handle their own right-clicks. If the pointer is
      // over one, do not also interpret the same click as a ground-move order.
      if (this.input.hitTestPointer(pointer).length > 0) return
      const x = Phaser.Math.Clamp(Math.round(pointer.worldX), 55, BATTLE_WIDTH - 55)
      const y = Phaser.Math.Clamp(Math.round(pointer.worldY), 60, BATTLE_HEIGHT - 60)
      this.onMove(this.selectedFormationId, x, y)
    })

    this.render()
  }

  setBattleState(
    formations: BattleFormation[],
    players: Player[],
    currentPlayerId: string,
    selectedFormationId: number | null,
  ) {
    this.state = { formations, players }
    this.currentPlayerId = currentPlayerId
    this.selectedFormationId = selectedFormationId
    if (this.sys.isActive()) this.render()
  }

  private render() {
    this.renderFormations()
    this.renderOrders()
  }

  private renderFormations() {
    const alive = new Set(this.state.formations.map((formation) => formation.id))

    for (const [id, marker] of this.markers) {
      if (!alive.has(id)) {
        marker.container.destroy(true)
        this.markers.delete(id)
      }
    }

    for (const formation of this.state.formations) {
      let marker = this.markers.get(formation.id)
      if (!marker) {
        marker = this.createFormationMarker(formation)
        this.markers.set(formation.id, marker)
      }

      const selected = formation.id === this.selectedFormationId
      const routed = formation.status === 'routed' || formation.soldiers <= 0
      marker.selection.setVisible(selected)
      marker.body.setFillStyle(routed ? 0x4c4c48 : unitColor(formation.unit_type, formation.owner_id === this.currentPlayerId), routed ? 0.55 : 0.95)
      marker.body.width = widthForFormation(formation)
      marker.count.setText(`${formation.soldiers}`)
      marker.status.setText(routed ? 'ROUTED' : formation.status.toUpperCase())
      marker.status.setColor(routed ? '#d18a80' : formation.status === 'engaged' ? '#f0c36b' : '#c8d1c3')
      marker.morale.width = Math.max(0, 62 * Phaser.Math.Clamp(Number(formation.morale) / 100, 0, 1))
      marker.morale.setFillStyle(Number(formation.morale) < 30 ? 0xb75a51 : Number(formation.morale) < 60 ? 0xc59b48 : 0x6fa06b)
      const facingRadians = Phaser.Math.DegToRad(Number(formation.facing ?? 0))
      marker.facingArrow.setPosition(Math.cos(facingRadians) * 66, Math.sin(facingRadians) * 66)
      marker.facingArrow.setRotation(facingRadians)
      marker.facingArrow.setFillStyle(formation.charge_ready ? 0xf3c860 : formation.owner_id === this.currentPlayerId ? 0xbcd6ff : 0xf0b9b1, 0.95)

      const distance = Phaser.Math.Distance.Between(marker.container.x, marker.container.y, Number(formation.x), Number(formation.y))
      if (distance > 2) {
        this.tweens.killTweensOf(marker.container)
        this.tweens.add({
          targets: marker.container,
          x: Number(formation.x),
          y: Number(formation.y),
          duration: 520,
          ease: 'Linear',
        })
      } else {
        marker.container.setPosition(Number(formation.x), Number(formation.y))
      }
    }
  }

  private renderOrders() {
    if (!this.orderGraphics) return
    this.orderGraphics.clear()

    for (const formation of this.state.formations) {
      if (formation.owner_id !== this.currentPlayerId || formation.status === 'routed' || formation.soldiers <= 0) continue

      if (formation.id === this.selectedFormationId) {
        this.orderGraphics.lineStyle(2, 0xf1d77d, 0.85)
        this.orderGraphics.strokeCircle(Number(formation.x), Number(formation.y), 42)
      }

      if (formation.target_formation_id) {
        const target = this.state.formations.find((item) => item.id === formation.target_formation_id)
        if (target) {
          this.orderGraphics.lineStyle(2, 0xd9685f, 0.65)
          this.orderGraphics.lineBetween(Number(formation.x), Number(formation.y), Number(target.x), Number(target.y))
        }
      } else if (formation.status === 'moving') {
        this.orderGraphics.lineStyle(2, 0xe0c66f, 0.55)
        this.orderGraphics.lineBetween(Number(formation.x), Number(formation.y), Number(formation.target_x), Number(formation.target_y))
        this.orderGraphics.strokeCircle(Number(formation.target_x), Number(formation.target_y), 10)
      }
    }
  }

  private createFormationMarker(formation: BattleFormation): FormationMarker {
    const mine = formation.owner_id === this.currentPlayerId
    const container = this.add.container(Number(formation.x), Number(formation.y)).setDepth(30)
    const selection = this.add.rectangle(0, 0, 136, 78).setStrokeStyle(3, 0xf1d77d, 1).setVisible(false)
    const shadow = this.add.ellipse(3, 17, 118, 32, 0x000000, 0.24)
    const body = this.add.rectangle(0, 0, widthForFormation(formation), 42, unitColor(formation.unit_type, mine), 0.95)
    body.setStrokeStyle(2, mine ? 0xcbdcff : 0xf0cac5, 0.9)

    const soldierDots: Phaser.GameObjects.Arc[] = []
    const rows = formation.unit_type === 'cavalry' ? 2 : 3
    const cols = formation.unit_type === 'archers' ? 7 : 6
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const dot = this.add.circle((col - (cols - 1) / 2) * 11, (row - (rows - 1) / 2) * 10, formation.unit_type === 'cavalry' ? 4 : 3, 0xf3eee0, 0.82)
        soldierDots.push(dot)
      }
    }

    const label = this.add.text(0, -34, TYPE_LABEL[formation.unit_type], {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      color: mine ? '#dce9ff' : '#ffd9d5',
      backgroundColor: '#11150fdc',
      padding: { x: 5, y: 2 },
    }).setOrigin(0.5)

    const count = this.add.text(0, 1, `${formation.soldiers}`, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#0e110d',
    }).setOrigin(0.5)

    const moraleBack = this.add.rectangle(-31, 31, 62, 5, 0x1a1d18, 1).setOrigin(0, 0.5)
    const morale = this.add.rectangle(-31, 31, 62, 5, 0x6fa06b, 1).setOrigin(0, 0.5)
    const facingArrow = this.add.triangle(0, 0, -7, -5, 8, 0, -7, 5, 0xf1d77d, 0.95)

    const status = this.add.text(0, 43, formation.status.toUpperCase(), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '8px',
      color: '#c8d1c3',
    }).setOrigin(0.5)

    container.add([selection, shadow, body, ...soldierDots, label, count, moraleBack, morale, facingArrow, status])
    container.setSize(140, 88)
    container.setInteractive(new Phaser.Geom.Rectangle(-70, -44, 140, 88), Phaser.Geom.Rectangle.Contains)

    container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (formation.owner_id === this.currentPlayerId) {
        if (pointer.leftButtonDown()) this.onSelect(formation.id)
        return
      }

      if (pointer.rightButtonDown() && this.selectedFormationId !== null && formation.status !== 'routed' && formation.soldiers > 0) {
        this.onAttack(this.selectedFormationId, formation.id)
      }
    })

    return { container, body, count, morale, status, selection, facingArrow }
  }

  private drawTerrain() {
    const g = this.add.graphics().setDepth(1)
    g.fillStyle(0x43513b)
    g.fillRect(0, 0, BATTLE_WIDTH, BATTLE_HEIGHT)

    // broad grass variation
    g.fillStyle(0x3a4936, 0.75)
    g.fillEllipse(240, 180, 360, 190)
    g.fillEllipse(955, 520, 420, 220)
    g.fillStyle(0x4a583f, 0.7)
    g.fillEllipse(650, 170, 340, 150)

    // low ridge through the centre
    g.fillStyle(0x5d624d, 0.75)
    g.fillTriangle(510, 350, 610, 270, 705, 350)
    g.fillTriangle(610, 360, 715, 290, 825, 360)
    g.lineStyle(2, 0x8a8e76, 0.35)
    g.lineBetween(500, 355, 835, 365)

    // scattered woods
    const woods = [[105, 105], [145, 125], [1090, 125], [1055, 155], [905, 620], [955, 605]] as const
    for (const [x, y] of woods) {
      g.fillStyle(0x213426, 0.95)
      g.fillCircle(x, y, 27)
      g.fillCircle(x + 18, y - 9, 24)
    }

    // dusty deployment lanes
    g.fillStyle(0xb69b6b, 0.08)
    g.fillRect(85, 160, 260, 400)
    g.fillRect(855, 160, 260, 400)

    // centre line and battlefield bounds
    g.lineStyle(2, 0xd8c88b, 0.12)
    g.lineBetween(BATTLE_WIDTH / 2, 65, BATTLE_WIDTH / 2, BATTLE_HEIGHT - 55)
    g.lineStyle(2, 0x242a21, 0.7)
    g.strokeRect(12, 12, BATTLE_WIDTH - 24, BATTLE_HEIGHT - 24)

    this.add.text(115, 655, 'ATTACKER DEPLOYMENT', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      color: '#c7d6ed',
    }).setDepth(2)
    this.add.text(1085, 655, 'DEFENDER DEPLOYMENT', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      color: '#eccac6',
    }).setOrigin(1, 0).setDepth(2)
  }
}
