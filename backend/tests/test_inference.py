"""State-inference tests (novelty #1, Phase 8) on labeled synthetic current traces."""

import math

from services.inference.inference import CurrentCalibrator, StateInferencer, _two_means


def test_two_means_separates_bands():
    vals = [0.4, 0.45, 0.5, 4.4, 4.6, 4.5, 0.42, 4.55] * 10
    lo, hi = _two_means(vals)
    assert lo < 1.0 < hi
    assert hi > 4.0


def test_calibration_robust_to_imbalance():
    # 90% running, 10% idle — percentile methods fail here, 2-means shouldn't
    cal = CurrentCalibrator()
    for i in range(300):
        cal.observe(4.5 if i % 10 else 0.4)
    thr = cal.thresholds()
    assert thr.calibrated
    assert 0.4 < thr.run_a < 4.5      # threshold lands BETWEEN the bands
    assert thr.down_a < 0.4


def _current(state: str, t: int) -> float:
    # deterministic per-state current with a little ripple (no RNG -> stable test)
    base = {"running": 4.5, "idle": 0.4, "blocked": 0.8, "down": 0.05}[state]
    ripple = 0.05 * math.sin(t)
    return max(0.0, base + ripple)


def test_inference_accuracy_on_labeled_trace():
    inf = StateInferencer("S1")
    # scripted timeline cycling through all four states, with realistic dwell
    # times (machines stay in a state for many samples, not 1-2)
    pattern = (["running"] * 40 + ["blocked"] * 10 + ["idle"] * 15 +
               ["running"] * 40 + ["down"] * 20)
    seq = (pattern * 8)
    part_count = 0
    total = correct = 0
    from services.inference.inference import WINDOW
    for t, true in enumerate(seq):
        present = true in ("running", "blocked", "down")
        if true == "running" and seq[t - 1] != "running" and t > 0:
            part_count += 1  # a part completed since we last started running
        pred, _ = inf.update(t, _current(true, t), present, part_count)
        if len(inf.cal._buf) < WINDOW:
            continue
        total += 1
        if pred.value == true:
            correct += 1
    acc = correct / total
    assert acc > 0.85, f"accuracy {acc:.2%} too low"


def test_cycle_time_from_ir_increments():
    inf = StateInferencer("S1")
    # a part completes every 30 s (part_count increments), running current
    last_cycle = None
    for t in range(0, 600):
        pc = t // 30
        _, cyc = inf.update(float(t), 4.5, True, pc)
        if cyc is not None:
            last_cycle = cyc
    assert last_cycle is not None
    assert abs(last_cycle - 30.0) < 2.0
