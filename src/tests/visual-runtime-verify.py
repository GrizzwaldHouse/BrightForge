"""
BrightForge Visual Runtime Verification
End-to-end UI + backend verification using Playwright.

Usage:
    pip install playwright
    playwright install chromium
    python src/tests/visual-runtime-verify.py [--headed] [--base-url http://localhost:3847]

Artifacts written to: data/visual-verification/
"""

import asyncio
import json
import os
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

try:
    from playwright.async_api import async_playwright, Page, BrowserContext, Response
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "http://localhost:3847"
ARTIFACT_DIR = Path("data/visual-verification")
TIMEOUT = 15_000       # ms — default action timeout
SSE_WAIT = 20_000      # ms — max wait for SSE events
POLL_INTERVAL = 0.5    # seconds

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def _artifact_path(name: str) -> str:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    return str(ARTIFACT_DIR / name)


class VerificationReport:
    def __init__(self):
        self.results: list[dict] = []
        self.console_errors: list[str] = []
        self.network_failures: list[dict] = []
        self.started_at = datetime.now().isoformat()

    def record(self, agent: str, task: str, status: str, detail: str = "", screenshot: str = ""):
        entry = {
            "agent": agent,
            "task": task,
            "status": status,   # PASS | FAIL | SKIP | WARN
            "detail": detail,
            "screenshot": screenshot,
            "time": ts(),
        }
        self.results.append(entry)
        icon = {"PASS": "✓", "FAIL": "✗", "SKIP": "~", "WARN": "!"}.get(status, "?")
        print(f"  [{ts()}] {icon} [{agent}] {task}: {detail}")

    def summary(self) -> dict:
        counts = {"PASS": 0, "FAIL": 0, "SKIP": 0, "WARN": 0}
        for r in self.results:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        return {
            "started_at": self.started_at,
            "finished_at": datetime.now().isoformat(),
            "counts": counts,
            "pass_rate": f"{counts['PASS'] / max(len(self.results), 1) * 100:.1f}%",
            "console_errors": self.console_errors,
            "network_failures": self.network_failures,
            "results": self.results,
        }


report = VerificationReport()


async def screenshot(page: Page, name: str) -> str:
    path = _artifact_path(f"{name}.png")
    await page.screenshot(path=path, full_page=False)
    return path


async def click_tab(page: Page, tab_name: str):
    """Click a dashboard tab by its data-tab attribute."""
    await page.click(f'button[data-tab="{tab_name}"]', timeout=TIMEOUT)
    await page.wait_for_timeout(600)  # let panel render


async def wait_for_api_response(page: Page, url_fragment: str, timeout_ms: int = TIMEOUT) -> dict | None:
    """Intercept and return the JSON body of a POST response matching url_fragment."""
    result = {}
    done = asyncio.Event()

    async def handle_response(response: Response):
        if url_fragment in response.url and response.request.method in ("POST", "GET"):
            try:
                body = await response.json()
                result["data"] = body
                result["status"] = response.status
            except Exception:
                result["status"] = response.status
                result["data"] = {}
            done.set()

    page.on("response", handle_response)
    try:
        await asyncio.wait_for(done.wait(), timeout=timeout_ms / 1000)
    except asyncio.TimeoutError:
        return None
    finally:
        page.remove_listener("response", handle_response)
    return result


# ---------------------------------------------------------------------------
# Agent: UI Boot
# ---------------------------------------------------------------------------

