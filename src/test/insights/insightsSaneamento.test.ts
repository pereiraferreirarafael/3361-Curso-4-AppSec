import { MAXIMO_CARACTERES_LINHA, sanearSaidaLLM } from '../../insights/insightsSaneamento.js'

describe('sanearSaidaLLM (a saída da LLM é texto não confiável)', () => {
  it('mantém texto limpo de até 3 linhas', () => {
    expect(sanearSaidaLLM('Linha um.\nLinha dois.\nLinha três.')).toEqual(['Linha um.', 'Linha dois.', 'Linha três.'])
  })

  it('corta em 3 linhas', () => {
    expect(sanearSaidaLLM('1\n2\n3\n4\n5')).toHaveLength(3)
  })

  it('remove tags HTML e scripts', () => {
    const [linha] = sanearSaidaLLM('<b>Alta</b> de cancelamentos <script>alert(1)</script> em Cardiologia.') as string[]

    expect(linha).not.toMatch(/[<>]/)
    expect(linha).toContain('Alta de cancelamentos')
  })

  it('remove markdown, bullets, numeração e títulos', () => {
    expect(sanearSaidaLLM('## Resumo\n- **Cardiologia** subiu 15%\n1. Revisar a `escala`')).toEqual([
      'Resumo',
      'Cardiologia subiu 15%',
      'Revisar a escala'
    ])
  })

  it('descarta linhas com link ou esquema perigoso', () => {
    expect(sanearSaidaLLM('Veja https://atacante.exemplo/x\nTudo estável.\njavascript:alert(1)\nwww.golpe.com')).toEqual(['Tudo estável.'])
  })

  it('remove caracteres de controle e invisíveis (zero-width, bidi)', () => {
    const [linha] = sanearSaidaLLM('Ca\u0000rdio​logia‮ subiu') as string[]

    expect(linha).toBe('Cardiologia subiu')
  })

  it(`trunca linhas acima de ${MAXIMO_CARACTERES_LINHA} caracteres`, () => {
    const [linha] = sanearSaidaLLM('x'.repeat(1000)) as string[]

    expect(linha.length).toBeLessThanOrEqual(MAXIMO_CARACTERES_LINHA)
    expect(linha.endsWith('…')).toBe(true)
  })

  it.each([[''], ['   \n\n  '], ['<br><br>'], ['https://so-link.exemplo'], [undefined], [null], [42], [{}]])(
    'devolve null quando não sobra nada aproveitável: %p',
    (entrada) => {
      expect(sanearSaidaLLM(entrada)).toBeNull()
    }
  )
})
