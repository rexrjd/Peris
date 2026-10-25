import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameNavigation, type GameView } from '../src/shared/ui/GameNavigation';
import { CityOverview } from '../src/features/city/ui/CityOverview';
import { SettlementView } from '../src/features/city/ui/SettlementView';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { TroopSummary } from '../src/features/army/ui/TroopSummary';

(globalThis as any).React = React;

test('legacy online camps with null culture still show their troop names and pictures', () => {
  const html = renderToStaticMarkup(React.createElement(TroopSummary, {troops:{infantry:12,archers:0,cavalry:0},faction:null}));
  assert.ok(html.includes('12'));
  assert.ok(html.includes('/art/battle/roster/roman.png'));
});

test('horizontal navigation exposes all destinations and exactly one current page', () => {
  for (const view of ['world', 'settlement', 'rally', 'army', 'research', 'rankings', 'chronicle'] as GameView[]) {
    const html = renderToStaticMarkup(React.createElement(GameNavigation, { view, rewards: false, onNavigate: () => {} }));
    assert.equal((html.match(/<button/g) ?? []).length, 7);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    for (const label of ['Map', 'City', 'Rally Point', 'Armies', 'Research', 'Rankings', 'Reports']) assert.ok(html.includes(label));
    assert.ok(!html.includes('side-rail'));
  }
});

test('only unread reports highlight navigation, even when rewards are available', () => {
  const render = (unreadReports: number) => renderToStaticMarkup(React.createElement(GameNavigation, { view: 'world', rewards: true, unreadReports, onNavigate: () => {} }));
  assert.ok(!render(0).includes('has-unread'));
  assert.ok(!render(0).includes('Rewards available'));
  assert.equal((render(2).match(/class="has-unread"/g) ?? []).length, 1);
  assert.ok(render(2).includes('Reports, 2 unread'));
  for (const name of ['map', 'city', 'army', 'rally', 'reports']) assert.ok(render(0).includes(`/art/ui/low-poly-v1/${name}.webp`));
});

test('compact economy signals a negative food balance without opening its details', () => {
  const world = createSolo('Builder'), town = world.settlements[0];
  town.population = town.population_capacity = 1000;
  const html = renderToStaticMarkup(React.createElement(CityOverview, { world, sid: town.id, now: Date.parse(world.server_now), compact: true, onSelect: () => {} }));
  assert.ok(html.includes('Food declining'));
  assert.ok(html.includes('has-shortage'));
});

test('city construction remains visible in the village summary with its popup closed', () => {
  const world = createSolo('Builder'), now = Date.parse(world.server_now);
  world.orders.push({ id: 123, owner_id: world.players[0].id, settlement_id: world.settlements[0].id, kind: 'upgrade', item: 'market', quantity: 1, started_at: world.server_now, finish_at: new Date(now + 60000).toISOString() });
  const html = renderToStaticMarkup(React.createElement(SettlementView, { world, playerId: world.players[0].id, now, busy: false, run: () => {} }));
  assert.ok(html.includes('aria-label="Construction queue"'));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(html.includes('1:00'));
  assert.ok(!html.includes('role="dialog"'));
});
