import { type Request, type Response } from 'express'
import { AppDataSource } from '../data-source.js'
import { IsNull } from 'typeorm'
import { Consulta } from './consultaEntity.js'
import { type Especialista } from '../especialistas/EspecialistaEntity.js'
import { type Paciente } from '../pacientes/pacienteEntity.js'
import {
  estaAtivoEspecialista,
  estaAtivoPaciente,
  validaAntecedenciaMinima,
  validaClinicaEstaAberta,
  pacienteEstaDisponivel,
  especialistaEstaDisponivel
} from './consultaValidacoes.js'
import { mapeiaLembretes } from '../utils/consultaUtils.js'
import { AppError, Status } from '../error/ErrorHandler.js'
import { type CancelarConsultaDTO, type CriarConsultaDTO, motivoPadraoDoPerfil, paraConsultaResposta } from './consultaDto.js'
import { filtroDeListagem, podeAcessarConsulta } from './consultaAcesso.js'

export const criaConsulta = async (
  req: Request,
  res: Response
): Promise<Response> => {
  // req.body já passou por validaCorpo(contratoCriarConsulta)
  const { especialista, data, desejaLembrete, lembretes } = req.body as CriarConsultaDTO
  // O paciente é sempre quem está logado: ninguém agenda em nome de outro
  const paciente = req.userId as string

  if (!validaClinicaEstaAberta(data)) {
    throw new AppError('A clinica não está aberta nesse horário')
  }

  if (!validaAntecedenciaMinima(data, 30)) {
    throw new AppError(
      'A consulta deve ser agendada com 30 minutos de antecedência', Status.BAD_REQUEST
    )
  }
  const situacaoPaciente = await estaAtivoPaciente(paciente)
  if (!situacaoPaciente) {
    throw new AppError('Paciente não está ativo', Status.BAD_REQUEST)
  }

  const situacaoEspecialista = await estaAtivoEspecialista(especialista)

  if (!situacaoEspecialista) {
    throw new AppError('Especialista não está ativo', Status.BAD_REQUEST)
  }

  if (!(await pacienteEstaDisponivel(paciente, data))) {
    throw new AppError('Paciente não está disponível nesse horário', Status.BAD_REQUEST)
  }

  if (!(await especialistaEstaDisponivel(especialista, data))) {
    throw new AppError('Paciente não está disponível nesse horário', Status.BAD_REQUEST)
  }

  const consulta = new Consulta()

  consulta.especialista = { id: especialista } as Especialista
  consulta.paciente = { id: paciente } as Paciente
  consulta.data = data
  consulta.desejaLembrete = desejaLembrete ?? false

  if (desejaLembrete === true && lembretes !== undefined) {
    consulta.lembretes = mapeiaLembretes(lembretes)
  }
  await AppDataSource.manager.save(Consulta, consulta)
  return res.json(consulta)
}

export const listaConsultas = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const where = filtroDeListagem(req.userId, req.userRole)
  if (where === null) {
    throw new AppError('Não autorizado', Status.FORBIDDEN)
  }
  // consultas canceladas (lógicas) não aparecem mais nas listagens
  const consultas = await AppDataSource.manager.find(Consulta, { where: { ...where, canceladaEm: IsNull() } })

  return res.json(consultas.map(paraConsultaResposta))
}

//! Não devolve resposta ao cliente, caso não encontre a consulta
export const buscaConsultaPorId = async (req: Request, res: Response
): Promise<void> => {
  const { id } = req.params
  const consulta = await AppDataSource.manager.findOne(Consulta, { where: { id, canceladaEm: IsNull() }, relations: ['paciente', 'especialista'] })

  // Quem não participa da consulta recebe a mesma resposta de "não existe"
  if (consulta !== null && podeAcessarConsulta(consulta, req.userId, req.userRole)) {
    res.json(paraConsultaResposta(consulta))
  } else {
    throw new AppError('Consulta não encontrada', Status.BAD_REQUEST)
  }
}

export const deletaConsulta = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params
  // req.body já passou por validaCorpo(contratoCancelarConsulta)
  const { motivoCancelamento } = req.body as CancelarConsultaDTO
  // já cancelada = para o cliente é como se não existisse (mesma resposta de antes, quando a linha era apagada)
  const consulta = await AppDataSource.manager.findOne(Consulta, {
    where: { id, canceladaEm: IsNull() }
  })

  if (consulta == null || !podeAcessarConsulta(consulta, req.userId, req.userRole)) {
    throw new AppError('Consulta não encontrada')
  }

  const HORA = 60 * 24
  if (!validaAntecedenciaMinima(consulta.data, HORA)) {
    throw new AppError(
      'A consulta deve ser desmarcada com 1 dia de antecedência'
    )
  }

  // Cancelamento lógico: preserva a linha (histórico e relatórios de gestão)
  consulta.cancelar(motivoCancelamento ?? motivoPadraoDoPerfil(req.userRole))
  await AppDataSource.manager.save(Consulta, consulta)
  res.json('Consulta cancelada com sucesso')
}
