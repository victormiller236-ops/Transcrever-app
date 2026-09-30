import { describe, expect, it } from "vitest";
import { buildDue, localToUtc, nextOccurrence, utcToLocalParts } from "@/lib/datetime";

const SP = "America/Sao_Paulo";

describe("localToUtc / utcToLocalParts", () => {
  it("converte horário de Brasília (UTC-3) para UTC", () => {
    expect(localToUtc({ year: 2026, month: 10, day: 1, hour: 15, minute: 0 }, SP).toISOString()).toBe(
      "2026-10-01T18:00:00.000Z",
    );
  });

  it("vira o dia corretamente perto da meia-noite", () => {
    expect(localToUtc({ year: 2026, month: 10, day: 1, hour: 23, minute: 30 }, SP).toISOString()).toBe(
      "2026-10-02T02:30:00.000Z",
    );
    const p = utcToLocalParts(new Date("2026-10-02T02:30:00Z"), SP);
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([2026, 10, 1, 23, 30]);
  });

  it("respeita horário de verão (Nova York)", () => {
    const tz = "America/New_York";
    expect(localToUtc({ year: 2026, month: 3, day: 7, hour: 10, minute: 0 }, tz).toISOString()).toBe(
      "2026-03-07T15:00:00.000Z",
    );
    expect(localToUtc({ year: 2026, month: 3, day: 8, hour: 10, minute: 0 }, tz).toISOString()).toBe(
      "2026-03-08T14:00:00.000Z",
    );
  });

  it("calcula o dia da semana no fuso do usuário", () => {
    // 2026-09-30 é quarta-feira
    expect(utcToLocalParts(new Date("2026-09-30T18:00:00Z"), SP).weekday).toBe(3);
  });
});

describe("nextOccurrence", () => {
  const now = new Date("2026-09-30T18:00:00Z");

  it("none não repete", () => {
    expect(nextOccurrence(new Date("2026-09-30T12:00:00Z"), "none", SP, now)).toBeNull();
  });

  it("diária mantém o horário e fica no futuro", () => {
    const due = new Date("2026-09-28T11:00:00Z"); // 08:00 BRT
    expect(nextOccurrence(due, "daily", SP, now)?.toISOString()).toBe("2026-10-01T11:00:00.000Z");
  });

  it("semanal avança de 7 em 7 dias", () => {
    const due = new Date("2026-09-14T10:00:00Z");
    expect(nextOccurrence(due, "weekly", SP, now)?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("mensal ajusta fim de mês sem perder o dia original", () => {
    const jan31 = localToUtc({ year: 2026, month: 1, day: 31, hour: 9, minute: 0 }, SP);
    const feb = nextOccurrence(jan31, "monthly", SP, new Date("2026-02-01T00:00:00Z"))!;
    expect(utcToLocalParts(feb, SP).day).toBe(28);
    const mar = nextOccurrence(jan31, "monthly", SP, new Date("2026-03-01T12:00:00Z"))!;
    expect(utcToLocalParts(mar, SP).day).toBe(31);
  });

  it("mantém 10:00 de parede atravessando o horário de verão", () => {
    const tz = "America/New_York";
    const due = localToUtc({ year: 2026, month: 3, day: 7, hour: 10, minute: 0 }, tz);
    const next = nextOccurrence(due, "daily", tz, due)!;
    expect(next.toISOString()).toBe("2026-03-08T14:00:00.000Z");
    expect(utcToLocalParts(next, tz).hour).toBe(10);
  });
});

describe("buildDue", () => {
  it("sem data não há vencimento", () => {
    expect(buildDue(null, "10:00", SP)).toEqual({ dueAt: null, hasTime: false });
  });
  it("só data vira 09:00 locais e hasTime=false", () => {
    const r = buildDue("2026-10-05", null, SP);
    expect(r.dueAt?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(r.hasTime).toBe(false);
  });
  it("data e hora", () => {
    const r = buildDue("2026-10-05", "15:45", SP);
    expect(r.dueAt?.toISOString()).toBe("2026-10-05T18:45:00.000Z");
    expect(r.hasTime).toBe(true);
  });
  it("rejeita datas inexistentes e horas inválidas", () => {
    expect(buildDue("2026-02-30", "10:00", SP).dueAt).toBeNull();
    expect(buildDue("2026-13-01", null, SP).dueAt).toBeNull();
    expect(buildDue("lixo", null, SP).dueAt).toBeNull();
    expect(buildDue("2026-10-05", "25:00", SP).hasTime).toBe(false);
  });
});
