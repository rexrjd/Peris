import type { ComponentProps } from 'react';
import { Modal } from '../../../shared/ui/Shared';
import { Chronicle } from './Chronicle';
import type {Faction} from '../../factions/domain/factions';
import {rallyFactionStyle} from '../../army/ui/rallyFactionTheme';
import '../styles/reports-popup.css';

export function ReportsPopup({onClose,faction,...props}: Omit<ComponentProps<typeof Chronicle>,'onReport'> & {onClose:()=>void;faction:Faction}) {
    return <div className="realm-presentation scene-theme reports-scene" data-scene-faction={faction} style={rallyFactionStyle(faction)}><Modal title="Reports" heading={false} className="reports-popup" backdropClassName="reports-popup-backdrop" onClose={onClose}>
        <Chronicle {...props} onReport={()=>{}}/>
    </Modal></div>;
}
