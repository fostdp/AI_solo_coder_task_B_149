#!/usr/bin/env python3
"""Integration tests for Trebuchet Backend HTTP API (6 new routes).

Zero third-party dependencies: only stdlib urllib / json / sys / time.

Usage:
    python test_api_integration.py

The backend must be running at http://127.0.0.1:8080 before executing.
If the backend is unreachable, all tests are skipped with a clear message.
"""

import json
import urllib.request
import urllib.error
import sys
import time

BASE_URL = "http://127.0.0.1:8080"
TIMEOUT = 10

passed = 0
failed = 0
errors = 0


def api_get(path, expected_status=200):
    """Send GET request, return (status_code, json_data_or_None)."""
    url = BASE_URL + path
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            status = resp.status
            try:
                data = json.loads(body)
            except (json.JSONDecodeError, ValueError):
                data = None
            return status, data
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        try:
            data = json.loads(body)
        except (json.JSONDecodeError, ValueError):
            data = None
        return e.code, data
    except urllib.error.URLError:
        return None, None
    except Exception:
        return None, None


def assert_(cond, name, detail=""):
    """Record pass / fail for a single assertion."""
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        extra = f" — {detail}" if detail else ""
        print(f"  FAIL  {name}{extra}")


def get_field(data, *keys):
    """Try multiple key name variants (snake_case / camelCase / alternatives)."""
    if not isinstance(data, dict):
        return None
    for key in keys:
        if key in data:
            return data[key]
    return None


def get_items(data, *keys):
    """Return the first list found under any of the given key names."""
    for key in keys:
        val = get_field(data, key)
        if isinstance(val, list):
            return val
    return None


# ──────────────────────────────────────────────
# 一、材料对比 API  /api/compare-materials
# ──────────────────────────────────────────────

def test_compare_materials_default():
    status, data = api_get("/api/compare-materials")
    assert_(status == 200, "status 200", f"got {status}")
    items = get_items(data, "results", "materials")
    assert_(items is not None, "has results/materials array")
    assert_(len(items) >= 7, "array length >= 7", f"got {len(items) if items else 0}")


def test_compare_materials_custom_angle():
    status_120, data_120 = api_get("/api/compare-materials?angle_deg=120")
    status_180, data_180 = api_get("/api/compare-materials?angle_deg=180")
    assert_(status_120 == 200 and status_180 == 200, "status 200")
    items_120 = get_items(data_120, "results", "materials") or []
    items_180 = get_items(data_180, "results", "materials") or []
    if items_120 and items_180:
        for i in range(min(len(items_120), len(items_180))):
            e120 = get_field(items_120[i], "stored_energy", "storedEnergy")
            e180 = get_field(items_180[i], "stored_energy", "storedEnergy")
            if e120 is not None and e180 is not None:
                assert_(e180 >= e120,
                        f"180° stored_energy >= 120° [{i}]",
                        f"{e180} vs {e120}")
                return
    assert_(False, "180° stored_energy > 120°", "insufficient data")


def test_compare_materials_custom_mass():
    status_10, data_10 = api_get("/api/compare-materials?mass_kg=10")
    status_5, data_5 = api_get("/api/compare-materials?mass_kg=5")
    assert_(status_10 == 200 and status_5 == 200, "status 200")
    items_10 = get_items(data_10, "results", "materials") or []
    items_5 = get_items(data_5, "results", "materials") or []
    if items_10 and items_5:
        r10 = get_field(items_10[0], "predicted_range_m", "predictedRangeM", "range")
        r5 = get_field(items_5[0], "predicted_range_m", "predictedRangeM", "range")
        if r10 is not None and r5 is not None:
            assert_(r5 > r10, "mass=5 range > mass=10", f"{r5} vs {r10}")
            return
    assert_(False, "mass=5 range > mass=10", "insufficient data")


def test_compare_materials_ranking():
    status, data = api_get("/api/compare-materials")
    assert_(status == 200, "status 200")
    items = get_items(data, "results", "materials") or []
    has_ranking = False
    for item in items:
        rank = get_field(item, "range_ranking", "rangeRanking")
        if rank is not None:
            has_ranking = True
            assert_(rank >= 1, f"ranking >= 1 (got {rank})")
    assert_(has_ranking, "has range_ranking field")


