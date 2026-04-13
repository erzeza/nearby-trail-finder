import httpx

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

TRAIL_TYPE_LABELS = {
    "path":      "Senda",
    "track":     "Pista",
    "footway":   "Camino peatonal",
    "cycleway":  "Carril bici / camino",
    "bridleway": "Camino ecuestre",
}

NETWORK_LABELS = {
    "iwn": "Internacional",
    "nwn": "GR Nacional",
    "rwn": "PR Regional",
    "lwn": "SL Local",
}

TRACKTYPE_GRADE = {"grade1": 1, "grade2": 2, "grade3": 3, "grade4": 4, "grade5": 5}

# Tipos de vía que se consultan siempre (el filtrado lo hace el cliente)
HIGHWAY_TYPES = ["path", "track", "footway", "bridleway"]


def _build_query(lat: float, lng: float, radius: float) -> str:
    around = f"around:{radius:.0f},{lat},{lng}"
    way_clauses = "\n  ".join(
        f'way["highway"="{hw}"]({around});' for hw in HIGHWAY_TYPES
    )
    return f"""[out:json][timeout:30];
(
  {way_clauses}
  relation["route"~"hiking|foot|mtb"]({around});
);
out geom;"""


def _parse_way(element: dict) -> dict | None:
    geometry = element.get("geometry", [])
    if not geometry:
        return None
    tags = element.get("tags", {})
    coords = [[p["lat"], p["lon"]] for p in geometry]
    hw = tags.get("highway", "path")
    return {
        "osm_id":     element["id"],
        "osm_type":   "way",
        "name":       tags.get("name") or tags.get("ref") or None,
        "type_label": TRAIL_TYPE_LABELS.get(hw, hw.capitalize()),
        "highway":    hw,
        "sac_scale":  tags.get("sac_scale"),
        "surface":    tags.get("surface"),
        "tracktype":  tags.get("tracktype"),
        "network":    None,
        "coordinates": coords,
        "osm_url":    f"https://www.openstreetmap.org/way/{element['id']}",
    }


def _parse_relation(element: dict) -> dict | None:
    tags = element.get("tags", {})
    coords_segments = []
    for member in element.get("members", []):
        if member.get("type") == "way" and member.get("geometry"):
            seg = [[p["lat"], p["lon"]] for p in member["geometry"]]
            if seg:
                coords_segments.append(seg)
    if not coords_segments:
        return None
    network = tags.get("network", "")
    route   = tags.get("route", "hiking")
    return {
        "osm_id":     element["id"],
        "osm_type":   "relation",
        "name":       tags.get("name") or tags.get("ref") or None,
        "type_label": "Ruta de senderismo" if route in ("hiking", "foot") else f"Ruta {route.upper()}",
        "highway":    None,
        "sac_scale":  None,
        "surface":    None,
        "tracktype":  None,
        "network":    network,
        "network_label":        NETWORK_LABELS.get(network),
        "ref":                  tags.get("ref"),
        "coordinates_segments": coords_segments,
        "osm_url":    f"https://www.openstreetmap.org/relation/{element['id']}",
    }


async def fetch_trails(lat: float, lng: float, radius: float) -> list[dict]:
    """Devuelve TODAS las sendas dentro del radio. El filtrado lo hace el cliente."""
    query = _build_query(lat, lng, radius)
    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=35.0) as client:
        for server in OVERPASS_SERVERS:
            try:
                response = await client.post(server, data={"data": query})
                response.raise_for_status()
                data = response.json()
                break
            except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.ConnectError) as e:
                last_error = e
                continue
        else:
            raise RuntimeError(f"Todos los servidores Overpass fallaron. Último error: {last_error}")

    trails = []
    seen_ids: set = set()
    for element in data.get("elements", []):
        eid = (element.get("type"), element.get("id"))
        if eid in seen_ids:
            continue
        seen_ids.add(eid)

        if element["type"] == "way":
            parsed = _parse_way(element)
        elif element["type"] == "relation":
            parsed = _parse_relation(element)
        else:
            continue

        if parsed:
            trails.append(parsed)

    return trails
