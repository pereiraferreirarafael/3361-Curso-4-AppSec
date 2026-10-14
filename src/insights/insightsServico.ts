import { calcularMetricas } from './insightsAnalise.js'
import { type ProvedorLLM } from './insightsLLM.js'
import { resumoPorRegras } from './insightsRegras.js'
import { sanearSaidaLLM } from './insightsSaneamento.js'
import { type Periodo, type RegistroConsulta, type ResultadoInsights } from './insightsTipos.js'

export const TIMEOUT_PADRAO_MS = 15_000

export class TempoEsgotado extends Error {
  constructor () { super('tempo esgotado') }
}

const comTimeout = async <T>(executar: (sinal: AbortSignal) => Promise<T>, ms: number): Promise<T> => {
  const controle = new AbortController()
  let temporizador: NodeJS.Timeout | undefined
  const expira = new Promise<never>((_resolve, rejeita) => {
    temporizador = setTimeout(() => {
      controle.abort()
      rejeita(new TempoEsgotado())
    }, ms)
  })

  try {
    return await Promise.race([executar(controle.signal), expira])
  } finally {
    clearTimeout(temporizador)
  }
}

/**
 * Analisa agendamentos e cancelamentos e devolve um resumo de até 3 linhas.
 *
 * Nunca falha por causa da LLM: sem dados, erro, recusa, timeout ou texto
 * inválido, devolve o resumo por regras (origem "regras").
 */
export async function gerarInsights (
  registros: RegistroConsulta[],
  periodo: Periodo,
  rotuloPeriodo: string,
  provedor: ProvedorLLM,
  opcoes: { timeoutMs?: number } = {}
): Promise<ResultadoInsights> {
  const metricas = calcularMetricas(registros, periodo, rotuloPeriodo)
  const porRegras = (): ResultadoInsights => ({ resumo: resumoPorRegras(metricas), origem: 'regras', metricas })

  // sem dados não há o que a LLM analisar: economiza a chamada
  if (metricas.totais.agendamentos === 0) return porRegras()

  try {
    const texto = await comTimeout(
      async (sinal) => await provedor.gerarResumo(metricas, sinal),
      opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS
    )
    const resumo = sanearSaidaLLM(texto)
    if (resumo === null) {
      console.warn(`[insights] provedor ${provedor.nome} devolveu texto inutilizável: usando regras`)
      return porRegras()
    }
    return { resumo, origem: provedor.simulado ? 'simulado' : 'llm', metricas }
  } catch (erro) {
    // só o tipo do erro: a mensagem poderia carregar trechos da requisição
    console.warn(`[insights] provedor ${provedor.nome} falhou (${erro instanceof Error ? erro.name : 'erro'}): usando regras`)
    return porRegras()
  }
}
