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

const possui = (obj: object, chave: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, chave)

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor)

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
