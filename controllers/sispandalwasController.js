const db = require("../db");
const config = require("../config");
const spotFeedService = require("../services/spotFeedService");
const {
  createError,
  normalizePolygonFeature,
  buildRouteFeatureFromPoints,
  calculateCoverage,
} = require("../services/sispandalwasCoverageService");

function getTrackerId(source) {
  const trackerId = String(source?.trackerId || "").trim();
  if (!trackerId) {
    throw createError(400, "trackerId wajib diisi.");
  }
  return trackerId;
}

function parseOptionalDate(value, label) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createError(400, `${label} tidak valid.`);
  }

  return date;
}

function parseLimit(value, fallback = 1000, max = 5000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

function normalizeTrackPoint(row) {
  return {
    id: row.id,
    trackerId: row.tracker_id,
    trackerName: row.tracker_name || row.tracker_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    recordedAt: row.recorded_at ? new Date(row.recorded_at).toISOString() : null,
    messageType: row.message_type || "POSITION",
    batteryState: row.battery_state || "UNKNOWN",
    sourceMessageId: row.source_message_id || null,
  };
}

function formatAreaRecord(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    trackerId: row.tracker_id,
    name: row.name,
    polygon: row.polygon_geojson,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function deriveTrackerStatus(recordedAt, isActive) {
  if (!isActive) {
    return "Maintenance";
  }

  if (!recordedAt) {
    return "Offline";
  }

  const ageMs = Date.now() - new Date(recordedAt).getTime();
  const isOnline = ageMs <= config.trackerOnlineWindowMinutes * 60 * 1000;
  return isOnline ? "Online" : "Offline";
}

function deriveFeedConnection(row) {
  if (row?.last_error) {
    return {
      state: "error",
      label: "Gagal Polling",
    };
  }

  if (row?.last_success_at) {
    if (Number(row?.last_message_count || 0) > 0) {
      return {
        state: "connected",
        label: "Terhubung",
      };
    }

    return {
      state: "empty",
      label: "Terhubung, 0 pesan",
    };
  }

  if (row?.last_polled_at) {
    return {
      state: "polling",
      label: "Polling",
    };
  }

  return {
    state: "idle",
    label: "Belum Dipoll",
  };
}

function buildTrackerSummary(trackers) {
  return trackers.reduce(
    (summary, tracker) => {
      summary.total += 1;

      if (tracker.status === "Online") {
        summary.online += 1;
      } else if (tracker.status === "Maintenance") {
        summary.maintenance += 1;
      } else {
        summary.offline += 1;
      }

      return summary;
    },
    {
      total: 0,
      online: 0,
      offline: 0,
      maintenance: 0,
    }
  );
}

function normalizeVisibility(value) {
  const visibility = String(value || "public").trim().toLowerCase();
  if (!["public", "private"].includes(visibility)) {
    throw createError(400, "visibility harus bernilai public atau private.");
  }
  return visibility;
}

function sanitizeTrackerConfigInput(payload = {}) {
  const feedId = String(payload.feedId || "").trim();
  const trackerName = String(payload.trackerName || "").trim();
  const visibility = normalizeVisibility(payload.visibility);
  const feedPassword = typeof payload.feedPassword === "string" ? payload.feedPassword.trim() : "";
  const isActive = payload.isActive !== undefined ? Boolean(payload.isActive) : true;

  if (!feedId) {
    throw createError(400, "feedId wajib diisi.");
  }

  if (!trackerName) {
    throw createError(400, "trackerName wajib diisi.");
  }

  if (visibility === "private" && !feedPassword) {
    throw createError(400, "feedPassword wajib diisi untuk feed private.");
  }

  return {
    feedId,
    trackerName,
    visibility,
    feedPassword: visibility === "private" ? feedPassword : null,
    isActive,
  };
}

function formatTrackerConfigRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    feedId: row.feed_id,
    trackerName: row.tracker_name,
    visibility: row.visibility,
    hasPassword: Boolean(row.feed_password),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    lastPolledAt: row.last_polled_at ? new Date(row.last_polled_at).toISOString() : null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastError: row.last_error || null,
    lastMessageCount: Number(row.last_message_count || 0),
    lastInsertedCount: Number(row.last_inserted_count || 0),
  };
}

async function getCoverageAreaRow(trackerId) {
  const result = await db.query(
    `
      SELECT id, tracker_id, name, polygon_geojson, created_at, updated_at
      FROM sispandalwas_coverage_areas
      WHERE tracker_id = $1
      LIMIT 1
    `,
    [trackerId]
  );

  return result.rows[0] || null;
}

