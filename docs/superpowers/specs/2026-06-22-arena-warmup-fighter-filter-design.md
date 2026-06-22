# Arena Warmup Fighter Filter Design

## Goal

On the Arena tab, fighter search fields must show only fighters who can still play a warmup battle.

## Current Behavior

`src/pages/Arena.jsx` uses `FighterSelect` for both fighter slots. `FighterSelect` gets options from `filterFighters(people, query, disabledId)` in `src/lib/fighterSearch.js`.

Warmup limits already exist:

- `MAX_WARMUP_BATTLES` is `3` in `src/lib/scoring.js`.
- `canPlayWarmup(participant)` in `src/lib/store.js` returns true while `participant.stats.battles < MAX_WARMUP_BATTLES`.
- `startManualFight()` already blocks a fight if either selected fighter has no attempts left.

The missing behavior is only in the option list: fighters with `stats.battles >= 3` can still appear and be selected.

## Design

Add an optional availability filter to the pure fighter search helper:

```js
filterFighters(people, query, disabledId, { onlyWarmupAvailable: true })
```

When `onlyWarmupAvailable` is true, the helper excludes fighters whose `stats.battles` is greater than or equal to `MAX_WARMUP_BATTLES`. Existing calls without the option keep the current behavior.

Use that option in `FighterSelect` on the Arena tab for both P1 and P2 selectors. The existing `disabledId` behavior stays unchanged, so each selector still excludes the fighter already picked in the other selector.

## Data Flow

`Arena` keeps the participants cache in `people`. `FighterSelect` receives that array, passes it through `filterFighters`, and renders the returned list. After this change, unavailable fighters are removed before slicing the first 8 matches.

The existing `canFight` and `startManualFight` checks remain as backend-facing defense. The UI filter only prevents unavailable fighters from being offered in normal selection.

## Edge Cases

- A fighter with missing `stats` or missing `stats.battles` counts as having `0` warmup battles.
- A selected fighter who becomes unavailable after a fight is still prevented from starting another fight by `canFight`; opening either selector will no longer offer that fighter again.
- Search by name and external user number remains unchanged.

## Testing

Extend `tests/test-fighter-search.mjs` with a red-green test proving that `onlyWarmupAvailable` excludes fighters at the warmup limit while preserving normal search behavior.
