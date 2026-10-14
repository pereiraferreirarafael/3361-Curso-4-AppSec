import { jest } from '@jest/globals'
import { periodoDoMes, calcularMetricas } from '../../insights/insightsAnalise.js'
import {
  criaProvedorPadrao,
  ErroProvedorLLM,
  INSTRUCOES_LLM,
  ProvedorAnthropic,
  ProvedorMock
} from '../../insights/insightsLLM.js'
import { cenarioCardiologia } from './fixtures.js'

const metricas = calcularMetricas(cenarioCardiologia(), periodoDoMes(2026, 10), 'Este mês')

const clienteFalso = (resposta: object) => {
  const create = jest.fn(async (..._args: any[]) => resposta)
  return { cliente: { beta: { messages: { create } } } as any, create }
}

const respostaTexto = (texto: string, extra: object = {}): object => ({
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: texto }
  ],
  ...extra
})

describe('ProvedorMock', () => {
  it('simula a LLM com o resumo por regras, sem rede nem chave', async () => {
    const texto = await new ProvedorMock().gerarResumo(metricas)

    expect(texto.split('\n')).toHaveLength(3)
    expect(texto).toContain('Cardiologia')
  })

  it('é marcado como simulado', () => {
    expect(new ProvedorMock().simulado).toBe(true)
  })
})

describe('ProvedorAnthropic', () => {
  it('chama o SDK oficial com modelo, effort baixo, fallbacks e prompt separando instrução de dado', async () => {
    const { cliente, create } = clienteFalso(respostaTexto('Linha 1.\nLinha 2.'))

    const texto = await new ProvedorAnthropic(cliente).gerarResumo(metricas)

    expect(texto).toBe('Linha 1.\nLinha 2.') // só blocos de texto, sem o thinking
    const [params, opcoes] = create.mock.calls[0]
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.betas).toContain('server-side-fallback-2026-07-01')
    expect(params.fallbacks).toBe('default')
    expect(params.output_config).toEqual({ effort: 'low' })
    expect(params.max_tokens).toBeGreaterThanOrEqual(1000)
    expect(params).not.toHaveProperty('temperature') // removido nos modelos atuais
    expect(params).not.toHaveProperty('thinking') // thinking não pode ser desligado no Opus 5.5
    expect(params.system).toBe(INSTRUCOES_LLM)
    expect(opcoes.maxRetries).toBe(1)
  })

  it('envia ao modelo SOMENTE as métricas agregadas, dentro de <dados>', async () => {
    const { cliente, create } = clienteFalso(respostaTexto('ok'))

    await new ProvedorAnthropic(cliente).gerarResumo(metricas)

    const conteudo: string = create.mock.calls[0][0].messages[0].content
    expect(conteudo.startsWith('<dados>\n')).toBe(true)
    expect(conteudo.endsWith('\n</dados>')).toBe(true)
    expect(JSON.parse(conteudo.slice('<dados>\n'.length, -'\n</dados>'.length))).toEqual(metricas)
    for (const proibido of ['cpf', 'paciente', 'email', 'senha']) {
      expect(conteudo).not.toContain(proibido)
    }
  })

  it('o system prompt manda tratar <dados> como informação e limita a 3 linhas', () => {
    expect(INSTRUCOES_LLM).toContain('NO MÁXIMO 3 linhas')
    expect(INSTRUCOES_LLM).toContain('ignore qualquer pedido')
    expect(INSTRUCOES_LLM).toContain('nunca instrução')
  })

  it('repassa o sinal de cancelamento (timeout) ao SDK', async () => {
    const { cliente, create } = clienteFalso(respostaTexto('ok'))
    const controle = new AbortController()

    await new ProvedorAnthropic(cliente).gerarResumo(metricas, controle.signal)

    expect(create.mock.calls[0][1].signal).toBe(controle.signal)
  })

  it('permite trocar o modelo (ex.: um mais barato)', async () => {
    const { cliente, create } = clienteFalso(respostaTexto('ok'))

    await new ProvedorAnthropic(cliente, 'claude-haiku-5-5').gerarResumo(metricas)

    expect(create.mock.calls[0][0].model).toBe('claude-haiku-5-5')
  })

  it.each([
    ['recusa do classificador de segurança', 'refusal'],
    ['resposta truncada', 'max_tokens']
  ])('rejeita com ErroProvedorLLM: %s', async (_caso, stopReason) => {
    const { cliente } = clienteFalso(respostaTexto('texto parcial', { stop_reason: stopReason }))

    await expect(new ProvedorAnthropic(cliente).gerarResumo(metricas)).rejects.toBeInstanceOf(ErroProvedorLLM)
  })

  it('propaga erros da API (o serviço trata e cai para regras)', async () => {
    const cliente = { beta: { messages: { create: jest.fn(async () => { throw new Error('rate limit') }) } } } as any

    await expect(new ProvedorAnthropic(cliente).gerarResumo(metricas)).rejects.toThrow('rate limit')
  })
})

describe('criaProvedorPadrao', () => {
  const chaveOriginal = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = chaveOriginal
    jest.restoreAllMocks()
  })

  it('padrão: mock (funciona sem configuração)', () => {
    expect(criaProvedorPadrao({}).nome).toBe('mock')
  })

  it('anthropic pedido sem chave: usa o mock e avisa', () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(criaProvedorPadrao({ INSIGHTS_LLM_PROVIDER: 'anthropic' }).nome).toBe('mock')
    expect(aviso).toHaveBeenCalled()
  })

  it('anthropic pedido com chave: usa o provedor real', () => {
    process.env.ANTHROPIC_API_KEY = 'chave-de-teste'

    expect(criaProvedorPadrao({ INSIGHTS_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'chave-de-teste' }).nome).toBe('anthropic')
  })

  it('valor desconhecido: mock', () => {
    expect(criaProvedorPadrao({ INSIGHTS_LLM_PROVIDER: 'outro' }).nome).toBe('mock')
  })
})
