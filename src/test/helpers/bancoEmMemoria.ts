import { DataSource } from 'typeorm'

/**
 * Banco SQLite em memória com TODAS as entidades reais, para testes de integração
 * (consultas, restrições e esquema de verdade, em vez de mocks).
 *
 * Uso nos testes:
 *   const bd = await criaBancoEmMemoria()
 *   jest.unstable_mockModule('../../data-source.js', () => ({ AppDataSource: bd }))
 *   ... depois, import() dinâmico das rotas ...
 *   beforeEach(() => limpaBanco(bd))
 */
export async function criaBancoEmMemoria (): Promise<DataSource> {
  // a view Autenticaveis escolhe a sintaxe SQL pelo DB_TYPE no momento do import
  process.env.DB_TYPE = 'sqlite'

  // em sequência: o Jest ESM falha ("module not been linked") com import() em paralelo
  const paciente = await import('../../pacientes/pacienteEntity.js')
  const endereco = await import('../../enderecos/enderecoEntity.js')
  const especialista = await import('../../especialistas/EspecialistaEntity.js')
  const avaliacoes = await import('../../avaliacoes/avaliacoesEntity.js')
  const clinica = await import('../../clinicas/clinicaEntity.js')
  const consulta = await import('../../consultas/consultaEntity.js')
  const autenticaveis = await import('../../auth/authEntity.js')
  const imagem = await import('../../imagem/imagemEntity.js')

  const banco = new DataSource({
    type: 'sqlite',
    database: ':memory:',
    synchronize: true,
    entities: [
      paciente.Paciente, endereco.Endereco, especialista.Especialista, avaliacoes.Avaliacoes,
      clinica.Clinica, consulta.Consulta, autenticaveis.Autenticaveis, imagem.Imagem
    ]
  })
  await banco.initialize()
  return banco
}

/** Esvazia e recria o esquema entre os testes. */
export async function limpaBanco (banco: DataSource): Promise<void> {
  await banco.synchronize(true)
}
