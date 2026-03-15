const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./config");

const beritaRoutes = require("./routes/beritaRoutes");
const publikasiRoutes = require("./routes/publikasiRoutes");
const kegiatanRoutes = require("./routes/kegiatanRoutes");
const authRoutes = require("./routes/authRoutes");
const { requireAuth } = require("./middleware/auth");

const app = express();

const allowedOrigins = new Set([
  config.frontendOrigin,
  config.publicBaseUrl,
  ...(Array.isArray(config.corsAllowedOrigins) ? config.corsAllowedOrigins : []),
]);

function isAllowedLocalDevOrigin(origin) {
  if (config.nodeEnv === "production") {
    return false;
  }

  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(origin || "").trim());
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || isAllowedLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin tidak diizinkan oleh CORS."));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "SIJALA-CMS-BE",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/berita", requireAuth, beritaRoutes);
app.use("/api/publikasi", requireAuth, publikasiRoutes);
app.use("/api/kegiatan", requireAuth, kegiatanRoutes);
app.use("/uploads", express.static("uploads"));

app.use((err, _req, res, _next) => {
  const statusCode = Number(err?.statusCode || err?.status || 500);
  const message =
    statusCode >= 500
      ? String(err?.message || "Terjadi kesalahan pada server.")
      : String(err?.message || "Request gagal diproses.");

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({ message });
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
