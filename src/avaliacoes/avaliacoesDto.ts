import { type Avaliacoes } from './avaliacoesEntity.js'

/**
 * Único contrato aceito em POST /avaliacoes.
 * O paciente NÃO faz parte dele: é sempre o dono do token. Antes o corpo trazia `idPaciente`,
 * e qualquer pessoa, sem login, avaliava em nome de qualquer paciente.
 */
export interface CriarAvaliacaoDTO {
  idEspecialista: string
  nota: number
  descricao?: string
}

export function filtrarCamposAvaliacao (corpo: unknown): Partial<CriarAvaliacaoDTO> {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return {}

  const dto: Record<string, unknown> = {}
  for (const chave of ['idEspecialista', 'nota', 'descricao']) {
    if (Object.prototype.hasOwnProperty.call(corpo, chave)) dto[chave] = (corpo as Record<string, unknown>)[chave]
  }
  return dto as Partial<CriarAvaliacaoDTO>
}

/** Avaliação pública: sem identificar quem avaliou (pacienteId ligaria o paciente ao médico). */
export interface AvaliacaoRespostaDTO {
  id: string
  nota: number
  descricao: string | null
  createdAt: Date
  especialistaId: string
}

export function paraAvaliacaoResposta (avaliacao: Avaliacoes): AvaliacaoRespostaDTO {
  return {
    id: avaliacao.id,
    nota: avaliacao.nota,
    descricao: avaliacao.descricao ?? null,
    createdAt: avaliacao.createdAt,
    especialistaId: avaliacao.especialistaId
  }
}