async function getTrackRows({ trackerId, startAt = null, endAt = null, limit = 1000 }) {
  const values = [trackerId];
  const whereClause = ["tracker_id = $1"];

  if (startAt) {
    values.push(startAt.toISOString());
    whereClause.push(`recorded_at >= $${values.length}`);
  }

  if (endAt) {
    values.push(endAt.toISOString());
    whereClause.push(`recorded_at <= $${values.length}`);
  }

  values.push(limit);

  const result = await db.query(
    `
      SELECT
        latest_points.id,
        latest_points.tracker_id,
        latest_points.tracker_name,
        latest_points.latitude,
        latest_points.longitude,
        latest_points.recorded_at,
        latest_points.message_type,
        latest_points.battery_state,
        latest_points.source_message_id
      FROM (
        SELECT
          id,
          tracker_id,
          tracker_name,
          latitude,
          longitude,
          recorded_at,
          message_type,
          battery_state,
          source_message_id
        FROM sispandalwas_track_points
        WHERE ${whereClause.join(" AND ")}
        ORDER BY recorded_at DESC, id DESC
        LIMIT $${values.length}
      ) AS latest_points
      ORDER BY latest_points.recorded_at ASC, latest_points.id ASC
    `,
    values
  );

  return result.rows;
}

async function getTrackerOverviewRows() {
  const result = await db.query(`
    WITH latest_points AS (
      SELECT DISTINCT ON (tracker_id)
        tracker_id,
        tracker_name,
        latitude,
        longitude,
        recorded_at,
        message_type,
        battery_state,
        source_message_id
      FROM sispandalwas_track_points
      ORDER BY tracker_id, recorded_at DESC, id DESC
    ),
    point_counts AS (
      SELECT tracker_id, COUNT(*)::int AS total_points
      FROM sispandalwas_track_points
      GROUP BY tracker_id
    )
    SELECT
      configs.id AS config_id,
      configs.feed_id,
      configs.tracker_name AS configured_tracker_name,
      configs.visibility,
      configs.feed_password,
      configs.is_active,
      configs.created_at AS config_created_at,
      configs.updated_at AS config_updated_at,
      configs.last_polled_at,
      configs.last_success_at,
      configs.last_error,
      configs.last_message_count,
      configs.last_inserted_count,
      latest_points.tracker_name,
      latest_points.latitude,
      latest_points.longitude,
      latest_points.recorded_at,
      latest_points.message_type,
      latest_points.battery_state,
      latest_points.source_message_id,
      point_counts.total_points,
      areas.id AS area_id,
      areas.name AS area_name,
      areas.updated_at AS area_updated_at
    FROM sispandalwas_tracker_configs AS configs
    LEFT JOIN latest_points
      ON latest_points.tracker_id = configs.feed_id
    LEFT JOIN point_counts
      ON point_counts.tracker_id = configs.feed_id
    LEFT JOIN sispandalwas_coverage_areas AS areas
      ON areas.tracker_id = configs.feed_id
    ORDER BY configs.created_at ASC, configs.feed_id ASC
  `);

  return result.rows;
}

exports.listTrackers = async (_req, res, next) => {
  try {
    const rows = await getTrackerOverviewRows();
    const trackers = rows.map((row) => ({
      configId: row.config_id,
      trackerId: row.feed_id,
      trackerName: row.configured_tracker_name || row.tracker_name || row.feed_id,
      visibility: row.visibility,
      hasPassword: Boolean(row.feed_password),
      isActive: Boolean(row.is_active),
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      lastUpdate: row.recorded_at ? new Date(row.recorded_at).toISOString() : null,
      status: deriveTrackerStatus(row.recorded_at, row.is_active),
      messageType: row.message_type || null,
      batteryState: row.battery_state || null,
      sourceMessageId: row.source_message_id || null,
      totalPoints: Number(row.total_points || 0),
      hasCoverageArea: Boolean(row.area_id),
      coverageAreaName: row.area_name || null,
      coverageAreaUpdatedAt: row.area_updated_at
        ? new Date(row.area_updated_at).toISOString()
        : null,
      lastPolledAt: row.last_polled_at ? new Date(row.last_polled_at).toISOString() : null,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
      lastError: row.last_error || null,
    }));

    res.json({
      items: trackers,
      summary: buildTrackerSummary(trackers),
      syncStatus: spotFeedService.getStatus(),
    });
  } catch (error) {
    next(error);
  }
};

