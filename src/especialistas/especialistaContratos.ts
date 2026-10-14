import * as Yup from 'yup'
import { type ContratoDeEntrada } from '../middlewares/validacaoMiddleware.js'
import { sanitizacaoPaciente } from '../pacientes/pacienteSanitizations.js'
import { pacienteSchema } from '../pacientes/pacienteYupSchema.js'
import { filtrarCamposAtualizacaoEspecialista, type AtualizarEspecialistaDTO } from './especialistaDto.js'

export interface AtualizarContatoDTO {
  telefone: string
}

const soDigitos = (valor: string): string => valor.replace(/[^0-9]/g, '')

/**
 * PATCH /especialista/:id: aceita SOMENTE `telefone`, com a mesma regra de telefone
 * do cadastro de paciente. Qualquer outro campo é descartado.
 */
export const contratoAtualizarContato: ContratoDeEntrada<AtualizarContatoDTO> = {
  filtrar: (corpo) => {
    const telefone = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>).telefone : undefined
    return telefone === undefined ? {} : { telefone }
  },
  sanitizar: (dto: { telefone?: unknown }) =>
    typeof dto.telefone === 'string' ? { telefone: soDigitos(dto.telefone) } : dto,
  schema: Yup.object().shape({
    telefone: (pacienteSchema.fields.telefone as Yup.StringSchema)
  }) as unknown as ContratoDeEntrada<AtualizarContatoDTO>['schema']
}

const especialistaSchema = pacienteSchema
  .pick(['nome', 'email', 'telefone', 'possuiPlanoSaude', 'planosSaude'])
  .shape({
    especialidade: Yup.string()
      .required('especialidade é obrigatória')
      .max(100)
      .matches(/^[\p{L}][\p{L} '-]*$/u, 'Especialidade inválida'),
    imagem: Yup.string()
      .max(500)
      .matches(/^https?:\/\/[^\s<>"']+$/i, 'imagem deve ser uma URL http(s) válida')
  })

/** PUT /especialista/:id: allowlist -> sanitização -> validação (mesmas regras do cadastro de paciente). */
export const contratoAtualizarEspecialista: ContratoDeEntrada<AtualizarEspecialistaDTO> = {
  filtrar: filtrarCamposAtualizacaoEspecialista,
  sanitizar: sanitizacaoPaciente,
  schema: especialistaSchema as unknown as ContratoDeEntrada<AtualizarEspecialistaDTO>['schema']
}
