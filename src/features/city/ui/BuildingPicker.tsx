import { useState } from 'react';
import type { Resources } from '../../../shared/model/resources';
import type { Command } from '../../../shared/model/commands';
import { Cost } from '../../../shared/ui/Shared';
import { affordable } from '../domain/economy';
import { SLOT_BUILDINGS, slotCost, type SlotType } from '../domain/slots';

export function buildingChoiceReason(choice: SlotType, resources: Resources, hasTower: boolean, hasBarracks: boolean, busy: boolean, building: boolean) {
  return choice === 'mage_tower' && hasTower ? 'One mage tower per city'
    : choice === 'barracks' && hasBarracks ? 'One barracks per city'
    : building ? 'Builders are working' : busy ? 'Issuing orders…'
    : !affordable(resources, slotCost(choice, 0)) ? 'More supplies needed' : null;
}

export function BuildingChoices({ slot, choice, onChange, hasTower, hasBarracks }: { slot: number; choice: SlotType; onChange: (type: SlotType) => void; hasTower: boolean; hasBarracks: boolean }) {
  return <fieldset><legend>Choose a building</legend><div className="building-options">
    {(Object.entries(SLOT_BUILDINGS) as [SlotType, typeof SLOT_BUILDINGS[SlotType]][]).filter(([key]) => key !== 'fishery').map(([key, option]) =>
      <label key={key} className={choice === key ? 'chosen' : ''}>
        <input type="radio" name={`plot-${slot}-building`} value={key} checked={choice === key} onChange={() => onChange(key)}/>
        <span>{option.name}<small>{key === 'mage_tower' ? hasTower ? 'Already built' : 'Unique · 10 levels' : key === 'barracks' ? hasBarracks ? 'Already built' : 'Unique · 5 levels' : 'Repeatable · 5 levels'}</small></span>
      </label>)}
  </div></fieldset>;
}

export function BuildingPicker({ slot, resources, hasTower, hasBarracks = false, busy, building, run, initialChoice = 'housing' }: {
  slot: number; resources: Resources; hasTower: boolean; hasBarracks?: boolean; busy: boolean; building: boolean;
  run: (command: Command, message?: string) => void;
  initialChoice?: SlotType;
}) {
  const [choice, setChoice] = useState<SlotType>(initialChoice);
  const item = SLOT_BUILDINGS[choice], cost = slotCost(choice, 0);
  const reason = buildingChoiceReason(choice, resources, hasTower, hasBarracks, busy, building);
  return <div className="building-picker">
    <BuildingChoices slot={slot} choice={choice} onChange={setChoice} hasTower={hasTower} hasBarracks={hasBarracks}/>
    <div className="building-preview"><h3>{item.name}</h3><p>{item.description}</p><div className="benefit">{item.effect}</div>
      <label className="field-label">Construction cost</label><Cost cost={cost} resources={resources}/>
      <button className="button gold" disabled={!!reason} onClick={() => run({ type: 'buildSlot', slot, item: choice }, `${item.name} construction started`)}>{reason ?? `Build ${item.name}`}</button>
    </div>
  </div>;
}
