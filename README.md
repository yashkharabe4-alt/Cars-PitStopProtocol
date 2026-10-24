<<<<<<< HEAD
# Pit Stop Protocol

Browser-based 3D racing and programming challenge game for the TechFlix event. The repository was empty before this implementation, so this is the initial application foundation.

## Features

- Three.js arcade circuit, third-person chase camera, keyboard controls, speed/progress HUD, and locally simulated AI traffic.
- Lobby registration, three-question qualifying challenge, organizer start, shared server-issued start timestamp, and a live leaderboard.
- Server-assigned programming repair questions for engine, brake, fuel, temperature, and speed faults. Wrong answers leave the player stopped; the server validates correct answers.
- SQLite storage for participants, races, faults, repair attempts, and official result submissions.
- Organizer XLSX and CSV exports from the database.

## Run locally

Requires Node.js 20 or later and npm. In PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

Open <http://localhost:3000>. The first participant joins the lobby; enter the admin token in Organizer controls, then select **START RACE**. For a local demo, set `ADMIN_TOKEN=` in `.env` to disable organizer-token checks. The default race is `main-event`, the countdown is five seconds, and SQLite is stored in `./data/pitstop.sqlite`.

The page loads Three.js and fonts from public CDNs, so the browser needs internet access for those assets. Host the Node process on one persistent server and expose its HTTP/Socket.IO port to participants on the same network or over the internet. Set a long random `ADMIN_TOKEN` before a public event. Back up the `data` directory after the event.

## Controls

- W / Up: accelerate
- S / Down: brake
- A / Left and D / Right: steer

The organizer can export `pitstop-results.xlsx` or CSV from the landing page. Race reset archives the old race records in the database and opens a fresh lobby with the configured race ID.

## Race integrity and deployment limits

The server owns the scheduled start, question assignment, answer validation, and result persistence. Vehicle positions and checkpoints are simulated in the browser; finish events are client-reported and are not cheat-proof. This prototype does not claim authoritative checkpoint verification or load testing for 40 simultaneous users. For a prize-bearing event, add server-validated checkpoint progression, TLS, organizer authentication beyond a shared token, and conduct multi-device/load testing before deployment. SQLite is intended for one server process with persistent disk, not multiple independent server instances sharing a file.

## Status

Implementation source is present. Dependency installation, browser play-through, multi-session tests, persistence restart test, and export validation remain to be run in an environment with npm and a browser. This shell had Node.js available but no npm executable, so those runtime checks could not be completed here.
=======
# Cars-PitStopProtocol
AI-powered racing quiz game with real-time scoring, intelligent traffic simulation, and Excel-compatible score tracking. 🏎️
>>>>>>> c02100629f04064557baeaaf537fc003dd5da4ce
