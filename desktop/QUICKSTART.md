# LLCApp Desktop - Quick Start Guide

Phase 3 Electron Desktop Wrapper

## Installation

```bash
cd C:\Users\daley\Projects\LLCApp
npm install
```

This will install:
- `electron@^33.0.0` (~200MB download)
- `electron-builder@^25.0.0`

## Running

```bash
npm run desktop
```

Expected behavior:
1. Express server starts on random port
2. Electron window opens
3. Web dashboard loads
4. System tray icon appears

## Quick Commands

| Command | Description |
|---------|-------------|
| `npm run desktop` | Launch desktop app |
| `npm run build-desktop` | Build installer |
| `npm run server` | Run server only (no Electron) |
| `npm run dev` | Run server in dev mode |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N / Cmd+N | New Session |
| Ctrl+O / Cmd+O | Select Project |
| Ctrl+Q / Cmd+Q | Quit |
| F12 | Toggle DevTools |

## Native Features

### File Picker
```javascript
// In web frontend (if window.electron exists)
const path = await window.electron.selectDirectory();
```

### Notifications
```javascript
window.electron.showNotification('Title', 'Message');
```

### Detect Electron
```javascript
if (window.electron?.isElectron) {
  // Use native features
}
```

## System Tray

- Close window = minimize to tray (doesn't quit)
- Double-click tray icon = restore window
- Right-click tray icon = context menu
- File > Quit = actually quit

## Troubleshooting

### Window doesn't open
```bash
# Test server standalone
node bin/llcapp-server.js
```

### Electron not found
```bash
npm install electron --save-dev
```

### Port conflicts
App finds available port automatically. Check firewall if issues.

## Building Installers

```bash
npm run build-desktop
```

Output in `dist-electron/`:
- Windows: `LLCApp-Setup-3.0.0-alpha.exe`
- macOS: `LLCApp-3.0.0-alpha.dmg`
- Linux: `LLCApp-3.0.0-alpha.AppImage`

## Icons (Optional)

Add to `desktop/icons/`:
- `icon.png` - 256x256 for Linux
- `icon.ico` - Windows
- `icon.icns` - macOS
- `tray.png` - 16x16 for system tray

Generate with:
```bash
npm install -g electron-icon-builder
electron-icon-builder --input=source.png --output=desktop/icons/
```

## Documentation

- `desktop/README.md` - Detailed desktop docs
- `PHASE3-DESKTOP.md` - Phase 3 overview
- `desktop/IMPLEMENTATION.md` - Implementation details

## Support

File issues at: https://github.com/GrizzwaldHouse (if repo is public)

---

**Quick Reference:**
- Desktop app wraps the Phase 2B web dashboard
- All Phase 1/2A/2B features still work
- Adds native OS integration (file picker, tray, notifications)
- No code changes needed to existing phases
