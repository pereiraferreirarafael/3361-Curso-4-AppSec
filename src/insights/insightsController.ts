import { type Request, type RequestHandler, type Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { periodoDoMes } from './insightsAnalise.js'
import { type ProvedorLLM } from './insightsLLM.js'
import { gerarInsights } from './insightsServico.js'
import { type Periodo, type RegistroConsulta, type ResultadoInsights } from './insightsTipos.js'

export interface DependenciasInsights {
  provedor: ProvedorLLM
  buscarRegistros: (periodo: Periodo) => Promise<RegistroConsulta[]>
  agora: () => Date
  /** Por quanto tempo reaproveitar um resumo já gerado (controla custo e carga). */
  ttlCacheMs: number
  timeoutMs?: number
}

const MESES_MAXIMOS_NO_PASSADO = 36
const TAMANHO_MAXIMO_CACHE = 50
const FORMATO_MES = /^(\d{4})-(0[1-9]|1[0-2])$/

const indiceDoMes = (ano: number, mes: number): number => ano * 12 + (mes - 1)

/**
 * GET /admin/insights?mes=AAAA-MM  (padrão: mês corrente)
 * Só o gestor da clínica chega aqui (ver insightsRoutes.ts).
 */
export function criaObterInsights (deps: DependenciasInsights): RequestHandler {
  const cache = new Map<string, { expira: number, resultado: ResultadoInsights }>()

  return async (req: Request, res: Response): Promise<void> => {
    const agora = deps.agora()
    const mesAtual = indiceDoMes(agora.getUTCFullYear(), agora.getUTCMonth() + 1)

    let ano = agora.getUTCFullYear()
    let mes = agora.getUTCMonth() + 1
    if (req.query.mes !== undefined) {
      const partes = typeof req.query.mes === 'string' ? FORMATO_MES.exec(req.query.mes) : null
      const pedido = partes === null ? null : indiceDoMes(Number(partes[1]), Number(partes[2]))
      // limita o intervalo: evita meses sem sentido e um cache que cresce sem limite
      if (partes === null || pedido === null || pedido > mesAtual || pedido < mesAtual - MESES_MAXIMOS_NO_PASSADO) {
        res.status(StatusCodes.BAD_REQUEST).json({
          message: `Parâmetro "mes" inválido. Use AAAA-MM, do mês atual até ${MESES_MAXIMOS_NO_PASSADO} meses atrás.`
        })
        return
      }
      ano = Number(partes[1])
      mes = Number(partes[2])
    }

    const chave = `${ano}-${String(mes).padStart(2, '0')}`
    const noCache = cache.get(chave)
    let resultado: ResultadoInsights

    if (noCache !== undefined && noCache.expira > agora.getTime()) {
      resultado = noCache.resultado
    } else {
      const periodo = periodoDoMes(ano, mes)
      const rotulo = indiceDoMes(ano, mes) === mesAtual ? 'Este mês' : `Em ${String(mes).padStart(2, '0')}/${ano}`
      const registros = await deps.buscarRegistros(periodo)
      resultado = await gerarInsights(registros, periodo, rotulo, deps.provedor, { timeoutMs: deps.timeoutMs })

      if (cache.size >= TAMANHO_MAXIMO_CACHE) cache.delete(cache.keys().next().value as string)
      cache.set(chave, { expira: agora.getTime() + deps.ttlCacheMs, resultado })
    }

    // dado de gestão: não deve ficar em cache de navegador ou proxy
    res.set('Cache-Control', 'no-store')
    res.status(StatusCodes.OK).json({
      mes: chave,
      resumo: resultado.resumo,
      origem: resultado.origem,
      metricas: resultado.metricas
    })
  }
}
