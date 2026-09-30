import { describe, expect, it } from "vitest";
import { parseQuickText } from "@/lib/quickparse";

const SP = "America/Sao_Paulo";
// Quarta-feira, 30/09/2026, 15:00 em Brasília.
const now = new Date("2026-09-30T18:00:00Z");
const p = (s: string) => parseQuickText(s, now, SP);

describe("parseQuickText", () => {
  it("amanhã com hora", () => {
    expect(p("amanhã às 15h ligar pro João")).toMatchObject({
      title: "Ligar pro João",
      date: "2026-10-01",
      time: "15:00",
    });
  });

  it("dia da semana com minutos", () => {
    expect(p("reunião com a Ana sexta às 9:30")).toMatchObject({
      title: "Reunião com a Ana",
      date: "2026-10-02",
      time: "09:30",
    });
  });

  it("sem data nem hora", () => {
    expect(p("comprar pão")).toMatchObject({ title: "Comprar pão", date: null, time: null });
  });

  it("dia do mês: futuro neste mês, passado vai para o próximo", () => {
    expect(p("dia 5 pagar aluguel").date).toBe("2026-10-05");
    expect(p("dia 20 pagar a luz").date).toBe("2026-10-20");
    expect(p("dia 31 fechar o caixa").date).toBe("2026-10-31");
  });

  it("dd/mm e mês por extenso", () => {
    expect(p("25/12 comprar presentes").date).toBe("2026-12-25");
    expect(p("15 de novembro aniversário da Lu").date).toBe("2026-11-15");
    expect(p("10/01 renovar seguro").date).toBe("2027-01-10");
  });

  it("depois de amanhã e semana que vem", () => {
    expect(p("depois de amanhã dentista").date).toBe("2026-10-02");
    expect(p("semana que vem revisar o contrato").date).toBe("2026-10-07");
    expect(p("em 3 dias pagar boleto").date).toBe("2026-10-03");
  });

  it("tempo relativo", () => {
    expect(p("daqui a 30 minutos tirar o bolo do forno")).toMatchObject({
      date: "2026-09-30",
      time: "15:30",
      title: "Tirar o bolo do forno",
    });
    expect(p("em 2 horas ligar para o banco")).toMatchObject({ date: "2026-09-30", time: "17:00" });
    expect(p("daqui a meia hora reunião").time).toBe("15:30");
  });

  it("só hora: hoje se ainda vem, amanhã se já passou", () => {
    expect(p("às 18h buscar as crianças")).toMatchObject({ date: "2026-09-30", time: "18:00" });
    expect(p("às 9h academia")).toMatchObject({ date: "2026-10-01", time: "09:00" });
    expect(p("meio-dia almoço com o time")).toMatchObject({ date: "2026-10-01", time: "12:00" });
    expect(p("hoje às 9h relatório").date).toBe("2026-09-30");
  });

  it("períodos do dia", () => {
    expect(p("às 10 da noite tomar remédio").time).toBe("22:00");
    expect(p("amanhã às 8 da manhã voo").time).toBe("08:00");
    expect(p("amanhã às 3 da tarde dentista").time).toBe("15:00");
  });

  it("prioridade", () => {
    expect(p("urgente enviar proposta hoje às 17h")).toMatchObject({ priority: 1, title: "Enviar proposta" });
  });

  it("repetições", () => {
    expect(p("tomar remédio todo dia às 8h")).toMatchObject({
      repeat: "daily",
      time: "08:00",
      date: "2026-10-01",
      title: "Tomar remédio",
    });
    expect(p("toda segunda academia às 7h")).toMatchObject({ repeat: "weekly", date: "2026-10-05", time: "07:00" });
    expect(p("todo mês pagar condomínio dia 10")).toMatchObject({ repeat: "monthly", date: "2026-10-10" });
  });

  it("aviso antes", () => {
    expect(p("amanhã 10h dentista me avise 15 minutos antes")).toMatchObject({
      remindMinutesBefore: 15,
      time: "10:00",
      title: "Dentista",
    });
    expect(p("sexta às 14h reunião 1 hora antes").remindMinutesBefore).toBe(60);
  });

  it("tira o 'lembrar de' do título", () => {
    expect(p("lembrar de ligar para a mãe amanhã").title).toBe("Ligar para a mãe");
    expect(p("preciso comprar café").title).toBe("Comprar café");
  });

  it("não quebra com entrada vazia ou estranha", () => {
    expect(p("").title).toBe("");
    expect(p("   ").date).toBeNull();
    expect(p("dia 99").date).toBeNull();
    expect(p("32/13 coisa").date).toBeNull();
  });
});
