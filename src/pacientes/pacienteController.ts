// import { type Request, type Response } from 'express'
import { Request, Response } from 'express';
import { IsNull } from 'typeorm'
import { Paciente } from './pacienteEntity.js'
import { AppDataSource } from '../data-source.js'
import { Endereco } from '../enderecos/enderecoEntity.js'
import { CPFValido } from './validacaoCPF.js'
import { mapeiaPlano } from '../utils/planoSaudeUtils.js'
import { Consulta } from '../consultas/consultaEntity.js'
import { AppError, Status } from '../error/ErrorHandler.js'
import { encryptPassword } from '../utils/senhaUtils.js'
import {
  type AtualizarPacienteDTO,
  type CriarPacienteDTO,
  type EnderecoDTO,
  paraPacienteResposta,
  paraPacienteResumo
} from './pacienteDto.js'

export const consultaPorPaciente = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userInput } = req.query;
  const query = `SELECT id, nome FROM paciente WHERE nome = ?`;
  try {
    const listaPacientes = await AppDataSource.manager.query(query, [userInput]);
    if (listaPacientes.length === 0) {
      res.status(404).json('Paciente não encontrado!');
    } else {
      res.status(200).json(listaPacientes.map(paraPacienteResumo));
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
}


export const criarPaciente = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // req.body já passou por validaCorpo(contratoCriarPaciente): allowlist,
    // sanitização e validação (ver pacienteContratos.ts)
    const {
      cpf,
      nome,
      email,
      senha,
      possuiPlanoSaude,
      endereco,
      telefone,
      planosSaude,
      imagemUrl,
      historico
    } = req.body as CriarPacienteDTO

    // Definidos pelo servidor, nunca pelo cliente
    const estaAtivo = true
    const imagem = undefined

    if (!CPFValido(cpf)) {
      throw new AppError('CPF Inválido!')
    }

    const existePacienteComCPF = await AppDataSource.getRepository(Paciente).findOne({
      where: { cpf }
    })
    if (existePacienteComCPF != null) {
      res.status(409).json({ message: 'Já existe um paciente com esse CPF!' })
    }

    let nomesPlanosSaude: string[] | undefined
    if (possuiPlanoSaude === true && planosSaude !== undefined) {
      // transforma array de numbers em array de strings com os nomes dos planos definidos no enum correspondente
      nomesPlanosSaude = mapeiaPlano(planosSaude)
    }

    const senhaCriptografada = encryptPassword(senha)
    const paciente = new Paciente(
      cpf,
      nome,
      email,
      senhaCriptografada,
      telefone,
      nomesPlanosSaude,
      estaAtivo,
      imagemUrl,
      imagem,
      historico
    )
    paciente.possuiPlanoSaude = possuiPlanoSaude
    const enderecoPaciente = new Endereco()

    if (endereco !== undefined) {
      enderecoPaciente.cep = Number.parseInt(endereco.cep, 10)
      enderecoPaciente.rua = endereco.rua
      enderecoPaciente.estado = endereco.estado
      enderecoPaciente.numero = endereco.numero
      enderecoPaciente.complemento = endereco.complemento

      paciente.endereco = enderecoPaciente

      await AppDataSource.manager.save(Endereco, enderecoPaciente)
    }

    await AppDataSource.manager.save(Paciente, paciente)

    res.status(202).json(paraPacienteResposta(paciente))
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.getStatusCode()).json({ message: error.getMessage() })
    } else {
      // não devolve o objeto de erro ao cliente (stack, SQL, caminhos)
      console.log(error)
      res.status(502).json({ message: 'Paciente não foi criado' })
    }
  }
}

export const exibeTodosPacientes = async (
  req: Request,
  res: Response
): Promise<void> => {
  const tabelaPaciente = AppDataSource.getRepository(Paciente)
  const allPacientes = await tabelaPaciente.find({ select: { id: true, nome: true } })
  res.status(200).json(allPacientes.map(paraPacienteResumo))
}

export const lerPaciente = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params
  const paciente = await AppDataSource.manager.findOne(Paciente, {
    where: { id },
    relations: {
      endereco: true,
      imagem: true
    }
  })

  if (paciente === null) {
    res.status(404).json('Paciente não encontrado!')
  } else {
    res.status(200).json(paraPacienteResposta(paciente))
  }
}

