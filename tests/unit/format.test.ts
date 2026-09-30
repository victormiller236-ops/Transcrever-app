import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  dayLabel,
  doneToday,
  groupByDate,
  groupForDay,
  isOverdue,
  nowParts,
  remindLabel,
} from "@/lib/format";
import type { TaskDTO } from "@/lib/types";

const SP = "America/Sao_Paulo";

function t(over: Partial<TaskDTO>): TaskDTO {
  return {
    id: Math.random().toString(36).slice(2),
    title: "x",
    notes: null,
    date: null,
    time: null,
    dueAt: null,
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

describe("datas", () => {
  it("addDaysToKey atravessa mês e ano", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("dayLabel", () => {
    expect(dayLabel("2026-09-30", "2026-09-30")).toBe("Hoje");
    expect(dayLabel("2026-10-01", "2026-09-30")).toBe("Amanhã");
    expect(dayLabel("2026-09-29", "2026-09-30")).toBe("Ontem");
    expect(dayLabel("2026-10-08", "2026-09-30")).toBe("qui, 8 out");
  });
  it("nowParts usa o fuso pedido", () => {
    // 02:00Z de 01/10 ainda é 30/09 23:00 em Brasília
    expect(nowParts(SP, new Date("2026-10-01T02:00:00Z"))).toEqual({ key: "2026-09-30", minutes: 23 * 60 });
  });
  it("remindLabel", () => {
    expect(remindLabel(0)).toBe("Na hora");
    expect(remindLabel(10)).toBe("10 min antes");
    expect(remindLabel(60)).toBe("1 hora antes");
    expect(remindLabel(120)).toBe("2 horas antes");
    expect(remindLabel(1440)).toBe("1 dia antes");
  });
});

describe("agrupamento", () => {
  const today = "2026-09-30";
  const nowMin = 15 * 60;
  const late = t({ id: "late", date: "2026-09-29", time: "10:00", dueAt: "2026-09-29T13:00:00.000Z" });
  const earlierToday = t({ id: "earlier", date: today, time: "09:00", dueAt: "2026-09-30T12:00:00.000Z" });
  const laterToday = t({ id: "later", date: today, time: "18:00", dueAt: "2026-09-30T21:00:00.000Z" });
  const dateOnly = t({ id: "dateonly", date: today, dueAt: "2026-09-30T12:00:00.000Z" });
  const tomorrow = t({ id: "tmrw", date: "2026-10-01", time: "08:00", dueAt: "2026-10-01T11:00:00.000Z" });
  const nodate = t({ id: "nodate" });
  const finished = t({ id: "done", date: today, done: true, doneAt: "2026-09-30T16:00:00.000Z" });
  const all = [tomorrow, laterToday, nodate, late, earlierToday, dateOnly, finished];

  it("isOverdue", () => {
    expect(isOverdue(late, today, nowMin)).toBe(true);
    expect(isOverdue(earlierToday, today, nowMin)).toBe(true);
    expect(isOverdue(laterToday, today, nowMin)).toBe(false);
    expect(isOverdue(dateOnly, today, nowMin)).toBe(false);
    expect(isOverdue(finished, today, nowMin)).toBe(false);
  });

  it("visão de hoje: atrasadas, do dia e sem data", () => {
    const g = groupForDay(all, today, today, nowMin);
    expect(g.overdue.map((x) => x.id)).toEqual(["late", "earlier"]);
    expect(g.day.map((x) => x.id)).toEqual(["dateonly", "later"]);
    expect(g.undated.map((x) => x.id)).toEqual(["nodate"]);
  });

  it("visão de outro dia só mostra as tarefas dele", () => {
    const g = groupForDay(all, "2026-10-01", today, nowMin);
    expect(g.overdue).toEqual([]);
    expect(g.undated).toEqual([]);
    expect(g.day.map((x) => x.id)).toEqual(["tmrw"]);
  });

  it("groupByDate ordena e agrupa, deixando sem data por último", () => {
    const groups = groupByDate(all);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", null]);
    expect(groups[1].tasks.map((x) => x.id)).toEqual(["earlier", "dateonly", "later"]);
  });

  it("doneToday conta o progresso do dia", () => {
    expect(doneToday(all, today, SP)).toEqual({ done: 1, total: 5 });
  });
});
