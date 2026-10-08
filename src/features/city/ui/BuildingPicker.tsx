import { useState } from 'react';
import type { Resources } from '../../../shared/model/resources';
import type { Command } from '../../../shared/model/commands';
import { Cost } from '../../../shared/ui/Shared';
import { affordable } from '../domain/economy';
import { SLOT_BUILDINGS, slotCost, type SlotType } from '../domain/slots';

export function BuildingPicker({ slot, resources, hasTower, busy, building, run }: {
  slot: number; resources: Resources; hasTower: boolean; busy: boolean; building: boolean;
  run: (command: Command, message?: string) => void;
}) {
  const [choice, setChoice] = useState<SlotType>('housing');
  const item = SLOT_BUILDINGS[choice], cost = slotCost(choice, 0);
  const reason = choice === 'mage_tower' && hasTower ? 'One mage tower per city'
    : building ? 'Builders are working' : busy ? 'Issuing orders…'
    : !affordable(resources, cost) ? 'More supplies needed' : null;
  return <div className="building-picker">
    <fieldset><legend>Choose a building</legend><div className="building-options">
      {(Object.entries(SLOT_BUILDINGS) as [SlotType, typeof item][]).filter(([key]) => key !== 'fishery').map(([key, option]) =>
        <label key={key} className={choice === key ? 'chosen' : ''}>
          <input type="radio" name={`plot-${slot}-building`} value={key} checked={choice === key} onChange={() => setChoice(key)}/>
          <span>{option.name}<small>{key === 'mage_tower' ? hasTower ? 'Already built' : 'Unique · 10 levels' : 'Repeatable · 5 levels'}</small></span>
        </label>)}
    </div></fieldset>
    <div className="building-preview"><h3>{item.name}</h3><p>{item.description}</p><div className="benefit">{item.effect}</div>
      <label className="field-label">Construction cost</label><Cost cost={cost} resources={resources}/>
      <button className="button gold" disabled={!!reason} onClick={() => run({ type: 'buildSlot', slot, item: choice }, `${item.name} construction started`)}>{reason ?? `Build ${item.name}`}</button>
    </div>
  </div>;
}
