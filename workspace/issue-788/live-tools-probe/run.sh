#!/usr/bin/env bash
# Usage: run.sh <label> <tools.yaml> <agent.md>
LABEL="$1"; TOOLS="$2"; AGENT="$3"
echo "############ $LABEL"
( cd /tmp/atomaton-workspace/live-tools-probe && GITHUB_REPOSITORY=example/repo atoma validate --agent-def "$AGENT" --tools-file "$TOOLS" --with-live-tools )
echo "exit=$?"
