import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Belt-and-suspenders on top of SameSite=Lax: a cross-site form POST can't
// set a custom header, so requiring one blocks CSRF even if SameSite has a gap.
export const requireCsrfHeader = createMiddleware(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    return next();
  }

  if (c.req.header("X-Requested-With") !== "cubed") {
    throw new HTTPException(403, { message: "Missing CSRF header" });
  }

  return next();
});
