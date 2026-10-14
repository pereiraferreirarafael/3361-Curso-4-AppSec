import { type Request, type Response } from 'express'
import { AppDataSource } from '../data-source.js'
import { Endereco } from '../enderecos/enderecoEntity.js'
import { Especialista } from '../especialistas/EspecialistaEntity.js'
import { paraEspecialistaAdmin } from '../especialistas/especialistaDto.js'
import { mapeiaPlano } from '../utils/planoSaudeUtils.js'
import { Clinica } from './clinicaEntity.js'
import { encryptPassword } from '../utils/senhaUtils.js'
import { emailEmUso, invalidaTokenDaRequisicao } from '../auth/contaUtils.js'
import { AppError, Status } from '../error/ErrorHandler.js'
import {
  paraClinicaPublica,
  paraClinicaResposta,
  type AtualizarClinicaDTO,
  type CriarClinicaDTO,
  type VincularEspecialistaDTO
} from './clinicaDto.js'
import { type EnderecoDTO } from '../pacientes/pacienteDto.js'

const aplicarEndereco = (destino: Endereco, origem: EnderecoDTO): void => {
  destino.cep = Number.parseInt(origem.cep, 10)
  destino.rua = origem.rua
  destino.estado = origem.estado
  destino.numero = origem.numero
  destino.complemento = origem.complemento
}

// req.body já passou por validaCorpo(contratoCriarClinica)
export const criarClinica = async (req: Request, res: Response): Promise<void> => {
  const { endereco, nome, email, senha, planoDeSaudeAceitos } = req.body as CriarClinicaDTO

  if (await emailEmUso(email)) {
    throw new AppError('E-mail já cadastrado', Status.CONFLICT)
  }

  const clinica = new Clinica()
  clinica.nome = nome
  clinica.email = email
  clinica.senha = encryptPassword(senha)
  if (planoDeSaudeAceitos !== undefined) {
    clinica.planoDeSaudeAceitos = mapeiaPlano(planoDeSaudeAceitos)
  }

  const enderecoClinica = new Endereco()
  aplicarEndereco(enderecoClinica, endereco)

  // endereço e clínica juntos: não sobra endereço órfão se a clínica falhar
  await AppDataSource.manager.transaction(async (manager) => {
    await manager.save(Endereco, enderecoClinica)
    clinica.endereco = enderecoClinica
    await manager.save(Clinica, clinica)
  })

  // antes devolvia a entidade inteira, com o hash da senha recém-gerado
  res.json(paraClinicaResposta(clinica))
}

export const listarClinicas = async (req: Request, res: Response): Promise<void> => {
  const clinicas = await AppDataSource.getRepository(Clinica).find({ relations: { endereco: true } })
  res.json(clinicas.map(paraClinicaPublica))
}

export const buscarClinica = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const clinica = await AppDataSource.manager.findOne(Clinica, {
    where: { id },
    relations: { endereco: true }
  })
  if (clinica === null) {
    throw new AppError('Clínica não encontrada', Status.NOT_FOUND)
  }
  res.json(paraClinicaPublica(clinica))
}

// req.body já passou por validaCorpo(contratoAtualizarClinica); o id já é o do token (somenteDono)
export const atualizarClinica = async (req: Request, res: Response): Promise<void> => {
  const { endereco, nome, email, planoDeSaudeAceitos } = req.body as AtualizarClinicaDTO
  const { id } = req.params

  const clinica = await AppDataSource.manager.findOne(Clinica, {
    where: { id },
    relations: { endereco: true }
  })
  if (clinica === null) {
    throw new AppError('Clínica não encontrada', Status.NOT_FOUND)
  }

  if (email !== undefined && email !== clinica.email && await emailEmUso(email, id)) {
    throw new AppError('E-mail já cadastrado', Status.CONFLICT)
  }

  if (nome !== undefined) clinica.nome = nome
  if (email !== undefined) clinica.email = email
  if (planoDeSaudeAceitos !== undefined) clinica.planoDeSaudeAceitos = mapeiaPlano(planoDeSaudeAceitos)

  await AppDataSource.manager.transaction(async (manager) => {
    if (endereco !== undefined) {
      const enderecoClinica = clinica.endereco ?? new Endereco()
      aplicarEndereco(enderecoClinica, endereco)
      await manager.save(Endereco, enderecoClinica)
      clinica.endereco = enderecoClinica
    }
    await manager.save(Clinica, clinica)
  })

  res.json(paraClinicaResposta(clinica))
}

/** Especialistas da clínica, com contato (visão do gestor, inclui os inativos). */
export const listaEspecialistasPorClinica = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params
  const especialistas = await AppDataSource.manager.find(Especialista, {
    where: { clinica: { id } },
    relations: { endereco: true }
  })
  return res.json(especialistas.map(paraEspecialistaAdmin))
}

/**
 * Vincula um especialista à clínica do token. Só aceita especialista SEM clínica (ou já
 * desta): antes qualquer um movia o especialista de qualquer clínica para outra.
 */
export const atualizaEspecialistaPeloIdDaClinica = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params
  const { especialistaId } = req.body as VincularEspecialistaDTO

  const especialista = await AppDataSource.manager.findOne(Especialista, {
    where: { id: especialistaId },
    relations: { clinica: true, endereco: true }
  })
  if (especialista === null) { return res.status(404).json({ message: 'Especialista não encontrado' }) }

  const clinica = await AppDataSource.manager.findOne(Clinica, { where: { id } })
  if (clinica === null) { return res.status(404).json({ message: 'Clinica não encontrada' }) }

  if (especialista.clinica != null && especialista.clinica.id !== clinica.id) {
    return res.status(409).json({ message: 'Especialista já vinculado a outra clínica' })
  }

  especialista.clinica = clinica
  await AppDataSource.manager.save(Especialista, especialista)
  return res.json(paraEspecialistaAdmin(especialista))
}

/** Não apaga clínica que ainda tem especialistas (ficariam sem clínica nem gestor). */
export const deletarClinica = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const clinica = await AppDataSource.manager.findOne(Clinica, {
    where: { id },
    relations: { endereco: true, especialistas: true }
  })
  if (clinica === null) {
    throw new AppError('Clínica não encontrada', Status.NOT_FOUND)
  }
  if (Array.isArray(clinica.especialistas) && clinica.especialistas.length > 0) {
    throw new AppError('Não é possível apagar uma clínica com especialistas vinculados', Status.CONFLICT)
  }

  const endereco = clinica.endereco
  await AppDataSource.manager.transaction(async (manager) => {
    await manager.remove(Clinica, clinica)
    if (endereco != null) await manager.remove(Endereco, endereco)
  })

  // a conta deixa de existir: o token usado não vale mais
  await invalidaTokenDaRequisicao(req)
  res.json({ message: 'Clinica apagada!' })
}
