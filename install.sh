#!/bin/bash
# Load the NYC Apartment Watch daily schedule (8:00 AM ET).
set -e
PLIST="$HOME/Library/LaunchAgents/com.nycapartmentwatch.daily.plist"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Loaded com.nycapartmentwatch.daily (daily 8:00 AM)."
launchctl list | grep nycapartmentwatch || echo "WARNING: job not showing in launchctl list."
echo
echo "Run it now:            ~/scripts/nyc-apartment-watch/run.sh"
echo "Dry-run prep only:     python3 ~/scripts/nyc-apartment-watch/prepare.py \$(date +%F)"
echo "Logs:                  ~/scripts/nyc-apartment-watch/logs/"
