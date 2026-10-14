import { type RegistroConsulta } from '../../insights/insightsTipos.js'

/** Gera `agendamentos` consultas no mês (1 a 12), das quais `cancelamentos` canceladas. */
export function registrosDoMes (
  especialidade: string,
  ano: number,
  mes: number,
  agendamentos: number,
  cancelamentos: number
): RegistroConsulta[] {
  return Array.from({ length: agendamentos }, (_, i) => ({
    data: new Date(Date.UTC(ano, mes - 1, 1 + (i % 27), 10)),
    especialidade,
    cancelada: i < cancelamentos
  }))
}

/**
 * Cenário do enunciado: em outubro/2026, Cardiologia passa de 20 para 23
 * cancelamentos (+15%); Pediatria fica estável.
 */
export const cenarioCardiologia = (): RegistroConsulta[] => [
  ...registrosDoMes('Cardiologia', 2026, 9, 40, 20),
  ...registrosDoMes('Cardiologia', 2026, 10, 40, 23),
  ...registrosDoMes('Pediatria', 2026, 9, 30, 5),
  ...registrosDoMes('Pediatria', 2026, 10, 30, 5)
]
