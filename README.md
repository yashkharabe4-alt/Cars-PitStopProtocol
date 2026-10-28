# Pit Stop Protocol

A browser-based 3D racing and quiz prototype for the TechFlix event.

## Run locally

Requires Node.js 20 or later and npm. In PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

Open <http://localhost:3001> (or the port configured in `.env`).

## Deploy to Render

ADMIN TOKEN: replace-with-a-long-random-token
This project includes a `render.yaml` Blueprint. In Render, choose **New → Blueprint**, connect this GitHub repository, and deploy the `main` branch. The Blueprint installs dependencies with `npm ci`, starts the Node server, configures `/api/health` as the health check, generates an `ADMIN_TOKEN`, and stores SQLite at `/var/data/pitstop.sqlite` on a persistent disk.

The included setup uses a paid web service and a persistent disk because race results must survive restarts and deployments. Render's free web services have ephemeral filesystems and can spin down while idle, so they are unsuitable for a live event that must retain SQLite records. The app uses one Socket.IO server instance and SQLite on a single persistent disk; keep it at one instance. Render supports WebSockets, and the app binds to Render's `PORT` on `0.0.0.0`.

After deployment, copy the generated `ADMIN_TOKEN` from the service's environment settings into Race Control. Keep it private. Do not reuse the local `.env` token. Add a custom domain in Render if desired. For reliable event data, download the Excel results after the event and keep a separate backup; a persistent disk protects data across ordinary deploys and restarts but is not a substitute for a backup.

The deployment health check is available at `/api/health`.

## Player flow

1. Enter a team or driver name, choose red, blue, or yellow, then confirm the car. The showroom animation transitions into the qualifying quiz.
2. Players answer three qualifying questions. Wrong answers count as zero and do not prevent entry.
3. The organizer opens **Race Control** at the bottom right and selects **Start Race** when participants are ready. Each driver races their own session independently.
4. Each driver's elapsed time is saved on finish. Use **End Race** to close the event and mark any unfinished runs as did not finish. The public screen only shows the race status.

## Organizer controls

Keep the Node server running in the VS Code terminal with `npm start`; this terminal is for starting/stopping the server process, not controlling each race. Use the **Race Control** panel in the browser for event operations. Enter the admin token (`ADMIN_TOKEN` in `.env`) to unlock the Excel and CSV export buttons after the event ends. The token is validated by the server and should be kept private. For production, set a strong unique token in the hosting environment. The server binds to the `PORT` supplied by the host, falling back to 3000.

To end the server itself, focus the VS Code terminal running `npm start` and press **Ctrl+C**. That stops the website/game server until `npm start` is run again.

After a race ends, entering the garage again automatically creates a fresh lobby, while preserving prior records in SQLite.

## Controls

- W / Up: accelerate
- S / Down: brake
- A / Left and D / Right: steer

Car faults show a single repair question. A wrong answer cannot be retried and limits the car to 40 km/h.

## Data and limitations

Race records are stored in `./data/pitstop.sqlite`. The protected Excel and CSV exports include each participant's race time in seconds and milliseconds. Three.js and fonts load from public CDNs, so the browser needs internet access for those assets.

Vehicle positions and checkpoints are simulated in the browser. Finish events are client-reported, so this prototype is not cheat-proof and has not been load-tested for a large event. Use a persistent Node server for multi-device sessions.
