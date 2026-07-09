# Build assets

## App icon

`icon.svg` is the source of the SomedayWriter app icon (the serif **SW**
monogram on a warm-ink tile). electron-builder consumes a raster `icon.png`
(≥ 512×512; it derives `.icns`/`.ico` from it), so the SVG must be rasterized
into this folder before packaging.

The SVG references a serif stack ending in Georgia, so rasterize on a machine
that has one of those faces installed (macOS/Windows both do).

```sh
# Any one of these — whichever tool is installed:
rsvg-convert -w 1024 -h 1024 build/icon.svg -o build/icon.png
# or
inkscape build/icon.svg -w 1024 -h 1024 -o build/icon.png
# or (Node):  npx sharp-cli -i build/icon.svg -o build/icon.png resize 1024
```

Then electron-builder (once configured — see the deferred build/release setup)
picks up `build/icon.png` automatically.
