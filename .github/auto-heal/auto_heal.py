#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, sys, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path.cwd()
CTRL = ROOT / ".github" / "auto-heal"
TOKEN = os.getenv("GITHUB_TOKEN", "")
REPO = os.getenv("GITHUB_REPOSITORY", "")
API = os.getenv("GITHUB_API_URL", "https://api.github.com").rstrip("/")
TARGET = os.getenv("AUTO_HEAL_RUN_ID", "").strip()
SELF = os.getenv("AUTO_HEAL_WORKFLOW_NAME", "Auto Heal")

def utc() -> str:
    return datetime.now(timezone.utc).isoformat()

def load(name: str, default: Any) -> Any:
    try: return json.loads((CTRL / name).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError): return default

def save(name: str, value: Any) -> None:
    (CTRL / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

def call(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    if not TOKEN or not REPO: raise RuntimeError("GITHUB_TOKEN and GITHUB_REPOSITORY are required")
    req = urllib.request.Request(
        API + path,
        data=None if payload is None else json.dumps(payload).encode(),
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "clearglass-auto-heal/1.1",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        raw = r.read()
        if not raw: return None
        if "json" in r.headers.get("content-type", ""): return json.loads(raw.decode())
        return raw.decode(errors="replace")

def safe(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    try: return call(method, path, payload)
    except urllib.error.HTTPError as e:
        print(f"{method} {path}: HTTP {e.code} {e.read().decode(errors='replace')[:400]}", file=sys.stderr)
    except Exception as e:
        print(f"{method} {path}: {e}", file=sys.stderr)
    return None

def out(name: str, value: str) -> None:
    if p := os.getenv("GITHUB_OUTPUT"):
        with open(p, "a", encoding="utf-8") as f: f.write(f"{name}={value}\n")

def sig(text: str) -> str:
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    hot = [x for x in lines if re.search(r"error|failed|failure|exception|fatal|timed out|cancel|invalid|cannot", x, re.I)]
    s = hot[-1] if hot else (lines[-1] if lines else "unknown failure")
    s = re.sub(r"\b[0-9a-f]{40}\b", "<sha>", s, flags=re.I)
    s = re.sub(r"\d{4}-\d{2}-\d{2}T\S+", "<timestamp>", s)
    return s[:300]

def classifiers(patterns: dict[str, Any]) -> list[tuple[re.Pattern[str], dict[str, Any]]]:
    result = []
    for item in patterns.get("patterns", []):
        try: result.append((re.compile(item["pattern"], re.I | re.M), item))
        except (KeyError, re.error): pass
    return result

def classify(text: str, rules: list[tuple[re.Pattern[str], dict[str, Any]]]) -> tuple[str, str]:
    for rx, item in rules:
        if rx.search(text): return item.get("category", "UNKNOWN_FAILURE"), item.get("strategy", "Escalate.")
    return "UNKNOWN_FAILURE", "No trusted deterministic repair matched; preserve diagnostics and require review."

def learn_unknown(patterns: dict[str, Any], diagnostics: list[dict[str, Any]]) -> int:
    added = 0
    existing = {item.get("pattern") for item in patterns.get("patterns", [])}
    for diag in diagnostics:
        signature = str(diag.get("signature", "")).strip()
        if not signature or signature == "unknown failure":
            continue
        literal = re.escape(signature[:160])
        if literal in existing:
            continue
        patterns.setdefault("patterns", []).append({
            "pattern": literal,
            "category": "UNKNOWN_FAILURE",
            "strategy": "Recurring unknown signature; preserve diagnostics and require human review.",
            "learned_at": utc(),
        })
        existing.add(literal)
        added += 1
    return added

def ensure_labels() -> None:
    for name, color in {"auto-heal":"1f6feb","bot":"6f42c1","ci":"0e8a16","tests":"5319e7","deps":"0366d6"}.items():
        try: call("POST", f"/repos/{REPO}/labels", {"name":name,"color":color})
        except urllib.error.HTTPError as e:
            if e.code != 422: print(f"label {name}: HTTP {e.code}", file=sys.stderr)
        except Exception as e: print(f"label {name}: {e}", file=sys.stderr)

def has_issue(run_id: int) -> bool:
    items = safe("GET", f"/repos/{REPO}/issues?state=all&per_page=100") or []
    marker = f"auto-heal-run:{run_id}"
    return any(marker in (x.get("body") or "") for x in items if "pull_request" not in x)

def issue(run: dict[str, Any], category: str, strategy: str, diags: list[dict[str, Any]]) -> int | None:
    rid = int(run["id"])
    if has_issue(rid): return None
    labels = ["auto-heal","bot","ci"] + (["tests"] if category=="TEST_FAILURE" else []) + (["deps"] if category=="DEPENDENCY_ERROR" else [])
    lines = []
    for d in diags[:8]:
        clean = str(d.get("signature", "")).replace("`", "'")
        lines.append(f"- `{d.get('job', 'unknown')}`: `{clean}`")
    evidence = "\n".join(lines) or "- Logs unavailable."
    body = f"""<!-- auto-heal-run:{rid} -->
## Auto-heal diagnostics
- Repository: `{REPO}`
- Workflow: `{run.get('name')}`
- Run ID: `{rid}`
- Commit: `{run.get('head_sha')}`
- Branch: `{run.get('head_branch')}`
- Classification: `{category}`
- Run: {run.get('html_url')}

### Evidence
{evidence}

### Proposed remediation
{strategy}

Automatic mutation was not sufficiently deterministic or low-risk. Preserve checks and security controls; apply the smallest reviewed repair.
"""
    r = safe("POST", f"/repos/{REPO}/issues", {"title":f"Auto-heal: investigate {category} in {run.get('name','workflow')}","body":body,"labels":labels})
    return r.get("number") if isinstance(r, dict) else None

def runs(limit: int) -> list[dict[str, Any]]:
    if TARGET.isdigit():
        r = safe("GET", f"/repos/{REPO}/actions/runs/{TARGET}")
        return [r] if isinstance(r, dict) else []
    data = safe("GET", f"/repos/{REPO}/actions/runs?status=completed&per_page={limit}") or {}
    return [r for r in data.get("workflow_runs", []) if r.get("conclusion") in {"failure","cancelled","timed_out"} and r.get("name") != SELF]

def diagnose(rid: int, rules: list[tuple[re.Pattern[str], dict[str, Any]]]) -> tuple[str,str,list[dict[str,Any]]]:
    data = safe("GET", f"/repos/{REPO}/actions/runs/{rid}/jobs?per_page=100") or {}
    diags, cats = [], []
    for j in data.get("jobs", []):
        if j.get("conclusion") not in {"failure","cancelled","timed_out"}: continue
        text = safe("GET", f"/repos/{REPO}/actions/jobs/{j['id']}/logs")
        text = text if isinstance(text, str) else ""
        cat, strategy = classify(text, rules)
        cats.append((cat,strategy))
        diags.append({"job":j.get("name",str(j.get("id"))),"job_id":j.get("id"),"conclusion":j.get("conclusion"),"category":cat,"signature":sig(text)})
    if not cats: return "UNKNOWN_FAILURE","No failed-job logs were available; require review.",diags
    priority = ["SECURITY_SCAN_FAILURE","DEPLOYMENT_ERROR","CONFIG_ERROR","DEPENDENCY_ERROR","BUILD_ERROR","TEST_FAILURE","LINT_ERROR","INFRASTRUCTURE_ERROR","UNKNOWN_FAILURE"]
    for p in priority:
        for c,s in cats:
            if c == p: return c,s,diags
    return cats[0][0],cats[0][1],diags

def main() -> int:
    CTRL.mkdir(parents=True, exist_ok=True)
    patterns = load("error-patterns.json", {"schema_version":1,"patterns":[]})
    policy = load("healing-strategies.json", {"global":{},"strategies":{}})
    history = load("run-history.json", {"schema_version":1,"entries":[]})
    flaky = load("flaky-tests.json", {"schema_version":1,"tests":[]})
    rules = classifiers(patterns)
    limit = int(policy.get("global",{}).get("scan_limit",50))
    max_cycle = int(policy.get("global",{}).get("max_failures_per_cycle",5))
    seen = {(e.get("run_id"),e.get("run_attempt")) for e in history.get("entries",[])}
    ensure_labels()
    doctor = False
    processed = 0
    learned = 0
    for run in runs(limit):
        if processed >= max_cycle: break
        rid, attempt = int(run["id"]), int(run.get("run_attempt") or 1)
        if (rid,attempt) in seen: continue
        cat, strategy, diags = diagnose(rid,rules)
        cfg = policy.get("strategies",{}).get(cat,policy.get("strategies",{}).get("UNKNOWN_FAILURE",{}))
        retry = int(cfg.get("retry_limit",0))
        if cat == "INFRASTRUCTURE_ERROR" and attempt <= retry:
            safe("POST", f"/repos/{REPO}/actions/runs/{rid}/rerun-failed-jobs", {})
            action, number, outcome = "rerun_requested", None, "pending_rerun"
        elif cat == "CONFIG_ERROR" and "workflow_doctor" in cfg.get("automatic_actions",[]):
            doctor, action, number, outcome = True, "workflow_doctor_requested", None, "pending_review"
        else:
            number = issue(run,cat,strategy,diags)
            action, outcome = ("escalated_issue" if number else "escalated_existing_issue"), "pending_review"
        if cat == "UNKNOWN_FAILURE":
            learned += learn_unknown(patterns, diags)
        history.setdefault("entries",[]).append({"handled_at":utc(),"repo":REPO,"workflow":run.get("name"),"run_id":rid,"run_attempt":attempt,"commit_sha":run.get("head_sha"),"branch":run.get("head_branch"),"classification":cat,"action":action,"issue_number":number,"run_url":run.get("html_url"),"diagnostics":diags,"outcome":outcome})
        processed += 1
    counts: dict[tuple[str,str],int] = {}
    for e in history.get("entries",[]):
        if e.get("classification") not in {"TEST_FAILURE","UNKNOWN_FAILURE"}: continue
        for d in e.get("diagnostics",[]): counts[(e.get("workflow","unknown"),d.get("job","unknown"))] = counts.get((e.get("workflow","unknown"),d.get("job","unknown")),0)+1
    known = {(x.get("workflow"),x.get("job")) for x in flaky.get("tests",[])}
    for (w,j),n in counts.items():
        if n >= 2 and (w,j) not in known: flaky.setdefault("tests",[]).append({"workflow":w,"job":j,"observed_failures":n,"first_flagged_at":utc(),"status":"candidate"})
    save("error-patterns.json",patterns); save("run-history.json",history); save("flaky-tests.json",flaky)
    out("needs_workflow_doctor","true" if doctor else "false"); out("processed",str(processed)); out("learned_patterns",str(learned))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
