import cors, { type CorsOptions } from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";

import { authSyncLimiter, generalLimiter } from "./middleware/rateLimit";
import { auditRouter } from "./modules/audit/audit.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { breederRouter } from "./modules/breeders/breeder.routes";
import { customerRouter } from "./modules/customers/customer.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { faqRouter } from "./modules/faqs/faq.routes";
import { permissionRouter } from "./modules/permissions/permission.routes";
import { farmRouter } from "./modules/farms/farm.routes";
import { historicalRouter } from "./modules/historical/historical.routes";
import { notificationRouter } from "./modules/notifications/notification.routes";
import { inquiryRouter } from "./modules/inquiries/inquiry.routes";
import { orderRouter } from "./modules/orders/order.routes";
import { paymentRouter } from "./modules/payments/payment.routes";
import { productRouter } from "./modules/products/product.routes";
import { formRouter } from "./modules/forms/form.routes";
import { seminarRouter } from "./modules/seminars/seminar.routes";
import { userRouter } from "./modules/users/user.routes";
import { healthRouter } from "./routes/health.routes";
import { UPLOADS_ROOT } from "./services/fileStorage.service";
import { HttpError } from "./utils/httpError";

const app = express();

/*
 * Render terminates TLS at its edge proxy, which passes the client IP in
 * X-Forwarded-For. Trust that single hop so the per-IP rate limiters key
 * on the real client; without it express-rate-limit rejects the header
 * outright (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
 */
app.set("trust proxy", 1);

/*
 * ---------- CORS ----------
 * Development allows the local frontends by default. In production set
 * ALLOWED_ORIGINS to a comma-separated allowlist (customer site, admin
 * site, and any localhost dev origins). Requests with no Origin header
 * (curl, server-to-server, same-origin) are always allowed. Auth is via
 * Bearer tokens, not cookies, so credentials stay disabled.
 */
const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
];

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : DEFAULT_DEV_ORIGINS
)
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // No Origin header: non-browser client or same-origin — allow.
    // Disallowed origin: deny by omitting the ACAO header (the browser
    // then blocks the response) rather than raising a 500.
    callback(null, !origin || allowedOrigins.includes(origin));
  },
  credentials: false,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
};

/*
 * ---------- Security headers (helmet) ----------
 * CSP is left off: this is a JSON API, not an HTML app, and a default
 * CSP would complicate the cross-origin embedding of /uploads media.
 * CORP is set to cross-origin so the frontends can load upload images;
 * COEP is disabled for the same reason.
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cors(corsOptions));
// Bound the JSON body so an oversized payload can't exhaust memory.
app.use(express.json({ limit: "1mb" }));

// Loose global rate-limit safety net (health checks are skipped).
app.use(generalLimiter);

/*
 * Uploaded files (profile images, farm logos, payment proofs, etc.) are
 * served as static files. nosniff stops the browser from MIME-sniffing a
 * stored file; CORP cross-origin lets the frontends embed the media; and
 * X-Frame-Options is cleared so cross-origin preview iframes (e.g. PDF
 * historical files) can render.
 */
app.use(
  "/uploads",
  (request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.removeHeader("X-Frame-Options");
    next();
  },
  express.static(UPLOADS_ROOT)
);

app.use("/api/health", healthRouter);
// Throttle account provisioning specifically; /me and /test stay unthrottled.
app.use("/api/auth/sync", authSyncLimiter);
app.use("/api/auth", authRouter);
app.use("/api/customers", customerRouter);
app.use("/api/farms", farmRouter);
app.use("/api/users", userRouter);
app.use("/api/products", productRouter);
app.use("/api/orders", orderRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/seminars", seminarRouter);
app.use("/api/breeders", breederRouter);
app.use("/api/inquiries", inquiryRouter);
app.use("/api/faqs", faqRouter);
app.use("/api/forms", formRouter);
app.use("/api/historical", historicalRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/audit-logs", auditRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/permissions", permissionRouter);

app.use((request: Request, response: Response): void => {
  response.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

app.use(
  (
    error: unknown,
    request: Request,
    response: Response,
    next: NextFunction
  ): void => {
    if (error instanceof HttpError) {
      response.status(error.statusCode).json({
        success: false,
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
      });
      return;
    }

    console.error("[error]", error);

    response.status(500).json({
      success: false,
      message: "An unexpected server error occurred.",
    });
  }
);

export { app };
