# PWA Icons

The manifest.json references two icon files:
- icon-192.png (192x192)
- icon-512.png (512x512)

To generate these from favicon.svg, use one of these methods:

## Option 1: Using ImageMagick
```bash
convert -background none -resize 192x192 ../favicon.svg icon-192.png
convert -background none -resize 512x512 ../favicon.svg icon-512.png
```

## Option 2: Using rsvg-convert
```bash
rsvg-convert -w 192 -h 192 ../favicon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 ../favicon.svg -o icon-512.png
```

## Option 3: Using Inkscape
```bash
inkscape ../favicon.svg --export-type=png --export-width=192 --export-filename=icon-192.png
inkscape ../favicon.svg --export-type=png --export-width=512 --export-filename=icon-512.png
```

## Option 4: Online Tool
Upload favicon.svg to https://realfavicongenerator.net/ or similar PWA icon generator.

For now, the app will work without icons but browsers won't show them during installation.
