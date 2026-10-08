import type { Resources } from '../model/resources';
import { RESOURCES } from '../model/resources';
import { Icon } from './Icons';

export function ResourceHud({ resources, capacity, rate, onSelect }: {
  resources: Resources;
  capacity: (resource: typeof RESOURCES[number]) => number;
  rate: (resource: typeof RESOURCES[number]) => string;
  onSelect: (resource: typeof RESOURCES[number]) => void;
}) {
  return <div className="resource-strip resource-hud" aria-label="City resources">
    {RESOURCES.map(resource => {
      const stock = Math.floor(resources[resource]), limit = capacity(resource);
      const full = stock >= limit, income = rate(resource), shortage = income.startsWith('-');
      const name = resource === 'wood' ? 'Timber' : resource[0].toUpperCase() + resource.slice(1);
      const detail = `${name}: ${stock.toLocaleString()} of ${limit.toLocaleString()} stored${full ? ', storage full' : ''}; ${income} per minute. Open supplies.`;
      return <button key={resource} className={`resource resource-${resource}${full ? ' full' : ''}${shortage ? ' shortage' : ''}`} title={detail} aria-label={detail} onClick={() => onSelect(resource)}>
        <span className="resource-symbol" aria-hidden="true"><Icon name={resource} size={26}/></span>
        <span className="resource-readout">
          <span className="resource-caption"><span>{name}</span><span className="resource-income">{income}/m</span></span>
          <span className="resource-amount"><strong>{stock.toLocaleString()}</strong><span>/ {limit.toLocaleString()}</span></span>
          <span className="resource-capacity" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, stock / Math.max(1, limit) * 100))}%` }}/></span>
        </span>
      </button>;
    })}
  </div>;
}
