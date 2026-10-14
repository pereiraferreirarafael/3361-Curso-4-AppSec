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

/**
 * Único contrato aceito do cliente em POST /consulta.
 * O paciente NÃO faz parte dele: é sempre o dono do token (req.userId).
 */
export interface CriarConsultaDTO {
  especialista: string
  data: Date
  desejaLembrete?: boolean
  lembretes?: number[]
}

const CAMPOS_CONSULTA: readonly (keyof CriarConsultaDTO)[] = ['especialista', 'data', 'desejaLembrete', 'lembretes']

export function filtrarCamposConsulta (corpo: unknown): Partial<CriarConsultaDTO> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return {}

  const dto: Record<string, unknown> = {}
  for (const chave of CAMPOS_CONSULTA) {
    if (Object.prototype.hasOwnProperty.call(corpo, chave)) dto[chave] = (corpo as Record<string, unknown>)[chave]
  }
  return dto as Partial<CriarConsultaDTO>
}
