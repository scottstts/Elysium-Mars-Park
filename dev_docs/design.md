# Mars Park — Game Design (Canon)

> **Status: CONFIRMED** by Scott on 2026-08-10 (Q&A decisions integrated throughout; log at bottom). Implementation plan: `dev_docs/plan.md`.

## The fantasy in one line

You are the newest colonist on Mars, and this is your first afternoon in the park they built for a city that hasn't arrived yet — half a kilometer of glass over the only green on the planet.

## What kind of game this is

A first-person "walking wonder" experience. The game *is* the place. Design references are civic-space craft — how a great plaza, botanical conservatory, or national-park overlook paces sightlines and reveals — more than other video games. The park is pristine, maintained, and benevolent; the emptiness reads as *hope*, never horror. Nothing is wrong here. Nothing was ever wrong here.

## Art direction (the north star)

**Grounded NASA-punk photorealism.** Everything is engineered: shipped from Earth or printed from regolith, load-rated, labeled, maintainable. No ornament without function — the beauty comes from honest structure, real scale, and one authored moment of light. Physically based rendering, correct sun, correct gravity, correct materials.

The palette is the design: **butterscotch sky, rust-ochre regolith, white-painted steel, bare alloy, international-orange handrails — and green as the rarest color in the world.** Green is the attention currency; it appears only where life actually is, and every instance of it is precious.

This is **not a garden.** The park is Martian — mineral, raked, boulder-strewn, sparse. The colonists didn't paste Earth onto Mars; they made Mars itself walkable and dear.

## The core world model

- **The eternal late afternoon.** One frozen moment: sun at ~27° elevation, WSW. No day/night cycle, no time lapse, no weather changes. Every shadow in the park is a permanent, authored piece of architecture — the dome lattice lays a fixed net of light across the ground. The only moving shadows belong to the machines.
- **Interior only.** You never leave pressurized space. Mars outside is a masterfully rendered vista through the glass — the dead planet is always present, from everywhere, because the park only means something against the void.
- **True Mars gravity, 0.38 g, everywhere.** Your jumps are long and floaty; anything that falls, falls slow. The gravity is the one "toy" you carry at all times.
- **Nobody home but you — except the robots.** No humans, no animals, no birds, no insects. The maintenance robots are the park's staff and its only other citizens. (The colonists exist — about eighty of them, at work elsewhere in the settlement. The park was built for ten thousand.)
- **Walk + contextual interaction.** Doors, buttons, benches, the tram. The world responds; there are no mechanics to "play", no objectives, no fail states.

## Premise & fiction (ambient only)

**Elysium Base**, Elysium Planitia. The settlement's founders made a decision history will argue about: before the city, they built the park. **Elysium Commons**, under **Dome One**, sized for the metropolis that is still on its way — eighty colonists, four thousand empty seats, and machines keeping everything ready. You landed this morning. Someone told you to go see the Commons before you report anywhere.

Story is delivered only by the environment: capacity signage for crowds that don't exist yet, a jacket left on a porch chair, painted-on eyes someone gave a groundskeeper robot, the harvest log chalkboard in the greenhouse, desire-line paths worn toward the best view. The quiet theme: *the park is a promise.*

No dialogue, no audio logs, no text walls, no quests.

## The setting

Elysium Planitia, ~3°N — flat volcanic plain, boulder fields, low mesas west, a shallow crater rim south, one or two dust devils drifting far off catching the light. **Dome One**: a glass spherical cap **500 m across, ~120 m at the crown**, triangulated lattice on great meridian ribs, panels of green-edged ISRU glass melted from Martian sand. Outside, dust films the lower panels except where the washer robot has passed — clean swaths of clarity in a dirty gradient. Inside: ~19 hectares of sculpted regolith landscape, sintered-brick paths, and interleaved districts — leisure heart, a residential arc, working agriculture, and the life-support machinery that keeps it all breathing, celebrated rather than hidden.

## Places

1. **Portal Station (south).** Where you arrive: the tram bursts from the dark connector tube through an irising portal, and the whole Commons unrolls ahead while you're still rolling. The station terrace is the park's front porch and first overlook.
2. **The First Tree (center).** A single ginkgo, twelve meters tall, in a raised ring of true soil — the only large tree on Mars. A ring of benches. A small collar of groundcover at its base, the densest green outside the greenhouse. The park's heart and its only monument.
3. **The Meridian Walk.** The main promenade from Portal Station to the First Tree and on to the west rim — the spine every other path hangs off.
4. **The Regolith Gardens.** Raked regolith in long spiral rakings, excavation boulders placed like sculpture, bounded beds of sparse sedge and hardy groundcover. A Martian dry garden — the park's contemplative core, and proof this is not Earth.
5. **The Rim Promenade & Overlook Lounge (west).** A walkway tracing the dome wall where glass meets regolith, facing the afternoon sun and the open plain. The **Overlook Lounge** (enterable): warm interior, long window, chairs aimed at nothing but Mars.
6. **The Amphitheater.** A bowl of regolith-cast seating facing west through the glass — built for premieres and assemblies that haven't happened yet. Four thousand seats, all empty, all lit.
7. **Residential Arc (northwest).** Ten hab units with porches facing the park — because humans build porches. One personal touch per porch. The **Common Hab** (enterable): kitchen, mismatched chairs, a board game mid-play. Nearby, a small bright playground, plaque reading *donated by the crew of Ares VII* — built for children not yet born.
8. **Farmside (east).** The working greenhouse ranges: long vaulted glasshouses blazing green through their panes. The **Greenhouse Hall** (enterable): hydroponic racks, grow-light gradient mixing with the low sun, misting cycles that fill the aisles with brief drifting fog. The one place the world is dense with life.
9. **The Works (northeast).** Life support, honored: atmosphere processors, water reclaimers venting soft vapor, the gleaming tank farm, radiator fields, the tram depot, and the **maintenance yard** where robots dock and charge. An elevated **gallery walk** (enterable ops room at its end) runs through the machine hall — dashboards live-mirroring the park's actual systems: dome pressure, tram position, robot task queue.
10. **The Loop.** The tram itself: a ~1.2 km circuit with three stations (Portal, Overlook West, Farmside), running its quiet timetable forever. Re-ridable; the moving tour of everything above.

