# Armies interface

The Armies page now uses a compact horizontal army roster and one commander card shared by all four management tabs. The portrait, rank, XP, ready soldiers and command effects stay visible while you inspect troops, spend skill points, equip artifacts or move soldiers between armies.

The Army tab shows the troop types actually present by default. Click a troop card to inspect or recruit that type, use Recruitment for the full recruitment overlay, or toggle the small expansion icon to show every unit. Training stays visible as a compact queue with real completion times and progress. Raising an army opens the existing commander/city flow in the same slate style.

Equipment uses five compact slot controls, a shared backpack and an artifact inspector. Search by item name or rarity, filter unequipped artifacts, or switch between highest-tier and alphabetical ordering. Equipping, returning an item to the backpack and locating its current holder use the same engine commands as before. Skill spending, exact-role transfers, march review, cancellation and garrison merging retain their existing rules.

The layout adapts to desktop and narrow screens. Details have their own workspace instead of stacking multiple hero summaries above the usable controls. The 3D city redesign and embedded recruitment in city buildings remain separate from this page.

## Apply

This patch is based on `origin/main` at `ab4325c`, which already includes the guild crest and 3D city update. Extract the archive outside your repository, review `ARMIES_UI_FILES.json`, then copy the listed files into the root of a review branch. There are no new npm dependencies and **no SQL migration**.

`ARMIES_UI_PUSH_NOTES.txt` records validation and push steps. Screenshots under `docs/previews/armies-ui` show the actual running game. This archive contains changed files only; it excludes environments, dependencies, production data, SQL installers and runner-specific browser configuration.

## Design references

- [Total War Academy: recruiting armies](https://academy.totalwar.com/campaign-recruiting-armies/) opens recruitment from the army context rather than keeping the recruitment interface permanently visible.
- [Heroes of Might and Magic: Olden Era hero screen](https://wiki.hoodedhorse.com/Heroes_of_Might_and_Magic_Olden_Era/Hero_Screen) groups hero identity, progression, attributes, equipment slots and inventory in one context.

All portraits, unit atlases and artifact paintings are existing Peris assets. No reference-game artwork was copied. This update changes presentation and inventory filtering, not combat, balance, saves or multiplayer protocols.
