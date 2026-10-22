PERIS - Recruitment destination dropdown (City + Armies)

Extract this ZIP to C:\Peris, preserving directories. Overwrite the files listed below.
The patch assumes the earlier City Garrisons and Garrison Logistics v2 updates.

Changes:
- In Barracks, Stables and Workshop, the existing Legion dropdown becomes "Train for" and also offers "Garrison - Permanent defenders".
- The selected dropdown target controls whether a recruit order goes to the legion or directly into the permanent city garrison.
- The separate "Train for legion / Train for garrison" buttons are removed.
- The Armies recruitment popup gets the equivalent single dropdown.
- Garrison recruitment orders in the building's training queue are labelled "Garrison".

No SQL changes and no game logic changes.

On your Windows machine:
  cd C:\Peris
  npm.cmd test
  npm.cmd run build

Verification here: modified JSX transpiles; destination wiring static assertions pass.
Full React render tests, TypeScript program checks, and Vite build need your local node_modules.
