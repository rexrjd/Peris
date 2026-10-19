import type { Faction } from '../../../factions/domain/factions';
import type { BuildingType } from '../../domain/types';
import type { SlotType } from '../../domain/slots';
import type { CityEnvironment } from '../../domain/environment';
import type { CityPlot } from './layout';
import { createBuildingModel, visualLevel } from './buildingModels';
import { createSlotModel } from './slotModels';
import { createCityResource, isCityResource } from './resourceModels';
import { createEmptyCityPlot } from './cityDistricts';
import { createCityWalls } from './cityWalls';

/** Shared by the live city and its static selector portrait. */
export function createCityPlotModel(plot: CityPlot, main: number, faction: Faction, environment?: CityEnvironment, animated = false) {
    const level = plot.type === 'mage_tower' ? Math.max(0, Math.min(10, Math.round(plot.level))) : visualLevel(plot.level);
    return plot.slot !== undefined && !level ? createEmptyCityPlot(faction, plot.slot === 16)
        : isCityResource(plot.type) ? createCityResource(plot.type, level, faction, animated)
        : plot.slot !== undefined ? createSlotModel(plot.type as SlotType | null, level, faction, animated)
        : plot.type === 'wall' ? createCityWalls(level, main, faction, animated, environment)
        : createBuildingModel(plot.type as BuildingType, level, faction, animated);
}

export function positionCityPlotModel(model: ReturnType<typeof createCityPlotModel>, plot: CityPlot, growth: number) {
    model.position.set(plot.x, .015, plot.z);
    if (plot.type === 'wall') model.scale.set(growth, 1, growth);
    else if (plot.slot !== undefined) model.scale.set(.98, 1.12, .98);
    else if (plot.type === 'market') model.scale.set(1.2, 1.35, 1.2);
    else model.scale.set(1.05, 1.1, 1.05);
}
