import type { BuildingType } from '../../features/city/domain/types';
import type { UnitType } from '../../features/army/domain/types';
import type { Battle, BattleOrder } from '../../features/battle/domain/types';
import type { World } from './world';
export type Command = {
    type: 'upgrade';
    item: BuildingType;
} | {
    type: 'recruit';
    item: UnitType;
    quantity: number;
} | {
    type: 'move';
    x: number;
    y: number;
    route?: [number, number][];
} | {
    type: 'raid';
    campId: number;
} | {
    type: 'ready';
    battleId: number;
} | {
    type: 'order';
    battleId: number;
    order: BattleOrder;
} | {
    type: 'retreat';
    battleId: number;
} | {
    type: 'rally';
    battleId: number;
} | {
    type: 'claim';
    questId: string;
} | {
    type: 'rename';
    name: string;
} | {
    type: 'challenge';
    ownerId: string;
} | {
    type: 'respond';
    id: number;
    accept: boolean;
};
export type LocalCommandContext = {
    world: World;
    playerId: string;
    nextId: () => number;
    active: Battle | undefined;
    now: string;
    paused: (value: boolean) => void;
    finalize: (id: number) => void;
};
