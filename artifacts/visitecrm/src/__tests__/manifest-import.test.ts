import { describe, expect, it } from "vitest";
import { buildManifestImport } from "../lib/manifest-import";

const headers = ["Nº", "Viagem", "Data de Saída", "Nº Reserva", "Passageiro", "CPF", "Nascimento", "Categoria", "Poltrona", "Ponto de Embarque", "Telefone", "Status"];

describe("buildManifestImport", () => {
  it("normaliza os cabeçalhos ANTT acentuados e dados de passageiro", () => {
    const result = buildManifestImport(headers, [[
      "1", "Excursão a João Pessoa", "24/08/2026", "RES-100", "Maria da Silva",
      "123.456.789-00", "01/05/1990", "Adulto", "12A", "Rodoviária", "(88) 99999-0000", "Pendente",
    ]]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([expect.objectContaining({
      line: 2, reservationNumber: "RES-100", tripName: "Excursão a João Pessoa",
      departureDate: "2026-08-24", cpf: "12345678900", birthDate: "1990-05-01",
      ageCategory: "adult", seatNumber: "12A", boardingPoint: "Rodoviária",
    })]);
  });

  it("aceita campos opcionais sem apagar dados existentes no servidor", () => {
    const result = buildManifestImport(headers, [[
      "2", "Serra", "2026-09-10", "45", "João", "", "", "Criança", "", "", "", "Embarcado",
    ]]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ ageCategory: "child", departureDate: "2026-09-10" });
    expect(result.rows[0].cpf).toBeUndefined();
    expect(result.rows[0].seatNumber).toBeUndefined();
  });

  it("reporta linhas que não podem ser relacionadas a uma reserva", () => {
    const result = buildManifestImport(headers, [[
      "3", "Serra", "data inválida", "", "", "", "", "", "", "", "", "",
    ]]);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Nº Reserva");
  });
});