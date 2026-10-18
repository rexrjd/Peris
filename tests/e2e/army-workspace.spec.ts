import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { ARTIFACTS, heroForArmy, heroPoints } from '../../src/features/heroes/domain/heroes';
import { heroPortraitUrl } from '../../src/features/heroes/domain/portraits';
import { emptyRoster, writeRoster, RECRUIT_RULES, RECRUIT_UNITS, type RecruitUnit } from '../../src/features/army/domain/roster';
import { troopDetails } from '../../src/features/army/domain/troopDetails';
import { readFileSync } from 'node:fs';
import { validateSave } from '../../src/platform/storage/saves';
import type { World } from '../../src/shared/model/world';
const roman = JSON.parse(readFileSync('assets/concepts/faction-sheets-v1/expanded-rosters.json', 'utf8')).roster.find((row: { id: string }) => row.id === 'roman');
const factionTroopName = (_faction: string, unit: RecruitUnit): string => [...roman.troops, ...roman.siege].find((row: { id: string }) => row.id === RECRUIT_RULES[unit].role).name;

function fixture() {
    const world = createSolo('Army Studio'), city = world.settlements[0], army = world.armies[0];
    world.buildings.find(building => building.building_type === 'market')!.level = 3;
    world.city_slots = [{ settlement_id: 1, slot_index: 0, building_type: 'barracks', level: 2 }, { settlement_id: 1, slot_index: 1, building_type: 'stables', level: 2 }, { settlement_id: 1, slot_index: 2, building_type: 'workshop', level: 1 }, { settlement_id: 1, slot_index: 3, building_type: 'smithy', level: 2 }];
    world.settlements.push({ ...city, id: 2, name: 'Northwatch', faction: 'orc', x: 704, y: 192 });
    world.buildings.push(...world.buildings.map(building => ({ ...building, id: building.id + 100, settlement_id: 2 })));
    writeRoster(army, { ...emptyRoster(), infantry: 120, spearmen: 16, archers: 50, elite: 12, cavalry: 18, scout: 6, heavyCavalry: 7, ram: 3, catapult: 2 });
    Object.assign(world.heroes![0], { name: 'Aurelia', class: 'ranger', experience: 600 });
    army.name = 'Dawn legion';
    const other = { ...army, id: 99, name: 'Ash guard', home_settlement_id: 2 };
    writeRoster(other, { ...emptyRoster(), infantry: 20 }); world.armies.push(other);
    world.heroes!.push({ ...world.heroes![0], id: 99, army_id: 99, name: 'Korga', class: 'mage', experience: 300 });
    world.hero_artifacts = Object.keys(ARTIFACTS).map((artifact_id, index) => ({ id: 900 + index, owner_id: army.owner_id, artifact_id, hero_id: artifact_id === 'iron_sword' ? world.heroes![0].id : artifact_id === 'runestaff' ? 99 : null }));
    refreshCityEconomy(world, 1); refreshCityEconomy(world, 2);
    for (const town of world.settlements) Object.assign(town, { wood: 5000, stone: 5000, food: 5000, gold: 5000 });
    return world;
}
async function start(page: Page, world: World) {
    validateSave(world);
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'Armies', exact: true }).click();
}
const save = (page: Page): Promise<World> => page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));

