"""Unit tests for the OEE math (build plan §6.4) with fixed inputs — Phase 3 DoD."""

import math

import pytest

from backend.app.kpi.oee import compute_oee


def test_textbook_values():
    # run 400s of a 480s planned window, 100 good of 105 total, ideal cycle 3.5s
    r = compute_oee(run_time_s=400, planned_time_s=480,
                    good_count=100, total_count=105, ideal_cycle_s=3.5)
    assert r.availability == pytest.approx(400 / 480)          # 0.83333
    assert r.performance == pytest.approx((3.5 * 100) / 400)   # 0.875
    assert r.quality == pytest.approx(100 / 105)               # 0.95238
    assert r.oee == pytest.approx(0.83333333 * 0.875 * 0.95238095, rel=1e-6)
    assert r.oee == pytest.approx(0.6944444, rel=1e-5)


def test_perfect_line():
    r = compute_oee(run_time_s=480, planned_time_s=480,
                    good_count=137, total_count=137, ideal_cycle_s=480 / 137)
    assert r.availability == pytest.approx(1.0)
    assert r.performance == pytest.approx(1.0)
    assert r.quality == pytest.approx(1.0)
    assert r.oee == pytest.approx(1.0)


def test_zero_planned_time_gives_zero():
    r = compute_oee(run_time_s=0, planned_time_s=0,
                    good_count=0, total_count=0, ideal_cycle_s=3.0)
    assert r.availability == 0.0
    assert r.performance == 0.0
    assert r.quality == 0.0
    assert r.oee == 0.0


def test_no_run_time_gives_zero_performance():
    r = compute_oee(run_time_s=0, planned_time_s=480,
                    good_count=0, total_count=0, ideal_cycle_s=3.0)
    assert r.availability == 0.0
    assert r.performance == 0.0


def test_performance_clamped_to_one():
    # ideal cycle estimated too fast -> performance would exceed 1, must clamp
    r = compute_oee(run_time_s=100, planned_time_s=100,
                    good_count=100, total_count=100, ideal_cycle_s=2.0)
    # raw performance = (2*100)/100 = 2.0 -> clamped to 1.0
    assert r.performance == 1.0
    assert r.oee == pytest.approx(1.0)


def test_quality_with_scrap():
    r = compute_oee(run_time_s=300, planned_time_s=480,
                    good_count=90, total_count=100, ideal_cycle_s=3.0)
    assert r.quality == pytest.approx(0.9)
    assert r.availability == pytest.approx(0.625)
    assert r.performance == pytest.approx((3.0 * 90) / 300)  # 0.9
    assert r.oee == pytest.approx(0.625 * 0.9 * 0.9)
    assert not math.isnan(r.oee)


def test_all_factors_in_unit_interval():
    r = compute_oee(run_time_s=250, planned_time_s=480,
                    good_count=70, total_count=80, ideal_cycle_s=3.2)
    for v in (r.availability, r.performance, r.quality, r.oee):
        assert 0.0 <= v <= 1.0
