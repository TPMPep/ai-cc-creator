# Python Script Updates for Railway Repo

## How to Use
Copy each `.py` file from this folder into your Railway repo at `services/` (or `main.py` at root).

## Files to Update

| File Here | Destination in Railway Repo | What Changed |
|---|---|---|
| `editorial_ai.py` | `services/editorial_ai.py` | Dynamic GPT prompt reads all env vars instead of hardcoded NBCU values |
| `qc.py` | `services/qc.py` | All profile helpers always read env vars (not just when profile=="custom") |
| `readability.py` | `services/readability.py` | Same — always reads env vars for min durations, merge gaps |
| `formatter.py` | `services/formatter.py` | Reads SOUND_DENSITY, SPEAKER_LABEL_MODE, TIMECODE_OFFSET_MS, etc. |
| `main.py` | `main.py` | Improved captionOptions→env mapping, passes protected_phrases properly |

## What Changed (Summary)

### Problem
All Python scripts had this pattern:
```python
def _max_lines():
    if _caption_profile() == "custom":
        return _env_int("CUSTOM_MAX_LINES", 2)
    return 2  # ← hardcoded NBCU
```

This meant every non-"custom" profile (including future Netflix, Disney+, etc.) 
fell back to hardcoded NBCU values, ignoring the env vars sent from the frontend.

### Fix
Now ALL profile helpers ALWAYS read env vars with NBCU as the default fallback:
```python
def _max_lines():
    return _env_int("CUSTOM_MAX_LINES", 2)
```

The frontend already sends the correct values for each profile (NBCU sends 2/32, 
custom sends whatever the user set). The Python scripts just need to read them.

### New Env Vars Now Consumed
These were sent by the frontend but previously ignored by Python:
- `SPEAKER_LABEL_MODE` — now used in editorial_ai.py GPT prompt
- `SOUND_DENSITY` — now used in formatter.py sound cue filtering
- `TIMECODE_OFFSET_MS` — now applied in formatter.py
- `VALIDATE_TTML` / `FAIL_ON_TTML_VALIDATION` — now checked in formatter.py
- `ITALICIZE_TITLES` / `ITALICIZE_PHRASES` — now applied in formatter.py
- `ALIGNMENT_DEFAULT` / `ALIGNMENT_WINDOWS` — now applied in formatter.py