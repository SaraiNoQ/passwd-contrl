export type Env = {
  DB: D1Database; // D1 binding
  R2: R2Bucket; // R2 binding (optional for now)
  ENVIRONMENT: string;
  OPAQUE_SERVER_SETUP?: string;
  CORS_ORIGIN?: string;
  SESSION_SECRET?: string;
  MAINTENANCE_TOKEN?: string;
};
