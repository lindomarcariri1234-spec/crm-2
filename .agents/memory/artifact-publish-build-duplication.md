---
name: Artifact publish build duplication
description: Avoid repeating artifact builds in the project-level publishing build command.
---

Replit's artifact-aware publishing process builds registered artifacts before running the project-level publishing build command. Do not repeat the same artifact build commands in the deployment configuration.

**Why:** Rebuilding the web and API after the web, API, and mobile artifacts had already completed pushed an otherwise successful publish past its time limit; the log ended during the redundant second frontend build.

**How to apply:** Keep the autoscale run command for the production server, but leave the project-level build unset when registered artifact builds already produce the required output. When a publish ends abruptly after successful artifact builds, inspect for a duplicate deployment build step before treating warnings as compilation failures.