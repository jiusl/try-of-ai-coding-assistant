#!/usr/bin/env bash
# hello_world tool — reads JSON input from stdin, outputs greeting

# Read all stdin
INPUT=$(cat)

# Extract name and language using simple grep/sed (no jq dependency)
NAME=$(echo "$INPUT" | grep -o '"name"\s*:\s*"[^"]*"' | sed 's/.*"name"\s*:\s*"\([^"]*\)".*/\1/')
LANG=$(echo "$INPUT" | grep -o '"language"\s*:\s*"[^"]*"' | sed 's/.*"language"\s*:\s*"\([^"]*\)".*/\1/')

# Default to en if not specified
if [ -z "$LANG" ]; then
  LANG="en"
fi

# Greetings in different languages
case "$LANG" in
  zh) GREETING="你好" ;;
  ja) GREETING="こんにちは" ;;
  es) GREETING="¡Hola" ;;
  *)  GREETING="Hello" ;;
esac

if [ -z "$NAME" ]; then
  echo "$GREETING, World! 🌍"
else
  echo "$GREETING, $NAME! 👋"
fi
