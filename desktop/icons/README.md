# LLCApp Desktop Icons

Place your app icons here:
- icon.png (256x256 for Linux/tray)
- icon.ico (Windows)
- icon.icns (macOS)
- tray.png (16x16 or 22x22 for system tray)

Generate icons from a base image using electron-icon-builder or similar tool.

## Quick Icon Generation

If you have a source PNG image, you can use online tools or CLI tools:

```bash
# Using electron-icon-builder (npm package)
npm install -g electron-icon-builder
electron-icon-builder --input=./source.png --output=./

# Or use online converters:
# - https://www.icoconverter.com/ (for .ico)
# - https://iconverticons.com/online/ (for .icns)
```

## Placeholder Icons

For development, you can temporarily skip icons. Electron will use default system icons until proper icons are added.