exports.listTrackerConfigs = async (_req, res, next) => {
  try {
    const rows = await getTrackerOverviewRows();
    const items = rows.map((row) => ({
      ...formatTrackerConfigRow({
        id: row.config_id,
        feed_id: row.feed_id,
        tracker_name: row.configured_tracker_name,
        visibility: row.visibility,
        feed_password: row.feed_password,
        is_active: row.is_active,
        created_at: row.config_created_at,
        updated_at: row.config_updated_at,
        last_polled_at: row.last_polled_at,
        last_success_at: row.last_success_at,
        last_error: row.last_error,
        last_message_count: row.last_message_count,
        last_inserted_count: row.last_inserted_count,
      }),
      connection: deriveFeedConnection(row),
      status: deriveTrackerStatus(row.recorded_at, row.is_active),
      messageType: row.message_type || null,
      batteryState: row.battery_state || null,
      lastUpdate: row.recorded_at ? new Date(row.recorded_at).toISOString() : null,
      latestPoint: row.recorded_at
        ? {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            recordedAt: new Date(row.recorded_at).toISOString(),
          }
        : null,
      totalPoints: Number(row.total_points || 0),
      hasCoverageArea: Boolean(row.area_id),
    }));

    res.json({
      items,
      summary: buildTrackerSummary(items),
      syncStatus: spotFeedService.getStatus(),
    });
  } catch (error) {
    next(error);
  }
};

