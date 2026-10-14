import { type ComparativoEspecialidade, type MetricasGestao } from './insightsTipos.js'

/** Alta de cancelamentos a partir da qual vale um alerta. */
export const LIMIAR_ALTA_PCT = 10
/** Evita alarme com amostra minúscula (de 1 para 2 cancelamentos já seria +100%). */
export const MINIMO_CANCELAMENTOS = 3
const TAXA_GERAL_ALTA_PCT = 25

const sinal = (pct: number): string => (pct > 0 ? '+' : pct < 0 ? '-' : '')

const especialidadeEmAlta = (metricas: MetricasGestao): ComparativoEspecialidade | undefined =>
  metricas.especialidades
    .filter((e) =>
      e.cancelamentos >= MINIMO_CANCELAMENTOS &&
      e.variacaoCancelamentosPct !== null &&
      e.variacaoCancelamentosPct >= LIMIAR_ALTA_PCT)
    .sort((x, y) =>
      (y.variacaoCancelamentosPct as number) - (x.variacaoCancelamentosPct as number) ||
      y.cancelamentos - x.cancelamentos)[0]

/**
 * Resumo determinístico (até 3 linhas), sem LLM. Serve como:
 *  - implementação do provedor simulado (mock);
 *  - plano B quando a LLM falha, estoura o tempo ou devolve texto inválido.
 */
export function resumoPorRegras (metricas: MetricasGestao): string[] {
  const { totais } = metricas
  if (totais.agendamentos === 0) {
    return ['Não há agendamentos no período analisado.']
  }

  const variacao = totais.variacaoCancelamentosPct === null
    ? ''
    : `, ${sinal(totais.variacaoCancelamentosPct)}${Math.abs(totais.variacaoCancelamentosPct)}% de cancelamentos em relação ao mês anterior`
  const linhas = [
    `Foram ${totais.agendamentos} agendamentos e ${totais.cancelamentos} cancelamentos (taxa de ${totais.taxaCancelamentoPct}%${variacao}).`
  ]

  const emAlta = especialidadeEmAlta(metricas)
  if (emAlta !== undefined) {
    linhas.push(
      `${metricas.rotuloPeriodo} houve um aumento de ${emAlta.variacaoCancelamentosPct as number}% em cancelamentos na especialidade ${emAlta.especialidade}.`,
      `Sugerimos revisar a escala de médicos de ${emAlta.especialidade}.`
    )
    return linhas
  }

  const maiorTaxa = [...metricas.especialidades]
    .filter((e) => e.agendamentos >= MINIMO_CANCELAMENTOS && e.cancelamentos > 0)
    .sort((x, y) => y.taxaCancelamentoPct - x.taxaCancelamentoPct || y.cancelamentos - x.cancelamentos)[0]
  if (maiorTaxa !== undefined) {
    linhas.push(`A maior taxa de cancelamento está em ${maiorTaxa.especialidade} (${maiorTaxa.taxaCancelamentoPct}%).`)
  }

  linhas.push(
    totais.taxaCancelamentoPct >= TAXA_GERAL_ALTA_PCT
      ? 'Sugerimos reforçar lembretes e a confirmação de consultas para reduzir faltas.'
      : 'Nenhuma especialidade com alta relevante de cancelamentos; mantenha o acompanhamento mensal.'
  )
  return linhas.slice(0, 3)
}
