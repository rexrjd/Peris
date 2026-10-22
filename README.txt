PERIS CITY RUINS — TIMESTAMP ASSERTION FIX

Only file changed: tests/city-ruins.test.ts

Fixes the first ruins test: the game serializes timestamps to canonical ISO 8601
with milliseconds (.000Z), while the original test compared against an input
string without milliseconds. Both represent the same moment.

INSTALL:
- Extract the ZIP into C:\Peris, preserving folder structure.
- This changes ONLY the test file. It does not modify gameplay code or SQL.

VERIFY from PowerShell:
cd C:\Peris
node --import tsx --test tests/city-ruins.test.ts
npm.cmd test
npm.cmd run build

Keep the live Supabase database unchanged until all database tests pass.
