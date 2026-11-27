# AccessLens

AI-powered navigation assistant (obstacle detection, voice, maps, SOS) for visually impaired,
elderly and mobility-challenged users. Installable PWA.

## Deploy on GitHub Pages (static – no server needed)

1. Push this repo to GitHub (branch `main`).
2. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes `Accesslens/public/`.
4. Open `https://<username>.github.io/<repo>/` (HTTPS is required for camera, GPS and voice).

On GitHub Pages there is no backend, so:
- **SOS** opens large buttons that send a pre-filled SMS (with a Google Maps link) / call your
  contact or `112` using the phone's own apps. Browsers cannot send SMS silently.
- Feedback, detection log and SOS history are stored on the device (`localStorage`).

## Run locally with the optional Node server

```bash
cd Accesslens
cp .env.example .env     # edit if needed
npm install
npm start                # http://localhost:3000
```

The server adds real SMS via Twilio (set the `TWILIO_*` vars), and stores feedback / logs in `data/`.
In production set `NODE_ENV=production` and `ADMIN_KEY`; admin routes stay disabled without it.
To use a separately hosted server from the Pages site, add
`<script>window.ACCESSLENS_API_BASE='https://your-server';</script>` before `app.js` in `index.html`
and set `CORS_ORIGIN=https://<username>.github.io` on the server.

Change `EMERGENCY_NUMBER` in `public/app.js` if you are not in India (default `112`).

## Tracking, time-to-collision and performance tools

Beyond per-frame detection, the app tracks objects across frames (`Accesslens/public/cv.js`):

* **Stable IDs** (`Person #3`) via IoU + centre-distance matching, so an object is announced once, not every frame.
* **Kalman-smoothed distance** (constant-velocity model) – less jitter than the raw bounding-box heuristic.
* **Closing speed & time-to-collision** – "Person approaching, about 3 seconds away" can fire *before* the 2 m stop rule.
* **⚙ Perf panel** (Detection screen): live FPS, mean/p95 inference time, TF.js backend (webgl/cpu), FPS cap,
  and a **10-second benchmark** you can export as JSON.
* **Session export** (📥 in the Perf panel): one CSV row per tracked object every 0.5 s,
  analysed in [`analysis/session_analysis.ipynb`](Accesslens/analysis/session_analysis.ipynb).

Run the logic tests: `cd Accesslens && npm test`

### Your benchmark results (fill in from the app – do not copy numbers from elsewhere)

| Device | Browser | Backend | Input | FPS | Mean ms | p95 ms |
|---|---|---|---|---|---|---|
| | | | | | | |

### Analysis notebook
`cd Accesslens/analysis && pip install -r requirements.txt && jupyter notebook session_analysis.ipynb`.
It ships with **synthetic** demo data (`sample_session.csv`); set `DATA_PATH` to your own export for real analysis.

## Limitations
See [`Accesslens/MODEL_CARD.md`](Accesslens/MODEL_CARD.md): pretrained COCO-SSD only, distance is a heuristic,
no accuracy evaluation yet, no stairs/curb/pothole detection. Not a substitute for a cane or guide.
