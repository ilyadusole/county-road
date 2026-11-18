# County Road

A 3D free-roam driving sandbox for desktop browsers. Explore two connected country-road loops, cross the fields, or test the rear-wheel-drive sports car on the skidpad.

[Play County Road on GitHub Pages](https://ilyadusole.github.io/county-road/).

## Run locally

With Node.js 22.12 or newer, run:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite in a WebGL 2 browser. Connect a standard Xbox- or PlayStation-style controller and press a button while the game tab is focused.

| Action | Gamepad | Keyboard |
| --- | --- | --- |
| Steer | Left stick | A / D or left / right |
| Throttle | Right trigger | W or up |
| Brake | Left trigger | S or down |
| Look around | Right stick | |
| Toggle drive or reverse while stopped | A / Cross | F |
| Recover to the nearest road | Y / Triangle | R |

Open **Settings** or press **Esc** to change keyboard bindings and configure connected controllers or wheels. Pick a device, then select an axis or button directly or click **Detect** and move the control. Use the calibration buttons at each named position to set the range for a steering wheel, stick, or pedal. The reading shows the raw input followed by the calibrated input. Bindings are saved in this browser by device. Wheels and pedals need to be exposed by the browser as game controllers.

Each tire samples its own contact surface. Asphalt has sharper turn-in and stronger traction. Grass builds cornering force more slowly, adds rolling drag, and loses more grip at speed and when sliding.

Run `npm test` for simulation and input checks, and `npm run build` for the static build.

GitHub Actions tests and builds the game on pushes to `main`, then publishes it to GitHub Pages.
