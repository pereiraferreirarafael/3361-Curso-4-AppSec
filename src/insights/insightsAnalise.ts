import {
  type ComparativoEspecialidade,
  type MetricasGestao,
  type Periodo,
  type RegistroConsulta
} from './insightsTipos.js'

const ESPECIALIDADE_PADRAO = 'Outras'
const TAMANHO_MAXIMO_ESPECIALIDADE = 40

/** Mês de calendário em UTC: [dia 1 às 00:00, dia 1 do mês seguinte). `mes` vai de 1 a 12. */
export function periodoDoMes (ano: number, mes: number): Periodo {
  return {
    inicio: new Date(Date.UTC(ano, mes - 1, 1)),
    fim: new Date(Date.UTC(ano, mes, 1))
  }
}

export function periodoAnterior (periodo: Periodo): Periodo {
  const inicio = new Date(Date.UTC(periodo.inicio.getUTCFullYear(), periodo.inicio.getUTCMonth() - 1, 1))
  return { inicio, fim: periodo.inicio }
}

/**
 * O nome da especialidade vem de cadastro livre e acaba dentro do prompt da LLM.
 * Só passa texto curto, com letras, espaço, hífen ou apóstrofo; qualquer outra
 * coisa (frases, símbolos, tentativa de "ignore as instruções acima") vira "Outras".
 */
export function normalizaEspecialidade (valor: unknown): string {
  if (typeof valor !== 'string') return ESPECIALIDADE_PADRAO

  // Quebra de linha, tabulação ou caractere invisível nunca fazem parte de um nome de
  // especialidade: é a forma típica de esconder uma ordem numa linha própria do prompt.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/.test(valor)) {
    return ESPECIALIDADE_PADRAO
  }

  const limpo = valor.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (limpo === '' || limpo.length > TAMANHO_MAXIMO_ESPECIALIDADE) return ESPECIALIDADE_PADRAO
  if (!/^[\p{L}][\p{L} '-]*$/u.test(limpo)) return ESPECIALIDADE_PADRAO
  // até 4 palavras: nome de especialidade, não uma frase
  if (limpo.split(' ').length > 4) return ESPECIALIDADE_PADRAO

  return limpo
}

export function variacaoPct (atual: number, anterior: number): number | null {
  if (anterior === 0) return null
  // multiplica antes de dividir: (23 / 40) * 100 dá 57.49999… e arredondaria para 57
  return Math.round(((atual - anterior) * 100) / anterior)
}

const taxaPct = (cancelamentos: number, agendamentos: number): number =>
  agendamentos === 0 ? 0 : Math.round((cancelamentos * 100) / agendamentos)

interface Contagem { agendamentos: number, cancelamentos: number }

const contar = (registros: RegistroConsulta[], periodo: Periodo): Map<string, Contagem> => {
  const porEspecialidade = new Map<string, Contagem>()

  for (const registro of registros) {
    const quando = registro.data instanceof Date ? registro.data.getTime() : NaN
    if (Number.isNaN(quando) || quando < periodo.inicio.getTime() || quando >= periodo.fim.getTime()) continue

    const especialidade = normalizaEspecialidade(registro.especialidade)
    const atual = porEspecialidade.get(especialidade) ?? { agendamentos: 0, cancelamentos: 0 }
    atual.agendamentos += 1
    if (registro.cancelada) atual.cancelamentos += 1
    porEspecialidade.set(especialidade, atual)
  }

  return porEspecialidade
}

const somar = (mapa: Map<string, Contagem>): Contagem => {
  let agendamentos = 0
  let cancelamentos = 0
  for (const valor of mapa.values()) {
    agendamentos += valor.agendamentos
    cancelamentos += valor.cancelamentos
  }
  return { agendamentos, cancelamentos }
}

/**
 * Compara o período com o imediatamente anterior, por especialidade e no total.
 * "Agendamentos" = consultas marcadas com data no período (inclui as canceladas);
 * "cancelamentos" = as que foram canceladas.
 */
export function calcularMetricas (
  registros: RegistroConsulta[],
  periodo: Periodo,
  rotuloPeriodo = 'No período'
): MetricasGestao {
  const atual = contar(registros, periodo)
  const anterior = contar(registros, periodoAnterior(periodo))

  const nomes = new Set([...atual.keys(), ...anterior.keys()])
  const especialidades: ComparativoEspecialidade[] = [...nomes].map((especialidade) => {
    const a = atual.get(especialidade) ?? { agendamentos: 0, cancelamentos: 0 }
    const p = anterior.get(especialidade) ?? { agendamentos: 0, cancelamentos: 0 }
    return {
      especialidade,
      agendamentos: a.agendamentos,
      cancelamentos: a.cancelamentos,
      taxaCancelamentoPct: taxaPct(a.cancelamentos, a.agendamentos),
      agendamentosAnterior: p.agendamentos,
      cancelamentosAnterior: p.cancelamentos,
      variacaoCancelamentosPct: variacaoPct(a.cancelamentos, p.cancelamentos)
    }
  }).sort((x, y) => y.cancelamentos - x.cancelamentos || x.especialidade.localeCompare(y.especialidade))

  const totalAtual = somar(atual)
  const totalAnterior = somar(anterior)

  return {
    rotuloPeriodo,
    periodo: { inicio: periodo.inicio.toISOString(), fim: periodo.fim.toISOString() },
    totais: {
      agendamentos: totalAtual.agendamentos,
      cancelamentos: totalAtual.cancelamentos,
      taxaCancelamentoPct: taxaPct(totalAtual.cancelamentos, totalAtual.agendamentos),
      cancelamentosAnterior: totalAnterior.cancelamentos,
      variacaoCancelamentosPct: variacaoPct(totalAtual.cancelamentos, totalAnterior.cancelamentos)
    },
    especialidades
  }
}
