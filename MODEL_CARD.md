# Model card – AccessLens obstacle detection

## Summary
AccessLens runs a **pretrained** object detector in the browser and adds a tracking layer on top.
No model was trained or fine-tuned in this project, and **no accuracy evaluation has been done**.

| | |
|---|---|
| Detector | COCO-SSD, `lite_mobilenet_v2` base (TensorFlow.js 4.17, COCO-SSD 2.2.3) |
| Training data | COCO (80 everyday object classes) – by the model authors, not this project |
| Runs on | The user's device (WebGL, or CPU as a fallback). Camera frames are not uploaded anywhere |
| Distance | **Heuristic**: `distance = real_height × focal_px / bbox_height`, with assumed real-world heights per class and a fixed field-of-view factor |
| Tracking | IoU + centre-distance matching, constant-velocity **Kalman filter** on distance (`public/cv.js`, unit-tested in `tests/`) |
| Time-to-collision | `distance / closing_speed`, only when a track is confirmed (≥3 hits), has ≥5 filter updates and is closing at ≥0.3 m/s |

## Intended use
A *supplementary* aid that gives spoken / haptic hints about objects in the walking path.
It is a student project and **must not be the only source of safety guidance**. It does not replace a
white cane, a guide dog or a sighted guide.

## What it cannot do
* Detect classes outside COCO: **stairs, curbs, potholes, open manholes, glass doors, poles, wires, low branches**.
* Measure true distance: the heuristic depends on assumed object heights, camera tilt and zoom, and partial occlusion.
* Work reliably in low light, strong backlight, rain on the lens or heavy motion blur.
* Separate the user's own motion from the object's motion: closing speed is *relative* speed (which is what matters for safety).

## Known failure modes (expected, not yet measured)
* Objects cut off by the frame edge get a wrong bounding-box height → wrong distance.
* Person standing vs. sitting changes box height → distance error.
* Crowds: IDs can swap when boxes overlap heavily.
* Low-end phones: low FPS delays alerts (use the Perf panel to check; lower the FPS cap to save battery).

## Evaluation status
| Item | Status |
|---|---|
| Unit tests for tracker / Kalman / perf / CSV logic | ✅ `npm test` (synthetic, seeded) |
| Detection accuracy (precision / recall) | ❌ not evaluated |
| Distance error vs. ground truth | ❌ not evaluated |
| Latency / FPS | ✅ measurable on your own device with the in-app 10 s benchmark |
| User testing with visually impaired people | ❌ not done |

## Privacy
Inference and tracking happen locally. Session CSVs, benchmarks and feedback stay on the device unless the user
exports them. The optional Node server (not used on GitHub Pages) can receive SOS and feedback payloads.
