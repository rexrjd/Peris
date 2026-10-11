# Compact Reports popup

Changed files based on `origin/main` at `d73a8a8`. Merge these paths into the root
application, then deploy the frontend with the new Reports picture. Keep the
report-read migration from the previous update; this patch adds no SQL changes.

Reports opens a 560px-wide popup, capped at 540px tall, over the current map,
city, Rally Point or army view. Narrow screens retain visible surroundings.
Opening and closing the popup preserves the active view and its mounted scene,
selection and army/city context. Close with Escape, the X button, or an outside
click. Keyboard focus returns to the opening control.

The list uses the existing search, outcome/date controls, unread/losses/equipment
filters and Read all. Choosing a report opens its details inside the same small
window; Back to reports returns to the list. Milestones remain available in their
own tab. Choosing Map on a receipt intentionally closes the popup and locates
that camp.

An original low-poly parchment scroll and blue seal replaces the Reports glyph.
The untouched source is `assets/source/ui-low-poly-v1/reports.png`; the runtime
export is `public/art/ui/low-poly-v1/reports.webp`. The full prompt and built-in
image-generation provenance are in `assets/ui-low-poly-v1.json`. Regenerate with
`npm run build:ui-icons`; verify with `npm run check:ui-icons`.

Validation: production build passes; 427 unit tests pass with one existing skip.
Desktop and mobile browser checks cover all four background views, popup sizing,
report details, keyboard/outside-click dismissal, search and unread filters,
persisted individual reads and Read all, older history, and retry after a failed
read request. All 9 UI pictures and 46 registered models pass asset checks.
The latest `origin/main` still matches the base commit above.
