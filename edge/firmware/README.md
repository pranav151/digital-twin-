# ESP32 retrofit firmware — Phase 8, Route B (novelty #1 sensing side)

Clamp-on CT (SCT-013) + IR part counter → MQTT `factory/{line}/{station}/raw`.
No PLC, no machine modification. State is inferred downstream by
`services/inference`. `src/main.cpp` is a complete, commented sketch.

## Build & flash (PlatformIO)
```bash
pip install platformio           # or use the VS Code PlatformIO extension
cd edge/firmware
pio run -t upload                # build + flash a connected ESP32
pio device monitor               # watch the serial output
```

## Wiring
- SCT-013 CT clamp → burden resistor + 1.65 V bias divider → GPIO34 (ADC1).
- IR / proximity sensor digital out → GPIO27 (active-LOW default).
See the standard OpenEnergyMonitor CT interface for the bias/burden circuit.

## Calibrate `CURRENT_CAL`
Run a known load (or a clamp meter reference), read the printed amps, and scale
`CURRENT_CAL` in `main.cpp` until it matches. This only sets the *magnitude*; the
inference service self-calibrates the running/idle/down **bands** on its own.

## Config
Edit the CONFIG block at the top of `main.cpp`: WiFi, `MQTT_HOST`, `LINE_ID`,
`STATION_ID`, pins. One ESP32 per station (unique `STATION_ID`).

## Bring-up test (no ESP32 needed)
`scripts/inference_eval.py` proves the inference method against labeled traces;
`services/inference/main.py` is the service the real node feeds.
