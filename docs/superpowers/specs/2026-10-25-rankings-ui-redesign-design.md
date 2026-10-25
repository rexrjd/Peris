# Rankings UI redesign

The user requests a complete visual redesign strongly inspired by Travian and explicitly asks for online screenshot research. The existing oversized dark cards and decorative copy obscure the standings.

## Direction

Use a compact, light paper statistics sheet with forest-green tabs and table headings, dark readable text, fine rules and modest serif page headings. Reuse the existing Peris navigation and bundled fonts. Reference screenshots are for layout study; ship original HTML/CSS and existing Peris icons only.

References inspected/searched:
- https://www.travian-help.cz/tipy-triky/zaklady-travianu/statistiky/ (classic defense table; downloaded and visually inspected).
- https://adameck-travian.wbs.cz/travian_35/T3.5_statistika.JPG (classic statistics page; downloaded for visual inspection).
- https://forum.ragezone.com/threads/travianz-version-modified-by-shadow-and-many-others.967580/page-5 (weekly Top 10 screenshot indexed by image search; direct image download is forbidden by the host).
- https://www.cherrycredits.com/img/games/Travian/Screenshot3.png (Travian: Legends statistics sheet, downloaded and visually inspected).

## Chosen implementation

The overview shows five compact tables in two desktop columns and one mobile column. A real category tab strip provides Top 10 overview, Attack, Defense, Robbers, Camps and Growth views. Individual categories use the same authenticated data, not a new ranking service. Tables have Rank, Player, Guild and the appropriate Points/Resources/People column. Own rows are highlighted, including the separate row outside the Top 10. Empty boards remain concise.

Keep current/previous week controls and one short date/reset line. Place scoring and tracking details in a native expandable help section. Retain loading, refresh, retry, unavailable-server, signed growth, ties, solo scope and stale-read protection. Keyboard tab navigation follows standard roving-focus arrow/Home/End behavior. Mobile tabs remain fully visible and tables fit 320px; tall content scrolls inside the existing app pane.

A single-category-only design was considered but hides the requested weekly overview. Merely recoloring the current cards leaves their excessive padding and duplicated descriptions. A compact overview plus real category navigation meets both uses.

## Boundary

Presentation only: React/CSS, UI tests and documentation. Ranking scoring, saves, DTO, RPC, SQL, world/city/battle behavior and other navigation destinations remain unchanged. No production deployment or push. Work on `review/rankings-ui-redesign` and verify the actual desktop/mobile browser presentation.
