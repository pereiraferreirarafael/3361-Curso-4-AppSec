/**
 * DTOs de paciente: allowlist de entrada e mapeadores de saída.
 */
import {
  filtrarCamposPermitidos,
  paraPacienteResposta,
  paraPacienteResumo
} from '../../pacientes/pacienteDto.js'

const pacienteDoBanco: any = {
  id: 'uuid-1',
  cpf: '78160552009',
  nome: 'Emerson Laranja',
  email: 'emerson@email.com',
  senha: 'hash-secreto',
  role: 'PACIENTE',
  telefone: '34999335522',
  estaAtivo: true,
  possuiPlanoSaude: true,
  planosSaude: ['Unimed'],
  imagemUrl: 'https://exemplo.com/a.png',
  historico: ['sinusite,moderado'],
  colunaNovaInterna: 'nao-deve-vazar',
  endereco: { id: 9, cep: 1001000, rua: 'Praca da Se', numero: 1, estado: 'SP', complemento: 'Lado impar' },
  imagem: { id: 3, nome: 'a', tamanho: 1, url: 'https://exemplo.com/a.png', key: 'chave-interna' }
}

describe('paraPacienteResposta (saída)', () => {
  const resposta: any = paraPacienteResposta(pacienteDoBanco)

  it.each(['senha', 'cpf', 'role', 'historico', 'colunaNovaInterna'])(
    'nunca expõe "%s"',
    (campo) => {
      expect(resposta[campo]).toBeUndefined()
      expect(JSON.stringify(resposta)).not.toContain('hash-secreto')
      expect(JSON.stringify(resposta)).not.toContain('78160552009')
    }
  )

  it('expõe somente os campos da allowlist', () => {
    expect(Object.keys(resposta).sort()).toEqual([
      'email', 'endereco', 'estaAtivo', 'id', 'imagem', 'imagemUrl',
      'nome', 'planosSaude', 'possuiPlanoSaude', 'telefone'
    ])
  })

  it('não vaza ids/chaves internas de endereco e imagem', () => {
    expect(resposta.endereco).toEqual({ cep: 1001000, rua: 'Praca da Se', numero: 1, estado: 'SP', complemento: 'Lado impar' })
    expect(resposta.imagem).toEqual({ url: 'https://exemplo.com/a.png' })
  })

  it('omite endereco e imagem quando o paciente não tem', () => {
    const r: any = paraPacienteResposta({ ...pacienteDoBanco, endereco: undefined, imagem: null })

    expect('endereco' in r).toBe(false)
    expect('imagem' in r).toBe(false)
  })
})

describe('paraPacienteResumo (listagens)', () => {
  it('devolve apenas id e nome', () => {
    expect(paraPacienteResumo(pacienteDoBanco)).toEqual({ id: 'uuid-1', nome: 'Emerson Laranja' })
  })
})

describe('filtrarCamposPermitidos (entrada)', () => {
  it.each([[null], [undefined], ['texto'], [42], [[1, 2]]])(
    'devolve {} para corpo que não é objeto (%p)',
    (corpo) => {
      expect(filtrarCamposPermitidos(corpo)).toEqual({})
    }
  )

  it('descarta chaves fora do contrato, inclusive em endereco', () => {
    const dto: any = filtrarCamposPermitidos({
      nome: 'Ana',
      role: 'ADMIN',
      endereco: { cep: '1', id: 99, rua: 'R' }
    })

    expect(dto).toEqual({ nome: 'Ana', endereco: { cep: '1', rua: 'R' } })
  })

  it('ignora endereco que não é objeto', () => {
    expect(filtrarCamposPermitidos({ nome: 'Ana', endereco: 'x' })).toEqual({ nome: 'Ana' })
  })

  it('não herda chaves do protótipo', () => {
    const corpo = Object.create({ nome: 'herdado' })

    expect(filtrarCamposPermitidos(corpo)).toEqual({})
  })
})
