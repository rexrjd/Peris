import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameNavigation, type GameView } from '../src/shared/ui/GameNavigation';
import { CityOverview } from '../src/features/city/ui/CityOverview';
import { SettlementView } from '../src/features/city/ui/SettlementView';
import { createSolo } from '../src/features/campaign/domain/newRealm';

(globalThis as any).React = React;

test('horizontal navigation exposes all destinations and exactly one current page', () => {
  for (const view of ['world', 'settlement', 'army', 'chronicle'] as GameView[]) {
    const html = renderToStaticMarkup(React.createElement(GameNavigation, { view, rewards: false, onNavigate: () => {} }));
    assert.equal((html.match(/<button/g) ?? []).length, 4);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    for (const label of ['Map', 'City', 'Army', 'Reports']) assert.ok(html.includes(label));
    assert.ok(!html.includes('side-rail'));
  }
});

test('uncollected rewards have a labeled report indicator', () => {
  const render = (rewards: boolean) => renderToStaticMarkup(React.createElement(GameNavigation, { view: 'world', rewards, onNavigate: () => {} }));
  assert.ok(render(true).includes('Rewards available'));
  assert.ok(!render(false).includes('Rewards available'));
});

test('compact economy signals a negative food balance without opening its details', () => {
  const world = createSolo('Builder'), town = world.settlements[0];
  town.population = town.population_capacity = 1000;
  const html = renderToStaticMarkup(React.createElement(CityOverview, { world, sid: town.id, now: Date.parse(world.server_now), compact: true, onSelect: () => {} }));
  const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'));
  assert.ok(summary.includes('Food declining'));
  assert.ok(summary.includes('economy-warning'));
});

test('city construction remains visible in the dock with its inspector closed', () => {
  const world = createSolo('Builder'), now = Date.parse(world.server_now);
  world.orders.push({ id: 123, owner_id: world.players[0].id, settlement_id: world.settlements[0].id, kind: 'upgrade', item: 'market', quantity: 1, started_at: world.server_now, finish_at: new Date(now + 60000).toISOString() });
  const html = renderToStaticMarkup(React.createElement(SettlementView, { world, playerId: world.players[0].id, now, busy: false, run: () => {} }));
  assert.ok(html.includes('city-dock-queue'));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('1:00'));
  assert.ok(!html.includes('city-inspector'));
});