def test_compare_materials_era_field():
    status, data = api_get("/api/compare-materials")
    assert_(status == 200, "status 200")
    items = get_items(data, "results", "materials") or []
    for item in items:
        era = get_field(item, "era")
        if era is not None:
            assert_(era in ("ancient", "modern"), f"era is ancient|modern (got '{era}')")
        else:
            assert_(False, "era field present")


def test_compare_materials_zero_angle():
    status, data = api_get("/api/compare-materials?angle_deg=0")
    assert_(status == 200, "status 200", f"got {status}")
    items = get_items(data, "results", "materials") or []
    for item in items:
        e = get_field(item, "stored_energy", "storedEnergy")
        if e is not None:
            assert_(abs(e) < 1.0, f"stored_energy ≈ 0 (got {e:.4f})")


def test_compare_materials_small_mass():
    status, data = api_get("/api/compare-materials?mass_kg=0.01")
    assert_(status == 200, "status 200, no crash", f"got {status}")


def test_compare_materials_negative_angle():
    status, data = api_get("/api/compare-materials?angle_deg=-10")
    assert_(status in (200, 400), "status 200 or 400, no crash", f"got {status}")


def test_compare_materials_invalid_params():
    status, data = api_get("/api/compare-materials?angle_deg=abc")
    assert_(status in (200, 400), "status 200 (default) or 400, no crash", f"got {status}")


# ──────────────────────────────────────────────
# 二、跨时代对比 API  /api/compare-trebuchets
# ──────────────────────────────────────────────

def test_compare_trebuchets_default():
    status, data = api_get("/api/compare-trebuchets")
    assert_(status == 200, "status 200", f"got {status}")
    items = get_items(data, "results", "trebuchets", "types")
    assert_(items is not None, "has results array")
    assert_(len(items) >= 5, "array length >= 5", f"got {len(items) if items else 0}")


def test_compare_trebuchets_modern_outranges():
    status, data = api_get("/api/compare-trebuchets")
    assert_(status == 200, "status 200")
    items = get_items(data, "results", "trebuchets", "types") or []
    modern_max = 0.0
    ancient_max = 0.0
    for item in items:
        era = get_field(item, "era")
        rng = get_field(item, "predicted_range_m", "predictedRangeM", "range")
        if era and rng is not None:
            if era == "modern" and rng > modern_max:
                modern_max = rng
            elif era == "ancient" and rng > ancient_max:
                ancient_max = rng
    assert_(modern_max > ancient_max,
            "modern outranges ancient",
            f"modern={modern_max:.1f} ancient={ancient_max:.1f}")


def test_compare_trebuchets_velocity_field():
    status, data = api_get("/api/compare-trebuchets")
    assert_(status == 200, "status 200")
    items = get_items(data, "results", "trebuchets", "types") or []
    for item in items:
        vel = get_field(item, "release_velocity", "releaseVelocity", "adjusted_velocity", "adjustedVelocity")
        assert_(vel is not None, "has release_velocity / adjusted_velocity")
        break


def test_compare_trebuchets_ranking():
    status, data = api_get("/api/compare-trebuchets")
    assert_(status == 200, "status 200")
    items = get_items(data, "results", "trebuchets", "types") or []
    has_ranking = False
    for item in items:
        rank = get_field(item, "range_ranking", "rangeRanking")
        if rank is not None:
            has_ranking = True
            break
    assert_(has_ranking, "has range_ranking field")


def test_compare_trebuchets_zero_velocity():
    status, data = api_get("/api/compare-trebuchets?base_velocity=0")
    assert_(status == 200, "status 200", f"got {status}")
    items = get_items(data, "results", "trebuchets", "types") or []
    for item in items:
        rng = get_field(item, "predicted_range_m", "predictedRangeM", "range")
        if rng is not None:
            assert_(abs(rng) < 1.0, f"range ≈ 0 (got {rng:.4f})")


def test_compare_trebuchets_high_velocity():
    status, data = api_get("/api/compare-trebuchets?base_velocity=200")
    assert_(status == 200, "status 200, no crash", f"got {status}")


