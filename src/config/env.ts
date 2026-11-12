import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ISSUER: z.string().min(1).default("ticket-api"),
  JWT_AUDIENCE: z.string().min(1).default("ticket-api"),
  APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000")
    .transform((v) => v.replace(/\/+$/, "")),
  RESEND_API_KEY: z.preprocess(
    emptyToUndefined,
    z.string().startsWith("re_").min(20, "RESEND_API_KEY looks invalid").optional(),
  ),
  EMAIL_FROM: z.preprocess(
    emptyToUndefined,
    z.string().email().default("onboarding@resend.dev"),
  ),
  RATE_LIMIT_ENABLED: z.preprocess(
    emptyToUndefined,
    z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ),
  SEED_SUPER_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  SEED_SUPER_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(12).optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === "production") {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is required in production");
    process.exit(1);
  }
  if (!env.APP_URL.startsWith("https://")) {
    console.error("APP_URL must use https:// in production");
    process.exit(1);
  }
}
