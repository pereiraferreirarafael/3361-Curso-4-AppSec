import { type Request, type Response } from 'express'
import { IsNull, LessThan } from 'typeorm'
import { AppDataSource } from '../data-source.js'
import { Avaliacoes } from './avaliacoesEntity.js'
import { Consulta } from '../consultas/consultaEntity.js'
import { Paciente } from '../pacientes/pacienteEntity.js'
import { Especialista } from '../especialistas/EspecialistaEntity.js'
import { AppError, Status } from '../error/ErrorHandler.js'
import { type CriarAvaliacaoDTO, paraAvaliacaoResposta } from './avaliacoesDto.js'

const LIMITE_PADRAO = 50
const LIMITE_MAXIMO = 100

/** Inteiro positivo dentro do intervalo; qualquer outra coisa (texto, array, negativo) vira o padrão. */
const inteiroEntre = (valor: unknown, padrao: number, maximo: number): number => {
  const n = typeof valor === 'string' && /^\d{1,6}$/.test(valor) ? Number(valor) : NaN
  return Number.isInteger(n) && n >= 1 ? Math.min(n, maximo) : padrao
}

/** GET /avaliacoes?limite=50&pagina=1 - mais recentes primeiro; no máximo 100 por página. */
export const listaAvaliacoes = async (req: Request, res: Response): Promise<void> => {
  const limite = inteiroEntre(req.query.limite, LIMITE_PADRAO, LIMITE_MAXIMO)
  const pagina = inteiroEntre(req.query.pagina, 1, 100_000)

  const avaliacoes = await AppDataSource.manager.find(Avaliacoes, {
    order: { createdAt: 'DESC' },
    take: limite,
    skip: (pagina - 1) * limite
  })
  res.json(avaliacoes.map(paraAvaliacaoResposta))
}

/**
 * POST /avaliacoes (req.body já passou por validaCorpo(contratoCriarAvaliacao)).
 * Regras de integridade, para a nota não ser manipulável:
 *  - o autor é sempre o paciente do token;
 *  - só avalia quem já teve uma consulta (não cancelada, já realizada) com o especialista;
 *  - uma avaliação por paciente e especialista.
 */
export const criaAvaliacao = async (req: Request, res: Response): Promise<void> => {
  const { idEspecialista, descricao, nota } = req.body as CriarAvaliacaoDTO
  const idPaciente = req.userId as string

  const especialista = await AppDataSource.manager.findOneBy(Especialista, { id: idEspecialista })
  const paciente = await AppDataSource.manager.findOneBy(Paciente, { id: idPaciente })

  if (especialista === null || paciente === null) {
    throw new AppError('Especialista ou Paciente não encontrado', Status.NOT_FOUND)
  }
  if (!paciente.estaAtivo) {
    throw new AppError('Conta desativada!', Status.FORBIDDEN)
  }

  const consultasRealizadas = await AppDataSource.manager.count(Consulta, {
    where: {
      paciente: { id: idPaciente },
      especialista: { id: idEspecialista },
      canceladaEm: IsNull(),
      data: LessThan(new Date())
    }
  })
  if (consultasRealizadas === 0) {
    throw new AppError('Só é possível avaliar um especialista com quem você já realizou uma consulta', Status.FORBIDDEN)
  }

  const jaAvaliou = await AppDataSource.manager.count(Avaliacoes, {
    where: { paciente: { id: idPaciente }, especialista: { id: idEspecialista } }
  })
  if (jaAvaliou > 0) {
    throw new AppError('Você já avaliou este especialista', Status.CONFLICT)
  }

  const avaliacao = new Avaliacoes()
  avaliacao.especialista = especialista
  avaliacao.paciente = paciente
  avaliacao.nota = nota
  avaliacao.descricao = descricao as string

  await AppDataSource.manager.save(avaliacao)
  res.json({ id: avaliacao.id, nota: avaliacao.nota, descricao: avaliacao.descricao })
}
