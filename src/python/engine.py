"""
NiftyStats Python engine entry point.

Runs inside Pyodide. The JS side calls `engine.run(payload)` with a JSON-ish
dict containing the parsed CSV and any user options. We hand back another
dict matching the AnalysisResult shape defined in src/types/stats.ts.

Milestone 4-6 fill in the descriptive, relational, and advanced modules.
For milestone 1 this file is a stub so the file tree shows the intended
structure.
"""

from __future__ import annotations
from typing import Any


def run(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Top-level dispatch. JS calls this once per uploaded CSV.

    Args:
        payload: {
            'rows': list of dicts (PapaParse output with header: true),
            'options': optional dict of user preferences (significance level,
                       max clusters to try, etc.)
        }

    Returns:
        AnalysisResult-shaped dict. See src/types/stats.ts.
    """
    # Milestone 4 swaps this stub for real work:
    #   from descriptive import describe
    #   from relational import relate
    #   from advanced import advance
    #
    #   df = _to_dataframe(payload['rows'])
    #   return {
    #       'descriptive': describe(df, payload.get('options', {})),
    #       'relational': relate(df, payload.get('options', {})),
    #       'advanced': advance(df, payload.get('options', {})),
    #       'generatedAt': datetime.now(UTC).isoformat(),
    #   }
    raise NotImplementedError("Stats engine wiring lands in milestone 4.")
