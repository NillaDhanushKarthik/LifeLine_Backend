# LifeLine Backend

## Run
```bash
cp .env.example .env     # set MONGO_URI and JWT_SECRET
npm install
npm run dev
```
Needs MongoDB running locally (or an Atlas URI). `GOOGLE_MAPS_API_KEY` is optional; without it ETA uses a straight-line estimate.

## Socket.IO
Connect with `io(URL, { auth: { token } })`.
- Driver emits `driver:location` `{ latitude, longitude, heading }` every 2–3 s
- Driver receives `booking:request`, `booking:cancelled`, `booking:status`
- Patient receives `booking:status`, `driver:location`, `booking:eta`
