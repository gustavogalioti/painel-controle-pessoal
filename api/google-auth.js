export const config = { runtime: "edge" };
import { signOAuthState } from "./_auth-lib.js";

export default async function handler(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new Response("Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI env vars", { status: 500 });
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  // state assinado (CSRF) — se SESSION_SECRET ainda não estiver configurado,
  // segue sem state pra não travar o fluxo (callback também tolera isso).
  if (process.env.SESSION_SECRET) {
    url.searchParams.set("state", await signOAuthState(process.env.SESSION_SECRET));
  }

  return Response.redirect(url.toString(), 302);
}
