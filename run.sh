#!/bin/bash
# NYC Apartment Watch, daily rent-stabilized 2BR vacancy scan.
#
# Pipeline:
#   1. prepare.py   re-verifies each watchlist building's tax exemption against the live
#                   NYC DOF assessment roll, picks the day's target set (all Tier 1 plus a
#                   rotating slice of Tier 2/3), and writes data/context-<DATE>.md
#   2. claude -p    searches the listing sites for open 2BRs in those buildings, resolves
#                   leasing contacts, and writes the HTML brief + data/found-<DATE>.json
#   3. record.py    merges found listings into data/seen.json so tomorrow can tell new
#                   vacancies from carried-over ones
#   4. post         strips em dashes, updates latest.html, opens the brief in Chrome
#
# Output:
#   ~/Desktop/Claude Work Flows/NYC Apartment Watch/<YYYY-MM-DD>/apartment-watch-<YYYY-MM-DD>.html

set -u

# launchd gives a minimal PATH; the Claude CLI lives in ~/.local/bin.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="$SCRIPT_DIR/prompt.md"
LOG_DIR="$SCRIPT_DIR/logs"
DATA_DIR="$SCRIPT_DIR/data"
DATE="$(date +%Y-%m-%d)"

# Output root: profile.json paths.output_root, else a sensible default.
OUTPUT_ROOT="$(python3 - <<'PY'
import json,os
here=os.path.dirname(os.path.abspath("run.sh"))
root=None
for n in ("profile.json","profile.example.json"):
    p=os.path.join(os.environ.get("SCRIPT_DIR",here),n)
    if os.path.exists(p):
        root=(json.load(open(p)).get("paths") or {}).get("output_root"); break
print(root or os.path.expanduser("~/Desktop/Claude Work Flows/NYC Apartment Watch"))
PY
)"
OUTPUT_DIR="$OUTPUT_ROOT/$DATE"
HTML_PATH="$OUTPUT_DIR/apartment-watch-$DATE.html"
LATEST_SYMLINK="$OUTPUT_ROOT/latest.html"

mkdir -p "$LOG_DIR" "$DATA_DIR" "$OUTPUT_DIR"
LOG_FILE="$LOG_DIR/run-$DATE.log"

echo "=== NYC Apartment Watch run: $(date -Iseconds) ===" >> "$LOG_FILE"

# --- 1. deterministic prep: verify benefits, pick targets, build context -------------
python3 "$SCRIPT_DIR/prepare.py" "$DATE" >> "$LOG_FILE" 2>&1
PREP_EXIT=$?
CONTEXT_FILE="$DATA_DIR/context-$DATE.md"
if [ $PREP_EXIT -ne 0 ] || [ ! -f "$CONTEXT_FILE" ]; then
  echo "FATAL: prepare.py failed (exit $PREP_EXIT) or context file missing. Aborting." >> "$LOG_FILE"
  exit 1
fi

# --- 2. the search + write step ------------------------------------------------------
# Substitute {{DATE}} in the prompt, then append today's verified context block.
PROMPT="$(sed "s/{{DATE}}/$DATE/g" "$PROMPT_FILE")
$(cat "$CONTEXT_FILE")"

claude -p --dangerously-skip-permissions "$PROMPT" >> "$LOG_FILE" 2>&1
CLAUDE_EXIT=$?
echo "=== Claude exit: $CLAUDE_EXIT at $(date -Iseconds) ===" >> "$LOG_FILE"

# --- 3. merge into the seen ledger ---------------------------------------------------
python3 "$SCRIPT_DIR/record.py" "$DATE" >> "$LOG_FILE" 2>&1 || true

# --- 3b. assemble the Live Inventory dataset and stage the UI ------------------------
# build_inventory.py joins the agent's findings to the building profiles, coordinates and
# verified benefit status, then writes inventory-<date>.json plus inventory-latest.js
# (a script-tag copy, because Chrome blocks fetch() on file:// URLs).
python3 "$SCRIPT_DIR/build_inventory.py" "$DATE" "$OUTPUT_DIR" >> "$LOG_FILE" 2>&1 || \
  echo "WARNING: build_inventory.py failed; the Live Inventory tab will show no data." >> "$LOG_FILE"
cp "$SCRIPT_DIR/legacy-ui/index.html" "$SCRIPT_DIR/legacy-ui/app.js" "$SCRIPT_DIR/legacy-ui/styles.css" \
   "$OUTPUT_DIR"/ 2>>"$LOG_FILE" || echo "WARNING: could not stage the app files." >> "$LOG_FILE"

# --- 3c. publish to the deployed UI, if configured -----------------------------------
# Only fires when DEPLOY_URL and INGEST_SECRET are available; otherwise skipped
# silently so a purely local setup is unaffected.
if [ -f "$SCRIPT_DIR/.env.publish" ] || [ -n "${DEPLOY_URL:-}" ]; then
  bash "$SCRIPT_DIR/publish.sh" "$DATE" >> "$LOG_FILE" 2>&1 \
    && echo "Published to the deployed UI." >> "$LOG_FILE" \
    || echo "WARNING: publish step failed; the local artifact is still fine." >> "$LOG_FILE"
fi

# --- 4. post-processing --------------------------------------------------------------
if [ -f "$HTML_PATH" ]; then
  python3 "$HOME/granola-daily/text_utils.py" "$HTML_PATH" >> "$LOG_FILE" 2>&1 || true

  rm -f "$LATEST_SYMLINK"
  ln -s "$DATE/apartment-watch-$DATE.html" "$LATEST_SYMLINK"

  # The interface is the entry point now. The daily brief is reachable as a tab inside it.
  if [ -f "$OUTPUT_DIR/index.html" ]; then
    open -a "Google Chrome" "$OUTPUT_DIR/index.html"
    echo "Opened $OUTPUT_DIR/index.html" >> "$LOG_FILE"
  else
    open -a "Google Chrome" "$HTML_PATH"
    echo "Opened $HTML_PATH (app shell missing)" >> "$LOG_FILE"
  fi
else
  echo "WARNING: expected HTML at $HTML_PATH but file not found. Skipping Chrome." >> "$LOG_FILE"
fi

exit $CLAUDE_EXIT
