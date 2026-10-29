# Pit Stop Protocol

A browser-based 3D racing and quiz prototype for the TechFlix event.

## Run locally

Requires Node.js 20 or later and npm. Create a Supabase project, run [supabase/schema.sql](supabase/schema.sql) in its SQL Editor, and copy the Project URL and anon/publishable key into `public/supabase-config.js`. Create `.env` from `.env.example` and set the Supabase service role key plus a unique admin token. Then run:

```powershell
npm install
npm start
```

Open <http://localhost:3001>.

## Deploy on Vercel + Supabase

1. Create a Supabase project and run the full `supabase/schema.sql` script in **SQL Editor**.
2. In Supabase **Project Settings → API Keys**, copy the Project URL and publishable key.
3. In Vercel, import this GitHub repository as a project. Keep the project root at the repository root; no custom build command is needed.
4. In Vercel **Settings → Environment Variables**, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `ADMIN_TOKEN`. Use Supabase's new secret key (or legacy service-role key if that's what your project shows). Optionally set `RACE_DURATION_SECONDS` (default 7200). The API exposes only the publishable key to the website; keep the secret key and admin token private.
5. Deploy, open the website, and verify the status indicator reaches **LIVE**. Enter the admin token in Race Control to unlock organizer controls; Excel/CSV downloads unlock after the race ends.

The Vercel API stores race timestamps and participant progress in Supabase. No always-on Node process or local SQLite disk is used in production. Supabase Realtime sends race updates to players. When `ends_at` is reached, the next API request finalizes the race; the race state endpoint and Realtime startup reconcile an expired event if no API request arrived at the exact deadline.

## Player flow

1. Enter a team or driver name, choose red, blue, or yellow, then confirm the car. The showroom animation transitions into the qualifying quiz.
2. Players choose their car in the showroom, then answer ten qualifying questions: seven aptitude maths questions and three basic data-structures questions. Each first answer is scored; incorrect answers count as zero and players continue to the next question. The score is out of 100: up to 70 points for correct answers and 30 points for speed, with the speed bonus decreasing to zero over five minutes.
3. The organizer opens **Race Control** at the bottom right and selects **Start Race** when participants are ready. Each driver races their own session independently.
4. Each driver's elapsed time is saved on finish. Use **End Race** to close the event and mark any unfinished runs as did not finish. The public screen only shows the race status.

## Organizer controls

Use the **Race Control** panel in the browser for event operations. Enter the admin token (`ADMIN_TOKEN` in `.env` locally or the Vercel environment setting in production) to unlock Excel/CSV exports after the event ends. Keep this token private.

To end the server itself, focus the VS Code terminal running `npm start` and press **Ctrl+C**. That stops the website/game server until `npm start` is run again.

After a race ends, entering the garage again creates a fresh lobby while preserving previous results in Supabase.

## Controls

- W / Up: accelerate
- S / Down: brake
- A / Left and D / Right: steer

Car faults show a single repair question. At least 60% of the repair question bank covers basic DSA and arrays. After a wrong answer, the player sees the correct answer, waits 25 seconds in safe mode at 5 km/h, then continues with a 40 km/h speed cap.

## Data and limitations

Race records are stored in Supabase Postgres. The protected Excel and CSV exports include each participant's race time in seconds and milliseconds. Three.js, Supabase JS, and fonts load from public CDNs, so the browser needs internet access for those assets.

Vehicle positions and checkpoints are simulated in the browser. Finish events are client-reported, so this prototype is not cheat-proof and has not been load-tested for a large event.