def test_compare_trebuchets_negative_velocity():
    status, data = api_get("/api/compare-trebuchets?base_velocity=-5")
    assert_(status in (200, 400), "status 200 or 400, no crash", f"got {status}")


# ──────────────────────────────────────────────
# 三、预紧力优化 API  /api/preload-analysis
# ──────────────────────────────────────────────

def test_preload_analysis_default():
    status, data = api_get("/api/preload-analysis")
    assert_(status == 200, "status 200", f"got {status}")
    pts = get_items(data, "data", "points")
    assert_(pts is not None, "has data/points array")
    assert_(len(pts) >= 2, "at least 2 points", f"got {len(pts) if pts else 0}")


def test_preload_analysis_baseline():
    status, data = api_get("/api/preload-analysis")
    assert_(status == 200, "status 200")
    bl = get_field(data, "baseline_range_m", "baselineRangeM", "baseRangeM", "base_range_m")
    assert_(bl is not None, "has baseline range field")


def test_preload_analysis_best_preload():
    status, data = api_get("/api/preload-analysis")
    assert_(status == 200, "status 200")
    bp = get_field(data, "best_preload_angle_deg", "bestPreloadDeg", "best_preload_deg")
    assert_(bp is not None, "has best preload angle field")


def test_preload_analysis_improvement():
    status, data = api_get("/api/preload-analysis")
    assert_(status == 200, "status 200")
    imp = get_field(data, "improvement_percent", "improvementPercent", "improvement_pct")
    assert_(imp is not None, "has improvement_percent field")
    if imp is not None:
        assert_(imp >= 0, f"improvement >= 0 (got {imp})")


def test_preload_analysis_points_length():
    status, data = api_get("/api/preload-analysis?steps=10")
    assert_(status == 200, "status 200")
    pts = get_items(data, "data", "points")
    assert_(pts is not None, "has data/points array")
    assert_(len(pts) == 11, "11 points for steps=10", f"got {len(pts) if pts else 0}")


def test_preload_analysis_different_material():
    status_s, data_s = api_get("/api/preload-analysis?material=steel65mn")
    status_o, data_o = api_get("/api/preload-analysis?material=ox_tendon")
    assert_(status_s == 200 and status_o == 200, "status 200")
    bl_s = get_field(data_s, "baseline_range_m", "baselineRangeM", "baseRangeM", "base_range_m")
    bl_o = get_field(data_o, "baseline_range_m", "baselineRangeM", "baseRangeM", "base_range_m")
    if bl_s is not None and bl_o is not None:
        assert_(bl_s != bl_o, "baseline differs by material", f"steel={bl_s} ox={bl_o}")
    else:
        assert_(False, "baseline fields present", f"steel={bl_s} ox={bl_o}")


def test_preload_analysis_zero_max():
    status, data = api_get("/api/preload-analysis?max_angle_deg=0")
    assert_(status == 200, "status 200, no crash", f"got {status}")
    pts = get_items(data, "data", "points")
    if pts is not None:
        assert_(len(pts) <= 1, "0 or 1 point for max_angle=0", f"got {len(pts)}")
    else:
        assert_(True, "no points array (acceptable)")


def test_preload_analysis_one_step():
    status, data = api_get("/api/preload-analysis?steps=1")
    assert_(status == 200, "status 200, no crash", f"got {status}")
    pts = get_items(data, "data", "points")
    if pts is not None:
        assert_(len(pts) >= 2, "at least 2 points for steps=1", f"got {len(pts)}")
    else:
        assert_(False, "has data/points array")


def test_preload_analysis_invalid_material():
    status, data = api_get("/api/preload-analysis?material=nonexistent")
    assert_(status in (200, 400), "status 200 (degrade) or 400, no crash", f"got {status}")


def test_preload_analysis_negative_steps():
    status, data = api_get("/api/preload-analysis?steps=-5")
    assert_(status in (200, 400), "status 200 or 400, no crash", f"got {status}")


# ──────────────────────────────────────────────
# 四、虚拟发射 API  /api/virtual-launch
# ──────────────────────────────────────────────

