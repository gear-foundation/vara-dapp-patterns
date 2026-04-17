import { Request, Response, NextFunction } from "express";
import { API_KEY } from "../config/constants";

/// API key authentication middleware.
///
/// Disabled by default (pass-through): uncomment the auth block and remove the
/// early `next()` return to enable key enforcement in production.
///
/// When enabled, clients must send the API key in the `api-key` request header.
export const authenticateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // To enable: remove the two lines below and uncomment the block.
  next();
  return;

  /* ── Production enforcement ──────────────────────────────────────────────
  try {
    const apiKey = req.headers["api-key"] as string;

    if (!apiKey) {
      res.status(401).json({
        success: false,
        error: "API Key required",
        message: "Provide the key in the 'api-key' request header",
      });
      return;
    }

    if (apiKey !== API_KEY) {
      res.status(403).json({
        success: false,
        error: "Invalid API Key",
      });
      return;
    }

    next();
  } catch {
    res.status(500).json({ success: false, error: "Authentication error" });
  }
  ─────────────────────────────────────────────────────────────────────────── */
};
