import math
import polyline as polyline_lib


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia en metros entre dos puntos usando la fórmula Haversine."""
    R = 6_371_000  # radio de la Tierra en metros
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def min_distance_to_route(lat: float, lng: float, encoded_polyline: str) -> float:
    """
    Distancia mínima en metros desde el punto (lat, lng) a cualquier punto
    de la ruta codificada como Google Encoded Polyline.
    Devuelve float('inf') si el polyline está vacío o es inválido.
    """
    if not encoded_polyline:
        return float("inf")
    try:
        points = polyline_lib.decode(encoded_polyline)
    except Exception:
        return float("inf")
    if not points:
        return float("inf")
    return min(haversine_meters(lat, lng, p[0], p[1]) for p in points)


def decode_polyline(encoded_polyline: str) -> list[list[float]]:
    """Decodifica un encoded polyline a lista de [lat, lng]."""
    if not encoded_polyline:
        return []
    try:
        return [[p[0], p[1]] for p in polyline_lib.decode(encoded_polyline)]
    except Exception:
        return []
