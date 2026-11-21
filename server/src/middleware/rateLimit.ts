import rateLimit from 'express-rate-limit';

export function createLoginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    // Keep high limit in test env so 5-attempt per-account lockout tests run deterministically
    max: process.env.NODE_ENV === 'test' ? 1000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts from this network. Please wait and try again.',
      },
    },
  });
}
