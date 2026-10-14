import { paraEnderecoResposta, type EnderecoRespostaDTO } from '../pacientes/pacienteDto.js'
import { type Especialista } from './EspecialistaEntity.js'

/**
 * Único contrato aceito do cliente em PUT /especialista/:id (edição pelo PRÓPRIO especialista).
 * Ficam de fora, de propósito: crm (registro profissional, não se auto-atribui), estaAtivo
 * (quem desativa é a clínica ou o fluxo de desativação), senha, role, id, clinica.
 */
export interface AtualizarEspecialistaDTO {
  nome: string
  especialidade: string
  email: string
  telefone: string
  possuiPlanoSaude: boolean
  planosSaude?: number[]
  imagem?: string
}

const CAMPOS_ATUALIZACAO: readonly (keyof AtualizarEspecialistaDTO)[] = [
  'nome', 'especialidade', 'email', 'telefone', 'possuiPlanoSaude', 'planosSaude', 'imagem'
]

export function filtrarCamposAtualizacaoEspecialista (corpo: unknown): Partial<AtualizarEspecialistaDTO> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return {}

  const dto: Record<string, unknown> = {}
  for (const chave of CAMPOS_ATUALIZACAO) {
    if (Object.prototype.hasOwnProperty.call(corpo, chave)) dto[chave] = (corpo as Record<string, unknown>)[chave]
  }
  return dto as Partial<AtualizarEspecialistaDTO>
}

// ---------------------------------------------------------------------------
// Saída. `avaliacoes` é eager na entidade e cada avaliação carrega `pacienteId`:
// devolver a entidade inteira vaza quais pacientes consultaram com o especialista.
// ---------------------------------------------------------------------------

export interface ResumoAvaliacoesDTO {
  quantidade: number
  /** média com 1 casa decimal; null quando ainda não há avaliações */
  media: number | null
}

/** Visão pública (listagens e busca): sem e-mail, telefone, role nem ids de pacientes. */
export interface EspecialistaPublicoDTO {
  id: string
  nome: string
  especialidade: string
  crm: string
  imagem: string
  estaAtivo: boolean
  possuiPlanoSaude: boolean
  planosSaude: string[]
  avaliacoes: ResumoAvaliacoesDTO
  endereco?: { estado: string }
}

/** Visão da própria clínica e do próprio especialista: acrescenta contato e endereço completo. */
export interface EspecialistaAdminDTO extends Omit<EspecialistaPublicoDTO, 'endereco'> {
  email: string
  telefone: string
  endereco?: EnderecoRespostaDTO
}

export function resumirAvaliacoes (avaliacoes: unknown): ResumoAvaliacoesDTO {
  const lista = Array.isArray(avaliacoes) ? avaliacoes : []
  const notas = lista.map((a) => a?.nota).filter((n): n is number => typeof n === 'number')
  if (notas.length === 0) return { quantidade: 0, media: null }

  const soma = notas.reduce((total, n) => total + n, 0)
  return { quantidade: notas.length, media: Math.round((soma * 10) / notas.length) / 10 }
}

const planosComoLista = (planos: unknown): string[] => (Array.isArray(planos) ? planos : [])

export function paraEspecialistaPublico (e: Especialista): EspecialistaPublicoDTO {
  const dto: EspecialistaPublicoDTO = {
    id: e.id,
    nome: e.nome,
    especialidade: e.especialidade,
    crm: e.crm,
    imagem: e.imagem,
    estaAtivo: e.estaAtivo,
    possuiPlanoSaude: e.possuiPlanoSaude,
    planosSaude: planosComoLista(e.planosSaude),
    avaliacoes: resumirAvaliacoes(e.avaliacoes)
  }
  if (e.endereco != null) dto.endereco = { estado: e.endereco.estado }
  return dto
}

export function paraEspecialistaAdmin (e: Especialista): EspecialistaAdminDTO {
  const { endereco: _endereco, ...base } = paraEspecialistaPublico(e)
  const dto: EspecialistaAdminDTO = { ...base, email: e.email, telefone: e.telefone }
  if (e.endereco != null) dto.endereco = paraEnderecoResposta(e.endereco)
  return dto
}
