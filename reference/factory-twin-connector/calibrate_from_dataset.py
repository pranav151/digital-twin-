"""
Turns real open datasets into the station_params.json the SimulatorConnector
consumes, so "simulated" data is grounded in real factory numbers instead of
invented ones (Part 24's calibration concept, applied at design time instead
of only at runtime).

Two real, verified sources:

1) Bosch Production Line Performance (Kaggle) -- gives real per-station DWELL
   TIME distributions. Columns in train_date.csv are named L{line}_S{station}_D{idx};
   a non-null value means that part visited that station at that timestamp.
   For each part, (max - min) of a station's D-columns approximates the time
   spent at that station -- this is exactly the "StationTime" feature real
   Kaggle solutions to this competition compute (see research doc, section 4).

2) NASA/PHM Prognostics Data Repository -- Bearing dataset -- gives real
   run-to-failure durations you can turn into a mean-time-to-failure /
   fail_rate_per_hr for the DOWN state, instead of guessing.

Run this against the files you actually download; a small synthetic fixture
matching each real schema is generated below purely to prove the parsing
logic is correct before you point it at the real multi-GB files.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

import pandas as pd


# ---------------------------------------------------------------------------
# 1) Bosch: real per-station dwell-time distributions
# ---------------------------------------------------------------------------

def calibrate_from_bosch_date_file(date_csv_path: str, chunksize: int = 50_000) -> dict:
    """
    date_csv_path: path to Bosch's train_date.csv (or a sample of it).
    Returns {station_label: {"cycle_mean_s": ..., "cycle_std_s": ..., "n_obs": ...}}

    Station labels come straight out of the real column names (e.g. "L3_S30"),
    so you decide the L{line}_S{station} -> your S1/S2/S3/S4 mapping yourself --
    this script doesn't invent that mapping.
    """
    station_col_pattern = re.compile(r"^(L\d+_S\d+)_D\d+$")
    dwell_samples: dict[str, list[float]] = {}

    reader = pd.read_csv(date_csv_path, chunksize=chunksize)
    for chunk in reader:
        station_cols: dict[str, list[str]] = {}
        for col in chunk.columns:
            m = station_col_pattern.match(col)
            if m:
                station_cols.setdefault(m.group(1), []).append(col)

        for station, cols in station_cols.items():
            sub = chunk[cols]
            dwell = sub.max(axis=1) - sub.min(axis=1)   # NaN where the part never visited this station
            valid = dwell.dropna()
            valid = valid[valid > 0]                     # Bosch's date unit is arbitrary relative time, not seconds --
                                                           # keep only positive multi-timestamp dwells
            dwell_samples.setdefault(station, []).extend(valid.tolist())

    result = {}
    for station, samples in dwell_samples.items():
        s = pd.Series(samples)
        if len(s) < 5:
            continue
        result[station] = {
            "cycle_mean_s": round(float(s.mean()), 3),
            "cycle_std_s": round(float(s.std()), 3),
            "n_obs": int(len(s)),
        }
    return result


def _make_synthetic_bosch_fixture(path: Path, n_rows: int = 2000) -> None:
    """A small fixture with the REAL Bosch column-naming scheme (L{line}_S{station}_D{idx}),
    used only to prove the parser above is correct. Not real Bosch data."""
    import random
    random.seed(0)
    rows = []
    # two stations on line 3, matching the real naming convention
    for i in range(n_rows):
        row = {"Id": i}
        # ~80% sparsity is realistic for this dataset -- most parts skip most stations
        if random.random() < 0.6:
            t0 = random.uniform(0, 1000)
            row["L3_S30_D3496"] = t0
            row["L3_S30_D3497"] = t0 + random.gauss(18.0, 1.5)  # dwell ~ S1's real cycle time
        if random.random() < 0.5:
            t0 = random.uniform(0, 1000)
            row["L3_S31_D3500"] = t0
            row["L3_S31_D3501"] = t0 + random.gauss(55.2, 4.0)  # dwell ~ S3's real cycle time (the bottleneck)
        rows.append(row)
    pd.DataFrame(rows).to_csv(path, index=False)


# ---------------------------------------------------------------------------
# 2) NASA/PHM bearing data: real mean-time-to-failure
# ---------------------------------------------------------------------------

def calibrate_fail_rate_from_run_lengths(run_length_hours: list[float]) -> dict:
    """
    NASA's IMS bearing set is a handful of run-to-failure experiments (files
    every ~10 minutes until failure). The number of files * 10 minutes for
    each experiment IS a real observed time-to-failure. Point this at however
    many run lengths you have (even 3-4 real experiments beats an invented
    fail_rate_per_hr).
    """
    s = pd.Series(run_length_hours)
    mttf_hours = float(s.mean())
    return {
        "mttf_hours": round(mttf_hours, 2),
        "fail_rate_per_hr": round(1.0 / mttf_hours, 5) if mttf_hours > 0 else None,
        "n_experiments": int(len(s)),
    }


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    fixture = Path("synthetic_bosch_fixture.csv")
    _make_synthetic_bosch_fixture(fixture)
    print(f"Built synthetic fixture matching Bosch's real column scheme: {fixture}")

    calibrated = calibrate_from_bosch_date_file(str(fixture))
    print("\nCalibrated station dwell-time stats (from the FIXTURE, not real Bosch data):")
    print(json.dumps(calibrated, indent=2))

    # PLACEHOLDER run lengths -- I have not verified the exact duration of each
    # of the 3 real IMS test-set experiments and won't invent specific day
    # counts. Each of the 3 folders in the real download
    # (phm-datasets.s3.amazonaws.com/NASA/4.+Bearings.zip) contains files
    # timestamped roughly every 10 minutes until failure -- count the files in
    # each folder x 10 minutes to get the REAL run length before trusting this
    # output for anything but a parsing-logic check:
    placeholder_run_lengths_hours = [100.0, 50.0, 80.0]
    fail_stats = calibrate_fail_rate_from_run_lengths(placeholder_run_lengths_hours)
    print("\nFail-rate calibration logic check (PLACEHOLDER hours, not verified real durations):")
    print(json.dumps(fail_stats, indent=2))

    fixture.unlink()
