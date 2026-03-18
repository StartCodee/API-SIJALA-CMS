const turf = require("@turf/turf");

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toRoundedNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function coordinatesEqual(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length >= 2 &&
    b.length >= 2 &&
    Number(a[0]) === Number(b[0]) &&
    Number(a[1]) === Number(b[1]);
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) {
    return ring;
  }

  const normalized = ring
    .map((coordinate) => [
      Number(coordinate?.[0]),
      Number(coordinate?.[1]),
    ])
    .filter((coordinate) => coordinate.every(isFiniteNumber));

  if (normalized.length < 3) {
    return normalized;
  }

  if (!coordinatesEqual(normalized[0], normalized[normalized.length - 1])) {
    normalized.push([...normalized[0]]);
  }

  return normalized;
}

function normalizePolygonCoordinates(coordinates, type) {
  if (type === "Polygon") {
    return Array.isArray(coordinates)
      ? coordinates.map((ring) => closeRing(ring)).filter((ring) => ring.length >= 4)
      : [];
  }

  if (type === "MultiPolygon") {
    return Array.isArray(coordinates)
      ? coordinates
          .map((polygon) => normalizePolygonCoordinates(polygon, "Polygon"))
          .filter((polygon) => polygon.length > 0)
      : [];
  }

  return [];
}

function uniqueLineCoordinates(coordinates) {
  const normalized = [];

  (Array.isArray(coordinates) ? coordinates : []).forEach((coordinate) => {
    const entry = [Number(coordinate?.[0]), Number(coordinate?.[1])];
    if (!entry.every(isFiniteNumber)) {
      return;
    }

    if (!normalized.length || !coordinatesEqual(normalized[normalized.length - 1], entry)) {
      normalized.push(entry);
    }
  });

  return normalized;
}

function ensureFeature(input, message) {
  if (!input || typeof input !== "object") {
    throw createError(400, message);
  }

  if (input.type === "Feature" && input.geometry) {
    return {
      type: "Feature",
      properties: input.properties && typeof input.properties === "object" ? input.properties : {},
      geometry: input.geometry,
    };
  }

  if (input.type && input.coordinates) {
    return {
      type: "Feature",
      properties: {},
      geometry: input,
    };
  }

  throw createError(400, message);
}

function normalizePolygonFeature(input) {
  const feature = ensureFeature(input, "Polygon area tidak valid.");
  const geometryType = feature?.geometry?.type;

  if (!["Polygon", "MultiPolygon"].includes(geometryType)) {
    throw createError(400, "Polygon area harus berupa Polygon atau MultiPolygon.");
  }

  const coordinates = normalizePolygonCoordinates(feature.geometry.coordinates, geometryType);
  if (!coordinates.length) {
    throw createError(400, "Polygon area belum memiliki koordinat yang valid.");
  }

  return {
    ...feature,
    geometry: {
      type: geometryType,
      coordinates,
    },
  };
}

function normalizeRouteFeature(input) {
  if (!input) {
    return null;
  }

  if (Array.isArray(input)) {
    return buildRouteFeatureFromPoints(input);
  }

  const feature = ensureFeature(input, "Route tidak valid.");
  const geometryType = feature?.geometry?.type;

  if (geometryType === "Point") {
    const coordinates = [Number(feature.geometry.coordinates?.[0]), Number(feature.geometry.coordinates?.[1])];
    if (!coordinates.every(isFiniteNumber)) {
      throw createError(400, "Titik route tidak valid.");
    }

    return {
      ...feature,
      geometry: {
        type: "Point",
        coordinates,
      },
    };
  }

  if (geometryType === "LineString") {
    const coordinates = uniqueLineCoordinates(feature.geometry.coordinates);
    if (coordinates.length === 1) {
      return turf.point(coordinates[0], feature.properties || {});
    }

    if (coordinates.length < 2) {
      throw createError(400, "Route garis minimal membutuhkan dua titik.");
    }

    return turf.lineString(coordinates, feature.properties || {});
  }

  if (geometryType === "MultiLineString") {
    const coordinates = (Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : [])
      .map((line) => uniqueLineCoordinates(line))
      .filter((line) => line.length >= 2);

    if (!coordinates.length) {
      throw createError(400, "Route garis belum memiliki koordinat yang valid.");
    }

    return {
      ...feature,
      geometry: {
        type: "MultiLineString",
        coordinates,
      },
    };
  }

  throw createError(400, "Route harus berupa Point, LineString, atau MultiLineString.");
}

function buildRouteFeatureFromPoints(points = []) {
  const coordinates = points
    .map((point) => [Number(point?.longitude), Number(point?.latitude)])
    .filter((coordinate) => coordinate.every(isFiniteNumber));

  const uniqueCoordinates = uniqueLineCoordinates(coordinates);
  if (!uniqueCoordinates.length) {
    return null;
  }

  if (uniqueCoordinates.length === 1) {
    return turf.point(uniqueCoordinates[0]);
  }

  return turf.lineString(uniqueCoordinates);
}

function calculateCoverage({ polygon, route, bufferKm = 1 }) {
  const polygonFeature = normalizePolygonFeature(polygon);
  const polygonAreaSqMeters = turf.area(polygonFeature);

  if (!(polygonAreaSqMeters > 0)) {
    throw createError(400, "Polygon area harus memiliki luas lebih dari 0.");
  }

  const routeFeature = normalizeRouteFeature(route);
  if (!routeFeature) {
    return {
      polygonFeature,
      routeFeature: null,
      bufferFeature: null,
      coveredFeature: null,
      metrics: {
        bufferKm,
        polygonAreaSqKm: toRoundedNumber(polygonAreaSqMeters / 1_000_000),
        coveredAreaSqKm: 0,
        remainingAreaSqKm: toRoundedNumber(polygonAreaSqMeters / 1_000_000),
        coveragePercent: 0,
        routeLengthKm: 0,
      },
    };
  }

  let bufferFeature = null;
  let coveredFeature = null;

  try {
    bufferFeature = turf.buffer(routeFeature, bufferKm, {
      units: "kilometers",
    });

    if (bufferFeature) {
      coveredFeature = turf.intersect(
        turf.featureCollection([bufferFeature, polygonFeature])
      );
    }
  } catch (error) {
    throw createError(
      400,
      `Perhitungan coverage gagal diproses: ${error.message || "geometry tidak valid."}`
    );
  }

  const coveredAreaSqMeters = coveredFeature ? turf.area(coveredFeature) : 0;
  const routeLengthKm =
    routeFeature.geometry.type === "Point"
      ? 0
      : turf.length(routeFeature, { units: "kilometers" });

  return {
    polygonFeature,
    routeFeature,
    bufferFeature,
    coveredFeature,
    metrics: {
      bufferKm,
      polygonAreaSqKm: toRoundedNumber(polygonAreaSqMeters / 1_000_000),
      coveredAreaSqKm: toRoundedNumber(coveredAreaSqMeters / 1_000_000),
      remainingAreaSqKm: toRoundedNumber(
        Math.max(polygonAreaSqMeters - coveredAreaSqMeters, 0) / 1_000_000
      ),
      coveragePercent: toRoundedNumber(
        Math.min((coveredAreaSqMeters / polygonAreaSqMeters) * 100, 100),
        2
      ),
      routeLengthKm: toRoundedNumber(routeLengthKm),
    },
  };
}

module.exports = {
  createError,
  normalizePolygonFeature,
  normalizeRouteFeature,
  buildRouteFeatureFromPoints,
  calculateCoverage,
};