export const listaConsultasPaciente = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params
  const paciente = await AppDataSource.manager.findOne(Paciente, {
    where: { id }
  })
  if (paciente == null) {
    throw new AppError('Paciente não encontrado!', Status.NOT_FOUND)
  }
  const consultas = await AppDataSource.manager.find(Consulta, {
    where: { paciente: { id: paciente.id }, canceladaEm: IsNull() }
  })

  const consultadasTratadas = consultas.map((consulta) => {
    return {
      id: consulta.id,
      data: consulta.data,
      desejaLembrete: consulta.desejaLembrete,
      lembretes: consulta.lembretes,
      especialista: consulta.especialista
    }
  })

  return res.json(consultadasTratadas)
}

// update
export const atualizarPaciente = async (
  req: Request,
  res: Response
): Promise<void> => {
  // req.body já passou por validaCorpo(contratoAtualizarPaciente): só campos
  // editáveis pelo dono (sem cpf, senha, role, estaAtivo ou imagem)
  const {
    nome,
    email,
    telefone,
    possuiPlanoSaude,
    planosSaude,
    imagemUrl,
    historico
  } = req.body as AtualizarPacienteDTO

  const { id } = req.params

  // transforma array de numbers em array de strings com os nomes dos planos definidos no enum correspondente
  const nomesPlanosSaude = possuiPlanoSaude && planosSaude !== undefined
    ? mapeiaPlano(planosSaude)
    : undefined

  try {
    const paciente = await AppDataSource.manager.findOne(Paciente, {
      where: { id },
      relations: ['endereco']
    })

    if (paciente === null) {
      res.status(404).json('Paciente não encontrado!')
    } else {
      paciente.nome = nome
      paciente.email = email
      paciente.possuiPlanoSaude = possuiPlanoSaude
      paciente.telefone = telefone
      if (nomesPlanosSaude !== undefined) paciente.planosSaude = nomesPlanosSaude
      else if (!possuiPlanoSaude) paciente.planosSaude = []
      if (imagemUrl !== undefined) paciente.imagemUrl = imagemUrl
      if (historico !== undefined) paciente.historico = historico

      await AppDataSource.manager.save(Paciente, paciente)
      res.status(200).json(paraPacienteResposta(paciente))
    }
  } catch (error) {
    console.log(error)
    res.status(502).json('Paciente não foi atualizado!')
  }
}

export const atualizarEnderecoPaciente = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params
  // req.body já passou por validaCorpo(contratoAtualizarEndereco)
  const { cep, rua, numero, estado, complemento } = req.body as EnderecoDTO
  const cepNumerico = Number.parseInt(cep, 10)
  const paciente = await AppDataSource.manager.findOne(Paciente, {
    where: { id },
    relations: ['endereco']
  })

  if (paciente === null) {
    res.status(404).json('Paciente não encontrado!')
  } else {
    if (paciente.endereco === null) {
      const endereco = new Endereco()
      endereco.cep = cepNumerico
      endereco.rua = rua
      endereco.estado = estado
      endereco.numero = numero
      endereco.complemento = complemento

      paciente.endereco = endereco

      await AppDataSource.manager.save(Endereco, endereco)
    } else {
      paciente.endereco.cep = cepNumerico
      paciente.endereco.rua = rua
      paciente.endereco.estado = estado
      paciente.endereco.numero = numero
      paciente.endereco.complemento = complemento
    }

    await AppDataSource.manager.save(Paciente, paciente)

    res.status(200).json(paraPacienteResposta(paciente))
  }
}

// Não deleta o paciente, fica inativo
export const desativaPaciente = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params
  const paciente = await AppDataSource.manager.findOne(Paciente, {
    where: { id }
  })

  if (paciente === null) {
    res.status(404).json('Paciente não encontrado!')
  } else {
    paciente.estaAtivo = false
    // await AppDataSource.manager.save(Paciente, paciente)

    //! Caso deseje deletar o paciente, basta descomentar a linha abaixo
    await AppDataSource.manager.delete(Paciente, { id: paciente.id })
    res.json({
      message: 'Paciente desativado!'
    })
  }
}
