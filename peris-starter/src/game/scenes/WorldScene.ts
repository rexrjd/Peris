import * as Phaser from 'phaser'

export class WorldScene extends Phaser.Scene {
  private army?: Phaser.GameObjects.Container

  constructor() {
    super('world')
  }

  create() {
    const width = 1100
    const height = 700

    const background = this.add.graphics()
    background.fillStyle(0x394735)
    background.fillRect(0, 0, width, height)

    this.drawGrid(width, height)
    this.drawTerrain()
    this.drawSettlement(250, 390, 'Greywatch', 0xd9c98f)
    this.drawSettlement(820, 260, 'Red Keep', 0xc87561)

    this.army = this.createArmy(355, 345)

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.army) return

      this.tweens.add({
        targets: this.army,
        x: pointer.worldX,
        y: pointer.worldY,
        duration: 700,
        ease: 'Sine.easeInOut',
      })
    })

    this.add
      .text(22, 20, 'Click the map to move your army', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#f0ead8',
        backgroundColor: '#11170fcf',
        padding: { x: 12, y: 8 },
      })
      .setDepth(20)
  }

  private drawGrid(width: number, height: number) {
    const grid = this.add.graphics()
    grid.lineStyle(1, 0x8fa184, 0.12)

    for (let x = 0; x <= width; x += 50) {
      grid.lineBetween(x, 0, x, height)
    }

    for (let y = 0; y <= height; y += 50) {
      grid.lineBetween(0, y, width, y)
    }
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

  private drawSettlement(x: number, y: number, name: string, color: number) {
    const marker = this.add.container(x, y)
    const ring = this.add.circle(0, 0, 34, 0x0f140e, 0.72)
    const keep = this.add.rectangle(0, 0, 34, 34, color)
    const label = this.add
      .text(0, 48, name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '17px',
        color: '#fff6df',
        backgroundColor: '#11170fcf',
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0.5)

    marker.add([ring, keep, label])
  }

  private createArmy(x: number, y: number) {
    const army = this.add.container(x, y)
    const shadow = this.add.circle(4, 5, 19, 0x000000, 0.3)
    const marker = this.add.circle(0, 0, 17, 0x4f78bd)
    const center = this.add.circle(0, 0, 7, 0xe4ecff)
    const label = this.add
      .text(0, -31, '1st Company', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
      })
      .setOrigin(0.5)

    army.add([shadow, marker, center, label])
    army.setDepth(10)
    return army
  }
}
