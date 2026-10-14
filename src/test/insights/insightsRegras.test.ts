import { calcularMetricas, periodoDoMes } from '../../insights/insightsAnalise.js'
import { resumoPorRegras } from '../../insights/insightsRegras.js'
import { cenarioCardiologia, registrosDoMes } from './fixtures.js'

const outubro = periodoDoMes(2026, 10)
const resumo = (registros: any[], rotulo = 'Este mês'): string[] =>
  resumoPorRegras(calcularMetricas(registros, outubro, rotulo))

describe('resumoPorRegras', () => {
  it('gera o resumo do enunciado: alta de cancelamentos em Cardiologia + sugestão', () => {
    const linhas = resumo(cenarioCardiologia())

    expect(linhas).toEqual([
      'Foram 70 agendamentos e 28 cancelamentos (taxa de 40%, +12% de cancelamentos em relação ao mês anterior).',
      'Este mês houve um aumento de 15% em cancelamentos na especialidade Cardiologia.',
      'Sugerimos revisar a escala de médicos de Cardiologia.'
    ])
  })

  it('usa o rótulo do período recebido', () => {
    const linhas = resumo(cenarioCardiologia(), 'Em 10/2026')

    expect(linhas[1]).toMatch(/^Em 10\/2026 houve um aumento de 15%/)
  })

  it('nunca passa de 3 linhas, em qualquer cenário', () => {
    const cenarios = [
      cenarioCardiologia(),
      [],
      registrosDoMes('Dermatologia', 2026, 10, 10, 4),
      [...registrosDoMes('A', 2026, 9, 10, 1), ...registrosDoMes('A', 2026, 10, 10, 9)]
    ]

    for (const registros of cenarios) {
      expect(resumo(registros).length).toBeLessThanOrEqual(3)
    }
  })

  it('escolhe a especialidade com a MAIOR alta percentual', () => {
    const linhas = resumo([
      ...registrosDoMes('Cardiologia', 2026, 9, 40, 20),
      ...registrosDoMes('Cardiologia', 2026, 10, 40, 23), // +15%
      ...registrosDoMes('Ortopedia', 2026, 9, 40, 10),
      ...registrosDoMes('Ortopedia', 2026, 10, 40, 15) // +50%
    ])

    expect(linhas[1]).toContain('50%')
    expect(linhas[1]).toContain('Ortopedia')
  })

  it('não dá alarme com amostra pequena (de 1 para 2 cancelamentos)', () => {
    const linhas = resumo([
      ...registrosDoMes('Cardiologia', 2026, 9, 20, 1),
      ...registrosDoMes('Cardiologia', 2026, 10, 20, 2)
    ])

    expect(linhas.join(' ')).not.toContain('houve um aumento')
  })

  it('sem alta relevante: informa a maior taxa e recomenda acompanhamento', () => {
    const linhas = resumo([
      ...registrosDoMes('Cardiologia', 2026, 9, 40, 10),
      ...registrosDoMes('Cardiologia', 2026, 10, 40, 10)
    ])

    expect(linhas[1]).toBe('A maior taxa de cancelamento está em Cardiologia (25%).')
    expect(linhas[2]).toContain('Sugerimos reforçar lembretes')
  })

  it('sem agendamentos: uma única linha informativa', () => {
    expect(resumo([])).toEqual(['Não há agendamentos no período analisado.'])
  })

  it('queda de cancelamentos aparece com sinal negativo', () => {
    const linhas = resumo([
      ...registrosDoMes('Cardiologia', 2026, 9, 40, 20),
      ...registrosDoMes('Cardiologia', 2026, 10, 40, 10)
    ])

    expect(linhas[0]).toContain('-50% de cancelamentos')
  })
})
