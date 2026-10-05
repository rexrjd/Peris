import { useEffect, useRef } from 'react'
import * as Phaser from 'phaser'
import { BattleScene, BATTLE_HEIGHT, BATTLE_WIDTH } from './scenes/BattleScene'
import type { BattleFormation, Player } from '../types/game'

type Props = {
  formations: BattleFormation[]
  players: Player[]
  currentPlayerId: string
  selectedFormationId: number | null
  onSelectFormation: (formationId: number) => void
  onMoveFormation: (formationId: number, x: number, y: number) => void
  onAttackFormation: (formationId: number, targetFormationId: number) => void
}

export function BattleCanvas({
  formations,
  players,
  currentPlayerId,
  selectedFormationId,
  onSelectFormation,
  onMoveFormation,
  onAttackFormation,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<BattleScene | null>(null)
  const selectRef = useRef(onSelectFormation)
  const moveRef = useRef(onMoveFormation)
  const attackRef = useRef(onAttackFormation)

  selectRef.current = onSelectFormation
  moveRef.current = onMoveFormation
  attackRef.current = onAttackFormation

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return

    const scene = new BattleScene(
      (formationId, x, y) => moveRef.current(formationId, x, y),
      (formationId, targetFormationId) => attackRef.current(formationId, targetFormationId),
      (formationId) => selectRef.current(formationId),
    )
    sceneRef.current = scene

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      backgroundColor: '#303a2b',
      width: BATTLE_WIDTH,
      height: BATTLE_HEIGHT,
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
    sceneRef.current?.setBattleState(formations, players, currentPlayerId, selectedFormationId)
  }, [formations, players, currentPlayerId, selectedFormationId])

  return <div ref={containerRef} className="battle-phaser-host" />
}
