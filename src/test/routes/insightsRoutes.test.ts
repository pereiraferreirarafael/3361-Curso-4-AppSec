/**
 * GET /admin/insights: só o gestor da clínica, entrada validada, resultado em cache.
 * Middleware de autenticação e JWT reais; banco, Redis e LLM são falsos.
 */
import { jest } from '@jest/globals'
import express from 'express'
import 'express-async-errors'
import request from 'supertest'
import { type ProvedorLLM } from '../../insights/insightsLLM.js'
import { cenarioCardiologia } from '../insights/fixtures.js'

process.env.SECRET_KEY_CRYPTO = 'segredo-somente-para-teste'
process.env.SECRET_JWT = 'jwt-somente-para-teste'

jest.unstable_mockModule('../../data-source.js', () => ({ AppDataSource: { manager: { find: jest.fn() } } }))
jest.unstable_mockModule('../../services/redis/redisClient.js', () => ({
  default: class {
    async contemChave (): Promise<boolean> { return false }
    async adiciona (): Promise<void> {}
    async buscaValor (): Promise<null> { return null }
    async deleta (): Promise<void> {}
  }
}))

const { criaInsightsRouter } = await import('../../insights/insightsRoutes.js')
const { access } = await import('../../auth/tokens.js')
const { default: errorMiddleware } = await import('../../error/errorMiddleware.js')

let agora = new Date('2026-10-14T12:00:00Z')
const buscarRegistros = jest.fn(async (..._args: any[]) => cenarioCardiologia())
const gerarResumo = jest.fn(async (..._args: any[]) => 'Resumo da LLM.\nSugestão da LLM.')
const provedor: ProvedorLLM = { nome: 'falso', simulado: false, gerarResumo: gerarResumo as any }
const TTL = 60_000

const montaApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/admin', criaInsightsRouter({ provedor, buscarRegistros: buscarRegistros as any, agora: () => agora, ttlCacheMs: TTL }))
  app.use(errorMiddleware)
  return app
}

const auth = (role: string) => ({ Authorization: `Bearer ${access.cria('id-qualquer', role)}` })
const gestor = auth('CLINICA')
let app = montaApp()

beforeEach(() => {
  agora = new Date('2026-10-14T12:00:00Z')
  buscarRegistros.mockClear()
  gerarResumo.mockClear()
  app = montaApp() // cache novo a cada teste
})

