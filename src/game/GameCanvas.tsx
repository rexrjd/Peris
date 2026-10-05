import { useEffect, useRef } from 'react'
import * as Phaser from 'phaser'
import { WorldScene, WORLD_HEIGHT, WORLD_WIDTH } from './scenes/WorldScene'
import type { Army, Player, Settlement } from '../types/game'

type Props = {
  players: Player[]
  settlements: Settlement[]
  armies: Army[]
  currentPlayerId: string
  moveMode: boolean
  onMoveArmy: (x: number, y: number) => void
}

export function GameCanvas({
  players,
  settlements,
  armies,
  currentPlayerId,
  moveMode,
  onMoveArmy,
}: Props) {
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
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      scene: [scene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: true,
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

  useEffect(() => {
    sceneRef.current?.setCommandMode(moveMode)
  }, [moveMode])

  return <div ref={containerRef} className="phaser-host" />
}
