/**
 * Integração (banco SQLite em memória, entidades e controllers reais):
 * DELETE /paciente/:id DESATIVA em vez de apagar, e o login passa a ser negado.
 */
import { jest } from '@jest/globals'
import express from 'express'
import 'express-async-errors'
import request from 'supertest'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

const { criaBancoEmMemoria, limpaBanco } = await import('../helpers/bancoEmMemoria.js')
const { criaFabrica, emDias, SENHA_PADRAO } = await import('../helpers/fabrica.js')
const bd = await criaBancoEmMemoria()

const adicionaNaBlocklist = jest.fn(async (..._args: any[]) => {})
jest.unstable_mockModule('../../data-source.js', () => ({ AppDataSource: bd }))
jest.unstable_mockModule('../../services/redis/redisClient.js', () => ({
  default: class {
    async contemChave (): Promise<boolean> { return false }
    adiciona = adicionaNaBlocklist
    async buscaValor (): Promise<null> { return null }
    async deleta (): Promise<void> {}
  }
}))
jest.unstable_mockModule('cep-promise', () => ({ default: async (cep: string) => ({ cep }) }))
jest.unstable_mockModule('../../pacientes/PacienteImagemController.js', () => ({
  criaImagem: jest.fn(), destroiImagem: jest.fn(), listaImagemPaciente: jest.fn()
}))

