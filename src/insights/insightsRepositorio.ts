import { Between } from 'typeorm'
import { AppDataSource } from '../data-source.js'
import { Consulta } from '../consultas/consultaEntity.js'
import { periodoAnterior } from './insightsAnalise.js'
import { type Periodo, type RegistroConsulta } from './insightsTipos.js'

/**
 * Lê só o necessário para a análise: data, motivo de cancelamento e especialidade.
 * Não carrega paciente nem os demais dados do especialista (loadEagerRelations: false):
 * nada de dado pessoal chega à camada que fala com a LLM.
 *
 * Cancelada = consulta com `motivoCancelamento` preenchido.
 */
export async function buscarRegistros (periodo: Periodo): Promise<RegistroConsulta[]> {
  const inicio = periodoAnterior(periodo).inicio
  const fim = new Date(periodo.fim.getTime() - 1)

  const consultas = await AppDataSource.manager.find(Consulta, {
    select: { id: true, data: true, motivoCancelamento: true, especialista: { id: true, especialidade: true } },
    relations: { especialista: true },
    loadEagerRelations: false,
    where: { data: Between(inicio, fim) }
  })

  return consultas.map((consulta) => ({
    data: new Date(consulta.data),
    especialidade: consulta.especialista?.especialidade,
    cancelada: consulta.motivoCancelamento !== null && consulta.motivoCancelamento !== undefined && consulta.motivoCancelamento !== ''
  }))
}
