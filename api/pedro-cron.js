// Rodado periodicamente por um cron EXTERNO (cron-job.org) batendo nesta URL com ?secret=...
// Runtime Node.js normal (não edge) porque a lib web-push precisa de crypto do Node.
import { neon } from "@neondatabase/serverless";
import webpush from "web-push";

async function getKvList(sql, key) {
  const rows = await sql`SELECT value FROM sync_kv WHERE key=${key}`;
  if (!rows[0]) return [];
  try { const v = JSON.parse(rows[0].value); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function setKvList(sql, key, list) {
  const value = JSON.stringify(list);
  const ts = new Date().toISOString();
  await sql`INSERT INTO sync_kv (key, value, updated_at) VALUES (${key}, ${value}, ${ts})
            ON CONFLICT (key) DO UPDATE SET value=${value}, updated_at=${ts}`;
}

function nowInSaoPaulo() {
  // Vercel roda em UTC — convertemos pra horário de Brasília sem depender de libs externas
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value;
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    hour: parseInt(get("hour")),
    minute: parseInt(get("minute")),
  };
}

async function sendPushToAll(sql, subs, payload) {
  const stillValid = [];
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      stillValid.push(sub);
      sent++;
    } catch (e) {
      if (e.statusCode !== 404 && e.statusCode !== 410) stillValid.push(sub); // mantém, só derruba inscrições mortas
    }
  }
  if (stillValid.length !== subs.length) await setKvList(sql, "pedro_push_subs", stillValid);
  return sent;
}

export default async function handler(req, res) {
  const secret = req.query?.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "não autorizado" });
    return;
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    res.status(500).json({ error: "VAPID keys não configuradas" });
    return;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:contato@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const sql = neon(process.env.DATABASE_URL);
  const subs = await getKvList(sql, "pedro_push_subs");
  const result = { sent: 0, checked: [] };

  if (!subs.length) {
    res.status(200).json({ ok: true, note: "nenhuma inscrição de push ainda", ...result });
    return;
  }

  const { dateStr: todayStr, hour } = nowInSaoPaulo();

  // ── Lembretes de compromissos próximos (próximos 20 min) ──────────────────
  try {
    const events = await getKvList(sql, "events_v1");
    const remindedIds = await getKvList(sql, "pedro_reminded_events_server");
    const now = new Date();
    const nowSP = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const toRemind = [];
    for (const ev of events) {
      if (ev.date !== todayStr || !ev.time || remindedIds.includes(ev.id)) continue;
      const [h, m] = ev.time.split(":").map(Number);
      const evDate = new Date(nowSP); evDate.setHours(h || 0, m || 0, 0, 0);
      const diffMin = (evDate - nowSP) / 60000;
      if (diffMin > 0 && diffMin <= 20) toRemind.push(ev);
    }
    for (const ev of toRemind) {
      const sentCount = await sendPushToAll(sql, subs, {
        title: "Pedro 🐾", tag: "pedro-agenda",
        body: `⏰ Daqui a pouco (${ev.time}) você tem "${ev.title}"${ev.local ? ` em ${ev.local}` : ""}.`,
      });
      result.sent += sentCount;
      remindedIds.push(ev.id);
    }
    if (toRemind.length) await setKvList(sql, "pedro_reminded_events_server", remindedIds);
    result.checked.push(`agenda: ${toRemind.length} lembrete(s)`);
  } catch (e) { result.checked.push(`agenda erro: ${e.message}`); }

  // ── Check-in noturno (uma vez por dia, a partir das 20h) ───────────────────
  try {
    if (hour >= 20) {
      const lastEveningPush = await getKvList(sql, "pedro_evening_push_date");
      const already = lastEveningPush[0] === todayStr;
      if (!already) {
        const tasks = await getKvList(sql, "tasks_v1");
        const pendentesHoje = tasks.filter(t => t.status === "today");
        if (pendentesHoje.length) {
          const sentCount = await sendPushToAll(sql, subs, {
            title: "Pedro 🐾", tag: "pedro-noite",
            body: `Já é fim de dia e ainda restam ${pendentesHoje.length} tarefa(s) de hoje. Precisa de ajuda ou deixamos pra amanhã?`,
          });
          result.sent += sentCount;
        }
        await setKvList(sql, "pedro_evening_push_date", [todayStr]);
        result.checked.push("check-in noturno: enviado");
      } else {
        result.checked.push("check-in noturno: já enviado hoje");
      }
    }
  } catch (e) { result.checked.push(`noturno erro: ${e.message}`); }

  res.status(200).json({ ok: true, ...result, subs: subs.length });
}
