"""OPAP (Greek state lottery) public API access.

Shared by the manual "/api/opap" endpoint and the automated scheduler, so
both go through the exact same request/parsing logic.
"""

from __future__ import annotations

import aiohttp

# prizeCategories[0] is the jackpot category; the advertised amount is
# whichever is larger of the currently accumulated pool ("jackpot") and the
# guaranteed minimum for the next draw ("minimumDistributed").
OPAP_GAME_IDS = {"tzoker": 5104, "eurojackpot": 5149}


async def fetch_jackpot(session: aiohttp.ClientSession, game_id: int) -> float:
    url = f"https://api.opap.gr/draws/v3.0/{game_id}/active"
    async with session.get(url) as res:
        if res.status != 200:
            raise RuntimeError(f"OPAP request failed: HTTP {res.status}")
        data = await res.json()
    categories = data.get("prizeCategories", [])
    category = next((c for c in categories if c.get("categoryType") == 0), categories[0] if categories else {})
    return max(category.get("jackpot") or 0, category.get("minimumDistributed") or 0)
