/**
 * Teste de segurança: BOLA e mass assignment em /consulta.
 * Middleware de autenticação e JWT reais; banco, Redis e regras de agenda mockados.
 */
import { jest } from '@jest/globals'
import express from 'express'
import 'express-async-errors'
import request from 'supertest'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

const ID_ANA = '11111111-1111-1111-1111-111111111111'
const ID_BRUNO = '22222222-2222-2222-2222-222222222222'
const ID_DRA_LIA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ID_DR_MAX = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const ID_CLINICA = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const CONSULTA_ANA = 'c0000000-0000-0000-0000-00000000000a'
const CONSULTA_BRUNO = 'c0000000-0000-0000-0000-00000000000b'

let consultas: any[] = []
const save = jest.fn(async (_entidade: unknown, obj: any) => obj)
const remove = jest.fn(async () => ({}))
const find = jest.fn(async (_entidade: unknown, opcoes: any = {}) => {
  const { paciente, especialista } = opcoes.where ?? {}
  return consultas.filter((c) =>
    (paciente === undefined || c.paciente.id === paciente.id) &&
    (especialista === undefined || c.especialista.id === especialista.id))
})
const findOne = jest.fn(async (_entidade: unknown, opcoes: any) =>
  consultas.find((c) => c.id === opcoes?.where?.id) ?? null)

jest.unstable_mockModule('../../data-source.js', () => ({
  AppDataSource: { manager: { save, find, findOne, delete: remove } }
}))
jest.unstable_mockModule('../../services/redis/redisClient.js', () => ({
  default: class {
    async contemChave (): Promise<boolean> { return false }
    async adiciona (): Promise<void> {}
    async buscaValor (): Promise<null> { return null }
    async deleta (): Promise<void> {}
  }
}))
// Regras de agenda (horário, disponibilidade) não são o alvo deste teste
jest.unstable_mockModule('../../consultas/consultaValidacoes.js', () => ({
  validaClinicaEstaAberta: () => true,
  validaAntecedenciaMinima: () => true,
  estaAtivoPaciente: async () => true,
  estaAtivoEspecialista: async () => true,
  pacienteEstaDisponivel: async () => true,
  especialistaEstaDisponivel: async () => true
}))