exports.createTrackerConfig = async (req, res, next) => {
  try {
    const input = sanitizeTrackerConfigInput(req.body || {});

    const result = await db.query(
      `
        INSERT INTO sispandalwas_tracker_configs (
          feed_id,
          tracker_name,
          visibility,
          feed_password,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [
        input.feedId,
        input.trackerName,
        input.visibility,
        input.feedPassword,
        input.isActive,
      ]
    );

    res.status(201).json({
      item: formatTrackerConfigRow(result.rows[0]),
    });
  } catch (error) {
    if (String(error?.message || "").includes("duplicate key value")) {
      next(createError(409, "feedId sudah terdaftar."));
      return;
    }
    next(error);
  }
};

exports.updateTrackerConfig = async (req, res, next) => {
  try {
    const configId = Number(req.params.id);
    if (!Number.isInteger(configId) || configId <= 0) {
      throw createError(400, "id tracker config tidak valid.");
    }

    const existingResult = await db.query(
      `SELECT * FROM sispandalwas_tracker_configs WHERE id = $1 LIMIT 1`,
      [configId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      throw createError(404, "Tracker config tidak ditemukan.");
    }

    const visibility = normalizeVisibility(req.body?.visibility ?? existing.visibility);
    const trackerName = String(req.body?.trackerName ?? existing.tracker_name ?? "").trim();
    const feedId = String(req.body?.feedId ?? existing.feed_id ?? "").trim();
    const isActive =
      req.body?.isActive !== undefined ? Boolean(req.body.isActive) : Boolean(existing.is_active);
    const incomingPassword =
      typeof req.body?.feedPassword === "string" ? req.body.feedPassword.trim() : "";
    const feedPassword =
      visibility === "private"
        ? incomingPassword || existing.feed_password || ""
        : null;

    if (feedId !== existing.feed_id) {
      throw createError(400, "feedId tidak dapat diubah. Buat tracker baru jika feed berbeda.");
    }

    if (!feedId) {
      throw createError(400, "feedId wajib diisi.");
    }
    if (!trackerName) {
      throw createError(400, "trackerName wajib diisi.");
    }
    if (visibility === "private" && !feedPassword) {
      throw createError(400, "feedPassword wajib diisi untuk feed private.");
    }

    const result = await db.query(
      `
        UPDATE sispandalwas_tracker_configs
        SET
          feed_id = $1,
          tracker_name = $2,
          visibility = $3,
          feed_password = $4,
          is_active = $5,
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `,
      [feedId, trackerName, visibility, feedPassword, isActive, configId]
    );

    res.json({
      item: formatTrackerConfigRow(result.rows[0]),
    });
  } catch (error) {
    if (String(error?.message || "").includes("duplicate key value")) {
      next(createError(409, "feedId sudah terdaftar."));
      return;
    }
    next(error);
  }
};

exports.deleteTrackerConfig = async (req, res, next) => {
  const configId = Number(req.params.id);

  try {
    if (!Number.isInteger(configId) || configId <= 0) {
      throw createError(400, "id tracker config tidak valid.");
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const configResult = await client.query(
        `DELETE FROM sispandalwas_tracker_configs WHERE id = $1 RETURNING feed_id`,
        [configId]
      );

      if (!configResult.rows.length) {
        throw createError(404, "Tracker config tidak ditemukan.");
      }

      await client.query(
        `DELETE FROM sispandalwas_coverage_areas WHERE tracker_id = $1`,
        [configResult.rows[0].feed_id]
      );
      await client.query(
        `DELETE FROM sispandalwas_track_points WHERE tracker_id = $1`,
        [configResult.rows[0].feed_id]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

exports.getCoverageArea = async (req, res, next) => {
  try {
    const trackerId = getTrackerId(req.query);
    const areaRow = await getCoverageAreaRow(trackerId);

    res.json({
      area: formatAreaRecord(areaRow),
    });
  } catch (error) {
    next(error);
  }
};

exports.upsertCoverageArea = async (req, res, next) => {
  try {
    const trackerId = getTrackerId(req.body || {});
    const polygon = normalizePolygonFeature(req.body?.polygon);

    const configResult = await db.query(
      `SELECT tracker_name FROM sispandalwas_tracker_configs WHERE feed_id = $1 LIMIT 1`,
      [trackerId]
    );
    if (!configResult.rows[0]) {
      throw createError(404, "Tracker config tidak ditemukan.");
    }
    const trackerName = configResult.rows[0]?.tracker_name || trackerId;
    const name = String(req.body?.name || `Area ${trackerName}`).trim();

    const result = await db.query(
      `
        INSERT INTO sispandalwas_coverage_areas (
          tracker_id,
          name,
          polygon_geojson
        )
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (tracker_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          polygon_geojson = EXCLUDED.polygon_geojson,
          updated_at = NOW()
        RETURNING id, tracker_id, name, polygon_geojson, created_at, updated_at
      `,
      [trackerId, name, JSON.stringify(polygon)]
    );

    res.json({
      area: formatAreaRecord(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

exports.getTrack = async (req, res, next) => {
  try {
    const trackerId = getTrackerId(req.query);
    const startAt = parseOptionalDate(req.query?.startAt, "startAt");
    const endAt = parseOptionalDate(req.query?.endAt, "endAt");
    const limit = parseLimit(req.query?.limit, 2000, 5000);

    const rows = await getTrackRows({
      trackerId,
      startAt,
      endAt,
      limit,
    });
    const points = rows.map(normalizeTrackPoint);
    const route = buildRouteFeatureFromPoints(points);
    const latestPoint = points.length ? points[points.length - 1] : null;

    res.json({
      trackerId,
      startAt: startAt ? startAt.toISOString() : null,
      endAt: endAt ? endAt.toISOString() : null,
      totalPoints: points.length,
      latestPoint,
      route,
      points,
    });
  } catch (error) {
    next(error);
  }
};

exports.getCoverageResult = async (req, res, next) => {
  try {
    const trackerId = getTrackerId(req.query);
    const areaRow = await getCoverageAreaRow(trackerId);
    const endAt = parseOptionalDate(req.query?.endAt, "endAt");

    if (!areaRow) {
      return res.json({
        trackerId,
        area: null,
        route: null,
        buffer: null,
        coveredArea: null,
        metrics: null,
        latestPoint: null,
        syncStatus: spotFeedService.getStatus(),
      });
    }

    const startAt = parseOptionalDate(req.query?.startAt, "startAt");
    const rows = await getTrackRows({
      trackerId,
      startAt,
      endAt,
      limit: parseLimit(req.query?.limit, 5000, 8000),
    });
    const points = rows.map(normalizeTrackPoint);
    const route = buildRouteFeatureFromPoints(points);
    const latestPoint = points.length ? points[points.length - 1] : null;
    const coverage = calculateCoverage({
      polygon: areaRow.polygon_geojson,
      route,
      bufferKm: 1,
    });

    res.json({
      trackerId,
      area: formatAreaRecord(areaRow),
      route: coverage.routeFeature,
      buffer: coverage.bufferFeature,
      coveredArea: coverage.coveredFeature,
      metrics: {
        ...coverage.metrics,
        pointCount: points.length,
        lastPointAt: latestPoint?.recordedAt || null,
        areaUpdatedAt: areaRow.updated_at
          ? new Date(areaRow.updated_at).toISOString()
          : null,
      },
      latestPoint,
      syncStatus: spotFeedService.getStatus(),
    });
  } catch (error) {
    next(error);
  }
};

exports.simulateCoverage = async (req, res, next) => {
  try {
    const coverage = calculateCoverage({
      polygon: req.body?.polygon,
      route: req.body?.route,
      bufferKm: 1,
    });

    res.json({
      polygon: coverage.polygonFeature,
      route: coverage.routeFeature,
      buffer: coverage.bufferFeature,
      coveredArea: coverage.coveredFeature,
      metrics: coverage.metrics,
    });
  } catch (error) {
    next(error);
  }
};

exports.pollFeed = async (_req, res, next) => {
  try {
    const result = await spotFeedService.runNow();
    res.json(result);
  } catch (error) {
    next(error);
  }
};
