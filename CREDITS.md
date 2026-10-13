# Credits and licences

The source code is MIT (see `LICENSE`). Everything below has its own terms.
If you fork this, these are the parts to check rather than assume.

## Map and network data: attribution required

Everything in `data/` is **© OpenStreetMap contributors, licensed
[ODbL](https://opendatacommons.org/licenses/odbl/)**, fetched through the
Overpass API. The attribution has to appear wherever the game is played; the
landing page carries it.

- `platforms.json`: platform outlines and subway track geometry, distilled
  into `centrelines.json` and `legs.json`
- `routes.json`: the metro's route relations, distilled into
  `platform-plan.json`

## Art

- Creature sprites in `public/assets/` (`vatte-runner.png`,
  `vatte-spitter.png`, `troll.png`): from
  **[Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon)** by Kenney,
  **CC0**. Credit is voluntary, and given gladly.
- The cave spider (`public/assets/fauna/`): original art made for this game,
  MIT like the rest of the source.
- Everything else the game draws is generated at runtime from code
  (`src/render/`) and is MIT like the rest of the source.

If you add art, put it in `public/assets/` and add its licence here.

## Fonts

Archivo, Barlow and IBM Plex Mono, loaded from Google Fonts under the
[SIL Open Font License](https://openfontlicense.org).

## Headlines

The landing page's DAGENS TEA shows entertainment headlines from Aftonbladet
and Expressen, fetched at build time from their public RSS feeds. Each one is
credited and links to its article. The headlines belong to the papers.

## Not licensed for reuse

The game's logo and visual identity. Fork the code, and give your fork its own
name and look.
