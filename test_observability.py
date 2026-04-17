from iaris.credentials import CredentialStore
from iaris.intelligence import IntelligenceLayer
from iaris.observability import ObservabilityTracker, compute_diff, should_recompute


def test_compute_diff_and_significance_cpu_threshold():
    old = {
        "timestamp": 100,
        "cpu": 40.0,
        "memory": 50.0,
        "disk": 60.0,
        "processes": ["python", "node"],
    }
    new = {
        "timestamp": 101,
        "cpu": 52.5,
        "memory": 50.5,
        "disk": 60.0,
        "processes": ["python", "node"],
    }

    diff = compute_diff(old, new)
    assert "cpu" in diff
    assert diff["cpu"]["delta"] == 12.5

    significant, reason = should_recompute(diff)
    assert significant is True
    assert "CPU" in reason


def test_compute_diff_and_significance_process_change():
    old = {
        "timestamp": 100,
        "cpu": 40.0,
        "memory": 50.0,
        "disk": 60.0,
        "processes": ["python"],
    }
    new = {
        "timestamp": 101,
        "cpu": 40.5,
        "memory": 50.0,
        "disk": 60.0,
        "processes": ["python", "node"],
    }

    diff = compute_diff(old, new)
    assert "processes" in diff
    assert diff["processes"]["added"] == ["node"]

    significant, reason = should_recompute(diff)
    assert significant is True
    assert "Process list changed" == reason


def test_tracker_and_intelligence_cache_behavior():
    tracker = ObservabilityTracker(max_events=10)
    layer = IntelligenceLayer(cache_ttl_seconds=60)
    credentials = CredentialStore()

    baseline = {
        "timestamp": 100,
        "cpu": 30.0,
        "memory": 40.0,
        "disk": 50.0,
        "processes": ["python"],
    }
    first_update = tracker.update(baseline).to_dict()
    first_eval = layer.evaluate(
        observability=first_update,
        engine_insights=[],
        credentials=credentials,
    )

    assert first_eval["significant"] is True
    assert first_eval["used_cache"] is False

    minor_change = {
        "timestamp": 101,
        "cpu": 31.0,
        "memory": 40.0,
        "disk": 50.0,
        "processes": ["python"],
    }
    second_update = tracker.update(minor_change).to_dict()
    second_eval = layer.evaluate(
        observability=second_update,
        engine_insights=[],
        credentials=credentials,
    )

    assert second_eval["significant"] is False
    assert second_eval["used_cache"] is True
    assert len(second_update["recent_changes"]) >= 2
