# PERIS v0.5

Browser strategy prototype built with React, TypeScript, Phaser and Supabase.

## Current loop

- anonymous ruler creation
- persistent settlements and resources
- buildings and recruitment
- strategic army movement
- real-time two-player tactical battles
- selectable infantry, archer and cavalry formations
- right-click movement and attack orders
- server-side battle simulation with casualties, morale and routing
- Rome-style cavalry charges, facing, flank/rear bonuses and morale shock
- battle result written back to strategic armies

## Database step

If you are upgrading the working v0.4 world, run this once in **Supabase > SQL Editor**:

`supabase/UPGRADE_V4_TO_V5_BATTLES.sql`

That keeps existing rulers, settlements, buildings and strategic armies and adds the tactical battle system.

For a completely fresh world/reset instead, run:

`supabase/RESET_AND_CREATE_V5.sql`

The reset deletes Peris public game-world data but does not delete Supabase Auth users.

## Battle controls

1. Have two rulers in the realm.
2. In the right-hand **Rival armies** panel, press **BATTLE**.
3. Both participants are placed into the same tactical battlefield.
4. Left-click one of your formations.
5. Right-click ground to move it.
6. Right-click an enemy formation to attack it.
7. Infantry, archers and cavalry have different speed/range/matchups.
8. Long attack runs can prime a charge; rear and flank attacks multiply shock.
9. Formations can rout from low morale before every soldier is killed.
10. The surviving soldier counts are written back to each strategic army when the battle ends.

For this prototype, battles can be challenged immediately from anywhere on the strategic map. March-to-contact, interception and sieges are the next strategic-layer integration step.
