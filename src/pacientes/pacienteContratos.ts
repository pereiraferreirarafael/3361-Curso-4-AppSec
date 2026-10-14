import { type ContratoDeEntrada } from '../middlewares/validacaoMiddleware.js'
import {
  filtrarCamposAtualizacao,
  filtrarCamposPermitidos,
  filtrarEndereco,
  type AtualizarPacienteDTO,
  type CriarPacienteDTO,
  type EnderecoDTO
} from './pacienteDto.js'
import { sanitizacaoPaciente } from './pacienteSanitizations.js'
import { pacienteSchema } from './pacienteYupSchema.js'

/** POST /paciente: allowlist -> sanitização -> validação yup. */
export const contratoCriarPaciente: ContratoDeEntrada<CriarPacienteDTO> = {
  filtrar: filtrarCamposPermitidos,
  sanitizar: sanitizacaoPaciente,
  schema: pacienteSchema as unknown as ContratoDeEntrada<CriarPacienteDTO>['schema']
}

/** PUT /paciente/:id: só os campos editáveis pelo dono, reaproveitando as regras do cadastro. */
export const contratoAtualizarPaciente: ContratoDeEntrada<AtualizarPacienteDTO> = {
  filtrar: filtrarCamposAtualizacao,
  sanitizar: sanitizacaoPaciente,
  schema: pacienteSchema.pick([
    'nome',
    'email',
    'telefone',
    'possuiPlanoSaude',
    'planosSaude',
    'imagemUrl',
    'historico'
  ]) as unknown as ContratoDeEntrada<AtualizarPacienteDTO>['schema']
}

/** PATCH /paciente/:id: o corpo inteiro é o endereço. */
export const contratoAtualizarEndereco: ContratoDeEntrada<EnderecoDTO> = {
  filtrar: filtrarEndereco,
  sanitizar: (endereco) => sanitizacaoPaciente({ endereco }).endereco,
  schema: pacienteSchema.fields.endereco as unknown as ContratoDeEntrada<EnderecoDTO>['schema']
}
