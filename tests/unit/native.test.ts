import { describe, expect, it } from "vitest";
import { buildNativeReminders } from "@/lib/native";
import type { TaskDTO } from "@/lib/types";

const SP = "America/Sao_Paulo";
const NOW = Date.parse("2026-10-01T12:00:00Z");

function task(over: Partial<TaskDTO>): TaskDTO {
  return {
    id: "t",
    title: "Tarefa",
    notes: null,
    date: "2026-10-01",
    time: "15:00",
    dueAt: "2026-10-01T18:00:00.000Z",
    priority: 0,
    repeat: "none",
    remindMinutesBefore: 0,
    done: false,
    doneAt: null,
    source: "manual",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildNativeReminders", () => {
  it("monta o aviso no instante certo, com o texto do momento do disparo", () => {
    const [a] = buildNativeReminders([task({ id: "a", title: "Ligar para o banco" })], SP, NOW);
    expect(a).toEqual({
      id: "a",
      at: Date.parse("2026-10-01T18:00:00Z"),
      title: "Ligar para o banco",
      body: "Agora · 15:00",
      spoken: "Lembrete: Ligar para o banco. É agora.",
    });
  });

  it("antecedência: dispara antes e fala 'começa daqui a…'", () => {
    const [a] = buildNativeReminders([task({ remindMinutesBefore: 15 })], SP, NOW);
    expect(a.at).toBe(Date.parse("2026-10-01T17:45:00Z"));
    expect(a.spoken).toBe("Lembrete: Tarefa. Começa daqui a 15 minutos.");
    expect(a.body).toBe("Daqui a 15 min · 15:00");
  });

  it("ignora feitas, sem data, já passadas e além de 30 dias", () => {
    const items = buildNativeReminders(
      [
        task({ id: "feita", done: true }),
        task({ id: "semdata", dueAt: null, date: null, time: null }),
        task({ id: "passada", dueAt: "2026-10-01T11:00:00.000Z" }),
        task({ id: "longe", dueAt: "2026-12-25T18:00:00.000Z" }),
        task({ id: "ok" }),
      ],
      SP,
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(["ok"]);
  });

  it("antecedência que já passou não agenda (o aviso seria no passado)", () => {
    expect(buildNativeReminders([task({ remindMinutesBefore: 1440 })], SP, NOW)).toEqual([]);
  });

  it("ordena por horário e limita a quantidade", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      task({ id: `t${i}`, dueAt: new Date(NOW + (200 - i) * 60_000).toISOString() }),
    );
    const items = buildNativeReminders(many, SP, NOW);
    expect(items).toHaveLength(150);
    expect(items[0].at).toBeLessThan(items[1].at);
    expect(items[0].id).toBe("t199");
  });

  it("só data vira 'é para hoje'", () => {
    const [a] = buildNativeReminders([task({ time: null })], SP, NOW);
    expect(a.spoken).toBe("Lembrete: Tarefa. É para hoje.");
  });
});
