/**
 * Teste de segurança: Mass Assignment em POST /paciente
 *
 * Um atacante envia, junto com um cadastro válido, campos que o cliente nunca
 * deveria controlar (role, isAdmin, id, relações). O teste inspeciona a entidade
 * que o controller entrega ao banco (`manager.save`) e a resposta HTTP.
 *
 * Convenção:
 *  - `it(...)`         -> proteção que HOJE funciona; se falhar, houve regressão.
 *  - `it.failing(...)` -> vulnerabilidade CONFIRMADA e ainda não corrigida. O teste
 *                         descreve o comportamento seguro esperado e "passa" enquanto
 *                         a falha existir. Ao corrigir o código ele passa a falhar:
 *                         remova o `.failing` e ele vira um teste de regressão normal.
 *
 * O banco, o Redis e a consulta de CEP são mockados: o teste é hermético.
 */
import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

const save = jest.fn(async (_entidade: unknown, obj: any) => obj)
const findOne = jest.fn(async () => null)

jest.unstable_mockModule('../../data-source.js', () => ({
  AppDataSource: {
    manager: { save, findOne },
    getRepository: () => ({ findOne })
  }
}))
// Evita conexão real com Redis ao importar o middleware de autenticação
jest.unstable_mockModule('../../auth/middlewares/authMiddlewares.js', () => ({
  verificaTokenJWT: () => (_req: any, _res: any, next: any) => next(),
  refreshMiddleware: async () => (_req: any, _res: any, next: any) => next()
}))
// Evita chamada de rede na validação de CEP
jest.unstable_mockModule('cep-promise', () => ({
  default: async (cep: string) => ({ cep })
}))
jest.unstable_mockModule('../../pacientes/PacienteImagemController.js', () => ({
  criaImagem: jest.fn(),
  destroiImagem: jest.fn(),
  listaImagemPaciente: jest.fn()
}))

const { pacienteRouter } = await import('../../pacientes/pacienteRoutes.js')

const app = express()
app.use(express.json())
app.use('/paciente', pacienteRouter)

const pacienteValido = {
  cpf: '78160552009',
  nome: 'Emerson Laranja',
  email: 'emerson@email.com',
  senha: 'Senh@forte123',
  telefone: '34999335522',
  possuiPlanoSaude: false,
  endereco: {
    cep: '01001000',
    rua: 'Praca da Se',
    estado: 'SP',
    numero: 1,
    complemento: 'Lado impar'
  }
}

/** Devolve o Paciente efetivamente enviado ao banco. */
const pacientePersistido = (): any => {
  const chamada = save.mock.calls.find(([entidade]) => (entidade as any)?.name === 'Paciente')
  return chamada?.[1]
}

const cadastrarComInjecao = async (camposInjetados: Record<string, unknown>) =>
  await request(app).post('/paciente').send({ ...pacienteValido, ...camposInjetados })

describe('POST /paciente - Mass Assignment (injeção de campos protegidos)', () => {
  beforeEach(() => {
    save.mockClear()
    findOne.mockClear()
  })

  it('sanity: o cadastro legítimo é aceito e persistido como PACIENTE', async () => {
    const res = await request(app).post('/paciente').send(pacienteValido)

    expect(res.status).toBe(202)
    expect(pacientePersistido()).toBeDefined()
    expect(pacientePersistido().role).toBe('PACIENTE')
  })

  it.each([
    ['ESPECIALISTA'],
    ['CLINICA'],
    ['ADMIN'],
    ['GUEST']
  ])('ignora role="%s" enviado pelo cliente (escalada de privilégio)', async (roleMalicioso) => {
    const res = await cadastrarComInjecao({ role: roleMalicioso })

    expect(res.status).toBe(202)
    expect(pacientePersistido().role).toBe('PACIENTE')
    expect(res.body.role).not.toBe(roleMalicioso)
  })

  it('ignora isAdmin / admin / permissoes (flags de privilégio)', async () => {
    const res = await cadastrarComInjecao({
      isAdmin: true,
      admin: true,
      permissoes: ['*'],
      roles: ['ADMIN']
    })

    expect(res.status).toBe(202)
    const persistido = pacientePersistido()
    expect(persistido.isAdmin).toBeUndefined()
    expect(persistido.admin).toBeUndefined()
    expect(persistido.permissoes).toBeUndefined()
    expect(persistido.roles).toBeUndefined()
    expect(res.body.isAdmin).toBeUndefined()
  })

  it('ignora id escolhido pelo atacante (sobrescrita de registro existente)', async () => {
    const idDaVitima = '11111111-2222-3333-4444-555555555555'
    const res = await cadastrarComInjecao({ id: idDaVitima })

    expect(res.status).toBe(202)
    expect(pacientePersistido().id).not.toBe(idDaVitima)
    expect(res.body.id).not.toBe(idDaVitima)
  })

  it('ignora role injetado via __proto__ (poluição de protótipo)', async () => {
    // JSON.parse cria "__proto__" como propriedade própria; enviamos o corpo cru.
    const corpo = JSON.stringify(pacienteValido).replace(
      /^\{/,
      '{"__proto__":{"role":"CLINICA","isAdmin":true},'
    )
    const res = await request(app)
      .post('/paciente')
      .set('Content-Type', 'application/json')
      .send(corpo)

    expect(res.status).toBe(202)
    expect(pacientePersistido().role).toBe('PACIENTE')
    expect(({} as any).isAdmin).toBeUndefined() // Object.prototype não foi poluído
  })

  it('não devolve senha nem CPF na resposta do cadastro', async () => {
    const res = await request(app).post('/paciente').send(pacienteValido)

    expect(res.body.senha).toBeUndefined()
    expect(res.body.cpf).toBeUndefined()
  })

  it('armazena a senha cifrada, nunca em texto puro', async () => {
    await request(app).post('/paciente').send(pacienteValido)

    expect(pacientePersistido().senha).not.toBe(pacienteValido.senha)
    expect(pacientePersistido().senha).toContain(':') // formato iv:cifrado
  })

  // ---------------------------------------------------------------------------
  // Vulnerabilidades confirmadas (ver pacienteController.criarPaciente)
  // ---------------------------------------------------------------------------

  // O controller repassa `imagem` do corpo ao construtor de Paciente e a relação
  // tem cascade: ['update']. O cliente consegue apontar para um registro de
  // imagem existente (de outro paciente) e alterá-lo.
  it.failing('NÃO deve aceitar a relação "imagem" enviada pelo cliente', async () => {
    const imagemInjetada = { id: 1, nome: 'x', tamanho: 1, key: 'k', url: 'http://atacante.exemplo/p.png' }
    const res = await cadastrarComInjecao({ imagem: imagemInjetada })

    expect(res.status).toBe(202)
    expect(pacientePersistido().imagem).toBeUndefined()
  })

  // `estaAtivo` é lido do corpo; o status do cadastro deveria ser decidido pelo servidor.
  it.failing('NÃO deve deixar o cliente definir "estaAtivo"', async () => {
    const res = await cadastrarComInjecao({ estaAtivo: false })

    expect(res.status).toBe(202)
    expect(pacientePersistido().estaAtivo).not.toBe(false)
  })

  // `historico` (dado clínico) é aceito sem qualquer validação no schema yup.
  it.failing('NÃO deve aceitar "historico" clínico sem validação no cadastro', async () => {
    const res = await cadastrarComInjecao({ historico: ['<script>alert(1)</script>'] })

    expect(res.status).toBe(400)
  })
})
