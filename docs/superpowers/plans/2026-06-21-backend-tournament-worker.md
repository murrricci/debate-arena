# Backend Tournament Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tournament match execution from the browser to the backend, with automatic recovery of orphaned running matches.

**Architecture:** Add a server-side tournament worker that owns queue scheduling, match execution, battle history writes, result recording, and stale running recovery. The browser tournament page becomes a read-only dashboard plus explicit user controls such as start/reset/navigation.

**Tech Stack:** Node/Express, existing SQLite-backed `db.js`, existing `runDebateFight` with injected server-side LLM caller, existing React UI for display.

## Global Constraints

- Browser must not conduct tournament fights or call LLM for tournament execution.
- Browser may only display state and accept user interaction.
- Existing `/api/claude` behavior must stay compatible.
- Tournament history must still be saved as `tournament: true` battles.
- Stale `running` matches must be retried automatically after backend restart or frontend interruption.
- No new npm dependencies.

---

### Task 1: Pure Worker Core And Recovery Tests

**Files:**
- Create: `src/lib/tournamentWorker.js`
- Modify: `tests/test-tournament.mjs`

**Interfaces:**
- Produces: `recoverStaleMatches(tournament, now, timeoutMs)`, `createTournamentWorker(deps)`
- Consumes: `recordTournamentMatchError`, `queuedMatchesToStart`, `markTournamentMatchesRunning`, `recordTournamentMatchResult`

- [ ] Add tests proving stale `running` matches become superseded error attempts plus queued retry.
- [ ] Run `node tests/test-tournament.mjs` and verify the new tests fail because exports do not exist.
- [ ] Implement `recoverStaleMatches` and worker scheduling with injected dependencies.
- [ ] Re-run `node tests/test-tournament.mjs`.

### Task 2: Server-Side LLM Caller And Worker Wiring

**Files:**
- Modify: `server.js`
- Modify: `tests/test-api.mjs`

**Interfaces:**
- Consumes: `createTournamentWorker`
- Produces: backend worker start from `/api/tournament/start`, recovery endpoint `/api/tournament/recover-stale`

- [ ] Add API tests proving starting a tournament can complete a match without browser-side calls, using a fast test worker/call path.
- [ ] Run `npm run test:api` and verify failure.
- [ ] Add `callClaudeBackend` helper that shares `/api/claude` model selection behavior and returns the `callClaude`-compatible shape.
- [ ] Instantiate backend worker in `server.js`, start it after `/api/tournament/start`, and expose `/api/tournament/recover-stale`.
- [ ] Re-run `npm run test:api`.

### Task 3: Browser Tournament Page Becomes Display Only

**Files:**
- Modify: `src/pages/Tournament.jsx`

**Interfaces:**
- Consumes: `beginTournament`, `getTournament`, `standings`, `progress`
- Removes: browser-side `runDebateFight`, `saveTournamentBattle`, `recordMatchResult`, `recordMatchError`, `markMatchesRunning`

- [ ] Remove browser imports that conduct tournament fights.
- [ ] Remove `activeRef`, queue scheduling effect, and `runTournamentMatch`.
- [ ] Keep start button, polling, scoreboard, live match display, and history links.
- [ ] Verify no `runDebateFight` or `saveTournamentBattle` remains in `Tournament.jsx`.

### Task 4: Verification And Browser Audit

**Files:**
- No production edits unless tests expose a bug.

**Checks:**
- `npm run test:unit`
- `npm run test:api`
- `npm run build`
- `rg "runDebateFight|saveTournamentBattle|markMatchesRunning|recordMatchResult|recordMatchError" src/pages/Tournament.jsx src`

- [ ] Run full checks.
- [ ] Confirm only manual Arena uses browser fight execution; tournament execution must be backend-only.
