#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Python helper templates emitted by Agent Fleet bounded-parallel task packs.
 *
 * @remarks
 * These templates are intentionally isolated from the main pack library so large embedded scripts do
 * not obscure the TypeScript orchestration code. The exported functions are pure string renderers;
 * callers write their returned source into generated pack helper files.
 *
 * @testing TypeScript compile: cd skills/agent-fleet && npx tsc --noEmit --moduleResolution bundler --module ESNext --target ES2022 --strict --skipLibCheck --types node scripts/*.ts --pretty false
 * @see skills/agent-fleet/scripts/agent-fleet-pack-lib.ts - Uses these templates when generating bounded runners.
 * @documentation reviewed=2026-05-16 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

/**
 * Embeds the full Python scheduler source string limited by global and per-package concurrency caps.
 *
 * @remarks
 * PURITY: returns only generated Python text destined for `bounded-scheduler.py`.
 */
export function renderBoundedParallelScheduler(): string {
  return `#!/usr/bin/env python3
"""Run Agent Fleet task scripts with global/per-package caps and visible progress footers."""
from __future__ import annotations

import argparse
import csv
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

parser = argparse.ArgumentParser(description="Run a generated Agent Fleet pack with bounded concurrency.")
parser.add_argument("--package", action="append", dest="packages", default=[], help="Limit execution to a package. Repeatable.")
parser.add_argument("--max-total", type=int, default=10, help="Maximum active agents across all packages.")
parser.add_argument("--max-per-package", type=int, default=4, help="Maximum active agents per package.")
parser.add_argument("--launch-delay", type=float, default=10.0, help="Seconds to wait between launching agents.")
parser.add_argument("--max-started", type=int, default=0, help="Stop launching after this many tasks have started. 0 means no limit.")
parser.add_argument("--max-failures", type=int, default=5, help="Stop launching new tasks after this many failures. 0 means no limit.")
parser.add_argument("--rerun-successful", action="store_true", help="Do not skip tasks that already have a successful status marker.")
args = parser.parse_args()

if args.max_total < 1:
    raise SystemExit("--max-total must be >= 1")
if args.max_per_package < 1:
    raise SystemExit("--max-per-package must be >= 1")
if args.launch_delay < 0:
    raise SystemExit("--launch-delay must be >= 0")
if args.max_started < 0:
    raise SystemExit("--max-started must be >= 0")
if args.max_failures < 0:
    raise SystemExit("--max-failures must be >= 0")

pack = Path(__file__).resolve().parents[1]
selected_packages = set(args.packages)
with (pack / "tasks.tsv").open() as file_handle:
    pending = list(csv.DictReader(file_handle, delimiter="\t"))
if selected_packages:
    pending = [row for row in pending if row["package"] in selected_packages]
total_selected_count = len(pending)


def status_path_for(row):
    return pack / "logs" / "status" / f"{row['task']}.status.tsv"


def has_successful_status(row):
    status_path = status_path_for(row)
    if not status_path.exists():
        return False
    try:
        with status_path.open() as file_handle:
            rows = list(csv.DictReader(file_handle, delimiter="\t"))
    except Exception:
        return False
    return bool(rows) and rows[-1].get("exit_code") == "0"


skipped_successful = []
if not args.rerun_successful:
    remaining = []
    for row in pending:
        if has_successful_status(row):
            skipped_successful.append(row)
        else:
            remaining.append(row)
    pending = remaining

running = []
finished = []
active_by_package = {}
last_launch_at = None
started_count = 0
failure_count = 0
launch_stopped_reason = ""
print_lock = threading.RLock()
COLOR_ENABLED = "NO_COLOR" not in os.environ
COLOR_RESET = "\\x1b[0m" if COLOR_ENABLED else ""
COLOR_BLUE = "\\x1b[1;34m" if COLOR_ENABLED else ""
COLOR_CYAN = "\\x1b[1;36m" if COLOR_ENABLED else ""
COLOR_GREEN = "\\x1b[1;32m" if COLOR_ENABLED else ""
COLOR_RED = "\\x1b[1;31m" if COLOR_ENABLED else ""
COLOR_YELLOW = "\\x1b[1;33m" if COLOR_ENABLED else ""
COLOR_DIM = "\\x1b[2m" if COLOR_ENABLED else ""


def colored(value, color):
    return f"{color}{value}{COLOR_RESET}" if COLOR_ENABLED else value


def package_status():
    return ",".join(f"{package}:{count}" for package, count in sorted(active_by_package.items()) if count > 0) or "-"


def lane_status():
    if not running:
        return "-"
    return ",".join(f"lane-{index}:{row['task']}({row['package']})" for index, (_, row, _) in enumerate(running, start=1))


def success_count():
    return sum(1 for _, exit_code in finished if exit_code == 0)


def pending_count():
    return len(pending)


def progress_lines(label):
    completed = len(finished)
    active = len(running)
    skipped = len(skipped_successful)
    failed = failure_count
    succeeded = success_count()
    remaining = pending_count() + active
    max_started_label = str(args.max_started) if args.max_started else "unlimited"
    max_failures_label = str(args.max_failures) if args.max_failures else "unlimited"
    border = colored("====================================================================================================", COLOR_BLUE)
    failure_color = COLOR_RED if failed else COLOR_GREEN
    return [
        "",
        border,
        colored(f"PROGRESS STATUS — {label}", COLOR_BLUE),
        border,
        colored(f"total_selected={total_selected_count} skipped_successful={skipped} remaining={remaining}", COLOR_CYAN),
        colored(f"started_this_run={started_count}/{max_started_label} completed_this_run={completed} succeeded={succeeded} failed={failed}/{max_failures_label}", failure_color),
        colored(f"currently_running={active}/{args.max_total} pending_not_started={pending_count()} launch_delay_seconds={args.launch_delay}", COLOR_YELLOW),
        colored(f"package_active={package_status()} max_per_package={args.max_per_package}", COLOR_CYAN),
        colored(f"lanes={lane_status()}", COLOR_CYAN),
        colored(f"stop_reason={launch_stopped_reason or '-'}", COLOR_DIM),
        border,
    ]


def print_progress_unlocked(label):
    for line in progress_lines(label):
        print(line, flush=True)


def print_progress(label):
    with print_lock:
        print_progress_unlocked(label)


def print_event(line):
    with print_lock:
        print(line, flush=True)


def can_start(row):
    return len(running) < args.max_total and active_by_package.get(row["package"], 0) < args.max_per_package


def stream_process_output(process, row):
    assert process.stdout is not None
    for line in process.stdout:
        with print_lock:
            print(line, end="", flush=True)
            if "# PROMPT SENT:" in line:
                print_progress_unlocked(f"PROMPT SENT — {row['task']}")


def reap_finished(block=False):
    global failure_count
    while True:
        reaped = False
        for process, row, output_thread in list(running):
            exit_code = process.poll()
            if exit_code is None:
                continue
            output_thread.join(timeout=2)
            running.remove((process, row, output_thread))
            active_by_package[row["package"]] = max(active_by_package.get(row["package"], 1) - 1, 0)
            finished.append((row, exit_code))
            if exit_code != 0:
                failure_count += 1
            print_event(f"FINISH\t{row['task']}\t{exit_code}\t{row['log']}")
            print_progress(f"TASK COMPLETED — {row['task']}")
            reaped = True
        if reaped or not block or not running:
            return
        time.sleep(1)


def wait_for_launch_delay():
    global last_launch_at
    if args.launch_delay <= 0 or last_launch_at is None:
        return
    while True:
        remaining = last_launch_at + args.launch_delay - time.monotonic()
        if remaining <= 0:
            return
        reap_finished(block=False)
        time.sleep(min(1, remaining))


def should_stop_launching():
    global launch_stopped_reason
    if args.max_started and started_count >= args.max_started:
        launch_stopped_reason = f"max-started reached ({started_count}/{args.max_started})"
        return True
    if args.max_failures and failure_count >= args.max_failures:
        launch_stopped_reason = f"max-failures reached ({failure_count}/{args.max_failures})"
        return True
    return False


if skipped_successful:
    print_event(f"SKIPPED-SUCCESSFUL\t{len(skipped_successful)}")
if not pending:
    print_progress("NO TASKS SELECTED AFTER FILTERING")
    raise SystemExit("No tasks selected after filtering already-successful tasks.")
print_progress("INITIAL")

while pending or running:
    started = False
    if should_stop_launching():
        if pending:
            print_event(f"STOP-LAUNCHING\t{launch_stopped_reason}\tpending={len(pending)}")
            pending = []
            print_progress("LAUNCHING STOPPED")
        reap_finished(block=bool(running))
        continue
    for row in list(pending):
        if should_stop_launching():
            break
        if not can_start(row):
            continue
        wait_for_launch_delay()
        if should_stop_launching():
            break
        pending.remove(row)
        active_by_package[row["package"]] = active_by_package.get(row["package"], 0) + 1
        print_event(f"START\t{row['task']}\t{row['package']}\t{row['target']}")
        process = subprocess.Popen(
            ["bash", row["script"]],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        output_thread = threading.Thread(target=stream_process_output, args=(process, row), daemon=True)
        output_thread.start()
        running.append((process, row, output_thread))
        last_launch_at = time.monotonic()
        started_count += 1
        print_event(f"STARTED\t{row['task']}")
        print_progress(f"TASK LAUNCHED — {row['task']}")
        started = True
        if len(running) >= args.max_total:
            break
    reap_finished(block=not started)
    if not started:
        time.sleep(1)

summary_slug = "high-concurrency-summary" if not selected_packages else f"{'-'.join(sorted(selected_packages))}-parallel-bounded-summary"
summary_path = pack / "logs" / f"{summary_slug}.tsv"
with summary_path.open("w") as file_handle:
    file_handle.write("task\\tpackage\\texit_code\\tlog_file\\ttarget\\n")
    for row, exit_code in finished:
        file_handle.write(f"{row['task']}\\t{row['package']}\\t{exit_code}\\t{row['log']}\\t{row['target']}\\n")
print_event(f"SUMMARY\t{summary_path}\tstarted={started_count}\tfailures={failure_count}\t{launch_stopped_reason}")
print_progress("FINAL")
sys.exit(1 if any(exit_code != 0 for _, exit_code in finished) or (args.max_failures and failure_count >= args.max_failures) else 0)
`;
}

