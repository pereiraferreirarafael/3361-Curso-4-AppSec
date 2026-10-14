/**
 * Registro mínimo e ANONIMIZADO de uma consulta para análise de gestão.
 * De propósito não há paciente, CPF, nome ou id: o que sai daqui pode ser enviado
 * a uma LLM externa sem expor dado pessoal (LGPD, minimização de dados).
 */
export interface RegistroConsulta {
  /** Data/hora da consulta (a entidade não guarda quando foi agendada nem cancelada). */
  data: Date
  especialidade: string
  cancelada: boolean
}

/** Intervalo semiaberto [inicio, fim), em UTC. */
export interface Periodo {
  inicio: Date
  fim: Date
}

export interface ComparativoEspecialidade {
  especialidade: string
  agendamentos: number
  cancelamentos: number
  /** 0 a 100, inteiro */
  taxaCancelamentoPct: number
  agendamentosAnterior: number
  cancelamentosAnterior: number
  /** null quando o período anterior não teve cancelamentos (variação indefinida) */
  variacaoCancelamentosPct: number | null
}

export interface MetricasGestao {
  /** "Este mês" ou "Em 09/2026": usado para abrir o texto do resumo */
  rotuloPeriodo: string
  periodo: { inicio: string, fim: string }
  totais: {
    agendamentos: number
    cancelamentos: number
    taxaCancelamentoPct: number
    cancelamentosAnterior: number
    variacaoCancelamentosPct: number | null
  }
  /** Ordenado por cancelamentos (desc) */
  especialidades: ComparativoEspecialidade[]
}

export type OrigemResumo = 'llm' | 'simulado' | 'regras'

export interface ResultadoInsights {
  resumo: string[]
  origem: OrigemResumo
  metricas: MetricasGestao
}
