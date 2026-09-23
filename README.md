# Beaver's Mobile Pawn

Use your phone as a gamepad for your token in Foundry VTT.

- **Phone**: you only see your character sheet (read-only). Swipe sideways to a grid. Double-tap the grid where your
  character is and keep your finger down on the second tap, then drag: you see the path you draw.
- **Table screen**: a second Foundry login on the shared display shows the map and highlights the path your
  character would walk, in your user colour, with the distance.
- **Walls**: if the path would go through a wall it is cut at the wall, on the table *and* on your phone.
- **Release** the finger, then tap the **destination** to walk the token there, or double-tap anywhere else to cancel.
- **Turn**: press once and slide the finger away from the cell. An arrow shows the direction and the token turns
  toward the finger while you slide. No path is drawn.

The phone never loads the map. It only knows a grid of relative cells, the table screen (which has the walls)
does the collision check and answers. Everything runs through Foundry's own socket, there is nothing to host.

## Setup

1. Install the module and enable it in your world.
2. **Assign roles** (GM): *Game Settings -> Module Settings -> Roles and characters*. Per user pick a role:
   **Phone**, **Table screen**, **Normal Foundry** or **Auto** (small touch screens of players become phones), and
   which characters that user can use on the phone. Empty means every character the user owns.
   Only owned characters can be moved, so grant ownership in the actor's permissions.
3. **Table screen**: give the user you log in with on the shared display the role *Table screen* and have the scene
   you play on displayed there.
4. **Phones**: the first time, the module switches Foundry's client setting "Disable Canvas" on and reloads once.
   Every phone user needs a character and a token of it on the scene.

On the phone the header shows the character you are playing. Tap it to switch between your characters, sheet and
grid always follow the chosen one. The **X** top left leaves phone mode (until you close the tab; a small
*Phone mode* button in the normal UI takes you back).

Foundry's "Disable Canvas" setting is shared by every world in a browser. Phone mode switches it on while the
phone page is open and switches it off again when the page closes or reloads (so a phone page reloads twice). If a
browser was killed before it could clean up, the next load in a world with this module gives the canvas back. Worlds
without this module cannot do that, so untick *Disable Canvas* there by hand.

A single device can still be overridden with the client setting *This device is*, or with `?bmp=phone|table|off`
on the game URL.

## Limitations (v0.1)

- Square grids only. Hex and gridless scenes answer with an error.
- Wall check is centre point to centre point per step. Large tokens can be blocked less strictly than in the
  normal drag ruler.
- Distance is `cells x scene distance`, game-system diagonal rules and terrain cost are not applied.
- The sheet is Foundry's own sheet rendered read-only through CSS. How well a system's sheet lays out in a phone
  viewport depends on the system.
- The phone commits the move itself, so the player needs owner permission of the token (the normal case).
  No GM approval step.
- Verified against the Foundry v14.363 client source. v13 has fallbacks (`update` instead of `TokenDocument#move`)
  but is untested.

## Development

```
pnpm install
pnpm test          # path logic unit tests
pnpm typecheck
pnpm devwatch      # builds into devDir from package.json
pnpm release       # zip in package/
```
