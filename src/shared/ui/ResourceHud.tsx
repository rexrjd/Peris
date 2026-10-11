import type { Resources } from '../model/resources';
import { RESOURCES } from '../model/resources';
import { LowPolyIcon } from './LowPolyIcon';

export function compactResource(stock: number) {
  const value = Math.max(0, Math.floor(stock));
  if (value < 1000) return String(value);
  const scale = value >= 1e6 ? 1e6 : 1000;
  return `${Math.floor(value / scale * 10) / 10}${scale === 1e6 ? 'm' : 'k'}`;
}

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
        <LowPolyIcon name={resource}/><strong className="hud-stock">{compactResource(stock)}</strong>
        {(full || shortage) && <i className="hud-stock-alert" aria-hidden="true"/>}
      </button>;
    })}
  </div>;
}
