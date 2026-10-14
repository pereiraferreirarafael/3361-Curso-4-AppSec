import type { Paciente } from './pacienteEntity.js'
import type { Endereco } from '../enderecos/enderecoEntity.js'

export interface EnderecoDTO {
  cep: string
  rua: string
  estado: string
  numero: number
  complemento: string
}

/**
 * Único contrato aceito do cliente em POST /paciente.
 * Campos que definem privilégio ou estado interno (role, id, estaAtivo, imagem, ...)
 * ficam de fora de propósito: quem decide esses valores é o servidor.
 */
export interface CriarPacienteDTO {
  cpf: string
  nome: string
  email: string
  senha: string
  telefone: string
  possuiPlanoSaude: boolean
  planosSaude?: number[]
  imagemUrl?: string
  historico?: string[]
  endereco?: EnderecoDTO
}

/** Único contrato aceito em PUT /paciente/:id (cpf, senha, role, estaAtivo e imagem ficam de fora). */
export interface AtualizarPacienteDTO {
  nome: string
  email: string
  telefone: string
  possuiPlanoSaude: boolean
  planosSaude?: number[]
  imagemUrl?: string
  historico?: string[]
}

type ChaveEndereco = keyof EnderecoDTO
type ChavePaciente = Exclude<keyof CriarPacienteDTO, 'endereco'>

// `satisfies` não existe no TS 4.9; o tipo explícito garante que a lista só
// contenha chaves do DTO.
const CAMPOS_PACIENTE: readonly ChavePaciente[] = [
  'cpf',
  'nome',
  'email',
  'senha',
  'telefone',
  'possuiPlanoSaude',
  'planosSaude',
  'imagemUrl',
  'historico'
]

const CAMPOS_ENDERECO: readonly ChaveEndereco[] = [
  'cep',
  'rua',
  'estado',
  'numero',
  'complemento'
]

const CAMPOS_ATUALIZACAO: readonly (keyof AtualizarPacienteDTO)[] = [
  'nome',
  'email',
  'telefone',
  'possuiPlanoSaude',
  'planosSaude',
  'imagemUrl',
  'historico'
]

const possui = (obj: object, chave: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, chave)

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor)

const copiarChaves = (origem: Record<string, unknown>, chaves: readonly string[]): Record<string, unknown> => {
  const destino: Record<string, unknown> = {}
  for (const chave of chaves) {
    if (possui(origem, chave)) destino[chave] = origem[chave]
  }
  return destino
}

/** Allowlist de PUT /paciente/:id. */
export function filtrarCamposAtualizacao (corpo: unknown): Partial<AtualizarPacienteDTO> {
  return ehObjeto(corpo) ? copiarChaves(corpo, CAMPOS_ATUALIZACAO) as Partial<AtualizarPacienteDTO> : {}
}

/** Allowlist de PATCH /paciente/:id (endereço): o próprio corpo é o endereço. */
export function filtrarEndereco (corpo: unknown): Partial<EnderecoDTO> {
  return ehObjeto(corpo) ? copiarChaves(corpo, CAMPOS_ENDERECO) as Partial<EnderecoDTO> : {}
}

/**
 * Allowlist: copia SOMENTE as chaves permitidas do corpo da requisição.
 * Qualquer outra chave (role, isAdmin, id, imagem, estaAtivo, __proto__, ...)
 * é descartada antes de sanitização, validação ou persistência.
 */
export function filtrarCamposPermitidos (corpo: unknown): Partial<CriarPacienteDTO> {
  if (!ehObjeto(corpo)) return {}

  const dto: Record<string, unknown> = {}
  for (const chave of CAMPOS_PACIENTE) {
    if (possui(corpo, chave)) dto[chave] = corpo[chave]
  }

  if (possui(corpo, 'endereco') && ehObjeto(corpo.endereco)) {
    const endereco: Record<string, unknown> = {}
    for (const chave of CAMPOS_ENDERECO) {
      if (possui(corpo.endereco, chave)) endereco[chave] = corpo.endereco[chave]
    }
    dto.endereco = endereco
  }

  return dto as Partial<CriarPacienteDTO>
}

// ---------------------------------------------------------------------------
// Saída (resposta HTTP)
//
// Os mapeadores montam o objeto de resposta campo a campo (deny by default):
// uma coluna nova na entidade NÃO vaza para a API até ser listada aqui.
// Ficam de fora: senha, cpf, role e historico (dado clínico sensível, que só
// deve sair numa rota autenticada do próprio paciente).
// ---------------------------------------------------------------------------

export interface EnderecoRespostaDTO {
  cep: number
  rua: string
  numero: number
  estado: string
  complemento: string
}

export interface PacienteResumoDTO {
  id: string
  nome: string
}

export interface PacienteRespostaDTO extends PacienteResumoDTO {
  email: string
  telefone: string
  estaAtivo: boolean
  possuiPlanoSaude: boolean
  planosSaude?: string[]
  imagemUrl?: string
  imagem?: { url: string }
  endereco?: EnderecoRespostaDTO
}

export const paraEnderecoResposta = (endereco: Endereco): EnderecoRespostaDTO => ({
  cep: endereco.cep,
  rua: endereco.rua,
  numero: endereco.numero,
  estado: endereco.estado,
  complemento: endereco.complemento
})

/** Listagens: só o necessário para identificar o paciente. */
export function paraPacienteResumo (origem: { id: string, nome: string }): PacienteResumoDTO {
  return { id: origem.id, nome: origem.nome }
}

/** Detalhe do paciente, sem credenciais, CPF, role ou histórico clínico. */
export function paraPacienteResposta (paciente: Paciente): PacienteRespostaDTO {
  const resposta: PacienteRespostaDTO = {
    ...paraPacienteResumo(paciente),
    email: paciente.email,
    telefone: paciente.telefone,
    estaAtivo: paciente.estaAtivo,
    possuiPlanoSaude: paciente.possuiPlanoSaude,
    planosSaude: paciente.planosSaude,
    imagemUrl: paciente.imagemUrl
  }

  if (paciente.imagem != null) resposta.imagem = { url: paciente.imagem.url }
  if (paciente.endereco != null) resposta.endereco = paraEnderecoResposta(paciente.endereco)

  return resposta
}
