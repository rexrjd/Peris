# Compact report controls

Based on the latest `origin/main` (`12012a4`), including the Reports popup update.
Copy these changed files into the root application and build the frontend.
This update uses existing reports and read-status persistence; no SQL changes.

The three rows of controls become one slim icon toolbar:

- Stacked reports: all reports.
- Envelope: unread reports, with a small gold dot while unread reports exist.
- Broken shield: battles with troop losses.
- Sparkles: battles with equipment rewards.
- Crossed swords/shield: choose all outcomes, victories, defeats or stalemates.
- Date arrow: toggle newest/oldest first with one click.
- Magnifying glass: expand search. Closing search clears its filter.
- Double check: mark the entire history as read.

Every control has a tooltip and accessible name. The outcome control retains
native keyboard selection. A small list caption shows the current outcome and
date order. Report rows use matching outcome shields, and the list gains the
space previously occupied by the large dropdowns and always-open search field.
The current map/city/army/Rally Point stays mounted behind the popup.

The icons extend Peris's original SVG interface set. Travian's report overview
inspired the compact arrangement; no Travian artwork is included.
Reference: https://support.travian.com/en/articles/58-reports
Reference: https://support.kingdoms.com/en/articles/19-reports

Validation: production build passes, 427 unit tests pass with one existing skip,
4 tooling tests pass, and all 46 registered models pass asset checks. Seven
browser cases pass across desktop, mobile and 320px screens, covering toolbar
fit, search, every outcome, date reversal, rewards, unread filtering, Read all,
popup dismissal/context preservation, older report paging and persisted reads
after reload, including retry after a failed server write.
