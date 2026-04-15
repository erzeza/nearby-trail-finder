import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from backend.geo import decode_polyline, min_distance_to_route
from backend.overpass import fetch_trails
from backend.strava import (
    exchange_code_for_tokens,
    fetch_all_activities,
    get_authorization_url,
    refresh_access_token,
)

load_dotenv()

CLIENT_ID     = os.environ["STRAVA_CLIENT_ID"]
CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
REDIRECT_URI  = os.environ["STRAVA_REDIRECT_URI"]
SECRET_KEY    = os.environ.get("SECRET_KEY", "dev-only-change-in-production")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="Nearby Trail Finder")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=60 * 60 * 24 * 30)
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


# ── Helpers de sesión ─────────────────────────────────────────────────────────

async def get_access_token(request: Request) -> str | None:
    """Devuelve un access token válido para el usuario de la sesión actual."""
    tokens = request.session.get("tokens")
    if not tokens:
        return None
    # Auto-refresh si expira en menos de 60 s
    if tokens.get("expires_at", 0) < time.time() + 60:
        try:
            refreshed = await refresh_access_token(
                tokens["refresh_token"], CLIENT_ID, CLIENT_SECRET
            )
            tokens.update(refreshed)
            request.session["tokens"] = tokens
        except Exception:
            return None
    return tokens.get("access_token")


# ── Rutas ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/auth/strava")
async def auth_strava():
    url = get_authorization_url(CLIENT_ID, REDIRECT_URI)
    return RedirectResponse(url)


@app.get("/auth/callback")
async def auth_callback(
    request: Request,
    code: str = Query(...),
    error: str = Query(None),
):
    if error:
        raise HTTPException(status_code=400, detail=f"Strava OAuth error: {error}")
    tokens = await exchange_code_for_tokens(code, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
    request.session["tokens"] = tokens
    return RedirectResponse("/?connected=true")


@app.get("/auth/logout")
async def auth_logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")


@app.get("/api/status")
async def api_status(request: Request):
    tokens = request.session.get("tokens")
    if not tokens:
        return {"authenticated": False}

    access_token = await get_access_token(request)
    athlete = {}
    if access_token:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(
                    "https://www.strava.com/api/v3/athlete",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if r.status_code == 200:
                    athlete = r.json()
        except Exception:
            athlete = tokens.get("athlete", {})
    else:
        athlete = tokens.get("athlete", {})

    city     = athlete.get("city") or ""
    state    = athlete.get("state") or ""
    location = ", ".join(p for p in [city, state] if p) or None
    return {
        "authenticated":    True,
        "athlete_name":     f"{athlete.get('firstname', '')} {athlete.get('lastname', '')}".strip(),
        "athlete_id":       athlete.get("id"),
        "athlete_photo":    athlete.get("profile_medium") or athlete.get("profile"),
        "athlete_location": location,
    }


@app.get("/api/nearby")
async def api_nearby(
    request: Request,
    lat: float = Query(..., description="Latitud del punto central"),
    lng: float = Query(..., description="Longitud del punto central"),
    radius: float = Query(500, ge=50, le=50000, description="Radio de búsqueda en metros"),
):
    access_token = await get_access_token(request)
    if not access_token:
        raise HTTPException(status_code=401, detail="No autenticado con Strava")

    activities = await fetch_all_activities(access_token)

    results = []
    for activity in activities:
        summary_polyline = activity.get("map", {}).get("summary_polyline") or ""
        dist = min_distance_to_route(lat, lng, summary_polyline)
        if dist <= radius:
            results.append({
                "id": activity["id"],
                "name": activity.get("name", "Sin nombre"),
                "type": activity.get("sport_type", activity.get("type", "")),
                "date": activity.get("start_date_local", ""),
                "distance_m": activity.get("distance", 0),
                "elevation_gain_m": activity.get("total_elevation_gain", 0),
                "closest_point_m": round(dist),
                "polyline": decode_polyline(summary_polyline),
                "strava_url": f"https://www.strava.com/activities/{activity['id']}",
            })

    results.sort(key=lambda a: a["closest_point_m"])
    return {"count": len(results), "activities": results}


@app.get("/api/trails")
async def api_trails(
    lat: float = Query(...),
    lng: float = Query(...),
    radius: float = Query(500, ge=50, le=50000),
):
    """Devuelve todas las sendas del área. El filtrado lo realiza el cliente."""
    try:
        trails = await fetch_trails(lat, lng, radius)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Overpass API no disponible: {e}")
    return {"count": len(trails), "trails": trails}