const { consultaRouter } = await import('../../consultas/consultaRoutes.js')
const { access } = await import('../../auth/tokens.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

const app = express()
app.use(express.json())
app.use('/consulta', consultaRouter)
app.use(errorMiddleware)

const auth = (id: string, role: string) => ({ Authorization: `Bearer ${access.cria(id, role)}` })
const ana = auth(ID_ANA, 'PACIENTE')
const bruno = auth(ID_BRUNO, 'PACIENTE')
const draLia = auth(ID_DRA_LIA, 'ESPECIALISTA')
const drMax = auth(ID_DR_MAX, 'ESPECIALISTA')
const clinica = auth(ID_CLINICA, 'CLINICA')

const pacienteCompleto = (id: string, nome: string): any => ({
  id, nome, cpf: '78160552009', senha: 'hash-secreto', historico: ['asma'], role: 'PACIENTE'
})
const especialistaDe = (id: string): any => ({ id, nome: 'Dr', crm: '123' })

const novaConsulta = (id: string, paciente: any, especialista: any): any => ({
  id, paciente, especialista, data: new Date('2030-01-07T10:00:00Z'), desejaLembrete: false, lembretes: []
})

const corpoValido = { especialista: ID_DRA_LIA, data: '2030-01-07T10:00:00.000Z', desejaLembrete: false }

beforeEach(() => {
  consultas = [
    novaConsulta(CONSULTA_ANA, pacienteCompleto(ID_ANA, 'Ana'), especialistaDe(ID_DRA_LIA)),
    novaConsulta(CONSULTA_BRUNO, pacienteCompleto(ID_BRUNO, 'Bruno'), especialistaDe(ID_DR_MAX))
  ]
  for (const mock of [save, remove, find, findOne]) mock.mockClear()
})

describe('/consulta - toda rota exige autenticação', () => {
  it.each([
    ['POST /', 'post', '/consulta', corpoValido],
    ['GET /', 'get', '/consulta', undefined],
    ['GET /:id', 'get', `/consulta/${CONSULTA_ANA}`, undefined],
    ['DELETE /:id', 'delete', `/consulta/${CONSULTA_ANA}`, undefined]
  ] as const)('%s sem token -> 403 e sem acesso ao banco', async (_nome, metodo, caminho, corpo) => {
    const req = request(app)[metodo](caminho)
    const res = await (corpo !== undefined ? req.send(corpo) : req)

    expect(res.status).toBe(403)
    expect(find).not.toHaveBeenCalled()
    expect(findOne).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('perfil GUEST não acessa nada', async () => {
    const res = await request(app).get('/consulta').set(auth(ID_ANA, 'GUEST'))

    expect(res.status).toBe(403)
  })
})

describe('POST /consulta - agendamento', () => {
  it.each([['ESPECIALISTA'], ['CLINICA']])('perfil %s não agenda por este endpoint', async (role) => {
    const res = await request(app).post('/consulta').set(auth(ID_ANA, role)).send(corpoValido)

    expect(res.status).toBe(403)
    expect(save).not.toHaveBeenCalled()
  })

  it('agenda SEMPRE para o dono do token, mesmo que o corpo aponte outro paciente', async () => {
    const res = await request(app).post('/consulta').set(ana).send({ ...corpoValido, paciente: ID_BRUNO })

    expect(res.status).toBe(200)
    const gravada = save.mock.calls[0][1]
    expect(gravada.paciente.id).toBe(ID_ANA)
    expect(gravada.paciente.id).not.toBe(ID_BRUNO)
  })

  it('ignora campos fora do contrato (id, motivoCancelamento, role)', async () => {
    await request(app).post('/consulta').set(ana).send({
      ...corpoValido, id: CONSULTA_BRUNO, motivoCancelamento: 'x', role: 'CLINICA'
    })

    const gravada = save.mock.calls[0][1]
    expect(gravada.id).toBeUndefined()
    expect(gravada.motivoCancelamento).toBeUndefined()
    expect(gravada.role).toBeUndefined()
  })

  it.each([
    ['sem especialista', { especialista: undefined }],
    ['data inválida', { data: 'amanha-cedo' }],
    ['especialista com tipo errado', { especialista: { $ne: null } }],
    ['lembretes fora do formato', { desejaLembrete: true, lembretes: ['x'] }]
  ])('rejeita com 400 e não grava: %s', async (_caso, invalido) => {
    const res = await request(app).post('/consulta').set(ana).send({ ...corpoValido, ...invalido })

    expect(res.status).toBe(400)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('GET /consulta - cada um vê só o que é seu', () => {
  it('paciente vê apenas as próprias consultas', async () => {
    const res = await request(app).get('/consulta').set(ana)

    expect(res.status).toBe(200)
    expect(res.body.map((c: any) => c.id)).toEqual([CONSULTA_ANA])
  })

  it('outro paciente não vê as consultas da Ana', async () => {
    const res = await request(app).get('/consulta').set(bruno)

    expect(res.body.map((c: any) => c.id)).toEqual([CONSULTA_BRUNO])
  })

  it('especialista vê apenas as consultas em que atende', async () => {
    const res = await request(app).get('/consulta').set(draLia)

    expect(res.body.map((c: any) => c.id)).toEqual([CONSULTA_ANA])
  })

  it('clínica vê todas', async () => {
    const res = await request(app).get('/consulta').set(clinica)

    expect(res.body).toHaveLength(2)
  })

  it('o paciente embutido na consulta traz só id e nome (sem cpf, senha, historico)', async () => {
    const res = await request(app).get('/consulta').set(clinica)

    for (const consulta of res.body) {
      expect(Object.keys(consulta.paciente).sort()).toEqual(['id', 'nome'])
    }
    expect(JSON.stringify(res.body)).not.toContain('hash-secreto')
    expect(JSON.stringify(res.body)).not.toContain('78160552009')
  })
})

describe('GET /consulta/:id - BOLA', () => {
  it('troca de id: outro paciente recebe a MESMA resposta de "não existe"', async () => {
    const alheia = await request(app).get(`/consulta/${CONSULTA_ANA}`).set(bruno)
    const inexistente = await request(app).get('/consulta/id-que-nao-existe').set(bruno)

    expect(alheia.status).toBe(inexistente.status)
    expect(alheia.body).toEqual(inexistente.body)
    expect(JSON.stringify(alheia.body)).not.toContain('Ana')
  })

  it('especialista que não atende essa consulta também não vê', async () => {
    const res = await request(app).get(`/consulta/${CONSULTA_ANA}`).set(drMax)

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).not.toContain('Ana')
  })

  it.each([
    ['o próprio paciente', ana],
    ['o especialista da consulta', draLia],
    ['a clínica', clinica]
  ])('%s consegue ver', async (_quem, cabecalho) => {
    const res = await request(app).get(`/consulta/${CONSULTA_ANA}`).set(cabecalho)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(CONSULTA_ANA)
    expect(res.body.paciente.cpf).toBeUndefined()
  })
})

describe('DELETE /consulta/:id - BOLA', () => {
  it('outro paciente NÃO cancela a consulta da Ana', async () => {
    const res = await request(app).delete(`/consulta/${CONSULTA_ANA}`).set(bruno)

    expect(res.status).toBe(400)
    expect(remove).not.toHaveBeenCalled()
  })

  it('especialista de outra consulta NÃO cancela', async () => {
    const res = await request(app).delete(`/consulta/${CONSULTA_ANA}`).set(drMax)

    expect(res.status).toBe(400)
    expect(remove).not.toHaveBeenCalled()
  })

  it.each([
    ['o próprio paciente', ana],
    ['o especialista da consulta', draLia],
    ['a clínica', clinica]
  ])('%s consegue cancelar', async (_quem, cabecalho) => {
    const res = await request(app).delete(`/consulta/${CONSULTA_ANA}`).set(cabecalho)

    expect(res.status).toBe(200)
    expect(remove).toHaveBeenCalledWith(expect.anything(), { id: CONSULTA_ANA })
  })
})
