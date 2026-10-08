import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { BuildingPicker } from '../src/features/city/ui/BuildingPicker';
import { CityOverview } from '../src/features/city/ui/CityOverview';
import { SettlementView } from '../src/features/city/ui/SettlementView';

// The Node test runner uses the classic JSX transform; Vite uses react-jsx.
(globalThis as any).React = React;
const resources = { wood: 5000, stone: 5000, food: 5000, gold: 5000 };
const picker = (props: Partial<React.ComponentProps<typeof BuildingPicker>> = {}) =>
  renderToStaticMarkup(React.createElement(BuildingPicker, {
    slot: 2, resources, hasTower: false, busy: false, building: false, run: () => {}, ...props,
  }));

test('plot picker offers city buildings, excludes the outside fishery, and exposes one build action', () => {
  const html = picker();
  assert.equal((html.match(/type="radio"/g) ?? []).length, 7);
  assert.ok(html.includes('value="mage_tower"'));
  assert.ok(!html.includes('value="fishery"'));
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.ok(html.includes('Build Housing'));
  assert.ok(!html.includes('disabled=""'));
});

test('plot picker explains why construction cannot start', () => {
  for (const [props, reason] of [
    [{ busy: true }, 'Issuing orders…'],
    [{ building: true }, 'Builders are working'],
    [{ resources: { wood: 0, stone: 0, food: 0, gold: 0 } }, 'More supplies needed'],
  ] as const) {
    const html = picker(props);
    assert.ok(html.includes(reason));
    assert.ok(html.includes('disabled=""'));
  }
});

test('economy details start collapsed while live population and food remain visible', () => {
  const world = createSolo('Builder'), town = world.settlements[0];
  const html = renderToStaticMarkup(React.createElement(CityOverview, { world, sid: town.id, now: Date.parse(world.server_now), onSelect: () => {} }));
  const disclosure = html.match(/<details class="city-economy-details"[^>]*>/)?.[0];
  assert.ok(disclosure && !disclosure.includes('open'));
  const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'));
  for (const text of ['Residents', 'Staffing', 'Food / min', 'Economy details']) assert.ok(summary.includes(text));
  assert.ok(html.includes('Workers and production details'));
});

test('city opens on the scene, with secondary tools collapsed and upgrade action available', () => {
  const world = createSolo('Builder');
  const html = renderToStaticMarkup(React.createElement(SettlementView, { world, playerId: world.players[0].id, now: Date.parse(world.server_now), busy: false, run: () => {} }));
  assert.ok(html.includes('Low-poly city with selectable plots'));
  assert.ok(!html.includes('class="building-browser"'));
  assert.ok(html.includes('Construct building'));
  assert.ok(/<details class="city-tools">/.test(html));
  assert.ok(html.includes('City settings &amp; debug'));
});
