import { RESOURCES, type Resources as ResourceBag } from '../../../shared/model/resources';
import { Icon } from '../../../shared/ui/Icons';
import { number } from './format';

export function Resources({ values, signed = false }: { values: ResourceBag; signed?: boolean }) {
    return <span className="fw-resource-inline">{RESOURCES.map(key => <span key={key} title={key}>
        <Icon name={key} size={15} /><span className="fw-sr-only">{key}: </span>
        {signed && values[key] > 0 ? '+' : ''}{number(values[key])}
    </span>)}</span>;
}
