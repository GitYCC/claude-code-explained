# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a minimal demonstration repository containing sample content and a proxy configuration script for Claude Code.

## Repository Structure

- `demo.md` - Sample markdown document about unicorns (demonstration content)
- `run.sh` - Shell script that configures Proxyman proxy settings and launches Claude CLI

## Running Claude with Proxy

The repository includes a proxy configuration script:

```bash
./run.sh
```

This script:
1. Sources Proxyman environment variables from `~/Library/Application Support/com.proxyman.NSProxy/app-data/proxyman_env_automatic_setup.sh`
2. Launches the Claude CLI with the proxy configuration applied
