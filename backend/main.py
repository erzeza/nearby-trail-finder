import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from backend.geo import decode_polyline, min_distance_to_route
from backend.overpass import fetch_trails
from backend.strava import (
    exchange_code_for_tokens,
    fetch_all_activities,
    get_authorization_url,
    get_valid_access_token,
    load_tokens,
    save_tokens,
)

load_dotenv()

CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
REDIRECT_URI = os.environ["STRAVA_REDIRECT_URI"]

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="Nearby Trail Finder")
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/auth/strava")
async def auth_strava():
    url = get_authorization_url(CLIENT_ID, REDIRECT_URI)
    return RedirectResponse(url)


@app.get("/auth/callback")
async def auth_callback(code: str = Query(...), error: str = Query(None)):
    if error:
        raise HTTPException(status_code=400, detail=f"Strava OAuth error: {error}")
    tokens = await exchange_code_for_tokens(code, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
    save_tokens(tokens)
    return RedirectResponse("/?connected=true")


@app.get("/api/status")
async def api_status():
    tokens = load_tokens()
    if not tokens:
        return {"authenticated": False}
    athlete = tokens.get("athlete", {})
    return {
        "authenticated": True,
        "athlete_name": f"{athlete.get('firstname', '')} {athlete.get('lastname', '')}".strip(),
        "athlete_id": athlete.get("id"),
    }


@app.get("/api/nearby")
async def api_nearby(
    lat: float = Query(..., description="Latitud del punto central"),
    lng: float = Query(..., description="Longitud del punto central"),
    radius: float = Query(500, ge=50, le=50000, description="Radio de búsqueda en metros"),
):
    access_token = await get_valid_access_token(CLIENT_ID, CLIENT_SECRET)
    if not access_token:
        raise HTTPException(status_code=401, detail="No autenticado con Strava")

    activities = await fetch_all_activities(access_token)

    results = []
    for activity in activities:
        summary_polyline = activity.get("map", {}).get("summary_polyline") or ""
        dist = min_distance_to_route(lat, lng, summary_polyline)
        if dist <= radius:
            results.append(
                {
                    "id": activity["id"],
                    "name": activity.get("name", "Sin nombre"),
                    "type": activity.get("sport_type", activity.get("type", "")),
                    "date": activity.get("start_date_local", ""),
                    "distance_m": activity.get("distance", 0),
                    "elevation_gain_m": activity.get("total_elevation_gain", 0),
                    "closest_point_m": round(dist),
                    "polyline": decode_polyline(summary_polyline),
                    "strava_url": f"https://www.strava.com/activities/{activity['id']}",
                }
            )

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
