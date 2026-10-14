import { Role } from '../auth/roles.js'
import { type Consulta } from './consultaEntity.js'

const idDe = (relacao: unknown): string | undefined =>
  typeof relacao === 'object' && relacao !== null ? (relacao as { id?: string }).id : undefined

/**
 * Autorização em nível de objeto (BOLA) para uma consulta.
 *  - CLINICA: vê/cancela as consultas da clínica
 *  - PACIENTE: só as consultas em que é o paciente
 *  - ESPECIALISTA: só as consultas em que é o especialista
 */
export function podeAcessarConsulta (consulta: Consulta, userId?: string, role?: string): boolean {
  if (userId === undefined || userId === '') return false

  switch (role) {
    case Role.clinica:
      return true
    case Role.paciente:
      return idDe(consulta.paciente) === userId
    case Role.especialista:
      return idDe(consulta.especialista) === userId
    default:
      return false
  }
}

/** Filtro de listagem equivalente a `podeAcessarConsulta`, aplicado já na consulta ao banco. */
export function filtroDeListagem (userId?: string, role?: string): Record<string, unknown> | null {
  switch (role) {
    case Role.clinica:
      return {}
    case Role.paciente:
      return { paciente: { id: userId } }
    case Role.especialista:
      return { especialista: { id: userId } }
    default:
      return null
  }
}
