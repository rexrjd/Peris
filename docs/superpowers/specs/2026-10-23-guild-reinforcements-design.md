# Guild reinforcements

Approved in chat on 2026-10-23. Put Send reinforcements beside Message for other members of the player's own guild. A compact slate popup preselects the member, offers their living cities and the sender's city garrisons or eligible idle armies at owned cities, and displays nine-role troop quantities, available counts, Max, total (1–1,000), and travel estimate. Success closes the popup; errors retain selection. Keyboard, narrow phones and all faction troop identities remain supported.

Use existing wrapped land routes, server validation and troop ownership. Dispatch atomically deducts exactly the chosen source; armies retain their commander and unselected troops. Moving, training and battling armies cannot dispatch. Use the existing command receipt journal for retry safety. Guild support uses the shared game clock. No SQL is deployed.

Include participant-private reinforcement DTOs in the online snapshot. Map and live 3D City Events display outgoing/incoming, stationed and returning support with troop details and sender-owned recall. Refresh through normal engine polling and commands. Own-city transfers remain intact; solo saves and public map privacy remain intact.

Resolve committed conflict markers by retaining shared-clock/reliability code and integrating guild additions. Generate SQL bundles from modules. Verify unit/tooling/assets/build, SQL generation, isolated guild/logistics/social/clock suites, and desktop/phone browser interactions and screenshots.
