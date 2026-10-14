export const MAXIMO_LINHAS = 3
export const MAXIMO_CARACTERES_LINHA = 220

/**
 * A resposta da LLM é texto não confiável: pode trazer markdown, HTML, links ou
 * prosa demais. Esta função devolve no máximo 3 linhas de texto puro, ou `null`
 * se não sobrar nada aproveitável (quem chama usa então o resumo por regras).
 */
export function sanearSaidaLLM (texto: unknown): string[] | null {
  if (typeof texto !== 'string') return null

  const linhas = texto
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .split(/\r?\n/)
    .map((linha) => linha
      .replace(/<[^>]*>/g, '') // tags HTML
      .replace(/[<>]/g, '')
      .replace(/^\s*(?:[-*•]+|\d+[.)]|#{1,6})\s+/, '') // bullets, numeração, títulos
      .replace(/[*_`~|]/g, '') // ênfase/código markdown
      .replace(/\s+/g, ' ')
      .trim())
    .filter((linha) => linha !== '')
    // links não fazem parte de um resumo de gestão
    .filter((linha) => !/(?:https?:\/\/|www\.|\bjavascript:|\bdata:)/i.test(linha))
    .slice(0, MAXIMO_LINHAS)
    .map((linha) => linha.length > MAXIMO_CARACTERES_LINHA
      ? `${linha.slice(0, MAXIMO_CARACTERES_LINHA - 1).trimEnd()}…`
      : linha)

  return linhas.length > 0 ? linhas : null
}
