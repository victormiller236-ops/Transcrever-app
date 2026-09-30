// Interpreta texto livre em português ("amanhã às 15h ligar pro João, urgente")
// em uma tarefa. Serve para a barra de adição rápida e como plano B quando o
// Gemini devolve a transcrição mas não a estrutura.

import {
  addDaysToDate,
  daysInMonth,
  toDateKey,
  utcToLocalParts,
  pad2,
  type Repeat,
} from "./datetime";

export interface ParsedTask {
  title: string;
  /** Data local, AAAA-MM-DD */
  date: string | null;
  /** Hora local, HH:mm */
  time: string | null;
  priority: 0 | 1;
  repeat: Repeat;
  remindMinutesBefore: number;
}

const WEEKDAY_NAMES = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const WEEKDAY_RE = "(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-?\\s?feira)?";
const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const MONTH_RE = `(${MONTH_NAMES.join("|")})`;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const WORD_NUMBERS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  quinze: 15,
  vinte: 20,
  trinta: 30,
};
const NUM_RE = `(\\d+|${Object.keys(WORD_NUMBERS).join("|")})`;

function toNumber(s: string): number {
  return /^\d+$/.test(s) ? Number(s) : (WORD_NUMBERS[s] ?? NaN);
}

/** Texto de trabalho: a versão original e a sem acentos andam juntas (mesmo tamanho). */
class Work {
  constructor(
    public orig: string,
    public folded: string,
  ) {}

  /** Procura `re` na versão sem acentos; se achar, remove o trecho das duas. */
  take(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.folded);
    if (!m) return null;
    const start = m.index;
    const end = start + m[0].length;
    this.orig = this.orig.slice(0, start) + " " + this.orig.slice(end);
    this.folded = this.folded.slice(0, start) + " " + this.folded.slice(end);
    return m;
  }
}

function nextWeekday(todayParts: { year: number; month: number; day: number; weekday: number }, target: number) {
  let diff = (target - todayParts.weekday + 7) % 7;
  if (diff === 0) diff = 7;
  return addDaysToDate(todayParts, diff);
}

function validDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseQuickText(input: string, now: Date, tz: string): ParsedTask {
  const nfc = input.normalize("NFC").replace(/\s+/g, " ").trim();
  const w = new Work(nfc, fold(nfc));
  const today = utcToLocalParts(now, tz);

  let date: { year: number; month: number; day: number } | null = null;
  let time: { hour: number; minute: number } | null = null;
  let repeat: Repeat = "none";
  let priority: 0 | 1 = 0;
  let remind = 0;
  let explicitToday = false;

  // --- aviso antes: "me avise 10 minutos antes"
  const before = w.take(
    new RegExp(
      `\\b(?:(?:me\\s+)?(?:avis[ae]r?|lembr[ae]r?)(?:-?\\s?me)?\\s+)?${NUM_RE}\\s*(minutos?|min|horas?|h|dias?)\\s+antes\\b`,
    ),
  );
  if (before) {
    const n = toNumber(before[1]);
    const unit = before[2];
    if (Number.isFinite(n)) {
      remind = unit.startsWith("h") ? n * 60 : unit.startsWith("d") ? n * 1440 : n;
    }
  }

  // --- prioridade
  if (w.take(/\b(?:urgentes?|urgencia|importante|prioridade|prioritari[oa])\b/)) priority = 1;

  // --- repetição
  const weeklyOn = w.take(new RegExp(`\\btod(?:a|as)\\s+(?:as\\s+)?${WEEKDAY_RE}s?\\b`));
  if (weeklyOn) {
    repeat = "weekly";
    date = nextWeekday(today, WEEKDAY_NAMES.indexOf(weeklyOn[1]));
  } else if (w.take(/\b(?:todos?\s+(?:os\s+)?dias?|diariamente|todo\s+dia)\b/)) {
    repeat = "daily";
  } else if (w.take(/\b(?:toda\s+semana|semanalmente|todas\s+as\s+semanas)\b/)) {
    repeat = "weekly";
  } else if (w.take(/\b(?:todo\s+mes|mensalmente|todos\s+os\s+meses)\b/)) {
    repeat = "monthly";
  }

  // --- tempo relativo: "daqui a 30 minutos", "em 2 horas", "daqui a meia hora"
  const relHalf = w.take(/\b(?:daqui\s+a|em)\s+meia\s+hora\b/);
  const rel = relHalf ? null : w.take(new RegExp(`\\b(?:daqui\\s+a|em)\\s+${NUM_RE}\\s*(minutos?|min|horas?|h)\\b`));
  if (relHalf || rel) {
    const minutes = relHalf
      ? 30
      : (() => {
          const n = toNumber(rel![1]);
          return rel![2].startsWith("h") ? n * 60 : n;
        })();
    if (Number.isFinite(minutes) && minutes > 0) {
      const target = utcToLocalParts(new Date(now.getTime() + minutes * 60_000), tz);
      date = { year: target.year, month: target.month, day: target.day };
      time = { hour: target.hour, minute: target.minute };
    }
  }

  // --- dias relativos: "em 3 dias", "daqui a 2 semanas"
  if (!date) {
    const relDays = w.take(new RegExp(`\\b(?:daqui\\s+a|em)\\s+${NUM_RE}\\s*(dias?|semanas?|mes(?:es)?)\\b`));
    if (relDays) {
      const n = toNumber(relDays[1]);
      const unit = relDays[2];
      if (Number.isFinite(n)) {
        if (unit.startsWith("d")) date = addDaysToDate(today, n);
        else if (unit.startsWith("s")) date = addDaysToDate(today, n * 7);
        else {
          const total = today.year * 12 + (today.month - 1) + n;
          const year = Math.floor(total / 12);
          const month = (total % 12) + 1;
          date = { year, month, day: Math.min(today.day, daysInMonth(year, month)) };
        }
      }
    }
  }

  // --- data
  if (!date) {
    if (w.take(/\bdepois\s+de\s+amanha\b/)) date = addDaysToDate(today, 2);
    else if (w.take(/\bamanha\b/)) date = addDaysToDate(today, 1);
    else if (w.take(/\b(?:hoje|esta\s+noite|hoje\s+a\s+noite)\b/)) {
      date = { year: today.year, month: today.month, day: today.day };
      explicitToday = true;
    } else if (w.take(/\b(?:semana\s+que\s+vem|proxima\s+semana)\b/)) date = addDaysToDate(today, 7);
  }
  if (!date) {
    const dm = w.take(/\b(?:dia\s+)?(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/);
    if (dm) {
      const day = Number(dm[1]);
      const month = Number(dm[2]);
      let year = dm[3] ? Number(dm[3]) : today.year;
      if (year < 100) year += 2000;
      if (validDate(year, month, day)) {
        if (!dm[3] && toDateKey({ year, month, day }) < toDateKey(today)) year += 1;
        date = { year, month, day };
      }
    }
  }
  if (!date) {
    const named = w.take(new RegExp(`\\b(?:dia\\s+)?(\\d{1,2})\\s+de\\s+${MONTH_RE}(?:\\s+de\\s+(\\d{4}))?\\b`));
    if (named) {
      const day = Number(named[1]);
      const month = MONTH_NAMES.indexOf(named[2]) + 1;
      let year = named[3] ? Number(named[3]) : today.year;
      if (validDate(year, month, day)) {
        if (!named[3] && toDateKey({ year, month, day }) < toDateKey(today)) year += 1;
        date = { year, month, day };
      }
    }
  }
  if (!date) {
    const dayOnly = w.take(/\bdia\s+(\d{1,2})\b/);
    if (dayOnly) {
      const day = Number(dayOnly[1]);
      if (day >= 1 && day <= 31) {
        let { year, month } = today;
        // Dia que já passou (ou não existe) neste mês → procura o próximo mês que tenha o dia.
        for (let i = 0; i < 14; i++) {
          if (day <= daysInMonth(year, month) && (year > today.year || month > today.month || day >= today.day)) {
            date = { year, month, day };
            break;
          }
          month += 1;
          if (month > 12) {
            month = 1;
            year += 1;
          }
        }
      }
    }
  }
  if (!date) {
    const wd = w.take(new RegExp(`\\b(?:(?:na|no|nesta|neste|proxima|proximo)\\s+)?${WEEKDAY_RE}(?:\\s+(?:que\\s+vem|proxima))?\\b`));
    if (wd) date = nextWeekday(today, WEEKDAY_NAMES.indexOf(wd[1]));
  }

  // --- hora
  if (!time) {
    if (w.take(/\bmeio[- ]dia\b/)) time = { hour: 12, minute: 0 };
    else if (w.take(/\bmeia[- ]noite\b/)) time = { hour: 0, minute: 0 };
    else {
      const m =
        w.take(/\bas\s+(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})|\s*h(?:oras?)?)?\b/) ??
        w.take(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})\b/) ??
        w.take(/\b(\d{1,2})\s*(?:h|horas?)\b/);
      if (m) {
        let hour = Number(m[1]);
        const minute = m[2] ? Number(m[2]) : 0;
        const period = w.take(/\b(?:da|de|a)\s+(manha|tarde|noite|madrugada)\b/);
        if (period) {
          if (period[1] === "manha" || period[1] === "madrugada") {
            if (hour === 12) hour = 0;
          } else if (hour < 12) {
            hour += 12;
          }
        }
        if (hour <= 23 && minute <= 59) time = { hour, minute };
      }
    }
  }

  // Só hora: hoje, se ainda não passou; senão amanhã.
  if (time && !date) {
    const today0 = { year: today.year, month: today.month, day: today.day };
    const passed = time.hour * 60 + time.minute <= today.hour * 60 + today.minute;
    date = passed && !explicitToday ? addDaysToDate(today0, 1) : today0;
  }
  // Repetição sem data: começa hoje (ou amanhã, se o horário de hoje já passou).
  if (repeat !== "none" && !date) {
    const today0 = { year: today.year, month: today.month, day: today.day };
    const passed = time ? time.hour * 60 + time.minute <= today.hour * 60 + today.minute : false;
    date = passed ? addDaysToDate(today0, 1) : today0;
  }

  // --- título: o que sobrou
  let title = w.orig
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = title
    .replace(
      /^(?:(?:me\s+)?lembr[ae]r?(?:-?\s?me)?\s*(?:de|para|que)?|preciso(?:\s+de)?|tenho\s+(?:que|de)|nao\s+esquecer(?:\s+de)?|criar\s+tarefa(?:\s+de)?|adicionar(?:\s+tarefa)?|anotar)\s+/i,
      "",
    )
    .trim();
  // Conectivos soltos nas pontas ("ligar para o João às" → "ligar para o João")
  const edge = /^(?:a|as|às|de|do|da|em|no|na|para|pra|e|que)\s+|\s+(?:a|as|às|de|do|da|em|no|na|para|pra|e|que|,)$/i;
  for (let i = 0; i < 4 && edge.test(title); i++) title = title.replace(edge, "").trim();
  title = title.replace(/^[\s.,;:!-]+|[\s.,;:!-]+$/g, "");
  if (title.length > 0) title = title[0].toUpperCase() + title.slice(1);

  return {
    title,
    date: date ? toDateKey(date) : null,
    time: time ? `${pad2(time.hour)}:${pad2(time.minute)}` : null,
    priority,
    repeat,
    remindMinutesBefore: remind,
  };
}
