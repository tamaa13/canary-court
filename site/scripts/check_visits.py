"""e2e check of the visit beacon (src/lib/visits): with the site running (pnpm dev, port 3100), it opens the landing,
moves around the app and plays the demo video, and asserts a POST /api/v went out for every page view (path only, a
referrer host or "direct") and for the video's play step. Nothing is counted locally: without Redis credentials the
route answers 204 and stores nothing. (In dev, React's strict mode runs effects twice, so each view beacons twice; a
production build sends one.)

    python3 scripts/check_visits.py [http://localhost:3100]
"""

import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    hits = []
    # (the browser doesn't expose a beacon's body to the test, so the page hands each one over as it's sent)
    page.expose_function("__beaconSeen", lambda url, body: hits.append(("POST", json.loads(body))) if url.endswith("/api/v") else None)
    page.add_init_script(
        "const send = navigator.sendBeacon.bind(navigator);"
        "navigator.sendBeacon = (u, d) => { if (d instanceof Blob) d.text().then((t) => window.__beaconSeen(String(u), t)); return send(u, d); };"
    )
    statuses = []
    page.on("response", lambda r: statuses.append(r.status) if r.url.endswith("/api/v") else None)

    page.goto(BASE + "/", wait_until="networkidle")
    time.sleep(0.8)
    page.goto(BASE + "/app", wait_until="networkidle")  # a fresh load: its own first view
    time.sleep(0.8)
    page.get_by_role("navigation", name="App tabs").get_by_role("link", name="Jobs").click()  # a client-side navigation
    page.wait_for_url("**/app/jobs")
    time.sleep(0.8)
    page.goto(BASE + "/demo", wait_until="networkidle")
    time.sleep(0.5)
    page.evaluate("document.querySelector('video').muted = true; document.querySelector('video').play()")
    time.sleep(1.5)
    browser.close()

views = [b for m, b in hits if b.get("event") == "view"]
video = [b for m, b in hits if b.get("event") == "video"]
paths = [v["path"] for v in views]
problems = []
for want in ["/", "/app", "/app/jobs", "/demo"]:
    if want not in paths:
        problems.append(f"no view beacon for {want}")
if any("?" in v["path"] for v in views):
    problems.append("a query string leaked into a path")
if not all(isinstance(v.get("ref"), str) and v["ref"] for v in views):
    problems.append("a view without a referrer value")
if not any(v.get("step") == "play" for v in video):
    problems.append("no video play beacon")
if any(m != "POST" for m, _ in hits):
    problems.append("a beacon that wasn't a POST")
if statuses and any(s != 204 for s in statuses):
    problems.append(f"/api/v answered {sorted(set(statuses))}, not 204")

print(f"{len(views)} view beacons: {paths}")
print(f"{len(video)} video beacons: {[v['step'] for v in video]}")
print("refs:", sorted({v["ref"] for v in views}))
print("OK" if not problems else "FAIL:\n  " + "\n  ".join(problems))
sys.exit(1 if problems else 0)
