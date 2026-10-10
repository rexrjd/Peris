import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PAINTED_CITY, paintedCityLayout } from '../src/features/city/rendering/paintedLayout';
import { PaintedSettlementScene } from '../src/features/city/rendering/PaintedSettlementScene';
import { BuildingPreview } from '../src/features/city/rendering/BuildingPreview';
import { villageAtlasCell, VILLAGE_ATLAS_CELLS } from '../src/features/city/rendering/villageArtwork';
import { FACTIONS } from '../src/features/factions/domain/factions';
import type { CitySlot } from '../src/features/city/domain/slots';

(globalThis as any).React = React;

test('painted layout unlocks actual plots without moving earlier buildings', () => {
    const initial = paintedCityLayout({ market: 0 }, []);
    assert.equal(initial.filter(plot => plot.slot !== undefined && plot.slot < 16).length, 6);
    const keys = new Set(initial.map(plot => plot.key));
    let previous = initial;
    for (let main = 1; main <= 5; main++) {
        const next = paintedCityLayout({ market: main }, []);
        assert.equal(next.filter(plot => plot.slot !== undefined && plot.slot < 16).length, 6 + main * 2);
        for (const plot of previous) {
            const expanded = next.find(item => item.key === plot.key)!;
            assert.deepEqual([expanded.x, expanded.y], [plot.x, plot.y]);
        }
        assert.equal(new Set(next.map(plot => plot.key)).size, next.length);
        previous = next;
    }
    assert.ok(keys.has('fishery') && keys.has('wall') && keys.has('market'));
    assert.ok(!keys.has('slot:6'));
});

test('resource sites stay outside the round city and ordinary plots stay inside', () => {
    const { centerX, centerY, radiusX, radiusY, width, height } = PAINTED_CITY;
    const plots = paintedCityLayout({ market: 5 }, []);
    const distance = (x: number, y: number) => ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2;
    for (const plot of plots) {
        assert.ok(plot.x > 0 && plot.x < width && plot.y > 0 && plot.y < height);
        if (plot.slot !== undefined && plot.slot < 16) assert.ok(distance(plot.x, plot.y) < .8, `${plot.key} touches perimeter`);
        if (['lumber', 'quarry', 'farm', 'fishery'].includes(plot.key)) assert.ok(distance(plot.x, plot.y) > 1, `${plot.key} belongs outside`);
    }
    const hall = plots.find(plot => plot.key === 'market')!;
    assert.deepEqual([hall.x, hall.y], [centerX, centerY]);
});

test('painted view follows completed levels, hides locked plots, and preserves its input', () => {
    const slots: CitySlot[] = [
        { settlement_id: 1, slot_index: 0, building_type: 'mage_tower', level: 10 },
        { settlement_id: 1, slot_index: 1, building_type: 'barracks', level: 0 },
        { settlement_id: 1, slot_index: 16, building_type: 'fishery', level: 2 },
        { settlement_id: 1, slot_index: 15, building_type: 'housing', level: 5 },
    ];
    const levels = { market: 0, wall: 0, farm: 1, quarry: 0, lumber: 0 };
    const original = structuredClone({ slots, levels });
    const html = renderToStaticMarkup(React.createElement(PaintedSettlementScene, { selected: 'slot:1', onSelect: () => {}, levels, slots, faction: 'elf' }));
    assert.ok(html.includes('Mage tower, Level 10.'));
    assert.ok(html.includes('Barracks, Not built yet.'));
    assert.ok(html.includes('Riverside site outside the wall.'));
    assert.ok(!html.includes('data-building="slot:15"'));
    assert.equal((html.match(/<button/g) ?? []).length, 12);
    assert.equal((html.match(/painted-city-foundation/g) ?? []).length, 9);
    assert.ok(html.includes('aria-pressed="true"'));
    assert.ok(!html.includes('city-building-artwork'));
    assert.deepEqual({ slots, levels }, original);
});

test('all factions retain their identity in both city and exact model previews', () => {
    for (const faction of Object.keys(FACTIONS) as (keyof typeof FACTIONS)[]) {
        const html = renderToStaticMarkup(React.createElement(PaintedSettlementScene, { selected: 'market', onSelect: () => {}, levels: {}, slots: [], faction }));
        assert.ok(html.includes(`data-faction="${faction}"`));
        const preview = renderToStaticMarkup(React.createElement(BuildingPreview, { type: 'market', level: 0, faction }));
        assert.ok(preview.includes('Main building, unbuilt site'));
    }
});

test('atlas contract maps twelve roles into individual cells and excludes walls', () => {
    assert.equal(VILLAGE_ATLAS_CELLS.length, 12);
    assert.deepEqual(villageAtlasCell('market'), { index: 0, position: '0% 0%' });
    assert.deepEqual(villageAtlasCell('quarry'), { index: 2, position: '100% 0%' });
    assert.deepEqual(villageAtlasCell('housing'), { index: 11, position: '100% 100%' });
    assert.deepEqual(villageAtlasCell('storehouse'), villageAtlasCell('granary'));
    assert.equal(villageAtlasCell('wall'), null);
});
