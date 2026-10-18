# Research: four add-ons as inspiration (2026-10-13)

> The lead's summary of the research report (sources: only public product
> pages, documentation, FAQs, changelogs and reviews; no code or assets
> from the products). The decisions are in `docs/STUDIO-TOOLS.md`.

## Lighting tool (Light Wrangler, paid, Superhive)

- Cursor placement in three modes: **reflection** (the highlight lands where
  you point), **direct** and **orbit**; smoothed normal with a precise mode;
  obstacle avoidance; power, size, distance and aperture adjusted with the
  wheel; initial size based on the selection; automatic power when size or
  distance changes.
- Per-light modes: texture on the light, procedural *scrim* (feather,
  tilt, imperfection, bias), gobos (115, with animation), IES (30
  included), flags and reflectors with *keep upright*; diffuse/specular
  balance per light (done with auxiliary lights); per-object light and
  shadow linking; solo; false colour by zones; *bake the setup to HDRI* for
  other engines; flicker.
- Complaints: no light setup presets and no fine control over linking; IES
  in only one engine; textures downloaded online.
- Sources: https://superhivemarket.com/products/light-wrangler ,
  https://blenderlighting.com/light-wrangler/docs/ ,
  https://blenderlighting.com/light-wrangler/changelog/

## "HDRI Studio Pro" and shape-based environment editors

- The product with that name is **a pack of 35 static HDRIs**, not a
  tool (https://superhivemarket.com/products/hdri-studio-pro). Painting
  shapes onto the sphere and baking is done by others: *pin*-based
  editors (softbox, strip, spot, gradient, *scrim* with a hot spot, image,
  flag that removes light; brightness or temperature from 1,000 to
  12,000 K, size, rotation, edge softness; *place highlight* with one
  click; export 32-bit EXR up to 4k), brushes on the sphere and
  mathematical softboxes in the world shader. KeyShot Pro's HDRI editor
  works on the same pin idea.
- Sources: https://superhivemarket.com/products/latitude/docs ,
  https://extensions.blender.org/add-ons/hdri-lightbrush/ ,
  https://superhivemarket.com/products/procedural-studio-hdri

## Lens simulation (Lens Sim)

- Traces every ray through a real prescription (surfaces, glass, diaphragm)
  in a camera shader (earlier versions: real geometry with
  portals); the output includes chromatic aberration (one wavelength per ray, with
  noise), vignetting, distortion, softness, focus breathing and natural
  bokeh. About 65 lenses built from patents, from every
  family (fisheyes, anamorphics, macro, soft lenses, zooms, Petzval,
  Gauss, telephotos); tools for *tilt-shift*, *split diopter*,
  lens dirt, extra distortion, counter-zoom, colour filter,
  bloom, bokeh swirl, diaphragm image, on-screen CA,
  anamorphic desqueeze; schematic lens viewer.
- Complaints: no flare, more noise with CA, resolution changes when the lens
  changes, vignetting that ruins the passes.
- Sources: https://superhivemarket.com/products/lens-sim ,
  https://superhivemarket.com/products/lens-sim/docs

## Prefabricated camera moves (Cinepack)

- More than 110 moves in categories (cinematic, pans, speed
  ramps, push-ins and pull-outs, flights, zooms, handheld camera,
  action), video preview, adjustable speed, duration, scale and field of
  view, drawing the path, target lock, flight
  recorded with the mouse, output aspect ratios.
- Complaints: awkward to edit (constraints), scene scale set by hand.
- Sources: https://superhivemarket.com/products/cinepack-pre-animated-camera-moves ,
  https://garagefarm.net/blog/how-to-move-cameras-in-blender-like-a-cinematographer-using-cinepack
