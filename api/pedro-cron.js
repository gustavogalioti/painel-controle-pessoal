// Rodado periodicamente por um cron EXTERNO (cron-job.org, a cada 5–15 min) batendo nesta URL com ?secret=...
// Runtime Node.js normal (não edge) porque a lib web-push precisa de crypto do Node.
//
// Pedro virtual — Fase 4: a cada disparo o Pedro "vive": avança a simulação (advancePet, passos de 10 min), escreve o
// Diário (templates; LLM só nos eventos marcantes, até 4/dia) e, SE a política permitir, manda UM push espontâneo
// (máx. 3/dia, silêncio 22h–8h, ≥ 2 h entre pushes, sem repetir o tipo, cancela se o app foi aberto há pouco).
// Os lembretes de agenda e o check-in de tarefas da era "assistente" NÃO existem mais. Nada do painel é lido aqui.
import { neon } from "@neondatabase/serverless";
import webpush from "web-push";
import { pedroAtivo } from "./_pedro-standby.js";
import { callLlmChain } from "./pedro.js";
import { PEDRO_KEYS } from "./_pedro-pet-lib.js";
import { setKv, runCronTick } from "./_pedro-life.js";

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
  if (stillValid.length !== subs.length) await setKv(sql, PEDRO_KEYS.pushSubs, stillValid);
  return sent;
}

export default async function handler(req, res) {
  const secret = req.query?.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "não autorizado" });
    return;
  }

  // Pedro em stand by (ver docs/PEDRO-STANDBY.md): responde ANTES de abrir qualquer conexão.
  if (!pedroAtivo()) {
    res.status(200).json({ ok: true, standby: true });
    return;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const vapidOk = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    if (vapidOk) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const result = await runCronTick(sql, Date.now(), { callLlm: callLlmChain, vapidOk, sendPush: (subs, payload) => sendPushToAll(sql, subs, payload) });
    res.status(200).json(result);
  } catch (e) {
    console.error("pedro-cron:", e);
    res.status(500).json({ error: e.message });
  }
}