/**
 * Embeds the Python status reporter CLI that summarizes done/failed/pending tasks and optional process hints.
 *
 * @remarks
 * PURITY: returns only generated Python text destined for `pack-status.py`.
 */
export function renderBoundedStatusReporter(): string {
  return `#!/usr/bin/env python3
"""Report done, failed, pending, and active task status for a generated Agent Fleet pack."""
from __future__ import annotations

import argparse
import csv
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

parser = argparse.ArgumentParser(description="Show progress for a generated Agent Fleet pack.")
parser.add_argument("--examples", type=int, default=5, help="Examples to show for pending/failed tasks per package.")
parser.add_argument("--no-processes", action="store_true", help="Skip active process listing.")
args = parser.parse_args()

pack = Path(__file__).resolve().parents[1]
tasks_path = pack / "tasks.tsv"
status_dir = pack / "logs" / "status"
if not tasks_path.exists():
    raise SystemExit(f"Missing tasks.tsv in {pack}")

with tasks_path.open() as file_handle:
    tasks = list(csv.DictReader(file_handle, delimiter="\\t"))

status_by_task = {}
if status_dir.exists():
    for status_path in status_dir.glob("*.status.tsv"):
        try:
            with status_path.open() as file_handle:
                records = list(csv.DictReader(file_handle, delimiter="\\t"))
        except Exception:
            continue
        if not records:
            continue
        record = records[-1]
        task_id = record.get("task") or status_path.name.removesuffix(".status.tsv")
        status_by_task[task_id] = record.get("exit_code", "")

counts = defaultdict(Counter)
examples = defaultdict(list)
for task in tasks:
    task_id = task["task"]
    package = task["package"]
    exit_code = status_by_task.get(task_id)
    if exit_code == "0":
        bucket = "done"
    elif exit_code is None:
        bucket = "pending"
    else:
        bucket = "failed"
    counts[package][bucket] += 1
    counts[package]["total"] += 1
    if bucket != "done" and len(examples[(package, bucket)]) < args.examples:
        examples[(package, bucket)].append((task_id, task["target"], exit_code or "-"))

print(f"pack\\t{pack}")
print("package\\ttotal\\tdone\\tfailed\\tpending")
overall = Counter()
for package in sorted(counts):
    package_counts = counts[package]
    overall.update(package_counts)
    print(
        f"{package}\\t{package_counts['total']}\\t{package_counts['done']}\\t"
        f"{package_counts['failed']}\\t{package_counts['pending']}"
    )
print("overall\\t{total}\\t{done}\\t{failed}\\t{pending}".format(
    total=overall["total"],
    done=overall["done"],
    failed=overall["failed"],
    pending=overall["pending"],
))

if args.examples:
    print("\\nfirst pending/failed examples")
    for package, bucket in sorted(examples):
        print(f"\\n[{package} {bucket}]")
        for task_id, target, exit_code in examples[(package, bucket)]:
            print(f"{task_id}\\t{target}\\texit={exit_code}")

if not args.no_processes:
    print("\\nactive scheduler/agent processes")
    try:
        output = subprocess.check_output(["ps", "-axo", "pid,ppid,%cpu,%mem,command"], text=True)
    except Exception as error:
        print(f"process_check_error={error}")
    else:
        needles = {str(pack), str(pack.relative_to(Path.cwd())) if pack.is_relative_to(Path.cwd()) else pack.name, pack.name}
        lines = [
            line for line in output.splitlines()
            if any(needle in line for needle in needles) and "pack-status.py" not in line and "run-status.sh" not in line
        ]
        if lines:
            for line in lines[:40]:
                print(line)
        else:
            print("-")
`;
}