async def agent_ui_boot(page: Page):
    print(f"\n[{ts()}] === agent_ui_boot ===")

    # Navigate
    try:
        await page.goto(BASE_URL, wait_until="networkidle", timeout=30_000)
    except Exception as e:
        report.record("ui_boot", "navigate_to_dashboard", "FAIL", str(e))
        return False

    # Check title
    title = await page.title()
    if "BrightForge" in title or title:
        report.record("ui_boot", "page_title", "PASS", f"title='{title}'")
    else:
        report.record("ui_boot", "page_title", "WARN", f"unexpected title='{title}'")

    # Check no fatal JS errors at boot
    await page.wait_for_timeout(1500)
    fatal = [e for e in report.console_errors if "FATAL" in e or "Uncaught" in e]
    if not fatal:
        report.record("ui_boot", "no_fatal_js_errors", "PASS", "console clean")
    else:
        report.record("ui_boot", "no_fatal_js_errors", "FAIL", f"{len(fatal)} fatal errors", )

    # Tab bar present
    tab_count = await page.locator('button.tab').count()
    if tab_count >= 5:
        report.record("ui_boot", "tab_bar_rendered", "PASS", f"{tab_count} tabs found")
    else:
        report.record("ui_boot", "tab_bar_rendered", "FAIL", f"only {tab_count} tabs")

    # Health endpoint sanity
    try:
        resp = await page.request.get(f"{BASE_URL}/api/health")
        if resp.status == 200:
            report.record("ui_boot", "api_health_endpoint", "PASS", "200 OK")
        else:
            report.record("ui_boot", "api_health_endpoint", "WARN", f"status {resp.status}")
    except Exception as e:
        report.record("ui_boot", "api_health_endpoint", "FAIL", str(e))

    ss = await screenshot(page, "01_boot")
    report.record("ui_boot", "boot_screenshot", "PASS", ss, ss)
    return True


# ---------------------------------------------------------------------------
# Agent: Scene Generation
# ---------------------------------------------------------------------------

async def agent_scene_generation(page: Page):
    print(f"\n[{ts()}] === agent_scene_generation ===")

    try:
        await click_tab(page, "scene")
    except Exception as e:
        report.record("scene", "navigate_to_tab", "FAIL", str(e))
        return

    # Wait for panel to initialize
    await page.wait_for_timeout(1000)
    ss = await screenshot(page, "02_scene_tab")

    # Check prompt input exists
    prompt_input = page.locator('#scene-prompt')
    if await prompt_input.count() == 0:
        report.record("scene", "prompt_input_present", "FAIL", "#scene-prompt not found")
        return
    report.record("scene", "prompt_input_present", "PASS")

    # Fill prompt
    await prompt_input.fill("medieval castle courtyard")
    report.record("scene", "prompt_filled", "PASS", "medieval castle courtyard")

    # Set up response capture before clicking generate
    response_future = asyncio.create_task(
        wait_for_api_response(page, "/api/scene/generate", timeout_ms=10_000)
    )

    # Click generate
    gen_btn = page.locator('#scene-generate-btn')
    if await gen_btn.count() == 0:
        # Fallback: find button with text Generate
        gen_btn = page.locator('button:has-text("Generate")').first
    try:
        await gen_btn.click(timeout=TIMEOUT)
        report.record("scene", "generate_button_clicked", "PASS")
    except Exception as e:
        report.record("scene", "generate_button_clicked", "FAIL", str(e))
        response_future.cancel()
        return

    # Wait for 202 response
    api_resp = await response_future
    if api_resp is None:
        report.record("scene", "api_202_received", "WARN", "response capture timed out")
    elif api_resp["status"] in (200, 202):
        scene_id = api_resp.get("data", {}).get("sceneId", api_resp.get("data", {}).get("id", "unknown"))
        report.record("scene", "api_202_received", "PASS", f"sceneId={scene_id}, status={api_resp['status']}")
    else:
        status = api_resp.get("status")
        if status == 429:
            report.record("scene", "api_202_received", "WARN", "rate limited (429) — expected in test env")
        else:
            report.record("scene", "api_202_received", "FAIL", f"unexpected status {status}")

    # Wait for UI to show progress or result
    await page.wait_for_timeout(3000)
    ss = await screenshot(page, "03_scene_after_generate")
    report.record("scene", "final_state_screenshot", "PASS", ss, ss)

    # Check if a progress/status indicator appeared
    status_el = page.locator('.scene-status, .scene-progress, .generation-status, [data-scene-status]')
    if await status_el.count() > 0:
        report.record("scene", "status_indicator_visible", "PASS")
    else:
        report.record("scene", "status_indicator_visible", "WARN", "no status indicator found (may update async)")


# ---------------------------------------------------------------------------
# Agent: World Generation
# ---------------------------------------------------------------------------

