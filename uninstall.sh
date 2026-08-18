#!/bin/bash
# Unload the schedule. Leaves the code, watchlist and data (including seen.json) intact.
PLIST="$HOME/Library/LaunchAgents/com.nycapartmentwatch.daily.plist"
launchctl unload "$PLIST" 2>/dev/null && echo "Unloaded com.nycapartmentwatch.daily." || echo "Job was not loaded."
mv "$PLIST" "$PLIST.disabled" 2>/dev/null && echo "Renamed plist to .disabled (rename back + launchctl load to revive)."
