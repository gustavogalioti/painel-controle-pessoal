export const config = { runtime: "edge" };
import { neon } from "@neondatabase/serverless";

const APP_URL = "https://painel-controle-pearl.vercel.app";

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return Response.redirect(`${APP_URL}/?google=error`, 302);
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      return Response.redirect(`${APP_URL}/?google=error`, 302);
    }

    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS google_auth (
      id INT PRIMARY KEY DEFAULT 1,
      access_token TEXT,
      refresh_token TEXT,
      expires_at BIGINT,
      updated_at TEXT
    )`;

    const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
    const ts = new Date().toISOString();

    if (tokens.refresh_token) {
      // First-time consent — Google only sends refresh_token once
      await sql`INSERT INTO google_auth (id, access_token, refresh_token, expires_at, updated_at)
                VALUES (1, ${tokens.access_token}, ${tokens.refresh_token}, ${expiresAt}, ${ts})
                ON CONFLICT (id) DO UPDATE SET
                  access_token=${tokens.access_token},
                  refresh_token=${tokens.refresh_token},
                  expires_at=${expiresAt},
                  updated_at=${ts}`;
    } else {
      await sql`INSERT INTO google_auth (id, access_token, expires_at, updated_at)
                VALUES (1, ${tokens.access_token}, ${expiresAt}, ${ts})
                ON CONFLICT (id) DO UPDATE SET
                  access_token=${tokens.access_token},
                  expires_at=${expiresAt},
                  updated_at=${ts}`;
    }

    return Response.redirect(`${APP_URL}/?google=connected`, 302);
  } catch (e) {
    return Response.redirect(`${APP_URL}/?google=error`, 302);
  }
}
