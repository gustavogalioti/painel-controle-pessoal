export const config = { runtime: "edge" };

export default async function handler(req) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new Response("Missing OUTLOOK_CLIENT_ID or OUTLOOK_REDIRECT_URI env vars", { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const account = searchParams.get("account") === "corporate" ? "corporate" : "personal";

  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "offline_access User.Read Calendars.ReadWrite Mail.Read");
  url.searchParams.set("state", account);
  url.searchParams.set("prompt", "select_account");

  return Response.redirect(url.toString(), 302);
}
