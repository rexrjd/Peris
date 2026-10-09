import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceHud } from '../src/shared/ui/ResourceHud';
import { CityOverview } from '../src/features/city/ui/CityOverview';
import { SettlementView } from '../src/features/city/ui/SettlementView';
import { createSolo } from '../src/features/campaign/domain/newRealm';

(globalThis as any).React = React;

test('resource HUD exposes individual storage limits, rates and full-storage state', () => {
  const html = renderToStaticMarkup(React.createElement(ResourceHud, {
    resources: { wood: 5000, stone: 2500, food: 3500, gold: 100 },
    capacity: resource => resource === 'food' ? 10000 : 5000,
    rate: resource => resource === 'food' ? '-12.5' : '+14', onSelect: () => {},
  }));
  assert.equal((html.match(/<button/g) ?? []).length, 4);
  assert.ok(html.includes('Timber: 5,000 of 5,000 stored, storage full'));
  assert.ok(html.includes('Food: 3,500 of 10,000 stored; -12.5 per minute'));
  assert.ok(html.includes('resource-food shortage'));
  for (const width of ['100%', '50%', '35%', '2%']) assert.ok(html.includes(`width:${width}`));
});

test('resource storage bars clamp overflow instead of extending out of the HUD', () => {
  const html = renderToStaticMarkup(React.createElement(ResourceHud, {
    resources: { wood: 8000, stone: 0, food: 100, gold: 0 },
    capacity: () => 5000, rate: () => '+1', onSelect: () => {},
  }));
  assert.ok(html.includes('width:100%'));
  assert.ok(html.includes('width:0%'));
  assert.ok(!html.includes('width:160%'));
});

test('compact city summary avoids repeating food income while retaining its detailed breakdown', () => {
  const world = createSolo('Builder');
  const html = renderToStaticMarkup(React.createElement(CityOverview, {
    world, sid: world.settlements[0].id, now: Date.parse(world.server_now), compact: true, onSelect: () => {},
  }));
  const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'));
  assert.ok(summary.includes('Residents'));
  assert.ok(summary.includes('Staffing'));
  assert.ok(summary.includes('Economy'));
  assert.ok(!summary.includes('Food / min'));
  assert.ok(html.includes('FOOD BALANCE'));
});

test('city keeps identity and economy above the scene, with view/build controls in the dock', () => {
  const world = createSolo('Builder');
  const html = renderToStaticMarkup(React.createElement(SettlementView, {
    world, playerId: world.players[0].id, now: Date.parse(world.server_now), busy: false, run: () => {},
  }));
  const toolbar = html.slice(html.indexOf('<header class="city-toolbar">'), html.indexOf('</header>'));
  assert.ok(toolbar.includes('city-identity'));
  assert.ok(!toolbar.includes('city-view-switch'));
  assert.ok(html.includes('city-action-dock'));
  assert.ok(html.includes('city-view-switch'));
  assert.ok(toolbar.includes('city-overview-compact'));
  assert.ok(!toolbar.includes('city-build-button'));
  assert.ok(html.includes('city-build-button'));
  assert.ok(!html.includes('city-workspace-tabs'));
  assert.ok(!html.includes('view-heading city-heading'));
  assert.ok(html.indexOf('</header>') < html.indexOf('city-3d-scene'));
});
