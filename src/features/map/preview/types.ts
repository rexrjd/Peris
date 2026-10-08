/** Isolated map design sample; these types never mutate campaign or online state. */
export type PreviewRace = 'human' | 'elf' | 'dwarf' | 'orc' | 'peri';
export type PreviewTerrain = 'grassland' | 'forest' | 'mountain' | 'desert' | 'marsh' | 'snow' | 'water' | 'ruins';
export type PreviewResource = 'wood' | 'iron' | 'clay' | 'wheat';
export type PreviewBuilding = 'farm' | 'lumber-mill' | 'iron-mine' | 'clay-pit';
export interface PreviewCell { col: number; row: number; terrain: PreviewTerrain; height: number }
export interface PreviewVillage { id: string; name: string; race: PreviewRace; col: number; row: number; population: number; player: boolean }
export interface PreviewPlot { col: number; row: number; villageId: string; building: PreviewBuilding | null; level: number; queue: { targetLevel: number; endsAt: number } | null }
export type PreviewStock = Record<PreviewResource, number>;
export interface PreviewState { version: 1; seed: number; playerVillageId: string; villages: PreviewVillage[]; plots: Record<string, PreviewPlot>; stock: PreviewStock; lastTick: number }
export interface PreviewSceneActions { select: (col: number, row: number) => void; viewChanged?: () => void; error?: (message: string) => void }
export interface PreviewSceneState { state: PreviewState; selection: { col: number; row: number } | null; grid: boolean; claimMode: boolean }