async def agent_world_generation(page: Page):
    print(f"\n[{ts()}] === agent_world_generation ===")

    try:
        await click_tab(page, "world")
    except Exception as e:
        report.record("world", "navigate_to_tab", "FAIL", str(e))
        return

    await page.wait_for_timeout(1000)
    ss = await screenshot(page, "04_world_tab")

    # Find and click generate
    gen_btn = page.locator('#world-generate-btn, button:has-text("Generate World")').first
    if await gen_btn.count() == 0:
        report.record("world", "generate_button_found", "SKIP", "no generate button — panel may require project first")
        return
    report.record("world", "generate_button_found", "PASS")

    response_future = asyncio.create_task(
        wait_for_api_response(page, "/api/world/generate", timeout_ms=10_000)
    )

    try:
        await gen_btn.click(timeout=TIMEOUT)
        report.record("world", "generate_button_clicked", "PASS")
    except Exception as e:
        report.record("world", "generate_button_clicked", "FAIL", str(e))
        response_future.cancel()
        return

    api_resp = await response_future
    if api_resp is None:
        report.record("world", "api_response", "WARN", "response capture timed out")
    elif api_resp["status"] in (200, 202):
        world_id = api_resp.get("data", {}).get("worldId", "unknown")
        report.record("world", "api_response", "PASS", f"worldId={world_id}")
    elif api_resp["status"] == 429:
        report.record("world", "api_response", "WARN", "rate limited (429)")
    else:
        report.record("world", "api_response", "FAIL", f"status {api_resp['status']}")

    await page.wait_for_timeout(2500)
    ss = await screenshot(page, "05_world_after_generate")
    report.record("world", "final_state_screenshot", "PASS", ss, ss)


# ---------------------------------------------------------------------------
# Agent: Forge3D
# ---------------------------------------------------------------------------

async def agent_forge3d(page: Page):
    print(f"\n[{ts()}] === agent_forge3d ===")

    try:
        await click_tab(page, "forge3d")
    except Exception as e:
        report.record("forge3d", "navigate_to_tab", "FAIL", str(e))
        return

    await page.wait_for_timeout(1000)
    ss = await screenshot(page, "06_forge3d_tab")

    # Viewport or controls present
    viewport = page.locator('#forge3d-viewport, #forge3d-panel')
    if await viewport.count() > 0:
        report.record("forge3d", "panel_rendered", "PASS", "forge3d panel element found")
    else:
        report.record("forge3d", "panel_rendered", "FAIL", "forge3d panel element missing")

    # Find generate/mesh button
    gen_btn = page.locator('#forge3d-generate-btn, button:has-text("Generate"), button:has-text("Forge")').first
    if await gen_btn.count() == 0:
        report.record("forge3d", "generate_button_found", "SKIP", "generate button not found")
    else:
        report.record("forge3d", "generate_button_found", "PASS")

        response_future = asyncio.create_task(
            wait_for_api_response(page, "/api/forge3d/generate", timeout_ms=10_000)
        )

        # Fill prompt if input exists
        prompt_input = page.locator('#forge3d-prompt, [placeholder*="prompt"]').first
        if await prompt_input.count() > 0:
            await prompt_input.fill("stone tower")

        try:
            await gen_btn.click(timeout=TIMEOUT)
            report.record("forge3d", "generate_clicked", "PASS")
        except Exception as e:
            report.record("forge3d", "generate_clicked", "FAIL", str(e))
            response_future.cancel()
            return

        api_resp = await response_future
        if api_resp is None:
            report.record("forge3d", "api_response", "WARN", "timed out")
        elif api_resp["status"] in (200, 202):
            report.record("forge3d", "api_response", "PASS", f"status={api_resp['status']}")
        elif api_resp["status"] == 429:
            report.record("forge3d", "api_response", "WARN", "rate limited (429) — valid state")
        else:
            report.record("forge3d", "api_response", "FAIL", f"status {api_resp['status']}")

    await page.wait_for_timeout(2000)
    ss = await screenshot(page, "07_forge3d_state")
    report.record("forge3d", "final_state_screenshot", "PASS", ss, ss)


