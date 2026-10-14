import * as Yup from 'yup'
import { type ContratoDeEntrada } from '../middlewares/validacaoMiddleware.js'
import { sanitizacaoPaciente } from '../pacientes/pacienteSanitizations.js'
import { pacienteSchema } from '../pacientes/pacienteYupSchema.js'
import {
  filtrarCamposAtualizarClinica,
  filtrarCamposCriarClinica,
  filtrarVinculoEspecialista,
  type AtualizarClinicaDTO,
  type CriarClinicaDTO,
  type VincularEspecialistaDTO
} from './clinicaDto.js'

// Nome de clínica pode ter número e "&" (ex.: "Clínica 24h", "Silva & Filhos"), diferente de nome de pessoa.
const nome = Yup.string()
  .max(100)
  .matches(/^[\p{L}\p{N}][\p{L}\p{N} .,'&-]*$/u, 'Nome da clínica inválido')

const planos = Yup.array().of(Yup.number().integer().min(0)).max(10)

/** Normaliza só o que tem regra própria; o nome da clínica não passa pela regra de nome de pessoa. */
const sanitizar = (dto: any): unknown => {
  // só as chaves PRESENTES: o sanitizador de paciente falha com undefined (atualização parcial)
  const aSanitizar: Record<string, unknown> = {}
  if (dto.email !== undefined) aSanitizar.email = dto.email
  if (dto.endereco !== undefined) aSanitizar.endereco = dto.endereco

  const limpo: Record<string, unknown> = { ...dto, ...sanitizacaoPaciente(aSanitizar) }
  if (typeof dto.nome === 'string') limpo.nome = dto.nome.trim()
  return limpo
}

/** `.default(undefined)`: sem isso o yup fabrica um endereço vazio e acusa campos obrigatórios. */
const enderecoOpcional = (pacienteSchema.fields.endereco as Yup.ObjectSchema<any>).default(undefined).optional()

/** POST /clinica */
export const contratoCriarClinica: ContratoDeEntrada<CriarClinicaDTO> = {
  filtrar: filtrarCamposCriarClinica,
  sanitizar,
  schema: Yup.object().shape({
    nome: nome.required('nome é obrigatório'),
    email: pacienteSchema.fields.email as Yup.StringSchema,
    senha: pacienteSchema.fields.senha as Yup.StringSchema, // mesma regra de senha forte do paciente
    endereco: pacienteSchema.fields.endereco as Yup.ObjectSchema<any>,
    planoDeSaudeAceitos: planos
  }) as unknown as ContratoDeEntrada<CriarClinicaDTO>['schema']
}

/** PUT /clinica/:id (parcial). Senha não é alterada por aqui. */
export const contratoAtualizarClinica: ContratoDeEntrada<AtualizarClinicaDTO> = {
  filtrar: filtrarCamposAtualizarClinica,
  sanitizar,
  schema: Yup.object().shape({
    nome,
    email: (pacienteSchema.fields.email as Yup.StringSchema).optional(),
    endereco: enderecoOpcional,
    planoDeSaudeAceitos: planos
  }) as unknown as ContratoDeEntrada<AtualizarClinicaDTO>['schema']
}

/** POST /clinica/:id/especialista */
export const contratoVincularEspecialista: ContratoDeEntrada<VincularEspecialistaDTO> = {
  filtrar: filtrarVinculoEspecialista,
  schema: Yup.object().shape({
    especialistaId: Yup.string().required('especialistaId é obrigatório').max(36)
  }) as unknown as ContratoDeEntrada<VincularEspecialistaDTO>['schema']
}