test('unit card bonus breakdown explains multiplied smithy and commander gains without opening the inspector', async ({ page, isMobile }, info) => {
    const world = fixture(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    Object.assign(world.heroes![0], { class: 'knight', attack: 0, defence: 0, power: 0, knowledge: 0 });
    world.hero_artifacts = [];
    world.city_slots!.find(slot => slot.building_type === 'smithy')!.level = 5;
    await start(page, world);
    const card = page.locator('.army-troop-card[data-unit="infantry"]');
    await expect(card.locator('[data-stat="attack"]')).toHaveAttribute('data-base', '100');
    await expect(card.locator('[data-stat="attack"]')).toHaveAttribute('data-current', '127.2');
    const trigger = card.getByRole('button', { name: 'Explain Attack bonuses and penalties', exact: true });
    await trigger.scrollIntoViewIfNeeded();
    if (isMobile) await trigger.click(); else await trigger.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('Home-city smithies');
    await expect(tooltip).toContainText('+20');
    await expect(tooltip).toContainText('Commander & equipment');
    await expect(tooltip).toContainText('+7.2');
    await expect(tooltip).toBeInViewport();
    await expect(page.getByRole('dialog', { name: / stats$/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('unit-bonus-breakdown.png') });
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.getByRole('heading', { name: 'Armies', exact: true }).click();
    await trigger.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.getByRole('heading', { name: 'Armies', exact: true }).click();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await card.locator('.army-troop-inspect').click();
    const inspector = page.getByRole('dialog', { name: / stats$/ });
    await inspector.getByRole('button', { name: 'Explain Attack bonuses and penalties', exact: true }).click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(inspector).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});
const manage = (page: Page, tab: string) => page.getByRole('navigation', { name: 'Army management' }).getByRole('button', { name: tab, exact: true }).click();
async function capture(page: Page, info: TestInfo, name: string) {
    await page.screenshot({ path: info.outputPath(name + '.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('army workspace keeps one hero identity, real troops and army-specific recruitment', async ({ page }, info) => {
    const world = fixture(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page, world);
    const card = page.getByRole('complementary', { name: 'Selected army', exact: true });
    await expect(card.getByRole('heading', { name: 'Aurelia', exact: true })).toBeVisible();
    await expect(card.locator('img')).toHaveAttribute('src', heroPortraitUrl('roman', 'ranger', world.heroes![0].id));
    await expect(page.locator('.army-troop-grid .army-troop-inspect')).toHaveCount(9);
    await expect(page.getByRole('dialog', { name: 'Recruit troops', exact: true })).toHaveCount(0);
    await capture(page, info, 'armies-troops');
    await page.getByRole('button', { name: 'Recruitment', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Recruit troops', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Soldiers to train', { exact: true }).fill('10');
    await capture(page, info, 'armies-recruitment');
    await dialog.getByRole('button', { name: `Train 10 ${factionTroopName('roman', 'infantry')}`, exact: true }).click();
    await expect.poll(async () => (await save(page)).orders.find(order => order.kind === 'recruit')?.army_id).toBe(world.armies[0].id);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Recruitment', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Army training queue', exact: true })).toContainText('10');
    await expect(page.getByLabel('Give orders', { exact: true })).toBeDisabled();
    await page.getByRole('group', { name: 'Your armies', exact: true }).getByRole('button', { name: /^Ash guard/ }).click();
    await expect(card.getByRole('heading', { name: 'Korga', exact: true })).toBeVisible();
    await expect(page.locator('.army-troop-grid .army-troop-inspect')).toHaveCount(9);
    await expect(page.locator('.army-troop-grid .army-troop-inspect[data-empty=true]')).toHaveCount(8);
    await expect(page.getByRole('region', { name: 'Army training queue', exact: true })).toContainText('No active orders');
    await manage(page, 'Commander');
    await expect(page.locator('.commander-dossier')).toHaveCount(0);
    const points = heroPoints(heroForArmy(await save(page), 99)!);
    await page.getByRole('button', { name: 'Improve attack', exact: true }).click();
    await expect.poll(async () => heroPoints(heroForArmy(await save(page), 99)!)).toBe(points - 1);
    await capture(page, info, 'armies-commander');
    await manage(page, 'Equipment'); await expect(page.getByRole('region', { name: 'Equipment management', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});

test('equipment workspace filters shared loot and equips, unequips and opens its actual holder', async ({ page }, info) => {
    const world = fixture(); await start(page, world); await manage(page, 'Equipment');
    await expect(page.locator('.command-equipment-slots>button')).toHaveCount(5);
    await capture(page, info, 'armies-equipment');
    await page.getByLabel('Find an artifact', { exact: true }).fill('Lionheart');
    const selected = page.locator('.command-artifact-grid>button[aria-pressed=true]');
    await expect(selected).toContainText('Lionheart');
    await expect(selected.locator('img')).toHaveAttribute('src', ARTIFACTS.lionheart_blade.image);
    await page.getByRole('button', { name: 'Equip Lionheart', exact: true }).click();
    await expect.poll(async () => (await save(page)).hero_artifacts?.find(item => item.artifact_id === 'lionheart_blade')?.hero_id).toBe(world.heroes![0].id);
    await expect(selected).toContainText('Equipped');
    await page.getByRole('button', { name: 'Return to backpack', exact: true }).click();
    await expect.poll(async () => (await save(page)).hero_artifacts?.find(item => item.artifact_id === 'lionheart_blade')?.hero_id).toBe(null);
    await page.getByLabel('Find an artifact', { exact: true }).fill('Runestaff');
    // Item names are original catalog names, not internal IDs.
    await page.getByLabel('Find an artifact', { exact: true }).fill(ARTIFACTS.runestaff.name);
    await expect(page.locator('.command-artifact-detail')).toContainText('Korga is carrying this artifact');
    await page.getByRole('button', { name: 'View hero', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Selected army' })).toContainText('Korga');
    await page.getByLabel('Available artifacts only', { exact: true }).click();
    await expect(page.locator('.command-artifact-grid')).not.toContainText('Equipped');
    await page.getByLabel('Sort artifacts by tier', { exact: true }).click();
    await page.setViewportSize({ width: 320, height: 700 }); await capture(page, info, 'armies-equipment-320');
    await page.getByLabel('Find an artifact', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Find an artifact', { exact: true })).toBeInViewport();
});

test('raising a commander selects the new empty army and narrow layouts keep every management tab usable', async ({ page }, info) => {
    const world = fixture(); await start(page, world);
    await page.getByRole('button', { name: 'Raise army', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Raise a new army', exact: true });
    await dialog.getByLabel('Commander name', { exact: true }).fill('River scout');
    await dialog.getByRole('group', { name: 'Commander class', exact: true }).getByRole('button', { name: /^Ranger/ }).click();
    await capture(page, info, 'armies-raise');
    await dialog.getByRole('button', { name: 'Raise army · 500 gold', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Selected army' })).toContainText('River scout');
    await expect(page.locator('.army-troop-grid .army-troop-inspect')).toHaveCount(9);
    await expect(page.locator('.army-troop-grid .army-troop-inspect[data-empty=true]')).toHaveCount(9);
    await expect(page.getByRole('button', { name: 'Transfer troops', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.getByRole('group', { name: 'Your armies', exact: true }).getByRole('button', { name: /^River scout/ })).toBeInViewport();
    await capture(page, info, 'armies-320');
    for (const tab of ['Army', 'Commander', 'Equipment', 'Logistics']) {
        const button = page.getByRole('navigation', { name: 'Army management' }).getByRole('button', { name: tab, exact: true });
        await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport(); await button.click();
        await expect(page.getByRole('region', { name: `${tab} management`, exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
});

test('every troop opens real stats, locked roles remain inspectable and recruitment is explicit', async ({ page }, info) => {
    const world = fixture(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page, world);
    await capture(page, info, 'troop-catalog-desktop');
    const before = await save(page);
    for (const unit of RECRUIT_UNITS) {
        const card = page.locator(`.army-troop-grid .army-troop-inspect[data-unit="${unit}"]`);
        await card.click();
        const dialog = page.getByRole('dialog', { name: `${factionTroopName('roman', unit)} stats`, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('heading', { name: factionTroopName('roman', unit), exact: true })).toBeVisible();
        await expect(dialog.getByRole('region', { name: 'Troop combat stats' })).toContainText('Attack range');
        await expect(dialog.getByRole('region', { name: 'Troop recruitment requirements' })).toContainText(RECRUIT_RULES[unit].cost.gold.toString());
        await expect(dialog.locator('.fw-troop-portrait')).toHaveCSS('background-image', /\/art\/battle\/roster\/roman\.png/);
        await page.keyboard.press('Escape'); await expect(card).toBeFocused();
    }
    expect((await save(page)).orders).toEqual(before.orders);
    expect((await save(page)).armies.map(army => army.unit_roster)).toEqual(before.armies.map(army => army.unit_roster));
    await page.locator('.army-troop-grid .army-troop-inspect[data-unit="infantry"]').click();
    const stats = page.getByRole('dialog', { name: / stats$/ });
    const actual = troopDetails(world, world.armies[0], world.settlements[0], 'infantry', Date.parse(world.server_now));
    await expect(stats.locator('.troop-dossier-combat [data-stat=attack]')).toHaveAttribute('data-current', String(Math.round(actual.attack * 1000) / 10));
    await capture(page, info, 'troop-stats-desktop');
    await stats.getByText('More combat details', { exact: true }).click();
    await expect(stats.locator('.troop-combat-details')).toContainText('separate health stat');
    await stats.getByRole('button', { name: 'Previous troop type', exact: true }).click();
    await expect(stats.getByRole('heading', { name: factionTroopName('roman', 'catapult'), exact: true })).toBeVisible();
    await expect(stats.getByRole('button', { name: 'Unlock in Research', exact: true })).toBeVisible();
    await capture(page, info, 'troop-stats-siege');
    await stats.getByRole('button', { name: 'Next troop type', exact: true }).click();
    await stats.getByRole('button', { name: 'Recruit this troop', exact: true }).click();
    await expect(page.getByRole('dialog', { name: / stats$/ })).toHaveCount(0);
    const recruit = page.getByRole('dialog', { name: 'Recruit troops', exact: true });
    await expect(recruit).toBeVisible();
    await expect(recruit.locator('.game-unit-choices>button[aria-pressed=true]')).toContainText(factionTroopName('roman', 'infantry'));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 700 });
    await page.locator('.army-troop-grid .army-troop-inspect[data-unit="catapult"]').click();
    const narrow = page.getByRole('dialog', { name: `${factionTroopName('roman', 'catapult')} stats`, exact: true });
    await expect(narrow).toBeVisible();
    expect(await narrow.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await narrow.getByRole('button', { name: 'Unlock in Research', exact: true }).scrollIntoViewIfNeeded();
    await expect(narrow.getByRole('button', { name: 'Unlock in Research', exact: true })).toBeInViewport();
    await capture(page, info, 'troop-stats-320');
    await narrow.getByRole('button', { name: 'Close', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(narrow.getByRole('button', { name: 'Unlock in Research', exact: true })).toBeFocused();
    await narrow.getByRole('button', { name: 'Unlock in Research', exact: true }).click();
    await expect(page.getByRole('dialog', { name: / stats$/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});
