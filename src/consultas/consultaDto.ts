import { type Consulta } from './consultaEntity.js'
import { paraPacienteResumo } from '../pacientes/pacienteDto.js'

/**
 * `paciente` é eager na entidade Consulta; sem este mapeador cada consulta
 * devolveria o cadastro completo do paciente (CPF, histórico clínico, ...).
 */
export function paraConsultaResposta (consulta: Consulta): Record<string, unknown> {
  const { paciente, ...resto } = consulta
  return {
    ...resto,
    paciente: paciente !== null && typeof paciente === 'object'
      ? paraPacienteResumo(paciente)
      : paciente
  }
}
