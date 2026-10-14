/**
 * O relatório de gestão enxerga os cancelamentos lógicos (canceladaEm) e só lê o necessário.
 */
import { jest } from '@jest/globals'
import { periodoDoMes } from '../../insights/insightsAnalise.js'

const find = jest.fn(async (..._args: any[]): Promise<any[]> => [])
jest.unstable_mockModule('../../data-source.js', () => ({ AppDataSource: { manager: { find } } }))

const { buscarRegistros } = await import('../../insights/insightsRepositorio.js')

const outubro = periodoDoMes(2026, 10)

beforeEach(() => { find.mockClear() })

describe('buscarRegistros', () => {
  it('marca como cancelada a consulta com canceladaEm preenchido', async () => {
    find.mockResolvedValueOnce([
      { data: '2026-10-05T10:00:00Z', canceladaEm: new Date(), especialista: { especialidade: 'Cardiologia' } },
      { data: '2026-10-06T10:00:00Z', canceladaEm: null, especialista: { especialidade: 'Cardiologia' } }
    ])

    const registros = await buscarRegistros(outubro)

    expect(registros.map((r) => r.cancelada)).toEqual([true, false])
  })

  it('motivo de cancelamento sozinho não basta: o que vale é canceladaEm', async () => {
    find.mockResolvedValueOnce([
      { data: '2026-10-05T10:00:00Z', motivoCancelamento: 'outros', canceladaEm: null, especialista: { especialidade: 'Cardiologia' } }
    ])

    expect((await buscarRegistros(outubro))[0].cancelada).toBe(false)
  })

  it('NÃO filtra as canceladas na consulta ao banco (o relatório precisa delas)', async () => {
    await buscarRegistros(outubro)

    expect(find.mock.calls[0][1].where).not.toHaveProperty('canceladaEm')
  })

  it('lê só o necessário e não carrega paciente nem relações eager', async () => {
    await buscarRegistros(outubro)

    const opcoes = find.mock.calls[0][1]
    expect(opcoes.loadEagerRelations).toBe(false)
    expect(opcoes.select).toEqual({
      id: true, data: true, canceladaEm: true, especialista: { id: true, especialidade: true }
    })
    expect(JSON.stringify(opcoes)).not.toContain('paciente')
  })

  it('cobre o mês pedido e o anterior', async () => {
    await buscarRegistros(outubro)

    const { where } = find.mock.calls[0][1]
    const [inicio, fim] = where.data.value
    expect(inicio.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(fim.getTime()).toBe(outubro.fim.getTime() - 1)
  })

  it('especialista ausente vira undefined (a análise agrupa em "Outras")', async () => {
    find.mockResolvedValueOnce([{ data: '2026-10-05T10:00:00Z', canceladaEm: null, especialista: null }])

    expect((await buscarRegistros(outubro))[0].especialidade).toBeUndefined()
  })
})
