import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ISSUER: z.string().min(1).default("ticket-api"),
  JWT_AUDIENCE: z.string().min(1).default("ticket-api"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().optional(),
  SEED_SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
}).strict();

type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  env = envSchema.parse(process.env);
} catch (err) {
  if (err instanceof z.ZodError) {
    console.error("Invalid environment variables:");
    for (const issue of err.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
  } else {
    console.error("Unknown error validating environment:", err);
  }
  process.exit(1);
}

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

export { env };
