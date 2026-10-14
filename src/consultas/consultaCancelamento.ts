import { IsNull, MoreThan, type EntityManager } from 'typeorm'
import { Consulta } from './consultaEntity.js'

/**
 * Cancela (logicamente) as consultas FUTURAS e ainda ativas de um paciente OU de um
 * especialista, quando a conta é desativada: libera a agenda do outro lado.
 * Devolve quantas foram canceladas.
 *
 * Exige exatamente um dos dois filtros: sem eles o `find` pegaria TODAS as consultas.
 */
export async function cancelarConsultasFuturas (
  manager: EntityManager,
  quem: { paciente?: string, especialista?: string },
  motivo: string,
  agora: Date = new Date()
): Promise<number> {
  const temPaciente = typeof quem.paciente === 'string' && quem.paciente !== ''
  const temEspecialista = typeof quem.especialista === 'string' && quem.especialista !== ''
  if (temPaciente === temEspecialista) {
    throw new Error('Informe exatamente um entre paciente e especialista')
  }

  const consultas = await manager.find(Consulta, {
    where: {
      canceladaEm: IsNull(),
      data: MoreThan(agora),
      ...(temPaciente ? { paciente: { id: quem.paciente } } : { especialista: { id: quem.especialista } })
    }
  })

  for (const consulta of consultas) consulta.cancelar(motivo)
  if (consultas.length > 0) await manager.save(Consulta, consultas)

  return consultas.length
}
