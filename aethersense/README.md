# AetherSense

Local-first Wi-Fi CSI sensing research platform for privacy-preserving presence, movement and experimental micro-motion estimation.

> Research prototype. Breathing and heart-rate outputs are experimental signal estimates, not medical measurements.

## Repository layout

```text
aethersense/
  apps/web                 Next.js App Router dashboard
  services/api             FastAPI REST + WebSocket edge API
  services/inference      Python CSI DSP + baseline inference
  firmware/esp32           ESP32-S3 CSI UDP firmware
  packages/types            Shared TypeScript schemas
  packages/simulator       Deterministic TypeScript CSI scenario generator
  docker-compose.yml
  .env.example
```

## Quick start

### Docker

```bash
cd aethersense
docker compose up --build
```

Open `http://localhost:3000`.

### Local

```bash
cd aethersense
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r services/api/requirements.txt -r services/inference/requirements.txt
uvicorn services.api.main:app --reload --port 8000
```

In another terminal:

```bash
cd aethersense/apps/web
npm install
npm run dev
```

## Modes

- **Simulator**: deterministic synthetic CSI with configurable noise, packet loss, multipath and human micro-motion.
- **ESP32-S3**: UDP CSI frames with timestamp/RSSI/channel/subcarrier amplitude/phase parsing.
- **Replay**: locally stored JSONL sessions replayed at real-time or accelerated speed.

## Privacy

AetherSense has no camera or microphone pipeline, no cloud telemetry, no face recognition, no identity matching and no persistent identity by default. Recording requires explicit local consent. Session IDs are random UUIDs.

Banner used by the UI:

> Wi-Fi sensing detects signal disturbances. It does not capture images or audio. Vital-sign and pose outputs are experimental estimates.

## Signal-processing assumptions

Baseline processing is deliberately inspectable:

1. Validate and align timestamps.
2. Extract amplitude and phase.
3. Unwrap phase.
4. Hampel-style median/MAD outlier rejection.
5. Detrend and z-normalize each subcarrier.
6. Compute temporal motion energy.
7. Presence from CSI variance + motion-band energy.
8. Respiration estimate from 0.1–0.5 Hz peak power.
9. Heart-rate-related estimate from 0.7–2.0 Hz peak power.
10. Activity from motion intensity and periodicity features.

The baseline model returns confidence and quality metadata and will refuse a vital estimate when sample duration or signal quality is insufficient.

## REST / WebSocket API

- `GET /api/health`
- `GET /api/config`
- `POST /api/mode`
- `POST /api/calibrate`
- `POST /api/session/start`
- `POST /api/session/stop`
- `GET /api/sessions`
- `GET /api/sessions/{id}`
- `DELETE /api/sessions/{id}`
- `GET /api/sensors`
- `POST /api/sensors/register`
- `/ws/telemetry`
- `/ws/csi`
- `/ws/pose`
- `/ws/vitals`

Mutation requests require the local CSRF token returned by `/api/config` and an allowed local Origin. This is a local trust-boundary control, not an authentication system.

## ESP32-S3

The firmware uses ESP-IDF CSI callbacks and sends compact JSON over UDP. It intentionally does not expose SSIDs/passwords or any credential material to the web application.

Configure target and network parameters in `firmware/esp32/platformio.ini` / source constants before flashing.

## Testing

```bash
pytest -q services/inference/tests
```

The project is also structured for frontend unit/E2E testing and CI dependency checks.

## Disclaimer

CSI can reveal useful radio-environment dynamics, but room geometry, antenna placement, packet loss, channel selection and multipath can materially change results. AetherSense is a research tool and does not establish diagnosis, treatment or clinical-grade vital signs.
