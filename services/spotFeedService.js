const { XMLParser } = require("fast-xml-parser");
const db = require("../db");
const config = require("../config");

const xmlParser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

const state = {
  enabled: false,
  inFlight: false,
  pollIntervalMs: config.spotFeedPollIntervalMs,
  activeTrackerCount: 0,
  failedTrackerCount: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastMessageCount: 0,
  lastInsertedCount: 0,
};

let intervalId = null;
let initialTimeoutId = null;

function toIsoString(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function setStateTimestamp(field, value = new Date()) {
  state[field] = toIsoString(value);
}

function clearScheduler() {
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function refreshConfiguredState(configs = []) {
  state.activeTrackerCount = configs.length;
  state.enabled = configs.length > 0;
}

function getStatus() {
  return {
    ...state,
    hasFeedUrl: state.enabled,
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numericValue =
    typeof value === "number" ? value : /^\d+$/.test(String(value).trim()) ? Number(value) : null;

  if (Number.isFinite(numericValue)) {
    const timestampMs = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
    const date = new Date(timestampMs);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function looksLikeSpotMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Boolean(
    value.latitude !== undefined ||
      value.longitude !== undefined ||
      value.lat !== undefined ||
      value.lng !== undefined ||
      value.messengerId !== undefined ||
      value.messageType !== undefined ||
      value.unixTime !== undefined ||
      value.dateTime !== undefined
  );
}

function extractMessages(payload) {
  const candidates = [
    payload?.response?.feedMessageResponse?.messages?.message,
    payload?.response?.feedMessageResponse?.messages,
    payload?.feedMessageResponse?.messages?.message,
    payload?.feedMessageResponse?.messages,
    payload?.messages?.message,
    payload?.messages,
    payload?.message,
  ];

  for (const candidate of candidates) {
    const rows = asArray(candidate).filter(looksLikeSpotMessage);
    if (rows.length > 0) {
      return rows;
    }
  }

  if (looksLikeSpotMessage(payload)) {
    return [payload];
  }

  return [];
}

function extractFeedError(payload) {
  const errorNode = payload?.response?.errors?.error || payload?.errors?.error || null;
  if (!errorNode) {
    return null;
  }

  const code = firstNonEmpty(errorNode.code);
  const text = firstNonEmpty(errorNode.text);
  const description = firstNonEmpty(errorNode.description);

  return {
    code,
    message: [code, text, description].filter(Boolean).join(" - ") || "Feed SPOT mengembalikan error.",
  };
}

function isEmptyFeedError(feedError) {
  return String(feedError?.code || "").trim().toUpperCase() === "E-0195";
}

function resolveFeedUrl(trackerConfig) {
  const format = config.spotFeedFormat === "xml" ? "xml" : "json";
  const feedId = String(trackerConfig?.feed_id || "").trim();

  if (!feedId) {
    return "";
  }

  const url = new URL(
    `https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/${feedId}/message.${format}`
  );

  if (trackerConfig?.feed_password) {
    url.searchParams.set("feedPassword", trackerConfig.feed_password);
  }

  return url.toString();
}

function normalizeSpotMessage(rawMessage, trackerConfig) {
  const latitude = toNumber(rawMessage?.latitude ?? rawMessage?.lat);
  const longitude = toNumber(rawMessage?.longitude ?? rawMessage?.lng ?? rawMessage?.lon);
  const recordedAt = toDate(
    rawMessage?.dateTime ??
      rawMessage?.timestamp ??
      rawMessage?.unixTime ??
      rawMessage?.messageCreateTime ??
      rawMessage?.createdAt
  );

  if (latitude === null || longitude === null || !recordedAt) {
    return null;
  }

  const trackerId = String(trackerConfig?.feed_id || "").trim();
  if (!trackerId) {
    return null;
  }

  const trackerName = firstNonEmpty(
    trackerConfig?.tracker_name,
    rawMessage?.messengerName,
    rawMessage?.deviceName,
    rawMessage?.name,
    trackerId
  );
  const sourceMessageId =
    firstNonEmpty(rawMessage?.id, rawMessage?.messageId, rawMessage?.messageID, rawMessage?.guid) || null;
  const messageType =
    firstNonEmpty(rawMessage?.messageType, rawMessage?.type, rawMessage?.eventType).toUpperCase() ||
    "POSITION";
  const batteryState =
    firstNonEmpty(rawMessage?.batteryState, rawMessage?.batteryStatus, rawMessage?.battery).toUpperCase() ||
    "UNKNOWN";

  return {
    trackerId,
    trackerName,
    latitude,
    longitude,
    recordedAt,
    sourceMessageId,
    messageType,
    batteryState,
    rawPayload: rawMessage,
    dedupeKey: sourceMessageId
      ? `spot:${trackerId}:${sourceMessageId}`
      : `spot:${trackerId}:${recordedAt.toISOString()}:${latitude.toFixed(6)}:${longitude.toFixed(6)}`,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.spotFeedTimeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getTrackerConfigs({ activeOnly = false } = {}) {
  const result = await db.query(
    `
      SELECT
        id,
        feed_id,
        tracker_name,
        visibility,
        feed_password,
        is_active
      FROM sispandalwas_tracker_configs
      ${activeOnly ? "WHERE is_active = TRUE" : ""}
      ORDER BY created_at ASC, id ASC
    `
  );

  return result.rows;
}

async function persistTrackerPollStatus(trackerConfigId, fields = {}) {
  const columns = [];
  const values = [];

  Object.entries(fields).forEach(([key, value]) => {
    values.push(value);
    columns.push(`${key} = $${values.length}`);
  });

  if (!columns.length) {
    return;
  }

  values.push(trackerConfigId);

  await db.query(
    `
      UPDATE sispandalwas_tracker_configs
      SET
        ${columns.join(", ")}
      WHERE id = $${values.length}
    `,
    values
  );
}

async function fetchFeedMessages(trackerConfig) {
  const feedUrl = resolveFeedUrl(trackerConfig);
  if (!feedUrl) {
    throw new Error("Feed SPOT belum dikonfigurasi.");
  }

  const response = await fetchWithTimeout(feedUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Feed SPOT gagal diambil (${response.status}).`);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const rawBody = await response.text();
  const requestedFormat = config.spotFeedFormat;
  const detectedFormat =
    requestedFormat !== "auto"
      ? requestedFormat
      : contentType.includes("xml") || rawBody.trim().startsWith("<")
        ? "xml"
        : "json";

  let payload;
  try {
    payload = detectedFormat === "xml" ? xmlParser.parse(rawBody) : JSON.parse(rawBody);
  } catch {
    throw new Error(`Feed SPOT tidak dapat diparse sebagai ${detectedFormat.toUpperCase()}.`);
  }

  const feedError = extractFeedError(payload);
  if (feedError) {
    if (isEmptyFeedError(feedError)) {
      return [];
    }
    throw new Error(feedError.message);
  }

  return extractMessages(payload)
    .map((message) => normalizeSpotMessage(message, trackerConfig))
    .filter(Boolean)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

async function insertTrackPoints(messages) {
  if (!messages.length) {
    return 0;
  }

  const client = await db.connect();
  let insertedCount = 0;

  try {
    await client.query("BEGIN");

    for (const message of messages) {
      const result = await client.query(
        `
          INSERT INTO sispandalwas_track_points (
            tracker_id,
            tracker_name,
            latitude,
            longitude,
            recorded_at,
            message_type,
            battery_state,
            source_message_id,
            dedupe_key,
            raw_payload,
            ingest_source
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'spot')
          ON CONFLICT (dedupe_key) DO NOTHING
        `,
        [
          message.trackerId,
          message.trackerName,
          message.latitude,
          message.longitude,
          message.recordedAt.toISOString(),
          message.messageType,
          message.batteryState,
          message.sourceMessageId,
          message.dedupeKey,
          JSON.stringify(message.rawPayload || {}),
        ]
      );

      insertedCount += result.rowCount || 0;
    }

    await client.query("COMMIT");
    return insertedCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function pollTrackerConfig(trackerConfig) {
  try {
    const messages = await fetchFeedMessages(trackerConfig);
    const insertedCount = await insertTrackPoints(messages);

    await persistTrackerPollStatus(trackerConfig.id, {
      last_polled_at: new Date(),
      last_success_at: new Date(),
      last_error: null,
      last_message_count: messages.length,
      last_inserted_count: insertedCount,
    });

    return {
      feedId: trackerConfig.feed_id,
      trackerName: trackerConfig.tracker_name,
      success: true,
      totalMessages: messages.length,
      insertedCount,
      error: null,
    };
  } catch (error) {
    const message = error?.message || "Gagal memproses feed SPOT.";

    await persistTrackerPollStatus(trackerConfig.id, {
      last_polled_at: new Date(),
      last_error: message,
      last_message_count: 0,
      last_inserted_count: 0,
    });

    return {
      feedId: trackerConfig.feed_id,
      trackerName: trackerConfig.tracker_name,
      success: false,
      totalMessages: 0,
      insertedCount: 0,
      error: message,
    };
  }
}

async function runNow() {
  const configs = await getTrackerConfigs({ activeOnly: true });
  refreshConfiguredState(configs);

  if (!configs.length) {
    state.lastError = null;
    state.lastMessageCount = 0;
    state.lastInsertedCount = 0;
    state.failedTrackerCount = 0;

    return {
      skipped: true,
      reason: "feed_not_configured",
      ...getStatus(),
    };
  }

  if (state.inFlight) {
    return {
      skipped: true,
      reason: "already_running",
      ...getStatus(),
    };
  }

  state.inFlight = true;
  state.lastError = null;
  setStateTimestamp("lastStartedAt");

  try {
    const results = [];
    let totalMessages = 0;
    let insertedCount = 0;
    let successCount = 0;

    for (const trackerConfig of configs) {
      const result = await pollTrackerConfig(trackerConfig);
      results.push(result);
      totalMessages += result.totalMessages || 0;
      insertedCount += result.insertedCount || 0;
      if (result.success) {
        successCount += 1;
      }
    }

    const failures = results.filter((item) => !item.success);

    state.lastMessageCount = totalMessages;
    state.lastInsertedCount = insertedCount;
    state.failedTrackerCount = failures.length;

    if (successCount > 0) {
      setStateTimestamp("lastSuccessAt");
    }

    state.lastError = failures.length
      ? failures.map((item) => `${item.trackerName || item.feedId}: ${item.error}`).join(" | ")
      : null;

    return {
      success: failures.length === 0,
      partialSuccess: successCount > 0 && failures.length > 0,
      totalTrackers: configs.length,
      successCount,
      failedCount: failures.length,
      totalMessages,
      insertedCount,
      failures,
      results,
      ...getStatus(),
    };
  } finally {
    state.inFlight = false;
    setStateTimestamp("lastFinishedAt");
  }
}

function start() {
  clearScheduler();

  initialTimeoutId = setTimeout(() => {
    runNow().catch((error) => {
      console.error("Initial SPOT feed polling failed:", error.message || error);
    });
  }, 1500);

  intervalId = setInterval(() => {
    runNow().catch((error) => {
      console.error("Scheduled SPOT feed polling failed:", error.message || error);
    });
  }, config.spotFeedPollIntervalMs);
}

module.exports = {
  getStatus,
  runNow,
  start,
};
