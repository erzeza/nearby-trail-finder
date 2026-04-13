import json
import os
from pathlib import Path

import httpx

STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://www.strava.com/api/v3"
TOKENS_FILE = Path(__file__).parent.parent / ".tokens.json"


def get_authorization_url(client_id: str, redirect_uri: str) -> str:
    params = (
        f"client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope=activity:read_all"
    )
    return f"{STRAVA_AUTH_URL}?{params}"


async def exchange_code_for_tokens(
    code: str, client_id: str, client_secret: str, redirect_uri: str
) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            STRAVA_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )
        response.raise_for_status()
        return response.json()


async def refresh_access_token(
    refresh_token: str, client_id: str, client_secret: str
) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            STRAVA_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        response.raise_for_status()
        return response.json()


def save_tokens(tokens: dict) -> None:
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2))


def load_tokens() -> dict | None:
    if not TOKENS_FILE.exists():
        return None
    try:
        return json.loads(TOKENS_FILE.read_text())
    except Exception:
        return None


async def get_valid_access_token(client_id: str, client_secret: str) -> str | None:
    """Devuelve un access token válido, refrescándolo si ha expirado."""
    import time

    tokens = load_tokens()
    if not tokens:
        return None

    # Si el token expira en menos de 60 segundos, lo refrescamos
    if tokens.get("expires_at", 0) - time.time() < 60:
        new_tokens = await refresh_access_token(
            tokens["refresh_token"], client_id, client_secret
        )
        tokens.update(new_tokens)
        save_tokens(tokens)

    return tokens.get("access_token")


async def fetch_all_activities(access_token: str) -> list[dict]:
    """
    Descarga todas las actividades del atleta de forma paginada.
    Cada actividad incluye summary_polyline (ruta simplificada).
    """
    activities = []
    page = 1
    per_page = 100

    async with httpx.AsyncClient() as client:
        while True:
            response = await client.get(
                f"{STRAVA_API_BASE}/athlete/activities",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"page": page, "per_page": per_page},
                timeout=30.0,
            )
            response.raise_for_status()
            batch = response.json()
            if not batch:
                break
            activities.extend(batch)
            if len(batch) < per_page:
                break
            page += 1

    return activities