const { pacienteRouter } = await import('../../pacientes/pacienteRoutes.js')
const { authRouter } = await import('../../auth/authRoutes.js')
const { access } = await import('../../auth/tokens.js')
const { cancelarConsultasFuturas } = await import('../../consultas/consultaCancelamento.js')
const { Paciente } = await import('../../pacientes/pacienteEntity.js')
const { Consulta } = await import('../../consultas/consultaEntity.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

const app = express()
app.use(express.json())
app.use('/paciente', pacienteRouter)
app.use('/auth', authRouter)
app.use(errorMiddleware)

let fabrica: Awaited<ReturnType<typeof criaFabrica>>
const token = (id: string) => ({ Authorization: `Bearer ${access.cria(id, 'PACIENTE')}` })
const login = async (email: string, senha: string) => await request(app).post('/auth/login').send({ email, senha })
const consultaNoBanco = async (id: string): Promise<any> => await bd.manager.findOne(Consulta, { where: { id } })
const pacienteNoBanco = async (id: string): Promise<any> => await bd.manager.findOne(Paciente, { where: { id } })

beforeEach(async () => {
  await limpaBanco(bd)
  fabrica = await criaFabrica(bd)
  adicionaNaBlocklist.mockClear()
})
afterAll(async () => { await bd.destroy() })

describe('DELETE /paciente/:id - desativa, não apaga', () => {
  it('sanity: antes de desativar, o paciente consegue fazer login', async () => {
    const ana = await fabrica.paciente()

    const res = await login(ana.email, SENHA_PADRAO)

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeDefined()
  })

  it('o cadastro continua no banco, com os dados intactos, só com estaAtivo=false', async () => {
    const ana = await fabrica.paciente()
    const antes = await pacienteNoBanco(ana.id)

    const res = await request(app).delete(`/paciente/${ana.id}`).set(token(ana.id))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Paciente desativado!' })
    const depois = await pacienteNoBanco(ana.id)
    expect(depois).not.toBeNull()
    expect(depois.estaAtivo).toBe(false)
    // tudo o mais igual ao que era (inclusive o histórico clínico)
    expect({ ...depois, estaAtivo: true }).toEqual(antes)
  })

  it('NÃO apaga mesmo havendo consultas ligadas a ele (antes quebrava por chave estrangeira)', async () => {
    const ana = await fabrica.paciente()
    const lia = await fabrica.especialista()
    await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(-10), canceladaEm: new Date(), motivo: 'outros' })

    const res = await request(app).delete(`/paciente/${ana.id}`).set(token(ana.id))

    expect(res.status).toBe(200)
    expect(await bd.manager.count(Consulta)).toBe(1)
  })

  it('cancela as consultas FUTURAS dele e preserva o resto', async () => {
    const ana = await fabrica.paciente()
    const bruno = await fabrica.paciente()
    const lia = await fabrica.especialista()
    const futura = await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(3) })
    const passada = await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(-3) })
    const jaCancelada = await fabrica.consulta({ paciente: ana, especialista: lia, data: emDias(4), canceladaEm: new Date('2026-01-01'), motivo: 'outros' })
    const doBruno = await fabrica.consulta({ paciente: bruno, especialista: lia, data: emDias(3) })

    await request(app).delete(`/paciente/${ana.id}`).set(token(ana.id))

    const f = await consultaNoBanco(futura.id)
    expect(f.canceladaEm).not.toBeNull()
    expect(f.motivoCancelamento).toBe('paciente_desistiu')
    expect((await consultaNoBanco(passada.id)).canceladaEm).toBeNull() // já aconteceu: histórico intacto
    const c = await consultaNoBanco(jaCancelada.id)
    expect(c.motivoCancelamento).toBe('outros') // não sobrescreve cancelamento anterior
    expect((await consultaNoBanco(doBruno.id)).canceladaEm).toBeNull() // de outro paciente: intocada
  })

  it('depois de desativado, o login (com a senha correta) é negado com 403', async () => {
    const ana = await fabrica.paciente()
    await request(app).delete(`/paciente/${ana.id}`).set(token(ana.id))

    const res = await login(ana.email, SENHA_PADRAO)

    expect(res.status).toBe(403)
    expect(res.body.message).toBe('Conta desativada!')
    expect(res.body.accessToken).toBeUndefined()
  })

  it('senha errada continua dando 401: o estado da conta só é revelado a quem sabe a senha', async () => {
    const ana = await fabrica.paciente()
    await request(app).delete(`/paciente/${ana.id}`).set(token(ana.id))

    const res = await login(ana.email, 'senha-errada')

    expect(res.status).toBe(401)
  })

  it('invalida na hora o access token usado na requisição', async () => {
    const ana = await fabrica.paciente()
    const cabecalho = token(ana.id)

    await request(app).delete(`/paciente/${ana.id}`).set(cabecalho)

    expect(adicionaNaBlocklist).toHaveBeenCalledTimes(1)
    expect(adicionaNaBlocklist.mock.calls[0][0]).toBe(cabecalho.Authorization.split(' ')[1])
  })

  it('é idempotente: desativar de novo responde 200 sem alterar nada', async () => {
    const ana = await fabrica.paciente()
    await request(app).delete(`/paciente/${ana.id}`).set(token(ana.id))
    const depoisDoPrimeiro = await pacienteNoBanco(ana.id)

    const segunda = await request(app).delete(`/paciente/${ana.id}`).set(token(ana.id))

    expect(segunda.status).toBe(200)
    expect(await pacienteNoBanco(ana.id)).toEqual(depoisDoPrimeiro)
  })

  it('outro paciente NÃO desativa a conta da Ana (BOLA) e nada muda', async () => {
    const ana = await fabrica.paciente()
    const bruno = await fabrica.paciente()
    const futura = await fabrica.consulta({ paciente: ana, especialista: await fabrica.especialista(), data: emDias(3) })

    const res = await request(app).delete(`/paciente/${ana.id}`).set(token(bruno.id))

    expect(res.status).toBe(403)
    expect((await pacienteNoBanco(ana.id)).estaAtivo).toBe(true)
    expect((await consultaNoBanco(futura.id)).canceladaEm).toBeNull()
  })

  it('sem token -> 403 e nada muda', async () => {
    const ana = await fabrica.paciente()

    const res = await request(app).delete(`/paciente/${ana.id}`)

    expect(res.status).toBe(403)
    expect((await pacienteNoBanco(ana.id)).estaAtivo).toBe(true)
  })

  it('paciente desativado some das listagens públicas', async () => {
    const ana = await fabrica.paciente({ nome: 'Ana Ativa' })
    const bia = await fabrica.paciente({ nome: 'Bia Desativada' })
    await request(app).delete(`/paciente/${bia.id}`).set(token(bia.id))

    const lista = await request(app).get('/paciente')
    const porNome = await request(app).get('/paciente/consulta-por-paciente').query({ userInput: 'Bia Desativada' })

    expect(lista.body.map((p: any) => p.id)).toEqual([ana.id])
    expect(porNome.status).toBe(404)
  })
})

describe('cancelarConsultasFuturas - guarda contra cancelar tudo', () => {
  it('recusa chamada sem paciente nem especialista (cancelaria TODAS as consultas)', async () => {
    await expect(cancelarConsultasFuturas(bd.manager, {}, 'outros')).rejects.toThrow()
  })

  it('recusa chamada com os dois ao mesmo tempo', async () => {
    await expect(cancelarConsultasFuturas(bd.manager, { paciente: 'a', especialista: 'b' }, 'outros')).rejects.toThrow()
  })

  it('recusa filtro vazio ("")', async () => {
    await expect(cancelarConsultasFuturas(bd.manager, { paciente: '' }, 'outros')).rejects.toThrow()
  })
})
