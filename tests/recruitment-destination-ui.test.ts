import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { cityLayout } from '../src/features/city/rendering/three/layout';
import { RecruitmentPanel } from '../src/features/army/ui/RecruitmentPanel';
import { BuildingDialog } from '../src/features/city/ui/BuildingDialog';

(globalThis as any).React = React;

test('building recruitment chooses the legion or permanent garrison from one dropdown', () => {
    const world = createSolo('Destination'), city = world.settlements[0];
    const slot = { settlement_id: city.id, slot_index: 0, building_type: 'barracks' as const, level: 1 };
    world.city_slots = [slot];
    const market = world.buildings.find(building => building.settlement_id === city.id && building.building_type === 'market');
    const plot = cityLayout({ market: market?.level ?? 1 }, [slot]).find(row => row.key === 'slot:0')!;
    const html = renderToStaticMarkup(React.createElement(BuildingDialog, {
        world, owner: city.owner_id, sid: city.id, plot,
        initialChoice: 'barracks', busy: false, now: Date.parse(world.server_now),
        run: () => {}, onSelect: () => {}, onClose: () => {},
        appearance: 'scene',
    }));
    assert.match(html, /aria-label="Recruitment destination"/);
    assert.match(html, /<option[^>]*value="garrison"[^>]*>Garrison/);
    assert.match(html, /class="building-inspector-legion">Train for/);
    assert.doesNotMatch(html, /Train for garrison|Train for legion|recruit-destination-tabs/);
});

test('embedded garrison training uses the selected destination without another tab switch', () => {
    const world = createSolo('Garrison destination'), city = world.settlements[0], army = world.armies[0];
    world.city_slots = [{ settlement_id: city.id, slot_index: 0, building_type: 'barracks', level: 1 }];
    const html = renderToStaticMarkup(React.createElement(RecruitmentPanel, {
        world, army, city, busy: false, now: Date.parse(world.server_now), run: () => {},
        embedded: true, formOnly: true, buildingOnly: 'barracks', destination: 'garrison',
    }));
    assert.match(html, /Training finishes directly in this city/);
    assert.doesNotMatch(html, /aria-label="Recruitment destination"|Train for legion|Train for garrison/);
});

test('army recruitment offers the same destination choice without duplicate buttons', () => {
    const world = createSolo('Army training destination'), city = world.settlements[0], army = world.armies[0];
    const html = renderToStaticMarkup(React.createElement(RecruitmentPanel, {
        world, army, city, busy: false, now: Date.parse(world.server_now), run: () => {},
        formOnly: true, initialUnit: 'infantry',
    }));
    assert.match(html, /aria-label="Recruitment destination"/);
    assert.match(html, /<option[^>]*value="garrison"[^>]*>Garrison/);
    assert.match(html, /<option[^>]*value="legion"/);
    assert.doesNotMatch(html, /Train for garrison|Train for legion|recruit-destination-tabs/);

    const css = readFileSync(new URL('../src/features/army/styles/command-room.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /recruit-destination-tabs/);
});
