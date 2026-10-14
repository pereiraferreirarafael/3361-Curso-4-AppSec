/**
 * Disponibilidade de horário com cancelamento lógico: consulta cancelada libera o horário.
 */
import { jest } from '@jest/globals'

let consultas: any[] = []
const find = jest.fn(async (_entidade: unknown, opcoes: any) => {
  const { paciente, especialista, canceladaEm } = opcoes.where
  return consultas.filter((c) =>
    (paciente === undefined || c.paciente.id === paciente.id) &&
    (especialista === undefined || c.especialista.id === especialista.id) &&
    (canceladaEm?.type !== 'isNull' || c.canceladaEm == null))
})

jest.unstable_mockModule('../../data-source.js', () => ({ AppDataSource: { manager: { find } } }))

const { pacienteEstaDisponivel, especialistaEstaDisponivel } = await import('../../consultas/consultaValidacoes.js')

const horario = new Date(2030, 0, 7, 10, 0, 0) // horário local, como a validação usa
const consulta = (canceladaEm: Date | null): any => ({
  paciente: { id: 'ana' }, especialista: { id: 'lia' }, data: horario, canceladaEm
})

beforeEach(() => { find.mockClear() })

describe('disponibilidade considera apenas consultas ativas', () => {
  it('paciente com consulta ATIVA no dia -> indisponível', async () => {
    consultas = [consulta(null)]

    expect(await pacienteEstaDisponivel('ana', horario)).toBe(false)
  })

  it('paciente com consulta CANCELADA no dia -> disponível de novo', async () => {
    consultas = [consulta(new Date())]

    expect(await pacienteEstaDisponivel('ana', horario)).toBe(true)
  })

  it('especialista com consulta ATIVA no dia -> indisponível', async () => {
    consultas = [consulta(null)]

    expect(await especialistaEstaDisponivel('lia', horario)).toBe(false)
  })

  it('especialista com consulta CANCELADA no dia -> disponível de novo', async () => {
    consultas = [consulta(new Date())]

    expect(await especialistaEstaDisponivel('lia', horario)).toBe(true)
  })

  it('uma cancelada e uma ativa no mesmo dia -> segue indisponível', async () => {
    consultas = [consulta(new Date()), consulta(null)]

    expect(await pacienteEstaDisponivel('ana', horario)).toBe(false)
  })
})
