export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

const APP_URL = "https://painel-controle-pearl.vercel.app";

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const account = searchParams.get("state") === "corporate" ? "corporate" : "personal";

  if (error || !code) {
    return Response.redirect(`${APP_URL}/?outlook=error&account=${account}`, 302);
  }

  try {
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
    const redirectUri = process.env.OUTLOOK_REDIRECT_URI;

    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "offline_access User.Read Calendars.ReadWrite Mail.Read",
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      return Response.redirect(`${APP_URL}/?outlook=error&account=${account}`, 302);
    }

    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS outlook_auth (
      account TEXT PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expires_at BIGINT,
      updated_at TEXT
    )`;

    const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
    const ts = new Date().toISOString();
    const refreshToken = tokens.refresh_token || null;

    await sql`INSERT INTO outlook_auth (account, access_token, refresh_token, expires_at, updated_at)
              VALUES (${account}, ${tokens.access_token}, ${refreshToken}, ${expiresAt}, ${ts})
              ON CONFLICT (account) DO UPDATE SET
                access_token=${tokens.access_token},
                refresh_token=COALESCE(${refreshToken}, outlook_auth.refresh_token),
                expires_at=${expiresAt},
                updated_at=${ts}`;

    return Response.redirect(`${APP_URL}/?outlook=connected&account=${account}`, 302);
  } catch (e) {
    return Response.redirect(`${APP_URL}/?outlook=error&account=${account}`, 302);
  }
}
