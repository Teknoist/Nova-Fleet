# Nova Fleet

Nova Fleet is a local-first desktop and Android printer manager for Nova3D-style resin printers and SDCP 3.0 compatible printers. It is built for managing multiple printers from one clean interface without a cloud account.

[Türkçe README](README.tr.md)

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-1f6feb)
![Electron](https://img.shields.io/badge/Electron-43-9feaf9)
![License](https://img.shields.io/badge/license-MIT-a9f4c7)

## Screenshots

![Overview dashboard](docs/screenshots/overview.png)

![File center](docs/screenshots/file-center.png)

![Printer profiles](docs/screenshots/printers.png)

## Install on a new computer

Normal users do not need Node.js, Java, Android Studio, or any developer tooling.

1. Open the repository **Releases** page.
2. Download the latest `Nova-Fleet-Setup-x.x.x.exe` installer.
3. Run the installer.
4. Choose the installation folder and complete setup.
5. Start **Nova Fleet** from the desktop shortcut or Start Menu.

The Windows installer is not code-signed yet. Windows SmartScreen may show a warning. If you downloaded the installer only from this repository's Releases page, use **More info → Run anyway**.

## Adding printers

1. Make sure the computer and printer are on the same local network.
2. Open **Add printer** in Nova Fleet.
3. Select the printer protocol:
   - **Nova / Photonic3D** for Nova3D HTTP printers, usually port `8081`.
   - **SDCP 3.0** for newer SDCP printers, usually TCP `3030` plus UDP discovery on `3000`.
4. Enter the printer name and local IP address.
5. Keep the polling interval at `10 seconds` or higher for older firmware.
6. Save the profile and wait for the printer to become online.

The app includes demo printers on first launch. You can delete the `demo-1`, `demo-2`, and `demo-3` profiles from the Printers page.

## Features

- Multi-printer fleet dashboard.
- Online, printing, paused, error, and offline state tracking.
- Nova3D `.cws` file listing, upload, delete, and print commands.
- SDCP 3.0 WebSocket status monitoring.
- SDCP 3.0 `.ctb` file listing through the protocol file-list command.
- Active job progress, layer count, elapsed time, and print metadata.
- Pause/resume/stop controls for supported Nova3D printers.
- Per-printer IP, port, protocol, model, location, and polling interval.
- Local LAN operation with no cloud account.
- Turkish and English interface support.

## SDCP 3.0 support

SDCP 3.0 support is implemented for status monitoring and file listing:

- UDP discovery uses `M99999` on port `3000`.
- Status uses `ws://PRINTER_IP:3030/websocket` with SDCP command `0`.
- File listing uses SDCP command `258` and checks common storage paths such as `/local/` and `/usb/`.

SDCP upload and print commands are intentionally not enabled yet. This avoids sending unsafe commands until the target printer behavior is verified.

## Android app

The Android app provides the same fleet-management interface for local-network use. GitHub Actions builds an installable debug APK:

1. Open the repository **Actions** page.
2. Select **Build Android APK**.
3. Open the latest successful run.
4. Download the APK artifact.
5. Transfer the APK to the Android device and install it.

The phone and printers must be on the same Wi-Fi/LAN.

## Troubleshooting

### Printer appears offline

- Confirm the computer and printer are on the same LAN/VLAN.
- For Nova3D printers, open `http://PRINTER_IP:8081/file/list` in a browser.
- For SDCP printers, make sure Windows Firewall allows Nova Fleet on private networks.
- For SDCP printers, allow UDP `3000` and TCP `3030` on the local network.
- Check that the printer IP did not change because of DHCP.
- Restart the printer if its embedded HTTP/WebSocket service becomes unresponsive.

### File list is empty

- Nova3D printers usually expose `.cws` files through `/file/list`.
- SDCP 3.0 printers usually expose `.ctb` files through command `258`.
- Make sure the printer storage path is available and the printer is not busy scanning or writing files.

### Upload fails

- Nova3D upload expects `.cws` files.
- Make sure the printer has enough free storage.
- Keep the printer online during the whole upload.
- Large files may take several minutes.

## Developer setup

Requirements: Node.js 24 and npm.

```powershell
git clone https://github.com/Teknoist/Nova-Fleet.git
cd Nova-Fleet
npm install
npm run dev
```

Checks and production build:

```powershell
npm test
npm run lint
npm run build
```

Windows installer:

```powershell
npm run package:win
```

Android web sync:

```powershell
npm run android:sync
```

Android debug APK on a development machine with Android SDK:

```powershell
cd android
.\gradlew.bat assembleDebug
```

## Protocol notes

Nova3D HTTP printers use local endpoints such as:

- `GET /file/list`
- `POST /file/upload/{filename}`
- `GET /file/delete/{filename}`
- `GET /file/print/{filename}`
- `GET /job/list/`
- `GET /job/toggle/{jobId}`
- `GET /job/stop/{jobId}`

SDCP 3.0 printers use UDP discovery and WebSocket command envelopes. Test the first real print under supervision because firmware behavior can differ by model.

## Security

These local printer APIs usually do not provide authentication. Use printers only on trusted LAN/VLAN networks and do not expose ports `8081`, `3000`, or `3030` to the internet.

## License

MIT — see [LICENSE](LICENSE).
