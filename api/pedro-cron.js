// Rodado periodicamente por um cron EXTERNO (cron-job.org) batendo nesta URL com ?secret=...
// Runtime Node.js normal (não edge) porque a lib web-push (Fase 4) precisa de crypto do Node.
//
// Pedro virtual — Fase 1: o cron NÃO envia mais nada. Os lembretes de
// compromisso (Google Calendar/agenda) e o check-in noturno de tarefas foram
// removidos (o Pedro é um pet, não um assistente). As inscrições de push
// (pedro_push_subs) continuam intactas no banco, prontas pra Fase 4, quando
// o simulador do Pedro passar a mandar mensagens espontâneas (com orçamento
// de pushes/dia e janela de silêncio — ver docs/PEDRO-VIRTUAL.md §8).
//
// Este arquivo não abre o Neon nem manda push: só valida o secret, respeita
// o stand by e responde. Nenhuma chave do painel é lida aqui.
import { pedroAtivo } from "./_pedro-standby.js";

export default async function handler(req, res) {
  const secret = req.query?.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "não autorizado" });
    return;
  }

  // Pedro em stand by (ver docs/PEDRO-STANDBY.md).
  if (!pedroAtivo()) {
    res.status(200).json({ ok: true, standby: true });
    return;
  }

  res.status(200).json({ ok: true, sent: 0, note: "Fase 1: sem mensagens espontâneas ainda (chega na Fase 4)" });
}
