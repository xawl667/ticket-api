import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export interface EmailParams {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(params: EmailParams): Promise<void> {
  if (!resend) {
    if (env.NODE_ENV !== "production") {
      console.log(`[DEV EMAIL] To: ${params.to}`);
      console.log(`[DEV EMAIL] Subject: ${params.subject}`);
      console.log(`[DEV EMAIL] Body:\n${params.text}`);
    }
    return;
  }

  try {
    const result = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });

    if (result.error) {
      console.error("Email send failed:", result.error.message);
      throw new Error("Failed to send email");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Email send failed:", message);
    throw new Error("Failed to send email");
  }
}
