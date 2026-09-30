import { describe, expect, it } from "vitest";
import { humanMinutes, reminderText } from "@/lib/reminder-text";

const SP = "America/Sao_Paulo";
const due = new Date("2026-10-01T18:00:00Z"); // 15:00 em Brasília
const base = { title: "Ligar para o banco", dueAt: due, hasTime: true, remindMinutesBefore: 0 };

describe("reminderText", () => {
  it("na hora", () => {
    expect(reminderText(base, new Date("2026-10-01T18:00:30Z"), SP)).toEqual({
      body: "Agora · 15:00",
      spoken: "Lembrete: Ligar para o banco. É agora.",
    });
  });

  it("com antecedência, fala em minutos por extenso", () => {
    const t = { ...base, remindMinutesBefore: 15 };
    expect(reminderText(t, new Date("2026-10-01T17:45:00Z"), SP)).toEqual({
      body: "Daqui a 15 min · 15:00",
      spoken: "Lembrete: Ligar para o banco. Começa daqui a 15 minutos.",
    });
    expect(reminderText({ ...base, remindMinutesBefore: 60 }, new Date("2026-10-01T17:00:00Z"), SP).spoken).toContain("daqui a 1 hora.");
    expect(reminderText({ ...base, remindMinutesBefore: 120 }, new Date("2026-10-01T16:00:00Z"), SP).spoken).toContain("daqui a 2 horas.");
    expect(reminderText({ ...base, remindMinutesBefore: 1440 }, new Date("2026-09-30T18:00:00Z"), SP).spoken).toContain("daqui a 1 dia.");
  });

  it("atrasada há mais de 10 minutos", () => {
    expect(reminderText(base, new Date("2026-10-01T18:30:00Z"), SP)).toEqual({
      body: "Atrasada · era às 15:00",
      spoken: "Lembrete: Ligar para o banco. Está atrasada.",
    });
    // 5 minutos de atraso ainda é "agora"
    expect(reminderText(base, new Date("2026-10-01T18:05:00Z"), SP).spoken).toContain("É agora.");
  });

  it("só data", () => {
    expect(reminderText({ ...base, hasTime: false }, new Date("2026-10-01T12:00:00Z"), SP)).toEqual({
      body: "Para hoje",
      spoken: "Lembrete: Ligar para o banco. É para hoje.",
    });
  });

  it("humanMinutes", () => {
    expect([5, 60, 90, 120, 1440, 2880].map(humanMinutes)).toEqual(["5 min", "1 hora", "90 min", "2 horas", "1 dia", "2 dias"]);
  });
});
