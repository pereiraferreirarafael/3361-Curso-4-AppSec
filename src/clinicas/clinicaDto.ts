import { paraEnderecoResposta, type EnderecoDTO, type EnderecoRespostaDTO } from '../pacientes/pacienteDto.js'
import { type Clinica } from './clinicaEntity.js'

/** Único contrato aceito em POST /clinica (id, role, especialistas e senha em claro nunca voltam). */
export interface CriarClinicaDTO {
  nome: string
  email: string
  senha: string
  endereco: EnderecoDTO
  planoDeSaudeAceitos?: number[]
}

/** Único contrato aceito em PUT /clinica/:id. Todos os campos são opcionais (atualização parcial). */
export interface AtualizarClinicaDTO {
  nome?: string
  email?: string
  endereco?: EnderecoDTO
  planoDeSaudeAceitos?: number[]
}

export interface VincularEspecialistaDTO {
  especialistaId: string
}

const CAMPOS_ENDERECO: readonly (keyof EnderecoDTO)[] = ['cep', 'rua', 'estado', 'numero', 'complemento']

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor)

const copiar = (origem: Record<string, unknown>, chaves: readonly string[]): Record<string, unknown> => {
  const destino: Record<string, unknown> = {}
  for (const chave of chaves) {
    if (Object.prototype.hasOwnProperty.call(origem, chave)) destino[chave] = origem[chave]
  }
  return destino
}

const filtrar = (corpo: unknown, chaves: readonly string[]): Record<string, unknown> => {
  if (!ehObjeto(corpo)) return {}
  const dto = copiar(corpo, chaves)
  if (ehObjeto(corpo.endereco)) dto.endereco = copiar(corpo.endereco, CAMPOS_ENDERECO)
  return dto
}

export const filtrarCamposCriarClinica = (corpo: unknown): Partial<CriarClinicaDTO> =>
  filtrar(corpo, ['nome', 'email', 'senha', 'planoDeSaudeAceitos']) as Partial<CriarClinicaDTO>

export const filtrarCamposAtualizarClinica = (corpo: unknown): Partial<AtualizarClinicaDTO> =>
  filtrar(corpo, ['nome', 'email', 'planoDeSaudeAceitos']) as Partial<AtualizarClinicaDTO>

export const filtrarVinculoEspecialista = (corpo: unknown): Partial<VincularEspecialistaDTO> =>
  ehObjeto(corpo) ? copiar(corpo, ['especialistaId']) as Partial<VincularEspecialistaDTO> : {}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

/** Vitrine pública: o e-mail da clínica é o login do gestor e não deve ser publicado. */
export interface ClinicaPublicaDTO {
  id: string
  nome: string
  planoDeSaudeAceitos: string[]
  endereco?: EnderecoRespostaDTO
}

export interface ClinicaRespostaDTO extends ClinicaPublicaDTO {
  email: string
}

export function paraClinicaPublica (clinica: Clinica): ClinicaPublicaDTO {
  const dto: ClinicaPublicaDTO = {
    id: clinica.id,
    nome: clinica.nome,
    planoDeSaudeAceitos: Array.isArray(clinica.planoDeSaudeAceitos) ? clinica.planoDeSaudeAceitos : []
  }
  if (clinica.endereco != null) dto.endereco = paraEnderecoResposta(clinica.endereco)
  return dto
}

/** Para a própria clínica: acrescenta o e-mail. Nunca inclui senha nem role. */
export function paraClinicaResposta (clinica: Clinica): ClinicaRespostaDTO {
  return { ...paraClinicaPublica(clinica), email: clinica.email }
}
