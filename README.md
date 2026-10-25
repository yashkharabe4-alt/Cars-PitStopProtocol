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

## Player flow

1. Enter a team or driver name, choose red, blue, or yellow, then confirm the car. The showroom animation transitions into the qualifying quiz.
2. Players answer three qualifying questions. Wrong answers count as zero and do not prevent entry.
3. The organizer opens **Race Control** at the bottom right, enters the `ADMIN_TOKEN` from `.env`, and selects **Start Race** when the grid is ready. Qualified drivers launch in quiz completion order. Players who qualify after the race starts join the next grid slot.
4. Use **End Race** to finish early. Otherwise the race ends automatically after the configured duration. Official results are displayed to all connected players; the organizer can also use **Display Results** after the finish.

## Organizer controls

Keep the Node server running in the VS Code terminal with `npm start`; this terminal is for starting/stopping the server process, not controlling each race. Use the **Race Control** panel in the browser for event operations. The admin token is `ADMIN_TOKEN` in `.env` and should be kept private. For production, set a strong unique token in the hosting environment. The server binds to the `PORT` supplied by the host, falling back to 3000.

To end the server itself, focus the VS Code terminal running `npm start` and press **Ctrl+C**. That stops the website/game server until `npm start` is run again.

After a race ends, entering the garage again automatically creates a fresh lobby, while preserving prior records in SQLite.

## Controls

- W / Up: accelerate
- S / Down: brake
- A / Left and D / Right: steer

Car faults show a single repair question. A wrong answer cannot be retried and limits the car to 40 km/h.

## Data and limitations

Race records are stored in `./data/pitstop.sqlite`. CSV and Excel result endpoints remain available for later organizer tooling. Three.js and fonts load from public CDNs, so the browser needs internet access for those assets.

Vehicle positions and checkpoints are simulated in the browser. Finish events are client-reported, so this prototype is not cheat-proof and has not been load-tested for a large event. Use a persistent Node server for multi-device sessions.