## The robots

The only moving life, each a character through work alone: **groundskeepers** (low, wheeled, raking and tending), a **path sweeper**, a **cargo mule** trundling between Farmside and the depot, the dormant charging row in the yard — and the **Panewalker**, the dome-washing gantry crawling glacially along the lattice high overhead, the park's gentle giant. When it crosses the sun, its shadow sweeps the ground like a slow cathedral cloud — the only weather on Mars.

## The session

No saves, no persistence, no pressure — every visit is this one afternoon. The park breathes on its machinery instead of a crowd: the tram's timetable, the robots' task rotations, the greenhouse misting cycle, the Panewalker's twenty-minute traverse. You arrive by tram; after that the afternoon is yours.

## The complete verb list

Walk and sprint (a low-G lope); **jump** — real 0.38 g arcs, the standing invitation everywhere; ride the Loop; sit (benches, amphitheater rows, lounge chairs, porch steps); open doors and enter the four hero interiors; press what's pressable (door controls, tram call plates, the misting override in the greenhouse); watch the robots work. That's the whole game, on purpose.

## Look, sound, feel — six pillars

1. **The lattice is the light.** The dome's fixed shadow-net across the ground is the game's signature graphic — permanent, learnable, architectural.
2. **Green is currency.** The eye goes where life is because color goes where life is. One tree, bounded beds, and a glowing greenhouse carry the entire green budget.
3. **The outside is always present.** The empty planet through every pane; the park reads as one warm room in an infinite cold house.
4. **Everything is engineered.** Honest structure, stencil signage, labeled conduit, orange handrails — beauty through competence, not decoration.
5. **Emptiness as hope.** Four thousand seats and you. Pristine, ready, waiting — never eerie. Anti-BioShock, anti-ruin.
6. **The dome has a voice.** A vast soft room-tone: air handlers breathing, glass ticking in the heat, your footsteps changing across regolith, brick, and deck plate; a robot's servo dopplering past; the tram's distant rail-sing. No music — the colony is the soundtrack.

## Ten postcard moments (the visual contract)

1. The portal irises open and the tram rolls into the light — the whole Commons revealed at speed.
2. The First Tree, lone green against butterscotch sky through glass.
3. The Rim Promenade: the plain to the horizon, one dust devil drifting, your ghost-reflection in the pane.
4. The Panewalker crossing the sun, its shadow sweeping the Regolith Gardens.
5. Greenhouse Hall interior: grow-light green against low amber sun, mist rolling the aisles.
6. The Amphitheater's four thousand empty seats in raking light.
7. The Works from the gallery walk: the machine hall alive, vapor curling in a sunbeam.
8. A hab porch: jacket on the chair, long shadows, home.
9. Raked spirals of the Regolith Gardens under the crown of Dome One.
10. Mid-jump on the Meridian Walk: two floaty seconds, park spread beneath your arc.

## What this game is NOT

No combat, no death, no timers, no HUD, no quests, no minimap, no saves, no economy, no crafting, no horror turn. No day/night cycle, no weather changes, no EVA, no airlock you can operate. No open water anywhere — water lives in pipes and greenhouse mist. No humans, no animals, no music. Not a lush garden — a Martian commons. One place, one frozen afternoon, made as real as we can make it.

## Confirmed-decisions log (Scott, 2026-08-10)

- Dome ~500 m diameter; NASA-punk aesthetic; interleaved mixed-use layout.
- **Single frozen time** — one afternoon, sun in the sky; explicitly no time lapse of any kind. Sun locked at late-afternoon (~27° elevation).
- Interactivity: walk + contextual only (no physics playground, no objectives).
- Interior only — no EVA, outside is vista.
- True 0.38 g for player and everything else.
- Inhabitants: maintenance robots **only** (no birds/insects/humans).
- Vegetation deliberately sparse and Mars-feeling — "it shouldn't feel like Earth… I don't want it to be a garden-like place."
- No open water features.
- Narrative: environmental storytelling only. Audio: ambient soundscape, no music.
- Arrival: tram ride reveal; tram remains re-ridable in-park transit.
- Interiors: four hero interiors (Greenhouse Hall, Overlook Lounge, Ops Room, Common Hab); all other structures sealed.
- Stack: vanilla TS (React removed), three/webgpu + TSL, Rapier physics — per SeaPark precedent.