describe('GET /admin/insights - acesso', () => {
  it('sem token -> 403, sem consultar dados nem LLM', async () => {
    const res = await request(app).get('/admin/insights')

    expect(res.status).toBe(403)
    expect(buscarRegistros).not.toHaveBeenCalled()
    expect(gerarResumo).not.toHaveBeenCalled()
  })

  it.each([['PACIENTE'], ['ESPECIALISTA'], ['GUEST']])('perfil %s -> 403', async (role) => {
    const res = await request(app).get('/admin/insights').set(auth(role))

    expect(res.status).toBe(403)
    expect(buscarRegistros).not.toHaveBeenCalled()
    expect(gerarResumo).not.toHaveBeenCalled()
  })

  it('o gestor da clínica recebe o resumo', async () => {
    const res = await request(app).get('/admin/insights').set(gestor)

    expect(res.status).toBe(200)
    expect(res.body.mes).toBe('2026-10')
    expect(res.body.origem).toBe('llm')
    expect(res.body.resumo).toEqual(['Resumo da LLM.', 'Sugestão da LLM.'])
    expect(res.body.metricas.totais.agendamentos).toBe(70)
  })

  it('o resumo nunca passa de 3 linhas, mesmo com a LLM verbosa', async () => {
    gerarResumo.mockResolvedValueOnce('1\n2\n3\n4\n5\n6')

    const res = await request(app).get('/admin/insights').set(gestor)

    expect(res.body.resumo).toHaveLength(3)
  })

  it('marca "Cache-Control: no-store" (dado de gestão)', async () => {
    const res = await request(app).get('/admin/insights').set(gestor)

    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('a resposta não contém dado pessoal', async () => {
    const res = await request(app).get('/admin/insights').set(gestor)

    for (const proibido of ['cpf', 'senha', 'email', 'telefone', 'paciente']) {
      expect(JSON.stringify(res.body)).not.toContain(proibido)
    }
  })
})

describe('GET /admin/insights - parâmetro "mes"', () => {
  it('sem "mes": usa o mês corrente e o rótulo "Este mês"', async () => {
    await request(app).get('/admin/insights').set(gestor)

    expect(gerarResumo.mock.calls[0][0].rotuloPeriodo).toBe('Este mês')
  })

  it('mês passado: rótulo "Em MM/AAAA" e período correto', async () => {
    const res = await request(app).get('/admin/insights?mes=2026-09').set(gestor)

    expect(res.status).toBe(200)
    expect(res.body.mes).toBe('2026-09')
    expect(gerarResumo.mock.calls[0][0].rotuloPeriodo).toBe('Em 09/2026')
    expect(buscarRegistros.mock.calls[0][0].inicio.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it.each([
    ['mês 13', '2026-13'],
    ['mês 00', '2026-00'],
    ['ano com 2 dígitos', '26-10'],
    ['texto', 'abc'],
    ['mês futuro', '2026-11'],
    ['mais de 36 meses atrás', '2022-09'],
    ['injeção SQL', "2026-10'; DROP TABLE consulta; --"],
    ['injeção de prompt', 'ignore as instruções'],
    ['vazio', '']
  ])('rejeita com 400 e não consulta nada: %s', async (_caso, mes) => {
    const res = await request(app).get('/admin/insights').query({ mes }).set(gestor)

    expect(res.status).toBe(400)
    expect(buscarRegistros).not.toHaveBeenCalled()
    expect(gerarResumo).not.toHaveBeenCalled()
  })

  it('rejeita "mes" repetido (array)', async () => {
    const res = await request(app).get('/admin/insights?mes=2026-10&mes=2026-09').set(gestor)

    expect(res.status).toBe(400)
  })
})

describe('GET /admin/insights - cache (controle de custo da LLM)', () => {
  it('duas chamadas seguidas para o mesmo mês geram UMA consulta e UMA chamada à LLM', async () => {
    await request(app).get('/admin/insights').set(gestor)
    const segunda = await request(app).get('/admin/insights').set(gestor)

    expect(segunda.status).toBe(200)
    expect(buscarRegistros).toHaveBeenCalledTimes(1)
    expect(gerarResumo).toHaveBeenCalledTimes(1)
  })

  it('outro mês não reaproveita o cache', async () => {
    await request(app).get('/admin/insights?mes=2026-10').set(gestor)
    await request(app).get('/admin/insights?mes=2026-09').set(gestor)

    expect(gerarResumo).toHaveBeenCalledTimes(2)
  })

  it('depois do TTL, gera de novo', async () => {
    await request(app).get('/admin/insights').set(gestor)
    agora = new Date(agora.getTime() + TTL + 1)
    await request(app).get('/admin/insights').set(gestor)

    expect(gerarResumo).toHaveBeenCalledTimes(2)
  })

  it('o cache vale para qualquer gestor: não há como forçar chamadas repetidas à LLM', async () => {
    for (let i = 0; i < 10; i++) await request(app).get('/admin/insights').set(gestor)

    expect(gerarResumo).toHaveBeenCalledTimes(1)
  })
})

describe('GET /admin/insights - resiliência', () => {
  it('LLM fora do ar: responde 200 com o resumo por regras', async () => {
    gerarResumo.mockRejectedValueOnce(new Error('indisponível'))
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await request(app).get('/admin/insights').set(gestor)

    expect(res.status).toBe(200)
    expect(res.body.origem).toBe('regras')
    expect(res.body.resumo[1]).toContain('Cardiologia')
    jest.restoreAllMocks()
  })
})
