// Texto do aviso, em duas versões: a escrita (notificação) e a falada.
// Usado no servidor (push) e no app (alerta local), para dizerem a mesma coisa.

import { pad2, utcToLocalParts } from "./datetime";

export interface ReminderInfo {
  title: string;
  dueAt: Date;
  hasTime: boolean;
  remindMinutesBefore: number;
}

/** "15 min", "1 hora", "2 horas", "1 dia" */
export function humanMinutes(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? "1 dia" : `${m / 1440} dias`;
  if (m % 60 === 0) return m === 60 ? "1 hora" : `${m / 60} horas`;
  return `${m} min`;
}

function spokenMinutes(m: number): string {
  const h = humanMinutes(m);
  return h.endsWith(" min") ? h.replace(" min", m === 1 ? " minuto" : " minutos") : h;
}

const LATE_MS = 10 * 60_000;

export function reminderText(t: ReminderInfo, now: Date, tz: string): { body: string; spoken: string } {
  const p = utcToLocalParts(t.dueAt, tz);
  const hhmm = `${pad2(p.hour)}:${pad2(p.minute)}`;
  const late = now.getTime() - t.dueAt.getTime() > LATE_MS;

  let body: string;
  let when: string;
  if (!t.hasTime) {
    body = "Para hoje";
    when = "É para hoje.";
  } else if (t.remindMinutesBefore > 0 && t.dueAt.getTime() > now.getTime()) {
    body = `Daqui a ${humanMinutes(t.remindMinutesBefore)} · ${hhmm}`;
    when = `Começa daqui a ${spokenMinutes(t.remindMinutesBefore)}.`;
  } else if (late) {
    body = `Atrasada · era às ${hhmm}`;
    when = "Está atrasada.";
  } else {
    body = `Agora · ${hhmm}`;
    when = "É agora.";
  }
  return { body, spoken: `Lembrete: ${t.title}. ${when}` };
}