def test_virtual_launch_default():
    status, data = api_get("/api/virtual-launch")
    assert_(status == 200, "status 200", f"got {status}")
    spring = get_field(data, "spring")
    trajectory = get_field(data, "trajectory")
    assert_(spring is not None, "has spring object")
    assert_(trajectory is not None, "has trajectory object")


def test_virtual_launch_stored_energy():
    status, data = api_get("/api/virtual-launch")
    assert_(status == 200, "status 200")
    spring = get_field(data, "spring") or {}
    se = get_field(spring, "stored_energy", "storedEnergy")
    assert_(se is not None and se > 0, f"stored_energy > 0 (got {se})")


def test_virtual_launch_release_velocity():
    status, data = api_get("/api/virtual-launch")
    assert_(status == 200, "status 200")
    rv = get_field(data, "release_velocity", "releaseVelocity")
    assert_(rv is not None and rv > 0, f"release_velocity > 0 (got {rv})")


def test_virtual_launch_trajectory_range():
    status, data = api_get("/api/virtual-launch")
    assert_(status == 200, "status 200")
    trajectory = get_field(data, "trajectory") or {}
    rng = get_field(trajectory, "predicted_range", "predictedRange", "range")
    assert_(rng is not None and rng > 0, f"trajectory range > 0 (got {rng})")


def test_virtual_launch_trajectory_points():
    status, data = api_get("/api/virtual-launch")
    assert_(status == 200, "status 200")
    pts = get_items(data, "trajectoryPoints", "trajectory_points")
    assert_(pts is not None, "has trajectoryPoints array")
    assert_(len(pts) > 2, "trajectory points > 2", f"got {len(pts) if pts else 0}")


def test_virtual_launch_with_preload():
    status_0, data_0 = api_get("/api/virtual-launch?preload_deg=0")
    status_30, data_30 = api_get("/api/virtual-launch?preload_deg=30")
    assert_(status_0 == 200 and status_30 == 200, "status 200")
    se_0 = get_field(data_0.get("spring", {}) if isinstance(data_0, dict) else {},
                     "stored_energy", "storedEnergy")
    se_30 = get_field(data_30.get("spring", {}) if isinstance(data_30, dict) else {},
                      "stored_energy", "storedEnergy")
    if se_0 is not None and se_30 is not None:
        assert_(se_30 > se_0, "preload=30 stored_energy > preload=0", f"{se_30} vs {se_0}")
    else:
        assert_(False, "stored_energy fields present", f"se0={se_0} se30={se_30}")


def test_virtual_launch_zero_torsion():
    status, data = api_get("/api/virtual-launch?torsion_angle_deg=0")
    assert_(status == 200, "status 200", f"got {status}")
    spring = get_field(data, "spring") or {}
    se = get_field(spring, "stored_energy", "storedEnergy")
    if se is not None:
        assert_(abs(se) < 1.0, f"stored_energy ≈ 0 (got {se:.4f})")
    else:
        assert_(False, "stored_energy field present")


def test_virtual_launch_very_small_mass():
    status, data = api_get("/api/virtual-launch?mass_kg=0.01")
    assert_(status == 200, "status 200, no crash", f"got {status}")


def test_virtual_launch_invalid_material():
    status, data = api_get("/api/virtual-launch?material=unknown")
    assert_(status in (200, 400), "status 200 (degrade) or 400, no crash", f"got {status}")


def test_virtual_launch_zero_mass():
    status, data = api_get("/api/virtual-launch?mass_kg=0")
    assert_(status in (200, 400), "status 200 or 400, no crash", f"got {status}")


# ──────────────────────────────────────────────
# 五、元数据 API
# ──────────────────────────────────────────────

def test_get_materials():
    status, data = api_get("/api/materials")
    assert_(status == 200, "status 200", f"got {status}")
    items = get_items(data, "materials")
    assert_(items is not None, "has materials array")
    assert_(len(items) >= 7, "materials length >= 7", f"got {len(items) if items else 0}")
    required_keys = [("id",), ("name",), ("era",),
                     ("shearModulusGpa", "shear_modulus_gpa"),
                     ("yieldStrengthMpa", "yield_strength_mpa")]
    for idx, item in enumerate(items):
        missing = [kv[0] for kv in required_keys if get_field(item, *kv) is None]
        assert_(len(missing) == 0,
                f"material[{idx}] has all required fields",
                f"missing: {missing}" if missing else "")


