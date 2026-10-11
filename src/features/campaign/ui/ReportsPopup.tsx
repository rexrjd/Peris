import type { ComponentProps } from 'react';
import { Modal } from '../../../shared/ui/Shared';
import { Chronicle } from './Chronicle';
import '../styles/reports-popup.css';

export function ReportsPopup({onClose,...props}: Omit<ComponentProps<typeof Chronicle>,'onReport'> & {onClose:()=>void}) {
    return <Modal title="Reports" heading={false} className="reports-popup" backdropClassName="reports-popup-backdrop" onClose={onClose}>
        <Chronicle {...props} onReport={()=>{}}/>
    </Modal>;
}
