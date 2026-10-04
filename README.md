# Beaver's Mobile Pawn
![Foundry Core Compatible Version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Fstyle%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-mobile-pawn%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Foundry System](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fsystem%3FnameType%3Draw%26showVersion%3D1%26style%3Dflat%26url%3Dhttps%3A%2F%2Fgithub.com%2FAngryBeaver%2Fbeavers-mobile-pawn%2Freleases%2Flatest%2Fdownload%2Fmodule.json)
![Download Count](https://img.shields.io/github/downloads/AngryBeaver/beavers-mobile-pawn/total)
![Lint & Test](https://github.com/AngryBeaver/beavers-mobile-pawn/actions/workflows/lint.yml/badge.svg)

For **in-person game nights**: play old-school D&D around one table, with a few upgrades over pen and paper.

- Your **character sheet** is on your mobile device instead of on paper. A tablet works best: most game systems'
  sheets are too wide for a phone screen use a tablet or see [Beaver's Mobile](https://github.com/AngryBeaver/beavers-mobile)
- Instead of miniatures and map tiles there is a **screen on the table** (a TV laid flat, or a monitor) showing the
  map in Foundry VTT.
- Your mobile device is the **gamepad for your character**: walk it, turn it, open doors.

Everything else stays at the table on purpose: you roll real dice, the GM runs initiative, and you talk to each other
instead of clicking buttons. The module only replaces the parts of paper and map.

## Example
### Display of the app tab characktersheet on a tablet:
https://github.com/user-attachments/assets/69368796-1dac-4ca5-a993-665a99b16b50
### Moving the token on the table screen:
https://github.com/user-attachments/assets/3611a07c-2626-4301-a81a-7a68d406cc00

## How it works

- **Mobile device**: you only see your character sheet (read-only). Swipe sideways to a grid. Double-tap the grid where your
  character is and keep your finger down on the second tap, then drag: you see the path you draw.
- **Table screen**: a second Foundry login on the shared display shows the map and highlights the path your
  character would walk, in your user colour, with the distance.
- **Walls**: if the path would go through a wall it is cut at the wall, on the table *and* on your mobile.
- **Release** the finger, then tap the **destination** to walk the token there, or double-tap anywhere else to cancel.
- **Seat**: the GM sets per player which edge of the table screen they sit at (Module Settings, Roles and
  characters). Up on the mobile always means away from the player, so the path and turning match their view.
- **Turn**: press once and slide the finger away from the cell. An arrow shows the direction and the token turns
  toward the finger while you slide. No path is drawn.
- **Doors**: while turning, slide onto a cell next to yours. If a door is the nearest wall on the way to that cell,
  its line is drawn where it really is and Foundry's door icon shows in that cell. Plain walls are not shown.
  Release there, then tap the door to open or close it. Tap anywhere else to drop it. A locked door looks closed, it
  only shakes and says *Locked* when you try it. Secret doors count as plain walls.
- **Doors that move** (with [Beaver's Solid Doors](https://github.com/AngryBeaver/beavers-solid-doors)): the mobile
  shows the door where it stands. Tap opens it all the way or closes it; press the door and slide to open it just as
  far as you like, the door follows your finger and shows the angle (or percent for sliding doors). Slide it back to
  almost closed to close it.

The mobile never loads the map. It only knows a grid of relative cells, the table screen (which has the walls)
does the collision check and answers. Everything runs through Foundry's own socket, there is nothing to host. 

The idea originates based on the game sunderfolk

## Setup

1. Install the module and enable it in your world.
2. **Assign roles** (GM): *Game Settings -> Module Settings -> Roles and characters*. Per user pick a role:
   **Mobile**, **Table screen**, **Normal Foundry** or **Auto** (players' phones become mobiles; give tablets the
   *Mobile* role), and which characters that user can use on the mobile. Empty means every character the user owns.
   Only owned characters can be moved, so grant ownership in the actor's permissions.
3. **Table screen**: give the user you log in with on the shared display the role *Table screen* and have the scene
   you play on displayed there.
4. **Mobiles**: the first time, the module switches Foundry's client setting "Disable Canvas" on and reloads once.
   Every mobile user needs a character and a token of it on the scene.

On the mobile the header shows the character you are playing. Tap it to switch between your characters, sheet and
grid always follow the chosen one. The **X** top left leaves mobile mode (until you close the tab; a small
*Mobile mode* button in the normal UI takes you back).

Foundry's "Disable Canvas" setting is shared by every world in a browser. Mobile mode switches it on while the
mobile page is open and switches it off again when the page closes or reloads (so a mobile page reloads twice). If a
browser was killed before it could clean up, the next load in a world with this module gives the canvas back. Worlds
without this module cannot do that, so untick *Disable Canvas* there by hand.

A single device can still be overridden with the client setting *This device is*, or with `?bmp=phone|table|off`
on the game URL.

## Limitations (v0.1)

- Square grids only. Hex and gridless scenes answer with an error.
- Wall check is centre point to centre point per step. Large tokens can be blocked less strictly than in the
  normal drag ruler.
- Distance is `cells x scene distance`, game-system diagonal rules and terrain cost are not applied.
- The sheet is Foundry's own sheet rendered read-only through CSS. How well a system's sheet lays out on a mobile
  viewport depends on the system. For dnd5e, [Beaver's Mobile](https://github.com/AngryBeaver/beavers-mobile)
  (recommended, optional) adds a character sheet laid out for a phone's width; Mobile Pawn shows it like any other.
- The mobile commits the move itself, so the player needs owner permission of the token (the normal case).
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