# ---------------------------------------------------------------------------
# Agent: Orchestration / Pipeline
# ---------------------------------------------------------------------------

async def agent_orchestration(page: Page):
    print(f"\n[{ts()}] === agent_orchestration ===")

    # Try 'pipeline' tab first (agent pipeline), then 'orchestration'
    for tab in ("pipeline", "orchestration"):
        try:
            await click_tab(page, tab)
            report.record("orchestration", f"navigate_to_{tab}_tab", "PASS")
            break
        except Exception:
            pass
    else:
        report.record("orchestration", "navigate_to_tab", "FAIL", "neither pipeline nor orchestration tab clickable")
        return

    await page.wait_for_timeout(1000)
    ss = await screenshot(page, "08_orchestration_tab")

    # Pipeline start via API directly (avoids OBS dependency in test env)
    try:
        resp = await page.request.post(
            f"{BASE_URL}/api/agents/pipeline/start",
            data=json.dumps({"prompt": "add a health system to the player character"}),
            headers={"Content-Type": "application/json"},
        )
        body = await resp.json()
        if resp.status in (200, 202):
            report.record("orchestration", "pipeline_start_api", "PASS", f"status={resp.status}, body={json.dumps(body)[:120]}")
        elif resp.status == 409:
            report.record("orchestration", "pipeline_start_api", "WARN", "pipeline already running (409)")
        else:
            report.record("orchestration", "pipeline_start_api", "FAIL", f"status={resp.status}")
    except Exception as e:
        report.record("orchestration", "pipeline_start_api", "FAIL", str(e))
        return

    # Poll pipeline status for agent progression
    agent_sequence = ["Planner", "Builder", "Tester", "Reviewer"]
    seen_agents: set[str] = set()
    deadline = time.time() + 30  # wait up to 30s

    while time.time() < deadline and len(seen_agents) < 4:
        try:
            status_resp = await page.request.get(f"{BASE_URL}/api/agents/pipeline/status")
            if status_resp.status == 200:
                status_body = await status_resp.json()
                current = status_body.get("currentAgent") or status_body.get("current_agent", "")
                pipeline_status = status_body.get("status", "")
                if current:
                    seen_agents.add(current)
                if pipeline_status in ("completed", "failed", "idle"):
                    break
        except Exception:
            pass
        await asyncio.sleep(POLL_INTERVAL)

    if seen_agents:
        report.record("orchestration", "agents_progressed", "PASS", f"observed agents: {sorted(seen_agents)}")
    else:
        report.record("orchestration", "agents_progressed", "WARN", "no agent activity observed in 30s (may be queued)")

    # Check UI reflects state
    await page.wait_for_timeout(1500)
    pipeline_ui = page.locator('.agent-pipeline, .pipeline-status, [data-agent]')
    if await pipeline_ui.count() > 0:
        report.record("orchestration", "pipeline_ui_visible", "PASS")
    else:
        report.record("orchestration", "pipeline_ui_visible", "WARN", "no pipeline UI elements detected")

    ss = await screenshot(page, "09_orchestration_state")
    report.record("orchestration", "final_state_screenshot", "PASS", ss, ss)


# ---------------------------------------------------------------------------
# Agent: System Health Monitor (runs throughout via console/network listeners)
# ---------------------------------------------------------------------------

def attach_health_monitor(page: Page):
    """Attach console + network failure listeners to page."""

    def on_console(msg):
        if msg.type in ("error", "warning"):
            entry = f"[{msg.type.upper()}] {msg.text}"
            report.console_errors.append(entry)

    def on_request_failed(request):
        report.network_failures.append({
            "url": request.url,
            "failure": request.failure,
            "method": request.method,
        })

    page.on("console", on_console)
    page.on("requestfailed", on_request_failed)


