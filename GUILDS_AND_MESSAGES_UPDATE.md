# Peris guilds and messages — V19

Based on main `6c3025c7878335bff50f05a6885d1016b8ca75b9`, including the V18 technology/Academy update. This is a changed-files package for the root application.

## Install

1. Extract the ZIP into the root of `rexrjd/Peris`, preserving its relative paths. Review the Git diff on a feature branch.
2. For your current V18 database, run **`supabase/UPGRADE_GUILDS_TO_V19.sql`** in Supabase SQL Editor before deploying the frontend. This focused migration creates social state and updates two raid entry functions. It leaves campaign tables, account login, science, research, and unrelated server functions alone. It is safe to rerun.
3. If upgrading a database older than V18, use the complete `supabase/UPGRADE_TO_V19.sql` instead. Use `FRESH_INSTALL_V19.sql` only for an empty database; its existing-world guard remains in place.
4. Run `npm ci`, `npm run check:sql`, `npm test`, `npm run test:social-db`, and `npm run build`. Deploy through your normal main/Vercel workflow.

Source modules and all generated compatibility bundles are included. A fresh browser login is not required. Current guild/message state belongs to the same ruler UUID across devices and anonymous session recovery.

## Guilds

- Both Guilds and Messages sit at the left of the top bar, including on mobile. Their overlays preserve the current map/city screen.
- A searchable guild finder includes recruitment policy, playstyle, members, cities, public introduction, and a crest. Guilds hold up to 60 players; each account can belong to one.
- Choose open joining, reviewed applications, or invitation-only recruitment. Players can submit up to five pending applications; invitations expire after seven days.
- Four starting ranks: Guildmaster, Officer, Member, and Recruit. Create additional ranks up to 12 total. Eight separate permissions cover invitations, applications, removal, ranks, editing, diplomacy, announcements, and gold withdrawal. Higher ranks manage lower ones; permissions cannot be escalated beyond those the acting member holds.
- Members have activity indicators, public city/population statistics, and an optional offensive/defensive/economy specialization. Message members directly from the roster.
- A private member notice, announcements in guild chat, and a recent activity log support coordination.
- The treasury uses actual gold from owned cities. Contributions and permitted withdrawals are atomic, respect available gold/storage, and retain a member-visible ledger. Retries cannot charge twice.
- Leadership transfer makes the outgoing guildmaster an officer. A leader must transfer leadership before leaving. Disbanding requires the typed guild tag and an empty treasury.

## Diplomacy

Guilds can offer bilateral alliances and non-aggression pacts, or declare war. Friendly offers require acceptance by the other guild; wars take effect immediately. Officers only receive diplomacy rights if the guildmaster grants them.

Same-guild membership and active friendly pacts protect city raids at the server boundary. If a friendly pact is accepted while a raid is already travelling, the army returns without starting a battle when it arrives. Ending a pact does not rewrite existing battles. Normal NPC farming and consensual duels keep their existing rules.

## Messages

- Private two-player conversations with replies, plus a private guild channel and highlighted announcements.
- Search players by name and resume existing conversations. Search/filter the inbox, archive or restore conversations, and block/unblock players.
- Unread badges count received messages only. Opening a visible conversation records the last visible message sequence; a later arrival stays unread. Mark all read is also available.
- Read state, threads, and guild membership persist in Supabase across refreshes and devices. Incoming messages restore an archived conversation to the inbox.
- Message history loads in pages of 50. The inbox snapshot is bounded to the 100 most recent conversations; player search can resume an older thread. Public directories page 24 results.
- Messages allow 2,000 characters and preserve line breaks. Enter sends; Shift+Enter inserts a new line. Plain-text rendering prevents HTML from running. The server limits sending to 30 messages per minute.
- Replies preserve the same conversation in both directions. A lost response retains the original UUID for an exact retry; database receipts prevent duplicate sends or guild actions.
- Online refresh is bounded: every two seconds with a social window open, every six seconds while it is closed, and on focus. No global realtime subscription or private campaign data is exposed.

## Privacy and implementation

Raw social tables have RLS enabled and no client table grants. Bounded security-definer RPCs verify the current ruler binding, conversation participation, guild membership, and rank rights. Sender identity comes from the authenticated ruler. Former members immediately lose access to guild history. Public profiles omit private notices, ledgers, activity, applications, and permissions.

Editable code is under `src/features/social` and `supabase/modules/social`. Run `npm run build:sql` to regenerate SQL, and `npm run build:ui-icons` to regenerate the navigation pictures. Original transparent PNGs and generation prompts are included. Crests are editable native SVG, with six sigils and six colors.

## Design references

Original Peris visuals and layout; familiar recruitment, permission, and diplomacy patterns were researched from these official sources:

- [Travian alliance management](https://support.travian.com/en/articles/86-alliance-management)
- [Travian alliances, confederacies, and non-aggression pacts](https://support.travian.com/en/articles/84-alliance-confed-and-nap)
- [Travian joining, creating, and leaving an alliance](https://support.travian.com/en/articles/85-joining-creating-and-leaving-an-alliance)
- [Albion guild finder](https://albiononline.com/guides/article/Guild-Finder%2B106)
- [Albion guild UI improvements](https://albiononline.com/news/devtalk-guild-ui-improvements)

Validation and known baseline test limitations are recorded in `GUILDS_PUSH_NOTES.txt`.
