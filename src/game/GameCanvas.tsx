import { useEffect, useRef } from 'react'
import * as Phaser from 'phaser'
import { WorldScene } from './scenes/WorldScene'
import type { Army, Player, Settlement } from '../types/game'

type Props = {
  players: Player[]
  settlements: Settlement[]
  armies: Army[]
  currentPlayerId: string
  onMoveArmy: (x: number, y: number) => void
}

export function GameCanvas({ players, settlements, armies, currentPlayerId, onMoveArmy }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<WorldScene | null>(null)
  const moveRef = useRef(onMoveArmy)

  moveRef.current = onMoveArmy

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return

    const scene = new WorldScene((x, y) => moveRef.current(x, y))
    sceneRef.current = scene

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      backgroundColor: '#273124',
      width: 1100,
      height: 700,
      scene: [scene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    })

    return () => {
      gameRef.current?.destroy(true)
      gameRef.current = null
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setWorldState(players, settlements, armies, currentPlayerId)
  }, [players, settlements, armies, currentPlayerId])

  return <div ref={containerRef} className="phaser-host" />
}