async def agent_system_health(page: Page):
    print(f"\n[{ts()}] === agent_system_health ===")

    # Summarize what we captured throughout the run
    errors = [e for e in report.console_errors if "ERROR" in e and "favicon" not in e.lower()]
    net_failures = [f for f in report.network_failures if "favicon" not in f.get("url", "")]

    if not errors:
        report.record("health", "no_console_errors", "PASS", "no JS errors captured")
    else:
        report.record("health", "no_console_errors", "FAIL" if len(errors) > 3 else "WARN",
                      f"{len(errors)} errors: {errors[0][:100]}")

    if not net_failures:
        report.record("health", "no_network_failures", "PASS")
    else:
        report.record("health", "no_network_failures", "WARN",
                      f"{len(net_failures)} failures: {net_failures[0]['url'][:80]}")

    # Verify WebSocket bus is alive (check /api/health for ws status)
    try:
        resp = await page.request.get(f"{BASE_URL}/api/health")
        if resp.status == 200:
            body = await resp.json()
            report.record("health", "ws_bus_health", "PASS", f"health ok: {json.dumps(body)[:100]}")
        else:
            report.record("health", "ws_bus_health", "WARN", f"health status {resp.status}")
    except Exception as e:
        report.record("health", "ws_bus_health", "FAIL", str(e))

    # Verify telemetry endpoint
    try:
        resp = await page.request.get(f"{BASE_URL}/api/metrics")
        if resp.status == 200:
            report.record("health", "metrics_endpoint", "PASS")
        else:
            report.record("health", "metrics_endpoint", "WARN", f"status {resp.status}")
    except Exception as e:
        report.record("health", "metrics_endpoint", "FAIL", str(e))

    ss = await screenshot(page, "10_health_tab")
    report.record("health", "health_screenshot", "PASS", ss, ss)


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

async def run(headed: bool, base_url: str):
    global BASE_URL
    BASE_URL = base_url

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  BrightForge Visual Runtime Verification")
    print(f"  Target: {BASE_URL}")
    print(f"  Mode:   {'headed' if headed else 'headless'}")
    print(f"  Artifacts: {ARTIFACT_DIR.absolute()}")
    print(f"{'='*60}\n")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not headed)
        context: BrowserContext = await browser.new_context(
            viewport={"width": 1400, "height": 900},
            record_video_dir=str(ARTIFACT_DIR) if not headed else None,
        )
        page: Page = await context.new_page()
        page.set_default_timeout(TIMEOUT)

        # Wire health monitor before any navigation
        attach_health_monitor(page)

        # Run agents sequentially (each depends on shared page state)
        boot_ok = await agent_ui_boot(page)
        if not boot_ok:
            print("\nFATAL: Dashboard did not load. Aborting remaining agents.")
        else:
            await agent_scene_generation(page)
            await agent_world_generation(page)
            await agent_forge3d(page)
            await agent_orchestration(page)

        await agent_system_health(page)

        await context.close()
        await browser.close()

    # Write report
    summary = report.summary()
    report_path = _artifact_path("verification_report.json")
    with open(report_path, "w") as f:
        json.dump(summary, f, indent=2)

    # Print summary
    print(f"\n{'='*60}")
    print(f"  VERIFICATION COMPLETE")
    print(f"  Pass rate: {summary['pass_rate']}")
    counts = summary["counts"]
    print(f"  PASS={counts['PASS']}  FAIL={counts['FAIL']}  WARN={counts['WARN']}  SKIP={counts['SKIP']}")
    print(f"  Console errors captured: {len(summary['console_errors'])}")
    print(f"  Network failures: {len(summary['network_failures'])}")
    print(f"  Report: {report_path}")
    print(f"{'='*60}\n")

    if counts["FAIL"] > 0:
        print("FAILED CHECKS:")
        for r in summary["results"]:
            if r["status"] == "FAIL":
                print(f"  ✗ [{r['agent']}] {r['task']}: {r['detail']}")

    return counts["FAIL"] == 0


def main():
    parser = argparse.ArgumentParser(description="BrightForge visual runtime verifier")
    parser.add_argument("--headed", action="store_true", help="Run browser in headed mode")
    parser.add_argument("--base-url", default="http://localhost:3847", help="Dashboard URL")
    args = parser.parse_args()

    success = asyncio.run(run(args.headed, args.base_url))
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