def test_get_trebuchet_types():
    status, data = api_get("/api/trebuchet-types")
    assert_(status == 200, "status 200", f"got {status}")
    items = get_items(data, "types", "trebuchet_types")
    assert_(items is not None, "has types array")
    assert_(len(items) >= 5, "types length >= 5", f"got {len(items) if items else 0}")
    for item in items:
        has_id = get_field(item, "id") is not None
        has_name = get_field(item, "name") is not None
        has_era = get_field(item, "era") is not None
        has_vel = get_field(item, "velocityBoost", "velocity_boost") is not None
        assert_(has_id and has_name and has_era and has_vel,
                "type has id/name/era/velocityBoost")
        break


# ──────────────────────────────────────────────
# 测试注册表
# ──────────────────────────────────────────────

ALL_TESTS = [
    ("一、材料对比 API", [
        test_compare_materials_default,
        test_compare_materials_custom_angle,
        test_compare_materials_custom_mass,
        test_compare_materials_ranking,
        test_compare_materials_era_field,
        test_compare_materials_zero_angle,
        test_compare_materials_small_mass,
        test_compare_materials_negative_angle,
        test_compare_materials_invalid_params,
    ]),
    ("二、跨时代对比 API", [
        test_compare_trebuchets_default,
        test_compare_trebuchets_modern_outranges,
        test_compare_trebuchets_velocity_field,
        test_compare_trebuchets_ranking,
        test_compare_trebuchets_zero_velocity,
        test_compare_trebuchets_high_velocity,
        test_compare_trebuchets_negative_velocity,
    ]),
    ("三、预紧力优化 API", [
        test_preload_analysis_default,
        test_preload_analysis_baseline,
        test_preload_analysis_best_preload,
        test_preload_analysis_improvement,
        test_preload_analysis_points_length,
        test_preload_analysis_different_material,
        test_preload_analysis_zero_max,
        test_preload_analysis_one_step,
        test_preload_analysis_invalid_material,
        test_preload_analysis_negative_steps,
    ]),
    ("四、虚拟发射 API", [
        test_virtual_launch_default,
        test_virtual_launch_stored_energy,
        test_virtual_launch_release_velocity,
        test_virtual_launch_trajectory_range,
        test_virtual_launch_trajectory_points,
        test_virtual_launch_with_preload,
        test_virtual_launch_zero_torsion,
        test_virtual_launch_very_small_mass,
        test_virtual_launch_invalid_material,
        test_virtual_launch_zero_mass,
    ]),
    ("五、元数据 API", [
        test_get_materials,
        test_get_trebuchet_types,
    ]),
]


if __name__ == "__main__":
    print("=" * 60)
    print("  Trebuchet Backend API Integration Tests")
    print("=" * 60)
    print()

    print("[健康检查] 正在连接 http://127.0.0.1:8080/health ...")
    status, data = api_get("/health")
    if status != 200:
        print()
        print("⚠  后端未启动！无法连接 http://127.0.0.1:8080/health")
        print("   请先启动后端服务，再运行本测试脚本。")
        print()
        sys.exit(1)

    print(f"  后端健康检查通过 (status={status})")
    if data and isinstance(data, dict):
        ver = get_field(data, "version")
        if ver:
            print(f"  后端版本: {ver}")
    print()

    total = 0
    for group_name, tests in ALL_TESTS:
        print(f"── {group_name} ──")
        for test_fn in tests:
            total += 1
            try:
                test_fn()
            except Exception as exc:
                errors += 1
                print(f"  ERROR {test_fn.__name__}: {exc}")
        print()

    print("=" * 60)
    print(f"  总计: {total}  通过: {passed}  失败: {failed}  错误: {errors}")
    print("=" * 60)

    if failed == 0 and errors == 0:
        print("  ✅ 全部通过！")
        sys.exit(0)
    else:
        print("  ❌ 存在失败或错误，请检查上方输出。")
        sys.exit(1)
