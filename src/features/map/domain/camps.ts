import { type Camp } from './types';
export const CAMPS: Camp[] = [
    { id: 1, name: 'The broken standard', x: 305, y: 405, tier: 1, terrain: 'plains', infantry: 48, archers: 18, cavalry: 0, description: 'Deserters have claimed the old crossroads. An ideal first campaign.' },
    { id: 2, name: 'Oakwood raiders', x: 460, y: 155, tier: 2, terrain: 'woods', infantry: 90, archers: 45, cavalry: 12, description: 'Bowmen hide beneath dense oak cover. Keep your cavalry out of the trees.' },
    { id: 3, name: 'The river watch', x: 655, y: 485, tier: 2, terrain: 'river', infantry: 100, archers: 40, cavalry: 15, description: 'A fortified crossing. The shallows slow troops; use the stone bridge.' },
    { id: 4, name: 'Highland warband', x: 790, y: 160, tier: 3, terrain: 'highlands', infantry: 160, archers: 70, cavalry: 24, description: 'Veteran spearmen defend the ridge. High ground favours their archers.' },
    { id: 5, name: 'Ashen legion', x: 910, y: 550, tier: 4, terrain: 'plains', infantry: 240, archers: 110, cavalry: 55, description: 'A rebel legion controls the eastern road. You will need a larger host.' },
    { id: 6, name: 'The fallen capital', x: 605, y: 280, tier: 5, terrain: 'highlands', infantry: 340, archers: 160, cavalry: 80, description: 'Break the last great host and restore the lost province of Peris.' },
];
